// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

/// @title ISystem - pallet-revive System precompile
/// @notice Exposes native Substrate crypto to EVM contracts.
/// @dev Available at address `0x0000000000000000000000000000000000000900`. The
///      `sr25519Verify` selector is `0x307a575d`
///      (keccak256("sr25519Verify(uint8[64],bytes,bytes32)")[0..4]).
interface ISystem {
    /// @notice Verifies an sr25519 signature.
    /// @param signature The 64-byte signature, one byte right-aligned per word.
    /// @param message The exact signed bytes.
    /// @param publicKey The 32-byte sr25519 public key (AccountId32).
    /// @return Whether the signature is valid for the message and public key.
    function sr25519Verify(
        uint8[64] calldata signature,
        bytes calldata message,
        bytes32 publicKey
    ) external view returns (bool);
}
