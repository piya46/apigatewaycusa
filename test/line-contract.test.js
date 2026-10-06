'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { isMfa, validMfa } = require('../public/admin/assets/line-contract');
const { previewRoute } = require('../public/admin/assets/routing-preview');
const { routeEvent } = require('../src/routing');
const { defaultRouting, migrateRouting, validateRouting } = require('../src/routing-store');
const { createForwarder } = require('../src/forward');
const { parseJob, mfaEventIds } = require('../src/payload');
const { Worker } = require('../src/worker');
const { inspectRouting } = require('../scripts/check-routing');
const { config, logger, event, mfa, payload, sign } = require('./helpers');

function rawJob(events = [mfa()]) {
  // Deliberately preserve spaces, newline, Unicode and property order.
  const body = Buffer.from(JSON.stringify(payload(...events), null, 2) + '\n');
  const job = { version: 2, kind: 'line-raw', id: randomUUID(), receivedAt: Date.now(),
    rawBody: body.toString('base64'), signature: sign(body), eventIds: mfaEventIds(payload(...events)) };
  return { body, job: parseJob(JSON.stringify(job)) };
}

test('protected MFA parses encoded keys and validates source, UUID, opaque choice and freshness', () => {
  const valid = mfa();
  const [challenge, choice] = valid.postback.data.split('&');
  for (const data of [valid.postback.data, `${choice}&${challenge}`, valid.postback.data.replace('cusa_mfa', '%63usa_mfa')]) {
    assert.equal(validMfa({ ...valid, postback: { data } }), true);
  }
  const invalid = [
    mfa('a', { timestamp: Date.now() - 180001 }), mfa('a', { timestamp: Date.now() + 181000 }),
    mfa('a', { timestamp: '123' }), mfa('a', { mode: 'standby' }), mfa('a', { mode: 'unknown' }),
    mfa('a', { source: { type: 'group', userId: valid.source.userId } }),
    mfa('a', { source: { type: 'user', userId: 'U-invalid' } }),
    ...[`${valid.postback.data}&cusa_mfa=other`, `${valid.postback.data}&%63hoice=other`,
      `${valid.postback.data}&extra=1`, `cusa_mfa=no&${choice}`, `${challenge}&choice=approve`,
      `cusa_mfa=&${choice}`].map(data => mfa('a', { postback: { data } }))
  ];
  for (const input of invalid) {
    assert.equal(isMfa(input), true);
    assert.equal(validMfa(input), false);
    assert.deepEqual(routeEvent(input, defaultRouting(config)), { drop: 'invalid_mfa' });
    assert.equal(previewRoute(input, defaultRouting(config)).drop, true);
  }
  for (const type of ['message', 'accountLink', 'follow', 'unfollow']) {
    assert.equal(routeEvent(event('a', { type }), defaultRouting(config)).name, 'chatbot');
  }
});

test('MFA precedes catch-all rules and simulator uses the same contract', () => {
  const routing = defaultRouting(config);
  routing.rules.push({ id: 'all', name: 'All postbacks', enabled: true, eventType: 'postback', appId: 'chatbot' });
  const input = mfa();
  assert.equal(routeEvent(input, routing).name, 'sso');
  assert.equal(previewRoute(input, routing).app.id, 'sso');
  assert.equal(routeEvent(event('a', { type: 'postback', postback: { data: 'action=mfa' } }), routing).name, 'chatbot');
  assert.throws(() => validateRouting({ ...routing, fallbackAppId: 'sso' }));
  assert.throws(() => validateRouting({ ...routing, apps: routing.apps.filter(app => app.id !== 'sso') }));
  assert.throws(() => validateRouting({ ...routing, rules: [{ ...routing.rules[0], appId: 'sso' }] }));
});

test('migration replaces only shipped legacy MFA routing and preserves custom apps/rules', () => {
  const old = { ...defaultRouting(config), version: 1 };
  old.apps[0].url = 'https://sso.reunion.scicu-alumni.com/api/line/mfa';
  old.rules = [{ id: 'line-mfa', name: 'LINE MFA', enabled: true, eventType: 'postback', appId: 'sso', postback: { key: 'action', value: 'mfa' } },
    { id: 'custom', name: 'Custom', enabled: true, eventType: 'follow', appId: 'chatbot' }];
  const migrated = migrateRouting(old, config);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.apps[0].url, config.ssoWebhookUrl);
  assert.deepEqual(migrated.rules, [old.rules[1]]);
  assert.notEqual(migrated.revision, old.revision);
  assert.equal(old.version, 1);
  assert.throws(() => migrateRouting({ ...old, rules: [{ ...old.rules[0], id: 'custom-sso' }] }, config));
  assert.throws(() => migrateRouting({ ...old, rules: [{ ...old.rules[0], enabled: false }] }, config));
  assert.deepEqual(inspectRouting(JSON.stringify(old), config), { state: 'migration_ready', apps: 2, rules: 1 });
  assert.equal(inspectRouting(null, config).state, 'not_initialized');
  assert.equal(inspectRouting(JSON.stringify(migrated), config).state, 'current');
  const other = structuredClone(migrated); other.apps[0].url = 'https://other.example.test';
  assert.throws(() => inspectRouting(JSON.stringify(other), config));
  assert.throws(() => inspectRouting('malformed', config));
});

