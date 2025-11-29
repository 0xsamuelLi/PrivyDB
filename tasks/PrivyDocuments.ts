import { Wallet, ethers } from "ethers";
import { task } from "hardhat/config";
import type { TaskArguments } from "hardhat/types";

const CONTRACT_NAME = "PrivyDocuments";

async function getContract(hre: any) {
  const { deployments, ethers } = hre;
  const deployment = await deployments.get(CONTRACT_NAME);
  const contract = await ethers.getContractAt(CONTRACT_NAME, deployment.address);
  return { contract, address: deployment.address };
}

task("docs:address", "Prints the PrivyDocuments address").setAction(async (_args: TaskArguments, hre) => {
  const { address } = await getContract(hre);
  console.log(`${CONTRACT_NAME} address: ${address}`);
});

/**
 * Example:
 *   npx hardhat docs:create --name "My doc"
 */
task("docs:create", "Creates a document with a freshly generated encrypted editor key")
  .addParam("name", "Name of the document to create")
  .addOptionalParam(
    "key",
    "Optional plaintext address to encrypt. When omitted a random wallet address will be generated."
  )
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { ethers, fhevm } = hre;
    const { contract, address } = await getContract(hre);
    const signers = await ethers.getSigners();
    const owner = signers[0];

    const clearKey = taskArguments.key ? ethers.getAddress(taskArguments.key) : Wallet.createRandom().address;

    await fhevm.initializeCLIApi();

    const encryptedKey = await fhevm
      .createEncryptedInput(address, owner.address)
      .addAddress(clearKey)
      .encrypt();

    const docId = await contract
      .connect(owner)
      .callStatic.createDocument(taskArguments.name, encryptedKey.handles[0], encryptedKey.inputProof);

    const tx = await contract
      .connect(owner)
      .createDocument(taskArguments.name, encryptedKey.handles[0], encryptedKey.inputProof);

    console.log(`Creating document '${taskArguments.name}' using key ${clearKey} (docId=${docId})...`);
    await tx.wait();
    console.log(`Document ${docId} created.`);
  });

/**
 * Example:
 *   npx hardhat docs:update --id 1 --body 0xdeadbeef
 */
task("docs:update", "Updates the encrypted body for a document")
  .addParam("id", "Document id")
  .addParam("body", "Hex encoded encrypted body (e.g. 0x1234)")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { contract } = await getContract(hre);
    const id = BigInt(taskArguments.id);
    const signers = await hre.ethers.getSigners();
    const tx = await contract.connect(signers[0]).updateDocumentBody(id, taskArguments.body);
    console.log(`Updating document #${id} with body ${taskArguments.body} ...`);
    await tx.wait();
    console.log(`Document #${id} updated.`);
  });

/**
 * Example:
 *   npx hardhat docs:share --id 1 --address 0xabc...
 */
task("docs:share", "Share a document with another editor")
  .addParam("id", "Document id")
  .addParam("address", "Collaborator address")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { contract } = await getContract(hre);
    const collaborator = ethers.getAddress(taskArguments.address);
    const signers = await hre.ethers.getSigners();
    const tx = await contract.connect(signers[0]).grantDocumentAccess(taskArguments.id, collaborator);
    console.log(`Granting ${collaborator} access to document #${taskArguments.id} ...`);
    await tx.wait();
    console.log(`Collaborator ${collaborator} added.`);
  });

/**
 * Example:
 *   npx hardhat docs:revoke --id 1 --address 0xabc...
 */
task("docs:revoke", "Revoke edit access from a collaborator")
  .addParam("id", "Document id")
  .addParam("address", "Collaborator address")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { contract } = await getContract(hre);
    const collaborator = ethers.getAddress(taskArguments.address);
    const signers = await hre.ethers.getSigners();
    const tx = await contract.connect(signers[0]).revokeDocumentAccess(taskArguments.id, collaborator);
    console.log(`Revoking ${collaborator} from document #${taskArguments.id} ...`);
    await tx.wait();
    console.log(`Collaborator ${collaborator} removed.`);
  });

/**
 * Example:
 *   npx hardhat docs:list --address 0xabc
 */
task("docs:list", "List documents that a user can edit")
  .addParam("address", "Address to inspect")
  .setAction(async (taskArguments: TaskArguments, hre) => {
    const { contract } = await getContract(hre);
    const inspected = ethers.getAddress(taskArguments.address);
    const documents = await contract.getDocumentsFor(inspected);
    if (documents.length === 0) {
      console.log(`No documents found for ${inspected}`);
      return;
    }
    documents.forEach((doc: any) => {
      console.log(
        `#${doc.id.toString()} | name='${doc.name}' | owner=${doc.owner} | updatedAt=${doc.updatedAt.toString()} | canEdit=${doc.canEdit}`,
      );
    });
  });
