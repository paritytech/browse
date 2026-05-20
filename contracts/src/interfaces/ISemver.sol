// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

/// @title ISemver
/// @notice The interface of the contract version retrieval.
interface ISemver {
    /// @notice Returns the contract version as `major.minor.patch`.
    /// @return The contract version.
    function version() external view returns (string memory);
}
