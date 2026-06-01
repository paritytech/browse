// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

/// @title IDotnsRegistrar
/// @notice Minimal slice of the DotNS registrar interface used by browse contracts.
/// @dev The DotNS registrar is an ERC721-backed contract where `tokenId == uint256(namehash)`.
///      Only the read paths needed for ownership checks are re-declared here so this repo
///      does not pull the upgradeable-OZ dependency tree from the dotns repo.
interface IDotnsRegistrar {
    /// @notice Returns the owner of the `.dot` name identified by `tokenId`.
    /// @dev Reverts (e.g. with `ERC721NonexistentToken`) when the token has never been minted.
    /// @param tokenId The token id, equal to `uint256(namehash(label.dot))`.
    /// @return holder The current owner of the name.
    function ownerOf(uint256 tokenId) external view returns (address holder);
}
