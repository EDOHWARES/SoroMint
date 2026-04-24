# SoroMint

A full-stack Soroban Token Minting platform.

## Project Structure
- `/client`: React frontend built with Vite, Tailwind CSS, and Lucide icons.
- `/server`: Node.js/Express backend with Stellar SDK integration and Mongoose models.

## Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Docker & Docker Compose](https://www.docker.com/)
- [Freighter Wallet](https://www.stellar.org/freighter/) (Browser extension)

### 2. Infrastructure
Spin up the local MongoDB instance:
```bash
docker-compose up -d
```

### 3. Backend Setup
```bash
cd server
npm install
cp .env.example .env
# Update .env with your credentials
npm run dev
```

### 4. Frontend Setup
```bash
cd client
npm install
npm run dev
```

## Environment Variables
Ensure your `.env` file in the `/server` directory contains:
- `SOROBAN_RPC_URL`: The RPC endpoint for Soroban (e.g., Futurenet/Testnet).
- `NETWORK_PASSPHRASE`: The passphrase for the target network.
- `MONGO_URI`: Connection string for MongoDB.
- `CORS_ALLOWED_ORIGINS`: Comma-separated frontend origin whitelist for browser access to the API.
- `BRIDGE_RELAYER_ENABLED`: Enables the cross-chain bridge relayer.
- `BRIDGE_RELAYER_DIRECTION`: Controls whether the relayer watches `both`, `soroban-to-evm`, or `evm-to-soroban`.
- `BRIDGE_SOROBAN_ACCOUNT_ID`: Soroban account or bridge contract to watch for events.
- `BRIDGE_EVM_RPC_URL`: JSON-RPC endpoint for the EVM-compatible chain.
- `BRIDGE_EVM_BRIDGE_ADDRESS`: Bridge contract address for EVM log polling.
- `BRIDGE_RELAY_ENDPOINT_URL`: HTTP endpoint that receives normalized relay commands.

## Features
- **Connect Wallet**: Integrated placeholder for Stellar wallets.
- **Mint Tokens**: Wrap Stellar Assets or deploy custom contracts.
- **Asset Dashboard**: Track your deployed tokens stored in MongoDB.
- **Bridge Relayer**: Monitor cross-chain bridge events and forward normalized relay commands to an execution endpoint.
