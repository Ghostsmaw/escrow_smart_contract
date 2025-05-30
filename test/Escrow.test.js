const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow", function () {
  let escrow, escrowToken;
  let testToken;
  let buyer, seller, otherAccount;
  const TIMEOUT_DURATION = 86400; // 24 hours in seconds
  const DEPOSIT_AMOUNT = ethers.parseEther("1.0"); // 1 ETH
  const TOKEN_AMOUNT = ethers.parseUnits("100", 18); // 100 tokens

  beforeEach(async function () {
    [buyer, seller, otherAccount] = await ethers.getSigners();
    
    // Deploy TestToken for ERC20 testing
    const TestToken = await ethers.getContractFactory("TestToken");
    testToken = await TestToken.deploy();
    await testToken.waitForDeployment();
    
    // Deploy ETH Escrow (token address = address(0))
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.deploy(seller.address, TIMEOUT_DURATION, ethers.ZeroAddress);
    await escrow.waitForDeployment();
    
    // Deploy Token Escrow
    escrowToken = await Escrow.deploy(seller.address, TIMEOUT_DURATION, await testToken.getAddress());
    await escrowToken.waitForDeployment();
    
    // Mint tokens to buyer for testing
    await testToken.mint(buyer.address, TOKEN_AMOUNT * 10n); // Mint 1000 tokens
  });

  describe("Deployment", function () {
    it("Should set the right buyer and seller for ETH escrow", async function () {
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.isETH()).to.equal(true);
    });

    it("Should set the right buyer and seller for Token escrow", async function () {
      expect(await escrowToken.buyer()).to.equal(buyer.address);
      expect(await escrowToken.seller()).to.equal(seller.address);
      expect(await escrowToken.isETH()).to.equal(false);
      expect(await escrowToken.token()).to.equal(await testToken.getAddress());
    });

    it("Should start with 'Awaiting Deposit' status", async function () {
      expect(await escrow.getEscrowStatus()).to.equal("Awaiting Deposit");
      expect(await escrowToken.getEscrowStatus()).to.equal("Awaiting Deposit");
    });
  });

  describe("ETH Deposits", function () {
    it("Should allow buyer to deposit ETH", async function () {
      await escrow.deposit(0, { value: DEPOSIT_AMOUNT });
      expect(await escrow.amount()).to.equal(DEPOSIT_AMOUNT);
      expect(await escrow.getEscrowStatus()).to.equal("Pending");
    });

    it("Should not allow non-buyer to deposit ETH", async function () {
      await expect(
        escrow.connect(otherAccount).deposit(0, { value: DEPOSIT_AMOUNT })
      ).to.be.revertedWith("Only buyer can call this function");
    });

    it("Should not allow double deposits", async function () {
      await escrow.deposit(0, { value: DEPOSIT_AMOUNT });
      await expect(
        escrow.deposit(0, { value: DEPOSIT_AMOUNT })
      ).to.be.revertedWith("Funds already deposited");
    });
  });

  describe("Token Deposits", function () {
    it("Should allow buyer to deposit tokens after approval", async function () {
      // First approve the escrow contract to spend tokens
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      
      // Then deposit tokens
      await escrowToken.connect(buyer).deposit(TOKEN_AMOUNT);
      
      expect(await escrowToken.amount()).to.equal(TOKEN_AMOUNT);
      expect(await escrowToken.getEscrowStatus()).to.equal("Pending");
    });

    it("Should not allow token deposit without approval", async function () {
      await expect(
        escrowToken.connect(buyer).deposit(TOKEN_AMOUNT)
      ).to.be.reverted;
    });

    it("Should not allow ETH to be sent with token deposits", async function () {
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      
      await expect(
        escrowToken.connect(buyer).deposit(TOKEN_AMOUNT, { value: DEPOSIT_AMOUNT })
      ).to.be.revertedWith("Do not send ETH for token deposits");
    });
  });

  describe("ETH Confirmation and Release", function () {
    beforeEach(async function () {
      await escrow.deposit(0, { value: DEPOSIT_AMOUNT });
    });

    it("Should allow buyer to confirm delivery", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      
      await escrow.confirmDelivery();
      
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(DEPOSIT_AMOUNT);
      expect(await escrow.getEscrowStatus()).to.equal("Released");
    });

    it("Should allow seller to withdraw after timeout", async function () {
      await time.increase(TIMEOUT_DURATION + 1);
      
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      await escrow.connect(seller).releaseFunds();
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      
      // Account for gas costs by checking if balance increased significantly
      expect(sellerBalanceAfter - sellerBalanceBefore).to.be.greaterThan(
        DEPOSIT_AMOUNT - ethers.parseEther("0.01")
      );
      expect(await escrow.getEscrowStatus()).to.equal("Released");
    });
  });

  describe("Token Confirmation and Release", function () {
    beforeEach(async function () {
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      await escrowToken.connect(buyer).deposit(TOKEN_AMOUNT);
    });

    it("Should allow buyer to confirm delivery", async function () {
      const sellerBalanceBefore = await testToken.balanceOf(seller.address);
      
      await escrowToken.connect(buyer).confirmDelivery();
      
      const sellerBalanceAfter = await testToken.balanceOf(seller.address);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(TOKEN_AMOUNT);
      expect(await escrowToken.getEscrowStatus()).to.equal("Released");
    });

    it("Should allow seller to withdraw tokens after timeout", async function () {
      await time.increase(TIMEOUT_DURATION + 1);
      
      const sellerBalanceBefore = await testToken.balanceOf(seller.address);
      await escrowToken.connect(seller).releaseFunds();
      const sellerBalanceAfter = await testToken.balanceOf(seller.address);
      
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(TOKEN_AMOUNT);
      expect(await escrowToken.getEscrowStatus()).to.equal("Released");
    });
  });

  describe("Cancellation", function () {
    it("Should allow buyer to cancel ETH escrow before timeout", async function () {
      await escrow.deposit(0, { value: DEPOSIT_AMOUNT });
      
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
      await escrow.cancelEscrow();
      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);
      
      // Account for gas costs
      expect(buyerBalanceAfter - buyerBalanceBefore).to.be.greaterThan(
        DEPOSIT_AMOUNT - ethers.parseEther("0.01")
      );
      expect(await escrow.getEscrowStatus()).to.equal("Cancelled");
    });

    it("Should allow buyer to cancel token escrow before timeout", async function () {
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      await escrowToken.connect(buyer).deposit(TOKEN_AMOUNT);
      
      const buyerBalanceBefore = await testToken.balanceOf(buyer.address);
      await escrowToken.connect(buyer).cancelEscrow();
      const buyerBalanceAfter = await testToken.balanceOf(buyer.address);
      
      expect(buyerBalanceAfter - buyerBalanceBefore).to.equal(TOKEN_AMOUNT);
      expect(await escrowToken.getEscrowStatus()).to.equal("Cancelled");
    });

    it("Should not allow cancellation after timeout", async function () {
      await escrow.deposit(0, { value: DEPOSIT_AMOUNT });
      await time.increase(TIMEOUT_DURATION + 1);
      
      await expect(escrow.cancelEscrow()).to.be.revertedWith(
        "Cannot cancel after timeout"
      );
    });
  });

  describe("Escrow Details", function () {
    it("Should return correct escrow details for ETH", async function () {
      const details = await escrow.getEscrowDetails();
      
      expect(details[0]).to.equal(buyer.address); // buyer
      expect(details[1]).to.equal(seller.address); // seller
      expect(details[2]).to.equal(ethers.ZeroAddress); // token (0x0 for ETH)
      expect(details[4]).to.be.greaterThan(0); // releaseTime
      expect(details[5]).to.equal(true); // isETH
      expect(details[6]).to.equal("Awaiting Deposit"); // status
    });

    it("Should return correct escrow details for tokens", async function () {
      const details = await escrowToken.getEscrowDetails();
      
      expect(details[0]).to.equal(buyer.address); // buyer
      expect(details[1]).to.equal(seller.address); // seller
      expect(details[2]).to.equal(await testToken.getAddress()); // token
      expect(details[4]).to.be.greaterThan(0); // releaseTime
      expect(details[5]).to.equal(false); // isETH
      expect(details[6]).to.equal("Awaiting Deposit"); // status
    });
  });
}); 