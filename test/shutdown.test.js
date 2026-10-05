'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createShutdown } = require('../src/shutdown');
const { logger, deferred, pause } = require('./helpers');

test('shutdown drains requests and worker before quitting Redis and is idempotent', async () => {
  const httpDone = deferred();
  const workerDone = deferred();
  const actions = [];
  const server = {
    close(done) { actions.push('close-http'); httpDone.promise.then(() => done()); },
    closeIdleConnections() {}
  };
  const worker = { async stop() { actions.push('stop-worker'); await workerDone.promise; } };
  const redis = { status: 'ready', async quit() { actions.push('quit-redis'); }, disconnect() { actions.push('disconnect'); } };
  const shutdown = createShutdown({ server, worker, redis, logger, timeoutMs: 1000, exit: code => actions.push(`exit-${code}`) });
  const first = shutdown();
  assert.equal(shutdown(), first);
  await pause(10);
  assert.deepEqual(actions, ['close-http', 'stop-worker']);
  workerDone.resolve();
  await pause(10);
  assert.deepEqual(actions, ['close-http', 'stop-worker']);
  httpDone.resolve();
  await first;
  assert.deepEqual(actions, ['close-http', 'stop-worker', 'quit-redis', 'disconnect', 'exit-0']);
});

test('deadline closes sockets and Redis even when current work is stalled', async () => {
  const exited = deferred();
  const gate = deferred();
  const actions = [];
  const server = { close(done) { gate.promise.then(() => done()); }, closeAllConnections() { actions.push('close-all'); } };
  const redis = { status: 'end', disconnect() { actions.push('disconnect'); } };
  const shutdown = createShutdown({
    server, worker: { async stop() {} }, redis, logger, timeoutMs: 20,
    exit: code => { actions.push(code); exited.resolve(); }
  });
  const stopped = shutdown();
  await exited.promise;
  assert.deepEqual(actions, ['close-all', 'disconnect', 1]);
  gate.resolve();
  await stopped;
});
