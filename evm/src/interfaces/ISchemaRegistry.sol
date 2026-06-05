// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import { ISemver } from "./ISemver.sol";

/// @notice A struct representing a record for a submitted schema.
struct SchemaRecord {
    uint256 id; // The ID of the schema.
    address registerer; // The address that registered the schema.
    address resolver; // The optional resolver invoked on attest and revoke.
    bool revocable; // Whether the schema allows revocations explicitly.
    bool unique; // Whether duplicate attestations are rejected per (attester, recipient, schema).
    string schema; // The schema specification.
}

/// @title ISchemaRegistry
/// @notice The interface of the global attestation schema registry.
interface ISchemaRegistry is ISemver {
    /// @notice Emitted when a new schema has been registered.
    /// @param id The ID of the new schema.
    /// @param registerer The account that registered the schema.
    /// @param schema The schema record.
    event Registered(uint256 indexed id, address indexed registerer, SchemaRecord schema);

    error SchemaRegistry__EmptySchema();
    error SchemaRegistry__SchemaNotFound(uint256 id);

    /// @notice Submits and reserves a new schema.
    /// @param schema The schema specification.
    /// @param revocable Whether the schema allows revocations explicitly.
    /// @param unique Whether duplicate attestations are rejected per (attester, recipient, schema).
    /// @param resolver The optional resolver to invoke on attest and revoke.
    /// @return The ID of the new schema.
    function register(
        string calldata schema,
        bool revocable,
        bool unique,
        address resolver
    ) external returns (uint256);

    /// @notice Returns an existing schema by ID.
    /// @param id The ID of the schema.
    /// @return The schema record.
    function getSchema(uint256 id) external view returns (SchemaRecord memory);

    /// @notice Returns the total number of registered schemas.
    /// @return The schema count.
    function schemaCount() external view returns (uint256);
}
