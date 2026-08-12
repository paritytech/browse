// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

/// @title IPersonhood - Proof of Personhood Precompile
/// @notice Query personhood status of an account.
/// @dev Available at address `0x000000000000000000000000000000000a010000`. The precompile
///      reads from the alias-accounts pallet, which stores per-context alias mappings backed
///      by ring membership proofs. Tiers are defined incrementally: 0=None, 1=Lite, 2=Full.
interface IPersonhood {
    /// @notice Personhood information for an account in a given context.
    /// @param status The personhood verification tier (0=None, 1=Lite, 2=Full).
    /// @param contextAlias Context-specific 32-byte pseudonym; zero when status is None.
    struct PersonhoodInfo {
        uint8 status;
        bytes32 contextAlias;
    }

    /// @notice Inputs to {personhoodInfoByProof}.
    /// @param expectedStatus The tier the proof claims (1=Lite, 2=Full). Anything else is rejected.
    /// @param proof SCALE-encoded ring-signature proof.
    /// @param expectedAlias The 32-byte alias the proof must derive in the given context.
    /// @param ringIndex Index of the ring within the collection the proof references.
    /// @param context A 32-byte application identifier, same semantics as {personhoodStatus}.
    /// @param revision Revision of the ring root the proof was created against.
    /// @param message Message bound into the proof. The precompile does not bind it to
    ///        `msg.sender`, so a proof not embedding an account is replayable.
    struct ProofVerificationRequest {
        uint8 expectedStatus;
        bytes proof;
        bytes32 expectedAlias;
        uint32 ringIndex;
        bytes32 context;
        uint32 revision;
        bytes message;
    }

    /// @notice Returns personhood info for an account within a specific application context.
    /// @param account The address to query.
    /// @param context A 32-byte application identifier picked by the calling application.
    /// @return info The personhood info struct; all fields zero when the account has no personhood.
    function personhoodStatus(
        address account,
        bytes32 context
    ) external view returns (PersonhoodInfo memory info);

    /// @notice Verifies a ring-membership proof and reports whether it attests to the claimed tier.
    /// @dev Pure verification. Nothing is stored, so the account needs no prior alias binding.
    /// @return ok True on successful verification, false on any failure.
    function personhoodInfoByProof(
        ProofVerificationRequest calldata request
    ) external view returns (bool ok);
}
