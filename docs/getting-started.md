# Getting started

## Prerequisites

- Node.js 18 or newer and npm
- Docker with Docker Compose
- Rust and the `wasm32v1-none` target for contract work
- Stellar CLI for building and deploying Soroban contracts
- A MongoDB instance (the repository Compose file provides one locally)

## Run the application

From the repository root, start infrastructure:

```bash
docker compose up -d
```

In one terminal, start the API:

```bash
cd server
npm install
cp .env.example .env
npm run dev
```

In another terminal, start the web client:

```bash
cd client
npm install
npm run dev
```

Review [environment variables](./env-variables.md) before using non-local services. To connect a browser wallet, follow the [Freighter setup guide](./freighter-setup.md).

## Run the documentation site

```bash
cd docs
npm install
npm run dev
```

VitePress prints the local documentation URL. Use `npm run build` to perform the same production build used by GitHub Pages and `npm run preview` to serve that build locally.

## Next steps

- Read the [architecture overview](./architecture.md).
- Browse the [API reference](./api-documentation.md).
- Learn how to [build and deploy contracts](./contract-deployment.md).
- Review [backend](./backend-testing.md) and [Rust](./rust-testing-guide.md) testing guidance.

