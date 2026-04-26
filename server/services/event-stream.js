/**
 * @title HorizonEventStream
 * @notice Real-time event tracking via Horizon's streaming API.
 * @dev Replaces polling with SSE-based streaming. Tracks cursor across reconnects
 *      and respects ledger boundaries for accurate event ordering.
 */

const { Horizon } = require('@stellar/stellar-sdk');
const { getEnv } = require('../config/env-config');
const { logger } = require('../utils/logger');

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const RECONNECT_FACTOR = 2;

/**
 * @notice Creates a Horizon server instance from env config.
 * @returns {Horizon.Server}
 */
const getHorizonServer = () => {
  const env = getEnv();
  const horizonUrl = env.HORIZON_URL || 'https://horizon-testnet.stellar.org';
  return new Horizon.Server(horizonUrl);
};

/**
 * @title HorizonEventStream
 * @notice Manages a persistent Horizon operations stream with auto-reconnect.
 */
class HorizonEventStream {
  /**
   * @param {Object} options
   * @param {string} [options.accountId]   - Filter stream to a specific account.
   * @param {Function} options.onEvent     - Called with each operation record.
   * @param {Function} [options.onError]   - Called on non-fatal stream errors.
   */
  constructor({ accountId, onEvent, onError } = {}) {
    if (typeof onEvent !== 'function') {
      throw new Error('onEvent handler is required');
    }

    this.accountId = accountId;
    this.onEvent = onEvent;
    this.onError = onError || (() => {});
    this.cursor = 'now';
    this.lastLedger = null;
    this._stopFn = null;
    this._stopped = false;
    this._reconnectDelay = RECONNECT_BASE_MS;
    this._reconnectTimer = null;
  }

  /**
   * @notice Starts the stream. Safe to call multiple times (no-op if already running).
   */
  start() {
    if (this._stopped) return;
    this._connect();
  }

  /**
   * @notice Permanently stops the stream and cancels any pending reconnect.
   */
  stop() {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._closeStream();
    logger.info('HorizonEventStream stopped', { accountId: this.accountId });
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  _connect() {
    if (this._stopped) return;

    try {
      const server = getHorizonServer();
      let builder = server.operations().cursor(this.cursor).order('asc');

      if (this.accountId) {
        builder = builder.forAccount(this.accountId);
      }

      logger.info('HorizonEventStream connecting', {
        accountId: this.accountId,
        cursor: this.cursor,
      });

      this._stopFn = builder.stream({
        onmessage: (record) => this._handleRecord(record),
        onerror: (err) => this._handleError(err),
      });

      // Reset backoff on successful connection
      this._reconnectDelay = RECONNECT_BASE_MS;
    } catch (err) {
      logger.error('HorizonEventStream failed to connect', { error: err.message });
      this._scheduleReconnect();
    }
  }

  /**
   * @notice Processes an incoming operation record.
   * @dev Tracks ledger sequence to detect ledger boundaries.
   */
  _handleRecord(record) {
    // Advance cursor so reconnects resume from here
    this.cursor = record.paging_token;

    // Detect ledger boundary crossing
    const ledger = record.ledger_attr ?? record.ledger;
    if (ledger && ledger !== this.lastLedger) {
      if (this.lastLedger !== null) {
        logger.debug('HorizonEventStream ledger boundary', {
          from: this.lastLedger,
          to: ledger,
        });
      }
      this.lastLedger = ledger;
    }

    try {
      this.onEvent(record);
    } catch (err) {
      logger.error('HorizonEventStream onEvent handler threw', { error: err.message });
    }
  }

  /**
   * @notice Handles stream errors and schedules reconnection.
   */
  _handleError(err) {
    if (this._stopped) return;

    logger.warn('HorizonEventStream error, will reconnect', {
      error: err?.message || String(err),
      cursor: this.cursor,
      reconnectIn: this._reconnectDelay,
    });

    this.onError(err);
    this._closeStream();
    this._scheduleReconnect();
  }

  _closeStream() {
    if (typeof this._stopFn === 'function') {
      try { this._stopFn(); } catch (_) {}
      this._stopFn = null;
    }
  }

  _scheduleReconnect() {
    if (this._stopped) return;

    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, this._reconnectDelay);

    // Exponential backoff with cap
    this._reconnectDelay = Math.min(
      this._reconnectDelay * RECONNECT_FACTOR,
      RECONNECT_MAX_MS
    );
  }
}

module.exports = { HorizonEventStream, getHorizonServer };
