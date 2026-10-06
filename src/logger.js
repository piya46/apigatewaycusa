'use strict';

const fs = require('node:fs');
const path = require('node:path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

// No request, payload, URL, exception message/stack, event ID or token is logged.
// Accept only fixed application event codes and explicitly permitted metadata.
const CODES = new Set([
  'server_started', 'server_error', 'redis_ready', 'redis_error', 'redis_reconnecting',
  'webhook_queued', 'queue_unavailable', 'request_error', 'worker_error',
  'event_forwarded', 'event_duplicate', 'event_dead_lettered', 'event_dropped', 'claim_recovered',
  'shutdown_started', 'shutdown_complete', 'shutdown_timeout', 'shutdown_error',
  'fatal_error', 'dlq_replayed', 'routing_updated', 'routing_unavailable'
]);
function sanitizeMetadata(metadata = {}) {
  const safe = {};
  for (const key of ['count', 'status', 'durationMs']) {
    if (Number.isFinite(metadata[key])) safe[key] = metadata[key];
  }
  if (['sso', 'chatbot'].includes(metadata.target)) safe.target = metadata.target;
  if (['timeout', 'http_error', 'network_error', 'invalid_job', 'interrupted', 'invalid_mfa', 'missing_original', 'partial_duplicate', 'delivery_contract'].includes(metadata.reason)) safe.reason = metadata.reason;
  return safe;
}

function createLogger(config) {
  fs.mkdirSync(config.logDir, { recursive: true, mode: 0o700 });
  const transport = new DailyRotateFile({
    dirname: config.logDir,
    filename: 'gateway-%DATE%.log',
    datePattern: 'YYYY-MM-DD',
    utc: true,
    maxSize: config.logMaxSize,
    maxFiles: `${config.logRetentionDays}d`,
    auditFile: path.join(config.logDir, '.rotation-audit.json'),
    options: { flags: 'a', mode: 0o600 }
  });
  const fallback = () => process.stderr.write('{"level":"error","code":"log_write_failed"}\n');
  transport.on('error', fallback);
  const base = winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [transport]
  });
  base.on('error', fallback);
  const logger = {};
  for (const level of ['error', 'warn', 'info', 'debug']) {
    logger[level] = (code, metadata) => base.log(level, CODES.has(code) ? code : 'unclassified', sanitizeMetadata(metadata));
  }
  let closing;
  logger.close = () => {
    if (!closing) closing = new Promise(resolve => {
      // Winston's finish can precede the file stream flush. Wait for the
      // rotating stream too, otherwise process.exit can discard final logs.
      transport.logStream.once('finish', resolve);
      transport.logStream.once('error', resolve);
      base.once('finish', () => transport.close());
      base.end();
    });
    return closing;
  };
  return logger;
}

module.exports = { createLogger, sanitizeMetadata };
