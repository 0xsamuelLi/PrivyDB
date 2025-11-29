// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, eaddress, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title PrivyDocuments - FHE powered collaborative document storage
/// @notice Users can register encrypted document keys, update encrypted content, and grant edit access to collaborators.
contract PrivyDocuments is ZamaEthereumConfig {
    struct Document {
        string name;
        bytes encryptedBody;
        eaddress encryptedKey;
        address owner;
        uint256 createdAt;
        uint256 updatedAt;
    }

    struct DocumentPreview {
        uint256 id;
        string name;
        address owner;
        uint256 updatedAt;
        bool canEdit;
    }

    error DocumentDoesNotExist(uint256 documentId);
    error DocumentNameRequired();
    error NotDocumentOwner(uint256 documentId, address caller);
    error NotAuthorizedEditor(uint256 documentId, address caller);
    error InvalidCollaborator(address collaborator);
    error CollaboratorAlreadyAuthorized(address collaborator);
    error CollaboratorNotFound(address collaborator);

    event DocumentCreated(uint256 indexed documentId, address indexed owner, string name);
    event DocumentUpdated(uint256 indexed documentId, address indexed editor);
    event DocumentAccessGranted(uint256 indexed documentId, address indexed owner, address indexed collaborator);
    event DocumentAccessRevoked(uint256 indexed documentId, address indexed owner, address indexed collaborator);

    uint256 private _documentCount;

    mapping(uint256 => Document) private _documents;
    mapping(uint256 => mapping(address => bool)) private _documentEditors;
    mapping(uint256 => address[]) private _documentCollaborators;
    mapping(uint256 => mapping(address => uint256)) private _collaboratorIndex;

    /// @notice Register a new encrypted document key with an empty body.
    /// @param name The on-chain label for the document.
    /// @param encryptedKeyHandle Zama encrypted handle pointing to the randomly generated editor key (address A).
    /// @param inputProof FHE input proof required to validate the encrypted key.
    /// @return newDocumentId Newly created document id.
    function createDocument(
        string calldata name,
        externalEaddress encryptedKeyHandle,
        bytes calldata inputProof
    ) external returns (uint256 newDocumentId) {
        if (bytes(name).length == 0) {
            revert DocumentNameRequired();
        }

        eaddress encryptedKey = FHE.fromExternal(encryptedKeyHandle, inputProof);

        _documentCount += 1;
        newDocumentId = _documentCount;

        Document storage documentRef = _documents[newDocumentId];
        documentRef.name = name;
        documentRef.encryptedBody = bytes("");
        documentRef.encryptedKey = encryptedKey;
        documentRef.owner = msg.sender;
        documentRef.createdAt = block.timestamp;
        documentRef.updatedAt = block.timestamp;

        _documentEditors[newDocumentId][msg.sender] = true;

        FHE.allowThis(encryptedKey);
        FHE.allow(encryptedKey, msg.sender);

        emit DocumentCreated(newDocumentId, msg.sender, name);
    }

    /// @notice Update the encrypted body of a document. Only authorized editors can call this.
    /// @param documentId Id of the document to update.
    /// @param encryptedBody Hex encoded encrypted document body (produced off-chain).
    function updateDocumentBody(uint256 documentId, bytes calldata encryptedBody) external {
        Document storage documentRef = _documents[documentId];
        if (documentRef.owner == address(0)) {
            revert DocumentDoesNotExist(documentId);
        }

        if (!_documentEditors[documentId][msg.sender]) {
            revert NotAuthorizedEditor(documentId, msg.sender);
        }

        documentRef.encryptedBody = encryptedBody;
        documentRef.updatedAt = block.timestamp;

        emit DocumentUpdated(documentId, msg.sender);
    }

    /// @notice Grant edit + decrypt permission to a collaborator.
    /// @param documentId Id of the document that should be shared.
    /// @param collaborator Address that should gain access.
    function grantDocumentAccess(uint256 documentId, address collaborator) external {
        Document storage documentRef = _documents[documentId];
        if (documentRef.owner == address(0)) {
            revert DocumentDoesNotExist(documentId);
        }
        if (documentRef.owner != msg.sender) {
            revert NotDocumentOwner(documentId, msg.sender);
        }
        if (collaborator == address(0) || collaborator == msg.sender) {
            revert InvalidCollaborator(collaborator);
        }
        if (_documentEditors[documentId][collaborator]) {
            revert CollaboratorAlreadyAuthorized(collaborator);
        }

        _documentEditors[documentId][collaborator] = true;
        _documentCollaborators[documentId].push(collaborator);
        _collaboratorIndex[documentId][collaborator] = _documentCollaborators[documentId].length;

        FHE.allow(documentRef.encryptedKey, collaborator);

        emit DocumentAccessGranted(documentId, msg.sender, collaborator);
    }

    /// @notice Revoke edit permission from a collaborator.
    /// @param documentId Id of the document to update.
    /// @param collaborator Collaborator to remove.
    function revokeDocumentAccess(uint256 documentId, address collaborator) external {
        Document storage documentRef = _documents[documentId];
        if (documentRef.owner == address(0)) {
            revert DocumentDoesNotExist(documentId);
        }
        if (documentRef.owner != msg.sender) {
            revert NotDocumentOwner(documentId, msg.sender);
        }
        if (!_documentEditors[documentId][collaborator]) {
            revert CollaboratorNotFound(collaborator);
        }

        _documentEditors[documentId][collaborator] = false;

        uint256 idx = _collaboratorIndex[documentId][collaborator];
        if (idx > 0) {
            uint256 indexToRemove = idx - 1;
            uint256 lastIndex = _documentCollaborators[documentId].length - 1;
            if (indexToRemove != lastIndex) {
                address lastCollaborator = _documentCollaborators[documentId][lastIndex];
                _documentCollaborators[documentId][indexToRemove] = lastCollaborator;
                _collaboratorIndex[documentId][lastCollaborator] = idx;
            }
            _documentCollaborators[documentId].pop();
            delete _collaboratorIndex[documentId][collaborator];
        }

        emit DocumentAccessRevoked(documentId, msg.sender, collaborator);
    }

    /// @notice Returns whether an address currently has edit permissions for a document.
    function hasAccess(uint256 documentId, address user) external view returns (bool) {
        Document storage documentRef = _documents[documentId];
        if (documentRef.owner == address(0)) {
            return false;
        }
        if (documentRef.owner == user) {
            return true;
        }
        return _documentEditors[documentId][user];
    }

    /// @notice Number of documents that have been registered.
    function totalDocuments() external view returns (uint256) {
        return _documentCount;
    }

    /// @notice Get details for a single document.
    function getDocumentDetails(uint256 documentId) external view returns (Document memory documentRef) {
        Document storage stored = _documents[documentId];
        if (stored.owner == address(0)) {
            revert DocumentDoesNotExist(documentId);
        }
        documentRef = Document({
            name: stored.name,
            encryptedBody: stored.encryptedBody,
            encryptedKey: stored.encryptedKey,
            owner: stored.owner,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt
        });
    }

    /// @notice Retrieve currently shared collaborators for a document.
    function getCollaborators(uint256 documentId) external view returns (address[] memory) {
        Document storage documentRef = _documents[documentId];
        if (documentRef.owner == address(0)) {
            revert DocumentDoesNotExist(documentId);
        }
        return _documentCollaborators[documentId];
    }

    /// @notice Return previews for all documents a user can view/edit (owner or collaborator).
    function getDocumentsFor(address user) external view returns (DocumentPreview[] memory) {
        uint256 accessibleCount;
        for (uint256 id = 1; id <= _documentCount; id++) {
            Document storage doc = _documents[id];
            if (doc.owner == address(0)) {
                continue;
            }
            if (doc.owner == user || _documentEditors[id][user]) {
                accessibleCount++;
            }
        }

        DocumentPreview[] memory results = new DocumentPreview[](accessibleCount);
        uint256 cursor;
        for (uint256 id = 1; id <= _documentCount; id++) {
            Document storage doc = _documents[id];
            if (doc.owner == address(0)) {
                continue;
            }
            bool canEdit = doc.owner == user || _documentEditors[id][user];
            if (!canEdit) {
                continue;
            }
            results[cursor] = DocumentPreview({
                id: id,
                name: doc.name,
                owner: doc.owner,
                updatedAt: doc.updatedAt,
                canEdit: canEdit
            });
            cursor++;
        }
        return results;
    }
}
