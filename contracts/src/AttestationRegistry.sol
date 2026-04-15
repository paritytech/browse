// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import "./interfaces/IAttestationRegistry.sol";

/// @title AttestationRegistry
/// @notice Permissionless registry for verified claims about addresses
/// @dev Triple-keyed: (subject, schema, attester). On-chain reverse indexes for enumeration.
contract AttestationRegistry is IAttestationRegistry {
    /// @dev Internal storage struct (no subject/schema/attester — implicit from mapping keys)
    struct StoredAttestation {
        uint64 timestamp;
        uint64 expiry;
        bytes32 value;
        bool revoked;
    }

    /// @dev Triple-nested mapping: subject → schema → attester → attestation
    mapping(address => mapping(bytes32 => mapping(address => StoredAttestation))) private attestations;

    // Reverse indexes - append-only (revoked/expired attestations stay indexed)
    mapping(address => IAttestationRegistry.AttestationKey[]) private _subjectIndex;
    mapping(address => IAttestationRegistry.AttestationKey[]) private _attesterIndex;
    // Dedup flag - prevents double-counting on overwrite/re-attest
    mapping(address => mapping(bytes32 => mapping(address => bool))) private _indexed;

    uint64 public constant MAX_PAGE_SIZE = 100;
    uint256 public constant MAX_BATCH_SIZE = 100;

    /// @inheritdoc IAttestationRegistry
    function attest(address subject, bytes32 schema, bytes32 value, uint64 expiry) external {
        if (subject == address(0)) revert ZeroAddress();
        if (schema == bytes32(0)) revert ZeroSchema();

        attestations[subject][schema][msg.sender] = StoredAttestation({
            timestamp: uint64(block.timestamp),
            expiry: expiry,
            value: value,
            revoked: false
        });

        // Add to reverse indexes if this is the first attestation for this triple
        if (!_indexed[subject][schema][msg.sender]) {
            _subjectIndex[subject].push(IAttestationRegistry.AttestationKey(subject, schema, msg.sender));
            _attesterIndex[msg.sender].push(IAttestationRegistry.AttestationKey(subject, schema, msg.sender));
            _indexed[subject][schema][msg.sender] = true;
        }

        emit AttestationCreated(subject, schema, msg.sender, value, expiry, uint64(block.timestamp));
    }

    /// @inheritdoc IAttestationRegistry
    function revoke(address subject, bytes32 schema) external {
        StoredAttestation storage att = attestations[subject][schema][msg.sender];
        if (att.timestamp == 0) revert AttestationNotFound();

        att.revoked = true;

        emit AttestationRevoked(subject, schema, msg.sender, uint64(block.timestamp));
    }

    /// @inheritdoc IAttestationRegistry
    function get(address subject, bytes32 schema, address attester)
        external
        view
        returns (Attestation memory)
    {
        StoredAttestation storage att = attestations[subject][schema][attester];
        if (att.timestamp == 0) {
            return Attestation(address(0), bytes32(0), address(0), 0, 0, bytes32(0), false);
        }
        return Attestation(subject, schema, attester, att.timestamp, att.expiry, att.value, att.revoked);
    }

    /// @inheritdoc IAttestationRegistry
    function isValid(address subject, bytes32 schema, address attester)
        external
        view
        returns (bool)
    {
        StoredAttestation storage att = attestations[subject][schema][attester];
        if (att.timestamp == 0) return false;
        if (att.revoked) return false;
        if (att.expiry != 0 && block.timestamp > att.expiry) return false;
        return true;
    }

    /// @inheritdoc IAttestationRegistry
    function isValidAny(address subject, bytes32 schema, address[] calldata attesters)
        external
        view
        returns (bool)
    {
        for (uint256 i = 0; i < attesters.length; i++) {
            StoredAttestation storage att = attestations[subject][schema][attesters[i]];
            if (att.timestamp == 0) continue;
            if (att.revoked) continue;
            if (att.expiry != 0 && block.timestamp > att.expiry) continue;
            return true;
        }
        return false;
    }

    /// @inheritdoc IAttestationRegistry
    function getBatch(AttestationKey[] calldata keys)
        external
        view
        returns (Attestation[] memory)
    {
        if (keys.length > MAX_BATCH_SIZE) {
            revert BatchTooLarge(keys.length, MAX_BATCH_SIZE);
        }

        Attestation[] memory results = new Attestation[](keys.length);
        for (uint256 i = 0; i < keys.length; i++) {
            StoredAttestation storage att = attestations[keys[i].subject][keys[i].schema][keys[i].attester];
            if (att.timestamp == 0) {
                results[i] = Attestation(address(0), bytes32(0), address(0), 0, 0, bytes32(0), false);
            } else {
                results[i] = Attestation(
                    keys[i].subject,
                    keys[i].schema,
                    keys[i].attester,
                    att.timestamp,
                    att.expiry,
                    att.value,
                    att.revoked
                );
            }
        }
        return results;
    }

    /// @inheritdoc IAttestationRegistry
    function count(address subject) external view returns (uint64) {
        return uint64(_subjectIndex[subject].length);
    }

    /// @inheritdoc IAttestationRegistry
    function list(address subject, uint64 offset, uint64 limit)
        external
        view
        returns (AttestationKey[] memory)
    {
        if (limit > MAX_PAGE_SIZE) {
            revert PageSizeTooLarge(limit, MAX_PAGE_SIZE);
        }

        uint64 total = uint64(_subjectIndex[subject].length);
        if (offset >= total) return new AttestationKey[](0);

        uint64 end = offset + limit;
        if (end > total) end = total;
        uint64 resultLen = end - offset;

        AttestationKey[] memory result = new AttestationKey[](resultLen);
        for (uint64 i = 0; i < resultLen; i++) {
            result[i] = _subjectIndex[subject][offset + i];
        }
        return result;
    }

    /// @inheritdoc IAttestationRegistry
    function countByAttester(address attester) external view returns (uint64) {
        return uint64(_attesterIndex[attester].length);
    }

    /// @inheritdoc IAttestationRegistry
    function listByAttester(address attester, uint64 offset, uint64 limit)
        external
        view
        returns (AttestationKey[] memory)
    {
        if (limit > MAX_PAGE_SIZE) {
            revert PageSizeTooLarge(limit, MAX_PAGE_SIZE);
        }

        uint64 total = uint64(_attesterIndex[attester].length);
        if (offset >= total) return new AttestationKey[](0);

        uint64 end = offset + limit;
        if (end > total) end = total;
        uint64 resultLen = end - offset;

        AttestationKey[] memory result = new AttestationKey[](resultLen);
        for (uint64 i = 0; i < resultLen; i++) {
            result[i] = _attesterIndex[attester][offset + i];
        }
        return result;
    }
}
