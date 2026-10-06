'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { jobSummary, deadLetterSummary, createQueueMonitor } = require('../src/queue-monitor');
const { config, payload, event, mfa, sign } = require('./helpers');

const job = () => ({ version: 1, id: randomUUID(), receivedAt: 1700000000000,
  payload: payload(event('private-line-id', { replyToken: 'private-reply', source: { userId: 'private-user' } })) });

test('queue summary exposes only job metadata, never LINE IDs, message contents or arbitrary fields', () => {
  const value = job(); value.secret = 'private-secret';
  const result = jobSummary(JSON.stringify(value));
  assert.deepEqual(result, { id: value.id, receivedAt: value.receivedAt, kind: 'event', eventCount: 1, eventType: 'message' });
  assert.doesNotMatch(JSON.stringify(result), /private|payload|replyToken|source/);
  value.payload.events[0].type = 'private-custom-name';
  assert.equal(jobSummary(JSON.stringify(value)).eventType, 'other');
});

test('SSO batches and empty verification are summarized without decoding secrets into the response', () => {
  for (const events of [[mfa('private-mfa-id'), event('private-message-id')], []]) {
    const raw = JSON.stringify(payload(...events));
    const value = { version: 2, kind: 'line-raw', id: randomUUID(), receivedAt: 1700000000000,
      rawBody: Buffer.from(raw).toString('base64'), signature: sign(raw), eventIds: events.filter(item => item.type === 'postback').map(item => item.webhookEventId) };
    const summary = jobSummary(JSON.stringify(value));
    assert.equal(summary.kind, events.length ? 'sso_batch' : 'verification');
    assert.equal(summary.eventCount, events.length);
    assert.doesNotMatch(JSON.stringify(summary), /private|signature|rawBody|cusa_mfa|choice|postback/);
  }
});

test('bad jobs and DLQ metadata cannot expose raw errors or crash the monitor', () => {
  for (const raw of ['{broken-private', 'null', '{}', 'x'.repeat(204801)]) {
    assert.equal(jobSummary(raw).kind, 'invalid');
    assert.equal(deadLetterSummary(raw).kind, 'invalid');
    assert.doesNotMatch(JSON.stringify(deadLetterSummary(raw)), /private/);
  }
  const rawJob = JSON.stringify(job());
  const summary = deadLetterSummary(JSON.stringify({ rawJob, failedAt: 1700000100000,
    target: 'private-url', error: { kind: 'http_error', status: 500, message: 'private-message', stack: 'private-stack' } }));
  assert.deepEqual(summary.error, { kind: 'http_error', status: 500 });
  assert.equal(summary.failedAt, 1700000100000);
  assert.doesNotMatch(JSON.stringify(summary), /private|rawJob/);
  const invalid = deadLetterSummary(JSON.stringify({ rawJob, failedAt: 'private-time', error: { kind: 'private-error', status: 'private-status' } }));
  assert.equal(invalid.failedAt, null);
  assert.deepEqual(invalid.error, { kind: 'unknown' });
});

test('monitor rejects invalid pages before sending commands to Redis', async () => {
  const monitor = createQueueMonitor({ eval() { assert.fail('must not read Redis'); } }, config);
  for (const options of [{ state: 'unknown' }, { offset: -1 }, { offset: Infinity }, { offset: 1.5 }, { offset: '25' }, { offset: 1000000001 }]) {
    await assert.rejects(monitor.snapshot(options), TypeError);
  }
});
