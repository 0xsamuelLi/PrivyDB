import { useState } from 'react';
import { Contract, Wallet } from 'ethers';
import { useAccount } from 'wagmi';

import { CONTRACT_ABI } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import '../styles/DocumentCreation.css';

type DocumentCreationProps = {
  contractAddress: string;
  isContractReady: boolean;
};

export function DocumentCreation({ contractAddress, isContractReady }: DocumentCreationProps) {
  const { address, isConnected } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signer = useEthersSigner();

  const [documentName, setDocumentName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [createdDocumentId, setCreatedDocumentId] = useState<string | null>(null);

  const readyForSubmission = Boolean(
    isContractReady && documentName.trim().length > 0 && isConnected && instance && signer && !zamaLoading,
  );

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!readyForSubmission || !instance || !signer || !address) {
      return;
    }

    try {
      setIsSubmitting(true);
      setStatusMessage('Generating random editor address...');
      setCreatedDocumentId(null);

      const randomWallet = Wallet.createRandom();
      const encryptedInput = instance.createEncryptedInput(contractAddress, address);
      encryptedInput.addAddress(randomWallet.address);

      setStatusMessage('Encrypting editor key with Zama relayer...');
      const encryptedKey = await encryptedInput.encrypt();

      const resolvedSigner = await signer;
      if (!resolvedSigner) {
        throw new Error('Unable to connect to signer');
      }

      const contract = new Contract(contractAddress, CONTRACT_ABI, resolvedSigner);

      setStatusMessage('Submitting createDocument transaction...');
      const tx = await contract.createDocument(
        documentName.trim(),
        encryptedKey.handles[0],
        encryptedKey.inputProof,
      );
      await tx.wait();

      const docIdBn = await contract.totalDocuments();
      setCreatedDocumentId(docIdBn.toString());
      setStatusMessage('Document stored on-chain with an empty encrypted body.');
      setDocumentName('');
    } catch (error) {
      console.error('Failed to create document', error);
      setStatusMessage(`Failed to create document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="document-creation">
      <div className="document-card">
        <h2>Create a new encrypted document</h2>
        <p className="document-description">
          Each document starts with a random EVM address encrypted through the Zama relayer. The document body is stored
          as encrypted bytes and stays empty until you push your first revision.
        </p>

        <form onSubmit={handleSubmit} className="document-form">
          <label className="document-label">
            Document title
            <input
              type="text"
              value={documentName}
              onChange={(event) => setDocumentName(event.target.value)}
              placeholder="Product strategy draft"
              className="document-input"
              maxLength={64}
              required
            />
          </label>

          <button type="submit" className="document-submit" disabled={!readyForSubmission || isSubmitting}>
            {!isContractReady && 'Enter a valid contract address'}
            {isContractReady && zamaLoading && 'Initializing Zama relayer...'}
            {isContractReady && !zamaLoading && !isSubmitting && 'Generate encrypted document'}
            {isContractReady && isSubmitting && 'Submitting transaction...'}
          </button>
        </form>

        {!isConnected && <p className="document-hint">Connect a wallet to register new documents.</p>}
        {zamaError && <p className="document-error">{zamaError}</p>}
        {statusMessage && <p className="document-status">{statusMessage}</p>}
        {createdDocumentId && (
          <p className="document-success">
            Document #{createdDocumentId} created. Open the workspace to decrypt the editor key and start editing.
          </p>
        )}
      </div>
    </section>
  );
}
