'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createPublicKey } = require('node:crypto');
const dotenv = require('dotenv');

const ROOT = path.resolve(__dirname, '..');

// Only this error type contains messages deliberately safe for terminal output.
// Native URL, filesystem, crypto and network errors may contain secrets.
class ConfigurationError extends Error {}

function privatePath(value) {
  const resolved = path.resolve(value);
  // Resolve existing ancestors too, so symlinks cannot hide public_html.
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  const real = path.join(fs.realpathSync(ancestor), path.relative(ancestor, resolved));
  const publicRoot = path.join(ROOT, 'public');
  const publicReal = fs.existsSync(publicRoot) ? fs.realpathSync(publicRoot) : publicRoot;
  if ([resolved, real].some(p => p.split(path.sep).includes('public_html')
    || [publicRoot, publicReal].some(root => p === root || p.startsWith(root + path.sep)))) {
    throw new ConfigurationError('Application, environment, keys and logs must be outside public_html and the public document root');
  }
  return resolved;
}

function loadConfig(env = process.env) {
  const required = name => {
    const value = env[name];
    if (!value || value !== value.trim()) throw new ConfigurationError(`${name} is required without surrounding whitespace`);
    return value;
  };
  const integer = (name, fallback, min, max) => {
    const value = env[name] ?? String(fallback);
    if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
      throw new ConfigurationError(`${name} must be an integer between ${min} and ${max}`);
    }
    return Number(value);
  };
  const secret = name => {
    const value = required(name);
    if (value.length < 32 || /[\r\n]/.test(value)) throw new ConfigurationError(`${name} must contain at least 32 characters without line breaks`);
    return value;
  };
  const endpoint = (name, fallback) => {
    let url;
    try { url = new URL(env[name] ? required(name) : fallback); } catch { throw new ConfigurationError(`${name} must be an HTTPS URL`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new ConfigurationError(`${name} must be an HTTPS URL without credentials or a fragment`);
    }
    return url.href;
  };
  const nodeEnv = env.NODE_ENV || 'production';
  if (!['production', 'development', 'test'].includes(nodeEnv)) throw new ConfigurationError('Invalid NODE_ENV');
  const enforceHttps = env.ENFORCE_HTTPS ?? 'true';
  if (!['true', 'false'].includes(enforceHttps) || (nodeEnv === 'production' && enforceHttps !== 'true')) {
    throw new ConfigurationError('ENFORCE_HTTPS must be true in production');
  }
  const trustProxy = env.TRUST_PROXY || 'false';
  if (trustProxy === 'true' || /^\d+$/.test(trustProxy)) {
    throw new ConfigurationError('TRUST_PROXY must list trusted proxy addresses/subnets, or false');
  }
  const redisUrl = required('REDIS_URL');
  try {
    const url = new URL(redisUrl);
    if (url.protocol !== 'rediss:' || !url.hostname || !url.password || url.search || url.hash) throw new Error();
    if (/YOUR_PASSWORD|YOUR_ENDPOINT|REPLACE_WITH/i.test(redisUrl)) {
      throw new ConfigurationError('REDIS_URL still contains example placeholders');
    }
  } catch (error) {
    if (error instanceof ConfigurationError) throw error;
    throw new ConfigurationError('REDIS_URL must be a rediss:// URL with credentials and no query/fragment');
  }

  const jwtValues = [env.JWT_PUBLIC_KEY_PATH, env.JWT_ISSUER, env.JWT_AUDIENCE];
  let sso;
  if ([env.SSO_APPLICATION_ID, env.SSO_API_KEY].some(Boolean)) {
    const applicationId = required('SSO_APPLICATION_ID');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(applicationId)) {
      throw new ConfigurationError('SSO_APPLICATION_ID must be the application UUID registered in CUSA SSO');
    }
    const origin = new URL(endpoint('SSO_ORIGIN', 'https://sso.reunion.scicu-alumni.com'));
    if (origin.pathname !== '/' || origin.search) throw new ConfigurationError('SSO_ORIGIN must contain only the HTTPS origin');
    const redirectUri = endpoint('SSO_REDIRECT_URI', 'https://api.reunion.scicu-alumni.com/auth/sso/callback');
    const callback = new URL(redirectUri);
    if (callback.pathname !== '/auth/sso/callback' || callback.search) throw new ConfigurationError('SSO_REDIRECT_URI must use /auth/sso/callback without a query');
    const apiKey = required('SSO_API_KEY');
    if (!/^[\x21-\x7e]+$/.test(apiKey)) throw new ConfigurationError('SSO_API_KEY must be a printable header value');
    sso = { origin: origin.origin, applicationId, apiKey, redirectUri, timeoutMs: integer('SSO_TIMEOUT_MS', 4000, 1000, 5000) };
  }
  let jwt;
  if (jwtValues.some(Boolean)) {
    if (!jwtValues.every(Boolean)) throw new ConfigurationError('Configure JWT_PUBLIC_KEY_PATH, JWT_ISSUER and JWT_AUDIENCE together');
    let key;
    try {
      key = createPublicKey(fs.readFileSync(privatePath(path.resolve(ROOT, env.JWT_PUBLIC_KEY_PATH))));
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('JWT_PUBLIC_KEY_PATH must point to a readable RSA public key file');
    }
    if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 2048) {
      throw new ConfigurationError('JWT public key must be RSA with at least 2048 bits');
    }
    jwt = { key, issuer: required('JWT_ISSUER'), audience: required('JWT_AUDIENCE') };
  }
  const config = {
    nodeEnv,
    port: integer('PORT', 3000, 1, 65535),
    host: env.HOST || '127.0.0.1',
    enforceHttps: enforceHttps === 'true',
    trustProxy: trustProxy === 'false' ? false : trustProxy.split(',').map(value => value.trim()),
    lineChannelSecret: required('LINE_CHANNEL_SECRET'),
    redisUrl,
    internalApiToken: secret('INTERNAL_API_TOKEN'),
    pingSecret: secret('PING_SECRET'),
    // Bootstrap URLs apply only when Redis has no routing configuration yet.
    ssoWebhookUrl: endpoint('SSO_WEBHOOK_URL', 'https://sso.reunion.scicu-alumni.com/api/line/mfa'),
    chatbotWebhookUrl: endpoint('CHATBOT_WEBHOOK_URL', 'https://chatbot.cusa.com/webhook'),
    forwardTimeoutMs: integer('FORWARD_TIMEOUT_MS', 4000, 3000, 5000),
    redisCommandTimeoutMs: integer('REDIS_COMMAND_TIMEOUT_MS', 1500, 100, 2000),
    workerPollMs: integer('WORKER_POLL_MS', 1000, 100, 60000),
    workerLeaseMs: integer('WORKER_LEASE_MS', 30000, 15000, 300000),
    queueMaxLength: integer('QUEUE_MAX_LENGTH', 5000, 1, 1000000),
    shutdownTimeoutMs: integer('SHUTDOWN_TIMEOUT_MS', 15000, 10000, 60000),
    logDir: privatePath(path.resolve(ROOT, env.LOG_DIR || 'logs')),
    logLevel: env.LOG_LEVEL || 'info',
    logRetentionDays: integer('LOG_RETENTION_DAYS', 14, 7, 14),
    logMaxSize: env.LOG_MAX_SIZE || '10m',
    jwt,
    sso
  };
  if (!['error', 'warn', 'info', 'debug'].includes(config.logLevel)) throw new ConfigurationError('Invalid LOG_LEVEL');
  if (!/^\d+[km]$/i.test(config.logMaxSize)) throw new ConfigurationError('LOG_MAX_SIZE must use k or m units');
  if (config.shutdownTimeoutMs <= config.forwardTimeoutMs + 4 * config.redisCommandTimeoutMs + 1000) {
    throw new ConfigurationError('SHUTDOWN_TIMEOUT_MS must allow a complete worker cycle');
  }
  return Object.freeze(config);
}

function loadEnvironment() {
  privatePath(ROOT);
  const envPath = privatePath(process.env.ENV_FILE || path.join(ROOT, '.env'));
  const result = dotenv.config({ path: envPath, quiet: true });
  if (result.error && (process.env.ENV_FILE || result.error.code !== 'ENOENT')) {
    throw new ConfigurationError('Environment file is not readable; check ENV_FILE and file permissions');
  }
  return loadConfig();
}

module.exports = { ConfigurationError, loadConfig, loadEnvironment, privatePath };
