'use strict';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const { isMfa } = require('../public/admin/assets/line-contract');

function validPayload(payload) {
  return isObject(payload)
    && typeof payload.destination === 'string'
    && payload.destination.length > 0 && payload.destination.length <= 256
    && Array.isArray(payload.events)
    && payload.events.length <= 100
    && payload.events.every(event => isObject(event)
      && typeof event.type === 'string' && event.type.length > 0 && event.type.length <= 64
      && typeof event.webhookEventId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(event.webhookEventId));
}

function parseJob(raw) {
  const job = JSON.parse(raw);
  if (!isObject(job) || typeof job.id !== 'string'
      || !/^[a-f0-9-]{36}$/.test(job.id) || !Number.isFinite(job.receivedAt)) {
    throw new Error('Invalid queue job');
  }
  if (job.version === 2 && job.kind === 'line-raw') {
    if (typeof job.rawBody !== 'string' || job.rawBody.length > 68268
      || typeof job.signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(job.signature)) throw new Error('Invalid raw job');
    const body = Buffer.from(job.rawBody, 'base64');
    if (body.length > 51200 || body.toString('base64') !== job.rawBody) throw new Error('Invalid raw encoding');
    job.payload = JSON.parse(body.toString('utf8'));
    if (!validPayload(job.payload)) throw new Error('Invalid raw payload');
    const ids = mfaEventIds(job.payload);
    if ((job.payload.events.length && !ids.length) || JSON.stringify(ids) !== JSON.stringify(job.eventIds)) throw new Error('Invalid raw event IDs');
  } else if (job.version !== 1 || !validPayload(job.payload) || job.payload.events.length !== 1) {
    throw new Error('Invalid queue job');
  }
  return job;
}

function mfaEventIds(payload) {
  return [...new Set(payload.events.filter(isMfa).map(event => event.webhookEventId))];
}
function eventIds(job) { return job.version === 2 ? job.eventIds : [job.payload.events[0].webhookEventId]; }

module.exports = { validPayload, parseJob, mfaEventIds, eventIds };
