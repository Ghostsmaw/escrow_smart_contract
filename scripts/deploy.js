const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Get seller address and timeout from environment variables or use defaults
  const sellerAddress = process.env.SELLER_ADDRESS;
  if (!sellerAddress) {
    throw new Error("Please set SELLER_ADDRESS in your environment variables");
  }

  const timeoutDuration = process.env.TIMEOUT_DURATION || 86400; // 24 hours in seconds default

  console.log("Deploying Escrow contract...");
  console.log("Deployment parameters:");
  console.log("- Seller address:", sellerAddress);
  console.log("- Timeout duration:", timeoutDuration, "seconds");

  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(sellerAddress, timeoutDuration);

  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  console.log("\nEscrow contract deployed successfully!");
  console.log("Contract address:", address);
  
  // Log deployment verification instructions
  console.log("\nTo verify on Etherscan:");
  console.log(`npx hardhat verify --network ${hre.network.name} ${address} ${sellerAddress} ${timeoutDuration}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  }); 