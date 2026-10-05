'use strict';

const express = require('express');
const { verifyLineSignature } = require('../middleware/security');
const { validPayload } = require('../payload');

function createWebhooksRouter({ config, queue, logger }) {
  const router = express.Router();
  router.post('/line', (req, res, next) => {
    if (!req.is('application/json')) return res.status(415).json({ error: 'json_required' });
    return next();
  }, express.raw({ type: 'application/json', limit: 50 * 1024, inflate: false }), async (req, res) => {
    if (!verifyLineSignature(req.body, req.get('x-line-signature'), config.lineChannelSecret)) {
      return res.status(401).json({ error: 'invalid_signature' });
    }
    let payload;
    try { payload = JSON.parse(req.body.toString('utf8')); } catch {
      return res.status(400).json({ error: 'invalid_json' });
    }
    if (!validPayload(payload)) return res.status(400).json({ error: 'invalid_payload' });
    // LINE's verification request has events: []; it creates no work.
    if (!payload.events.length) return res.status(200).json({ ok: true });
    try {
      const count = await queue.enqueue(payload);
      logger.info('webhook_queued', { count });
      return res.status(200).json({ ok: true });
    } catch {
      logger.warn('queue_unavailable');
      return res.status(503).set('Retry-After', '5').json({ error: 'queue_unavailable' });
    }
  });
  return router;
}

module.exports = { createWebhooksRouter };
