const {
  Keypair,
  Networks,
  TransactionBuilder,
  Operation,
  Account,
  StrKey,
} = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');

const CHALLENGE_TIMEOUT_SECONDS = 300; // 5 minutes

/**
 * Builds a SEP-10 challenge transaction for the given client public key.
 * @param {string} clientPublicKey - Client's Stellar G-address
 * @returns {{ transaction: string, network_passphrase: string }}
 */
const buildChallenge = (clientPublicKey) => {
  const env = getEnv();
  const secret = process.env.SEP10_SERVER_SECRET || env.SEP10_SERVER_SECRET;
  const homeDomain = process.env.SEP10_HOME_DOMAIN || env.SEP10_HOME_DOMAIN || 'soromint.app';
  const networkPassphrase = process.env.NETWORK_PASSPHRASE || env.NETWORK_PASSPHRASE;

  const serverKeypair = Keypair.fromSecret(secret);

  const account = new Account(serverKeypair.publicKey(), '-1');

  const transaction = new TransactionBuilder(account, {
    fee: '100',
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: `${homeDomain} auth`,
        value: Keypair.random().publicKey(), // random nonce
        source: clientPublicKey,
      })
    )
    .setTimeout(CHALLENGE_TIMEOUT_SECONDS)
    .build();

  transaction.sign(serverKeypair);

  return {
    transaction: transaction.toEnvelope().toXDR('base64'),
    network_passphrase: networkPassphrase,
  };
};

/**
 * Verifies a signed SEP-10 challenge transaction.
 * Checks server signature, client signature, and time bounds.
 * @param {string} transactionXdr - Base64-encoded signed transaction envelope
 * @returns {string} The verified client public key
 * @throws {Error} If verification fails
 */
const verifyChallenge = (transactionXdr) => {
  const env = getEnv();
  const secret = process.env.SEP10_SERVER_SECRET || env.SEP10_SERVER_SECRET;
  const networkPassphrase = process.env.NETWORK_PASSPHRASE || env.NETWORK_PASSPHRASE;

  const serverKeypair = Keypair.fromSecret(secret);

  const { TransactionBuilder: TB } = require('@stellar/stellar-sdk');
  const tx = TB.fromXDR(transactionXdr, networkPassphrase);

  // Validate time bounds
  const now = Math.floor(Date.now() / 1000);
  const { minTime, maxTime } = tx.timeBounds || {};
  if (!minTime || !maxTime || now < Number(minTime) || now > Number(maxTime)) {
    throw new Error('Challenge transaction has expired or invalid time bounds');
  }

  // Verify server signed the transaction
  const serverSigned = tx.signatures.some((sig) =>
    serverKeypair.verify(tx.hash(), sig.signature())
  );
  if (!serverSigned) {
    throw new Error('Challenge not signed by server');
  }

  // Extract client public key from the manage_data operation source
  const op = tx.operations[0];
  if (!op || op.type !== 'manageData') {
    throw new Error('Invalid challenge transaction structure');
  }

  const clientPublicKey = op.source;
  if (!clientPublicKey || !StrKey.isValidEd25519PublicKey(clientPublicKey)) {
    throw new Error('Invalid client public key in challenge');
  }

  const clientKeypair = Keypair.fromPublicKey(clientPublicKey);

  // Verify client signed the transaction
  const clientSigned = tx.signatures.some((sig) => {
    try {
      return clientKeypair.verify(tx.hash(), sig.signature());
    } catch {
      return false;
    }
  });

  if (!clientSigned) {
    throw new Error('Challenge not signed by client');
  }

  return clientPublicKey;
};

module.exports = { buildChallenge, verifyChallenge };
