/**
 * @title Dividend Distribution Routes
 * @description REST API routes for the DividendDistributor Soroban contract.
 *
 * These routes serve as the off-chain coordination layer for the on-chain
 * dividend contract. In a production deployment the actual Soroban
 * invocations (deposit / claim) are signed client-side via Freighter and
 * submitted directly to the network. These endpoints provide:
 *   1. A simulation / preflight layer (claimable amounts, stats).
 *   2. Transaction-building helpers that return unsigned XDR for the client
 *      to sign with Freighter.
 *   3. A thin proxy for read-only RPC calls.
 *
 * Routing prefix: /api/dividend (registered in server/index.js)
 *
 * @see VAULT_IMPLEMENTATION.md for the analogous vault pattern.
 */

const express = require("express");
const { asyncHandler, AppError } = require("../middleware/error-handler");
const { authenticate } = require("../middleware/auth");
const { logger } = require("../utils/logger");

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/dividend/stats
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/dividend/stats:
 *   get:
 *     tags: [Dividend]
 *     summary: Get global dividend distribution statistics
 *     description: |
 *       Returns the current global DPS accumulator and total XLM distributed
 *       for a given DividendDistributor contract. The actual values are
 *       retrieved by simulating the `global_dps()` and `total_distributed()`
 *       view functions via Soroban RPC.
 *     parameters:
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *         description: The DividendDistributor contract address (C...)
 *     responses:
 *       200:
 *         description: Stats retrieved successfully
 *       400:
 *         description: Missing contractId query param
 */
