'use strict';

const { parseJob } = require('./payload');
const { routeEvent } = require('./routing');
const { isMfa, validMfa } = require('../public/admin/assets/line-contract');

class Worker {
  constructor({ queue, routingStore, forward, config, logger }) {
    Object.assign(this, { queue, routingStore, forward, config, logger });
    this.running = false;
    this.timer = null;
    this.current = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  schedule(delay) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.current = this.tick().catch(() => {
        this.logger.error('worker_error');
        return false;
      }).then(hadJob => {
        this.current = null;
        this.schedule(hadJob ? 0 : this.config.workerPollMs);
      });
    }, delay);
  }

  async tick() {
    const { job: claim, recovered } = await this.queue.claim();
    if (recovered) this.logger.warn('claim_recovered', { count: recovered });
    if (!claim) return false;
    let job;
    try { job = parseJob(claim.raw); } catch {
      await this.queue.fail(claim, { kind: 'invalid_job' });
      this.logger.warn('event_dead_lettered', { reason: 'invalid_job' });
      return true;
    }
    // Resolve the current routing before reserving idempotency. Configuration
    // errors must not mark an event as delivered or silently choose a target.
    const routing = await this.routingStore.get();
    let target;
    if (job.kind === 'line-raw') {
      if (job.payload.events.length && !job.payload.events.some(event => validMfa(event))) {
        await this.queue.ack(claim);
        this.logger.warn('event_dropped', { reason: 'invalid_mfa' });
        return true;
      }
      const app = routing.apps.find(item => item.id === 'sso');
      if (!app) throw new Error('Protected SSO target unavailable');
      target = { name: 'sso', url: app.url, delivery: 'line-raw-v1' };
    } else if (isMfa(job.payload.events[0])) {
      // Old split jobs have no authentic raw bytes. Never invent a LINE signature.
      await this.queue.fail(claim, { kind: 'missing_original' }, 'sso');
      this.logger.warn('event_dead_lettered', { target: 'sso', reason: 'missing_original' });
      return true;
    } else target = routeEvent(job.payload.events[0], routing);
    const reserved = await this.queue.reserveEvent(claim, job);
    if (reserved === 'expired') return true;
    if (reserved === 'duplicate') {
      await this.queue.ack(claim);
      this.logger.info('event_duplicate');
      return true;
    }
    if (reserved === 'partial_duplicate') {
      // Filtering would invalidate LINE's signature; do not resend known events.
      await this.queue.fail(claim, { kind: 'partial_duplicate' }, target.name);
      this.logger.warn('event_dead_lettered', { target: target.name, reason: 'partial_duplicate' });
      return true;
    }
    if (reserved !== 'reserved') throw new Error('Unexpected reservation result');
    const started = Date.now();
    const result = await this.forward(job, target);
    if (result.ok) {
      await this.queue.ack(claim);
      this.logger.info('event_forwarded', { target: target.name, durationMs: Date.now() - started });
    } else {
      await this.queue.fail(claim, result.error, target.name);
      this.logger.warn('event_dead_lettered', { target: target.name, reason: result.error.kind, status: result.error.status });
    }
    return true;
  }

  async stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.timer = null;
    await this.current;
  }
}

module.exports = { Worker };
