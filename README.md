# 🔒 Escrow Smart Contract

A secure and simple Escrow smart contract that facilitates trustless transactions between buyers and sellers on the Ethereum blockchain.

## 📝 Features

- Secure fund deposits from buyers
- Automatic release mechanism after timeout
- Buyer confirmation of delivery
- Cancellation option before timeout
- Status tracking
- Event emissions for all major actions

## 🛠 Technical Stack

- Solidity ^0.8.19
- Hardhat Development Environment
- OpenZeppelin Contracts
- Chai for testing

## 🚀 Getting Started

### Prerequisites

- Node.js (v14+ recommended)
- npm or yarn
- An Ethereum wallet (e.g., MetaMask)
- Infura account (for deployment)

### Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd escrow
```

2. Install dependencies:
```bash
npm install
```

### 🔐 Environment Setup

1. Create a `.env` file in the root directory:
```bash
cp .env.example .env
```

2. Fill in your environment variables:
```bash
# Network RPC URLs
INFURA_API_URL=https://sepolia.infura.io/v3/your-project-id

# Deployment accounts (DO NOT share or commit these!)
PRIVATE_KEY=your-private-key-here
SELLER_ADDRESS=seller-ethereum-address

# Contract settings
TIMEOUT_DURATION=86400  # 24 hours in seconds
```

⚠️ SECURITY WARNINGS:
- NEVER commit your `.env` file
- NEVER share your private keys
- NEVER push sensitive information to public repositories
- Keep your mnemonic phrase and private keys secure
- Use separate deployment accounts for testing and production

### 🧪 Testing

Run the test suite:
```bash
npx hardhat test
```

### 📦 Deployment

1. Ensure your `.env` file is properly configured
2. Deploy to network:
```bash
npx hardhat run scripts/deploy.js --network <network-name>
```

## 🔍 Contract Usage

1. Deploy the contract with:
   - Seller's address
   - Timeout duration (in seconds)

2. Buyer deposits funds using the `deposit()` function

3. After receiving the goods/services, buyer can:
   - Confirm delivery using `confirmDelivery()`
   - Cancel the escrow using `cancelEscrow()` (if before timeout)

4. Seller can withdraw funds:
   - After buyer confirmation
   - After timeout period

## 🔐 Security Considerations

- All functions have appropriate access controls
- Timeout mechanism prevents indefinite fund locks
- Cancel function allows dispute resolution
- Uses SafeMath for calculations
- Events emitted for all major actions
- Environment variables used for sensitive data
- No hardcoded addresses or private keys
- Proper input validation and error handling

## 🛡️ Security Best Practices

1. Always use environment variables for:
   - Private keys
   - API keys
   - RPC URLs with API keys
   - Contract addresses

2. Before deployment:
   - Test thoroughly on testnet
   - Consider a professional audit
   - Use separate wallets for testing and production
   - Verify contract on Etherscan

3. After deployment:
   - Monitor contract events
   - Have a contingency plan for issues
   - Keep deployment keys secure

## 📜 License

MIT License

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. 