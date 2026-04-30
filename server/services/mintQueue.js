import { Queue, Worker } from 'bullmq';
import logger from '../utils/logger';
import Redis from 'ioredis';
import {
  Keypair,
  Networks,
  TransactionBuilder,
  Contract,
  SorobanRpc,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';

// 1. Setup Redis Connection
const connection = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

// 2. Define the Queue
export const mintQueue = new Queue('MintQueue', { connection });

// 3. Setup Soroban RPC & Network Configurations
const RPC_URL =
  process.env.SOROBAN_RPC_URL || 'https://soroban-testnet.stellar.org';
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;
const rpcServer = new SorobanRpc.Server(RPC_URL);

if (!process.env.ADMIN_SECRET_KEY) {
  logger.warn('ADMIN_SECRET_KEY is not set in the environment variables');
  console.warn(
    'WARNING: ADMIN_SECRET_KEY is not set in the environment variables!'
  );
}

// 4. Create the Worker
const mintWorker = new Worker(
  'MintQueue',
  async (job) => {
    logger.info('Mint worker processing job', {
      jobId: job.id,
      contractId: job.data.contractId,
      recipientAddress: job.data.recipientAddress,
      amount: job.data.amount,
    });
    const { contractId, recipientAddress, amount } = job.data;

    try {
      // 4a. Initialize Admin Keypair and fetch current on-chain account state
      const adminKeypair = Keypair.fromSecret(process.env.ADMIN_SECRET_KEY);
      const adminAccount = await rpcServer.getAccount(adminKeypair.publicKey());

      const contract = new Contract(contractId);

      // 4b. Build the base transaction
      let tx = new TransactionBuilder(adminAccount, {
        fee: '100',
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'mint',
            new Address(recipientAddress).toScVal(),
            nativeToScVal(amount, { type: 'i128' })
          )
        )
        .setTimeout(30)
        .build();

      // 4c. Simulate & Prepare
      logger.info('Mint worker simulating transaction', {
        jobId: job.id,
        contractId,
        recipientAddress,
        amount,
      });
      const preparedTx = await rpcServer.prepareTransaction(tx);

      // 4d. Sign the fully assembled transaction
      preparedTx.sign(adminKeypair);

      // 4e. Submit to the network
      logger.info('Mint worker submitting transaction', {
        jobId: job.id,
        contractId,
        recipientAddress,
        amount,
      });
      const sendResponse = await rpcServer.sendTransaction(preparedTx);

      if (sendResponse.status === 'ERROR') {
        throw new Error(`Submission rejected: ${JSON.stringify(sendResponse)}`);
      }

      // 4f. Poll for the final status
      logger.info('Mint worker transaction submitted', {
        jobId: job.id,
        contractId,
        recipientAddress,
        amount,
        txHash: sendResponse.hash,
      });
      
      console.log(
        `[MintWorker] Transaction submitted with hash ${sendResponse.hash}. Waiting for ledger...`
      );

      let txStatus = await rpcServer.getTransaction(sendResponse.hash);
      let attempts = 0;

      while (txStatus.status === 'NOT_FOUND' && attempts < 10) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        txStatus = await rpcServer.getTransaction(sendResponse.hash);
        attempts++;
      }

      if (txStatus.status === 'FAILED') {
        throw new Error(
          `Transaction failed on chain: ${JSON.stringify(txStatus.resultMetaXdr)}`
        );
      }

      if (txStatus.status === 'SUCCESS') {
        logger.info('Mint worker successfully minted tokens', {
          jobId: job.id,
          contractId,
          recipientAddress,
          amount,
          txHash: sendResponse.hash,
        });
        console.log(
          `[MintWorker] Successfully minted ${amount} tokens to ${recipientAddress} via contract ${contractId}`
        );
        return { success: true, txHash: sendResponse.hash };
      }

      throw new Error(
        `Transaction timed out or stuck in unknown state: ${txStatus.status}`
      );
    } catch (error) {
      logger.error('Mint worker failed to execute mint', {
        jobId: job.id,
        contractId,
        recipientAddress,
        amount,
        error,
      });
      throw error; 
      console.error(
        `[MintWorker] Failed to execute mint for job ${job.id}:`,
        error
      );
      throw error;
    }
  },
  {
    connection,
    concurrency: 1,
  }
);

// 5. Helper function to schedule mints
export async function scheduleMint(payload, executeAt) {
  const delay = executeAt.getTime() - Date.now();

  if (delay < 0) {
    throw new Error('Cannot schedule a mint in the past.');
  }

  const job = await mintQueue.add('scheduled-mint', payload, {
    delay,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
  });

  logger.info('Scheduled mint job', {
    jobId: job.id,
    contractId: payload.contractId,
    recipientAddress: payload.recipientAddress,
    amount: payload.amount,
    executeAt: executeAt.toISOString(),
    delayMs: delay,
  });
  console.log(
    `[MintQueue] Scheduled mint job ${job.id} for ${executeAt.toISOString()}`
  );
  return job.id;
}
