const hre = require("hardhat");
require("dotenv").config();

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account:", deployer.address);

  // Deploy the EscrowFactory contract
  console.log("\nDeploying EscrowFactory...");
  const EscrowFactory = await hre.ethers.getContractFactory("EscrowFactory");
  const escrowFactory = await EscrowFactory.deploy();
  await escrowFactory.waitForDeployment();
  const factoryAddress = await escrowFactory.getAddress();

  console.log("\nDeployment successful!");
  console.log("EscrowFactory address:", factoryAddress);
  
  // Log deployment verification instructions
  console.log("\nTo verify on Etherscan:");
  console.log(`npx hardhat verify --network ${hre.network.name} ${factoryAddress}`);

  // Create an example escrow (optional)
  if (process.env.CREATE_EXAMPLE_ESCROW === "true") {
    console.log("\nCreating example escrow...");
    const exampleSeller = process.env.EXAMPLE_SELLER_ADDRESS;
    const timeoutDuration = 86400; // 24 hours

    if (exampleSeller) {
      const tx = await escrowFactory.createEscrow(exampleSeller, timeoutDuration);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'EscrowCreated'
      );
      const escrowId = event.args.escrowId;
      const escrowAddress = event.args.escrowAddress;

      console.log("Example escrow created:");
      console.log("- Escrow ID:", escrowId.toString());
      console.log("- Escrow Address:", escrowAddress);
      console.log("- Seller Address:", exampleSeller);
      console.log("- Timeout Duration:", timeoutDuration, "seconds");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  }); 