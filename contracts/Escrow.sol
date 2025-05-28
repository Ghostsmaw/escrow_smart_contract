// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title Escrow Smart Contract
 * @dev Facilitates transactions between a buyer and a seller with automatic timeout release
 */
contract Escrow {
    // State variables
    address public buyer;
    address public seller;
    uint256 public amount;
    uint256 public releaseTime;
    bool public isConfirmed;
    bool public isCancelled;
    bool public isReleased;

    // Events
    event EscrowInitiated(address buyer, address seller, uint256 amount, uint256 releaseTime);
    event FundsDeposited(address buyer, uint256 amount);
    event DeliveryConfirmed(address buyer);
    event FundsReleased(address seller, uint256 amount);
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
     */
    constructor(address _seller, uint256 _timeoutDuration) {
        require(_seller != address(0), "Invalid seller address");
        require(_timeoutDuration > 0, "Invalid timeout duration");

        buyer = msg.sender;
        seller = _seller;
        releaseTime = block.timestamp + _timeoutDuration;

        emit EscrowInitiated(buyer, seller, 0, releaseTime);
    }

    /**
     * @dev Allows buyer to deposit funds into escrow
     */
    function deposit() external payable onlyBuyer escrowActive {
        require(msg.value > 0, "Amount must be greater than 0");
        require(amount == 0, "Funds already deposited");

        amount = msg.value;
        emit FundsDeposited(buyer, msg.value);
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
    function cancelEscrow() external onlyBuyer escrowActive {
        require(block.timestamp < releaseTime, "Cannot cancel after timeout");
        require(!isConfirmed, "Cannot cancel after confirmation");

        isCancelled = true;
        payable(buyer).transfer(amount);
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
     * @dev Internal function to release funds to seller
     */
    function _releaseFunds() private {
        isReleased = true;
        payable(seller).transfer(amount);
        emit FundsReleased(seller, amount);
    }
} 