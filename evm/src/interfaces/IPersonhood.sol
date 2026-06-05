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

    /// @notice Returns personhood info for an account within a specific application context.
    /// @param account The address to query.
    /// @param context A 32-byte application identifier picked by the calling application.
    /// @return info The personhood info struct; all fields zero when the account has no personhood.
    function personhoodStatus(
        address account,
        bytes32 context
    ) external view returns (PersonhoodInfo memory info);
}
