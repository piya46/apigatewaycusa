'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeEvent, publicSample, currentRoute } = require('../src/recent-events');
const { defaultRouting, validateRouting } = require('../src/routing-store');
const { routeEvent } = require('../src/routing');
const { previewRoute } = require('../public/admin/assets/routing-preview');
const { config, event, mfa } = require('./helpers');
const secret = config.lineChannelSecret;
const postback = data => event('private-event-id', { type: 'postback', postback: { data } });
const rule = (extra = {}) => ({ id: 'register', name: 'Registration', enabled: true, eventType: 'postback',
  postback: { key: 'action', value: 'register' }, appId: 'chatbot', ...extra });

test('recent message metadata omits text, source, event IDs, reply tokens and raw bodies', () => {
  const sample = summarizeEvent(event('private-event-id', { source: { userId: 'private-user-id' }, replyToken: 'private-reply-token' }), secret);
  assert.deepEqual(Object.keys(sample).sort(), ['id', 'messageType', 'protected', 'receivedAt', 'redelivery', 'type']);
  assert.equal(sample.messageType, 'text');
  assert.doesNotMatch(JSON.stringify(sample), /private/);
});

test('protected MFA samples never retain parameter names, values or fingerprints, even for invalid MFA', () => {
  for (const incoming of [mfa(), postback('%63usa_mfa=private-challenge&choice=private-choice&action=register')]) {
    const sample = summarizeEvent(incoming, secret);
    assert.deepEqual(Object.keys(sample).sort(), ['id', 'protected', 'receivedAt', 'redelivery', 'type']);
    assert.equal(sample.protected, true);
    assert.deepEqual(currentRoute(sample, defaultRouting(config), secret), { kind: 'protected', appId: 'sso' });
  }
});

test('only short routing command values are visible; sensitive values and internal hashes never reach browsers', () => {
  const sample = summarizeEvent(postback('action=register&token=private-token&email=person%40example.test&challenge=secret&choice=private-choice&menu=123456&app=private%20name'), secret);
  assert.doesNotMatch(JSON.stringify(sample), /private-token|person@|private-choice|private name/);
  const routing = defaultRouting(config);
  routing.rules.push(rule({ postback: { key: 'token', value: 'private-token' } }));
  const result = publicSample(sample, routing, secret);
  assert.deepEqual(result.parameters[0], { key: 'action', ambiguous: false, value: 'register' });
  assert.ok(result.parameters.slice(1).every(item => item.masked && item.value === undefined));
  assert.equal(result.route.ruleId, 'register', 'masked values can still match privately');
  assert.doesNotMatch(JSON.stringify(result), /fingerprint|keyVersion|private-token|person@/);
  assert.equal(result.route.ruleName, 'Registration');
});

test('recent routing agrees with the worker for ordered, disabled, encoded and duplicate conditions', () => {
  const routing = defaultRouting(config);
  routing.rules.push(rule({ id: 'off', enabled: false, action: 'reject', appId: undefined }), rule());
  for (const data of ['action=register', '%61ction=%72egister', 'action=register&action=register', 'action=other', 'other=action%3Dregister', 'action=register+']) {
    const incoming = postback(data);
    const result = currentRoute(summarizeEvent(incoming, secret), routing, secret);
    assert.equal(result.appId, routeEvent(incoming, routing).name);
    assert.equal(result.ruleId, previewRoute(incoming, routing).rule?.id);
  }
  routing.rules[1] = rule({ action: 'reject', appId: undefined });
  assert.equal(currentRoute(summarizeEvent(postback('action=register'), secret), routing, secret).kind, 'reject');
});

test('truncated parameters or rotated signing keys report unknown instead of inventing a route', () => {
  const routing = defaultRouting(config); routing.rules.push(rule());
  const data = new URLSearchParams(Array.from({ length: 21 }, (_, i) => [`field${i}`, 'secret']));
  data.append('action', 'register');
  const sample = summarizeEvent(postback(data.toString()), secret);
  assert.equal(sample.parameters.length, 20); assert.equal(sample.truncated, true);
  assert.equal(currentRoute(sample, routing, secret).kind, 'unknown');
  const old = summarizeEvent(postback('action=register'), 'old-secret');
  assert.equal(currentRoute(old, routing, secret).kind, 'unknown');
  assert.equal(currentRoute(summarizeEvent(postback('action=register&action=register'), secret), routing, secret).fallback, true);
});

test('Reject rules and fallback validate without an app; ambiguous targets and reserved MFA rules fail', () => {
  const routing = defaultRouting(config);
  routing.fallbackAppId = null;
  routing.rules = [rule({ action: 'reject', appId: undefined })];
  assert.equal(validateRouting(routing).fallbackAppId, null);
  assert.equal(validateRouting(routing).rules[0].appId, undefined);
  for (const invalid of [rule({ action: 'reject' }), rule({ action: 'invalid' }), rule({ appId: undefined }),
    rule({ action: 'reject', appId: undefined, postback: { key: 'cusa_mfa', value: 'x' } })]) {
    assert.throws(() => validateRouting({ ...routing, rules: [invalid] }));
  }
});

test('Reject applies to first matching rule or fallback; reserved MFA always keeps its protected route', () => {
  const routing = defaultRouting(config);
  routing.rules = [rule({ action: 'reject', appId: undefined })];
  for (const incoming of [postback('action=register')]) {
    assert.deepEqual(routeEvent(incoming, routing), { drop: 'policy_reject' });
    assert.equal(previewRoute(incoming, routing).rejected, true);
  }
  assert.equal(routeEvent(event(), routing).name, 'chatbot');
  routing.fallbackAppId = null;
  assert.deepEqual(routeEvent(event(), routing), { drop: 'policy_reject' });
  assert.equal(previewRoute(event(), routing).rejected, true);
  routing.rules = [rule({ action: 'reject', appId: undefined, postback: undefined })];
  assert.equal(routeEvent(mfa(), routing).name, 'sso');
  assert.equal(previewRoute(mfa(), routing).app.id, 'sso');
  assert.deepEqual(routeEvent(postback('cusa_mfa=invalid'), routing), { drop: 'invalid_mfa' });
  assert.equal(previewRoute(postback('cusa_mfa=invalid'), routing).rejected, undefined);
});
