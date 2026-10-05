'use strict';

function routeEvent(event, routing) {
  let appId = routing.fallbackAppId;
  for (const rule of routing.rules) {
    if (!rule.enabled || event.type !== rule.eventType) continue;
    if (rule.postback) {
      if (typeof event.postback?.data !== 'string') continue;
      const values = new URLSearchParams(event.postback.data).getAll(rule.postback.key);
      if (values.length !== 1 || values[0] !== rule.postback.value) continue;
    }
    appId = rule.appId;
    break;
  }
  const app = routing.apps.find(item => item.id === appId);
  if (!app) throw new Error('Routing target unavailable');
  return { name: app.id, url: app.url };
}

module.exports = { routeEvent };
