const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("EscrowFactory", function () {
  let escrowFactory;
  let buyer;
  let seller;
  let otherAccount;
  const TIMEOUT_DURATION = 86400; // 24 hours in seconds
  const DEPOSIT_AMOUNT = ethers.parseEther("1.0"); // 1 ETH

  beforeEach(async function () {
    [buyer, seller, otherAccount] = await ethers.getSigners();
    
    const EscrowFactory = await ethers.getContractFactory("EscrowFactory");
    escrowFactory = await EscrowFactory.deploy();
    await escrowFactory.waitForDeployment();
  });

  describe("Escrow Creation", function () {
    it("Should create a new escrow instance", async function () {
      const tx = await escrowFactory.createEscrow(seller.address, TIMEOUT_DURATION);
      const receipt = await tx.wait();
      
      // Get escrow ID from event
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'EscrowCreated'
      );
      const escrowId = event.args.escrowId;

      const escrowDetails = await escrowFactory.getEscrowDetails(escrowId);
      expect(escrowDetails.buyer).to.equal(buyer.address);
      expect(escrowDetails.seller).to.equal(seller.address);
      expect(escrowDetails.isActive).to.be.true;
    });

    it("Should not create escrow with zero address seller", async function () {
      await expect(
        escrowFactory.createEscrow(ethers.ZeroAddress, TIMEOUT_DURATION)
      ).to.be.revertedWith("Invalid seller address");
    });
  });

  describe("Escrow Management", function () {
    let escrowId;
    let escrowAddress;

    beforeEach(async function () {
      const tx = await escrowFactory.createEscrow(seller.address, TIMEOUT_DURATION);
      const receipt = await tx.wait();
      
      const event = receipt.logs.find(
        log => log.fragment && log.fragment.name === 'EscrowCreated'
      );
      escrowId = event.args.escrowId;
      escrowAddress = event.args.escrowAddress;
    });

    it("Should track user's escrows", async function () {
      // Create another escrow
      await escrowFactory.createEscrow(seller.address, TIMEOUT_DURATION);

      const buyerEscrows = await escrowFactory.getUserEscrows(buyer.address);
      expect(buyerEscrows.length).to.equal(2);

      const sellerEscrows = await escrowFactory.getUserEscrows(seller.address);
      expect(sellerEscrows.length).to.equal(2);
    });

    it("Should update escrow amount on deposit", async function () {
      const Escrow = await ethers.getContractFactory("Escrow");
      const escrow = Escrow.attach(escrowAddress);

      await escrow.deposit({ value: DEPOSIT_AMOUNT });

      const escrowDetails = await escrowFactory.getEscrowDetails(escrowId);
      expect(escrowDetails.amount).to.equal(DEPOSIT_AMOUNT);
    });

    it("Should mark escrow inactive when completed", async function () {
      const Escrow = await ethers.getContractFactory("Escrow");
      const escrow = Escrow.attach(escrowAddress);

      await escrow.deposit({ value: DEPOSIT_AMOUNT });
      await escrow.confirmDelivery();

      const escrowDetails = await escrowFactory.getEscrowDetails(escrowId);
      expect(escrowDetails.isActive).to.be.false;
    });

    it("Should mark escrow inactive when cancelled", async function () {
      const Escrow = await ethers.getContractFactory("Escrow");
      const escrow = Escrow.attach(escrowAddress);

      await escrow.deposit({ value: DEPOSIT_AMOUNT });
      await escrow.cancelEscrow();

      const escrowDetails = await escrowFactory.getEscrowDetails(escrowId);
      expect(escrowDetails.isActive).to.be.false;
    });
  });
}); 