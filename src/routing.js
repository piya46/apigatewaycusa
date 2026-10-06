'use strict';
const { isMfa, validMfa } = require('../public/admin/assets/line-contract');

function routeEvent(event, routing) {
  if (isMfa(event)) {
    if (!validMfa(event)) return { drop: 'invalid_mfa' };
    const sso = routing.apps.find(app => app.id === 'sso');
    if (!sso) throw new Error('Protected SSO target unavailable');
    return { name: 'sso', url: sso.url, delivery: 'line-raw-v1' };
  }
  let appId = routing.fallbackAppId;
  for (const rule of routing.rules) {
    if (!rule.enabled || event.type !== rule.eventType) continue;
    if (rule.postback) {
      if (typeof event.postback?.data !== 'string') continue;
      const values = new URLSearchParams(event.postback.data).getAll(rule.postback.key);
      if (values.length !== 1 || values[0] !== rule.postback.value) continue;
    }
    if (rule.action === 'reject') return { drop: 'policy_reject' };
    appId = rule.appId;
    break;
  }
  if (appId === null) return { drop: 'policy_reject' };
  const app = routing.apps.find(item => item.id === appId);
  if (!app) throw new Error('Routing target unavailable');
  if (app.id === 'sso') throw new Error('Generic events cannot target SSO');
  return { name: app.id, url: app.url };
}

module.exports = { routeEvent };
