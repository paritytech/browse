// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {IDotnsRegistrar} from "./interfaces/IDotnsRegistrar.sol";
import {IPersonhood} from "./interfaces/IPersonhood.sol";
import {IPublisher} from "./interfaces/IPublisher.sol";
import {Semver} from "./Semver.sol";

/// @title Publisher
/// @notice The browse publishing registry.
contract Publisher is IPublisher, Semver(2, 0, 0) {
    // The Proof-of-Personhood precompile.
    address internal constant PERSONHOOD =
        0x000000000000000000000000000000000a010000;

    // The namehash of the `.dot` TLD node.
    bytes32 internal constant DOT_NODE =
        0x3fce7d1364a893e213bc4212792b517ffc88f5b13b86c8ef9c8d390c3a1370ce;

    // The application identifier passed to the personhood precompile.
    //
    // Reuses dotns' ring so any dotns-verified account can publish here without a
    // separate ring-root broadcast.
    bytes32 internal constant PERSONHOOD_CONTEXT = bytes32("dotns");

    // The rolling window for the per-publisher rate limit.
    uint64 internal constant RATE_WINDOW = 1 days;

    // Maximum publishes per RATE_WINDOW for Lite-tier (status == 1) callers.
    uint64 internal constant LITE_DAILY_LIMIT = 3;

    // Maximum publishes per RATE_WINDOW for Full-tier (status >= 2) callers.
    uint64 internal constant FULL_DAILY_LIMIT = 5;

    // Per-publisher rolling-window ring of the last FULL_DAILY_LIMIT timestamps.
    //
    // Five uint48 fields total 30 bytes and pack into a single storage slot.
    // uint48 overflows around year 8.9M. Ordering runs most-recent (t0) to
    // oldest (t4). The oldest entry is shifted out on each publish.
    struct PublishWindow {
        uint48 t0;
        uint48 t1;
        uint48 t2;
        uint48 t3;
        uint48 t4;
    }

    /// @inheritdoc IPublisher
    IDotnsRegistrar public immutable registrar;

    // Insertion-order list of labelhashes whose publications are currently live.
    bytes32[] private _published;

    // labelhash => publication record.
    //
    // Presence in the array is tracked via `Publication.indexPlusOne`. The
    // mapping has no separate "is published" flag.
    mapping(bytes32 labelhash => Publication) private _publications;

    // publisher => rolling-window timestamps.
    mapping(address publisher => PublishWindow) private _windows;

    /// @param registrar_ The address of the deployed DotNS registrar.
    constructor(IDotnsRegistrar registrar_) {
        registrar = registrar_;
    }

    /// @inheritdoc IPublisher
    function publish(string calldata label) external {
        (bytes32 labelhash, bytes32 labelNode) = _requireOwnedLabel(label);

        uint8 status = IPersonhood(PERSONHOOD)
            .personhoodStatus(msg.sender, PERSONHOOD_CONTEXT)
            .status;

        if (status == 0) revert NoPersonhood();

        uint64 nowTs = uint64(block.timestamp);
        uint64 cap = status == 1 ? LITE_DAILY_LIMIT : FULL_DAILY_LIMIT;
        _checkAndRecordRate(msg.sender, cap, nowTs);

        Publication storage data = _publications[labelhash];
        if (data.indexPlusOne == 0) {
            _published.push(labelhash);
            data.publisher = msg.sender;
            data.timestamp = nowTs;
            data.indexPlusOne = uint32(_published.length);
        } else {
            // Republish path. Either the same publisher bumping the timestamp,
            // or a new owner re-claiming the listing after a `.dot` transfer.
            data.publisher = msg.sender;
            data.timestamp = nowTs;
        }

        emit Published(msg.sender, labelNode, labelhash, nowTs);
    }

    /// @inheritdoc IPublisher
    function unpublish(string calldata label) external {
        (bytes32 labelhash, bytes32 labelNode) = _requireOwnedLabel(label);

        Publication storage data = _publications[labelhash];
        uint32 idxPlusOne = data.indexPlusOne;
        if (idxPlusOne != 0) {
            uint256 idx = uint256(idxPlusOne) - 1;
            uint256 last = _published.length - 1;
            if (idx != last) {
                bytes32 movedLabelhash = _published[last];
                _published[idx] = movedLabelhash;
                _publications[movedLabelhash].indexPlusOne = idxPlusOne;
            }
            _published.pop();
            delete _publications[labelhash];
        }

        emit Unpublished(
            msg.sender,
            labelNode,
            labelhash,
            uint64(block.timestamp)
        );
    }

    /// @inheritdoc IPublisher
    function isPublished(bytes32 labelhash) external view returns (bool) {
        return _publications[labelhash].indexPlusOne != 0;
    }

    /// @inheritdoc IPublisher
    function publishedCount() external view returns (uint256) {
        return _published.length;
    }

    /// @inheritdoc IPublisher
    function getPublishedAt(uint256 index) external view returns (bytes32) {
        return _published[index];
    }

    /// @inheritdoc IPublisher
    function getPublished(uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory page)
    {
        uint256 total = _published.length;
        if (offset >= total) return new bytes32[](0);
        uint256 available = total - offset;
        uint256 size = limit < available ? limit : available;
        page = new bytes32[](size);
        for (uint256 i; i < size; ++i) {
            page[i] = _published[offset + i];
        }
    }

    /// @inheritdoc IPublisher
    function publicationOf(bytes32 labelhash)
        external
        view
        returns (Publication memory)
    {
        return _publications[labelhash];
    }

    /// @dev Resolves a label to its hashes, requiring caller ownership.
    ///
    /// Collapses "label doesn't exist" and "label exists but isn't yours" into a single
    /// `NotOwner` revert. Callers never need to branch on which one happened.
    function _requireOwnedLabel(string calldata label)
        internal
        view
        returns (bytes32 labelhash, bytes32 labelNode)
    {
        if (bytes(label).length == 0) revert EmptyLabel();

        labelhash = keccak256(bytes(label));
        labelNode = keccak256(abi.encodePacked(DOT_NODE, labelhash));
        uint256 tokenId = uint256(labelNode);

        try registrar.ownerOf(tokenId) returns (address holder) {
            if (holder != msg.sender) revert NotOwner(msg.sender, tokenId);
        } catch {
            revert NotOwner(msg.sender, tokenId);
        }
    }

    /// @dev Enforces the per-publisher daily cap and records this call's timestamp.
    ///
    /// Counts ring entries strictly newer than `nowTs - RATE_WINDOW`. Reverts with
    /// `RateLimitExceeded(oldestActive + RATE_WINDOW)` at cap. On pass, rotates the
    /// ring so the oldest slot drops and `nowTs` becomes the new head.
    function _checkAndRecordRate(
        address caller,
        uint64 cap,
        uint64 nowTs
    ) internal {
        PublishWindow storage w = _windows[caller];
        uint64 cutoff = nowTs > RATE_WINDOW ? nowTs - RATE_WINDOW : 0;

        uint64 active = 0;
        uint64 oldestActive = type(uint64).max;
        uint64 t0 = w.t0;
        uint64 t1 = w.t1;
        uint64 t2 = w.t2;
        uint64 t3 = w.t3;
        uint64 t4 = w.t4;
        if (t0 > cutoff) {
            active++;
            if (t0 < oldestActive) oldestActive = t0;
        }
        if (t1 > cutoff) {
            active++;
            if (t1 < oldestActive) oldestActive = t1;
        }
        if (t2 > cutoff) {
            active++;
            if (t2 < oldestActive) oldestActive = t2;
        }
        if (t3 > cutoff) {
            active++;
            if (t3 < oldestActive) oldestActive = t3;
        }
        if (t4 > cutoff) {
            active++;
            if (t4 < oldestActive) oldestActive = t4;
        }

        if (active >= cap)
            revert RateLimitExceeded(oldestActive + RATE_WINDOW);

        w.t4 = uint48(t3);
        w.t3 = uint48(t2);
        w.t2 = uint48(t1);
        w.t1 = uint48(t0);
        w.t0 = uint48(nowTs);
    }
}
