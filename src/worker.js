'use strict';

const { parseJob } = require('./payload');
const { routeEvent } = require('./routing');

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
    const target = routeEvent(job.payload.events[0], await this.routingStore.get());
    const reserved = await this.queue.reserveEvent(claim, job);
    if (reserved === 'expired') return true;
    if (reserved === 'duplicate') {
      await this.queue.ack(claim);
      this.logger.info('event_duplicate');
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
