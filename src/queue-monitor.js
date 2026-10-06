'use strict';

const { KEYS } = require('./queue');
const { parseJob } = require('./payload');
const PAGE_SIZE = 25;
const EVENT_TYPES = new Set(['message', 'postback', 'follow', 'unfollow', 'join', 'leave', 'memberJoined',
  'memberLeft', 'unsend', 'videoPlayComplete', 'beacon', 'accountLink', 'things']);
const ERROR_KINDS = new Set(['timeout', 'http_error', 'network_error', 'invalid_job', 'interrupted',
  'invalid_mfa', 'missing_original', 'partial_duplicate', 'delivery_contract']);
const timestamp = value => Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : null;

// Read-only, bounded, atomic snapshot. In particular, do not use CLAIM, RPOP,
// HGETALL, KEYS or any recovery/expiry writes just to display the queue.
const SNAPSHOT = `
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local waiting = redis.call('LLEN', KEYS[1])
  local processing = redis.call('HLEN', KEYS[2])
  local leases = redis.call('ZCARD', KEYS[3])
  local failed = redis.call('LLEN', KEYS[4])
  local expired = redis.call('ZCOUNT', KEYS[3], '-inf', now)
  local total = waiting
  if ARGV[1] == 'processing' then total = leases end
  if ARGV[1] == 'dlq' then total = failed end
  local offset = tonumber(ARGV[2])
  if offset >= total then offset = 0 end
  local limit = tonumber(ARGV[3])
  local rows = {}
  if ARGV[1] == 'processing' then
    local entries = redis.call('ZRANGE', KEYS[3], offset, offset + limit - 1, 'WITHSCORES')
    for i = 1, #entries, 2 do
      table.insert(rows, {redis.call('HGET', KEYS[2], entries[i]) or '', entries[i + 1]})
    end
  else
    local key = KEYS[1]
    if ARGV[1] == 'dlq' then key = KEYS[4] end
    local entries = redis.call('LRANGE', key, -offset - limit, -offset - 1)
    for i = #entries, 1, -1 do table.insert(rows, {entries[i], ''}) end
  end
  return {now, waiting, processing, failed, expired, leases, total, offset,
    redis.call('LINDEX', KEYS[1], -1) or '', rows}
`;

function jobSummary(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 102400) throw new Error();
    const job = parseJob(raw);
    const rawBatch = job.kind === 'line-raw';
    return { id: job.id, receivedAt: timestamp(job.receivedAt),
      kind: rawBatch ? (job.payload.events.length ? 'sso_batch' : 'verification') : 'event',
      eventCount: job.payload.events.length,
      ...(rawBatch ? {} : { eventType: EVENT_TYPES.has(job.payload.events[0].type) ? job.payload.events[0].type : 'other' }) };
  } catch { return { kind: 'invalid', receivedAt: null }; }
}

function deadLetterSummary(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 204800) throw new Error();
    const entry = JSON.parse(raw);
    const error = { kind: ERROR_KINDS.has(entry?.error?.kind) ? entry.error.kind : 'unknown' };
    if (Number.isInteger(entry?.error?.status) && entry.error.status >= 100 && entry.error.status <= 599) error.status = entry.error.status;
    return { ...jobSummary(entry.rawJob), failedAt: timestamp(entry.failedAt), error };
  } catch { return { kind: 'invalid', receivedAt: null, error: { kind: 'unknown' } }; }
}

function createQueueMonitor(redis, config) {
  return { async snapshot({ state = 'waiting', offset = 0 } = {}) {
    if (!['waiting', 'processing', 'dlq'].includes(state) || !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000000) {
      throw new TypeError('Invalid queue page');
    }
    const [capturedAt, waiting, processing, dlq, expiredLeases, leases, total, actualOffset, oldestRaw, rows] = await redis.eval(
      SNAPSHOT, 4, KEYS.main, KEYS.processing, KEYS.leases, KEYS.dlq, state, offset, PAGE_SIZE);
    return { capturedAt, state, offset: actualOffset, limit: PAGE_SIZE, total, hasMore: actualOffset + rows.length < total,
      counts: { waiting, processing, dlq, expiredLeases }, capacity: config.queueMaxLength,
      inconsistent: leases !== processing, oldestReceivedAt: oldestRaw ? jobSummary(oldestRaw).receivedAt : null,
      items: rows.map(([raw, score], index) => ({
        ...(state === 'dlq' ? deadLetterSummary(raw) : jobSummary(raw)),
        position: actualOffset + index + 1,
        ...(state === 'processing' ? { leaseExpiresAt: timestamp(Number(score)), leaseExpired: Number(score) <= capturedAt } : {})
      })) };
  } };
}

module.exports = { createQueueMonitor, jobSummary, deadLetterSummary, PAGE_SIZE };
