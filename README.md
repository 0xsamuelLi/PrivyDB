# PrivyDB – Fully Homomorphic Encrypted Document Workspace

PrivyDB is a privacy-first document platform that keeps every secret off-chain while still allowing collaborative edits.
Each document starts with a randomly generated EVM address **A** created locally in the browser. The address is
encrypted with Zama’s relayer, stored on-chain, and drives both decryption permissions and body encryption. Document
bodies are never stored in cleartext: updates are encrypted client-side with **A** before being pushed to the contract.

## Why PrivyDB

- **No cleartext on-chain**: document keys (`externalEaddress`) and bodies (`bytes`) remain encrypted end-to-end.
- **Deterministic sharing**: owners grant or revoke editors on-chain, reusing `FHE.allow` to authorize collaborators.
- **Symmetric body protection**: the decrypted address **A** is used as the XOR key for encrypting and decrypting the
  document body locally.
- **Auditable flow without trust in servers**: Zama relayer handles FHE encryption, while contract logic enforces access.
- **Network-ready**: tuned for Sepolia; localhost networks are intentionally blocked in the dApp to avoid unsafe writes.

## Architecture at a Glance

- **Smart contract** (`contracts/PrivyDocuments.sol`): creates documents, updates encrypted bodies, and manages
  collaborator permissions. View functions accept explicit addresses (no `msg.sender` reliance) to keep reads pure.
- **FHE bridge**: `@fhevm/solidity` on-chain plus `@zama-fhe/relayer-sdk` in the dApp for encrypting the random editor
  address and decrypting it later.
- **Front-end** (`ui/`): React + Vite + RainbowKit + wagmi/viem with ethers v6 for contract writes and viem for reads.
  Styling uses plain CSS (no Tailwind) and avoids browser storage.
- **Local encryption helper** (`ui/src/utils/encryption.ts`): XOR-based encryption keyed by the decrypted address keeps
  payloads lightweight while preserving confidentiality.
- **Tasks & deployment**: Hardhat + hardhat-deploy scripts wire together local mocks, Sepolia deployments, and CLI tasks.

## Tech Stack

- Solidity 0.8.27, Hardhat, hardhat-deploy, TypeChain (ethers-v6)
- @fhevm/solidity, Zama relayer SDK (`SepoliaConfig`)
- React 19, Vite 7, wagmi 2, viem 2 (reads), ethers 6 (writes), RainbowKit
- Testing: Mocha/Chai with the FHEVM mock; Solidity coverage and gas reporter available

## Repository Layout

- `contracts/PrivyDocuments.sol` – main contract storing encrypted keys, bodies, and collaborator lists
- `deploy/deploy.ts` – hardhat-deploy script for Hardhat and Sepolia
- `tasks/PrivyDocuments.ts` – `docs:*` CLI helpers (create, update, share, revoke, list, address)
- `test/` – FHEVM mock suite and a Sepolia smoke test
- `ui/` – React dApp (no environment variables; contract address entered in-app)
- `docs/zama_llm.md`, `docs/zama_doc_relayer.md` – Zama usage notes and relayer details

## Problem Statement & Solution

- **Problem**: On-chain collaboration typically leaks document content, and off-chain storage makes permissioning opaque.
- **Solution**: Generate a local random editor address, encrypt it with Zama relayer, store the encrypted handle on-chain,
  and reuse the decrypted address as the symmetric key for every document revision. Access is enforced by on-chain
  collaborator lists with explicit allow/revoke, and reads happen through viem without relying on hidden state.

## Getting Started

Prerequisites:
- Node.js 20+, npm 8+
- Infura API key and a funded Sepolia private key (hex, with or without `0x`)

Install dependencies and build the contract artifacts:

```bash
npm install
npm run compile
```

Environment (root `.env`):

```
PRIVATE_KEY=<sepolia_private_key_without_0x_or_with_0x>
INFURA_API_KEY=<infura_project_id>
ETHERSCAN_API_KEY=<optional_for_verification>
```