test('SSO receives byte-identical mixed batch, original signature and dedicated token only at pinned URL', async () => {
  const { body, job } = rawJob([event('message', { message: { text: 'ทดสอบ 👋' } }), mfa('one'), mfa('two')]);
  let requests = 0;
  const settings = { ...config, ssoWebhookGatewayToken: 'g'.repeat(43), lineWebhookDestination: job.payload.destination };
  const target = { name: 'sso', url: config.ssoWebhookUrl };
  const forward = createForwarder(settings, async (url, options) => {
    requests++;
    assert.equal(url, config.ssoWebhookUrl);
    assert.deepEqual(options.body, body);
    assert.equal(options.headers['x-line-signature'], sign(body));
    assert.equal(options.headers.authorization, `Bearer ${settings.ssoWebhookGatewayToken}`);
    assert.equal(options.headers['x-gateway-delivery'], 'line-raw-v1');
    assert.equal(options.headers.cookie, undefined);
    assert.equal(options.headers['x-forwarded-for'], undefined);
    assert.equal(options.redirect, 'manual');
    return new Response(null, { status: 200 });
  });
  assert.deepEqual(await forward(job, target), { ok: true });
  for (const [badJob, badTarget] of [
    [job, { ...target, url: 'https://other.example.test/webhook' }],
    [job, { ...target, name: 'chatbot' }],
    [{ ...job, rawBody: Buffer.concat([body, Buffer.from(' ')]).toString('base64') }, target],
    [{ ...job, payload: { ...job.payload, destination: `U${'2'.repeat(32)}` } }, target],
    [{ payload: payload(mfa()) }, { name: 'chatbot', url: config.chatbotWebhookUrl }],
    [{ payload: payload(mfa()) }, target]
  ]) assert.deepEqual(await forward(badJob, badTarget), { ok: false, error: { kind: 'delivery_contract' } });
  assert.equal(requests, 1);
});

test('raw queue jobs reject corrupted envelopes and mismatched deduplication IDs', () => {
  const { job } = rawJob();
  for (const changes of [{ eventIds: ['other'] }, { rawBody: job.rawBody + '!' }, { signature: 'invalid' },
    { rawBody: Buffer.from(JSON.stringify(payload(event()))).toString('base64'), eventIds: [] }]) {
    assert.throws(() => parseJob(JSON.stringify({ ...job, ...changes })));
  }
  assert.deepEqual(rawJob([]).job.eventIds, []);
});

test('legacy SSO still receives a valid original signature without enabling a new credential', async () => {
  const { body, job } = rawJob();
  const forward = createForwarder(config, async (url, options) => {
    assert.equal(options.headers.authorization, `Bearer ${config.internalApiToken}`);
    assert.equal(options.headers['x-line-signature'], sign(body));
    assert.deepEqual(options.body, body);
    return new Response(null, { status: 204 });
  });
  assert.deepEqual(await forward(job, { name: 'sso', url: config.ssoWebhookUrl }), { ok: true });
});

test('worker drops invalid-only MFA, keeps old jobs in DLQ, and never forwards partially duplicated batches', async () => {
  for (const mode of ['invalid', 'legacy', 'partial', 'valid', 'empty']) {
    const sample = mode === 'invalid' ? mfa('one', { timestamp: 0 }) : mfa();
    const job = mode === 'legacy' ? { version: 1, id: randomUUID(), receivedAt: Date.now(), payload: payload(sample) }
      : rawJob(mode === 'empty' ? [] : [sample]).job;
    const calls = [];
    const queue = {
      async claim() { return { job: { receipt: 'test', raw: JSON.stringify(job) }, recovered: 0 }; },
      async ack() { calls.push('ack'); },
      async fail(claim, error) { calls.push(error.kind); },
      async reserveEvent() { calls.push('reserve'); return mode === 'partial' ? 'partial_duplicate' : 'reserved'; }
    };
    const worker = new Worker({ config, logger, queue, routingStore: { async get() { return defaultRouting(config); } },
      forward: async () => { calls.push('forward'); return { ok: true }; } });
    await worker.tick();
    assert.deepEqual(calls, mode === 'invalid' ? ['ack'] : mode === 'legacy' ? ['missing_original']
      : mode === 'partial' ? ['reserve', 'partial_duplicate'] : ['reserve', 'forward', 'ack']);
  }
});
