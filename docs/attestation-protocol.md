# Attestation Protocol Specification

| Field  | Value         |
|--------|---------------|
| Status | Draft         |
| Author | Tiago Tavares |
| Date   | 2026-04-01    |

## Summary

This specification defines how users make verifiable claims about applications in browse.dot. Any account can vouch for an app, rate it, or assert any property defined by a schema. Claims are publicly readable by any client.

The primary use case is **social discovery**: a user maintains a private list of contacts whose opinions they trust. The app surfaces which apps those contacts have vouched for — without revealing who the contacts are or who follows whom.

## Motivation

Curation by trusted authorities tells users which apps have passed a formal review. Public reputation signals (total ratings, aggregate scores) tell users what the crowd thinks. Neither answers the question most users actually have: **what do people I trust think of this app?**

Without a shared attestation registry, every client builds its own reputation layer — inconsistent, non-interoperable, and not portable across hosts. By defining a single general-purpose registry:

- **Interoperability**: Any product on browse.dot can read the same claims. Trust earned in one client is visible in all others.
- **Extensibility**: New claim types are added by defining a new schema string. No new contract deployment is needed.
- **Private social trust**: A user's contacts list is never published. The connection between a user and whose opinions they value remains private.

## Specification

### Dispatchable Functions

```rust
/// Record a claim about `subject` under `schema`.
///
/// Only one attestation per `(subject, schema, caller)` triple may exist
/// at a time. Submitting a second attestation for the same triple overwrites
/// the first.
///
/// `expiry` is a unix timestamp after which the attestation is considered
/// expired. Pass 0 for no expiry.
///
/// Fails with `ZeroAddress` if `subject` is the zero address, or
/// `ZeroSchema` if `schema` is zero.
///
/// Caller: any account
fn attest(subject: address, schema: bytes32, value: bytes32, expiry: u64);

/// Revoke an existing attestation.
///
/// The record is retained on-chain with `revoked = true` so that the
/// revocation is itself auditable.
///
/// Caller: original attester only
fn revoke(subject: address, schema: bytes32);

/// Return a single attestation record.
///
/// Returns a zeroed struct if the attestation does not exist.
///
/// Caller: any (read-only)
fn get(subject: address, schema: bytes32, attester: address) -> Attestation;

/// Return true if `attester` has a valid, non-revoked, non-expired
/// attestation for `subject` under `schema`.
///
/// Caller: any (read-only)
fn is_valid(subject: address, schema: bytes32, attester: address) -> bool;

/// Return true if any address in `attesters` has a valid, non-revoked,
/// non-expired attestation for `subject` under `schema`.
///
/// This is the core query for the contacts feed: given a subject and a
/// list of contacts, determine whether any of them have vouched for it.
///
/// Caller: any (read-only)
fn is_valid_any(subject: address, schema: bytes32, attesters: Vec<address>) -> bool;

/// Return full attestation records for a batch of keys in a single call.
///
/// Fails with `BatchTooLarge` if `keys.length` exceeds `MAX_BATCH_SIZE`.
///
/// Caller: any (read-only)
fn get_batch(keys: Vec<AttestationKey>) -> Vec<Attestation>;

/// Return the total number of attestation keys for `subject` (across all schemas).
///
/// Includes revoked and expired attestations in the count, since the
/// reverse index is append-only.
///
/// Caller: any (read-only)
fn count(subject: address) -> u64;

/// Return a paginated list of attestation keys for `subject`.
///
/// Keys are returned in insertion order. Fails with `PageSizeTooLarge`
/// if `limit` exceeds `MAX_PAGE_SIZE`.
///
/// Caller: any (read-only)
fn list(subject: address, offset: u64, limit: u64) -> Vec<AttestationKey>;

/// Return the total number of attestation keys created by `attester`.
///
/// Caller: any (read-only)
fn count_by_attester(attester: address) -> u64;

/// Return a paginated list of attestation keys created by `attester`.
///
/// Keys are returned in insertion order. Fails with `PageSizeTooLarge`
/// if `limit` exceeds `MAX_PAGE_SIZE`.
///
/// Caller: any (read-only)
fn list_by_attester(attester: address, offset: u64, limit: u64) -> Vec<AttestationKey>;
```

### Data Structures

```rust
/// A composite key that uniquely identifies one attestation.
struct AttestationKey {
    subject:  address,
    schema:   bytes32,
    attester: address,
}

/// A full attestation record as returned by `get` and `get_batch`.
struct Attestation {
    subject:   address,
    schema:    bytes32,
    attester:  address,
    timestamp: u64,
    expiry:    u64,
    value:     bytes32,
    revoked:   bool,
}
```

### Constants

```rust
const MAX_PAGE_SIZE: u64 = 100;
const MAX_BATCH_SIZE: u64 = 100;
```

### Errors

```rust
/// Subject address must not be zero.
error ZeroAddress();

/// Schema must not be zero.
error ZeroSchema();

/// The attestation does not exist.
error AttestationNotFound();

/// Batch size exceeds MAX_BATCH_SIZE.
error BatchTooLarge(actual: u64, max: u64);

/// Page size exceeds MAX_PAGE_SIZE.
error PageSizeTooLarge(actual: u64, max: u64);
```

### Events

```rust
/// Emitted when an attestation is created or overwritten.
event AttestationCreated {
    subject:   address,
    schema:    bytes32,
    attester:  address,
    value:     bytes32,
    expiry:    u64,
    timestamp: u64,
}

/// Emitted when an attestation is revoked.
event AttestationRevoked {
    subject:   address,
    schema:    bytes32,
    attester:  address,
    timestamp: u64,
}
```

### Social Discovery via Private Contacts

A user maintains a **contacts list** — a private, client-held set of EVM addresses of people they choose to follow. The contacts list is never published on-chain.

Because the contacts list remains local, no third party can determine whose opinions a user values. Attestations are public, but the link between a user and whose opinions they follow is never exposed.

#### Computing the contacts feed

Given a contacts list `C = [c₁, c₂, ..., cₙ]`, the client computes the feed as follows:

1. For each contact `cᵢ`, call `list_by_attester(cᵢ, 0, MAX_PAGE_SIZE)` to retrieve all attestation keys they have created. Paginate if necessary.
2. Call `get_batch` with the collected keys to retrieve full attestation records.
3. Discard any attestations where `revoked = true` or `expiry > 0 && expiry < now`.
4. Group the remaining attestations by `subject`. Each group represents one app and the set of contacts that vouched for it.
5. Rank apps by the number of contacts that vouched (descending), breaking ties by the most recent `timestamp`.

For a quick check on a single app, `is_valid_any(subject, schema, contacts)` answers in one call whether any contact has vouched for it.

## Out of Scope

- **Schema registry**: Schemas are identified by their keccak256 hash. There is no on-chain registry of schema strings; clients must know the schema string to derive the hash.
- **Review content storage**: Attestation values may include a pointer to off-chain IPFS content. Pinning and retrieval are outside this protocol's scope.
- **Identity verification**: Attesters are identified by their EVM address only. No KYC or identity binding is defined here.
