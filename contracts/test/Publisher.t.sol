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
    }

    function _mockOwner(address holder) internal {
        vm.mockCall(
            registrar,
            abi.encodeWithSelector(IDotnsRegistrar.ownerOf.selector, tokenId),
            abi.encode(holder)
        );
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

    function test_publish_liteFirstCallEmitsAndStoresTimestamp() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);

        vm.warp(1_000_000);
        vm.expectEmit(true, true, true, true);
        emit IPublisher.Published(alice, labelNode, labelhash, uint64(block.timestamp));

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.lastPublishedAt(alice), uint64(block.timestamp));
    }

    function test_publish_liteSecondCallWithin24hReverts() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);
        vm.warp(1_000_000);
        vm.prank(alice);
        publisher.publish(LABEL);

        uint64 nextAllowed = uint64(block.timestamp) + 1 days;
        vm.warp(block.timestamp + 1 days - 1);

        vm.expectRevert(abi.encodeWithSelector(IPublisher.CooldownActive.selector, nextAllowed));
        vm.prank(alice);
        publisher.publish(LABEL);
    }

    function test_publish_liteSecondCallAfter24hSucceeds() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);
        vm.warp(1_000_000);
        vm.prank(alice);
        publisher.publish(LABEL);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.lastPublishedAt(alice), uint64(block.timestamp));
    }

    function test_publish_fullNoCooldownAndDoesNotWriteTimestamp() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        vm.prank(alice);
        publisher.publish(LABEL);

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.lastPublishedAt(alice), 0);
    }

    function test_publish_liteThenUpgradeToFullBypassesStaleTimestamp() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);
        vm.warp(1_000_000);
        vm.prank(alice);
        publisher.publish(LABEL);
        uint64 staleTimestamp = publisher.lastPublishedAt(alice);

        vm.warp(block.timestamp + 1 hours);
        _mockStatus(alice, 2);

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.lastPublishedAt(alice), staleTimestamp);
    }

    function test_version_returnsExpectedSemver() public view {
        assertEq(publisher.version(), "1.1.0");
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

        vm.warp(2_000_000);
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

    function test_unpublish_doesNotTouchCooldown() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);
        vm.warp(1_000_000);
        vm.prank(alice);
        publisher.publish(LABEL);
        uint64 cooldownBefore = publisher.lastPublishedAt(alice);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        publisher.unpublish(LABEL);

        assertEq(publisher.lastPublishedAt(alice), cooldownBefore);
    }

    function test_unpublish_doesNotResetCooldown() public {
        _mockOwner(alice);
        _mockStatus(alice, 1);
        vm.warp(1_000_000);
        vm.prank(alice);
        publisher.publish(LABEL);

        vm.warp(block.timestamp + 1 hours);
        vm.prank(alice);
        publisher.unpublish(LABEL);

        uint64 nextAllowed = publisher.lastPublishedAt(alice) + 1 days;
        vm.expectRevert(abi.encodeWithSelector(IPublisher.CooldownActive.selector, nextAllowed));
        vm.prank(alice);
        publisher.publish(LABEL);
    }

    // -------------------- enumeration --------------------

    function _mockOwnerOf(uint256 tokenId_, address holder) internal {
        vm.mockCall(
            registrar,
            abi.encodeWithSelector(IDotnsRegistrar.ownerOf.selector, tokenId_),
            abi.encode(holder)
        );
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

    function test_publish_enumerationExposesLabelhash() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.getPublishedAt(0), labelhash);
    }

    function test_publish_republishIsIdempotentOnSet() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);

        vm.prank(alice);
        publisher.publish(LABEL);
        vm.prank(alice);
        publisher.publish(LABEL);

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_republishAfterTransferKeepsSingleEntry() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        // simulate a `.dot` transfer: registrar now reports a new owner
        address bob = makeAddr("bob");
        _mockOwner(bob);
        _mockStatus(bob, 2);

        vm.prank(bob);
        publisher.publish(LABEL);

        assertEq(publisher.publishedCount(), 1);
        assertTrue(publisher.isPublished(labelhash));
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

    function test_getPublished_returnsPaginatedSlice() public {
        // publish two distinct labels
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        string memory secondLabel = "bob";
        bytes32 secondLabelhash = keccak256(bytes(secondLabel));
        bytes32 secondLabelNode = keccak256(abi.encodePacked(DOT_NODE, secondLabelhash));
        uint256 secondTokenId = uint256(secondLabelNode);
        _mockOwnerOf(secondTokenId, alice);
        vm.prank(alice);
        publisher.publish(secondLabel);

        bytes32[] memory page = publisher.getPublished(0, 10);
        assertEq(page.length, 2);

        bytes32[] memory firstOnly = publisher.getPublished(0, 1);
        assertEq(firstOnly.length, 1);
        assertEq(firstOnly[0], labelhash);

        bytes32[] memory secondOnly = publisher.getPublished(1, 10);
        assertEq(secondOnly.length, 1);
        assertEq(secondOnly[0], secondLabelhash);
    }

    function test_getPublished_offsetBeyondTotalReturnsEmpty() public {
        _mockOwner(alice);
        _mockStatus(alice, 2);
        vm.prank(alice);
        publisher.publish(LABEL);

        bytes32[] memory page = publisher.getPublished(5, 10);
        assertEq(page.length, 0);
    }
}
