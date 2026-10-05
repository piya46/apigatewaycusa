'use strict';

function createForwarder(config, fetchImpl = fetch) {
  return async function forward(job, target) {
    const signal = AbortSignal.timeout(config.forwardTimeoutMs);
    try {
      const response = await fetchImpl(target.url, {
        method: 'POST',
        redirect: 'manual',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.internalApiToken}`,
          'x-webhook-event-id': job.payload.events[0].webhookEventId,
          'idempotency-key': job.payload.events[0].webhookEventId
        },
        body: JSON.stringify(job.payload),
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
