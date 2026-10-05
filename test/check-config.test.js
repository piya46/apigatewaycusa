'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const base = {
  LINE_CHANNEL_SECRET: 'private-line-channel-secret',
  REDIS_URL: 'rediss://default:PRIVATE_PASSWORD@redis.example.test:6379',
  INTERNAL_API_TOKEN: 'private-internal-token-with-at-least-32-characters',
  PING_SECRET: 'private-ping-secret-with-at-least-32-characters',
  SSO_WEBHOOK_URL: 'https://sso.example.test/mfa',
  CHATBOT_WEBHOOK_URL: 'https://chatbot.example.test/webhook'
};

function run(t, values = {}, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scicu-config-check-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const envPath = path.join(directory, '.env');
  const env = { ...base, ...values };
  fs.writeFileSync(envPath, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/check-config.js'), ...args], {
    env: { PATH: process.env.PATH, ENV_FILE: envPath }, encoding: 'utf8', timeout: 5000
  });
  const output = result.stdout + result.stderr;
  for (const value of [base.LINE_CHANNEL_SECRET, base.INTERNAL_API_TOKEN, base.PING_SECRET, 'PRIVATE_PASSWORD']) {
    assert.ok(!output.includes(value), 'checker must never display secret values');
  }
  return { ...result, output };
}

test('configuration checker validates offline without contacting Redis or starting a worker', t => {
  const result = run(t);
  assert.equal(result.status, 0);
  assert.match(result.output, /Configuration OK/);
  assert.match(result.output, /Offline check only/);
  assert.match(result.output, /JWT: not configured/);
});

test('configuration checker reports missing variable names without exposing values', t => {
  const result = run(t, { LINE_CHANNEL_SECRET: '' });
  assert.equal(result.status, 1);
  assert.match(result.output, /LINE_CHANNEL_SECRET is required/);
});

test('configuration checker rejects template Redis credentials', t => {
  const result = run(t, { REDIS_URL: 'rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379' });
  assert.equal(result.status, 1);
  assert.match(result.output, /REDIS_URL still contains example placeholders/);
  assert.doesNotMatch(result.output, /YOUR_PASSWORD/);
});

test('native URL, key-file and proxy errors are sanitized', t => {
  for (const values of [
    { REDIS_URL: 'PRIVATE_PASSWORD' },
    { JWT_PUBLIC_KEY_PATH: '/missing/PRIVATE_PASSWORD.pem', JWT_ISSUER: 'issuer', JWT_AUDIENCE: 'audience' },
    { TRUST_PROXY: 'PRIVATE_PASSWORD' }
  ]) {
    const result = run(t, values);
    assert.equal(result.status, 1);
    assert.match(result.output, /Configuration invalid/);
    assert.doesNotMatch(result.output, /at Object\.|Error: ENOENT|PRIVATE_PASSWORD/);
  }
});

test('unknown checker arguments fail before opening configuration or connections', t => {
  const result = run(t, {}, ['--forward']);
  assert.equal(result.status, 1);
  assert.match(result.output, /Usage:/);
  assert.doesNotMatch(result.output, /Configuration OK/);
});
