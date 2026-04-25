'use strict';

const express = require('express');
const { HorizonEventStream } = require('../services/event-stream');
const { authenticate } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * @openapi
 * @route GET /api/events/stream
 * @name getEventStream
 * @description Server-Sent Events endpoint that proxies Horizon's operation stream
 * @tags System
 * @security BearerAuth
 * @param {string} account - Optional Stellar account ID to filter events
 * @produces text/event-stream
 * @returns {string} 200 - SSE stream of events
 */
router.get('/events/stream', authenticate, (req, res) => {
  const accountId = req.query.account || undefined;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const stream = new HorizonEventStream({
    accountId,
    onEvent: (record) => {
      res.write(`data: ${JSON.stringify(record)}\n\n`);
    },
    onError: (err) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: err?.message || 'stream error' })}\n\n`);
    },
  });

  stream.start();

  logger.info('SSE client connected to event stream', {
    correlationId: req.correlationId,
    accountId,
  });

  req.on('close', () => {
    stream.stop();
    logger.info('SSE client disconnected', { correlationId: req.correlationId });
  });
});

module.exports = router;
