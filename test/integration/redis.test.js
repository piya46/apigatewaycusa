'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const request = require('supertest');
const { createRedis, closeRedis } = require('../../src/redis');
const { createQueue, KEYS } = require('../../src/queue');
const { createApp } = require('../../src/app');
const { Worker } = require('../../src/worker');
const { parseJob } = require('../../src/payload');
const { createRoutingStore, ROUTING_KEY } = require('../../src/routing-store');
const { createSsoService, sessionKey } = require('../../src/sso');
const { config, logger, event, payload, sign, pause } = require('../helpers');

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function redisFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scicu-redis-test-'));
  let client;
  let child;
  t.after(async () => {
    try {
      if (client) await closeRedis(client);
    } finally {
      if (child?.pid && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const cert = path.join(directory, 'cert.pem');
  const key = path.join(directory, 'key.pem');
  const envFile = path.join(directory, '.env');
  fs.writeFileSync(envFile, '', { mode: 0o600 });
  const certificate = spawnSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'
  ], { stdio: 'ignore' });
  assert.equal(certificate.status, 0, 'openssl must generate the local TLS fixture');
  const port = await freePort();
  const password = randomUUID();
  child = spawn(process.env.REDIS_SERVER_BIN || 'redis-server', [
    '--bind', '127.0.0.1', '--port', '0', '--tls-port', String(port),
    '--tls-cert-file', cert, '--tls-key-file', key, '--tls-ca-cert-file', cert,
    '--tls-auth-clients', 'no', '--requirepass', password,
    '--save', '', '--appendonly', 'no', '--dir', directory
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('TLS Redis startup timed out')), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`TLS Redis exited: ${code}`)); });
    child.stdout.on('data', chunk => {
      if (chunk.toString().includes('Ready to accept connections')) { clearTimeout(timeout); resolve(); }
    });
  });
  const redisConfig = { ...config, redisUrl: `rediss://default:${password}@127.0.0.1:${port}` };
  const newClient = async () => {
    const client = createRedis(redisConfig, logger);
    // Trust this fixture's self-signed CA while retaining hostname verification.
    client.options.tls.ca = fs.readFileSync(cert);
    await client.connect();
    return client;
  };
  client = await newClient();
  return { redis: client, newClient, redisConfig, cert, port, envFile };
}

function childEnvironment(fixture, overrides = {}) {
  return {
    ...process.env, ENV_FILE: fixture.envFile, NODE_ENV: 'test', ENFORCE_HTTPS: 'false',
    HOST: '127.0.0.1', TRUST_PROXY: 'false', REDIS_URL: fixture.redisConfig.redisUrl,
    LINE_CHANNEL_SECRET: config.lineChannelSecret, INTERNAL_API_TOKEN: config.internalApiToken,
    PING_SECRET: config.pingSecret, SSO_WEBHOOK_URL: config.ssoWebhookUrl,
    CHATBOT_WEBHOOK_URL: config.chatbotWebhookUrl,
    JWT_PUBLIC_KEY_PATH: '', JWT_ISSUER: '', JWT_AUDIENCE: '',
    SSO_APPLICATION_ID: '', SSO_API_KEY: '',
    NODE_EXTRA_CA_CERTS: fixture.cert, ...overrides
  };
}

