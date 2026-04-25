const { Keypair } = require('@stellar/stellar-sdk');
const Stream = require('../models/Stream');
const StreamingService = require('./streaming-service');
const { logger } = require('../utils/logger');
const NotificationService = require('./notification-service');
const { getEnv } = require('../config/env-config');

class ScheduledStreamService {
  constructor() {
    const env = getEnv();
    this.streamingService = new StreamingService(
      env.SOROBAN_RPC_URL,
      env.NETWORK_PASSPHRASE
    );
    this.contractId = env.STREAMING_CONTRACT_ID;
    
    if (env.ADMIN_SECRET_KEY) {
      this.adminKeypair = Keypair.fromSecret(env.ADMIN_SECRET_KEY);
    } else {
      logger.warn('ADMIN_SECRET_KEY not set. Scheduled streams cannot be executed.');
    }
  }

  /**
   * Schedule a new stream
   */
  async scheduleStream(data) {
    const { sender, recipient, tokenAddress, totalAmount, startLedger, stopLedger, scheduledStartLedger } = data;

    const stream = new Stream({
      contractId: this.contractId,
      sender,
      recipient,
      tokenAddress,
      totalAmount,
      ratePerLedger: (BigInt(totalAmount) / BigInt(stopLedger - startLedger)).toString(),
      startLedger,
      stopLedger,
      scheduledStartLedger,
      status: 'scheduled',
    });

    await stream.save();
    logger.info(`Stream scheduled for ledger ${scheduledStartLedger}`, { streamId: stream._id });
    
    return stream;
  }

  /**
   * Check and execute scheduled streams
   */
  async processScheduledStreams(currentLedger) {
    if (!this.adminKeypair) {
      logger.error('Cannot process scheduled streams: ADMIN_SECRET_KEY is missing');
      return;
    }

    const scheduledStreams = await Stream.find({
      status: 'scheduled',
      scheduledStartLedger: { $lte: currentLedger },
    });

    if (scheduledStreams.length === 0) {
      return;
    }

    logger.info(`Processing ${scheduledStreams.length} scheduled streams`);

    for (const stream of scheduledStreams) {
      try {
        await this.executeStream(stream);
      } catch (error) {
        logger.error(`Failed to execute scheduled stream ${stream._id}`, { error: error.message });
      }
    }
  }

  /**
   * Execute a single scheduled stream on-chain
   */
  async executeStream(stream) {
    logger.info(`Executing scheduled stream ${stream._id} on-chain`);

    try {
      const result = await this.streamingService.createStream(
        this.contractId,
        this.adminKeypair,
        stream.sender,
        stream.recipient,
        stream.tokenAddress,
        stream.totalAmount,
        stream.startLedger,
        stream.stopLedger
      );

      stream.status = 'active';
      stream.streamId = result.streamId;
      stream.createdTxHash = result.hash;
      await stream.save();

      logger.info(`Scheduled stream ${stream._id} executed successfully`, { 
        streamId: result.streamId, 
        txHash: result.hash 
      });

      // Send notifications
      await this.sendStreamNotifications(stream);

    } catch (error) {
      logger.error(`Execution failed for stream ${stream._id}`, { error: error.message });
      throw error;
    }
  }

  async sendStreamNotifications(stream) {
    const User = require('../models/User');
    
    // Notify sender
    const senderUser = await User.findByPublicKey(stream.sender);
    if (senderUser) {
      await NotificationService.notifyUser(
        senderUser._id,
        'streamStarted',
        () => ({
          subject: 'Scheduled Stream Started',
          text: `Your scheduled stream to ${stream.recipient} has been successfully started. Stream ID: ${stream.streamId}`,
          html: `<p>Your scheduled stream to <code>${stream.recipient}</code> has been successfully started.</p><p>Stream ID: <code>${stream.streamId}</code></p>`,
          pushPayload: {
            title: 'Stream Started',
            body: `Scheduled stream to ${stream.recipient.substring(0, 8)}... started`,
            data: { type: 'streamStarted', streamId: stream.streamId }
          }
        })
      );
    }

    // Notify recipient
    const recipientUser = await User.findByPublicKey(stream.recipient);
    if (recipientUser) {
      await NotificationService.notifyUser(
        recipientUser._id,
        'streamStarted',
        () => ({
          subject: 'New Stream Received',
          text: `A scheduled stream from ${stream.sender} has started. Stream ID: ${stream.streamId}`,
          html: `<p>A scheduled stream from <code>${stream.sender}</code> has started.</p><p>Stream ID: <code>${stream.streamId}</code></p>`,
          pushPayload: {
            title: 'New Stream Received',
            body: `Stream from ${stream.sender.substring(0, 8)}... started`,
            data: { type: 'streamStarted', streamId: stream.streamId }
          }
        })
      );
    }
  }
}

module.exports = new ScheduledStreamService();