router.get(
  "/dividend/stats",
  asyncHandler(async (req, res) => {
    const { contractId } = req.query;

    if (!contractId) {
      throw new AppError("contractId query param is required", 400, "VALIDATION_ERROR");
    }

    logger.info("Dividend stats requested", {
      correlationId: req.correlationId,
      contractId,
    });

    // In production: simulate global_dps() and total_distributed() on-chain via:
    //
    //   const server = getRpcServer();
    //   const contract = new Contract(contractId);
    //   const tx = new TransactionBuilder(...)
    //     .addOperation(contract.call("global_dps"))
    //     .build();
    //   const sim = await server.execute(s => s.simulateTransaction(tx));
    //   const globalDps = scValToNative(sim.result.retval);
    //
    // For now return a structured stub so the API surface is correct.
    res.json({
      success: true,
      data: {
        contractId,
        globalDps: "0",
        totalDistributed: "0",
        note: "Invoke global_dps() and total_distributed() on-chain for live values",
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/dividend/claimable/:holderAddress
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/dividend/claimable/{holderAddress}:
 *   get:
 *     tags: [Dividend]
 *     summary: Query how much XLM a holder can claim
 *     description: |
 *       Simulates the `claimable(holder, holder_balance)` view function.
 *       The caller must supply the holder's current token balance as a query
 *       parameter (read from the token contract).
 *     parameters:
 *       - in: path
 *         name: holderAddress
 *         required: true
 *         schema: { type: string }
 *         description: Stellar public key of the holder (G...)
 *       - in: query
 *         name: contractId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: holderBalance
 *         required: true
 *         schema: { type: string }
 *         description: Holder's token balance in base units (integer string)
 *     responses:
 *       200:
 *         description: Claimable amount in stroops
 *       400:
 *         description: Missing required query params
 */
router.get(
  "/dividend/claimable/:holderAddress",
  asyncHandler(async (req, res) => {
    const { holderAddress } = req.params;
    const { contractId, holderBalance } = req.query;

    if (!contractId || !holderBalance) {
      throw new AppError(
        "contractId and holderBalance query params are required",
        400,
        "VALIDATION_ERROR"
      );
    }

    if (!holderAddress || holderAddress.length !== 56) {
      throw new AppError("holderAddress must be a valid 56-character Stellar address", 400, "VALIDATION_ERROR");
    }

    logger.info("Dividend claimable query", {
      correlationId: req.correlationId,
      holderAddress,
      contractId,
    });

    // In production: simulate claimable(holderAddress, holderBalance) on-chain.
    res.json({
      success: true,
      data: {
        holderAddress,
        contractId,
        holderBalance,
        claimableStroops: "0",
        note: "Invoke claimable() on-chain for live values",
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/dividend/deposit
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/dividend/deposit:
 *   post:
 *     tags: [Dividend]
 *     summary: Build a deposit transaction for the issuer to sign
 *     description: |
 *       Returns an unsigned Soroban transaction XDR that calls
 *       `deposit(depositor, amount, total_supply)` on the dividend contract.
 *       The client signs the XDR with Freighter and submits it to the network.
 *
 *       Flow:
 *         1. Read `total_supply` from the token contract.
 *         2. Approve the dividend contract to spend `amountStroops` of XLM.
 *         3. POST to this endpoint → receive unsigned XDR.
 *         4. Sign with Freighter → submit to Soroban RPC.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, depositorAddress, amountStroops, totalSupply]
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: DividendDistributor contract address (C...)
 *               depositorAddress:
 *                 type: string
 *                 description: Issuer's Stellar public key (G...)
 *               amountStroops:
 *                 type: string
 *                 description: XLM amount in stroops (integer string)
 *               totalSupply:
 *                 type: string
 *                 description: Current total token supply (integer string)
 *     responses:
 *       200:
 *         description: Unsigned XDR returned for client-side signing
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/dividend/deposit",
  authenticate,
  asyncHandler(async (req, res) => {
    const { contractId, depositorAddress, amountStroops, totalSupply } = req.body;

    if (!contractId || !depositorAddress || !amountStroops || !totalSupply) {
      throw new AppError(
        "contractId, depositorAddress, amountStroops, and totalSupply are required",
        400,
        "VALIDATION_ERROR"
      );
    }

    if (BigInt(amountStroops) <= 0n) {
      throw new AppError("amountStroops must be a positive integer", 400, "VALIDATION_ERROR");
    }

    if (BigInt(totalSupply) <= 0n) {
      throw new AppError("totalSupply must be a positive integer", 400, "VALIDATION_ERROR");
    }

    logger.info("Dividend deposit transaction requested", {
      correlationId: req.correlationId,
      contractId,
      depositorAddress,
      amountStroops,
      totalSupply,
    });

    // In production, build and return an unsigned XDR:
    //
    //   const { rpc, Contract, TransactionBuilder, Address, nativeToScVal } =
    //     require('@stellar/stellar-sdk');
    //   const env = getEnv();
    //   const server = getRpcServer();
    //   const account = await server.execute(s => s.getAccount(depositorAddress));
    //   const contract = new Contract(contractId);
    //   const tx = new TransactionBuilder(account, {
    //     fee: '1000000',
    //     networkPassphrase: env.NETWORK_PASSPHRASE,
    //   })
    //     .addOperation(contract.call('deposit',
    //       new Address(depositorAddress).toScVal(),
    //       nativeToScVal(BigInt(amountStroops), { type: 'i128' }),
    //       nativeToScVal(BigInt(totalSupply),   { type: 'i128' }),
    //     ))
    //     .setTimeout(30)
    //     .build();
    //   const sim = await server.execute(s => s.simulateTransaction(tx));
    //   if (rpc.Api.isSimulationError(sim)) {
    //     throw new AppError(sim.error, 400, 'SIMULATION_ERROR');
    //   }
    //   const prepared = rpc.assembleTransaction(tx, sim).build();
    //   return res.json({ success: true, data: { unsignedXdr: prepared.toXDR('base64') } });

    res.json({
      success: true,
      data: {
        contractId,
        depositorAddress,
        amountStroops,
        totalSupply,
        unsignedXdr: null,
        note: "Sign and submit deposit() directly via Soroban CLI or Freighter SDK",
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/dividend/claim
// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/dividend/claim:
 *   post:
 *     tags: [Dividend]
 *     summary: Build a claim transaction for a holder to sign
 *     description: |
 *       Returns an unsigned Soroban transaction XDR that calls
 *       `claim(holder, holder_balance)` on the dividend contract.
 *       The client signs the XDR with Freighter and submits it.
 *
 *       Flow:
 *         1. Read `holder_balance` from the token contract for the holder.
 *         2. POST to this endpoint → receive unsigned XDR.
 *         3. Sign with Freighter → submit to Soroban RPC.
 *         4. XLM is transferred to the holder's account on-chain.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [contractId, holderAddress, holderBalance]
 *             properties:
 *               contractId:
 *                 type: string
 *                 description: DividendDistributor contract address (C...)
 *               holderAddress:
 *                 type: string
 *                 description: Holder's Stellar public key (G...)
 *               holderBalance:
 *                 type: string
 *                 description: Holder's current token balance (integer string)
 *     responses:
 *       200:
 *         description: Unsigned XDR returned for client-side signing
 *       400:
 *         description: Missing or invalid fields
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/dividend/claim",
  authenticate,
  asyncHandler(async (req, res) => {
    const { contractId, holderAddress, holderBalance } = req.body;

    if (!contractId || !holderAddress || !holderBalance) {
      throw new AppError(
        "contractId, holderAddress, and holderBalance are required",
        400,
        "VALIDATION_ERROR"
      );
    }

    logger.info("Dividend claim transaction requested", {
      correlationId: req.correlationId,
      contractId,
      holderAddress,
      holderBalance,
    });

    // In production: build and return unsigned XDR for claim(holder, holder_balance).
    // See /dividend/deposit comments above for the full TransactionBuilder pattern.

    res.json({
      success: true,
      data: {
        contractId,
        holderAddress,
        holderBalance,
        unsignedXdr: null,
        note: "Sign and submit claim() directly via Soroban CLI or Freighter SDK",
      },
    });
  })
);

module.exports = router;
