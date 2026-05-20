// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {IDotnsRegistrar} from "./IDotnsRegistrar.sol";
import {ISemver} from "./ISemver.sol";

/// @title IPublisher
/// @notice The interface of the browse publishing registry.
interface IPublisher is ISemver {
    /// @notice Emitted when a label is published as a discoverable app.
    /// @param publisher The owner of the published label.
    /// @param labelNode The namehash of `<label>.dot`.
    /// @param labelhash `keccak256(bytes(label))`.
    /// @param timestamp The block timestamp at publish time.
    event Published(
        address indexed publisher,
        bytes32 indexed labelNode,
        bytes32 indexed labelhash,
        uint64 timestamp
    );

    /// @notice Emitted when an owner retracts a previously published label.
    /// @param publisher The owner of the retracted label.
    /// @param labelNode The namehash of `<label>.dot`.
    /// @param labelhash `keccak256(bytes(label))`.
    /// @param timestamp The block timestamp at retraction time.
    event Unpublished(
        address indexed publisher,
        bytes32 indexed labelNode,
        bytes32 indexed labelhash,
        uint64 timestamp
    );

    error CooldownActive(uint64 nextAllowedAt);
    error EmptyLabel();
    error NoPersonhood();
    error NotOwner(address caller, uint256 tokenId);

    /// @notice Publishes the caller's `.dot` label as a discoverable app.
    /// @param label The `.dot` label, without the `.dot` suffix.
    function publish(string calldata label) external;

    /// @notice Retracts a previously published label from discovery.
    /// @param label The `.dot` label, without the `.dot` suffix.
    function unpublish(string calldata label) external;

    /// @notice Returns true iff the label is currently published.
    /// @param labelhash `keccak256(bytes(label))`.
    function isPublished(bytes32 labelhash) external view returns (bool);

    /// @notice Returns the total number of currently published labels.
    function publishedCount() external view returns (uint256);

    /// @notice Returns the labelhash at the given enumeration index.
    /// @dev Order is not stable across unpublishes — removes use swap-and-pop.
    /// @param index Zero-based index into the published set.
    function getPublishedAt(uint256 index) external view returns (bytes32 labelhash);

    /// @notice Returns a paginated slice of currently published labelhashes.
    /// @param offset Zero-based start index.
    /// @param limit Maximum number of entries to return.
    function getPublished(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory labelhashes);

    /// @notice Returns the timestamp of the caller's last cooldown-bearing publish.
    /// @param publisher The address to query.
    /// @return timestamp The block timestamp of the last Lite-tier publish, or zero.
    function lastPublishedAt(address publisher) external view returns (uint64 timestamp);

    /// @notice Returns the DotNS registrar consulted for label ownership.
    /// @return The address of the configured registrar.
    function registrar() external view returns (IDotnsRegistrar);
}
