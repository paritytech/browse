// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { ISchemaRegistry } from "./ISchemaRegistry.sol";
import { ISemver } from "./ISemver.sol";

// A zero expiration represents a non-expiring attestation.
uint64 constant NO_EXPIRATION_TIME = 0;

/// @notice A struct representing a single attestation.
struct Attestation {
    uint256 id; // The ID of the attestation.
    uint256 schema; // The ID of the schema.
    uint64 time; // The time when the attestation was created (Unix timestamp).
    uint64 expirationTime; // The time when the attestation expires (Unix timestamp).
    uint64 revocationTime; // The time when the attestation was revoked (Unix timestamp).
    uint256 refId; // The ID of the related attestation.
    address recipient; // The recipient of the attestation.
    address attester; // The attesting account.
    bool revocable; // Whether the attestation is revocable.
    bytes data; // Custom attestation data.
}

/// @notice A struct representing ECDSA signature data.
struct Signature {
    uint8 v; // The recovery ID.
    bytes32 r; // The x-coordinate of the nonce R.
    bytes32 s; // The signature data.
}

/// @notice A struct representing the arguments of the attestation request.
struct AttestationRequestData {
    address recipient; // The recipient of the attestation.
    uint64 expirationTime; // The time when the attestation expires (Unix timestamp).
    bool revocable; // Whether the attestation is revocable.
    uint256 refId; // The ID of the related attestation.
    bytes data; // Custom attestation data.
}

/// @notice A struct representing the full arguments of the attestation request.
struct AttestationRequest {
    uint256 schema; // The ID of the schema.
    AttestationRequestData data; // The arguments of the attestation request.
}

/// @notice A struct representing the full arguments of the full delegated attestation request.
struct DelegatedAttestationRequest {
    uint256 schema; // The ID of the schema.
    AttestationRequestData data; // The arguments of the attestation request.
    Signature signature; // The ECDSA signature data.
    address attester; // The attesting account.
    uint64 deadline; // The deadline of the signature/request.
}

/// @notice A struct representing the full arguments of the multi attestation request.
struct MultiAttestationRequest {
    uint256 schema; // The ID of the schema.
    AttestationRequestData[] data; // The arguments of the attestation requests.
}

/// @notice A struct representing the full arguments of the delegated multi attestation request.
struct MultiDelegatedAttestationRequest {
    uint256 schema; // The ID of the schema.
    AttestationRequestData[] data; // The arguments of the attestation requests.
    Signature[] signatures; // The ECDSA signatures data.
    address attester; // The attesting account.
    uint64 deadline; // The deadline of the signature/request.
}

/// @notice A struct representing the arguments of the revocation request.
struct RevocationRequestData {
    uint256 id; // The ID of the attestation to revoke.
}

/// @notice A struct representing the full arguments of the revocation request.
struct RevocationRequest {
    uint256 schema; // The ID of the schema.
    RevocationRequestData data; // The arguments of the revocation request.
}

/// @notice A struct representing the arguments of the full delegated revocation request.
struct DelegatedRevocationRequest {
    uint256 schema; // The ID of the schema.
    RevocationRequestData data; // The arguments of the revocation request.
    Signature signature; // The ECDSA signature data.
    address revoker; // The revoking account.
    uint64 deadline; // The deadline of the signature/request.
}

/// @notice A struct representing the full arguments of the multi revocation request.
struct MultiRevocationRequest {
    uint256 schema; // The ID of the schema.
    RevocationRequestData[] data; // The arguments of the revocation requests.
}

/// @notice A struct representing the full arguments of the delegated multi revocation request.
struct MultiDelegatedRevocationRequest {
    uint256 schema; // The ID of the schema.
    RevocationRequestData[] data; // The arguments of the revocation requests.
    Signature[] signatures; // The ECDSA signatures data.
    address revoker; // The revoking account.
    uint64 deadline; // The deadline of the signature/request.
}

/// @title IAttestationService
/// @notice The interface of the global attestation service.
interface IAttestationService is ISemver {
    /// @notice Emitted when an attestation has been made.
    /// @param recipient The recipient of the attestation.
    /// @param attester The attesting account.
    /// @param schema The ID of the schema.
    /// @param id The ID of the new (or overwritten, for unique schemas) attestation.
    /// @dev Fires on both create and unique-schema overwrite paths.
    event Attested(
        address indexed recipient,
        address indexed attester,
        uint256 indexed schema,
        uint256 id
    );

    /// @notice Emitted when an attestation has been revoked.
    /// @param recipient The recipient of the attestation.
    /// @param attester The attesting account.
    /// @param schema The ID of the schema.
    /// @param id The ID of the revoked attestation.
    event Revoked(
        address indexed recipient,
        address indexed attester,
        uint256 indexed schema,
        uint256 id
    );

    /// @notice Emitted when data has been timestamped.
    /// @param data The data.
    /// @param timestamp The timestamp.
    event Timestamped(bytes32 indexed data, uint64 indexed timestamp);

    /// @notice Emitted when data has been revoked off-chain.
    /// @param revoker The revoking account.
    /// @param data The data.
    /// @param timestamp The timestamp.
    event RevokedOffchain(
        address indexed revoker,
        bytes32 indexed data,
        uint64 indexed timestamp
    );

