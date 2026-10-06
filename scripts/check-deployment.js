'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHmac } = require('node:crypto');
const dotenv = require('dotenv');
const { privatePath } = require('../src/config');

const ROOT = path.resolve(__dirname, '..');
const EMPTY_WEBHOOK = JSON.stringify({ destination: 'gateway-deployment-check', events: [] });
const USAGE = 'Usage: npm run deploy:check -- --url https://your-gateway.example [--public]\n';

function connectionFailure(error) {
  const explanations = {
    ENOTFOUND: 'DNS name not found',
    EAI_AGAIN: 'DNS lookup temporarily unavailable',
    ERR_TLS_CERT_ALTNAME_INVALID: 'TLS certificate does not cover this hostname',
    CERT_HAS_EXPIRED: 'TLS certificate has expired',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'TLS certificate is self-signed',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate chain is incomplete or untrusted',
    ECONNREFUSED: 'connection refused',
    ECONNRESET: 'connection reset',
    ETIMEDOUT: 'connection timed out'
  };
  return explanations[error?.cause?.code || error?.code]
    || (error?.name === 'TimeoutError' ? 'request timed out' : 'network, TLS, timeout or response limit');
}

function parseArgs(args) {
  let rawUrl;
  let publicOnly = false;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--url' && rawUrl === undefined) rawUrl = args[++index];
    else if (args[index] === '--public' && !publicOnly) publicOnly = true;
    else throw new Error('arguments');
  }
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('arguments'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('arguments');
  return { origin: url.origin, publicOnly };
}

function deploymentSecrets() {
  privatePath(ROOT);
  const file = privatePath(process.env.ENV_FILE || path.join(ROOT, '.env'));
  let values = {};
  try { values = dotenv.parse(fs.readFileSync(file)); }
  catch (error) { if (process.env.ENV_FILE || error.code !== 'ENOENT') throw new Error('configuration'); }
  // Like dotenv's defaults, Plesk environment variables override the local file.
  return {
    pingSecret: process.env.PING_SECRET ?? values.PING_SECRET,
    lineWebhookDestination: process.env.LINE_WEBHOOK_DESTINATION ?? values.LINE_WEBHOOK_DESTINATION,
    lineChannelSecret: process.env.LINE_CHANNEL_SECRET ?? values.LINE_CHANNEL_SECRET
  };
}

