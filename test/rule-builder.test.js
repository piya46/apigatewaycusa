'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSample, warnings, placeRule } = require('../public/admin/assets/rule-builder');
const { routeEvent } = require('../src/routing');
const rule = (id, postback, extra = {}) => ({ id, name: id, eventType: 'postback', enabled: true, appId: 'app', ...(postback ? { postback } : {}), ...extra });

test('postback examples decode values and preserve exact matching without silently accepting ambiguous or protected input', () => {
  assert.deepEqual(parseSample('source=richmenu&%61ction=register%20now').pairs,
    [{ key: 'source', value: 'richmenu' }, { key: 'action', value: 'register now' }]);
  for (const input of ['', 'not-data', '{"action":"register"}', 'https://example.com?key=value', 'action=',
    'action=a&%61ction=b', '%63usa_mfa=uuid&choice=token', 'action=%ZZ', 'action=%0a', 'action=' + 'x'.repeat(4096)]) {
    assert.ok(parseSample(input).error, input);
  }
  assert.equal(parseSample('note=hello%3Dworld').pairs[0].value, 'hello=world');
});

test('warnings identify actual shadowing, ignore disabled rules and do not confuse overlapping different keys with unreachable rules', () => {
  const exact = rule('exact', { key: 'action', value: 'register' });
  assert.deepEqual(warnings([rule('all'), exact]), [{ id: 'exact', previousId: 'all', kind: 'shadowed' }]);
  assert.deepEqual(warnings([exact, { ...exact, id: 'duplicate', appId: 'another' }]), [{ id: 'duplicate', previousId: 'exact', kind: 'duplicate' }]);
  assert.deepEqual(warnings([rule('all', null, { enabled: false }), exact]), []);
  assert.deepEqual(warnings([exact, rule('all')]), []);
  assert.deepEqual(warnings([exact, rule('overlap', { key: 'source', value: 'menu' })]), []);
  assert.deepEqual(warnings([rule('all', null, { eventType: 'message' }), exact]), []);
});

test('placing an exact rule before a broad rule removes the warning and changes routing as the editor predicts', () => {
  const exact = rule('exact', { key: 'action', value: 'register' }, { appId: 'registration' });
  const existing = [rule('all'), exact];
  const changed = placeRule(existing, exact, exact.id, 'all');
  assert.deepEqual(changed.map(item => item.id), ['exact', 'all']);
  assert.deepEqual(existing.map(item => item.id), ['all', 'exact']);
  assert.deepEqual(warnings(changed), []);
  const routing = { apps: [{ id: 'app', url: 'https://app.example.test' }, { id: 'registration', url: 'https://register.example.test' }], rules: changed, fallbackAppId: 'app' };
  assert.equal(routeEvent({ type: 'postback', postback: { data: 'source=menu&action=register' } }, routing).name, 'registration');
  assert.equal(routeEvent({ type: 'postback', postback: { data: 'action=other' } }, routing).name, 'app');
  assert.deepEqual(placeRule(existing, rule('new'), undefined, '').map(item => item.id), ['all', 'exact', 'new']);
});
