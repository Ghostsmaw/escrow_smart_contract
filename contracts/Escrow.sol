// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Escrow Smart Contract
 * @dev Facilitates transactions between a buyer and a seller with automatic timeout release
 * Supports both ETH and ERC20 tokens with fee collection mechanism and milestone-based releases
 */
contract Escrow is ReentrancyGuard, Ownable {
    // State variables
    address public buyer;
    address public seller;
    uint256 public amount;
    uint256 public releaseTime;
    bool public isConfirmed;
    bool public isCancelled;
    bool public isReleased;
    
    // Token support
    IERC20 public token; // Address(0) for ETH, contract address for ERC20
    bool public isETH;

    // Fee system
    uint256 public platformFee; // Fee percentage in basis points (100 = 1%)
    uint256 public constant MAX_FEE = 500; // Maximum 5% fee
    uint256 public constant FEE_DENOMINATOR = 10000; // 100% = 10000 basis points
    uint256 public collectedFees; // Total fees collected for this escrow
    
    // Static fee configuration (set by owner)
    struct FeeConfig {
        uint256 baseFee; // Base fee percentage in basis points
        uint256 minimumFee; // Minimum fee amount (in wei or token units)
        bool isActive; // Whether fees are active
    }
    
    FeeConfig public feeConfig;

    // Milestone system
    struct Milestone {
        string description; // Description of what needs to be completed
        uint256 percentage; // Percentage of total amount (in basis points)
        bool isCompleted; // Whether buyer has confirmed this milestone
        bool isReleased; // Whether funds for this milestone have been released
        uint256 amount; // Actual amount for this milestone (calculated from percentage)
    }
    
    Milestone[] public milestones;
    bool public hasMilestones; // Whether this escrow uses milestones
    uint256 public totalReleasedAmount; // Total amount released across all milestones
    uint256 public completedMilestones; // Number of completed milestones
    
    // Constants for milestone system
    uint256 public constant MAX_MILESTONES = 10; // Maximum number of milestones

    // Events
    event EscrowInitiated(
        address buyer, 
        address seller, 
        address token, 
        uint256 amount, 
        uint256 releaseTime,
        uint256 platformFee,
        bool hasMilestones
    );
    event FundsDeposited(address buyer, address token, uint256 amount, uint256 fee);
    event DeliveryConfirmed(address buyer);
    event FundsReleased(address seller, address token, uint256 amount, uint256 fee);
    event EscrowCancelled(address buyer);
    event FeesCollected(address owner, address token, uint256 amount);
    event FeeConfigUpdated(uint256 baseFee, uint256 minimumFee, bool isActive);
    
    // Milestone events
    event MilestonesSet(uint256 milestoneCount, uint256 totalPercentage);
    event MilestoneCompleted(uint256 indexed milestoneIndex, string description, uint256 amount);
    event MilestoneReleased(uint256 indexed milestoneIndex, address seller, uint256 amount);
    event AllMilestonesCompleted();

    // Modifiers
    modifier onlyBuyer() {
        require(msg.sender == buyer, "Only buyer can call this function");
        _;
    }

    modifier onlySeller() {
        require(msg.sender == seller, "Only seller can call this function");
        _;
    }

    modifier escrowActive() {
        require(!isReleased && !isCancelled, "Escrow is not active");
        _;
    }

    modifier milestoneExists(uint256 _milestoneIndex) {
        require(_milestoneIndex < milestones.length, "Milestone does not exist");
        _;
    }

    /**
     * @dev Constructor to initialize the escrow
     * @param _seller Address of the seller
     * @param _timeoutDuration Duration in seconds after which funds are automatically released
     * @param _token Address of ERC20 token (address(0) for ETH)
     * @param _owner Address of the contract owner (fee collector)
     */
    constructor(
        address _seller, 
        uint256 _timeoutDuration, 
        address _token,
        address _owner
    ) Ownable(_owner) {
        require(_seller != address(0), "Invalid seller address");
        require(_timeoutDuration > 0, "Invalid timeout duration");

        buyer = msg.sender;
        seller = _seller;
        releaseTime = block.timestamp + _timeoutDuration;
        
        if (_token == address(0)) {
            isETH = true;
        } else {
            isETH = false;
            token = IERC20(_token);
        }

        // Initialize with default fee configuration (2% fee, 0.001 ETH/token minimum)
        feeConfig = FeeConfig({
            baseFee: 200, // 2% fee
            minimumFee: isETH ? 0.001 ether : 1000000000000000, // 0.001 ETH or equivalent tokens
            isActive: true
        });

        platformFee = feeConfig.baseFee;

        emit EscrowInitiated(buyer, seller, _token, 0, releaseTime, platformFee, false);
    }

    /**
     * @dev Set up milestones for progressive release (can only be called before deposit)
     * @param _descriptions Array of milestone descriptions
     * @param _percentages Array of milestone percentages (in basis points)
     */
    function setMilestones(
        string[] calldata _descriptions,
        uint256[] calldata _percentages
    ) external onlyBuyer escrowActive {
        require(amount == 0, "Cannot set milestones after deposit");
        require(_descriptions.length == _percentages.length, "Arrays length mismatch");
        require(_descriptions.length > 0 && _descriptions.length <= MAX_MILESTONES, "Invalid milestone count");
        require(!hasMilestones, "Milestones already set");
        
        uint256 totalPercentage = 0;
        
        // Clear any existing milestones
        delete milestones;
        
        for (uint256 i = 0; i < _descriptions.length; i++) {
            require(_percentages[i] > 0, "Milestone percentage must be greater than 0");
            require(bytes(_descriptions[i]).length > 0, "Milestone description cannot be empty");
            
            milestones.push(Milestone({
                description: _descriptions[i],
                percentage: _percentages[i],
                isCompleted: false,
                isReleased: false,
                amount: 0 // Will be calculated after deposit
            }));
            
            totalPercentage += _percentages[i];
        }
        
        require(totalPercentage == FEE_DENOMINATOR, "Total percentage must equal 100%");
        
        hasMilestones = true;
        emit MilestonesSet(milestones.length, totalPercentage);
    }

    /**
     * @dev Calculate the platform fee for a given amount
     * @param _amount The amount to calculate fee for
     * @return The fee amount
     */
    function calculateFee(uint256 _amount) public view returns (uint256) {
        if (!feeConfig.isActive) {
            return 0;
        }
        
        uint256 calculatedFee = (_amount * feeConfig.baseFee) / FEE_DENOMINATOR;
        
        // Ensure minimum fee is met
        if (calculatedFee < feeConfig.minimumFee) {
            return feeConfig.minimumFee;
        }
        
        return calculatedFee;
    }

    /**
     * @dev Allows buyer to deposit funds into escrow
     * For ETH: send value with transaction
     * For ERC20: must approve this contract first, then call with amount
     * @param _amount Amount of tokens to deposit (ignored for ETH)
     */
    function deposit(uint256 _amount) external payable onlyBuyer escrowActive nonReentrant {
        require(amount == 0, "Funds already deposited");

        uint256 depositAmount;
        uint256 feeAmount;

        if (isETH) {
            require(msg.value > 0, "ETH amount must be greater than 0");
            depositAmount = msg.value;
            feeAmount = calculateFee(depositAmount);
            require(depositAmount > feeAmount, "Deposit amount must be greater than fee");
            
            amount = depositAmount - feeAmount;
            collectedFees = feeAmount;
            
            emit FundsDeposited(buyer, address(0), amount, feeAmount);
        } else {
            require(_amount > 0, "Token amount must be greater than 0");
            require(msg.value == 0, "Do not send ETH for token deposits");
            
            feeAmount = calculateFee(_amount);
            require(_amount > feeAmount, "Deposit amount must be greater than fee");
            
            // Transfer total amount (including fee) from buyer to this contract
            require(
                token.transferFrom(msg.sender, address(this), _amount),
                "Token transfer failed"
            );
            
            amount = _amount - feeAmount;
            collectedFees = feeAmount;
            
            emit FundsDeposited(buyer, address(token), amount, feeAmount);
        }

        // Calculate milestone amounts if milestones are set
        if (hasMilestones) {
            for (uint256 i = 0; i < milestones.length; i++) {
                milestones[i].amount = (amount * milestones[i].percentage) / FEE_DENOMINATOR;
            }
        }
    }

    /**
     * @dev Allows buyer to confirm completion of a specific milestone
     * @param _milestoneIndex Index of the milestone to confirm
     */
    function confirmMilestone(uint256 _milestoneIndex) 
        external 
        onlyBuyer 
        escrowActive 
        milestoneExists(_milestoneIndex) 
    {
        require(amount > 0, "No funds in escrow");
        require(hasMilestones, "This escrow does not use milestones");
        require(!milestones[_milestoneIndex].isCompleted, "Milestone already completed");
        
        // Ensure milestones are completed in order
        if (_milestoneIndex > 0) {
            require(milestones[_milestoneIndex - 1].isCompleted, "Previous milestone not completed");
        }
        
        milestones[_milestoneIndex].isCompleted = true;
        completedMilestones++;
        
        emit MilestoneCompleted(
            _milestoneIndex, 
            milestones[_milestoneIndex].description, 
            milestones[_milestoneIndex].amount
        );
        
        // Check if all milestones are completed
        if (completedMilestones == milestones.length) {
            isConfirmed = true;
            emit AllMilestonesCompleted();
        }
    }

    /**
     * @dev Allows seller to release funds for a completed milestone
     * @param _milestoneIndex Index of the milestone to release funds for
     */
    function releaseMilestoneFunds(uint256 _milestoneIndex) 
        external 
        onlySeller 
        escrowActive 
        milestoneExists(_milestoneIndex) 
        nonReentrant 
    {
        require(hasMilestones, "This escrow does not use milestones");
        require(milestones[_milestoneIndex].isCompleted, "Milestone not completed");
        require(!milestones[_milestoneIndex].isReleased, "Milestone funds already released");
        
        milestones[_milestoneIndex].isReleased = true;
        uint256 releaseAmount = milestones[_milestoneIndex].amount;
        totalReleasedAmount += releaseAmount;
        
        if (isETH) {
            payable(seller).transfer(releaseAmount);
        } else {
            require(token.transfer(seller, releaseAmount), "Token transfer failed");
        }
        
        emit MilestoneReleased(_milestoneIndex, seller, releaseAmount);
        
        // Check if all milestone funds have been released
        if (totalReleasedAmount == amount) {
            isReleased = true;
            emit FundsReleased(seller, isETH ? address(0) : address(token), amount, collectedFees);
        }
    }

    /**
     * @dev Allows buyer to confirm delivery (for non-milestone escrows)
     */
    function confirmDelivery() external onlyBuyer escrowActive {
        require(amount > 0, "No funds in escrow");
        require(!hasMilestones, "Use confirmMilestone for milestone-based escrows");
        
        isConfirmed = true;
        emit DeliveryConfirmed(buyer);
        _releaseFunds();
    }

    /**
     * @dev Allows seller to withdraw funds after timeout or confirmation (for non-milestone escrows)
     */
    function releaseFunds() external onlySeller escrowActive {
        require(amount > 0, "No funds in escrow");
        require(!hasMilestones, "Use releaseMilestoneFunds for milestone-based escrows");
        require(isConfirmed || block.timestamp >= releaseTime, "Cannot release funds yet");

        _releaseFunds();
    }

    /**
     * @dev Allows buyer to cancel escrow before timeout
     * Note: Fees are not refunded on cancellation, and only unreleased milestone funds are returned
     */
    function cancelEscrow() external onlyBuyer escrowActive nonReentrant {
        require(block.timestamp < releaseTime, "Cannot cancel after timeout");
        require(!isConfirmed, "Cannot cancel after confirmation");

        isCancelled = true;
        
        uint256 refundAmount;
        if (hasMilestones) {
            // Only refund unreleased milestone amounts
            refundAmount = amount - totalReleasedAmount;
        } else {
            refundAmount = amount;
        }
        
        if (refundAmount > 0) {
            if (isETH) {
                payable(buyer).transfer(refundAmount);
            } else {
                require(token.transfer(buyer, refundAmount), "Token transfer failed");
            }
        }
        
        emit EscrowCancelled(buyer);
    }

    /**
     * @dev Allows contract owner to collect accumulated fees
     */
    function collectFees() external onlyOwner nonReentrant {
        require(collectedFees > 0, "No fees to collect");
        require(isReleased || isCancelled, "Escrow must be completed to collect fees");
        
        uint256 feesToCollect = collectedFees;
        collectedFees = 0;
        
        if (isETH) {
            payable(owner()).transfer(feesToCollect);
            emit FeesCollected(owner(), address(0), feesToCollect);
        } else {
            require(token.transfer(owner(), feesToCollect), "Fee transfer failed");
            emit FeesCollected(owner(), address(token), feesToCollect);
        }
    }

    /**
     * @dev Allows owner to update fee configuration
     * @param _baseFee New base fee in basis points
     * @param _minimumFee New minimum fee amount
     * @param _isActive Whether fees should be active
     */
    function updateFeeConfig(
        uint256 _baseFee, 
        uint256 _minimumFee, 
        bool _isActive
    ) external onlyOwner {
        require(_baseFee <= MAX_FEE, "Fee too high");
        
        feeConfig.baseFee = _baseFee;
        feeConfig.minimumFee = _minimumFee;
        feeConfig.isActive = _isActive;
        
        // Update current escrow's fee if not yet deposited
        if (amount == 0) {
            platformFee = _baseFee;
        }
        
        emit FeeConfigUpdated(_baseFee, _minimumFee, _isActive);
    }

    /**
     * @dev Returns the current status of the escrow
     */
    function getEscrowStatus() external view returns (string memory) {
        if (isReleased) return "Released";
        if (isCancelled) return "Cancelled";
        if (isConfirmed) return "Confirmed";
        if (amount > 0) {
            if (hasMilestones) {
                return string(abi.encodePacked("Pending (", 
                    _toString(completedMilestones), "/", _toString(milestones.length), " milestones)"));
            }
            return "Pending";
        }
        return "Awaiting Deposit";
    }

    /**
     * @dev Returns escrow details including fee and milestone information
     */
    function getEscrowDetails() external view returns (
        address _buyer,
        address _seller,
        address _token,
        uint256 _amount,
        uint256 _releaseTime,
        bool _isETH,
        string memory _status,
        uint256 _platformFee,
        uint256 _collectedFees,
        bool _hasMilestones,
        uint256 _milestoneCount,
        uint256 _completedMilestones,
        uint256 _totalReleasedAmount
    ) {
        return (
            buyer,
            seller,
            isETH ? address(0) : address(token),
            amount,
            releaseTime,
            isETH,
            this.getEscrowStatus(),
            platformFee,
            collectedFees,
            hasMilestones,
            milestones.length,
            completedMilestones,
            totalReleasedAmount
        );
    }

    /**
     * @dev Get milestone details
     * @param _milestoneIndex Index of the milestone
     */
    function getMilestone(uint256 _milestoneIndex) 
        external 
        view 
        milestoneExists(_milestoneIndex) 
        returns (
            string memory description,
            uint256 percentage,
            bool isCompleted,
            bool isReleased,
            uint256 amount
        ) 
    {
        Milestone storage milestone = milestones[_milestoneIndex];
        return (
            milestone.description,
            milestone.percentage,
            milestone.isCompleted,
            milestone.isReleased,
            milestone.amount
        );
    }

    /**
     * @dev Get all milestones
     */
    function getAllMilestones() external view returns (Milestone[] memory) {
        return milestones;
    }

    /**
     * @dev Get current fee configuration
     */
    function getFeeConfig() external view returns (FeeConfig memory) {
        return feeConfig;
    }

    /**
     * @dev Internal function to release funds to seller (for non-milestone escrows)
     */
    function _releaseFunds() private nonReentrant {
        isReleased = true;
        
        if (isETH) {
            payable(seller).transfer(amount);
            emit FundsReleased(seller, address(0), amount, collectedFees);
        } else {
            require(token.transfer(seller, amount), "Token transfer failed");
            emit FundsReleased(seller, address(token), amount, collectedFees);
        }
    }

    /**
     * @dev Convert uint to string
     */
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) {
            return "0";
        }
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) {
            digits++;
            temp /= 10;
        }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
} 