async function readBounded(response) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 128 * 1024) throw new Error('response_too_large');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function checkDeployment({ origin, publicOnly = false, pingSecret, lineChannelSecret, lineWebhookDestination, fetchImpl = fetch, write = text => process.stdout.write(text), timeoutMs = 8000 }) {
  let failed = 0;
  let passed = 0;
  async function check(label, endpoint, options, accepts) {
    try {
      const response = await fetchImpl(new URL(endpoint, origin), {
        ...options, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: 'application/json, text/html;q=0.8, */*;q=0.5', ...options?.headers }
      });
      // Never print response bodies, header values, request URLs or native errors.
      const text = await readBounded(response);
      let json;
      try { json = JSON.parse(text); } catch { /* HTML/assets are checked as text. */ }
      if (!accepts(response, text, json)) {
        failed++; write(`[FAIL] ${label} (HTTP ${response.status}; unexpected response)\n`); return;
      }
      passed++; write(`[PASS] ${label}\n`);
    } catch (error) {
      failed++; write(`[FAIL] ${label} (${connectionFailure(error)})\n`);
    }
  }
  const jsonStatus = (status, key, value) => (response, text, json) => response.status === status && json?.[key] === value;
  await check('Admin page and security policy', '/admin/routes', {}, (response, text) => response.status === 200
    && /text\/html/i.test(response.headers.get('content-type') || '')
    && Boolean(response.headers.get('content-security-policy'))
    && text.includes('id="editor"') && text.includes('/admin/assets/admin.js'));
  for (const [file, marker] of [['admin.css', ':root'], ['admin.js', 'RoutingPreview'], ['line-contract.js', 'validMfa'], ['routing-preview.js', 'previewRoute'], ['rule-builder.js', 'parseSample'], ['rule-editor.js', 'RuleEditor']]) {
    await check(`Admin asset ${file}`, `/admin/assets/${file}`, {}, (response, text) => response.status === 200 && text.includes(marker)
      && (file.endsWith('.css') ? /text\/css/i : /javascript/i).test(response.headers.get('content-type') || ''));
  }
  await check('Ping rejects missing secret', '/ping', {}, jsonStatus(401, 'error', 'unauthorized'));
  await check('SSO session rejects anonymous access', '/auth/sso/session', {}, jsonStatus(401, 'error', 'unauthorized'));
  await check('Admin API rejects anonymous access', '/v1/admin/webhook-routing', {}, jsonStatus(401, 'error', 'unauthorized'));
  await check('LINE rejects unsigned payload', '/webhooks/line', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: EMPTY_WEBHOOK
  }, jsonStatus(401, 'error', 'invalid_signature'));
  for (const endpoint of ['/.env', '/app.js', '/src/config.js', '/logs/']) {
    // HEAD avoids downloading file contents if Document Root is misconfigured.
    await check(`Private path blocked: ${endpoint}`, endpoint, { method: 'HEAD' }, response => [403, 404].includes(response.status));
  }
  const insecure = new URL('/admin/routes', origin); insecure.protocol = 'http:';
  await check('HTTP redirects to HTTPS or is rejected', insecure, {}, (response, text, json) => {
    if (response.status === 426 && json?.error === 'https_required') return true;
    if (![301, 302, 307, 308].includes(response.status)) return false;
    const next = new URL(response.headers.get('location'), insecure);
    return next.origin === origin && next.pathname === '/admin/routes' && !next.search && !next.hash;
  });

  // Only send credentials after the public checks identify the expected gateway.
  if (!publicOnly && !failed) {
    await check('Authenticated ping', '/ping', { headers: { 'x-ping-secret': pingSecret } }, jsonStatus(200, 'ok', true));
    if (/^U[0-9a-f]{32}$/.test(lineWebhookDestination || '')) {
      const body = JSON.stringify({ destination: lineWebhookDestination, events: [] });
      await check('Signed empty LINE verification (queued for SSO)', '/webhooks/line', {
        method: 'POST', body,
        headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', lineChannelSecret).update(body).digest('base64') }
      }, jsonStatus(200, 'ok', true));
    } else write('[SKIP] Signed verification: set LINE_WEBHOOK_DESTINATION to the real OA bot user ID.\n');
  } else write(`[SKIP] Authenticated checks: ${publicOnly ? 'public-only mode' : 'fix public checks first'}.\n`);
  write(`Deployment checks: ${passed} passed, ${failed} failed. Signed verification may enqueue one empty SSO delivery; no MFA or chat events sent.\n`);
  write('Redis connectivity, SSO browser login and actual event delivery need separate checks.\n');
  return failed ? 1 : 0;
}

async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { process.stdout.write(USAGE); return 0; }
  let options;
  try { options = parseArgs(args); }
  catch { process.stderr.write(USAGE); return 2; }
  if (!options.publicOnly) {
    try { Object.assign(options, deploymentSecrets()); }
    catch { process.stderr.write('Cannot read private environment configuration. Check ENV_FILE and file permissions.\n'); return 2; }
    const missing = [];
    if (typeof options.pingSecret !== 'string' || options.pingSecret.length < 32 || !/^[\x21-\x7e]+$/.test(options.pingSecret)) missing.push('PING_SECRET');
    if (typeof options.lineChannelSecret !== 'string' || !options.lineChannelSecret.trim() || options.lineChannelSecret.trim() !== options.lineChannelSecret) missing.push('LINE_CHANNEL_SECRET');
    if (missing.length) { process.stderr.write(`Set valid ${missing.join(', ')} values, or use --public. No requests were sent.\n`); return 2; }
  }
  return checkDeployment(options);
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('Deployment check failed. No secrets or response details were displayed.\n'); process.exitCode = 1;
});
module.exports = { main, parseArgs, checkDeployment };
