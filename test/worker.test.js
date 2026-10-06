'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Worker } = require('../src/worker');
const { routeEvent } = require('../src/routing');
const { defaultRouting } = require('../src/routing-store');
const { config, logger, event, payload, deferred, pause } = require('./helpers');

function setup({ raw, reservation = 'reserved', result = { ok: true } } = {}) {
  const calls = [];
  const job = { version: 1, id: randomUUID(), receivedAt: Date.now(), payload: payload(event()) };
  const claim = { receipt: randomUUID(), raw: raw ?? JSON.stringify(job) };
  const queue = {
    async claim() { return { job: claim, recovered: 0 }; },
    async reserveEvent() { calls.push('reserve'); return reservation; },
    async ack() { calls.push('ack'); },
    async fail(received, error, target) { calls.push({ error, target }); }
  };
  const forward = async () => { calls.push('forward'); return result; };
  const routingStore = { async get() { return defaultRouting(config); } };
  return { worker: new Worker({ queue, routingStore, forward, config, logger }), calls, queue };
}

test('a saved app and ordered rules change routing without changing environment', () => {
  const routing = defaultRouting(config);
  routing.apps.push({ id: 'registration', name: 'Registration', url: 'https://registration.example.test/webhook' });
  routing.rules.unshift({ id: 'register', name: 'Registration', enabled: true, eventType: 'postback', postback: { key: 'action', value: 'register' }, appId: 'registration' });
  const incoming = event('new-app', { type: 'postback', postback: { data: 'action=register' } });
  assert.equal(routeEvent(incoming, routing).name, 'registration');
  routing.rules[0].enabled = false;
  assert.equal(routeEvent(incoming, routing).name, 'chatbot');
  routing.fallbackAppId = 'registration';
  assert.equal(routeEvent(event(), routing).name, 'registration');
});

test('routing storage errors fail before idempotency reservation or forwarding', async () => {
  const { worker, calls } = setup();
  worker.routingStore = { async get() { throw new Error('unavailable'); } };
  await assert.rejects(worker.tick());
  assert.deepEqual(calls, []);
});

test('reserves idempotency before forwarding and acknowledges after delivery', async () => {
  const { worker, calls } = setup();
  await worker.tick();
  assert.deepEqual(calls, ['reserve', 'forward', 'ack']);
});

test('drops duplicate IDs without forwarding', async () => {
  const { worker, calls } = setup({ reservation: 'duplicate' });
  await worker.tick();
  assert.deepEqual(calls, ['reserve', 'ack']);
});

test('expired claims cannot be forwarded', async () => {
  const { worker, calls } = setup({ reservation: 'expired' });
  await worker.tick();
  assert.deepEqual(calls, ['reserve']);
});

test('forward failures go to DLQ with bounded metadata', async () => {
  for (const error of [{ kind: 'http_error', status: 500 }, { kind: 'timeout' }, { kind: 'network_error' }]) {
    const { worker, calls } = setup({ result: { ok: false, error } });
    await worker.tick();
    assert.deepEqual(calls, ['reserve', 'forward', { error, target: 'chatbot' }]);
  }
});

test('malformed queue entries go to DLQ without crashing', async () => {
  for (const raw of ['{bad', '{}', 'null']) {
    const { worker, calls } = setup({ raw });
    await worker.tick();
    assert.deepEqual(calls, [{ error: { kind: 'invalid_job' }, target: undefined }]);
  }
});

test('recursive timer never overlaps, stop waits for in-flight delivery', async () => {
  const gate = deferred();
  const entered = deferred();
  const { worker, calls } = setup();
  worker.forward = async () => { calls.push('forward'); entered.resolve(); await gate.promise; return { ok: true }; };
  worker.start();
  worker.start();
  await entered.promise;
  await pause(35);
  assert.deepEqual(calls, ['reserve', 'forward']);
  let stopped = false;
  const stop = worker.stop().then(() => { stopped = true; });
  await pause(20);
  assert.equal(stopped, false);
  gate.resolve();
  await stop;
  await pause(25);
  assert.deepEqual(calls, ['reserve', 'forward', 'ack']);
});

test('worker retries after Redis errors without unhandled rejections', async () => {
  let attempts = 0;
  const recovered = deferred();
  const queue = { async claim() {
    attempts++;
    if (attempts === 1) throw new Error('offline');
    recovered.resolve();
    return { job: null, recovered: 0 };
  } };
  const worker = new Worker({ queue, forward: () => assert.fail(), config, logger });
  worker.start();
  await recovered.promise;
  await worker.stop();
  assert.equal(attempts, 2);
});
