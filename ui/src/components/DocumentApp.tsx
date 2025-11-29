import { useState } from 'react';
import { ethers } from 'ethers';

import { Header } from './Header';
import { DocumentCreation } from './DocumentCreation';
import { DocumentWorkspace } from './DocumentWorkspace';
import { DEFAULT_CONTRACT_ADDRESS } from '../config/contracts';
import '../styles/DocumentApp.css';

export function DocumentApp() {
  const [activeTab, setActiveTab] = useState<'create' | 'workspace'>('create');
  const [contractAddress, setContractAddress] = useState<string>(DEFAULT_CONTRACT_ADDRESS);

  const normalizedAddress = contractAddress.trim();
  const isValidContract = ethers.isAddress(normalizedAddress) && normalizedAddress !== ethers.ZeroAddress;

  return (
    <div className="document-app">
      <Header />
      <main className="document-main">
        <section className="contract-panel">
          <div className="contract-panel-content">
            <div>
              <label className="contract-label">Active contract address</label>
              <input
                type="text"
                className="contract-input"
                value={contractAddress}
                spellCheck={false}
                onChange={(event) => setContractAddress(event.target.value)}
                placeholder="0x..."
              />
              <p className={`contract-hint ${isValidContract ? 'success' : 'warning'}`}>
                {isValidContract
                  ? 'Ready to send encrypted data to the deployed contract.'
                  : 'Paste the deployed Sepolia address before using the dApp.'}
              </p>
            </div>
          </div>
        </section>

        <div className="document-tabs">
          <button
            onClick={() => setActiveTab('create')}
            className={`document-tab ${activeTab === 'create' ? 'active' : ''}`}
          >
            Create document
          </button>
          <button
            onClick={() => setActiveTab('workspace')}
            className={`document-tab ${activeTab === 'workspace' ? 'active' : ''}`}
          >
            Workspace
          </button>
        </div>

        {activeTab === 'create' ? (
          <DocumentCreation contractAddress={normalizedAddress} isContractReady={isValidContract} />
        ) : (
          <DocumentWorkspace contractAddress={normalizedAddress} isContractReady={isValidContract} />
        )}
      </main>
    </div>
  );
}
