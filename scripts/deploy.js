const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Get deployment parameters from environment variables
  const sellerAddress = process.env.SELLER_ADDRESS;
  if (!sellerAddress) {
    throw new Error("Please set SELLER_ADDRESS in your environment variables");
  }

  const timeoutDuration = process.env.TIMEOUT_DURATION || 86400; // 24 hours default
  const tokenAddress = process.env.TOKEN_ADDRESS || ethers.ZeroAddress; // Default to ETH

  console.log("\n=== Deployment Parameters ===");
  console.log("- Seller address:", sellerAddress);
  console.log("- Timeout duration:", timeoutDuration, "seconds");
  console.log("- Token address:", tokenAddress === ethers.ZeroAddress ? "ETH (Native)" : tokenAddress);

  // Deploy TestToken if we're on a test network and no token specified
  let deployedTokenAddress = tokenAddress;
  if (tokenAddress === ethers.ZeroAddress && (hre.network.name === "hardhat" || hre.network.name === "localhost")) {
    console.log("\n=== Deploying Test Token ===");
    const TestToken = await hre.ethers.getContractFactory("TestToken");
    const testToken = await TestToken.deploy();
    await testToken.waitForDeployment();
    deployedTokenAddress = await testToken.getAddress();
    console.log("TestToken deployed to:", deployedTokenAddress);
    
    // Mint some tokens to deployer for testing
    console.log("Minting 1000 tokens to deployer for testing...");
    await testToken.mint(deployer.address, ethers.parseUnits("1000", 18));
  }

  // Deploy Escrow contract
  console.log("\n=== Deploying Escrow Contract ===");
  const Escrow = await hre.ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(sellerAddress, timeoutDuration, deployedTokenAddress);
  await escrow.waitForDeployment();
  
  const escrowAddress = await escrow.getAddress();
  console.log("Escrow contract deployed to:", escrowAddress);

  // Display contract details
  console.log("\n=== Contract Details ===");
  console.log("- Buyer:", await escrow.buyer());
  console.log("- Seller:", await escrow.seller());
  console.log("- Is ETH:", await escrow.isETH());
  console.log("- Token:", await escrow.isETH() ? "ETH (Native)" : await escrow.token());
  console.log("- Release Time:", new Date((await escrow.releaseTime()) * 1000n).toLocaleString());
  console.log("- Status:", await escrow.getEscrowStatus());

  // Display usage instructions
  console.log("\n=== Usage Instructions ===");
  if (await escrow.isETH()) {
    console.log("This is an ETH escrow. To deposit:");
    console.log(`escrow.deposit(0, { value: ethers.parseEther("1.0") })`);
  } else {
    console.log("This is a Token escrow. To deposit:");
    console.log("1. First approve the escrow contract:");
    console.log(`token.approve("${escrowAddress}", amount)`);
    console.log("2. Then deposit:");
    console.log(`escrow.deposit(amount)`);
  }

  // Verification instructions
  if (hre.network.name !== "hardhat" && hre.network.name !== "localhost") {
    console.log("\n=== Verification ===");
    console.log("To verify on Etherscan:");
    console.log(`npx hardhat verify --network ${hre.network.name} ${escrowAddress} ${sellerAddress} ${timeoutDuration} ${deployedTokenAddress}`);
    
    if (deployedTokenAddress !== tokenAddress) {
      console.log(`npx hardhat verify --network ${hre.network.name} ${deployedTokenAddress}`);
    }
  }

  return {
    escrow: escrowAddress,
    token: deployedTokenAddress,
    seller: sellerAddress,
    timeout: timeoutDuration
  };
}

// Execute deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("\nDeployment failed:", error);
      process.exit(1);
    });
}

module.exports = main; 