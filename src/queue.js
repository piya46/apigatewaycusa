'use strict';

const { randomUUID } = require('node:crypto');
const { mfaEventIds, eventIds } = require('./payload');
const { isMfa } = require('../public/admin/assets/line-contract');
const { RECENT, summarizeEvent } = require('./recent-events');

const KEYS = Object.freeze({
  main: 'webhook:queue:events',
  dlq: 'webhook:dlq:events',
  processing: 'webhook:processing:events',
  leases: 'webhook:processing:leases',
  idempotency: 'webhook:idempotency:'
});

// Each script is atomic. Accepted jobs are never held only in process memory.
const ENQUEUE = `
  local count = tonumber(ARGV[2])
  -- Lua errors do not roll back writes. Validate the history index before accepting jobs.
  local historyType = redis.call('TYPE', KEYS[3]).ok
  if historyType ~= 'none' and historyType ~= 'zset' then return 0 end
  if redis.call('LLEN', KEYS[1]) + redis.call('HLEN', KEYS[2]) + count > tonumber(ARGV[1]) then
    return 0
  end
  for i = 3, count + 2 do redis.call('LPUSH', KEYS[1], ARGV[i]) end
  -- Samples are already redacted; each has its own expiry, never extended by traffic.
  for i = count + 6, #ARGV do
    local sample = cjson.decode(ARGV[i])
    redis.call('SET', ARGV[count + 3] .. sample.id, ARGV[i], 'EX', ARGV[count + 4])
    redis.call('ZADD', KEYS[3], sample.receivedAt, sample.id)
  end
  local stale = redis.call('ZRANGE', KEYS[3], 0, -tonumber(ARGV[count + 5]) - 1)
  for _, id in ipairs(stale) do
    redis.call('DEL', ARGV[count + 3] .. id)
    redis.call('ZREM', KEYS[3], id)
  end
  redis.call('EXPIRE', KEYS[3], ARGV[count + 4])
  return count
`;

const CLAIM = `
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local expired = redis.call('ZRANGEBYSCORE', KEYS[3], '-inf', now, 'LIMIT', 0, 25)
  local recovered = 0
  for _, receipt in ipairs(expired) do
    local raw = redis.call('HGET', KEYS[2], receipt)
    if raw then
      redis.call('LPUSH', KEYS[4], cjson.encode({
        rawJob = raw, failedAt = now, error = {kind = 'interrupted'}
      }))
      redis.call('HDEL', KEYS[2], receipt)
      recovered = recovered + 1
    end
    redis.call('ZREM', KEYS[3], receipt)
  end
  local raw = redis.call('RPOP', KEYS[1])
  if raw then
    redis.call('HSET', KEYS[2], ARGV[1], raw)
    redis.call('ZADD', KEYS[3], now + tonumber(ARGV[2]), ARGV[1])
  end
  return {raw or '', recovered}
`;

const RESERVE_EVENT = `
  local time = redis.call('TIME')
  local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
  local lease = redis.call('ZSCORE', KEYS[2], ARGV[1])
  if not lease or tonumber(lease) <= now or redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
    return 'expired'
  end
  local duplicates = 0
  for i = 3, #KEYS do
    if redis.call('EXISTS', KEYS[i]) == 1 then duplicates = duplicates + 1 end
  end
  if duplicates > 0 then
    if duplicates == #KEYS - 2 then return 'duplicate' end
    return 'partial_duplicate'
  end
  for i = 3, #KEYS do redis.call('SET', KEYS[i], ARGV[2], 'NX', 'EX', 3600) end
  return 'reserved'
`;

const FINISH = `
  if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then return 0 end
  if ARGV[2] ~= '' then redis.call('LPUSH', KEYS[3], ARGV[2]) end
  redis.call('HDEL', KEYS[1], ARGV[1])
  redis.call('ZREM', KEYS[2], ARGV[1])
  return 1
`;

