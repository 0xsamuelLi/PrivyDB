import { useEffect, useMemo, useState } from 'react';
import { Contract, ethers } from 'ethers';
import { useAccount, useReadContract } from 'wagmi';

import { CONTRACT_ABI } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import { decryptContentWithKey, encryptContentWithKey } from '../utils/encryption';
import '../styles/DocumentWorkspace.css';

type DocumentWorkspaceProps = {
  contractAddress: string;
  isContractReady: boolean;
};

type DocumentPreview = {
  id: bigint;
  name: string;
  owner: string;
  updatedAt: bigint;
  canEdit: boolean;
};

type DocumentDetails = {
  name: string;
  encryptedBody: `0x${string}`;
  encryptedKey: `0x${string}`;
  owner: string;
  createdAt: bigint;
  updatedAt: bigint;
};

export function DocumentWorkspace({ contractAddress, isContractReady }: DocumentWorkspaceProps) {
  const { address } = useAccount();
  const { instance } = useZamaInstance();
  const signer = useEthersSigner();

  const [selectedDocumentId, setSelectedDocumentId] = useState<bigint | null>(null);
  const [decryptedKey, setDecryptedKey] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [lastSavedContent, setLastSavedContent] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [collaboratorInput, setCollaboratorInput] = useState('');
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSharing, setIsSharing] = useState(false);

  const canQuery = Boolean(address && isContractReady && contractAddress !== ethers.ZeroAddress);

  const documentListQuery = useReadContract({
    address: canQuery ? (contractAddress as `0x${string}`) : undefined,
    abi: CONTRACT_ABI,
    functionName: 'getDocumentsFor',
    args: canQuery ? [address as `0x${string}`] : undefined,
    query: {
      enabled: canQuery,
    },
  });

  const documentDetailsQuery = useReadContract({
    address: canQuery && selectedDocumentId ? (contractAddress as `0x${string}`) : undefined,
    abi: CONTRACT_ABI,
    functionName: 'getDocumentDetails',
    args: canQuery && selectedDocumentId ? [selectedDocumentId] : undefined,
    query: {
      enabled: Boolean(canQuery && selectedDocumentId),
    },
  });

  const collaboratorsQuery = useReadContract({
    address: canQuery && selectedDocumentId ? (contractAddress as `0x${string}`) : undefined,
    abi: CONTRACT_ABI,
    functionName: 'getCollaborators',
    args: canQuery && selectedDocumentId ? [selectedDocumentId] : undefined,
    query: {
      enabled: Boolean(canQuery && selectedDocumentId),
    },
  });

  const documents = useMemo(() => (documentListQuery.data ?? []) as DocumentPreview[], [documentListQuery.data]);
  const documentDetails = useMemo(
    () => (documentDetailsQuery.data ? (documentDetailsQuery.data as DocumentDetails) : null),
    [documentDetailsQuery.data],
  );
  const collaborators = useMemo(() => (collaboratorsQuery.data ?? []) as string[], [collaboratorsQuery.data]);

  useEffect(() => {
    if (!selectedDocumentId && documents.length > 0) {
      setSelectedDocumentId(documents[0].id);
    }
  }, [documents, selectedDocumentId]);

  useEffect(() => {
    setDecryptedKey(null);
    setEditorContent('');
    setLastSavedContent('');
  }, [selectedDocumentId]);

  const handleSelectDocument = (docId: bigint) => {
    setSelectedDocumentId(docId);
    setActionMessage('');
  };

  const decryptDocumentKey = async () => {
    if (!instance || !address || !documentDetails || !signer || !selectedDocumentId) {
      setActionMessage('Missing relayer, signer, or document details.');
      return;
    }

    try {
      setIsDecrypting(true);
      setActionMessage('Preparing user decryption request...');

      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];

      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        throw new Error('Signer unavailable. Connect your wallet.');
      }

      const signature = await resolvedSigner.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification,
        },
        eip712.message,
      );

      const result = await instance.userDecrypt(
        [
          {
            handle: documentDetails.encryptedKey as string,
            contractAddress,
          },
        ],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays,
      );

      const clearKey = result[documentDetails.encryptedKey as string];
      if (!clearKey) {
        throw new Error('Failed to decrypt the editor key.');
      }

      const decryptedContent = decryptContentWithKey(documentDetails.encryptedBody as string, clearKey);
      setDecryptedKey(clearKey);
      setEditorContent(decryptedContent);
      setLastSavedContent(decryptedContent);
      setActionMessage('Editor key decrypted. You can now update the document body.');
    } catch (error) {
      console.error('Failed to decrypt document key', error);
      setActionMessage(`Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDecrypting(false);
    }
  };

  const handleSaveEncryptedBody = async () => {
    if (!decryptedKey || !selectedDocumentId || !signer) {
      setActionMessage('Please decrypt the editor key before saving.');
      return;
    }
    if (editorContent === lastSavedContent) {
      setActionMessage('No changes detected.');
      return;
    }

    try {
      setIsSaving(true);
      setActionMessage('Encrypting and uploading document body...');

      const payload = encryptContentWithKey(editorContent, decryptedKey);
      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        throw new Error('Signer unavailable. Connect your wallet.');
      }
      const contract = new Contract(contractAddress, CONTRACT_ABI, resolvedSigner);
      const tx = await contract.updateDocumentBody(selectedDocumentId, payload);
      await tx.wait();

      setLastSavedContent(editorContent);
      setActionMessage('Encrypted body saved on-chain.');
      await Promise.all([documentDetailsQuery.refetch?.(), documentListQuery.refetch?.()]);
    } catch (error) {
      console.error('Failed to save encrypted body', error);
      setActionMessage(`Save failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const manageCollaborator = async (mode: 'grant' | 'revoke', collaborator: string) => {
    if (!selectedDocumentId || !signer) {
      setActionMessage('Select a document before managing collaborators.');
      return;
    }
    if (!ethers.isAddress(collaborator)) {
      setActionMessage('Enter a valid address to manage access.');
      return;
    }

    try {
      setIsSharing(true);
      setActionMessage(`${mode === 'grant' ? 'Granting' : 'Revoking'} collaborator access...`);

      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        throw new Error('Signer unavailable. Connect your wallet.');
      }
      const contract = new Contract(contractAddress, CONTRACT_ABI, resolvedSigner);
      if (mode === 'grant') {
        const tx = await contract.grantDocumentAccess(selectedDocumentId, collaborator);
        await tx.wait();
      } else {
        const tx = await contract.revokeDocumentAccess(selectedDocumentId, collaborator);
        await tx.wait();
      }
      setCollaboratorInput('');
      await collaboratorsQuery.refetch?.();
      setActionMessage(`Collaborator ${mode === 'grant' ? 'added' : 'removed'}.`);
    } catch (error) {
      console.error('Failed to update collaborator list', error);
      setActionMessage(`Collaborator update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSharing(false);
    }
  };

  const isOwner = Boolean(documentDetails && address && documentDetails.owner.toLowerCase() === address.toLowerCase());

  const formattedUpdatedAt = documentDetails
    ? new Date(Number(documentDetails.updatedAt) * 1000).toLocaleString()
    : '';

  return (
    <section className="workspace">
      {!canQuery && (
        <div className="workspace-hint">
          Provide a deployed contract address and connect your wallet to inspect encrypted documents.
        </div>
      )}

      {canQuery && documents.length === 0 && (
        <div className="workspace-hint">
          No encrypted documents found for this wallet. Create one first, or ask someone to share it with you.
        </div>
      )}

      {canQuery && documents.length > 0 && (
        <div className="workspace-grid">
          <div className="workspace-sidebar">
            <h3>My encrypted documents</h3>
            <ul className="document-list">
              {documents.map((doc) => (
                <li key={doc.id.toString()}>
                  <button
                    type="button"
                    className={`document-row ${selectedDocumentId === doc.id ? 'selected' : ''}`}
                    onClick={() => handleSelectDocument(doc.id)}
                  >
                    <span className="document-name">{doc.name}</span>
                    <span className="document-meta">
                      {doc.canEdit ? 'Editor' : 'Viewer'} · {new Date(Number(doc.updatedAt) * 1000).toLocaleString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="workspace-content">
            {!selectedDocumentId && <p className="workspace-hint">Select a document to decrypt its key.</p>}

            {selectedDocumentId && documentDetails && (
              <div className="document-detail">
                <header className="document-detail-header">
                  <div>
                    <p className="document-detail-eyebrow">Document #{selectedDocumentId.toString()}</p>
                    <h2>{documentDetails.name}</h2>
                    <p className="document-detail-meta">
                      Owner: {documentDetails.owner} · Last update: {formattedUpdatedAt}
                    </p>
                  </div>
                </header>

                <div className="document-actions">
                  <button
                    type="button"
                    className="workspace-button"
                    onClick={decryptDocumentKey}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? 'Decrypting...' : 'Decrypt editor key'}
                  </button>
                  {decryptedKey && (
                    <span className="decrypted-key">Editor key: {decryptedKey}</span>
                  )}
                </div>

                <div className="editor-section">
                  <textarea
                    className="document-textarea"
                    placeholder="Decrypt the key to load the document body..."
                    value={editorContent}
                    onChange={(event) => setEditorContent(event.target.value)}
                    disabled={!decryptedKey}
                    rows={10}
                  />
                  <button
                    type="button"
                    className="workspace-button primary"
                    onClick={handleSaveEncryptedBody}
                    disabled={!decryptedKey || isSaving}
                  >
                    {isSaving ? 'Encrypting...' : 'Save encrypted body'}
                  </button>
                </div>

                {isOwner && (
                  <div className="collaborator-panel">
                    <h3>Collaborators</h3>
                    <div className="collaborator-controls">
                      <input
                        type="text"
                        value={collaboratorInput}
                        onChange={(event) => setCollaboratorInput(event.target.value)}
                        placeholder="0x collaborator address"
                      />
                      <div className="collaborator-buttons">
                        <button
                          type="button"
                          onClick={() => manageCollaborator('grant', collaboratorInput)}
                          disabled={isSharing}
                        >
                          {isSharing ? 'Working...' : 'Grant access'}
                        </button>
                        <button
                          type="button"
                          className="danger"
                          onClick={() => manageCollaborator('revoke', collaboratorInput)}
                          disabled={isSharing}
                        >
                          Revoke access
                        </button>
                      </div>
                    </div>
                    <ul className="collaborator-list">
                      {collaborators.length === 0 && <li className="collaborator-empty">No shared addresses yet.</li>}
                      {collaborators.map((collaborator) => (
                        <li key={collaborator} className="collaborator-item">
                          <span>{collaborator}</span>
                          <button type="button" onClick={() => manageCollaborator('revoke', collaborator)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {actionMessage && <p className="workspace-status">{actionMessage}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
