import { ethers, deployments, fhevm } from "hardhat";
import { expect } from "chai";
import { PrivyDocuments } from "../types";

/**
 * Run with: npx hardhat test --network sepolia test/PrivyDocumentsSepolia.ts
 */
describe("PrivyDocumentsSepolia", function () {
  let contract: PrivyDocuments;

  before(async function () {
    if (fhevm.isMock) {
      console.warn("Sepolia test suite skipped when running against the local mock");
      this.skip();
    }

    const deployment = await deployments.get("PrivyDocuments");
    contract = (await ethers.getContractAt("PrivyDocuments", deployment.address)) as PrivyDocuments;
  });

  it("exposes the number of registered documents", async function () {
    const total = await contract.totalDocuments();
    expect(total).to.be.at.least(0n);
  });
});
