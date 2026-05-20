// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {IDotnsRegistrar} from "./interfaces/IDotnsRegistrar.sol";
import {IPersonhood} from "./interfaces/IPersonhood.sol";
import {IPublisher} from "./interfaces/IPublisher.sol";
import {Semver} from "./Semver.sol";

/// @title Publisher
/// @notice The browse publishing registry.
contract Publisher is IPublisher, Semver(1, 1, 0) {
    // The Proof-of-Personhood precompile.
    address internal constant PERSONHOOD =
        0x000000000000000000000000000000000a010000;

    // The namehash of the `.dot` TLD node.
    bytes32 internal constant DOT_NODE =
        0x3fce7d1364a893e213bc4212792b517ffc88f5b13b86c8ef9c8d390c3a1370ce;

    // The application identifier passed to the personhood precompile.
    // Reuses dotns' ring so any dotns-verified account can publish here.
    bytes32 internal constant PERSONHOOD_CONTEXT = bytes32("dotns");

    // The minimum time between publishes for Lite-tier callers.
    uint64 internal constant LITE_COOLDOWN = 1 days;

    /// @inheritdoc IPublisher
    IDotnsRegistrar public immutable registrar;

    /// @inheritdoc IPublisher
    mapping(address publisher => uint64 timestamp) public lastPublishedAt;

    // The insertion-order list of currently published labelhashes.
    bytes32[] private _published;

    // labelhash => 1-indexed position in `_published` (zero means not present).
    mapping(bytes32 labelhash => uint256 position) private _positions;

    /// @dev Creates a new Publisher instance.
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

        if (status == 1) {
            uint64 last = lastPublishedAt[msg.sender];
            if (last != 0) {
                uint64 nextAllowed = last + LITE_COOLDOWN;
                if (block.timestamp < nextAllowed)
                    revert CooldownActive(nextAllowed);
            }
            lastPublishedAt[msg.sender] = uint64(block.timestamp);
        }

        // Append on first publish; republish is a no-op against state.
        if (_positions[labelhash] == 0) {
            _published.push(labelhash);
            _positions[labelhash] = _published.length;
        }

        emit Published(
            msg.sender,
            labelNode,
            labelhash,
            uint64(block.timestamp)
        );
    }

    /// @inheritdoc IPublisher
    function unpublish(string calldata label) external {
        (bytes32 labelhash, bytes32 labelNode) = _requireOwnedLabel(label);

        uint256 idxPlusOne = _positions[labelhash];
        if (idxPlusOne != 0) {
            uint256 idx = idxPlusOne - 1;
            uint256 last = _published.length - 1;
            if (idx != last) {
                bytes32 moved = _published[last];
                _published[idx] = moved;
                _positions[moved] = idxPlusOne;
            }
            _published.pop();
            delete _positions[labelhash];
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
        return _positions[labelhash] != 0;
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
    function getPublished(
        uint256 offset,
        uint256 limit
    ) external view returns (bytes32[] memory labelhashes) {
        uint256 total = _published.length;
        if (offset >= total) return new bytes32[](0);
        uint256 available = total - offset;
        uint256 size = limit < available ? limit : available;
        labelhashes = new bytes32[](size);
        for (uint256 i; i < size; ++i) {
            labelhashes[i] = _published[offset + i];
        }
    }

    /// @dev Asserts `msg.sender` owns `<label>.dot` and returns its labelhash and namehash.
    function _requireOwnedLabel(
        string calldata label
    ) internal view returns (bytes32 labelhash, bytes32 labelNode) {
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
}
