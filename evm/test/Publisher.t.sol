// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {Publisher} from "../src/Publisher.sol";
import {IPublisher} from "../src/interfaces/IPublisher.sol";
import {IDotnsRegistrar} from "../src/interfaces/IDotnsRegistrar.sol";
import {IPersonhood} from "../src/interfaces/IPersonhood.sol";

contract PublisherTest is Test {
    address internal constant PERSONHOOD = 0x000000000000000000000000000000000a010000;
    bytes32 internal constant DOT_NODE =
        0x3fce7d1364a893e213bc4212792b517ffc88f5b13b86c8ef9c8d390c3a1370ce;
    bytes32 internal constant PERSONHOOD_CONTEXT = bytes32("dotns");
    string internal constant LABEL = "alice";

    uint64 internal constant RATE_WINDOW = 1 days;
    uint64 internal constant LITE_DAILY_LIMIT = 1;
    uint64 internal constant FULL_DAILY_LIMIT = 5;

    Publisher internal publisher;
    address internal registrar = makeAddr("registrar");
    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    bytes32 internal labelhash;
    bytes32 internal labelNode;
    uint256 internal tokenId;

    function setUp() public {
        publisher = new Publisher(IDotnsRegistrar(registrar));
        labelhash = keccak256(bytes(LABEL));
        labelNode = keccak256(abi.encodePacked(DOT_NODE, labelhash));
        tokenId = uint256(labelNode);
        // Start beyond the rate window so cutoff arithmetic uses the steady-state branch.
        vm.warp(2 days);
    }

    function _mockOwner(uint256 tokenId_, address holder) internal {
        vm.mockCall(
            registrar,
            abi.encodeWithSelector(IDotnsRegistrar.ownerOf.selector, tokenId_),
            abi.encode(holder)
        );
    }

    function _mockOwner(address holder) internal {
        _mockOwner(tokenId, holder);
    }

    function _mockOwnerRevert() internal {
        vm.mockCallRevert(
            registrar,
            abi.encodeWithSelector(IDotnsRegistrar.ownerOf.selector, tokenId),
            abi.encodeWithSignature("ERC721NonexistentToken(uint256)", tokenId)
        );
    }

    function _mockStatus(address account, uint8 status) internal {
        bytes32 alias_ = status == 0 ? bytes32(0) : keccak256(abi.encode(account, status));
        vm.mockCall(
            PERSONHOOD,
            abi.encodeWithSelector(IPersonhood.personhoodStatus.selector, account, PERSONHOOD_CONTEXT),
            abi.encode(IPersonhood.PersonhoodInfo({status: status, contextAlias: alias_}))
        );
    }

    function _labelhash(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _tokenIdOf(string memory label) internal pure returns (uint256) {
        bytes32 h = keccak256(bytes(label));
        return uint256(keccak256(abi.encodePacked(DOT_NODE, h)));
    }

    function _publishAs(address caller, string memory label) internal {
        _mockOwner(_tokenIdOf(label), caller);
        vm.prank(caller);
        publisher.publish(label);
    }

    function test_publish_revertsWhenLabelEmpty() public {
        vm.expectRevert(IPublisher.EmptyLabel.selector);
        vm.prank(alice);
        publisher.publish("");
    }

    function test_publish_revertsWhenLabelUnminted() public {
        _mockOwnerRevert();
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.publish(LABEL);
    }

    function test_publish_revertsWhenCallerNotOwner() public {
        _mockOwner(mallory);
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.publish(LABEL);
    }

    function test_publish_revertsWhenNoPersonhood() public {
        _mockOwner(alice);
        _mockStatus(alice, 0);
        vm.expectRevert(IPublisher.NoPersonhood.selector);
        vm.prank(alice);
        publisher.publish(LABEL);
    }

    function test_publish_emitsPublishedAndRecordsEntry() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        vm.expectEmit(true, true, true, true);
        emit IPublisher.Published(alice, labelNode, labelhash, uint64(block.timestamp));

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.getPublishedAt(0), labelhash);
        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, alice);
        assertEq(entry.timestamp, uint64(block.timestamp));
        assertEq(entry.indexPlusOne, 1);
    }

    function test_version_returnsExpectedSemver() public view {
        assertEq(publisher.version(), "2.1.0");
    }

    function test_publicationOf_returnsZeroValueForUnknownLabel() public view {
        IPublisher.Publication memory missing = publisher.publicationOf(labelhash);
        assertEq(missing.publisher, address(0));
        assertEq(missing.timestamp, 0);
        assertEq(missing.indexPlusOne, 0);
    }

    function test_publicationOf_returnsRecordedFieldsAfterPublish() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, alice);
        assertEq(entry.timestamp, uint64(block.timestamp));
        assertEq(entry.indexPlusOne, 1);
    }

    function test_publish_liteAllowsOneWithinWindow() public {
        _mockStatus(alice, 1);

        _publishAs(alice, "a");

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_liteSecondInWindowReverts() public {
        _mockStatus(alice, 1);

        uint64 firstTs = uint64(block.timestamp);
        _publishAs(alice, "a");
        vm.warp(block.timestamp + 1 hours);

        uint64 expectedNextAvailable = firstTs + RATE_WINDOW;
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPublisher.RateLimitExceeded.selector, expectedNextAvailable)
        );
        vm.prank(alice);
        publisher.publish("b");
    }

    function test_publish_liteSlotFreesAfterWindow() public {
        _mockStatus(alice, 1);

        _publishAs(alice, "a");

        // Advance just past when the first publish leaves the window.
        vm.warp(uint64(block.timestamp) + RATE_WINDOW + 1);

        _publishAs(alice, "b");
        assertEq(publisher.publishedCount(), 2);
    }

    function test_publish_liteRepublishConsumesSlot() public {
        _mockStatus(alice, 1);

        _publishAs(alice, "a");

        // 2nd call (any label) must be rate-limited once the single slot is used.
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b");

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_fullAllowsFiveWithinWindow() public {
        _mockStatus(alice, 2);

        _publishAs(alice, "a");
        _publishAs(alice, "b");
        _publishAs(alice, "c");
        _publishAs(alice, "d");
        _publishAs(alice, "e");

        assertEq(publisher.publishedCount(), 5);
    }

    function test_publish_fullSixthInWindowReverts() public {
        _mockStatus(alice, 2);

        uint64 firstTs = uint64(block.timestamp);
        _publishAs(alice, "a");
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "b");
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "c");
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "d");
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "e");

        uint64 expectedNextAvailable = firstTs + RATE_WINDOW;
        _mockOwner(_tokenIdOf("f"), alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPublisher.RateLimitExceeded.selector, expectedNextAvailable)
        );
        vm.prank(alice);
        publisher.publish("f");
    }

    function test_publish_tierUpgradeMidWindowGrantsHigherCap() public {
        _mockStatus(alice, 1);
        _publishAs(alice, "a");

        _mockStatus(alice, 2);
        // Full now allows 4 more within the rolling window (5 total).
        _publishAs(alice, "b");
        _publishAs(alice, "c");
        _publishAs(alice, "d");
        _publishAs(alice, "e");

        // 6th must still be rate-limited.
        _mockOwner(_tokenIdOf("f"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("f");
    }

    function test_publish_tierDowngradeMidWindowAppliesLowerCap() public {
        _mockStatus(alice, 2);
        _publishAs(alice, "a");

        _mockStatus(alice, 1);
        // Lite cap (1) is already met. Next call must revert.
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b");
    }

    function test_owner_isDeployer() public view {
        assertEq(publisher.owner(), address(this));
    }

    function test_publish_ownerBypassesPersonhoodAndRateLimit() public {
        // The test contract is the owner. It has no personhood (status 0),
        // which would revert for anyone else.
        _mockStatus(address(this), 0);

        // Publish far past the Full-tier cap of 5 within a single window.
        for (uint256 i = 0; i < 8; ++i) {
            string memory label = string(abi.encodePacked("app", vm.toString(i)));
            _mockOwner(_tokenIdOf(label), address(this));
            publisher.publish(label);
        }

        assertEq(publisher.publishedCount(), 8);
    }

    function test_publish_privilegeFollowsTwoStepOwnershipTransfer() public {
        address bob = makeAddr("bob");
        // Hand the registry off to bob via the two-step flow.
        publisher.transferOwnership(bob);
        // Pending owner is not privileged until acceptance.
        assertEq(publisher.owner(), address(this));
        vm.prank(bob);
        publisher.acceptOwnership();
        assertEq(publisher.owner(), bob);

        // Bob now publishes past the Full-tier cap with no personhood.
        _mockStatus(bob, 0);
        for (uint256 i = 0; i < 7; ++i) {
            string memory label = string(abi.encodePacked("bobapp", vm.toString(i)));
            _mockOwner(_tokenIdOf(label), bob);
            vm.prank(bob);
            publisher.publish(label);
        }
        assertEq(publisher.publishedCount(), 7);

        // The old owner lost the privilege: it is gated again and reverts.
        _mockStatus(address(this), 0);
        _mockOwner(_tokenIdOf("old"), address(this));
        vm.expectRevert(IPublisher.NoPersonhood.selector);
        publisher.publish("old");
    }

    function test_unpublish_revertsWhenLabelEmpty() public {
        vm.expectRevert(IPublisher.EmptyLabel.selector);
        vm.prank(alice);
        publisher.unpublish("");
    }

    function test_unpublish_revertsWhenLabelUnminted() public {
        _mockOwnerRevert();
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.unpublish(LABEL);
    }

    function test_unpublish_revertsWhenCallerNotOwner() public {
        _mockOwner(mallory);
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.unpublish(LABEL);
    }

    function test_unpublish_emitsEvent() public {
        _mockOwner(alice);

        vm.expectEmit(true, true, true, true);
        emit IPublisher.Unpublished(alice, labelNode, labelhash, uint64(block.timestamp));

        vm.prank(alice);
        publisher.unpublish(LABEL);
    }

    function test_unpublish_doesNotRequirePersonhood() public {
        _mockOwner(alice);
        _mockStatus(alice, 0);

        vm.prank(alice);
        publisher.unpublish(LABEL);
    }

    function test_unpublish_doesNotFreeRateSlot() public {
        _mockStatus(alice, 1);
        _publishAs(alice, "a");

        // Unpublish should not return the consumed rate slot.
        _mockOwner(_tokenIdOf("a"), alice);
        vm.prank(alice);
        publisher.unpublish("a");

        // The next publish must still revert because the slot from "a" remains
        // active in the rate-limit ring (unpublish does not free rate slots).
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b");
    }

    function test_publish_addsToPublishedSet() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        assertEq(publisher.publishedCount(), 0);
        assertFalse(publisher.isPublished(labelhash));

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.publishedCount(), 1);
        assertTrue(publisher.isPublished(labelhash));
    }

    function test_publish_republishKeepsSingleEntry() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        vm.prank(alice);
        publisher.publish(LABEL);
        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_republishRefreshesPublisherAndTimestamp() public {
        address bob = makeAddr("bob");
        _mockStatus(alice, 2);
        _mockStatus(bob, 2);

        _publishAs(alice, LABEL);

        // simulate a `.dot` transfer: registrar now reports bob as owner.
        _mockOwner(bob);
        vm.warp(block.timestamp + 1 hours);
        uint64 republishTs = uint64(block.timestamp);
        vm.prank(bob);
        publisher.publish(LABEL);

        // Single entry. Ownership and timestamp refreshed to bob's call.
        assertEq(publisher.publishedCount(), 1);
        assertEq(publisher.getPublishedAt(0), labelhash);
        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, bob);
        assertEq(entry.timestamp, republishTs);
    }

    function test_unpublish_removesFromPublishedSet() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        vm.prank(alice);
        publisher.unpublish(LABEL);

        assertEq(publisher.publishedCount(), 0);
        assertFalse(publisher.isPublished(labelhash));
    }

    function test_unpublish_isIdempotentWhenNotPublished() public {
        _mockOwner(alice);

        vm.prank(alice);
        publisher.unpublish(LABEL);

        assertEq(publisher.publishedCount(), 0);
        assertFalse(publisher.isPublished(labelhash));
    }

    function test_unpublish_swapAndPopUpdatesMovedIndex() public {
        _mockStatus(alice, 2);
        _publishAs(alice, "a");
        _publishAs(alice, "b");
        _publishAs(alice, "c");

        // Remove the middle entry. "c" should be moved into its slot.
        _mockOwner(_tokenIdOf("b"), alice);
        vm.prank(alice);
        publisher.unpublish("b");

        assertEq(publisher.publishedCount(), 2);
        // Slot 0 still "a", slot 1 now "c".
        assertEq(publisher.getPublishedAt(0), _labelhash("a"));
        assertEq(publisher.getPublishedAt(1), _labelhash("c"));
        // Removing "c" next must still work, which proves the moved entry's index was rewritten.
        _mockOwner(_tokenIdOf("c"), alice);
        vm.prank(alice);
        publisher.unpublish("c");
        assertEq(publisher.publishedCount(), 1);
        assertEq(publisher.getPublishedAt(0), _labelhash("a"));
    }

    function test_getPublished_returnsPaginatedSlice() public {
        _mockStatus(alice, 2);
        _publishAs(alice, "alice");
        _publishAs(alice, "bob");

        bytes32[] memory page = publisher.getPublished(0, 10);
        assertEq(page.length, 2);

        bytes32[] memory firstOnly = publisher.getPublished(0, 1);
        assertEq(firstOnly.length, 1);
        assertEq(firstOnly[0], _labelhash("alice"));

        bytes32[] memory secondOnly = publisher.getPublished(1, 10);
        assertEq(secondOnly.length, 1);
        assertEq(secondOnly[0], _labelhash("bob"));
    }

    function test_getPublished_offsetBeyondTotalReturnsEmpty() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        bytes32[] memory page = publisher.getPublished(5, 10);
        assertEq(page.length, 0);
    }

    function test_publicationOf_carriesTimestampForClientSideOrdering() public {
        _mockStatus(alice, 2);

        uint64 t1 = uint64(block.timestamp);
        _publishAs(alice, "a");
        vm.warp(block.timestamp + 1 hours);
        uint64 t2 = uint64(block.timestamp);
        _publishAs(alice, "b");

        bytes32[] memory page = publisher.getPublished(0, 10);
        assertEq(page.length, 2);
        assertEq(publisher.publicationOf(page[0]).timestamp, t1);
        assertEq(publisher.publicationOf(page[1]).timestamp, t2);
    }
}
