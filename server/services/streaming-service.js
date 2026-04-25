const {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  xdr,
} = require('@stellar/stellar-sdk');
const Stream = require('../models/Stream');

class StreamingService {
  constructor(rpcUrl, networkPassphrase) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.networkPassphrase = networkPassphrase;
  }

  async createStream(
    contractId,
    sourceKeypair,
    sender,
    recipient,
    tokenAddress,
    totalAmount,
    startLedger,
    stopLedger,
    isPublic = false
  ) {
    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'create_stream',
          xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
            xdr.PublicKey.publicKeyTypeEd25519(Buffer.from(sender, 'hex'))
          )),
          xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeAccount(
            xdr.PublicKey.publicKeyTypeEd25519(Buffer.from(recipient, 'hex'))
          )),
          xdr.ScVal.scvAddress(xdr.ScAddress.scAddressTypeContract(
            Buffer.from(tokenAddress, 'hex')
          )),
          xdr.ScVal.scvI128(this.toI128(totalAmount)),
          xdr.ScVal.scvU32(startLedger),
          xdr.ScVal.scvU32(stopLedger),
          xdr.ScVal.scvBool(isPublic)
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(sourceKeypair);

    const result = await this.server.sendTransaction(prepared);
    const pollResult = await this.pollTransaction(result.hash);

    if (pollResult.status === 'SUCCESS') {
      // Decode stream ID from result meta
      const streamId = this.decodeStreamIdFromResult(pollResult);
      
      if (streamId === null) {
        throw new Error('Failed to decode stream ID from transaction result');
      }
      
      // Save to database
      await Stream.create({
        streamId: streamId.toString(),
        contractId,
        sender,
        recipient,
        tokenAddress,
        totalAmount: totalAmount.toString(),
        ratePerLedger: (BigInt(totalAmount) / BigInt(stopLedger - startLedger)).toString(),
        startLedger,
        stopLedger,
        isPublic,
        createdTxHash: result.hash,
      });

      return { ...pollResult, streamId };
    }

    return pollResult;
  }

  decodeStreamIdFromResult(result) {
    if (!result.resultMetaXdr) return null;
    const meta = xdr.TransactionMeta.fromXDR(result.resultMetaXdr, 'base64');
    const events = meta.v3().sorobanMeta().events();
    const createdEvent = events.find(e => e.type().name === 'contract' && e.body().v0().topics()[0].symbol().toString() === 'created');
    if (createdEvent) {
      return createdEvent.body().v0().topics()[1].u64().toNumber();
    }
    return null;
  }

  async withdraw(contractId, sourceKeypair, streamId, amount) {
    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'withdraw',
          xdr.ScVal.scvU64(xdr.Uint64.fromString(streamId.toString())),
          xdr.ScVal.scvI128(this.toI128(amount))
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(sourceKeypair);

    const result = await this.server.sendTransaction(prepared);
    const pollResult = await this.pollTransaction(result.hash);

    if (pollResult.status === 'SUCCESS') {
      await Stream.findOneAndUpdate(
        { streamId: streamId.toString() },
        { $inc: { withdrawn: amount.toString() } }
      );
    }

    return pollResult;
  }

  async cancelStream(contractId, sourceKeypair, streamId) {
    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'cancel_stream',
          xdr.ScVal.scvU64(xdr.Uint64.fromString(streamId.toString()))
        )
      )
      .setTimeout(30)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(sourceKeypair);

    const result = await this.server.sendTransaction(prepared);
    const pollResult = await this.pollTransaction(result.hash);

    if (pollResult.status === 'SUCCESS') {
      await Stream.findOneAndUpdate(
        { streamId: streamId.toString() },
        { status: 'canceled', canceledTxHash: result.hash }
      );
    }

    return pollResult;
  }

  async getStreamBalance(contractId, streamId) {
    const contract = new Contract(contractId);
    const ledgerKey = xdr.LedgerKey.contractData(
      new xdr.LedgerKeyContractData({
        contract: contract.address().toScAddress(),
        key: xdr.ScVal.scvU64(xdr.Uint64.fromString(streamId.toString())),
        durability: xdr.ContractDataDurability.persistent(),
      })
    );

    const result = await this.server.getLedgerEntries(ledgerKey);
    if (result.entries && result.entries.length > 0) {
      const data = xdr.LedgerEntryData.fromXDR(result.entries[0].xdr, 'base64');
      return this.parseStreamData(data.value().val());
    }
    return null;
  }

  async getStream(contractId, streamId) {
    const contract = new Contract(contractId);
    const sourceAccount = await this.server.getAccount(contract.address().toString());

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(
          'get_stream',
          xdr.ScVal.scvU64(xdr.Uint64.fromString(streamId.toString()))
        )
      )
      .setTimeout(30)
      .build();

    const simulated = await this.server.simulateTransaction(tx);
    if (simulated.result) {
      return this.parseStreamData(simulated.result.retval);
    }
    return null;
  }

  parseStreamData(scVal) {
    // Parse Stream struct from ScVal
    const map = scVal.map();
    const getVal = (key) => map.find(e => e.key().symbol().toString() === key)?.val();

    return {
      sender: getVal('sender')?.address().toString(),
      recipient: getVal('recipient')?.address().toString(),
      token: getVal('token')?.address().toString(),
      ratePerLedger: getVal('rate_per_ledger')?.i128().toString(),
      startLedger: getVal('start_ledger')?.u32(),
      stopLedger: getVal('stop_ledger')?.u32(),
      withdrawn: getVal('withdrawn')?.i128().toString(),
      isPublic: getVal('is_public')?.b(),
    };
  }

  toI128(value) {
    const bigValue = BigInt(value);
    const hi = bigValue >> 64n;
    const lo = bigValue & 0xFFFFFFFFFFFFFFFFn;
    return new xdr.Int128Parts({ hi, lo });
  }

  async pollTransaction(hash, timeout = 30000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const txResult = await this.server.getTransaction(hash);
      if (txResult.status !== 'NOT_FOUND') {
        return txResult;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error('Transaction polling timeout');
  }
}

module.exports = StreamingService;
