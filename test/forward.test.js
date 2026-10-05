'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { createForwarder } = require('../src/forward');
const { config, event, payload } = require('./helpers');

const job = { payload: payload(event('outgoing-id')) };
const target = { name: 'chatbot', url: config.chatbotWebhookUrl };

test('forwards one-event LINE envelope with token and idempotency headers', async () => {
  let cancelled = false;
  const forward = createForwarder(config, async (url, options) => {
    assert.equal(url, config.chatbotWebhookUrl);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, `Bearer ${config.internalApiToken}`);
    assert.equal(options.headers['idempotency-key'], 'outgoing-id');
    assert.deepEqual(JSON.parse(options.body), job.payload);
    return { ok: true, body: { async cancel() { cancelled = true; } } };
  });
  assert.deepEqual(await forward(job, target), { ok: true });
  assert.equal(cancelled, true);
});

test('redirects, 4xx and 5xx fail without exposing response content', async () => {
  for (const status of [302, 400, 429, 500, 503]) {
    const forward = createForwarder(config, async () => new Response('private downstream failure', { status }));
    assert.deepEqual(await forward(job, target), { ok: false, error: { kind: 'http_error', status } });
  }
  const forward = createForwarder(config, async () => { throw new Error('secret URL, PII'); });
  assert.deepEqual(await forward(job, target), { ok: false, error: { kind: 'network_error' } });
});

test('real HTTP request is aborted at the configured deadline', async t => {
  const server = http.createServer(() => { /* never reply */ });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  // A short test-only deadline keeps the suite fast. Config enforces 3–5s.
  const forward = createForwarder({ ...config, forwardTimeoutMs: 80 });
  const result = await forward(job, { name: 'chatbot', url: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual(result, { ok: false, error: { kind: 'timeout' } });
});

test('real redirect does not send the internal token to the redirect target', async t => {
  let redirected = false;
  const server = http.createServer((req, res) => {
    if (req.url === '/target') redirected = true;
    res.writeHead(302, { location: '/target' }).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await createForwarder(config)(job, { url: `http://127.0.0.1:${server.address().port}` });
  assert.deepEqual(result, { ok: false, error: { kind: 'http_error', status: 302 } });
  assert.equal(redirected, false);
});
