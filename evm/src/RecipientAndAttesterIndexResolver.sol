// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.8.24;

import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import {Attestation, IAttestationService} from "./interfaces/IAttestationService.sol";
import {IAttestationResolver} from "./interfaces/IAttestationResolver.sol";
import {IPersonhood} from "./interfaces/IPersonhood.sol";

/// @title RecipientAndAttesterIndexResolver
/// @notice Indexes attestations by (recipient, schema) and by attester, admitting only
///         attestations carrying a valid proof of personhood, and only once per
///         (person, recipient, schema) so one person recommends a given app once.
contract RecipientAndAttesterIndexResolver is IAttestationResolver {
    using EnumerableSet for EnumerableSet.UintSet;

    error RecipientAndAttesterIndexResolver__AccessDenied();
    error RecipientAndAttesterIndexResolver__InvalidService();
    error RecipientAndAttesterIndexResolver__PageSizeTooLarge(
        uint64 requested,
        uint64 max
    );

    uint64 public constant MAX_PAGE_SIZE = 100;

    // The Proof-of-Personhood precompile.
    address private constant PERSONHOOD =
        0x000000000000000000000000000000000a010000;

    // The application identifier passed to the personhood precompile.
    //
    // Distinct from the context Publisher pins, so the alias a person recommends under
    // cannot be linked to the one they publish under. Pinned, not read from the request,
    // because the context is what makes an alias stable per person.
    bytes32 private constant PERSONHOOD_CONTEXT = bytes32("browse.recommend");

    // The bound attestation service.
    IAttestationService private immutable _service;

    // Attestation IDs grouped by (recipient, schema).
    mapping(bytes32 key => EnumerableSet.UintSet ids)
        private _attestationsByRecipientAndSchema;

    // Attestation IDs grouped by attester.
    mapping(address attester => EnumerableSet.UintSet ids)
        private _attestationsByAttester;

    // Whether a person has already attested a given (recipient, schema).
    mapping(bytes32 key => mapping(bytes32 personAlias => bool used))
        private _personAttested;

    // The person recorded for an attestation, so a revoke can release the per-person lock.
    mapping(uint256 id => bytes32 personAlias) private _personByAttestation;

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

    /// @notice The digest a recommendation's personhood proof must be built over.
    /// @dev Binds the proof to this resolver, this chain, the attester, and the app and schema
    ///      being recommended, so a proof lifted from another recommendation does not verify.
    /// @param attester The account that will submit the attestation.
    /// @param recipient The app being recommended.
    /// @param schema The schema ID of the recommendation.
    /// @return The 32-byte digest to bind into the proof.
    function getAttestDigest(
        address attester,
        address recipient,
        uint256 schema
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    attester,
                    recipient,
                    schema
                )
            );
    }

    /// @notice Returns the bound attestation service.
    /// @return The bound attestation service.
    function getService() external view returns (IAttestationService) {
        return _service;
    }

    /// @inheritdoc IAttestationResolver
    /// @dev Admits the attestation only when it carries a valid personhood proof and that person
    ///      has not already attested this (recipient, schema). Returns false on either failure so
    ///      the service rejects it, and reverts when `data` does not decode.
    ///
    ///      Keyed on the person alias, not the attester address, because addresses are free to
    ///      make and one human derives the same alias in this context.
    function onAttest(
        Attestation calldata attestation
    ) external onlyService returns (bool) {
        (bool proven, bytes32 personAlias) = _verifyPersonhood(attestation);
        if (!proven) return false;

        bytes32 key = _compositeKey(attestation.recipient, attestation.schema);
        if (_personAttested[key][personAlias]) return false;

        _personAttested[key][personAlias] = true;
        _personByAttestation[attestation.id] = personAlias;
        _attestationsByRecipientAndSchema[key].add(attestation.id);
        _attestationsByAttester[attestation.attester].add(attestation.id);
        return true;
    }

    /// @inheritdoc IAttestationResolver
    /// @dev Releases the per-person lock for the (recipient, schema) so they may attest it again
    ///      later, then de-indexes the attestation.
    function onRevoke(
        Attestation calldata attestation
    ) external onlyService returns (bool) {
        bytes32 key = _compositeKey(attestation.recipient, attestation.schema);
        bytes32 personAlias = _personByAttestation[attestation.id];
        if (personAlias != bytes32(0)) {
            delete _personAttested[key][personAlias];
            delete _personByAttestation[attestation.id];
        }
        _attestationsByRecipientAndSchema[key].remove(attestation.id);
        _attestationsByAttester[attestation.attester].remove(attestation.id);
        return true;
    }

    /// @notice Checks whether a person has already attested the pair.
    /// @param recipient The recipient address.
    /// @param schema The schema ID.
    /// @param personAlias The context alias of the person, from {boundAlias}.
    /// @return Whether that person has an attestation recorded for the pair.
    function personHasAttested(
        address recipient,
        uint256 schema,
        bytes32 personAlias
    ) external view returns (bool) {
        return _personAttested[_compositeKey(recipient, schema)][personAlias];
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

    /// @dev Verifies the proof carried in `data` and returns the context alias it derives.
    ///
    /// `message` and `context` are overwritten rather than trusted. The first spends the proof on
    /// this one recommendation, the second keeps one person to one alias.
    function _verifyPersonhood(
        Attestation calldata attestation
    ) private view returns (bool proven, bytes32 personAlias) {
        (, IPersonhood.ProofVerificationRequest memory request) = abi.decode(
            attestation.data,
            (string, IPersonhood.ProofVerificationRequest)
        );
        request.message = abi.encodePacked(
            getAttestDigest(
                attestation.attester,
                attestation.recipient,
                attestation.schema
            )
        );
        request.context = PERSONHOOD_CONTEXT;

        if (!IPersonhood(PERSONHOOD).personhoodInfoByProof(request)) {
            return (false, bytes32(0));
        }
        return (true, request.expectedAlias);
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
