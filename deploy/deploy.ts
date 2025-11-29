import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedDocuments = await deploy("PrivyDocuments", {
    from: deployer,
    log: true,
  });

  console.log(`PrivyDocuments contract: `, deployedDocuments.address);
};
export default func;
func.id = "deploy_privyDocuments"; // id required to prevent reexecution
func.tags = ["PrivyDocuments"];
