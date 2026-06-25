// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {RecipientAndAttesterIndexResolver} from "../src/RecipientAndAttesterIndexResolver.sol";
import {IAttestationService, Attestation} from "../src/interfaces/IAttestationService.sol";
import {IPersonhood} from "../src/interfaces/IPersonhood.sol";
import {ISystem} from "../src/interfaces/ISystem.sol";

contract RecipientAndAttesterIndexResolverTest is Test {
    RecipientAndAttesterIndexResolver internal resolver;

    address internal service = makeAddr("service");
    address internal mallory = makeAddr("mallory");
    address internal productA = makeAddr("productA");
    address internal productB = makeAddr("productB");
    address internal app = makeAddr("app");
    address internal app2 = makeAddr("app2");

    address internal constant SYSTEM_ADDR = 0x0000000000000000000000000000000000000900;
    address internal constant HUMANITY_ADDR = 0x000000000000000000000000000000000a010000;

    bytes32 internal constant CONTEXT = bytes32("dotns");
    uint256 internal constant SCHEMA = 7;

    bytes32 internal alicePk = keccak256("alice-identity");
    bytes32 internal bobPk = keccak256("bob-identity");
    bytes32 internal aliceAlias = keccak256("alice-alias");
    bytes32 internal bobAlias = keccak256("bob-alias");

    function setUp() public {
        resolver = new RecipientAndAttesterIndexResolver(IAttestationService(service));
        _mockVerify(true);
        _mockHumanity(alicePk, 2, aliceAlias);
        _mockHumanity(bobPk, 2, bobAlias);
        _bind(productA, alicePk);
        _bind(productB, bobPk);
    }

    function _identity(bytes32 pubkey) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(pubkey)))));
    }

    function _sig() internal pure returns (bytes memory) {
        return new bytes(64);
    }

    function _bind(address account, bytes32 pubkey) internal {
        vm.prank(account);
        resolver.bindIdentity(pubkey, _sig());
    }

    function _att(
        uint256 id,
        address attester,
        address recipient
    ) internal pure returns (Attestation memory attestation) {
        attestation.id = id;
        attestation.schema = SCHEMA;
        attestation.attester = attester;
        attestation.recipient = recipient;
    }

    function _mockVerify(bool ok) internal {
        vm.mockCall(
            SYSTEM_ADDR,
            abi.encodeWithSelector(ISystem.sr25519Verify.selector),
            abi.encode(ok)
        );
    }

    function _mockHumanity(bytes32 pubkey, uint8 status, bytes32 alias_) internal {
        vm.mockCall(
            HUMANITY_ADDR,
            abi.encodeWithSelector(
                IPersonhood.personhoodStatus.selector,
                _identity(pubkey),
                CONTEXT
            ),
            abi.encode(IPersonhood.PersonhoodInfo({status: status, contextAlias: alias_}))
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
            RecipientAndAttesterIndexResolver.RecipientAndAttesterIndexResolver__InvalidService.selector
        );
        new RecipientAndAttesterIndexResolver(IAttestationService(address(0)));
    }

    function test_constructor_setsServiceAndContext() public view {
        assertEq(address(resolver.getService()), service);
        assertEq(resolver.HUMANITY_CONTEXT(), CONTEXT);
    }

    function test_bindIdentity_storesBinding() public view {
        assertEq(resolver.boundIdentity(productA), _identity(alicePk));
    }

    function test_bindIdentity_revertsOnInvalidSignature() public {
        _mockVerify(false);
        vm.expectRevert(
            RecipientAndAttesterIndexResolver
                .RecipientAndAttesterIndexResolver__InvalidIdentitySignature
                .selector
        );
        vm.prank(productA);
        resolver.bindIdentity(alicePk, _sig());
    }

    function test_bindIdentity_revertsOnWrongSignatureLength() public {
        vm.expectRevert(
            RecipientAndAttesterIndexResolver
                .RecipientAndAttesterIndexResolver__InvalidIdentitySignature
                .selector
        );
        vm.prank(productA);
        resolver.bindIdentity(alicePk, new bytes(32));
    }

    function test_bindIdentity_rebindOverwrites() public {
        _bind(productA, bobPk);
        assertEq(resolver.boundIdentity(productA), _identity(bobPk));
    }

    function test_onAttest_revertsWhenCallerNotService() public {
        vm.expectRevert(
            RecipientAndAttesterIndexResolver.RecipientAndAttesterIndexResolver__AccessDenied.selector
        );
        vm.prank(mallory);
        resolver.onAttest(_att(1, productA, app));
    }

    function test_onAttest_admitsBoundHumanAndIndexes() public {
        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productA, app));

        assertTrue(ok);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
        assertEq(resolver.countByAttester(productA), 1);
        assertTrue(resolver.aliasHasAttested(app, SCHEMA, aliceAlias));
    }

    function test_onAttest_rejectsWhenNotBound() public {
        address productC = makeAddr("productC");
        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productC, app));

        assertFalse(ok);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 0);
    }

    function test_onAttest_rejectsWhenNoHumanity() public {
        _mockHumanity(alicePk, 0, bytes32(0));
        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productA, app));

        assertFalse(ok);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 0);
    }

    function test_onAttest_admitsLiteTier() public {
        _mockHumanity(alicePk, 1, aliceAlias);
        vm.prank(service);
        bool ok = resolver.onAttest(_att(1, productA, app));

        assertTrue(ok);
    }

    function test_onAttest_sybilRejectsSamePersonViaSecondProductAccount() public {
        // Same identity (alicePk) reusing a different product account against the same app.
        _bind(productB, alicePk);

        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app));
        bool second = resolver.onAttest(_att(2, productB, app));
        vm.stopPrank();

        assertTrue(first);
        assertFalse(second);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
    }

    function test_onAttest_admitsDistinctPeopleForSameApp() public {
        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app));
        bool second = resolver.onAttest(_att(2, productB, app));
        vm.stopPrank();

        assertTrue(first);
        assertTrue(second);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 2);
    }

    function test_onAttest_samePersonMayAttestDifferentApps() public {
        vm.startPrank(service);
        bool first = resolver.onAttest(_att(1, productA, app));
        bool second = resolver.onAttest(_att(2, productA, app2));
        vm.stopPrank();

        assertTrue(first);
        assertTrue(second);
    }

    function test_onRevoke_releasesAliasAndReattestSucceeds() public {
        vm.startPrank(service);
        resolver.onAttest(_att(1, productA, app));
        resolver.onRevoke(_att(1, productA, app));

        assertFalse(resolver.aliasHasAttested(app, SCHEMA, aliceAlias));
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 0);

        bool reattest = resolver.onAttest(_att(2, productA, app));
        vm.stopPrank();

        assertTrue(reattest);
        assertEq(resolver.countByRecipientAndSchema(app, SCHEMA), 1);
    }

    function test_isActiveAny_trueWhenListedAttesterActive() public {
        vm.prank(service);
        resolver.onAttest(_att(1, productA, app));

        _mockActive(1, true);
        vm.mockCall(
            service,
            abi.encodeWithSelector(IAttestationService.getAttestationById.selector, 1),
            abi.encode(_att(1, productA, app))
        );

        address[] memory attesters = new address[](1);
        attesters[0] = productA;
        assertTrue(resolver.isActiveAny(app, SCHEMA, attesters));
    }

    function test_listByAttester_paginates() public {
        vm.startPrank(service);
        resolver.onAttest(_att(1, productA, app));
        resolver.onAttest(_att(2, productA, app2));
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
