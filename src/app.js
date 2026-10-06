'use strict';

const express = require('express');
const helmet = require('helmet');
const path = require('node:path');
const { constantTimeSecret } = require('./middleware/security');
const { createWebhooksRouter } = require('./routes/webhooks');
const { createV1Router } = require('./routes/v1');
const { createAuthRouter } = require('./routes/auth');

function createApp({ config, queue, routingStore, recentEvents, queueMonitor, sso, logger }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('query parser', 'simple');
  app.use(helmet());
  app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (config.enforceHttps && !req.secure) return res.status(426).json({ error: 'https_required' });
    return next();
  });
  app.get('/ping', (req, res) => {
    // Prefer the header for cron to avoid putting a secret in host access logs.
    const provided = req.get('x-ping-secret') ?? req.query.secret;
    if (!constantTimeSecret(provided, config.pingSecret)) return res.status(401).json({ error: 'unauthorized' });
    return res.status(200).json({ ok: true });
  });
  app.use('/webhooks', createWebhooksRouter({ config, queue, logger }));
  app.get('/admin/routes', (req, res) => res.sendFile(path.join(__dirname, '../public/admin/index.html')));
  app.use('/admin/assets', express.static(path.join(__dirname, '../public/admin/assets'), { index: false, dotfiles: 'deny', redirect: false }));
  app.use('/auth/sso', createAuthRouter({ config, sso }));
  app.use('/v1', createV1Router(config, { routingStore, recentEvents, queueMonitor, sso, logger }));
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return res.destroy();
    const status = [400, 413, 415].includes(error.status) ? error.status : 500;
    logger.warn('request_error', { status });
    const message = { 400: 'invalid_request', 413: 'payload_too_large', 415: 'unsupported_encoding', 500: 'internal_error' }[status];
    return res.status(status).json({ error: message });
  });
  return app;
}

module.exports = { createApp };
