const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("Escrow", function () {
  let escrow, escrowToken, escrowMilestone, escrowTokenMilestone;
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

    // Deploy Milestone ETH Escrow
    escrowMilestone = await Escrow.connect(buyer).deploy(
      seller.address, 
      TIMEOUT_DURATION, 
      ethers.ZeroAddress,
      owner.address
    );
    await escrowMilestone.waitForDeployment();

    // Deploy Milestone Token Escrow
    escrowTokenMilestone = await Escrow.connect(buyer).deploy(
      seller.address, 
      TIMEOUT_DURATION, 
      await testToken.getAddress(),
      owner.address
    );
    await escrowTokenMilestone.waitForDeployment();
    
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

    it("Should start with no milestones", async function () {
      expect(await escrow.hasMilestones()).to.equal(false);
      expect(await escrow.completedMilestones()).to.equal(0);
      expect(await escrow.totalReleasedAmount()).to.equal(0);
    });

    it("Should start with 'Awaiting Deposit' status", async function () {
      expect(await escrow.getEscrowStatus()).to.equal("Awaiting Deposit");
      expect(await escrowToken.getEscrowStatus()).to.equal("Awaiting Deposit");
    });
  });

  describe("Milestone Setup", function () {
    it("Should allow buyer to set up milestones before deposit", async function () {
      const descriptions = ["Design Phase", "Development Phase", "Testing Phase"];
      const percentages = [3000, 5000, 2000]; // 30%, 50%, 20%

      await expect(escrowMilestone.connect(buyer).setMilestones(descriptions, percentages))
        .to.emit(escrowMilestone, "MilestonesSet")
        .withArgs(3, 10000);

      expect(await escrowMilestone.hasMilestones()).to.equal(true);

      // Check first milestone
      const milestone0 = await escrowMilestone.getMilestone(0);
      expect(milestone0.description).to.equal("Design Phase");
      expect(milestone0.percentage).to.equal(3000);
      expect(milestone0.isCompleted).to.equal(false);
      expect(milestone0.isReleased).to.equal(false);
    });

    it("Should not allow setting milestones after deposit", async function () {
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });

      const descriptions = ["Phase 1"];
      const percentages = [10000];

      await expect(
        escrowMilestone.connect(buyer).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Cannot set milestones after deposit");
    });

    it("Should require total percentage to equal 100%", async function () {
      const descriptions = ["Phase 1", "Phase 2"];
      const percentages = [3000, 5000]; // Only 80%

      await expect(
        escrowMilestone.connect(buyer).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Total percentage must equal 100%");
    });

    it("Should not allow more than MAX_MILESTONES", async function () {
      const descriptions = new Array(11).fill("Phase");
      const percentages = new Array(11).fill(909); // 11 milestones

      await expect(
        escrowMilestone.connect(buyer).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Invalid milestone count");
    });

    it("Should not allow empty descriptions", async function () {
      const descriptions = ["Phase 1", ""];
      const percentages = [5000, 5000];

      await expect(
        escrowMilestone.connect(buyer).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Milestone description cannot be empty");
    });

    it("Should not allow zero percentages", async function () {
      const descriptions = ["Phase 1", "Phase 2"];
      const percentages = [5000, 0];

      await expect(
        escrowMilestone.connect(buyer).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Milestone percentage must be greater than 0");
    });

    it("Should not allow non-buyer to set milestones", async function () {
      const descriptions = ["Phase 1"];
      const percentages = [10000];

      await expect(
        escrowMilestone.connect(seller).setMilestones(descriptions, percentages)
      ).to.be.revertedWith("Only buyer can call this function");
    });
  });

  describe("Milestone Deposits", function () {
    beforeEach(async function () {
      // Set up milestones for ETH escrow
      const descriptions = ["Design", "Development", "Testing"];
      const percentages = [2500, 5000, 2500]; // 25%, 50%, 25%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);

      // Set up milestones for Token escrow
      await escrowTokenMilestone.connect(buyer).setMilestones(descriptions, percentages);
    });

    it("Should calculate milestone amounts correctly after ETH deposit", async function () {
      const depositAmount = ethers.parseEther("1.0");
      const expectedFee = depositAmount * 200n / 10000n; // 2%
      const expectedAmount = depositAmount - expectedFee;

      await escrowMilestone.connect(buyer).deposit(0, { value: depositAmount });

      // Check milestone amounts
      const milestone0 = await escrowMilestone.getMilestone(0);
      const milestone1 = await escrowMilestone.getMilestone(1);
      const milestone2 = await escrowMilestone.getMilestone(2);

      const expectedAmount0 = expectedAmount * 2500n / 10000n; // 25%
      const expectedAmount1 = expectedAmount * 5000n / 10000n; // 50%
      const expectedAmount2 = expectedAmount * 2500n / 10000n; // 25%

      expect(milestone0.amount).to.equal(expectedAmount0);
      expect(milestone1.amount).to.equal(expectedAmount1);
      expect(milestone2.amount).to.equal(expectedAmount2);
    });

    it("Should calculate milestone amounts correctly after token deposit", async function () {
      const depositAmount = TOKEN_AMOUNT;
      const expectedFee = depositAmount * 200n / 10000n; // 2%
      const expectedAmount = depositAmount - expectedFee;

      await testToken.connect(buyer).approve(await escrowTokenMilestone.getAddress(), depositAmount);
      await escrowTokenMilestone.connect(buyer).deposit(depositAmount);

      // Check milestone amounts
      const milestone0 = await escrowTokenMilestone.getMilestone(0);
      const milestone1 = await escrowTokenMilestone.getMilestone(1);
      const milestone2 = await escrowTokenMilestone.getMilestone(2);

      const expectedAmount0 = expectedAmount * 2500n / 10000n; // 25%
      const expectedAmount1 = expectedAmount * 5000n / 10000n; // 50%
      const expectedAmount2 = expectedAmount * 2500n / 10000n; // 25%

      expect(milestone0.amount).to.equal(expectedAmount0);
      expect(milestone1.amount).to.equal(expectedAmount1);
      expect(milestone2.amount).to.equal(expectedAmount2);
    });
  });

  describe("Milestone Completion", function () {
    beforeEach(async function () {
      // Set up milestones
      const descriptions = ["Design", "Development", "Testing"];
      const percentages = [2500, 5000, 2500]; // 25%, 50%, 25%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      
      // Make deposit
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
    });

    it("Should allow buyer to confirm milestones in order", async function () {
      // Confirm first milestone
      await expect(escrowMilestone.connect(buyer).confirmMilestone(0))
        .to.emit(escrowMilestone, "MilestoneCompleted")
        .withArgs(0, "Design", await (await escrowMilestone.getMilestone(0)).amount);

      expect(await escrowMilestone.completedMilestones()).to.equal(1);

      // Confirm second milestone
      await escrowMilestone.connect(buyer).confirmMilestone(1);
      expect(await escrowMilestone.completedMilestones()).to.equal(2);

      // Confirm third milestone
      await expect(escrowMilestone.connect(buyer).confirmMilestone(2))
        .to.emit(escrowMilestone, "AllMilestonesCompleted");

      expect(await escrowMilestone.completedMilestones()).to.equal(3);
      expect(await escrowMilestone.isConfirmed()).to.equal(true);
    });

    it("Should not allow confirming milestones out of order", async function () {
      // Try to confirm second milestone first
      await expect(
        escrowMilestone.connect(buyer).confirmMilestone(1)
      ).to.be.revertedWith("Previous milestone not completed");
    });

    it("Should not allow non-buyer to confirm milestones", async function () {
      await expect(
        escrowMilestone.connect(seller).confirmMilestone(0)
      ).to.be.revertedWith("Only buyer can call this function");
    });

    it("Should not allow confirming already completed milestones", async function () {
      await escrowMilestone.connect(buyer).confirmMilestone(0);
      
      await expect(
        escrowMilestone.connect(buyer).confirmMilestone(0)
      ).to.be.revertedWith("Milestone already completed");
    });

    it("Should not allow confirming milestones for non-milestone escrow", async function () {
      await expect(
        escrow.connect(buyer).confirmMilestone(0)
      ).to.be.revertedWith("Milestone does not exist");
    });

    it("Should update status correctly with milestone progress", async function () {
      expect(await escrowMilestone.getEscrowStatus()).to.equal("Pending (0/3 milestones)");
      
      await escrowMilestone.connect(buyer).confirmMilestone(0);
      expect(await escrowMilestone.getEscrowStatus()).to.equal("Pending (1/3 milestones)");
      
      await escrowMilestone.connect(buyer).confirmMilestone(1);
      expect(await escrowMilestone.getEscrowStatus()).to.equal("Pending (2/3 milestones)");
      
      await escrowMilestone.connect(buyer).confirmMilestone(2);
      expect(await escrowMilestone.getEscrowStatus()).to.equal("Confirmed");
    });
  });

  describe("Milestone Fund Release", function () {
    beforeEach(async function () {
      // Set up milestones
      const descriptions = ["Design", "Development", "Testing"];
      const percentages = [2500, 5000, 2500]; // 25%, 50%, 25%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      
      // Make deposit and confirm first milestone
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
      await escrowMilestone.connect(buyer).confirmMilestone(0);
    });

    it("Should allow seller to release funds for completed milestone", async function () {
      const sellerBalanceBefore = await ethers.provider.getBalance(seller.address);
      const milestone0 = await escrowMilestone.getMilestone(0);

      await expect(escrowMilestone.connect(seller).releaseMilestoneFunds(0))
        .to.emit(escrowMilestone, "MilestoneReleased")
        .withArgs(0, seller.address, milestone0.amount);

      const sellerBalanceAfter = await ethers.provider.getBalance(seller.address);
      expect(sellerBalanceAfter - sellerBalanceBefore).to.be.greaterThan(
        milestone0.amount - ethers.parseEther("0.01") // Account for gas
      );

      expect(await escrowMilestone.totalReleasedAmount()).to.equal(milestone0.amount);

      // Check milestone is marked as released
      const updatedMilestone = await escrowMilestone.getMilestone(0);
      expect(updatedMilestone.isReleased).to.equal(true);
    });

    it("Should not allow releasing funds for uncompleted milestone", async function () {
      await expect(
        escrowMilestone.connect(seller).releaseMilestoneFunds(1)
      ).to.be.revertedWith("Milestone not completed");
    });

    it("Should not allow releasing already released milestone funds", async function () {
      await escrowMilestone.connect(seller).releaseMilestoneFunds(0);
      
      await expect(
        escrowMilestone.connect(seller).releaseMilestoneFunds(0)
      ).to.be.revertedWith("Milestone funds already released");
    });

    it("Should not allow non-seller to release milestone funds", async function () {
      await expect(
        escrowMilestone.connect(buyer).releaseMilestoneFunds(0)
      ).to.be.revertedWith("Only seller can call this function");
    });

    it("Should mark escrow as released when all milestones are released", async function () {
      // Complete and release all milestones
      await escrowMilestone.connect(seller).releaseMilestoneFunds(0);
      
      await escrowMilestone.connect(buyer).confirmMilestone(1);
      await escrowMilestone.connect(seller).releaseMilestoneFunds(1);
      
      await escrowMilestone.connect(buyer).confirmMilestone(2);
      
      await expect(escrowMilestone.connect(seller).releaseMilestoneFunds(2))
        .to.emit(escrowMilestone, "FundsReleased");

      expect(await escrowMilestone.isReleased()).to.equal(true);
      expect(await escrowMilestone.getEscrowStatus()).to.equal("Released");
    });
  });

  describe("Milestone Cancellation", function () {
    beforeEach(async function () {
      // Set up milestones
      const descriptions = ["Design", "Development", "Testing"];
      const percentages = [2500, 5000, 2500]; // 25%, 50%, 25%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      
      // Make deposit
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
    });

    it("Should refund only unreleased milestone amounts on cancellation", async function () {
      // Complete and release first milestone
      await escrowMilestone.connect(buyer).confirmMilestone(0);
      await escrowMilestone.connect(seller).releaseMilestoneFunds(0);

      const buyerBalanceBefore = await ethers.provider.getBalance(buyer.address);
      const totalAmount = await escrowMilestone.amount();
      const releasedAmount = await escrowMilestone.totalReleasedAmount();
      const expectedRefund = totalAmount - releasedAmount;

      await escrowMilestone.connect(buyer).cancelEscrow();

      const buyerBalanceAfter = await ethers.provider.getBalance(buyer.address);
      expect(buyerBalanceAfter - buyerBalanceBefore).to.be.greaterThan(
        expectedRefund - ethers.parseEther("0.01") // Account for gas
      );

      expect(await escrowMilestone.getEscrowStatus()).to.equal("Cancelled");
    });
  });

  describe("Non-Milestone Functionality", function () {
    it("Should prevent using milestone functions on non-milestone escrow", async function () {
      await escrow.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });

      await expect(
        escrow.connect(buyer).confirmMilestone(0)
      ).to.be.revertedWith("Milestone does not exist");

      await expect(
        escrow.connect(seller).releaseMilestoneFunds(0)
      ).to.be.revertedWith("Milestone does not exist");
    });

    it("Should prevent using regular functions on milestone escrow", async function () {
      const descriptions = ["Phase 1"];
      const percentages = [10000];
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });

      await expect(
        escrowMilestone.connect(buyer).confirmDelivery()
      ).to.be.revertedWith("Use confirmMilestone for milestone-based escrows");

      await expect(
        escrowMilestone.connect(seller).releaseFunds()
      ).to.be.revertedWith("Use releaseMilestoneFunds for milestone-based escrows");
    });
  });

  describe("Enhanced Escrow Details", function () {
    it("Should return enhanced details including milestone information", async function () {
      const descriptions = ["Design", "Development"];
      const percentages = [4000, 6000]; // 40%, 60%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      await escrowMilestone.connect(buyer).deposit(0, { value: DEPOSIT_AMOUNT });
      
      const details = await escrowMilestone.getEscrowDetails();
      
      expect(details[9]).to.equal(true); // hasMilestones
      expect(details[10]).to.equal(2); // milestoneCount
      expect(details[11]).to.equal(0); // completedMilestones
      expect(details[12]).to.equal(0); // totalReleasedAmount
    });

    it("Should allow getting all milestones", async function () {
      const descriptions = ["Design", "Development"];
      const percentages = [4000, 6000]; // 40%, 60%
      await escrowMilestone.connect(buyer).setMilestones(descriptions, percentages);
      
      const allMilestones = await escrowMilestone.getAllMilestones();
      expect(allMilestones.length).to.equal(2);
      expect(allMilestones[0].description).to.equal("Design");
      expect(allMilestones[1].description).to.equal("Development");
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