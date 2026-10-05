'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSsoClient, validIdentity } = require('../src/sso');
const { validateRouting, defaultRouting } = require('../src/routing-store');
const { config } = require('./helpers');

const settings = { origin: 'https://sso.example.test', applicationId: '22222222-2222-4222-8222-222222222222', apiKey: 'private-sso-api-key', redirectUri: 'https://gateway.example.test/auth/sso/callback', timeoutMs: 100 };
const claims = () => ({ active: true, aud: settings.applicationId, sub: '11111111-1111-4111-8111-111111111111', roles: ['admin'], scope: 'identity:read', exp: Math.floor(Date.now() / 1000) + 300 });

test('SSO client follows the opaque-token JSON and X-API-Key contract', async () => {
  const requests = [];
  const client = createSsoClient(settings, async (url, options) => {
    requests.push({ path: url.pathname, options, body: JSON.parse(options.body) });
    return Response.json({ ok: true });
  });
  await client.exchange('code', 'verifier');
  await client.introspect('opaque-token');
  await client.revoke('opaque-token');
  assert.deepEqual(requests.map(item => item.path), ['/api/sso/token', '/api/sso/introspect', '/api/sso/revoke']);
  assert.deepEqual(requests[0].body, { grant_type: 'authorization_code', code: 'code', redirect_uri: settings.redirectUri, code_verifier: 'verifier' });
  for (const request of requests) {
    assert.equal(request.options.headers['x-api-key'], settings.apiKey);
    assert.equal(request.options.headers.authorization, undefined);
    assert.equal(request.options.redirect, 'manual');
  }
  assert.deepEqual(requests[1].body, { token: 'opaque-token' });
});

test('SSO client rejects redirects, huge responses and errors without exposing upstream data', async () => {
  for (const response of [new Response('private upstream secret', { status: 302 }), new Response('private token', { status: 500 }), new Response('x'.repeat(65537)), new Response('not JSON')]) {
    const client = createSsoClient(settings, async () => response);
    await assert.rejects(client.introspect('opaque'), error => error.message === 'sso_unavailable');
  }
});

test('SSO identity requires active, correct audience, expiry, scope and the service admin role', () => {
  assert.deepEqual(validIdentity({ ...claims(), email: 'private@example.test' }, settings.applicationId).roles, ['admin']);
  for (const override of [
    { active: false }, { aud: 'other' }, { exp: Math.floor(Date.now() / 1000) - 1 },
    { roles: ['viewer'] }, { roles: [], role: 'admin' }, { roles: 'admin' }, { scope: 'profile' }, { sub: '' }
  ]) assert.throws(() => validIdentity({ ...claims(), ...override }, settings.applicationId));
});

test('routing validates references, unique IDs, HTTPS targets and postback conditions', () => {
  assert.equal(validateRouting(defaultRouting(config)).fallbackAppId, 'chatbot');
  const changes = [
    value => { value.apps[0].url = 'http://sso.example.test'; },
    value => { value.apps[0].url = 'https://secret:password@sso.example.test'; },
    value => { value.apps.push(value.apps[0]); },
    value => { value.fallbackAppId = 'missing'; },
    value => { value.rules[0].appId = 'missing'; },
    value => { value.rules[0].eventType = 'message'; },
    value => { value.rules[0].postback.value = ''; },
    value => { value.rules[0].enabled = 'true'; }
  ];
  for (const change of changes) { const routing = defaultRouting(config); change(routing); assert.throws(() => validateRouting(routing)); }
});
