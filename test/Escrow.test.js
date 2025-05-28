const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow", function () {
  let escrow;
  let buyer;
  let seller;
  let otherAccount;
  const TIMEOUT_DURATION = 86400; // 24 hours in seconds
  const DEPOSIT_AMOUNT = ethers.parseEther("1.0"); // 1 ETH

  beforeEach(async function () {
    [buyer, seller, otherAccount] = await ethers.getSigners();
    
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(seller.address, TIMEOUT_DURATION);
    await escrow.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the right buyer and seller", async function () {
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.seller()).to.equal(seller.address);
    });

    it("Should start with 'Awaiting Deposit' status", async function () {
      expect(await escrow.getEscrowStatus()).to.equal("Awaiting Deposit");
    });
  });

  describe("Deposits", function () {
    it("Should allow buyer to deposit funds", async function () {
      await escrow.deposit({ value: DEPOSIT_AMOUNT });
      expect(await escrow.amount()).to.equal(DEPOSIT_AMOUNT);
      expect(await escrow.getEscrowStatus()).to.equal("Pending");
    });

    it("Should not allow non-buyer to deposit", async function () {
      await expect(
        escrow.connect(otherAccount).deposit({ value: DEPOSIT_AMOUNT })
      ).to.be.revertedWith("Only buyer can call this function");
    });
  });

  describe("Confirmation and Release", function () {
    beforeEach(async function () {
      await escrow.deposit({ value: DEPOSIT_AMOUNT });
    });

    it("Should allow buyer to confirm delivery", async function () {
      await escrow.confirmDelivery();
      expect(await escrow.getEscrowStatus()).to.equal("Released");
    });

    it("Should allow seller to withdraw after timeout", async function () {
      await time.increase(TIMEOUT_DURATION + 1);
      await escrow.connect(seller).releaseFunds();
      expect(await escrow.getEscrowStatus()).to.equal("Released");
    });
  });

  describe("Cancellation", function () {
    beforeEach(async function () {
      await escrow.deposit({ value: DEPOSIT_AMOUNT });
    });

    it("Should allow buyer to cancel before timeout", async function () {
      await escrow.cancelEscrow();
      expect(await escrow.getEscrowStatus()).to.equal("Cancelled");
    });

    it("Should not allow cancellation after timeout", async function () {
      await time.increase(TIMEOUT_DURATION + 1);
      await expect(escrow.cancelEscrow()).to.be.revertedWith(
        "Cannot cancel after timeout"
      );
    });
  });
}); 