# SoroMint 🪙

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://github.com/EDOHWARES/SoroMint/workflows/CI/badge.svg)](https://github.com/EDOHWARES/SoroMint/actions)

SoroMint is a comprehensive, full-stack platform built on the **Stellar network** utilizing **Soroban smart contracts**. It provides a robust suite of tools for token minting, decentralized autonomous organizations (DAOs), multisignature wallets, streaming payments, and cross-chain bridging.

---

## 🌟 Key Features

- **Token Minting & Management**: Easily deploy standard tokens, update metadata, and wrap existing Stellar Assets into Soroban smart contracts.
- **Advanced Soroban Contracts**: 
  - **Streaming Payments**: Stream tokens by the ledger with fully customizable schedules.
  - **Multisig & DAO**: Govern assets collectively with role-based access control and proposal mechanisms.
  - **Decentralized OTC Escrow**: Perform trustless atomic swaps.
  - **ZK-Based KYC/AML**: Validate user identities securely on-chain.
- **Cross-Chain Bridge**: Fully operational relayer bridging EVM-compatible chains with Soroban.
- **Rich Analytics & Dashboards**: Real-time token metrics, volume tracking, and holder distributions powered by WebSockets and Redis.

## 🛠️ Technology Stack

- **Smart Contracts**: Rust, Soroban SDK
- **Frontend**: React 19, Vite, Tailwind CSS, Zustand, React Hook Form, Freighter Wallet API
- **Backend**: Node.js, Express, Stellar SDK, BullMQ (Queueing), Socket.io (Real-time events), Stripe
- **Databases**: MongoDB (Mongoose), Redis (Caching & Pub/Sub), PostgreSQL (via Knex)
- **Infrastructure**: Docker & Docker Compose (Stellar Quickstart)

## 🏗️ Architecture

SoroMint is composed of three main layers that interact seamlessly:

1. **Smart Contract Layer**: Deployed on the Stellar network (Futurenet/Testnet/Mainnet), handling all on-chain logic securely.
2. **Backend API Layer**: A robust Node.js service caching chain data in MongoDB, providing fast REST APIs, and indexing ledger events in real-time.
3. **Frontend Client Layer**: A responsive, modern React UI for end-users to manage their assets.

*For deep technical details on data flows and contract topologies, refer to our [Architecture Documentation](./ARCHITECTURE.md).*

## 🚀 Quick Start

### 1. Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [Rust & Cargo](https://rustup.rs/) (with `wasm32-unknown-unknown` target)
- [Docker & Docker Compose](https://www.docker.com/)
- [Freighter Wallet](https://www.stellar.org/freighter/) (Browser extension)

### 2. Infrastructure Setup

Spin up the local development environment (MongoDB, Redis, and Stellar Quickstart) using Docker:

```bash
docker-compose up -d
```

This provisions:
- **MongoDB** (`localhost:27017`)
- **Redis** (`localhost:6379`)
- **Stellar Quickstart Node** (`localhost:8000`)

### 3. Bootstrap the Local Network

Fund your test accounts and deploy the necessary mock contracts to the local network:

```bash
chmod +x scripts/bootstrap-local-network.sh
./scripts/bootstrap-local-network.sh
```

### 4. Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Update .env with your credentials and local configuration
npm run dev
```

### 5. Frontend Setup

```bash
cd client
npm install
npm run dev
```
Navigate to `http://localhost:5173` to view the application!

## 🧪 Testing & Benchmarking

SoroMint uses comprehensive test suites and benchmarking tools to ensure production readiness:

- **Contracts**: `cargo test --workspace`
- **Backend Unit/Integration Tests**: `cd server && npm test`
- **Load Testing (k6)**: `cd server && npm run k6:all`

## 🔐 Security

Security is our top priority. We implement robust authorization checks, integer overflow protections, and rate limiting across the stack.

If you discover a vulnerability, please review our [Security Policy](./SECURITY.md) for our coordinated disclosure process.

## 📄 License

This project is licensed under the [MIT License](LICENSE).
