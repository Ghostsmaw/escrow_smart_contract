// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Escrow.sol";

/**
 * @title EscrowFactory
 * @dev Factory contract to create and manage multiple escrow instances
 */
contract EscrowFactory {
    // Struct to store escrow details
    struct EscrowDetails {
        address escrowAddress;
        address buyer;
        address seller;
        uint256 amount;
        uint256 releaseTime;
        bool isActive;
    }

    // Mapping from escrow ID to EscrowDetails
    mapping(uint256 => EscrowDetails) public escrows;
    
    // Counter for generating unique escrow IDs
    uint256 private _escrowIdCounter;

    // Events
    event EscrowCreated(
        uint256 indexed escrowId,
        address indexed escrowAddress,
        address indexed buyer,
        address seller,
        uint256 timeoutDuration
    );

    /**
     * @dev Creates a new escrow instance
     * @param seller Address of the seller
     * @param timeoutDuration Duration in seconds after which funds are automatically released
     * @return escrowId Unique identifier for the created escrow
     */
    function createEscrow(address seller, uint256 timeoutDuration) external returns (uint256) {
        require(seller != address(0), "Invalid seller address");
        require(timeoutDuration > 0, "Invalid timeout duration");

        // Create new escrow contract
        Escrow newEscrow = new Escrow(seller, timeoutDuration);
        
        // Generate new escrow ID
        uint256 escrowId = _escrowIdCounter++;

        // Store escrow details
        escrows[escrowId] = EscrowDetails({
            escrowAddress: address(newEscrow),
            buyer: msg.sender,
            seller: seller,
            amount: 0,
            releaseTime: block.timestamp + timeoutDuration,
            isActive: true
        });

        emit EscrowCreated(
            escrowId,
            address(newEscrow),
            msg.sender,
            seller,
            timeoutDuration
        );

        return escrowId;
    }

    /**
     * @dev Get all active escrows for a user (either as buyer or seller)
     * @param user Address of the user
     * @return activeEscrowIds Array of active escrow IDs for the user
     */
    function getUserEscrows(address user) external view returns (uint256[] memory) {
        // First, count the number of active escrows for the user
        uint256 count = 0;
        for (uint256 i = 0; i < _escrowIdCounter; i++) {
            if (escrows[i].isActive && 
                (escrows[i].buyer == user || escrows[i].seller == user)) {
                count++;
            }
        }

        // Create array of appropriate size
        uint256[] memory activeEscrowIds = new uint256[](count);
        
        // Fill array with active escrow IDs
        uint256 index = 0;
        for (uint256 i = 0; i < _escrowIdCounter; i++) {
            if (escrows[i].isActive && 
                (escrows[i].buyer == user || escrows[i].seller == user)) {
                activeEscrowIds[index] = i;
                index++;
            }
        }

        return activeEscrowIds;
    }

    /**
     * @dev Get details of a specific escrow
     * @param escrowId ID of the escrow
     * @return details Struct containing escrow details
     */
    function getEscrowDetails(uint256 escrowId) external view returns (EscrowDetails memory) {
        require(escrowId < _escrowIdCounter, "Invalid escrow ID");
        return escrows[escrowId];
    }

    /**
     * @dev Update escrow amount when deposit is made
     * @param escrowId ID of the escrow
     * @param amount Amount deposited
     */
    function updateEscrowAmount(uint256 escrowId, uint256 amount) external {
        require(msg.sender == escrows[escrowId].escrowAddress, "Only escrow contract can update amount");
        escrows[escrowId].amount = amount;
    }

    /**
     * @dev Mark an escrow as inactive when it's completed or cancelled
     * @param escrowId ID of the escrow
     */
    function markEscrowInactive(uint256 escrowId) external {
        require(msg.sender == escrows[escrowId].escrowAddress, "Only escrow contract can mark inactive");
        escrows[escrowId].isActive = false;
    }
} 