// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { EnumerableSet } from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import { Attestation, IAttestationService } from "./interfaces/IAttestationService.sol";
import { IAttestationResolver } from "./interfaces/IAttestationResolver.sol";

/// @title TrustedAttesterIndexResolver
/// @notice Resolver admitting a single trusted attester, indexing certified recipients by schema.
contract TrustedAttesterIndexResolver is IAttestationResolver {
    using EnumerableSet for EnumerableSet.AddressSet;

    error TrustedAttesterIndexResolver__AccessDenied();
    error TrustedAttesterIndexResolver__InvalidService();
    error TrustedAttesterIndexResolver__InvalidAttester();
    error TrustedAttesterIndexResolver__PageSizeTooLarge(uint64 requested, uint64 max);

    uint64 public constant MAX_PAGE_SIZE = 100;

    // The bound attestation service.
    IAttestationService private immutable _service;

    // The sole attester whose attestations this resolver admits.
    address private immutable _trustedAttester;

    // Recipients attested by the trusted attester, grouped by schema.
    mapping(uint256 schema => EnumerableSet.AddressSet recipients)
        private _attestedBySchema;

    /// @dev Creates a new TrustedAttesterIndexResolver.
    /// @param service The attestation service authorised to invoke the hooks and backing isActive.
    /// @param trustedAttester_ The sole attester whose attestations are admitted.
    constructor(IAttestationService service, address trustedAttester_) {
        if (address(service) == address(0)) {
            revert TrustedAttesterIndexResolver__InvalidService();
        }
        if (trustedAttester_ == address(0)) {
            revert TrustedAttesterIndexResolver__InvalidAttester();
        }
        _service = service;
        _trustedAttester = trustedAttester_;
    }

    modifier onlyService() {
        if (msg.sender != address(_service)) {
            revert TrustedAttesterIndexResolver__AccessDenied();
        }
        _;
    }

    /// @notice Returns the bound attestation service.
    /// @return The bound attestation service.
    function getService() external view returns (IAttestationService) {
        return _service;
    }

    /// @notice Returns the sole trusted attester.
    /// @return The trusted attester.
    function trustedAttester() external view returns (address) {
        return _trustedAttester;
    }

    /// @inheritdoc IAttestationResolver
    /// @dev Returns false for any attester other than the trusted one, which makes the service
    ///      reject the attestation. Admitted recipients are recorded in the per-schema set.
    function onAttest(Attestation calldata att) external onlyService returns (bool) {
        if (att.attester != _trustedAttester) return false;
        _attestedBySchema[att.schema].add(att.recipient);
        return true;
    }

    /// @inheritdoc IAttestationResolver
    function onRevoke(Attestation calldata att) external onlyService returns (bool) {
        _attestedBySchema[att.schema].remove(att.recipient);
        return true;
    }

    /// @notice Checks whether the recipient holds an active attestation from the trusted attester for the schema.
    /// @dev Assumes a unique schema, whose attestation lives at the deterministic slot
    ///      keccak256(attester, recipient, schema). Recomputes that slot and forwards to the service
    ///      in O(1); no enumeration. Active means existing, not revoked, and not expired.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @return Whether the recipient holds an active attestation.
    function isActive(address recipient, uint256 schema) external view returns (bool) {
        uint256 id = uint256(
            keccak256(abi.encodePacked(_trustedAttester, recipient, schema))
        );
        return _service.isActive(id);
    }

    /// @notice Returns the number of recipients recorded as certified for the schema.
    /// @dev Counts recipients with a non-revoked certification; expired-but-unrevoked ones remain.
    ///      Use isActive to confirm a recipient is currently active.
    /// @param schema The schema ID.
    /// @return The number of certified recipients.
    function countBySchema(uint256 schema) external view returns (uint256) {
        return _attestedBySchema[schema].length();
    }

    /// @notice Returns a page of recipients recorded as certified for the schema.
    /// @dev Order is not stable across blocks; revocations swap-and-pop. Includes expired-but-unrevoked
    ///      recipients; pair with isActive to filter to the currently active set.
    /// @param schema The schema ID.
    /// @param offset The starting index.
    /// @param limit The maximum number of recipients to return; MUST NOT exceed MAX_PAGE_SIZE.
    /// @return A page of certified recipient addresses.
    function listBySchema(
        uint256 schema,
        uint64 offset,
        uint64 limit
    ) external view returns (address[] memory) {
        if (limit > MAX_PAGE_SIZE) {
            revert TrustedAttesterIndexResolver__PageSizeTooLarge(limit, MAX_PAGE_SIZE);
        }

        EnumerableSet.AddressSet storage recipients = _attestedBySchema[schema];
        uint256 total = recipients.length();
        if (offset >= total) return new address[](0);

        uint256 end = offset + limit;
        if (end > total) end = total;
        uint256 resultLen = end - offset;

        address[] memory result = new address[](resultLen);
        for (uint256 i = 0; i < resultLen; ++i) {
            result[i] = recipients.at(offset + i);
        }
        return result;
    }
}
