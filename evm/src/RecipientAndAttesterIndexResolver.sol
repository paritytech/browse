// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {Attestation, IAttestationService} from "./interfaces/IAttestationService.sol";
import {IAttestationResolver} from "./interfaces/IAttestationResolver.sol";
import {IPersonhood} from "./interfaces/IPersonhood.sol";
import {ISystem} from "./interfaces/ISystem.sol";

/// @title RecipientAndAttesterIndexResolver
/// @notice Indexes attestations by (recipient, schema) and by attester, admitting only
///         attestations from a product account bound to a verified human identity.
contract RecipientAndAttesterIndexResolver is IAttestationResolver {
    using EnumerableSet for EnumerableSet.UintSet;

    error RecipientAndAttesterIndexResolver__AccessDenied();
    error RecipientAndAttesterIndexResolver__InvalidService();
    error RecipientAndAttesterIndexResolver__InvalidIdentitySignature();
    error RecipientAndAttesterIndexResolver__PageSizeTooLarge(
        uint64 requested,
        uint64 max
    );

    /// @notice Emitted when a product account is bound to an identity account.
    /// @param account The product account that submits attestations.
    /// @param identity The identity account (mapped sr25519 address) it is bound to.
    event IdentityAccountBound(
        address indexed account,
        address indexed identity
    );

    uint64 public constant MAX_PAGE_SIZE = 100;

    // The System precompile exposing sr25519Verify.
    ISystem private constant SYSTEM =
        ISystem(0x0000000000000000000000000000000000000900);

    // The humanity precompile backed by the alias-accounts pallet.
    IPersonhood private constant HUMANITY =
        IPersonhood(0x000000000000000000000000000000000a010000);

    // The lowest humanity tier admitted. 1 is Lite, 2 is Full.
    uint8 public constant MIN_HUMANITY_STATUS = 1;

    // The application context for humanity and alias derivation, shared with Publisher so the
    // same person resolves to one alias namespace across publishing and recommending.
    bytes32 public constant HUMANITY_CONTEXT = bytes32("dotns");

    // Domain tag prepended to the identity-binding message so a signature cannot be replayed
    // against a different message shape. The per-deployment binding comes from address(this) and
    // block.chainid in the message body.
    bytes private constant MESSAGE_PREFIX = "attestation v1\n";

    // The bound attestation service.
    IAttestationService private immutable _service;

    // The identity account each product account proved control of via bindIdentity.
    mapping(address account => address identity) private _boundIdentity;

    // Attestation IDs grouped by (recipient, schema).
    mapping(bytes32 key => EnumerableSet.UintSet ids)
        private _attestationsByRecipientAndSchema;

    // Attestation IDs grouped by attester.
    mapping(address attester => EnumerableSet.UintSet ids)
        private _attestationsByAttester;

    // Whether a person (context alias) has already attested a given (recipient, schema).
    mapping(bytes32 key => mapping(bytes32 personAlias => bool used))
        private _aliasAttested;

    // The context alias recorded for an attestation, so a revoke can release the alias lock.
    mapping(uint256 id => bytes32 personAlias) private _aliasByAttestation;

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

    /// @notice Binds the calling product account to the identity account that signed for it.
    /// @dev The identity key signs a message binding this resolver, the chain, and the caller, so
    ///      the signature cannot authorize a different account or be replayed on another
    ///      deployment. Verifying the sr25519 signature once here keeps that cost off the
    ///      per-attestation path. Re-binding overwrites the previous identity. Humanity is not
    ///      checked here. The onAttest hook enforces it so a later loss of personhood takes effect.
    /// @param pubKey The sr25519 public key (AccountId32) of the identity account.
    /// @param signature The 64-byte signature over the binding message.
    function bindIdentity(bytes32 pubKey, bytes calldata signature) external {
        if (signature.length != 64) {
            revert RecipientAndAttesterIndexResolver__InvalidIdentitySignature();
        }
        uint8[64] memory sig = _toFixedSignature(signature);
        bytes memory inner = _bindingMessage(msg.sender);
        // Accept a signature over either the wrapped or the bare message.
        bool ok = SYSTEM.sr25519Verify(sig, _wrapBytes(inner), pubKey) ||
            SYSTEM.sr25519Verify(sig, inner, pubKey);
        if (!ok) {
            revert RecipientAndAttesterIndexResolver__InvalidIdentitySignature();
        }
        // A native sr25519 account maps to keccak256(publicKey)[12..].
        address identity = address(
            uint160(uint256(keccak256(abi.encodePacked(pubKey))))
        );
        _boundIdentity[msg.sender] = identity;
        emit IdentityAccountBound(msg.sender, identity);
    }

    /// @notice Returns the bound attestation service.
    /// @return The bound attestation service.
    function getService() external view returns (IAttestationService) {
        return _service;
    }

    /// @notice Returns the identity account a product account is bound to.
    /// @param account The product account.
    /// @return The bound identity account, or the zero address when unbound.
    function boundIdentity(address account) external view returns (address) {
        return _boundIdentity[account];
    }

    /// @inheritdoc IAttestationResolver
    /// @dev Admits the attestation only when its attester is bound to an identity that still holds
    ///      humanity and whose person has not already attested this (recipient, schema). Returns
    ///      false on any failure so the service rejects it.
    function onAttest(
        Attestation calldata attestation
    ) external onlyService returns (bool) {
        address identity = _boundIdentity[attestation.attester];
        if (identity == address(0)) return false;

        bytes32 personAlias = _humanityAlias(identity);
        if (personAlias == bytes32(0)) return false;

        bytes32 key = _compositeKey(attestation.recipient, attestation.schema);
        if (_aliasAttested[key][personAlias]) return false;

        _aliasAttested[key][personAlias] = true;
        _aliasByAttestation[attestation.id] = personAlias;
        _attestationsByRecipientAndSchema[key].add(attestation.id);
        _attestationsByAttester[attestation.attester].add(attestation.id);
        return true;
    }

    /// @inheritdoc IAttestationResolver
    /// @dev Releases the person's alias lock for the (recipient, schema) so they may attest it
    ///      again later, then de-indexes the attestation.
    function onRevoke(
        Attestation calldata attestation
    ) external onlyService returns (bool) {
        bytes32 key = _compositeKey(attestation.recipient, attestation.schema);
        bytes32 personAlias = _aliasByAttestation[attestation.id];
        if (personAlias != bytes32(0)) {
            delete _aliasAttested[key][personAlias];
            delete _aliasByAttestation[attestation.id];
        }
        _attestationsByRecipientAndSchema[key].remove(attestation.id);
        _attestationsByAttester[attestation.attester].remove(attestation.id);
        return true;
    }

    /// @notice Checks whether a person (by context alias) has already attested the pair.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param personAlias The context alias returned by the humanity precompile.
    /// @return Whether that person has an attestation recorded for the pair.
    function aliasHasAttested(
        address recipient,
        uint256 schema,
        bytes32 personAlias
    ) external view returns (bool) {
        return _aliasAttested[_compositeKey(recipient, schema)][personAlias];
    }

    /// @notice Checks whether any of the provided attesters has an active attestation for the
    ///         recipient and schema.
    /// @dev O(N*M) where N is the (recipient, schema) collection size and M is the attesters list
    ///      length, with two external calls per entry.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param attesters The attesters to check.
    /// @return Whether at least one attester has an active attestation.
    function isActiveAny(
        address recipient,
        uint256 schema,
        address[] calldata attesters
    ) external view returns (bool) {
        EnumerableSet.UintSet
            storage collection = _attestationsByRecipientAndSchema[
                _compositeKey(recipient, schema)
            ];
        uint256 collectionLen = collection.length();
        uint256 attestersLen = attesters.length;

        for (uint256 i = 0; i < collectionLen; ++i) {
            uint256 id = collection.at(i);
            if (!_service.isActive(id)) continue;

            Attestation memory attestation = _service.getAttestationById(id);
            for (uint256 j = 0; j < attestersLen; ++j) {
                if (attestation.attester == attesters[j]) return true;
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
        return
            _attestationsByRecipientAndSchema[_compositeKey(recipient, schema)]
                .length();
    }

    /// @notice Returns a page of attestation IDs for the given recipient and schema.
    /// @dev Order is not stable across blocks. Revocations swap-and-pop.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param offset The starting index.
    /// @param limit The maximum number of IDs to return. MUST NOT exceed MAX_PAGE_SIZE.
    /// @return A page of attestation IDs.
    function listByRecipientAndSchema(
        address recipient,
        uint256 schema,
        uint64 offset,
        uint64 limit
    ) external view returns (uint256[] memory) {
        if (limit > MAX_PAGE_SIZE) {
            revert RecipientAndAttesterIndexResolver__PageSizeTooLarge(
                limit,
                MAX_PAGE_SIZE
            );
        }

        EnumerableSet.UintSet
            storage collection = _attestationsByRecipientAndSchema[
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
    /// @dev Order is not stable across blocks. Revocations swap-and-pop.
    /// @param attester The attester address.
    /// @param offset The starting index.
    /// @param limit The maximum number of IDs to return. MUST NOT exceed MAX_PAGE_SIZE.
    /// @return A page of attestation IDs.
    function listByAttester(
        address attester,
        uint64 offset,
        uint64 limit
    ) external view returns (uint256[] memory) {
        if (limit > MAX_PAGE_SIZE) {
            revert RecipientAndAttesterIndexResolver__PageSizeTooLarge(
                limit,
                MAX_PAGE_SIZE
            );
        }

        return _page(_attestationsByAttester[attester], offset, limit);
    }

    /// @dev Reads the identity's humanity tier and alias from the precompile. Returns the context
    ///      alias when the identity meets the minimum tier, or the zero alias otherwise.
    function _humanityAlias(address identity) private view returns (bytes32) {
        IPersonhood.PersonhoodInfo memory info = HUMANITY.personhoodStatus(
            identity,
            HUMANITY_CONTEXT
        );
        if (info.status < MIN_HUMANITY_STATUS) return bytes32(0);
        return info.contextAlias;
    }

    /// @dev Rebuilds the bare message the identity key signs to bind `account`. Binding this
    ///      resolver (unique per deployment and chain) and the account stops a signature being
    ///      replayed against another resolver or for a different account.
    function _bindingMessage(
        address account
    ) private view returns (bytes memory) {
        return abi.encodePacked(MESSAGE_PREFIX, address(this), account);
    }

    /// @dev Wraps a payload in the `<Bytes>` tags a host prepends/appends before raw signing.
    function _wrapBytes(
        bytes memory inner
    ) private pure returns (bytes memory) {
        return abi.encodePacked("<Bytes>", inner, "</Bytes>");
    }

    /// @dev Widens a 64-byte signature to the uint8[64] the System precompile expects.
    function _toFixedSignature(
        bytes calldata signature
    ) private pure returns (uint8[64] memory out) {
        for (uint256 i = 0; i < 64; ++i) out[i] = uint8(signature[i]);
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