MNEMONICs are not used; deployments rely on the single private key above.

## Hardhat Workflow

Compile and test with the local FHEVM mock:

```bash
npm run compile
npm run test
```

Run the Sepolia smoke test (skips when using the mock):

```bash
npx hardhat test --network sepolia test/PrivyDocumentsSepolia.ts
```

### Deploying

```bash
# Local smoke deployment
npx hardhat deploy --network hardhat

# Sepolia deployment (uses PRIVATE_KEY + INFURA_API_KEY)
npx hardhat deploy --network sepolia
```

After deploying to Sepolia, copy the generated ABI from `deployments/sepolia/PrivyDocuments.json` into
`ui/src/config/contracts.ts` and update `DEFAULT_CONTRACT_ADDRESS` with the deployed address.

### Useful Tasks

```bash
# Print the deployed address
npx hardhat docs:address --network sepolia

# Create a document (random editor key generated automatically)
npx hardhat docs:create --network sepolia --name "Product brief"

# Update encrypted body (expects hex payload)
npx hardhat docs:update --network sepolia --id 1 --body 0xdeadbeef

# Share / revoke
npx hardhat docs:share  --network sepolia --id 1 --address 0xabc...
npx hardhat docs:revoke --network sepolia --id 1 --address 0xabc...

# List accessible documents for an address
npx hardhat docs:list --network sepolia --address 0xabc...
```

## Front-end dApp (Sepolia only)

```
ui/
├── src/components
│   ├── DocumentApp.tsx        # Contract selector + tabs
│   ├── DocumentCreation.tsx   # Random key + encrypted creation flow
│   └── DocumentWorkspace.tsx  # List, decrypt, edit, and share
├── hooks/useZamaInstance.ts   # Initializes @zama-fhe/relayer-sdk with SepoliaConfig
└── utils/encryption.ts        # XOR helper keyed by the decrypted address
```

Setup and run:

```bash
cd ui
npm install
# Set your WalletConnect project id in ui/src/config/wagmi.ts (projectId field)
npm run dev    # or npm run build
```

Usage:
- Connect a wallet (RainbowKit). Only Sepolia is available; localhost networks are blocked.
- Paste the deployed contract address into the “Active contract address” input.
- **Create document**: generates a random EVM address, encrypts it via Zama relayer, and stores an empty encrypted body.
- **Workspace**: fetches documents with `getDocumentsFor(address)` (via viem), decrypts the editor key through the relayer
  (typed-data signature), XOR-decrypts the body, and saves updates with ethers `updateDocumentBody`.
- **Sharing**: owners grant/revoke collaborators on-chain. The relayer is called again so collaborators can decrypt the
  editor key and edit the body. No data is written to `localStorage`.

## Data Flow

1. Generate random EVM address **A** locally.
2. Encrypt **A** with Zama relayer → `externalEaddress` + input proof.
3. Call `createDocument(name, encryptedKeyHandle, proof)`; contract stores encrypted key + empty body and allows owner.
4. When editing, decrypt **A** via relayer using a typed-data signature; XOR-decrypt body client-side.
5. Encrypt new body with **A** and call `updateDocumentBody`.
6. Owners manage collaborator access with `grantDocumentAccess` / `revokeDocumentAccess`, which adjusts FHE allowances.

## Advantages

- End-to-end encrypted workflow with no server-side secrets
- Explicit on-chain permissioning with revocation
- Lightweight encryption suitable for on-chain storage
- Clear separation of reads (viem) and writes (ethers) to keep UX responsive
- Front-end stays environment-variable free and avoids local persistence to reduce attack surface

## Future Plans

- Rich-text editor support with encrypted diffing/version history
- Multi-chain support once Zama relayer configs expand beyond Sepolia
- Batch collaborator management and role distinctions (viewer vs editor)
- Enhanced monitoring: events indexer for notifications and document activity feeds
- Usability: auto-fill deployed address from `deployments/` output and stronger status messaging for relayer calls

## License

BSD-3-Clause-Clear – see `LICENSE`.
