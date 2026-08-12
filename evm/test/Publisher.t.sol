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

    bytes32 internal constant ALICE_ALIAS = keccak256("alice-person");
    bytes32 internal constant BOB_ALIAS = keccak256("bob-person");

    Publisher internal publisher;
    address internal registrar = makeAddr("registrar");
    address internal alice = makeAddr("alice");
    address internal mallory = makeAddr("mallory");

    bytes32 internal labelhash;
    bytes32 internal labelNode;
    uint256 internal tokenId;

    function setUp() public {
        publisher = new Publisher(IDotnsRegistrar(registrar), DOT_NODE);
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

    /// A proof request as a caller would submit it.
    ///
    /// `context` and `message` carry deliberate junk, and the mocks only answer the
    /// overwritten form.
    function _request(uint8 status, bytes32 personAlias)
        internal
        pure
        returns (IPersonhood.ProofVerificationRequest memory)
    {
        return
            IPersonhood.ProofVerificationRequest({
                expectedStatus: status,
                proof: hex"c0ffee",
                expectedAlias: personAlias,
                ringIndex: 3,
                context: bytes32("wrong-context"),
                revision: 7,
                message: hex"beef"
            });
    }

    function _emptyRequest()
        internal
        pure
        returns (IPersonhood.ProofVerificationRequest memory)
    {
        return
            IPersonhood.ProofVerificationRequest({
                expectedStatus: 0,
                proof: "",
                expectedAlias: bytes32(0),
                ringIndex: 0,
                context: bytes32(0),
                revision: 0,
                message: ""
            });
    }

    /// The precompile calldata the contract must produce for a publish of `label`.
    function _boundCall(
        address caller,
        string memory label,
        IPersonhood.ProofVerificationRequest memory req
    ) internal view returns (bytes memory) {
        IPersonhood.ProofVerificationRequest memory bound = IPersonhood
            .ProofVerificationRequest({
                expectedStatus: req.expectedStatus,
                proof: req.proof,
                expectedAlias: req.expectedAlias,
                ringIndex: req.ringIndex,
                context: PERSONHOOD_CONTEXT,
                revision: req.revision,
                message: abi.encodePacked(publisher.getPublishDigest(caller, _labelhash(label)))
            });
        return abi.encodeCall(IPersonhood.personhoodInfoByProof, (bound));
    }

    function _mockProof(
        address caller,
        string memory label,
        IPersonhood.ProofVerificationRequest memory req,
        bool ok
    ) internal {
        vm.mockCall(PERSONHOOD, _boundCall(caller, label, req), abi.encode(ok));
    }

    /// Builds a request for `caller` and mocks the precompile into accepting it for
    /// `label` only. Publishing a second label needs a second `_allow`.
    function _allow(
        address caller,
        string memory label,
        uint8 status,
        bytes32 personAlias
    ) internal returns (IPersonhood.ProofVerificationRequest memory req) {
        req = _request(status, personAlias);
        _mockProof(caller, label, req, true);
    }

    function _labelhash(string memory label) internal pure returns (bytes32) {
        return keccak256(bytes(label));
    }

    function _tokenIdOf(string memory label) internal pure returns (uint256) {
        bytes32 h = keccak256(bytes(label));
        return uint256(keccak256(abi.encodePacked(DOT_NODE, h)));
    }

    /// Publishes `label` as `caller`, minting the one proof that label needs.
    function _publishAs(
        address caller,
        string memory label,
        uint8 status,
        bytes32 personAlias
    ) internal {
        IPersonhood.ProofVerificationRequest memory req = _allow(
            caller,
            label,
            status,
            personAlias
        );
        _mockOwner(_tokenIdOf(label), caller);
        vm.prank(caller);
        publisher.publish(label, req);
    }

    function test_publish_revertsWhenLabelEmpty() public {
        vm.expectRevert(IPublisher.EmptyLabel.selector);
        vm.prank(alice);
        publisher.publish("", _request(2, ALICE_ALIAS));
    }

    function test_publish_revertsWhenLabelUnminted() public {
        _mockOwnerRevert();
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.publish(LABEL, _request(2, ALICE_ALIAS));
    }

    function test_publish_revertsWhenCallerNotOwner() public {
        _mockOwner(mallory);
        vm.expectRevert(abi.encodeWithSelector(IPublisher.NotOwner.selector, alice, tokenId));
        vm.prank(alice);
        publisher.publish(LABEL, _request(2, ALICE_ALIAS));
    }

    function test_publish_revertsWhenProofRejected() public {
        _mockOwner(alice);
        IPersonhood.ProofVerificationRequest memory req = _request(2, ALICE_ALIAS);
        _mockProof(alice, LABEL, req, false);

        vm.expectRevert(IPublisher.NoPersonhood.selector);
        vm.prank(alice);
        publisher.publish(LABEL, req);
    }

    function test_publish_bindsProofToCaller() public {
        IPersonhood.ProofVerificationRequest memory req = _request(2, ALICE_ALIAS);
        // Mallory replays the calldata alice sent. Only alice can spend the proof.
        _mockProof(alice, LABEL, req, true);
        _mockProof(mallory, LABEL, req, false);

        _mockOwner(mallory);
        vm.expectRevert(IPublisher.NoPersonhood.selector);
        vm.prank(mallory);
        publisher.publish(LABEL, req);
    }

    function test_getPublishDigest_coversChainContractPublisherAndLabel() public {
        assertEq(
            publisher.getPublishDigest(alice, labelhash),
            keccak256(abi.encode(block.chainid, address(publisher), alice, labelhash))
        );

        // Each of the four inputs changes the digest, so a proof minted for one
        // combination is not spendable on any other.
        Publisher other = new Publisher(IDotnsRegistrar(registrar), DOT_NODE);
        bytes32 here = publisher.getPublishDigest(alice, labelhash);
        assertTrue(other.getPublishDigest(alice, labelhash) != here);
        assertTrue(publisher.getPublishDigest(mallory, labelhash) != here);
        assertTrue(publisher.getPublishDigest(alice, _labelhash("other-label")) != here);

        vm.chainId(block.chainid + 1);
        assertTrue(publisher.getPublishDigest(alice, labelhash) != here);
    }

    function test_publish_proofForOneLabelDoesNotPublishAnother() public {
        // Alice holds a valid proof for "a" and tries to spend it on "b".
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, "a", 2, ALICE_ALIAS);
        _mockProof(alice, "b", req, false);

        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert(IPublisher.NoPersonhood.selector);
        vm.prank(alice);
        publisher.publish("b", req);
    }

    function test_publish_bindsProofToRegistryContext() public {
        _mockOwner(alice);
        IPersonhood.ProofVerificationRequest memory req = _request(2, ALICE_ALIAS);
        // Accept the context the caller picked, refuse the one the registry pins.
        vm.mockCall(
            PERSONHOOD,
            abi.encodeCall(IPersonhood.personhoodInfoByProof, (req)),
            abi.encode(true)
        );
        _mockProof(alice, LABEL, req, false);

        vm.expectRevert(IPublisher.NoPersonhood.selector);
        vm.prank(alice);
        publisher.publish(LABEL, req);
    }

    function test_publish_emitsPublishedAndRecordsEntry() public {
        _mockOwner(alice);
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, LABEL, 2, ALICE_ALIAS);

        vm.expectEmit(true, true, true, true);
        emit IPublisher.Published(alice, labelNode, labelhash, uint64(block.timestamp));

        vm.prank(alice);
        publisher.publish(LABEL, req);

        assertEq(publisher.getPublishedAt(0), labelhash);
        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, alice);
        assertEq(entry.timestamp, uint64(block.timestamp));
        assertEq(entry.indexPlusOne, 1);
    }

    function test_version_returnsExpectedSemver() public view {
        assertEq(publisher.version(), "3.0.0");
    }

    function test_constructor_recordsTldNode() public view {
        assertEq(publisher.tldNode(), DOT_NODE);
    }

    function test_constructor_revertsOnZeroTldNode() public {
        vm.expectRevert(IPublisher.EmptyTldNode.selector);
        new Publisher(IDotnsRegistrar(registrar), bytes32(0));
    }

    function test_publicationOf_returnsZeroValueForUnknownLabel() public view {
        IPublisher.Publication memory missing = publisher.publicationOf(labelhash);
        assertEq(missing.publisher, address(0));
        assertEq(missing.timestamp, 0);
        assertEq(missing.indexPlusOne, 0);
    }

    function test_publicationOf_returnsRecordedFieldsAfterPublish() public {
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, alice);
        assertEq(entry.timestamp, uint64(block.timestamp));
        assertEq(entry.indexPlusOne, 1);
    }

    function test_publish_liteAllowsOneWithinWindow() public {
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_liteSecondInWindowReverts() public {
        uint64 firstTs = uint64(block.timestamp);
        _publishAs(alice, "a", 1, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);

        uint64 expectedNextAvailable = firstTs + RATE_WINDOW;
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, "b", 1, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPublisher.RateLimitExceeded.selector, expectedNextAvailable)
        );
        vm.prank(alice);
        publisher.publish("b", req);
    }

    function test_publish_liteSlotFreesAfterWindow() public {
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        // Advance just past when the first publish leaves the window.
        vm.warp(uint64(block.timestamp) + RATE_WINDOW + 1);

        _publishAs(alice, "b", 1, ALICE_ALIAS);
        assertEq(publisher.publishedCount(), 2);
    }

    function test_publish_liteRepublishConsumesSlot() public {
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        // 2nd call (any label) must be rate-limited once the single slot is used.
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, "b", 1, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b", req);

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_rateLimitFollowsThePersonNotTheAddress() public {
        // One person, two addresses, one alias.
        address alt = makeAddr("alice-second-key");
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        IPersonhood.ProofVerificationRequest memory altReq = _allow(alt, "b", 1, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("b"), alt);
        vm.expectRevert(
            abi.encodeWithSelector(
                IPublisher.RateLimitExceeded.selector,
                uint64(block.timestamp) + RATE_WINDOW
            )
        );
        vm.prank(alt);
        publisher.publish("b", altReq);
    }

    function test_publish_separatePeopleHaveSeparateWindows() public {
        address bob = makeAddr("bob");
        _publishAs(alice, "a", 1, ALICE_ALIAS);
        _publishAs(bob, "b", 1, BOB_ALIAS);

        assertEq(publisher.publishedCount(), 2);
    }

    function test_publish_fullAllowsFiveWithinWindow() public {
        _publishAs(alice, "a", 2, ALICE_ALIAS);
        _publishAs(alice, "b", 2, ALICE_ALIAS);
        _publishAs(alice, "c", 2, ALICE_ALIAS);
        _publishAs(alice, "d", 2, ALICE_ALIAS);
        _publishAs(alice, "e", 2, ALICE_ALIAS);

        assertEq(publisher.publishedCount(), 5);
    }

    function test_publish_fullSixthInWindowReverts() public {
        uint64 firstTs = uint64(block.timestamp);
        _publishAs(alice, "a", 2, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "b", 2, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "c", 2, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "d", 2, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);
        _publishAs(alice, "e", 2, ALICE_ALIAS);

        uint64 expectedNextAvailable = firstTs + RATE_WINDOW;
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, "f", 2, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("f"), alice);
        vm.expectRevert(
            abi.encodeWithSelector(IPublisher.RateLimitExceeded.selector, expectedNextAvailable)
        );
        vm.prank(alice);
        publisher.publish("f", req);
    }

    function test_publish_tierUpgradeMidWindowGrantsHigherCap() public {
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        // Full now allows 4 more within the rolling window (5 total).
        _publishAs(alice, "b", 2, ALICE_ALIAS);
        _publishAs(alice, "c", 2, ALICE_ALIAS);
        _publishAs(alice, "d", 2, ALICE_ALIAS);
        _publishAs(alice, "e", 2, ALICE_ALIAS);

        // 6th must still be rate-limited.
        IPersonhood.ProofVerificationRequest memory full = _allow(alice, "f", 2, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("f"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("f", full);
    }

    function test_publish_tierDowngradeMidWindowAppliesLowerCap() public {
        _publishAs(alice, "a", 2, ALICE_ALIAS);

        // Lite cap (1) is already met. Next call must revert.
        IPersonhood.ProofVerificationRequest memory lite = _allow(alice, "b", 1, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b", lite);
    }

    function test_owner_isDeployer() public view {
        assertEq(publisher.owner(), address(this));
    }

    function test_publish_ownerBypassesPersonhoodAndRateLimit() public {
        // The test contract is the owner. An empty proof reverts for anyone else.
        IPersonhood.ProofVerificationRequest memory none = _emptyRequest();

        // Publish far past the Full-tier cap of 5 within a single window.
        for (uint256 i = 0; i < 8; ++i) {
            string memory label = string(abi.encodePacked("app", vm.toString(i)));
            _mockOwner(_tokenIdOf(label), address(this));
            publisher.publish(label, none);
        }

        assertEq(publisher.publishedCount(), 8);
    }

    function test_publish_privilegeFollowsTwoStepOwnershipTransfer() public {
        address bob = makeAddr("bob");
        IPersonhood.ProofVerificationRequest memory none = _emptyRequest();

        // Hand the registry off to bob via the two-step flow.
        publisher.transferOwnership(bob);
        // Pending owner is not privileged until acceptance.
        assertEq(publisher.owner(), address(this));
        vm.prank(bob);
        publisher.acceptOwnership();
        assertEq(publisher.owner(), bob);

        // Bob now publishes past the Full-tier cap with no proof.
        for (uint256 i = 0; i < 7; ++i) {
            string memory label = string(abi.encodePacked("bobapp", vm.toString(i)));
            _mockOwner(_tokenIdOf(label), bob);
            vm.prank(bob);
            publisher.publish(label, none);
        }
        assertEq(publisher.publishedCount(), 7);

        // The old owner lost the privilege: it is gated again and reverts.
        _mockProof(address(this), "old", none, false);
        _mockOwner(_tokenIdOf("old"), address(this));
        vm.expectRevert(IPublisher.NoPersonhood.selector);
        publisher.publish("old", none);
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

        vm.prank(alice);
        publisher.unpublish(LABEL);
    }

    function test_unpublish_doesNotFreeRateSlot() public {
        _publishAs(alice, "a", 1, ALICE_ALIAS);

        // Unpublish should not return the consumed rate slot.
        _mockOwner(_tokenIdOf("a"), alice);
        vm.prank(alice);
        publisher.unpublish("a");

        // The next publish must still revert because the slot from "a" remains
        // active in the rate-limit ring (unpublish does not free rate slots).
        IPersonhood.ProofVerificationRequest memory req = _allow(alice, "b", 1, ALICE_ALIAS);
        _mockOwner(_tokenIdOf("b"), alice);
        vm.expectRevert();
        vm.prank(alice);
        publisher.publish("b", req);
    }

    function test_publish_addsToPublishedSet() public {
        assertEq(publisher.publishedCount(), 0);
        assertFalse(publisher.isPublished(labelhash));

        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

        assertEq(publisher.publishedCount(), 1);
        assertTrue(publisher.isPublished(labelhash));
    }

    function test_publish_republishKeepsSingleEntry() public {
        // Republishing the same label reuses the same digest, so one proof covers both.
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

        assertEq(publisher.publishedCount(), 1);
    }

    function test_publish_republishRefreshesPublisherAndTimestamp() public {
        address bob = makeAddr("bob");
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

        // simulate a `.dot` transfer: registrar now reports bob as owner.
        vm.warp(block.timestamp + 1 hours);
        uint64 republishTs = uint64(block.timestamp);
        _publishAs(bob, LABEL, 2, BOB_ALIAS);

        // Single entry. Ownership and timestamp refreshed to bob's call.
        assertEq(publisher.publishedCount(), 1);
        assertEq(publisher.getPublishedAt(0), labelhash);
        IPublisher.Publication memory entry = publisher.publicationOf(labelhash);
        assertEq(entry.publisher, bob);
        assertEq(entry.timestamp, republishTs);
    }

    function test_unpublish_removesFromPublishedSet() public {
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

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
        _publishAs(alice, "a", 2, ALICE_ALIAS);
        _publishAs(alice, "b", 2, ALICE_ALIAS);
        _publishAs(alice, "c", 2, ALICE_ALIAS);

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
        _publishAs(alice, "alice", 2, ALICE_ALIAS);
        _publishAs(alice, "bob", 2, ALICE_ALIAS);

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
        _publishAs(alice, LABEL, 2, ALICE_ALIAS);

        bytes32[] memory page = publisher.getPublished(5, 10);
        assertEq(page.length, 0);
    }

    function test_publicationOf_carriesTimestampForClientSideOrdering() public {
        uint64 t1 = uint64(block.timestamp);
        _publishAs(alice, "a", 2, ALICE_ALIAS);
        vm.warp(block.timestamp + 1 hours);
        uint64 t2 = uint64(block.timestamp);
        _publishAs(alice, "b", 2, ALICE_ALIAS);

        bytes32[] memory page = publisher.getPublished(0, 10);
        assertEq(page.length, 2);
        assertEq(publisher.publicationOf(page[0]).timestamp, t1);
        assertEq(publisher.publicationOf(page[1]).timestamp, t2);
    }
}
