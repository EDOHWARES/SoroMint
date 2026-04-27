/**
 * @title Socket.io Utility
 * @description Manages the Socket.io server instance, handles connections, and provides a unified emission interface.
 * @notice Supports multi-process communication via Redis adapter.
 */

const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { Emitter } = require('@socket.io/redis-emitter');
const Redis = require('ioredis');
const { logger } = require('./logger');

let io;
let emitter;

/**
 * @notice Initializes the Socket.io server.
 * @param {Object} httpServer - The existing HTTP server instance.
 * @returns {Object} The initialized Socket.io instance.
 */
const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: '*', // Adjust origins based on CORS configuration in app
      methods: ['GET', 'POST'],
    },
  });

  // Attach Redis adapter if REDIS_URL is available
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const pubClient = new Redis(redisUrl);
      const subClient = pubClient.duplicate();
      io.adapter(createAdapter(pubClient, subClient));

      // Also initialize emitter for the same process
      emitter = new Emitter(pubClient);

      logger.info('Socket.io Redis adapter and emitter initialized');
    } catch (error) {
      logger.error('Failed to initialize Socket.io Redis adapter', {
        error: error.message,
      });
    }
  }

  /**
   * Custom Socket Events (documented for frontend):
   *
   * 1. 'join' (client -> server):
   *    - Payload: room (string) - usually wallet address or userId.
   *    - Description: Subscribes the client to updates for a specific user/wallet.
   *
   * 2. 'transaction_update' (server -> client):
   *    - Payload: { txHash, status, type, ... }
   *    - Description: Real-time update on a transaction's lifecycle.
   *
   * 3. 'minting_progress' (server -> client):
   *    - Payload: { tokenId, status, progress, contractId, ... }
   *    - Description: Progress updates during the minting process.
   *
   * 4. 'ledger_event' (server -> client):
   *    - Payload: { contractId, eventType, ledger, txHash, ... }
   *    - Description: Real-time stream of Soroban blockchain events.
   */
  io.on('connection', (socket) => {
    logger.info('New socket client connected', { socketId: socket.id });

    // Allow users to join a private room for targeted updates (e.g. by wallet address)
    socket.on('join', (room) => {
      if (room) {
        socket.join(room);
        logger.info('Client joined room', { socketId: socket.id, room });
      }
    });

    socket.on('disconnect', () => {
      logger.info('Socket client disconnected', { socketId: socket.id });
    });

    socket.on('error', (error) => {
      logger.error('Socket error', {
        socketId: socket.id,
        error: error.message,
      });
    });
  });

  return io;
};

/**
 * @notice Initializes the Redis emitter for worker processes.
 * @dev Should be called in processes that don't run the full Socket.io server.
 */
const initEmitter = () => {
  if (emitter) return emitter;

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    try {
      const redisClient = new Redis(redisUrl);
      emitter = new Emitter(redisClient);
      logger.info('Socket.io Redis emitter initialized for worker');
      return emitter;
    } catch (error) {
      logger.error('Failed to initialize Socket.io Redis emitter', {
        error: error.message,
      });
    }
  }
  return null;
};

/**
 * @notice Utility to emit events safely from any process.
 * @param {string} event - Event name.
 * @param {Object} data - Payload to send.
 * @param {string} [room] - Optional room to broadcast to.
 */
const emitEvent = (event, data, room = null) => {
  try {
    // If we have the full io instance, use it (primary process)
    if (io) {
      if (room) {
        io.to(room).emit(event, data);
      } else {
        io.emit(event, data);
      }
      return;
    }

    // If we are in a worker, use the emitter
    if (!emitter) {
      initEmitter();
    }

    if (emitter) {
      if (room) {
        emitter.to(room).emit(event, data);
      } else {
        emitter.emit(event, data);
      }
    } else {
      logger.debug(
        'Socket emission skipped: neither io nor emitter available',
        { event }
      );
    }
  } catch (error) {
    // Requirements: Ensure the server doesn't crash if a socket emit fails.
    logger.error('Socket emit failed', { event, error: error.message });
  }
};

/**
 * @notice Returns the io instance.
 */
const getIo = () => io;

module.exports = {
  initSocket,
  initEmitter,
  emitEvent,
  getIo,
};
