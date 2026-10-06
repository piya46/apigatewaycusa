'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { generateKeyPairSync } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { gzipSync } = require('node:zlib');
const { createApp } = require('../src/app');
const { config, logger, event, payload, sign, deferred, pause } = require('./helpers');

function setup(overrides = {}, enqueue = async () => 1) {
  return createApp({ config: { ...config, ...overrides }, queue: { enqueue }, logger });
}
function webhook(app, raw, signature = sign(raw)) {
  return request(app).post('/webhooks/line').set('content-type', 'application/json').set('x-line-signature', signature).send(raw);
}

test('accepts signed raw bytes including whitespace and Unicode', async () => {
  const received = [];
  const body = payload(event('a', { message: { type: 'text', text: 'สวัสดี 👋\n' } }));
  const raw = JSON.stringify(body, null, 2);
  const res = await webhook(setup({}, async item => { received.push(item); return 1; }), raw);
  assert.equal(res.status, 200);
  assert.deepEqual(received, [body]);
});

test('rejects tampered, missing and malformed signatures without enqueuing', async () => {
  const app = setup({}, () => assert.fail('must not enqueue'));
  const raw = JSON.stringify(payload(event()));
  for (const signature of ['', 'invalid', sign(raw + ' '), sign(raw).slice(0, -1)]) {
    assert.equal((await webhook(app, raw, signature)).status, 401);
  }
  assert.equal((await request(app).post('/webhooks/line').set('content-type', 'application/json').send(raw)).status, 401);
});

test('verifies signature before parsing and validates the complete batch', async () => {
  const app = setup({}, () => assert.fail('must not enqueue'));
  assert.equal((await webhook(app, '{broken')).status, 400);
  assert.equal((await webhook(app, '{broken', 'bad')).status, 401);
  for (const value of [null, [], {}, payload({ type: 'message' }), payload(event(), { type: 'message' })]) {
    assert.equal((await webhook(app, JSON.stringify(value))).status, 400);
  }
});

test('LINE verification events:[] durably queues original body and signature for SSO', async () => {
  const app = setup({}, async (item, original) => {
    assert.deepEqual(item.events, []);
    assert.equal(original.body.toString(), JSON.stringify(payload()));
    assert.equal(original.signature, sign(original.body));
    return 1;
  });
  assert.equal((await webhook(app, JSON.stringify(payload()))).status, 200);
});

test('destination pin rejects another OA after signature validation without enqueuing', async () => {
  const app = setup({ lineWebhookDestination: `U${'1'.repeat(32)}` }, () => assert.fail('wrong OA'));
  assert.equal((await webhook(app, JSON.stringify(payload(event())))).status, 401);
});

test('enforces 50KB and rejects unsupported/compressed bodies', async () => {
  const app = setup({}, () => assert.fail('must not enqueue'));
  const raw = JSON.stringify(payload(event('a', { message: { text: 'x'.repeat(50 * 1024) } })));
  assert.equal((await webhook(app, raw)).status, 413);
  assert.equal((await request(app).post('/webhooks/line').type('text').send('{}')).status, 415);
  assert.equal((await request(app).post('/webhooks/line').set('content-type', 'application/json')
    .set('content-encoding', 'gzip').send(gzipSync('{}'))).status, 415);
});

test('waits for durable enqueue before 200, and Redis failure returns retryable 503', async () => {
  const gate = deferred();
  const entered = deferred();
  let completed = false;
  const app = setup({}, async () => { entered.resolve(); await gate.promise; return 1; });
  const running = webhook(app, JSON.stringify(payload(event()))).then(res => { completed = true; return res; });
  await entered.promise;
  await pause(20);
  assert.equal(completed, false);
  gate.resolve();
  assert.equal((await running).status, 200);
  const unavailable = setup({}, async () => { throw new Error('redis://sensitive-credentials private message'); });
  const res = await webhook(unavailable, JSON.stringify(payload(event())));
  assert.equal(res.status, 503);
  assert.equal(res.headers['retry-after'], '5');
  assert.deepEqual(res.body, { error: 'queue_unavailable' });
});

