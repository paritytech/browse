// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { Attestation } from "./IAttestationService.sol";

/// @title IAttestationResolver
/// @notice The interface of an optional per-schema attestation resolver.
interface IAttestationResolver {
    /// @notice Processes an attestation and verifies whether it's valid.
    /// @param att The new attestation.
    /// @return Whether the attestation is valid.
    function onAttest(Attestation calldata att) external returns (bool);

    /// @notice Processes an attestation revocation and verifies if it can be revoked.
    /// @param att The existing attestation to be revoked.
    /// @return Whether the attestation can be revoked.
    function onRevoke(Attestation calldata att) external returns (bool);
}
