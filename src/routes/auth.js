'use strict';

const express = require('express');
const { SsoError } = require('../sso');
const { constantTimeSecret } = require('../middleware/security');

function cookieSettings(config) {
  const secure = config.enforceHttps;
  return {
    sessionName: secure ? '__Host-reunion_admin' : 'reunion_admin',
    loginName: secure ? '__Host-reunion_login' : 'reunion_login',
    options: { httpOnly: true, secure, sameSite: 'lax', path: '/' }
  };
}

function cookie(req, name) {
  const matches = (req.headers.cookie || '').split(';').map(value => value.trim()).filter(value => value.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : undefined;
}

function authError(res, error) {
  return res.status(error instanceof SsoError ? error.status : 503).json({ error: error instanceof SsoError ? error.code : 'sso_unavailable' });
}

function requireAdminSession({ config, sso }) {
  const cookies = cookieSettings(config);
  return async (req, res, next) => {
    try {
      if (!sso || !config.sso) throw new SsoError('sso_not_configured');
      const session = await sso.authenticate(cookie(req, cookies.sessionName));
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.get('origin') !== new URL(config.sso.redirectUri).origin
          || !constantTimeSecret(req.get('x-csrf-token'), session.csrfToken)) {
          throw new SsoError('csrf_required', 403);
        }
      }
      req.auth = session.identity;
      req.adminSession = { csrfToken: session.csrfToken, expiresAt: session.expiresAt };
      return next();
    } catch (error) { return authError(res, error); }
  };
}

function createAuthRouter({ config, sso }) {
  const router = express.Router();
  const cookies = cookieSettings(config);
  router.get('/login', async (req, res) => {
    try {
      if (!sso || !config.sso) throw new SsoError('sso_not_configured');
      const login = await sso.beginLogin();
      res.cookie(cookies.loginName, login.binding, { ...cookies.options, maxAge: 600000 });
      return res.redirect(303, login.url);
    } catch (error) { return authError(res, error); }
  });
  router.get('/callback', async (req, res) => {
    try {
      if (!sso || !config.sso) throw new SsoError('sso_not_configured');
      const result = await sso.finishLogin({ state: req.query.state, code: req.query.code, binding: cookie(req, cookies.loginName) });
      await sso.discardSession(cookie(req, cookies.sessionName));
      res.clearCookie(cookies.loginName, cookies.options);
      res.cookie(cookies.sessionName, result.id, { ...cookies.options, maxAge: result.ttl * 1000 });
      return res.redirect(303, '/admin/routes');
    } catch {
      res.clearCookie(cookies.loginName, cookies.options);
      // Strip authorization codes/state from the browser URL even on failure.
      return res.redirect(303, '/admin/routes?login=failed');
    }
  });
  router.get('/session', requireAdminSession({ config, sso }), (req, res) => res.json({ authenticated: true, ...req.adminSession }));
  router.post('/logout', async (req, res) => {
    try {
      if (!sso || !config.sso) throw new SsoError('sso_not_configured');
      if (req.get('origin') !== new URL(config.sso.redirectUri).origin) throw new SsoError('csrf_required', 403);
      const result = await sso.logout(cookie(req, cookies.sessionName), req.get('x-csrf-token'));
      res.clearCookie(cookies.sessionName, cookies.options);
      return res.json({ ok: true, ssoRevoked: result.revoked });
    } catch (error) { return authError(res, error); }
  });
  return router;
}

module.exports = { createAuthRouter, requireAdminSession };
