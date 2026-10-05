'use strict';

const express = require('express');
const { RoutingValidationError, RoutingConflictError } = require('../routing-store');

function createAdminRouter({ routingStore, logger }) {
  const router = express.Router();
  // Only explicitly granted administrators may redirect webhook payloads and
  // the internal API credential. A generic authenticated user is insufficient.
  router.use((req, res, next) => {
    if (!Array.isArray(req.auth?.roles) || !req.auth.roles.includes('admin')) {
      return res.status(403).json({ error: 'routing_admin_required' });
    }
    return next();
  });
  router.get('/webhook-routing', async (req, res) => {
    try {
      if (!routingStore) throw new Error();
      return res.json(await routingStore.get());
    } catch {
      logger.warn('routing_unavailable');
      return res.status(503).json({ error: 'routing_unavailable' });
    }
  });
  router.put('/webhook-routing', async (req, res) => {
    try {
      if (!routingStore) throw new Error();
      const saved = await routingStore.save(req.body);
      logger.info('routing_updated', { count: saved.rules.length });
      return res.json(saved);
    } catch (error) {
      if (error instanceof RoutingValidationError) return res.status(400).json({ error: 'invalid_routing', message: error.message });
      if (error instanceof RoutingConflictError) return res.status(409).json({ error: 'routing_conflict' });
      logger.warn('routing_unavailable');
      return res.status(503).json({ error: 'routing_unavailable' });
    }
  });
  return router;
}

module.exports = { createAdminRouter };
