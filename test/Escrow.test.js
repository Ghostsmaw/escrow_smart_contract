const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow", function () {
  let escrow, escrowToken;
  let testToken;
  let buyer, seller, owner, otherAccount;
  const TIMEOUT_DURATION = 86400; // 24 hours in seconds
  const DEPOSIT_AMOUNT = ethers.parseEther("1.0"); // 1 ETH
  const TOKEN_AMOUNT = ethers.parseUnits("100", 18); // 100 tokens

  beforeEach(async function () {
    [buyer, seller, owner, otherAccount] = await ethers.getSigners();
    
    // Deploy TestToken for ERC20 testing
    const TestToken = await ethers.getContractFactory("TestToken");
    testToken = await TestToken.deploy();
    await testToken.waitForDeployment();
    
    // Deploy ETH Escrow (token address = address(0))
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.connect(buyer).deploy(
      seller.address, 
      TIMEOUT_DURATION, 
      ethers.ZeroAddress,
      owner.address
    );
    await escrow.waitForDeployment();
    
    // Deploy Token Escrow
    escrowToken = await Escrow.connect(buyer).deploy(
      seller.address, 
      TIMEOUT_DURATION, 
      await testToken.getAddress(),
      owner.address
    );
    await escrowToken.waitForDeployment();
    
    // Mint tokens to buyer for testing
    await testToken.mint(buyer.address, TOKEN_AMOUNT * 10n); // Mint 1000 tokens
  });

  describe("Deployment", function () {
    it("Should set the right buyer, seller, and owner for ETH escrow", async function () {
      expect(await escrow.buyer()).to.equal(buyer.address);
      expect(await escrow.seller()).to.equal(seller.address);
      expect(await escrow.owner()).to.equal(owner.address);
      expect(await escrow.isETH()).to.equal(true);
    });

    it("Should set the right buyer, seller, and owner for Token escrow", async function () {
      expect(await escrowToken.buyer()).to.equal(buyer.address);
      expect(await escrowToken.seller()).to.equal(seller.address);
      expect(await escrowToken.owner()).to.equal(owner.address);
      expect(await escrowToken.isETH()).to.equal(false);
      expect(await escrowToken.token()).to.equal(await testToken.getAddress());
    });

    it("Should initialize with default fee configuration", async function () {
      const feeConfig = await escrow.getFeeConfig();
      expect(feeConfig.baseFee).to.equal(200); // 2%
      expect(feeConfig.isActive).to.equal(true);
      expect(await escrow.platformFee()).to.equal(200);
    });

    it("Should start with 'Awaiting Deposit' status", async function () {
      expect(await escrow.getEscrowStatus()).to.equal("Awaiting Deposit");
      expect(await escrowToken.getEscrowStatus()).to.equal("Awaiting Deposit");
    });
  });

  describe("Fee Calculation", function () {
    it("Should calculate correct fees for ETH", async function () {
      const depositAmount = ethers.parseEther("1.0");
      const expectedFee = depositAmount * 200n / 10000n; // 2%
      expect(await escrow.calculateFee(depositAmount)).to.equal(expectedFee);
    });

    it("Should use minimum fee when calculated fee is too low", async function () {
      const smallAmount = ethers.parseEther("0.0001"); // Very small amount
      const calculatedFee = await escrow.calculateFee(smallAmount);
      const feeConfig = await escrow.getFeeConfig();
      expect(calculatedFee).to.equal(feeConfig.minimumFee);
    });

    it("Should return zero fee when fees are disabled", async function () {
      await escrow.connect(owner).updateFeeConfig(0, 0, false);
      const depositAmount = ethers.parseEther("1.0");
      expect(await escrow.calculateFee(depositAmount)).to.equal(0);
    });
  });

  describe("ETH Deposits with Fees", function () {
    it("Should allow buyer to deposit ETH and collect fees", async function () {
      const depositAmount = ethers.parseEther("1.0");
      const expectedFee = depositAmount * 200n / 10000n; // 2%
      const expectedAmount = depositAmount - expectedFee;

      await escrow.connect(buyer).deposit(0, { value: depositAmount });
      
      expect(await escrow.amount()).to.equal(expectedAmount);
      expect(await escrow.collectedFees()).to.equal(expectedFee);
      expect(await escrow.getEscrowStatus()).to.equal("Pending");
    });

    it("Should reject deposits where amount is less than or equal to fee", async function () {
      const feeConfig = await escrow.getFeeConfig();
      const tinyAmount = feeConfig.minimumFee; // Exactly equal to minimum fee
      
      await expect(
        escrow.connect(buyer).deposit(0, { value: tinyAmount })
      ).to.be.revertedWith("Deposit amount must be greater than fee");
    });

    it("Should emit FundsDeposited event with fee information", async function () {
      const depositAmount = ethers.parseEther("1.0");
      const expectedFee = depositAmount * 200n / 10000n;
      const expectedAmount = depositAmount - expectedFee;

      await expect(escrow.connect(buyer).deposit(0, { value: depositAmount }))
        .to.emit(escrow, "FundsDeposited")
        .withArgs(buyer.address, ethers.ZeroAddress, expectedAmount, expectedFee);
    });
  });

  describe("Token Deposits with Fees", function () {
    it("Should allow buyer to deposit tokens after approval and collect fees", async function () {
      const depositAmount = TOKEN_AMOUNT;
      const expectedFee = depositAmount * 200n / 10000n; // 2%
      const expectedAmount = depositAmount - expectedFee;

      // First approve the escrow contract to spend tokens
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), depositAmount);
      
      // Then deposit tokens
      await escrowToken.connect(buyer).deposit(depositAmount);
      
      expect(await escrowToken.amount()).to.equal(expectedAmount);
      expect(await escrowToken.collectedFees()).to.equal(expectedFee);
      expect(await escrowToken.getEscrowStatus()).to.equal("Pending");
    });

    it("Should emit FundsDeposited event with fee information for tokens", async function () {
      const depositAmount = TOKEN_AMOUNT;
      const expectedFee = depositAmount * 200n / 10000n;
      const expectedAmount = depositAmount - expectedFee;

      await testToken.connect(buyer).approve(await escrowToken.getAddress(), depositAmount);
      
      await expect(escrowToken.connect(buyer).deposit(depositAmount))
        .to.emit(escrowToken, "FundsDeposited")
        .withArgs(buyer.address, await testToken.getAddress(), expectedAmount, expectedFee);
    });
  });

  describe("Fee Collection", function () {
    beforeEach(async function () {
      // Set up escrows with deposits
      await escrow.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
      
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      await escrowToken.connect(buyer).deposit(TOKEN_AMOUNT);
    });

    it("Should allow owner to collect ETH fees after escrow completion", async function () {
      // Complete the escrow
      await escrow.connect(buyer).confirmDelivery();
      
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);
      
      await escrow.connect(owner).collectFees();
      
      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.be.greaterThan(
        expectedFee - ethers.parseEther("0.01") // Account for gas
      );
      
      expect(await escrow.collectedFees()).to.equal(0);
    });

    it("Should allow owner to collect token fees after escrow completion", async function () {
      // Complete the escrow
      await escrowToken.connect(buyer).confirmDelivery();
      
      const expectedFee = TOKEN_AMOUNT * 200n / 10000n;
      const ownerBalanceBefore = await testToken.balanceOf(owner.address);
      
      await escrowToken.connect(owner).collectFees();
      
      const ownerBalanceAfter = await testToken.balanceOf(owner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(expectedFee);
      
      expect(await escrowToken.collectedFees()).to.equal(0);
    });

    it("Should not allow fee collection before escrow completion", async function () {
      await expect(
        escrow.connect(owner).collectFees()
      ).to.be.revertedWith("Escrow must be completed to collect fees");
    });

    it("Should not allow non-owner to collect fees", async function () {
      await escrow.connect(buyer).confirmDelivery();
      
      await expect(
        escrow.connect(buyer).collectFees()
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("Should emit FeesCollected event", async function () {
      await escrow.connect(buyer).confirmDelivery();
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      
      await expect(escrow.connect(owner).collectFees())
        .to.emit(escrow, "FeesCollected")
        .withArgs(owner.address, ethers.ZeroAddress, expectedFee);
    });
  });

  describe("Fee Configuration", function () {
    it("Should allow owner to update fee configuration", async function () {
      const newBaseFee = 300; // 3%
      const newMinimumFee = ethers.parseEther("0.002");
      
      await expect(escrow.connect(owner).updateFeeConfig(newBaseFee, newMinimumFee, true))
        .to.emit(escrow, "FeeConfigUpdated")
        .withArgs(newBaseFee, newMinimumFee, true);
      
      const feeConfig = await escrow.getFeeConfig();
      expect(feeConfig.baseFee).to.equal(newBaseFee);
      expect(feeConfig.minimumFee).to.equal(newMinimumFee);
      expect(feeConfig.isActive).to.equal(true);
    });

    it("Should not allow setting fee higher than maximum", async function () {
      const tooHighFee = 600; // 6% (max is 5%)
      
      await expect(
        escrow.connect(owner).updateFeeConfig(tooHighFee, 0, true)
      ).to.be.revertedWith("Fee too high");
    });

    it("Should not allow non-owner to update fee configuration", async function () {
      await expect(
        escrow.connect(buyer).updateFeeConfig(300, 0, true)
      ).to.be.revertedWithCustomError(escrow, "OwnableUnauthorizedAccount");
    });

    it("Should update platform fee for new escrow when configuration changes", async function () {
      const newBaseFee = 300; // 3%
      await escrow.connect(owner).updateFeeConfig(newBaseFee, 0, true);
      
      expect(await escrow.platformFee()).to.equal(newBaseFee);
    });
  });

  describe("ETH Confirmation and Release with Fees", function () {
    beforeEach(async function () {
      await escrow.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
    });

    it("Should allow buyer to confirm delivery and release funds to seller", async function () {
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      const expectedAmount = DEPOSIT_AMOUNT - expectedFee;
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      
      await escrow.connect(buyer).confirmDelivery();
      
      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(expectedAmount);
      expect(await escrow.getEscrowStatus()).to.equal("Released");
    });

    it("Should emit FundsReleased event with fee information", async function () {
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      const expectedAmount = DEPOSIT_AMOUNT - expectedFee;
      
      await expect(escrow.connect(buyer).confirmDelivery())
        .to.emit(escrow, "FundsReleased")
        .withArgs(seller.address, ethers.ZeroAddress, expectedAmount, expectedFee);
    });
  });

  describe("Token Confirmation and Release with Fees", function () {
    beforeEach(async function () {
      await testToken.connect(buyer).approve(await escrowToken.getAddress(), TOKEN_AMOUNT);
      await escrowToken.connect(buyer).deposit(TOKEN_AMOUNT);
    });

    it("Should allow buyer to confirm delivery and release tokens to seller", async function () {
      const expectedFee = TOKEN_AMOUNT * 200n / 10000n;
      const expectedAmount = TOKEN_AMOUNT - expectedFee;
      const sellerBalanceBefore = await testToken.balanceOf(seller.address);
      
      await escrowToken.connect(buyer).confirmDelivery();
      
      const sellerBalanceAfter = await testToken.balanceOf(seller.address);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.equal(expectedAmount);
      expect(await escrowToken.getEscrowStatus()).to.equal("Released");
    });
  });

  describe("Cancellation with Fees", function () {
    it("Should allow buyer to cancel ETH escrow but keep fees", async function () {
      await escrow.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
      
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      const expectedRefund = DEPOSIT_AMOUNT - expectedFee;
      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
      
      await escrow.connect(buyer).cancelEscrow();
      
      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);
      // Account for gas costs by checking the range
      expect(buyerBalanceAfter - buyerBalanceBefore).to.be.greaterThan(
        expectedRefund - ethers.parseEther("0.01")
      );
      expect(buyerBalanceAfter - buyerBalanceBefore).to.be.lessThan(
        expectedRefund + ethers.parseEther("0.01")
      );
      
      // Fees should still be collected
      expect(await escrow.collectedFees()).to.equal(expectedFee);
      expect(await escrow.getEscrowStatus()).to.equal("Cancelled");
    });
  });

  describe("Escrow Details with Fees", function () {
    it("Should return correct escrow details including fee information", async function () {
      await escrow.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
      
      const details = await escrow.getEscrowDetails();
      const expectedFee = DEPOSIT_AMOUNT * 200n / 10000n;
      
      expect(details[0]).to.equal(buyer.address); // buyer
      expect(details[1]).to.equal(seller.address); // seller
      expect(details[2]).to.equal(ethers.ZeroAddress); // token
      expect(details[5]).to.equal(true); // isETH
      expect(details[6]).to.equal("Pending"); // status
      expect(details[7]).to.equal(200); // platformFee
      expect(details[8]).to.equal(expectedFee); // collectedFees
    });
  });
}); 