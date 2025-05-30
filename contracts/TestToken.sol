// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title TestToken
 * @dev Simple ERC20 token for testing escrow functionality
 */
contract TestToken is ERC20 {
    constructor() ERC20("Test Token", "TEST") {
        // Mint 1 million tokens to the deployer
        _mint(msg.sender, 1000000 * 10**decimals());
    }

    /**
     * @dev Mint tokens to any address (for testing purposes)
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
} 