// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {RecipientAndAttesterIndexResolver} from "../src/RecipientAndAttesterIndexResolver.sol";
import {IAttestationService, Attestation} from "../src/interfaces/IAttestationService.sol";
import {IPersonhood} from "../src/interfaces/IPersonhood.sol";

contract RecipientAndAttesterIndexResolverTest is Test {
    RecipientAndAttesterIndexResolver internal resolver;

    address internal service = makeAddr("service");
    address internal mallory = makeAddr("mallory");
    address internal productA = makeAddr("productA");
    address internal productB = makeAddr("productB");
    address internal app = makeAddr("app");
    address internal app2 = makeAddr("app2");

    address internal constant PERSONHOOD_ADDR =
        0x000000000000000000000000000000000a010000;

    uint256 internal constant SCHEMA = 7;

    // One human keeps one alias in this context however many accounts they attest from,
    // which is what the dedup leans on.
    bytes32 internal aliceAlias = keccak256("alice-person");
    bytes32 internal bobAlias = keccak256("bob-person");

    function setUp() public {
        resolver = new RecipientAndAttesterIndexResolver(
            IAttestationService(service)
        );
        _mockPersonhood(true);
    }

    function _proof(
        bytes32 personAlias
    )
        internal
        pure
        returns (IPersonhood.ProofVerificationRequest memory request)
    {
        request.expectedStatus = 2;
        request.expectedAlias = personAlias;
    }

    function _att(
        uint256 id,
        address attester,
        address recipient,
        bytes32 personAlias
    ) internal pure returns (Attestation memory attestation) {
        attestation.id = id;
        attestation.schema = SCHEMA;
        attestation.attester = attester;
        attestation.recipient = recipient;
        attestation.data = abi.encode("calculator", _proof(personAlias));
    }

    function _mockPersonhood(bool ok) internal {
        vm.mockCall(
            PERSONHOOD_ADDR,
            abi.encodeWithSelector(IPersonhood.personhoodInfoByProof.selector),
            abi.encode(ok)
        );
    }

    function _mockActive(uint256 id, bool active) internal {
        vm.mockCall(
            service,
            abi.encodeWithSelector(IAttestationService.isActive.selector, id),
            abi.encode(active)
        );
    }

    function test_constructor_revertsOnZeroService() public {
        vm.expectRevert(
            RecipientAndAttesterIndexResolver
                .RecipientAndAttesterIndexResolver__InvalidService
                .selector
        );
        new RecipientAndAttesterIndexResolver(IAttestationService(address(0)));
    }

    function test_constructor_setsService() public view {
        assertEq(address(resolver.getService()), service);
    }

    function test_getAttestDigest_differsPerAppAndAttester() public view {
        bytes32 base = resolver.getAttestDigest(productA, app, SCHEMA);

        assertTrue(base != resolver.getAttestDigest(productB, app, SCHEMA));
        assertTrue(base != resolver.getAttestDigest(productA, app2, SCHEMA));
        assertTrue(base != resolver.getAttestDigest(productA, app, SCHEMA + 1));
    }

    function test_onAttest_revertsWhenCallerNotService() public {
        vm.expectRevert(
            RecipientAndAttesterIndexResolver
                .RecipientAndAttesterIndexResolver__AccessDenied
                .selector
        );
        vm.prank(mallory);
        resolver.onAttest(_att(1, productA, app, aliceAlias));
    }

    function test_onAttest_admitsProvenAndIndexes() public {
        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productA, app, aliceAlias));

        assertTrue(ok);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
        assertEq(resolver.countByAttester(productA), 1);
        assertTrue(resolver.personHasAttested(app, SCHEMA, aliceAlias));
    }

    function test_onAttest_rejectsWhenProofInvalid() public {
        _mockPersonhood(false);

        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productA, app, aliceAlias));

        assertFalse(ok);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 0);
    }

    function test_onAttest_sybilRejectsSamePersonViaSecondAccount() public {
        // Addresses are free to make, so the lock has to key on the alias the ring derives
        // rather than the attester.
        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app, aliceAlias));
        bool second = resolver.onAttest(_att(2, productB, app, aliceAlias));
        vm.stopPrank();

        assertTrue(first);
        assertFalse(second);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
    }

    function test_onAttest_rejectsAfterPersonhoodLost() public {
        // Proving per attestation is what buys this. Nothing has to revoke a stored binding.
        vm.prank(service);
        bool before = resolver.onAttest(_att(1, productA, app, aliceAlias));

        _mockPersonhood(false);

        vm.prank(service);
        bool afterLoss = resolver.onAttest(_att(2, productA, app2, aliceAlias));

        assertTrue(before);
        assertFalse(afterLoss);
        assertEq(resolver.countByRecipientAndSchema(app2, SCHEMA), 0);
    }

    function test_onAttest_admitsDistinctPeopleForSameApp() public {
        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app, aliceAlias));
        bool second = resolver.onAttest(_att(2, productB, app, bobAlias));
        vm.stopPrank();

        assertTrue(first);
        assertTrue(second);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 2);
    }

    function test_onAttest_samePersonMayAttestDifferentApps() public {
        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app, aliceAlias));
        bool second = resolver.onAttest(_att(2, productA, app2, aliceAlias));
        vm.stopPrank();

        assertTrue(first);
        assertTrue(second);
    }

    function test_onRevoke_releasesPersonAndReattestSucceeds() public {
        vm.startPrank(service);
        resolver.onAttest(_att(1, productA, app, aliceAlias));
        resolver.onRevoke(_att(1, productA, app, aliceAlias));

        assertFalse(resolver.personHasAttested(app, SCHEMA, aliceAlias));
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 0);

        bool reattest = resolver.onAttest(_att(2, productA, app, aliceAlias));
        vm.stopPrank();

        assertTrue(reattest);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
    }

    function test_isActiveAny_trueWhenListedAttesterActive() public {
        vm.prank(service);
        resolver.onAttest(_att(1, productA, app, aliceAlias));

        _mockActive(1, true);
        vm.mockCall(
            service,
            abi.encodeWithSelector(
                IAttestationService.getAttestationById.selector,
                1
            ),
            abi.encode(_att(1, productA, app, aliceAlias))
        );

        address[] memory attesters = new address[](1);
        attesters[0] = productA;
        assertTrue(resolver.isActiveAny(app, SCHEMA, attesters));
    }

    function test_listByAttester_paginates() public {
        vm.startPrank(service);
        resolver.onAttest(_att(1, productA, app, aliceAlias));
        resolver.onAttest(_att(2, productA, app2, aliceAlias));
        vm.stopPrank();

        uint256[] memory ids = resolver.listByAttester(productA, 0, 10);
        assertEq(ids.length, 2);
    }

    function test_listByRecipientAndSchema_revertsOnOversizePage() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                RecipientAndAttesterIndexResolver
                    .RecipientAndAttesterIndexResolver__PageSizeTooLarge
                    .selector,
                101,
                100
            )
        );
        resolver.listByRecipientAndSchema(app, SCHEMA, 0, 101);
    }
}
