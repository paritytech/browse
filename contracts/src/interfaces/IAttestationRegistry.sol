// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

/**
 * @title IAttestationRegistry
 * @notice Permissionless registry for verified claims about addresses
 * @dev Triple-keyed: (subject, schema, attester). Any address can attest about any subject.
 *      Trust is determined by the reader, not the registry — apps choose which attesters to trust.
 *      On-chain reverse indexes allow enumeration by subject or attester.
 */
interface IAttestationRegistry {
    // ============ Structs ============

    struct Attestation {
        address subject;   // Who the attestation is about
        bytes32 schema;    // What type of claim (e.g., keccak256("kyc.level1"))
        address attester;  // Who made the attestation (msg.sender of attest())
        uint64 timestamp;  // When attested (0 = doesn't exist)
        uint64 expiry;     // When it expires (0 = never expires)
        bytes32 value;     // Attestation data (hash, CID, packed data, etc.)
        bool revoked;      // True if attester revoked it
    }

    /// @dev Identifies an attestation triple. Used in reverse indexes and batch queries.
    struct AttestationKey {
        address subject;
        bytes32 schema;
        address attester;
    }

    // ============ Events ============

    /// @notice Emitted when an attestation is created or updated (overwritten)
    event AttestationCreated(
        address indexed subject,
        bytes32 indexed schema,
        address indexed attester,
        bytes32 value,
        uint64 expiry,
        uint64 timestamp
    );

    /// @notice Emitted when an attestation is revoked
    event AttestationRevoked(
        address indexed subject,
        bytes32 indexed schema,
        address indexed attester,
        uint64 timestamp
    );

    // ============ Errors ============

    /// @notice Attestation does not exist for the given (subject, schema, attester) triple
    error AttestationNotFound();

    /// @notice Subject address is zero
    error ZeroAddress();

    /// @notice Schema is bytes32(0)
    error ZeroSchema();

    /// @notice Batch size exceeds maximum
    error BatchTooLarge(uint256 requested, uint256 max);

    /// @notice Page size exceeds maximum
    error PageSizeTooLarge(uint64 requested, uint64 max);

    // ============ Functions ============

    /**
     * @notice Make an attestation about a subject
     * @param subject The address being attested about
     * @param schema The attestation type (e.g., keccak256("kyc.level1"))
     * @param value The attestation data (typically a hash: keccak256, IPFS CID, etc.)
     * @param expiry When the attestation expires (0 = never expires)
     * @dev Caller is recorded as the attester. Calling attest() again for the same
     *      (subject, schema) pair overwrites the previous attestation and resets revoked to false.
     *      First attestation for a triple is added to subject and attester reverse indexes.
     */
    function attest(address subject, bytes32 schema, bytes32 value, uint64 expiry) external;

    /**
     * @notice Revoke an attestation (attester only)
     * @param subject The address whose attestation to revoke
     * @param schema The attestation type
     * @dev Only the original attester (msg.sender who created it) can revoke.
     *      Sets revoked=true but preserves all other fields for audit trail.
     *      The attestation remains in reverse indexes after revocation.
     */
    function revoke(address subject, bytes32 schema) external;

    /**
     * @notice Get an attestation
     * @param subject The address being attested about
     * @param schema The attestation type
     * @param attester The attester address
     * @return The attestation struct (timestamp == 0 if doesn't exist)
     */
    function get(address subject, bytes32 schema, address attester)
        external
        view
        returns (Attestation memory);

    /**
     * @notice Check if an attestation is valid (exists, not revoked, not expired)
     * @param subject The address being attested about
     * @param schema The attestation type
     * @param attester The attester address
     * @return True if the attestation exists AND is not revoked AND is not expired
     */
    function isValid(address subject, bytes32 schema, address attester)
        external
        view
        returns (bool);

    /**
     * @notice Check if ANY of the provided attesters has a valid attestation
     * @param subject The address being attested about
     * @param schema The attestation type
     * @param attesters Array of attester addresses to check
     * @return True if at least one attester has a valid (exists, not revoked, not expired) attestation
     * @dev Short-circuits on first valid match for gas efficiency.
     *      Use case: "does subject have a valid KYC from any of our trusted providers?"
     */
    function isValidAny(address subject, bytes32 schema, address[] calldata attesters)
        external
        view
        returns (bool);

    /**
     * @notice Batch get multiple attestations in one call
     * @param keys Array of attestation keys to look up
     * @return Array of Attestation structs (zeros for non-existent entries)
     * @dev Reverts if keys.length exceeds MAX_BATCH_SIZE (100).
     */
    function getBatch(AttestationKey[] calldata keys)
        external
        view
        returns (Attestation[] memory);

    /**
     * @notice Count unique attestation triples for a subject
     * @param subject The address to count attestations for
     * @return Number of unique (subject, schema, attester) triples ever created for this subject
     * @dev Includes revoked and expired attestations. Use isValid() to check current status.
     */
    function count(address subject) external view returns (uint64);

    /**
     * @notice List attestation keys for a subject (includes revoked/expired)
     * @param subject The address to list attestations for
     * @param offset Starting index in the subject's attestation list
     * @param limit Maximum number of keys to return
     * @return Array of AttestationKey structs
     * @dev Returns all attestation triples ever created for this subject.
     *      Use isValid() or get() to check current validity status.
     *      Reverts if limit exceeds MAX_PAGE_SIZE (100).
     */
    function list(address subject, uint64 offset, uint64 limit)
        external
        view
        returns (AttestationKey[] memory);

    /**
     * @notice Count unique attestation triples by an attester
     * @param attester The attester address to count attestations for
     * @return Number of unique (subject, schema, attester) triples ever created by this attester
     * @dev Includes revoked and expired attestations.
     */
    function countByAttester(address attester) external view returns (uint64);

    /**
     * @notice List attestation keys by an attester (includes revoked/expired)
     * @param attester The attester address to list attestations for
     * @param offset Starting index in the attester's attestation list
     * @param limit Maximum number of keys to return
     * @return Array of AttestationKey structs
     * @dev Returns all attestation triples ever created by this attester.
     *      Use isValid() or get() to check current validity status.
     *      Reverts if limit exceeds MAX_PAGE_SIZE (100).
     */
    function listByAttester(address attester, uint64 offset, uint64 limit)
        external
        view
        returns (AttestationKey[] memory);
}
