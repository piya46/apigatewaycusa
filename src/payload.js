'use strict';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validPayload(payload) {
  return isObject(payload)
    && typeof payload.destination === 'string'
    && payload.destination.length > 0 && payload.destination.length <= 256
    && Array.isArray(payload.events)
    && payload.events.every(event => isObject(event)
      && typeof event.type === 'string' && event.type.length > 0 && event.type.length <= 64
      && typeof event.webhookEventId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(event.webhookEventId));
}

function parseJob(raw) {
  const job = JSON.parse(raw);
  if (!isObject(job) || job.version !== 1 || typeof job.id !== 'string'
      || !/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(job.receivedAt)
      || !validPayload(job.payload) || job.payload.events.length !== 1) {
    throw new Error('Invalid queue job');
  }
  return job;
}

module.exports = { validPayload, parseJob };
