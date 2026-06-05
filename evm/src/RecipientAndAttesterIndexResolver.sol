// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { Attestation, IAttestationService } from "./interfaces/IAttestationService.sol";
import { IAttestationResolver } from "./interfaces/IAttestationResolver.sol";

/// @title RecipientAndAttesterIndexResolver
/// @notice Reference resolver maintaining by-(recipient, schema) and by-attester collections.
contract RecipientAndAttesterIndexResolver is IAttestationResolver {
    using EnumerableSet for EnumerableSet.UintSet;

    error RecipientAndAttesterIndexResolver__AccessDenied();
    error RecipientAndAttesterIndexResolver__InvalidService();
    error RecipientAndAttesterIndexResolver__PageSizeTooLarge(uint64 requested, uint64 max);

    uint64 public constant MAX_PAGE_SIZE = 100;

    // The bound attestation service.
    IAttestationService private immutable _service;

    // Attestation IDs grouped by (recipient, schema).
    mapping(bytes32 key => EnumerableSet.UintSet ids)
        private _attestationsByRecipientAndSchema;

    // Attestation IDs grouped by attester.
    mapping(address attester => EnumerableSet.UintSet ids)
        private _attestationsByAttester;

    /// @dev Creates a new RecipientAndAttesterIndexResolver bound to `service`.
    /// @param service The attestation service authorised to invoke the hooks.
    constructor(IAttestationService service) {
        if (address(service) == address(0)) {
            revert RecipientAndAttesterIndexResolver__InvalidService();
        }
        _service = service;
    }

    modifier onlyService() {
        if (msg.sender != address(_service)) {
            revert RecipientAndAttesterIndexResolver__AccessDenied();
        }
        _;
    }

    /// @notice Returns the bound attestation service.
    /// @return The bound attestation service.
    function getService() external view returns (IAttestationService) {
        return _service;
    }

    /// @inheritdoc IAttestationResolver
    function onAttest(Attestation calldata att) external onlyService returns (bool) {
        bytes32 key = _compositeKey(att.recipient, att.schema);
        _attestationsByRecipientAndSchema[key].add(att.id);
        _attestationsByAttester[att.attester].add(att.id);
        return true;
    }

    /// @inheritdoc IAttestationResolver
    function onRevoke(Attestation calldata att) external onlyService returns (bool) {
        bytes32 key = _compositeKey(att.recipient, att.schema);
        _attestationsByRecipientAndSchema[key].remove(att.id);
        _attestationsByAttester[att.attester].remove(att.id);
        return true;
    }

    /// @notice Checks if any of the provided attesters has an active attestation for the recipient and schema.
    /// @dev O(N*M) where N is the (recipient, schema) collection size and M is the attesters list length, with two external calls per entry.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param attesters The attesters to check.
    /// @return Whether at least one attester has an active attestation.
    function isActiveAny(
        address recipient,
        uint256 schema,
        address[] calldata attesters
    ) external view returns (bool) {
        EnumerableSet.UintSet storage collection = _attestationsByRecipientAndSchema[
            _compositeKey(recipient, schema)
        ];
        uint256 collectionLen = collection.length();
        uint256 attestersLen = attesters.length;

        for (uint256 i = 0; i < collectionLen; ++i) {
            uint256 id = collection.at(i);
            if (!_service.isActive(id)) continue;

            Attestation memory att = _service.getAttestationById(id);
            for (uint256 j = 0; j < attestersLen; ++j) {
                if (att.attester == attesters[j]) return true;
            }
        }
        return false;
    }

    /// @notice Returns the number of attestations recorded for the given recipient and schema.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @return The number of attestations.
    function countByRecipientAndSchema(
        address recipient,
        uint256 schema
    ) external view returns (uint256) {
        return _attestationsByRecipientAndSchema[_compositeKey(recipient, schema)].length();
    }

    /// @notice Returns a page of attestation IDs for the given recipient and schema.
    /// @dev Order is not stable across blocks; revocations swap-and-pop.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param offset The starting index.
    /// @param limit The maximum number of IDs to return; MUST NOT exceed MAX_PAGE_SIZE.
    /// @return A page of attestation IDs.
    function listByRecipientAndSchema(
        address recipient,
        uint256 schema,
        uint64 offset,
        uint64 limit
    ) external view returns (uint256[] memory) {
        if (limit > MAX_PAGE_SIZE) {
            revert RecipientAndAttesterIndexResolver__PageSizeTooLarge(limit, MAX_PAGE_SIZE);
        }

        EnumerableSet.UintSet storage collection = _attestationsByRecipientAndSchema[
            _compositeKey(recipient, schema)
        ];
        return _page(collection, offset, limit);
    }

    /// @notice Returns the number of attestations recorded for the given attester.
    /// @param attester The attester address.
    /// @return The number of attestations.
    function countByAttester(address attester) external view returns (uint256) {
        return _attestationsByAttester[attester].length();
    }

    /// @notice Returns a page of attestation IDs for the given attester.
    /// @dev Order is not stable across blocks; revocations swap-and-pop.
    /// @param attester The attester address.
    /// @param offset The starting index.
    /// @param limit The maximum number of IDs to return; MUST NOT exceed MAX_PAGE_SIZE.
    /// @return A page of attestation IDs.
    function listByAttester(
        address attester,
        uint64 offset,
        uint64 limit
    ) external view returns (uint256[] memory) {
        if (limit > MAX_PAGE_SIZE) {
            revert RecipientAndAttesterIndexResolver__PageSizeTooLarge(limit, MAX_PAGE_SIZE);
        }

        return _page(_attestationsByAttester[attester], offset, limit);
    }

    /// @dev Returns the composite key for a (recipient, schema) pair.
    function _compositeKey(
        address recipient,
        uint256 schema
    ) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(recipient, schema));
    }

    /// @dev Returns a page of IDs from `collection`.
    function _page(
        EnumerableSet.UintSet storage collection,
        uint64 offset,
        uint64 limit
    ) private view returns (uint256[] memory) {
        uint256 total = collection.length();
        if (offset >= total) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 resultLen = end - offset;

        uint256[] memory result = new uint256[](resultLen);
        for (uint256 i = 0; i < resultLen; ++i) {
            result[i] = collection.at(offset + i);
        }
        return result;
    }
}
