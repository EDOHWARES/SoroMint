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
Spin up the local development environment (MongoDB, Redis, and Stellar Quickstart):
```bash
docker-compose up -d
```

This starts:
- **MongoDB** on port `27017`
- **Redis** on port `6379`
- **Stellar Quickstart** (standalone Soroban RPC) on port `8000`

### 3. Bootstrap the Local Network
Run the bootstrap script to fund test accounts and deploy mock contracts:
```bash
chmod +x scripts/bootstrap-local-network.sh
./scripts/bootstrap-local-network.sh
```

The script will:
1. Wait for the Stellar Quickstart RPC to become ready
2. Fund test accounts via the built-in friendbot
3. Deploy mock contracts from the `contracts/` directory

### 4. Backend Setup
```bash
cd server
npm install
cp .env.example .env
# Update .env with your credentials
npm run dev
```

### 5. Frontend Setup
```bash
cd client
npm install
npm run dev
```

## Local Development Environment

The `docker-compose.yml` includes a `stellar-quickstart` service that provides a standalone Stellar network with Soroban RPC and Horizon. This eliminates the need for public testnet/futurenet access during local development.

### Configuration
- **Local RPC URL**: `http://localhost:8000`
- **Network Passphrase**: `Standalone Network ; February 2017`
- **Friendbot**: `http://localhost:8000/friendbot`

The `.env.example` is pre-configured with these local endpoints. Copy it to `.env` and set `ADMIN_SECRET_KEY` to a keypair generated with `soroban keys generate` for contract deployment and account funding.

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
## Security
SoroMint maintains a security-first mindset. For vulnerability reporting and our audit fast-track process, see [SECURITY.md](./SECURITY.md).
