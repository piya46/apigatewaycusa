'use strict';

const express = require('express');
const { RoutingValidationError, RoutingConflictError } = require('../routing-store');

function createAdminRouter({ routingStore, recentEvents, queueMonitor, logger }) {
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
  router.get('/recent-events', async (req, res) => {
    try {
      if (!recentEvents) throw new Error();
      const routing = await routingStore.get();
      return res.json({ items: await recentEvents.list(routing), routingRevision: routing.revision, retentionHours: 24, limit: 200 });
    } catch {
      logger.warn('recent_events_unavailable');
      return res.status(503).json({ error: 'recent_events_unavailable' });
    }
  });
  router.get('/queue', async (req, res) => {
    const { state = 'waiting', offset = '0' } = req.query;
    if (!['waiting', 'processing', 'dlq'].includes(state) || typeof offset !== 'string'
      || !/^(0|[1-9][0-9]{0,9})$/.test(offset) || Number(offset) > 1000000000
      || Object.keys(req.query).some(key => !['state', 'offset'].includes(key))) {
      return res.status(400).json({ error: 'invalid_queue_page' });
    }
    try {
      if (!queueMonitor) throw new Error();
      return res.json(await queueMonitor.snapshot({ state, offset: Number(offset) }));
    } catch {
      logger.warn('queue_monitor_unavailable');
      return res.status(503).json({ error: 'queue_monitor_unavailable' });
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
