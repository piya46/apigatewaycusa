'use strict';

// A local simulation: no network requests or event delivery. Keep these matching
// rules aligned with src/routing.js; routing-preview.test.js checks that contract.
(function (root) {
  function previewRoute(event, routing) {
    const steps = [];
    let matched;
    for (const rule of routing.rules) {
      let reason;
      if (!rule.enabled) reason = 'disabled';
      else if (event.type !== rule.eventType) reason = 'event_type';
      else if (rule.postback) {
        const values = typeof event.postback?.data === 'string'
          ? new URLSearchParams(event.postback.data).getAll(rule.postback.key) : [];
        if (values.length !== 1 || values[0] !== rule.postback.value) reason = 'condition';
      }
      steps.push({ id: rule.id, name: rule.name, reason: reason || 'matched' });
      if (!reason) { matched = rule; break; }
    }
    const app = routing.apps.find(item => item.id === (matched?.appId || routing.fallbackAppId));
    return { app, rule: matched, steps };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { previewRoute };
  else root.RoutingPreview = { previewRoute };
})(typeof window === 'undefined' ? globalThis : window);
