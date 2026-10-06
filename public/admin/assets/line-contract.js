'use strict';

// Shared by the worker and local simulator. This validates routing, not MFA approval.
(function (root) {
  const userId = /^U[0-9a-f]{32}$/;
  const uuid = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
  function isMfa(event) {
    return event?.type === 'postback' && typeof event.postback?.data === 'string'
      && new URLSearchParams(event.postback.data).has('cusa_mfa');
  }
  function validMfa(event, now = Date.now()) {
    if (!isMfa(event) || event.postback.data.length > 300 || event.source?.type !== 'user'
      || !userId.test(event.source?.userId || '') || !Number.isSafeInteger(event.timestamp)
      || event.timestamp < 0 || Math.abs(now - event.timestamp) > 180000
      || (event.mode !== undefined && event.mode !== 'active')) return false;
    const data = new URLSearchParams(event.postback.data);
    return data.size === 2 && data.getAll('cusa_mfa').length === 1 && data.getAll('choice').length === 1
      && uuid.test(data.get('cusa_mfa')) && /^[A-Za-z0-9_-]{43}$/.test(data.get('choice') || '');
  }
  const contract = { isMfa, validMfa };
  if (typeof module !== 'undefined' && module.exports) module.exports = contract;
  else root.LineContract = contract;
})(typeof window === 'undefined' ? globalThis : window);
