'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { SsoError } = require('../src/sso');
const { parseArgs, checkDeployment } = require('../scripts/check-deployment');
const { config, logger } = require('./helpers');

const origin = 'https://gateway.example.test';
function fixture() {
  const calls = [];
  const app = createApp({
    config: { ...config, enforceHttps: true, trustProxy: ['loopback'], sso: { redirectUri: origin + '/auth/sso/callback' } },
    logger, queue: { enqueue() { assert.fail('deployment check must not create queue jobs'); } },
    routingStore: { get() { assert.fail('deployment check must not read private routing'); } },
    sso: { async authenticate() { throw new SsoError('unauthorized', 401); } }
  });
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'manual');
    if (options.method === 'POST') assert.deepEqual(JSON.parse(options.body).events, []);
    if (url.protocol === 'http:') {
      assert.equal(options.headers['x-ping-secret'], undefined);
      assert.equal(options.headers['x-line-signature'], undefined);
    }
    const req = request(app)[(options.method || 'GET').toLowerCase()](url.pathname)
      .set(options.headers).set('x-forwarded-proto', url.protocol.slice(0, -1));
    if (options.body !== undefined) req.send(options.body);
    const response = await req;
    return new Response(response.text ?? null, { status: response.status, headers: response.headers });
  };
  return { fetchImpl, calls };
}
function run(options) {
  let output = '';
  return checkDeployment({ origin, pingSecret: config.pingSecret, lineChannelSecret: config.lineChannelSecret,
    write: text => { output += text; }, ...options }).then(code => {
    for (const secret of [config.pingSecret, config.lineChannelSecret, 'PRIVATE_RESPONSE']) assert.ok(!output.includes(secret));
    return { code, output };
  });
}

test('deployment CLI accepts only explicit HTTPS origins and known flags', () => {
  assert.deepEqual(parseArgs(['--url', origin, '--public']), { origin, publicOnly: true });
  assert.deepEqual(parseArgs(['--public', '--url', origin + '/']), { origin, publicOnly: true });
  for (const args of [[], ['--url'], ['--url', 'http://gateway.example.test'], ['--url', origin + '/path'],
    ['--url', origin + '?secret=abc'], ['--url', origin + '#abc'], ['--url', 'https://user:password@gateway.example.test'],
    ['--url', origin, '--unknown'], ['--url', origin, '--url', origin]]) assert.throws(() => parseArgs(args));
});

test('deployment checks exercise Express without queue jobs, routing reads or credential-bearing HTTP requests', async () => {
  const { fetchImpl, calls } = fixture();
  const result = await run({ fetchImpl });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /15 passed, 0 failed/);
  assert.ok(calls.some(call => call.options.headers['x-line-signature']));
  assert.equal(calls.filter(call => call.options.method === 'HEAD').length, 4);
});

test('public-only checks never send credentials even when values are supplied', async () => {
  const { fetchImpl, calls } = fixture();
  const result = await run({ fetchImpl, publicOnly: true });
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /13 passed, 0 failed/);
  assert.ok(calls.every(call => !call.options.headers['x-line-signature'] && !call.options.headers['x-ping-secret']));
});

test('failed public checks stop credential probes, never follow redirects, and never report upstream bodies/errors', async () => {
  for (const failure of ['redirect', 'file_exposure', 'large_response', 'network_error']) {
    const { fetchImpl, calls } = fixture();
    const result = await run({ fetchImpl: async (url, options) => {
      if (failure === 'file_exposure' && url.pathname === '/.env') return new Response(null, { status: 200 });
      if (url.pathname === '/admin/routes' && url.protocol === 'https:') {
        if (failure === 'redirect') return new Response('PRIVATE_RESPONSE', { status: 302, headers: { location: 'https://other.example.test/' } });
        if (failure === 'large_response') return new Response('PRIVATE_RESPONSE'.repeat(10000));
        if (failure === 'network_error') throw new Error('PRIVATE_RESPONSE');
      }
      return fetchImpl(url, options);
    } });
    assert.equal(result.code, 1, failure);
    assert.match(result.output, /fix public checks first/);
    assert.ok(calls.every(call => !call.options.headers['x-line-signature'] && !call.options.headers['x-ping-secret']));
  }
});

test('HTTPS redirect checks reject a redirect to another origin', async () => {
  const { fetchImpl } = fixture();
  const result = await run({ fetchImpl: (url, options) => url.protocol === 'http:'
    ? Promise.resolve(new Response(null, { status: 308, headers: { location: 'https://other.example.test/admin/routes' } }))
    : fetchImpl(url, options) });
  assert.equal(result.code, 1);
  assert.match(result.output, /\[FAIL\] HTTP redirects/);
});

test('certificate mismatch reports a useful reason without exposing native error details', async () => {
  const result = await run({ publicOnly: true, fetchImpl: async () => {
    throw new Error('PRIVATE_RESPONSE', { cause: { code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'PRIVATE_RESPONSE' } });
  } });
  assert.equal(result.code, 1);
  assert.match(result.output, /TLS certificate does not cover this hostname/);
});
