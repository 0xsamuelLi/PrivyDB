import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { expect } from "chai";
import { PrivyDocuments, PrivyDocuments__factory } from "../types";

interface Signers {
  owner: HardhatEthersSigner;
  collaborator: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
}

async function encryptRandomEditorKey(contractAddress: string, ownerAddress: string) {
  const randomKey = ethers.Wallet.createRandom().address;
  const encryptedKey = await fhevm
    .createEncryptedInput(contractAddress, ownerAddress)
    .addAddress(randomKey)
    .encrypt();

  return encryptedKey;
}

describe("PrivyDocuments", () => {
  let contract: PrivyDocuments;
  let contractAddress: string;
  let signers: Signers;

  before(async () => {
    const accounts: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { owner: accounts[0], collaborator: accounts[1], outsider: accounts[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn("This test suite relies on the local FHEVM mock environment");
      this.skip();
    }

    const factory = (await ethers.getContractFactory("PrivyDocuments")) as PrivyDocuments__factory;
    contract = (await factory.deploy()) as PrivyDocuments;
    contractAddress = await contract.getAddress();
  });

  it("creates a document with an encrypted key", async () => {
    const encryptedKey = await encryptRandomEditorKey(contractAddress, signers.owner.address);

    await contract
      .connect(signers.owner)
      .createDocument("Doc Alpha", encryptedKey.handles[0], encryptedKey.inputProof);
    const documentId = await contract.totalDocuments();

    const hasOwnerAccess = await contract.hasAccess(documentId, signers.owner.address);
    expect(hasOwnerAccess).to.be.true;

    const details = await contract.getDocumentDetails(documentId);
    expect(details.name).to.eq("Doc Alpha");
    expect(details.owner).to.eq(signers.owner.address);
    expect(details.encryptedBody).to.eq("0x");
    expect(details.encryptedKey).to.not.eq(ethers.ZeroHash);

    const previews = await contract.getDocumentsFor(signers.owner.address);
    expect(previews.length).to.eq(1);
    expect(previews[0].id).to.eq(documentId);
    expect(previews[0].canEdit).to.be.true;
  });

  it("allows collaborators to edit after receiving access", async () => {
    const encryptedKey = await encryptRandomEditorKey(contractAddress, signers.owner.address);

    await contract
      .connect(signers.owner)
      .createDocument("Collab Document", encryptedKey.handles[0], encryptedKey.inputProof);
    const docId = await contract.totalDocuments();

    await expect(contract.connect(signers.collaborator).updateDocumentBody(docId, "0x1234")).to.be.revertedWithCustomError(
      contract,
      "NotAuthorizedEditor",
    );

    await contract.connect(signers.owner).grantDocumentAccess(docId, signers.collaborator.address);
    expect(await contract.hasAccess(docId, signers.collaborator.address)).to.be.true;

    await contract.connect(signers.collaborator).updateDocumentBody(docId, "0x1234");
    const updatedDetails = await contract.getDocumentDetails(docId);
    expect(updatedDetails.encryptedBody).to.eq("0x1234");

    const collaboratorDocs = await contract.getDocumentsFor(signers.collaborator.address);
    expect(collaboratorDocs.length).to.eq(1);
    expect(collaboratorDocs[0].canEdit).to.be.true;
  });

  it("revokes collaborator access", async () => {
    const encryptedKey = await encryptRandomEditorKey(contractAddress, signers.owner.address);

    await contract
      .connect(signers.owner)
      .createDocument("Revocable", encryptedKey.handles[0], encryptedKey.inputProof);
    const docId = await contract.totalDocuments();

    await contract.connect(signers.owner).grantDocumentAccess(docId, signers.collaborator.address);
    await contract.connect(signers.collaborator).updateDocumentBody(docId, "0xbeef");

    await contract.connect(signers.owner).revokeDocumentAccess(docId, signers.collaborator.address);

    await expect(contract.connect(signers.collaborator).updateDocumentBody(docId, "0x1234")).to.be.revertedWithCustomError(
      contract,
      "NotAuthorizedEditor",
    );

    const collaborators = await contract.getCollaborators(docId);
    expect(collaborators).to.deep.eq([]);
  });
});
