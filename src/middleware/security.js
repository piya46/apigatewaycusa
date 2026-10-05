'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const jwt = require('jsonwebtoken');

function constantTimeSecret(value, expected) {
  if (typeof value !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(value).digest(), createHash('sha256').update(expected).digest());
}

function verifyLineSignature(raw, signature, secret) {
  if (!Buffer.isBuffer(raw) || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('base64');
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function requireJwt(config) {
  return (req, res, next) => {
    if (!config.jwt) return res.status(503).json({ error: 'api_auth_not_configured' });
    const authorization = req.get('authorization');
    if (!authorization || !/^Bearer [^\s]+$/.test(authorization)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    try {
      const claims = jwt.verify(authorization.slice(7), config.jwt.key, {
        algorithms: ['RS256'], issuer: config.jwt.issuer, audience: config.jwt.audience, clockTolerance: 5
      });
      if (typeof claims !== 'object' || !Number.isFinite(claims.exp) || typeof claims.sub !== 'string' || !claims.sub) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      req.auth = claims;
      return next();
    } catch { return res.status(401).json({ error: 'unauthorized' }); }
  };
}

module.exports = { constantTimeSecret, verifyLineSignature, requireJwt };
