// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {IDotnsRegistrar} from "./IDotnsRegistrar.sol";
import {ISemver} from "./ISemver.sol";

/// @title IPublisher
/// @notice The interface of the browse publishing registry.
interface IPublisher is ISemver {
    /// @notice The per-label registry record.
    ///
    /// `indexPlusOne` is the 1-indexed position of the label in the global
    /// published list. Zero means the label is not currently published, so
    /// callers can use the struct itself as both presence flag and data.
    struct Publication {
        address publisher;
        uint64 timestamp;
        uint32 indexPlusOne;
    }

    /// @notice Emitted when a label is published as a discoverable app.
    event Published(
        address indexed publisher,
        bytes32 indexed labelNode,
        bytes32 indexed labelhash,
        uint64 timestamp
    );

    /// @notice Emitted when an owner retracts a previously published label.
    event Unpublished(
        address indexed publisher,
        bytes32 indexed labelNode,
        bytes32 indexed labelhash,
        uint64 timestamp
    );

    error EmptyLabel();
    error NoPersonhood();
    error NotOwner(address caller, uint256 tokenId);
    error RateLimitExceeded(uint64 nextAvailableAt);

    /// @notice Publishes the caller's `.dot` label as a discoverable app.
    function publish(string calldata label) external;

    /// @notice Retracts a previously published label from discovery.
    function unpublish(string calldata label) external;

    /// @notice Returns true iff the label is currently published.
    function isPublished(bytes32 labelhash) external view returns (bool);

    /// @notice Returns the total number of currently published labels.
    function publishedCount() external view returns (uint256);

    /// @notice Returns the labelhash at the given enumeration index.
    ///
    /// Order is not stable across unpublishes. Removes use swap-and-pop.
    function getPublishedAt(uint256 index) external view returns (bytes32 labelhash);

    /// @notice Returns a paginated slice of labelhashes from the global feed.
    ///
    /// Pair each entry with `publicationOf` (or a Multicall batch) for per-label
    /// publisher/timestamp data.
    function getPublished(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory labelhashes);

    /// @notice Direct lookup of a publication by its labelhash.
    ///
    /// Returns a zero-valued `Publication` when the label is not published.
    /// That state is equivalent to `indexPlusOne == 0`.
    function publicationOf(bytes32 labelhash) external view returns (Publication memory);

    /// @notice The DotNS registrar consulted for label ownership.
    function registrar() external view returns (IDotnsRegistrar);
}