test('Redis TLS queue integration', { timeout: 30000 }, async t => {
  const fixture = await redisFixture(t);
  const { redis } = fixture;
  const queue = createQueue(redis, config);
  const routingStore = createRoutingStore(redis, config);
  // This fixture always starts a new private Redis; never targets REDIS_URL.
  const reset = () => redis.flushdb();

  await t.test('client authenticates over verified TLS with bounded commands', async () => {
    assert.equal(await redis.ping(), 'PONG');
    assert.equal(redis.connector.stream.encrypted, true);
    assert.equal(redis.connector.stream.authorized, true);
    assert.equal(redis.options.enableOfflineQueue, false);
    assert.equal(redis.options.autoResendUnfulfilledCommands, false);
    const untrusted = createRedis(fixture.redisConfig, logger);
    untrusted.options.retryStrategy = () => null;
    await assert.rejects(untrusted.connect());
    untrusted.disconnect();
  });

  await t.test('batch enqueue and claims preserve FIFO with processing acknowledgements', async () => {
    await reset();
    assert.equal(await queue.enqueue(payload(event('a'), event('b'), event('c'))), 3);
    for (const id of ['a', 'b', 'c']) {
      const { job } = await queue.claim();
      assert.equal(parseJob(job.raw).payload.events[0].webhookEventId, id);
      assert.equal(await redis.hlen(KEYS.processing), 1);
      assert.equal(await queue.ack(job), 1);
      assert.equal(await queue.ack(job), 0);
    }
    assert.equal((await queue.claim()).job, null);
    assert.equal(await redis.zcard(KEYS.leases), 0);
  });

  await t.test('queue capacity rejects a complete batch and counts in-flight jobs', async () => {
    await reset();
    const small = createQueue(redis, { ...config, queueMaxLength: 2 });
    await small.enqueue(payload(event('a')));
    const { job } = await small.claim();
    await assert.rejects(small.enqueue(payload(event('b'), event('c'))));
    assert.equal(await redis.llen(KEYS.main), 0);
    assert.equal(await redis.hlen(KEYS.processing), 1);
    await small.ack(job);
    assert.equal(await small.enqueue(payload(event('b'), event('c'))), 2);
  });

  await t.test('concurrent workers reserve a duplicate webhookEventId only once with EX 3600', async () => {
    await reset();
    await queue.enqueue(payload(event('duplicate'), event('duplicate')));
    const claims = await Promise.all([queue.claim(), queue.claim()]);
    assert.notEqual(claims[0].job.receipt, claims[1].job.receipt);
    const results = await Promise.all(claims.map(({ job }) => queue.reserveEvent(job, parseJob(job.raw))));
    assert.deepEqual(results.sort(), ['duplicate', 'reserved']);
    const ttl = await redis.ttl(KEYS.idempotency + 'duplicate');
    assert.ok(ttl >= 3599 && ttl <= 3600);
    for (const { job } of claims) await queue.ack(job);
  });

  await t.test('failure atomically moves a claim to DLQ and explicit replay releases its marker', async () => {
    await reset();
    await queue.enqueue(payload(event('failed')));
    const { job } = await queue.claim();
    await queue.reserveEvent(job, parseJob(job.raw));
    assert.equal(await queue.fail(job, { kind: 'http_error', status: 500 }, 'chatbot'), 1);
    assert.equal(await queue.fail(job, { kind: 'http_error', status: 500 }, 'chatbot'), 0);
    assert.equal(await redis.hlen(KEYS.processing), 0);
    const entry = JSON.parse(await redis.lindex(KEYS.dlq, -1));
    assert.equal(entry.rawJob, job.raw);
    assert.deepEqual(entry.error, { kind: 'http_error', status: 500 });
    assert.equal(entry.target, 'chatbot');
    assert.equal(await queue.replayOldest(), 'replayed');
    assert.equal(await redis.get(KEYS.idempotency + 'failed'), null);
    assert.equal(await redis.llen(KEYS.dlq), 0);
    const replayed = (await queue.claim()).job;
    assert.equal(await queue.reserveEvent(replayed, parseJob(replayed.raw)), 'reserved');
    await queue.ack(replayed);
  });

  await t.test('interrupted claims are recovered to DLQ without discarding payloads', async () => {
    await reset();
    await queue.enqueue(payload(event('crashed')));
    const { job } = await queue.claim();
    await redis.zadd(KEYS.leases, 0, job.receipt);
    assert.equal(await queue.reserveEvent(job, parseJob(job.raw)), 'expired');
    const recovered = await queue.claim();
    assert.equal(recovered.recovered, 1);
    assert.equal(recovered.job, null);
    const entry = JSON.parse(await redis.lindex(KEYS.dlq, -1));
    assert.equal(entry.rawJob, job.raw);
    assert.deepEqual(entry.error, { kind: 'interrupted' });
    assert.equal(await queue.ack(job), 0);
    assert.equal(await queue.replayOldest(), 'replayed');
  });

  await t.test('DLQ replay keeps malformed entries and newer idempotency owners intact', async () => {
    await reset();
    await queue.enqueue(payload(event('conflict')));
    const { job } = await queue.claim();
    await queue.fail(job, { kind: 'timeout' });
    await redis.set(KEYS.idempotency + 'conflict', 'newer-job', 'EX', 3600);
    assert.equal(await queue.replayOldest(), 'conflict');
    assert.equal(await redis.llen(KEYS.dlq), 1);
    assert.equal(await redis.get(KEYS.idempotency + 'conflict'), 'newer-job');
    await reset();
    await redis.lpush(KEYS.dlq, 'invalid JSON');
    assert.equal(await queue.replayOldest(), 'invalid');
    assert.equal(await redis.llen(KEYS.dlq), 1);
  });

  await t.test('HTTP admission, mixed-event routing, duplicate suppression and DLQ work together', async () => {
    await reset();
    const sent = [];
    const worker = new Worker({ config, queue, routingStore, logger, forward: async (job, target) => {
      sent.push([job.payload.events[0].webhookEventId, target.name]);
      return target.name === 'sso' ? { ok: false, error: { kind: 'timeout' } } : { ok: true };
    } });
    const app = createApp({ config, queue, logger });
    const raw = JSON.stringify(payload(event('a'), event('b', { type: 'postback', postback: { data: 'action=mfa' } }), event('a')));
    assert.equal((await request(app).post('/webhooks/line').set('content-type', 'application/json').set('x-line-signature', sign(raw)).send(raw)).status, 200);
    assert.deepEqual(sent, []);
    for (let i = 0; i < 3; i++) await worker.tick();
    assert.deepEqual(sent, [['a', 'chatbot'], ['b', 'sso']]);
    assert.equal(await redis.llen(KEYS.main), 0);
    assert.equal(await redis.llen(KEYS.dlq), 1);
  });

  await t.test('routing changes persist across instances and stale edits cannot overwrite newer changes', async () => {
    await reset();
    const first = await routingStore.get();
    const second = createRoutingStore(redis, { ...config, ssoWebhookUrl: 'https://ignored.example.test' });
    assert.deepEqual(await second.get(), first);
    first.apps.push({ id: 'new-app', name: 'New app', url: 'https://new.example.test/webhook' });
    first.fallbackAppId = 'new-app';
    const saved = await routingStore.save(first);
    assert.notEqual(saved.revision, first.revision);
    assert.equal((await second.get()).fallbackAppId, 'new-app');
    await assert.rejects(second.save(first), /another administrator/);
    assert.equal(await redis.ttl(ROUTING_KEY), -1);
    await redis.set(ROUTING_KEY, 'corrupt');
    await assert.rejects(second.get());
    assert.equal(await redis.get(ROUTING_KEY), 'corrupt');
  });

  await t.test('SSO PKCE, one-time browser-bound state, session roles, CSRF and admin CRUD work together', async () => {
    await reset();
    const ssoConfig = { origin: 'https://sso.example.test', applicationId: '22222222-2222-4222-8222-222222222222', redirectUri: 'https://gateway.example.test/auth/sso/callback', apiKey: 'private-key', timeoutMs: 1000 };
    const accessToken = randomBytes(32).toString('base64url');
    const code = randomBytes(32).toString('base64url');
    let roles = ['admin'];
    let verifier;
    let exchanges = 0;
    let revoked = false;
    const client = {
      async exchange(received, receivedVerifier) {
        assert.equal(received, code); exchanges++; verifier = receivedVerifier;
        return { access_token: accessToken, token_type: 'Bearer', expires_in: 300, scope: 'identity:read' };
      },
      async introspect(token) {
        assert.equal(token, accessToken);
        return { active: true, aud: ssoConfig.applicationId, sub: '11111111-1111-4111-8111-111111111111', roles, scope: 'identity:read', exp: Math.floor(Date.now() / 1000) + 300 };
      },
      async revoke(token) { assert.equal(token, accessToken); revoked = true; return { ok: true }; }
    };
    const sso = createSsoService(redis, ssoConfig, client);
    const app = createApp({ config: { ...config, sso: ssoConfig }, queue, routingStore, sso, logger });
    assert.equal((await request(app).get('/v1/admin/webhook-routing')).status, 401);
    const start = await request(app).get('/auth/sso/login');
    assert.equal(start.status, 303);
    const authorize = new URL(start.headers.location);
    const state = authorize.searchParams.get('state');
    assert.equal(authorize.pathname, '/api/sso/authorize');
    assert.equal(authorize.searchParams.get('scope'), 'identity:read');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    const bindingCookie = start.headers['set-cookie'][0].split(';')[0];
    assert.match(start.headers['set-cookie'][0], /HttpOnly/);
    assert.equal((await request(app).get('/auth/sso/callback').query({ state, code })).headers.location, '/admin/routes?login=failed');
    assert.equal(exchanges, 0);
    const callback = await request(app).get('/auth/sso/callback').query({ state, code }).set('Cookie', bindingCookie);
    assert.equal(callback.headers.location, '/admin/routes');
    assert.equal(createHash('sha256').update(verifier).digest('base64url'), authorize.searchParams.get('code_challenge'));
    assert.equal((await request(app).get('/auth/sso/callback').query({ state, code }).set('Cookie', bindingCookie)).headers.location, '/admin/routes?login=failed');
    assert.equal(exchanges, 1);
    const sessionCookie = callback.headers['set-cookie'].find(value => value.startsWith('reunion_admin=')).split(';')[0];
    assert.ok(!sessionCookie.includes(accessToken));
    const session = await request(app).get('/auth/sso/session').set('Cookie', sessionCookie);
    assert.equal(session.status, 200);
    assert.ok(!JSON.stringify(session.body).includes(accessToken));
    const csrf = session.body.csrfToken;
    const loaded = await request(app).get('/v1/admin/webhook-routing').set('Cookie', sessionCookie);
    assert.equal(loaded.status, 200);
    const edit = loaded.body; edit.apps.push({ id: 'added', name: 'Added app', url: 'https://added.example.test/webhook' });
    for (const headers of [{}, { Origin: 'https://evil.example.test', 'X-CSRF-Token': csrf }, { Origin: 'https://gateway.example.test', 'X-CSRF-Token': 'wrong' }]) {
      assert.equal((await request(app).put('/v1/admin/webhook-routing').set('Cookie', sessionCookie).set(headers).send(edit)).status, 403);
    }
    const headers = { Origin: 'https://gateway.example.test', 'X-CSRF-Token': csrf, Cookie: sessionCookie };
    const saved = await request(app).put('/v1/admin/webhook-routing').set(headers).send(edit);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.apps.length, 3);
    assert.equal((await request(app).put('/v1/admin/webhook-routing').set(headers).send(edit)).status, 409);
    const invalid = { ...saved.body, fallbackAppId: 'missing' };
    assert.equal((await request(app).put('/v1/admin/webhook-routing').set(headers).send(invalid)).status, 400);
    roles = ['viewer'];
    assert.equal((await request(app).get('/v1/admin/webhook-routing').set('Cookie', sessionCookie)).status, 403);
    assert.equal((await request(app).put('/v1/admin/webhook-routing').set(headers).send(saved.body)).status, 403);
    // Logout clears local session independently of current upstream role.
    assert.equal((await request(app).post('/auth/sso/logout').set(headers)).status, 200);
    assert.equal(revoked, true);
    assert.equal(await redis.get(sessionKey(sessionCookie.split('=')[1])), null);
    assert.equal((await request(app).get('/auth/sso/session').set('Cookie', sessionCookie)).status, 401);
  });

  await t.test('Redis client reconnects after the server drops its socket', async () => {
    const observer = await fixture.newClient();
    try {
      const id = await redis.call('CLIENT', 'ID');
      const reconnected = once(redis, 'ready');
      await observer.call('CLIENT', 'KILL', 'ID', id);
      await reconnected;
      assert.equal(await redis.ping(), 'PONG');
    } finally { await closeRedis(observer); }
  });

  await t.test('command timeout is bounded and subsequent commands remain usable', async () => {
    await reset();
    const observer = await fixture.newClient();
    try {
      await observer.call('CLIENT', 'PAUSE', 800, 'ALL');
      await assert.rejects(redis.ping(), /timed out/i);
      await pause(400);
      assert.equal(await redis.ping(), 'PONG');
    } finally { await closeRedis(observer); }
  });

  await t.test('configuration checker verifies Redis TLS without consuming queued work', async () => {
    await reset();
    await queue.enqueue(payload(event('must-remain-queued')));
    const child = spawn(process.execPath, [path.resolve(__dirname, '../../scripts/check-config.js'), '--redis'], {
      env: childEnvironment(fixture), stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    assert.match(output, /Redis TLS connection and authentication OK/);
    assert.ok(!output.includes(fixture.redisConfig.redisUrl));
    assert.equal(await redis.llen(KEYS.main), 1);
    assert.equal(await redis.hlen(KEYS.processing), 0);
  });

  for (const mode of ['direct', 'passenger']) {
    await t.test(`entrypoint starts via ${mode} and drains on ${mode === 'direct' ? 'SIGTERM' : 'Passenger exit'}`, async () => {
    await reset();
    const appPort = await freePort();
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scicu-app-test-'));
    const entrypoint = path.resolve(__dirname, '../../app.js');
    // Reproduce the loader contract: require(startupFile), then emit exit.
    const loader = `
      global.PhusionPassenger = new (require('node:events').EventEmitter)();
      process.on('message', () => global.PhusionPassenger.emit('exit'));
      require(process.env.TEST_ENTRYPOINT);
    `;
    const args = mode === 'direct' ? [entrypoint] : ['-e', loader];
    const child = spawn(process.execPath, args, {
      env: childEnvironment(fixture, { PORT: String(appPort), LOG_DIR: directory, TEST_ENTRYPOINT: entrypoint }),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let stopped = false;
    try {
      let response;
      for (let attempt = 0; attempt < 60; attempt++) {
        try { response = await fetch(`http://127.0.0.1:${appPort}/ping`, {
          headers: { 'x-ping-secret': config.pingSecret }, signal: AbortSignal.timeout(1000)
        }); } catch {}
        if (response?.ok) break;
        if (child.exitCode !== null) break;
        await pause(50);
      }
      assert.equal(response?.status, 200);
      const raw = JSON.stringify(payload());
      const verify = await fetch(`http://127.0.0.1:${appPort}/webhooks/line`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sign(raw) }, body: raw
      });
      assert.equal(verify.status, 200);
      const exited = once(child, 'exit');
      if (mode === 'direct') child.kill('SIGTERM');
      else child.send('passenger-exit');
      const [code, signal] = await exited;
      stopped = true;
      assert.equal(code, 0);
      assert.equal(signal, null);
      const output = fs.readdirSync(directory).filter(name => name.endsWith('.log')).map(name => fs.readFileSync(path.join(directory, name), 'utf8')).join('');
      assert.match(output, /shutdown_complete/);
      assert.doesNotMatch(output, /private message|test-secret|test-token/);
    } finally {
      if (!stopped && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  }
});