// Explicit replay removes only the marker owned by that failed job. If a newer
// delivery owns the marker, keep the DLQ entry for operator inspection.
const REPLAY = `
  local raw = redis.call('LINDEX', KEYS[1], -1)
  if not raw then return 'empty' end
  local ok, entry = pcall(cjson.decode, raw)
  if not ok or type(entry) ~= 'table' or type(entry.rawJob) ~= 'string' then return 'invalid' end
  local jobOk, job = pcall(cjson.decode, entry.rawJob)
  if not jobOk or type(job) ~= 'table' or type(job.id) ~= 'string' then return 'invalid' end
  local ids
  if job.version == 2 and job.kind == 'line-raw' and type(job.eventIds) == 'table' then
    ids = job.eventIds
  elseif job.version == 1 and type(job.payload) == 'table' and type(job.payload.events) == 'table'
    and type(job.payload.events[1]) == 'table' and type(job.payload.events[1].webhookEventId) == 'string' then
    ids = {job.payload.events[1].webhookEventId}
  else return 'invalid' end
  if redis.call('LLEN', KEYS[2]) + redis.call('HLEN', KEYS[3]) >= tonumber(ARGV[2]) then return 'full' end
  for _, id in ipairs(ids) do
    if type(id) ~= 'string' then return 'invalid' end
    local marker = redis.call('GET', ARGV[1] .. id)
    if marker and marker ~= job.id then return 'conflict' end
  end
  redis.call('LPUSH', KEYS[2], entry.rawJob)
  for _, id in ipairs(ids) do redis.call('DEL', ARGV[1] .. id) end
  redis.call('RPOP', KEYS[1])
  return 'replayed'
`;

function createQueue(redis, config) {
  return {
    async enqueue(payload, original) {
      if (!payload.events.length && !original) return 0;
      const receivedAt = Date.now();
      const jobs = [];
      let rawQueued = false;
      const addRaw = () => {
        if (!original || !Buffer.isBuffer(original.body)) throw new Error('Original LINE request required');
        jobs.push(JSON.stringify({ version: 2, kind: 'line-raw', id: randomUUID(), receivedAt,
          rawBody: original.body.toString('base64'), signature: original.signature, eventIds: mfaEventIds(payload) }));
        rawQueued = true;
      };
      if (!payload.events.length) addRaw();
      for (const event of payload.events) {
        // One immutable envelope per MFA batch; never send this batch to other apps.
        if (isMfa(event)) { if (!rawQueued) addRaw(); continue; }
        jobs.push(JSON.stringify({
        version: 1,
        id: randomUUID(),
        receivedAt,
        payload: { destination: payload.destination, events: [event] }
        }));
      }
      const samples = payload.events.map(event => JSON.stringify(summarizeEvent(event, config.lineChannelSecret, receivedAt)));
      const count = await redis.eval(ENQUEUE, 3, KEYS.main, KEYS.processing, RECENT.index,
        config.queueMaxLength, jobs.length, ...jobs, RECENT.prefix, RECENT.ttl, RECENT.limit, ...samples);
      if (count !== jobs.length) throw new Error('Queue unavailable');
      return count;
    },
    async claim() {
      const receipt = randomUUID();
      const [raw, recovered] = await redis.eval(CLAIM, 4,
        KEYS.main, KEYS.processing, KEYS.leases, KEYS.dlq, receipt, config.workerLeaseMs);
      return { job: raw ? { receipt, raw } : null, recovered };
    },
    reserveEvent(claim, job) {
      const keys = eventIds(job).map(id => KEYS.idempotency + id);
      return redis.eval(RESERVE_EVENT, 2 + keys.length, KEYS.processing, KEYS.leases,
        ...keys, claim.receipt, job.id);
    },
    ack(claim) {
      return redis.eval(FINISH, 3, KEYS.processing, KEYS.leases, KEYS.dlq, claim.receipt, '');
    },
    fail(claim, error, target) {
      const entry = JSON.stringify({ rawJob: claim.raw, failedAt: Date.now(), error, ...(target ? { target } : {}) });
      return redis.eval(FINISH, 3, KEYS.processing, KEYS.leases, KEYS.dlq, claim.receipt, entry);
    },
    replayOldest() {
      return redis.eval(REPLAY, 3, KEYS.dlq, KEYS.main, KEYS.processing, KEYS.idempotency, config.queueMaxLength);
    }
  };
}

module.exports = { createQueue, KEYS };
