'use strict';

const { createHash, randomBytes } = require('node:crypto');
const { constantTimeSecret } = require('./middleware/security');

const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const random = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const stateKey = value => `webhook:auth:state:${hash(value)}`;
const sessionKey = value => `webhook:auth:session:${hash(value)}`;
class SsoError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status; }
}

async function readJson(response) {
  if (!response.body) throw new SsoError('sso_unavailable');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new SsoError('sso_unavailable');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

function createSsoClient(settings, fetchImpl = fetch) {
  async function post(endpoint, body) {
    try {
      const response = await fetchImpl(new URL(endpoint, settings.origin), {
        method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(settings.timeoutMs),
        headers: { 'content-type': 'application/json', 'x-api-key': settings.apiKey },
        body: JSON.stringify(body)
      });
      if (!response.ok) {
        await response.body?.cancel();
        // Never log or relay SSO error bodies, URLs, tokens or user profiles.
        const invalidCode = endpoint === '/api/sso/token' && response.status === 400;
        throw new SsoError(invalidCode ? 'login_failed' : 'sso_unavailable', invalidCode ? 400 : 503);
      }
      return await readJson(response);
    } catch (error) {
      if (error instanceof SsoError) throw error;
      throw new SsoError('sso_unavailable');
    }
  }
  return {
    exchange: (code, verifier) => post('/api/sso/token', {
      grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri, code_verifier: verifier
    }),
    introspect: token => post('/api/sso/introspect', { token }),
    revoke: token => post('/api/sso/revoke', { token })
  };
}

const CONSUME_STATE = `
  local raw = redis.call('GET', KEYS[1])
  if not raw then return false end
  if cjson.decode(raw).binding ~= ARGV[1] then return false end
  redis.call('DEL', KEYS[1])
  return raw
`;

function validIdentity(identity, applicationId) {
  if (!identity || identity.active !== true || identity.aud !== applicationId
    || !Number.isInteger(identity.exp) || identity.exp <= Math.floor(Date.now() / 1000)
    || typeof identity.sub !== 'string' || !UUID.test(identity.sub)
    || !Array.isArray(identity.roles) || !identity.roles.every(role => typeof role === 'string')
    || typeof identity.scope !== 'string' || !identity.scope.split(/\s+/).includes('identity:read')) {
    throw new SsoError('unauthorized', 401);
  }
  if (!identity.roles.includes('admin')) throw new SsoError('routing_admin_required', 403);
  return { sub: identity.sub, roles: identity.roles, exp: identity.exp };
}

function createSsoService(redis, settings, client = settings && createSsoClient(settings)) {
  const configured = () => { if (!settings) throw new SsoError('sso_not_configured'); };
  const loadSession = async id => {
    configured();
    if (typeof id !== 'string' || !OPAQUE.test(id)) throw new SsoError('unauthorized', 401);
    const raw = await redis.get(sessionKey(id));
    if (!raw) throw new SsoError('unauthorized', 401);
    const session = JSON.parse(raw);
    if (typeof session.accessToken !== 'string' || !OPAQUE.test(session.accessToken)
      || typeof session.csrfToken !== 'string' || !OPAQUE.test(session.csrfToken)
      || !Number.isInteger(session.expiresAt) || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new SsoError('unauthorized', 401);
    }
    return session;
  };
  return {
    async beginLogin() {
      configured();
      const state = random();
      const binding = random();
      const verifier = random();
      const saved = await redis.set(stateKey(state), JSON.stringify({ binding: hash(binding), verifier }), 'NX', 'EX', 600);
      if (saved !== 'OK') throw new SsoError('sso_unavailable');
      const url = new URL('/api/sso/authorize', settings.origin);
      url.search = new URLSearchParams({
        response_type: 'code', client_id: settings.applicationId, redirect_uri: settings.redirectUri,
        state, code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256', scope: 'identity:read'
      }).toString();
      return { url: url.href, binding };
    },
    async finishLogin({ state, code, binding }) {
      configured();
      if (![state, code, binding].every(value => typeof value === 'string' && OPAQUE.test(value))) {
        throw new SsoError('invalid_login_state', 400);
      }
      const raw = await redis.eval(CONSUME_STATE, 1, stateKey(state), hash(binding));
      if (!raw) throw new SsoError('invalid_login_state', 400);
      const { verifier } = JSON.parse(raw);
      // The authorization code is single-use: never retry an ambiguous exchange.
      const token = await client.exchange(code, verifier);
      if (!token || typeof token.access_token !== 'string' || !OPAQUE.test(token.access_token) || token.token_type !== 'Bearer'
        || !Number.isInteger(token.expires_in) || token.expires_in < 1 || token.expires_in > 300
        || typeof token.scope !== 'string' || !token.scope.split(/\s+/).includes('identity:read')) {
        throw new SsoError('sso_unavailable');
      }
      const identity = validIdentity(await client.introspect(token.access_token), settings.applicationId);
      const ttl = Math.min(token.expires_in, identity.exp - Math.floor(Date.now() / 1000));
      if (ttl < 1) throw new SsoError('unauthorized', 401);
      const id = random();
      const session = { accessToken: token.access_token, csrfToken: random(), expiresAt: Math.floor(Date.now() / 1000) + ttl };
      if (await redis.set(sessionKey(id), JSON.stringify(session), 'NX', 'EX', ttl) !== 'OK') throw new SsoError('sso_unavailable');
      return { id, ttl };
    },
    async authenticate(id) {
      const session = await loadSession(id);
      // No identity cache: revocations/role changes are checked on every operation.
      const identity = validIdentity(await client.introspect(session.accessToken), settings.applicationId);
      return { csrfToken: session.csrfToken, expiresAt: Math.min(session.expiresAt, identity.exp), identity };
    },
    async logout(id, csrfToken) {
      const session = await loadSession(id);
      if (!constantTimeSecret(csrfToken, session.csrfToken)) throw new SsoError('csrf_required', 403);
      await redis.del(sessionKey(id));
      // Always destroy local access even if upstream revocation is unavailable.
      try { return { revoked: (await client.revoke(session.accessToken))?.ok === true }; }
      catch { return { revoked: false }; }
    },
    async discardSession(id) {
      if (typeof id === 'string' && OPAQUE.test(id)) await redis.del(sessionKey(id));
    }
  };
}

module.exports = { createSsoClient, createSsoService, SsoError, validIdentity, stateKey, sessionKey };
