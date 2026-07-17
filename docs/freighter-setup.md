# Freighter wallet setup

Freighter is the browser wallet used to authorize Stellar and Soroban transactions in the SoroMint client.

## Install and create an account

1. Install Freighter from the official [Freighter website](https://www.freighter.app/).
2. Create a wallet or import an existing recovery phrase.
3. Store the recovery phrase offline. Never add it to `.env`, commit it, or share it with a contributor.
4. Open Freighter settings and select **Testnet** for development.

## Fund a testnet account

Copy the public address (it starts with `G`) and fund it using [Stellar testnet faucet](https://developers.stellar.org/docs/tools/quickstart/faucet). Friendbot funds testnet accounts only; testnet balances have no monetary value.

## Connect to SoroMint

1. Start the client and API using the [local setup](./getting-started.md).
2. Open the client URL in the browser where Freighter is installed.
3. Select **Connect Wallet** and approve the SoroMint origin.
4. Check that the address shown by SoroMint matches the active Freighter account and that both use the same network.

Freighter displays transaction details before signing. Confirm the network, contract, method, and amount. Reject any transaction you do not recognize.

## Troubleshooting

- If the wallet is not detected, unlock Freighter and reload the page.
- If authorization fails, disconnect the site in Freighter and reconnect it.
- If simulation or submission fails, confirm the client, backend `NETWORK_PASSPHRASE`, and RPC URL all target testnet.
- If an account is missing, ensure the selected Freighter account was funded on the currently selected network.

