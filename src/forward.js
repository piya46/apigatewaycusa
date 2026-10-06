'use strict';
const { createHash } = require('node:crypto');
const { verifyLineSignature } = require('./middleware/security');
const { isMfa } = require('../public/admin/assets/line-contract');

function createForwarder(config, fetchImpl = fetch) {
  return async function forward(job, target) {
    let body, headers;
    if (target.name === 'sso' || job.kind === 'line-raw') {
      // Bind the original signature and dedicated credential to one server-configured URL.
      if (target.name !== 'sso' || target.url !== config.ssoWebhookUrl || job.kind !== 'line-raw') {
        return { ok: false, error: { kind: 'delivery_contract' } };
      }
      body = Buffer.from(job.rawBody, 'base64');
      if (!verifyLineSignature(body, job.signature, config.lineChannelSecret)
        || (config.lineWebhookDestination && job.payload.destination !== config.lineWebhookDestination)) {
        return { ok: false, error: { kind: 'delivery_contract' } };
      }
      headers = {
        authorization: `Bearer ${config.ssoWebhookGatewayToken || config.internalApiToken}`,
        'x-line-signature': job.signature,
        'x-gateway-delivery': 'line-raw-v1',
        'idempotency-key': createHash('sha256').update(body).digest('hex')
      };
    } else {
      if (job.payload.events.length !== 1 || isMfa(job.payload.events[0])) return { ok: false, error: { kind: 'delivery_contract' } };
      body = JSON.stringify(job.payload);
      headers = {
        authorization: `Bearer ${config.internalApiToken}`,
        'x-gateway-delivery': 'event-json-v1',
        'x-webhook-event-id': job.payload.events[0].webhookEventId,
        'idempotency-key': job.payload.events[0].webhookEventId
      };
    }
    const signal = AbortSignal.timeout(config.forwardTimeoutMs);
    try {
      const response = await fetchImpl(target.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        body,
        signal
      });
      // No downstream body is buffered or logged. Redirects are failures so the
      // internal credential is never forwarded to a different location.
      if (response.body) await response.body.cancel();
      return response.ok ? { ok: true } : { ok: false, error: { kind: 'http_error', status: response.status } };
    } catch {
      return { ok: false, error: { kind: signal.aborted ? 'timeout' : 'network_error' } };
    }
  };
}

module.exports = { createForwarder };
