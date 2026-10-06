'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { previewRoute } = require('../public/admin/assets/routing-preview');
const { routeEvent } = require('../src/routing');

const routing = {
  apps: [{ id: 'other', name: 'SSO', url: 'https://sso.example.test/webhook' }, { id: 'chatbot', name: 'Chatbot', url: 'https://chat.example.test/webhook' }],
  rules: [
    { id: 'off', name: 'Disabled message', eventType: 'message', enabled: false, appId: 'other' },
    { id: 'mfa', name: 'MFA', eventType: 'postback', enabled: true, postback: { key: 'action', value: 'mfa' }, appId: 'other' },
    { id: 'follow', name: 'Follow', eventType: 'follow', enabled: true, appId: 'other' }
  ],
  fallbackAppId: 'chatbot'
};

test('the browser simulator agrees with worker routing including duplicate parameters and encoded values', () => {
  const cases = [
    [{ type: 'postback', postback: { data: 'action=mfa' } }, 'mfa'],
    [{ type: 'postback', postback: { data: 'challenge=abc&action=mfa' } }, 'mfa'],
    [{ type: 'postback', postback: { data: '%61ction=%6Dfa' } }, 'mfa'],
    [{ type: 'postback', postback: { data: 'action=mfa&action=mfa' } }, undefined],
    [{ type: 'postback', postback: { data: 'action=other&action=mfa' } }, undefined],
    [{ type: 'postback', postback: { data: 'action=MFA' } }, undefined],
    [{ type: 'postback', postback: { data: 'action=mfa+' } }, undefined],
    [{ type: 'postback', postback: { data: 'other=action=mfa' } }, undefined],
    [{ type: 'postback', postback: { data: '' } }, undefined],
    [{ type: 'postback' }, undefined],
    [{ type: 'message', postback: { data: 'action=mfa' } }, undefined],
    [{ type: 'follow' }, 'follow'],
    [{ type: 'join' }, undefined]
  ];
  for (const [event, ruleId] of cases) {
    const preview = previewRoute(event, routing);
    assert.deepEqual({ name: preview.app.id, url: preview.app.url }, routeEvent(event, routing));
    assert.equal(preview.rule?.id, ruleId);
  }
});

test('the simulator explains skipped rules and stops at the first enabled matching rule', () => {
  const rules = [
    { ...routing.rules[1], id: 'disabled', enabled: false },
    { ...routing.rules[1], id: 'first', postback: undefined, appId: 'chatbot' },
    { ...routing.rules[1], id: 'second' }
  ];
  const event = { type: 'postback', postback: { data: 'action=mfa' } };
  const preview = previewRoute(event, { ...routing, rules });
  assert.equal(preview.rule.id, 'first');
  assert.deepEqual(preview.steps.map(step => step.reason), ['disabled', 'matched']);
  assert.equal(preview.app.id, routeEvent(event, { ...routing, rules }).name);
  assert.equal(previewRoute(event, { ...routing, rules: [] }).app.id, 'chatbot');
});