test('/ping accepts a secret parameter or header and rejects duplicates', async () => {
  const app = setup();
  assert.equal((await request(app).get('/ping')).status, 401);
  assert.equal((await request(app).get('/ping').query({ secret: 'wrong' })).status, 401);
  assert.equal((await request(app).get('/ping').query({ secret: [config.pingSecret, config.pingSecret] })).status, 401);
  assert.equal((await request(app).get('/ping').query({ secret: config.pingSecret })).status, 200);
  const res = await request(app).get('/ping').set('x-ping-secret', config.pingSecret);
  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-powered-by'], undefined);
});

test('HTTPS honors only configured proxies', async () => {
  const direct = setup({ enforceHttps: true });
  assert.equal((await request(direct).get('/ping').set('x-forwarded-proto', 'https')).status, 426);
  const proxied = setup({ enforceHttps: true, trustProxy: ['loopback'] });
  assert.equal((await request(proxied).get('/ping').set('x-ping-secret', config.pingSecret)).status, 426);
  assert.equal((await request(proxied).get('/ping').set('x-ping-secret', config.pingSecret).set('x-forwarded-proto', 'https')).status, 200);
});

test('/v1 fails closed before JWT is configured', async () => {
  assert.equal((await request(setup()).get('/v1/future')).status, 503);
  assert.equal((await request(setup()).get('/unknown')).status, 404);
});

test('admin static assets expose no backend files and SSO is closed until configured', async () => {
  const app = setup();
  const page = await request(app).get('/admin/routes');
  assert.equal(page.status, 200);
  assert.match(page.text, /CUSA SSO/);
  assert.ok(page.headers['content-security-policy']);
  assert.equal((await request(app).get('/admin/assets/admin.js')).status, 200);
  for (const path of ['/.env', '/src/config.js', '/app.js']) assert.equal((await request(app).get(path)).status, 404);
  for (const path of ['/auth/sso/login', '/auth/sso/session', '/v1/admin/webhook-routing']) {
    const res = await request(app).get(path);
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: 'sso_not_configured' });
  }
});

test('production SSO state cookies use __Host, Secure, HttpOnly and SameSite=Lax', async () => {
  const app = createApp({
    config: { ...config, enforceHttps: true, trustProxy: ['loopback'], sso: { redirectUri: 'https://gateway.example.test/auth/sso/callback' } },
    logger, queue: {}, sso: { async beginLogin() { return { binding: 'test-binding', url: 'https://sso.example.test/api/sso/authorize' }; } }
  });
  const res = await request(app).get('/auth/sso/login').set('x-forwarded-proto', 'https');
  assert.equal(res.status, 303);
  const cookie = res.headers['set-cookie'][0];
  for (const expected of ['__Host-reunion_login=', 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax']) assert.ok(cookie.includes(expected));
  assert.doesNotMatch(cookie, /Domain=/);
});

test('/v1 pins RS256, issuer, audience, subject and expiry', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const settings = { key: publicKey, issuer: 'cusa-sso', audience: 'reunion-api' };
  const app = setup({ jwt: settings });
  const token = (claims = {}, options = {}) => jwt.sign({ sub: 'test-user', ...claims }, privateKey, {
    algorithm: 'RS256', issuer: settings.issuer, audience: settings.audience, expiresIn: 300, ...options
  });
  assert.equal((await request(app).get('/v1/future')).status, 401);
  // A valid token reaches the router; no CRUD resource has been defined yet.
  assert.equal((await request(app).get('/v1/future').auth(token(), { type: 'bearer' })).status, 404);
  for (const invalid of [
    token({}, { audience: 'other' }), token({}, { issuer: 'other' }), token({}, { expiresIn: -30 }),
    token({ sub: '' }), jwt.sign({ sub: 'a', iss: settings.issuer, aud: settings.audience }, privateKey, { algorithm: 'RS256' }),
    jwt.sign({ sub: 'a' }, 'untrusted-secret', { algorithm: 'HS256' })
  ]) {
    assert.equal((await request(app).get('/v1/future').auth(invalid, { type: 'bearer' })).status, 401);
  }
  assert.equal((await request(app).post('/v1/future').auth(token(), { type: 'bearer' }).send({ data: 'x'.repeat(51201) })).status, 413);
});
