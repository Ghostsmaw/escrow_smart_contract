// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title Escrow Smart Contract
 * @dev Facilitates transactions between a buyer and a seller with automatic timeout release
 * Supports both ETH and ERC20 tokens
 */
contract Escrow is ReentrancyGuard {
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

    // Events
    event EscrowInitiated(
        address buyer, 
        address seller, 
        address token, 
        uint256 amount, 
        uint256 releaseTime
    );
    event FundsDeposited(address buyer, address token, uint256 amount);
    event DeliveryConfirmed(address buyer);
    event FundsReleased(address seller, address token, uint256 amount);
    event EscrowCancelled(address buyer);

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

    /**
     * @dev Constructor to initialize the escrow
     * @param _seller Address of the seller
     * @param _timeoutDuration Duration in seconds after which funds are automatically released
     * @param _token Address of ERC20 token (address(0) for ETH)
     */
    constructor(
        address _seller, 
        uint256 _timeoutDuration, 
        address _token
    ) {
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

        emit EscrowInitiated(buyer, seller, _token, 0, releaseTime);
    }

    /**
     * @dev Allows buyer to deposit funds into escrow
     * For ETH: send value with transaction
     * For ERC20: must approve this contract first, then call with amount
     * @param _amount Amount of tokens to deposit (ignored for ETH)
     */
    function deposit(uint256 _amount) external payable onlyBuyer escrowActive nonReentrant {
        require(amount == 0, "Funds already deposited");

        if (isETH) {
            require(msg.value > 0, "ETH amount must be greater than 0");
            amount = msg.value;
            emit FundsDeposited(buyer, address(0), msg.value);
        } else {
            require(_amount > 0, "Token amount must be greater than 0");
            require(msg.value == 0, "Do not send ETH for token deposits");
            
            // Transfer tokens from buyer to this contract
            require(
                token.transferFrom(msg.sender, address(this), _amount),
                "Token transfer failed"
            );
            
            amount = _amount;
            emit FundsDeposited(buyer, address(token), _amount);
        }
    }

    /**
     * @dev Allows buyer to confirm delivery
     */
    function confirmDelivery() external onlyBuyer escrowActive {
        require(amount > 0, "No funds in escrow");
        
        isConfirmed = true;
        emit DeliveryConfirmed(buyer);
        _releaseFunds();
    }

    /**
     * @dev Allows seller to withdraw funds after timeout or confirmation
     */
    function releaseFunds() external onlySeller escrowActive {
        require(amount > 0, "No funds in escrow");
        require(isConfirmed || block.timestamp >= releaseTime, "Cannot release funds yet");

        _releaseFunds();
    }

    /**
     * @dev Allows buyer to cancel escrow before timeout
     */
    function cancelEscrow() external onlyBuyer escrowActive nonReentrant {
        require(block.timestamp < releaseTime, "Cannot cancel after timeout");
        require(!isConfirmed, "Cannot cancel after confirmation");

        isCancelled = true;
        
        if (isETH) {
            payable(buyer).transfer(amount);
        } else {
            require(token.transfer(buyer, amount), "Token transfer failed");
        }
        
        emit EscrowCancelled(buyer);
    }

    /**
     * @dev Returns the current status of the escrow
     */
    function getEscrowStatus() external view returns (string memory) {
        if (isReleased) return "Released";
        if (isCancelled) return "Cancelled";
        if (isConfirmed) return "Confirmed";
        if (amount > 0) return "Pending";
        return "Awaiting Deposit";
    }

    /**
     * @dev Returns escrow details
     */
    function getEscrowDetails() external view returns (
        address _buyer,
        address _seller,
        address _token,
        uint256 _amount,
        uint256 _releaseTime,
        bool _isETH,
        string memory _status
    ) {
        return (
            buyer,
            seller,
            isETH ? address(0) : address(token),
            amount,
            releaseTime,
            isETH,
            this.getEscrowStatus()
        );
    }

    /**
     * @dev Internal function to release funds to seller
     */
    function _releaseFunds() private nonReentrant {
        isReleased = true;
        
        if (isETH) {
            payable(seller).transfer(amount);
            emit FundsReleased(seller, address(0), amount);
        } else {
            require(token.transfer(seller, amount), "Token transfer failed");
            emit FundsReleased(seller, address(token), amount);
        }
    }
} 