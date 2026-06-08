// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {TrustedAttesterIndexResolver} from "../src/TrustedAttesterIndexResolver.sol";
import {IAttestationService, Attestation} from "../src/interfaces/IAttestationService.sol";

contract TrustedAttesterIndexResolverTest is Test {
    TrustedAttesterIndexResolver internal resolver;

    address internal service = makeAddr("service");
    address internal certifier = makeAddr("certifier");
    address internal mallory = makeAddr("mallory");
    address internal app = makeAddr("app");
    address internal app2 = makeAddr("app2");

    uint256 internal constant SCHEMA = 7;

    function setUp() public {
        resolver = new TrustedAttesterIndexResolver(IAttestationService(service), certifier);
    }

    function _att(address attester, address recipient)
        internal
        pure
        returns (Attestation memory att)
    {
        att.schema = SCHEMA;
        att.attester = attester;
        att.recipient = recipient;
    }

    function _slot(address recipient, uint256 schema) internal view returns (uint256) {
        return uint256(keccak256(abi.encodePacked(certifier, recipient, schema)));
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
            TrustedAttesterIndexResolver.TrustedAttesterIndexResolver__InvalidService.selector
        );
        new TrustedAttesterIndexResolver(IAttestationService(address(0)), certifier);
    }

    function test_constructor_revertsOnZeroAttester() public {
        vm.expectRevert(
            TrustedAttesterIndexResolver.TrustedAttesterIndexResolver__InvalidAttester.selector
        );
        new TrustedAttesterIndexResolver(IAttestationService(service), address(0));
    }

    function test_constructor_setsServiceAndAttester() public view {
        assertEq(address(resolver.getService()), service);
        assertEq(resolver.trustedAttester(), certifier);
    }

    function test_onAttest_revertsWhenCallerNotService() public {
        vm.expectRevert(
            TrustedAttesterIndexResolver.TrustedAttesterIndexResolver__AccessDenied.selector
        );
        vm.prank(mallory);
        resolver.onAttest(_att(certifier, app));
    }

    function test_onAttest_admitsTrustedAttesterAndIndexes() public {
        vm.prank(service);
        bool ok = resolver.onAttest(_att(certifier, app));

        assertTrue(ok);
        assertEq(resolver.countBySchema(SCHEMA), 1);
    }

    function test_onAttest_rejectsUntrustedAttester() public {
        vm.prank(service);
        bool ok = resolver.onAttest(_att(mallory, app));

        assertFalse(ok);
        assertEq(resolver.countBySchema(SCHEMA), 0);
    }

    function test_onRevoke_removesFromIndex() public {
        vm.startPrank(service);
        resolver.onAttest(_att(certifier, app));
        resolver.onRevoke(_att(certifier, app));
        vm.stopPrank();

        assertEq(resolver.countBySchema(SCHEMA), 0);
    }

    function test_listBySchema_enumeratesCertifiedRecipients() public {
        vm.startPrank(service);
        resolver.onAttest(_att(certifier, app));
        resolver.onAttest(_att(certifier, app2));
        vm.stopPrank();

        address[] memory recipients = resolver.listBySchema(SCHEMA, 0, 10);
        assertEq(recipients.length, 2);
        assertEq(resolver.countBySchema(SCHEMA), 2);
    }

    function test_listBySchema_dedupesRepeatCertification() public {
        // Re-certifying the same recipient (unique-schema overwrite reuses the slot) must not
        // double-count it in the enumerable set.
        vm.startPrank(service);
        resolver.onAttest(_att(certifier, app));
        resolver.onAttest(_att(certifier, app));
        vm.stopPrank();

        assertEq(resolver.countBySchema(SCHEMA), 1);
    }

    function test_listBySchema_revertsOnOversizePage() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                TrustedAttesterIndexResolver.TrustedAttesterIndexResolver__PageSizeTooLarge.selector,
                101,
                100
            )
        );
        resolver.listBySchema(SCHEMA, 0, 101);
    }

    function test_listBySchema_offsetBeyondTotalReturnsEmpty() public {
        vm.prank(service);
        resolver.onAttest(_att(certifier, app));

        address[] memory recipients = resolver.listBySchema(SCHEMA, 5, 10);
        assertEq(recipients.length, 0);
    }

    function test_isActive_trueWhenServiceReportsActive() public {
        _mockActive(_slot(app, SCHEMA), true);
        assertTrue(resolver.isActive(app, SCHEMA));
    }

    function test_isActive_falseWhenServiceReportsInactive() public {
        _mockActive(_slot(app, SCHEMA), false);
        assertFalse(resolver.isActive(app, SCHEMA));
    }
}