    error AttestationService__AccessDenied();
    error AttestationService__AlreadyRevoked();
    error AttestationService__AlreadyRevokedOffchain();
    error AttestationService__AlreadyTimestamped();
    error AttestationService__InvalidExpirationTime();
    error AttestationService__InvalidLength();
    error AttestationService__InvalidRegistry();
    error AttestationService__InvalidSchema();
    error AttestationService__Irrevocable();
    error AttestationService__NotFound();
    error AttestationService__ResolverRejected();
    error AttestationService__RevocableMismatch();
    error AttestationService__WrongSchema();

    /// @notice Returns the address of the global schema registry.
    /// @return The address of the global schema registry.
    function getSchemaRegistry() external view returns (ISchemaRegistry);

    /// @notice Attests to a specific schema.
    /// @param request The arguments of the attestation request.
    /// @return The ID of the new attestation.
    function attest(AttestationRequest calldata request) external returns (uint256);

    /// @notice Attests to a specific schema via the provided ECDSA signature.
    /// @param delegatedRequest The arguments of the delegated attestation request.
    /// @return The ID of the new attestation.
    function attestByDelegation(
        DelegatedAttestationRequest calldata delegatedRequest
    ) external returns (uint256);

    /// @notice Attests to multiple schemas.
    /// @param multiRequests The arguments of the multi attestation requests.
    /// @return The IDs of the new attestations.
    function multiAttest(
        MultiAttestationRequest[] calldata multiRequests
    ) external returns (uint256[] memory);

    /// @notice Attests to multiple schemas via the provided ECDSA signatures.
    /// @param multiDelegatedRequests The arguments of the delegated multi attestation requests.
    /// @return The IDs of the new attestations.
    function multiAttestByDelegation(
        MultiDelegatedAttestationRequest[] calldata multiDelegatedRequests
    ) external returns (uint256[] memory);

    /// @notice Revokes an existing attestation.
    /// @param request The arguments of the revocation request.
    function revoke(RevocationRequest calldata request) external;

    /// @notice Revokes an existing attestation via the provided ECDSA signature.
    /// @param delegatedRequest The arguments of the delegated revocation request.
    function revokeByDelegation(
        DelegatedRevocationRequest calldata delegatedRequest
    ) external;

    /// @notice Revokes multiple existing attestations.
    /// @param multiRequests The arguments of the multi revocation requests.
    function multiRevoke(MultiRevocationRequest[] calldata multiRequests) external;

    /// @notice Revokes multiple existing attestations via the provided ECDSA signatures.
    /// @param multiDelegatedRequests The arguments of the delegated multi revocation requests.
    function multiRevokeByDelegation(
        MultiDelegatedRevocationRequest[] calldata multiDelegatedRequests
    ) external;

    /// @notice Timestamps the specified data.
    /// @param data The data to timestamp.
    /// @return The timestamp.
    function timestamp(bytes32 data) external returns (uint64);

    /// @notice Timestamps multiple data items.
    /// @param data The data to timestamp.
    /// @return The shared timestamp.
    function multiTimestamp(bytes32[] calldata data) external returns (uint64);

    /// @notice Revokes the specified data off-chain.
    /// @param data The data to revoke.
    /// @return The revocation timestamp.
    function revokeOffchain(bytes32 data) external returns (uint64);

    /// @notice Revokes multiple data items off-chain.
    /// @param data The data to revoke.
    /// @return The shared revocation timestamp.
    function multiRevokeOffchain(bytes32[] calldata data) external returns (uint64);

    /// @notice Returns an existing attestation by ID.
    /// @param id The ID of the attestation.
    /// @return The attestation record.
    function getAttestationById(uint256 id) external view returns (Attestation memory);

    /// @notice Returns multiple attestations by ID.
    /// @param ids The IDs of the attestations.
    /// @return The attestation records (zero-valued for unknown IDs).
    function getAttestationByIds(uint256[] calldata ids)
        external
        view
        returns (Attestation[] memory);

    /// @notice Checks whether an attestation exists.
    /// @param id The ID of the attestation.
    /// @return Whether the attestation exists.
    function isAttestationValid(uint256 id) external view returns (bool);

    /// @notice Checks whether an attestation is active (exists, not revoked, not expired).
    /// @param id The ID of the attestation.
    /// @return Whether the attestation is active.
    function isActive(uint256 id) external view returns (bool);

    /// @notice Returns the total number of attestations that have been made.
    /// @return The attestation count.
    function attestationCount() external view returns (uint256);

    /// @notice Returns the timestamp recorded for the specified data.
    /// @param data The data.
    /// @return The timestamp, or zero if never timestamped.
    function getTimestamp(bytes32 data) external view returns (uint64);

    /// @notice Returns the off-chain revocation timestamp recorded for the specified (revoker, data) pair.
    /// @param revoker The revoking account.
    /// @param data The data.
    /// @return The revocation timestamp, or zero if never revoked.
    function getRevokeOffchain(address revoker, bytes32 data) external view returns (uint64);
}
