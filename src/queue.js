'use strict';

const { randomUUID } = require('node:crypto');

const KEYS = Object.freeze({
  main: 'webhook:queue:events',
  dlq: 'webhook:dlq:events',
  processing: 'webhook:processing:events',
  leases: 'webhook:processing:leases',
  idempotency: 'webhook:idempotency:'
});

// Each script is atomic. Accepted jobs are never held only in process memory.
const ENQUEUE = `
  local count = #ARGV - 1
  if redis.call('LLEN', KEYS[1]) + redis.call('HLEN', KEYS[2]) + count > tonumber(ARGV[1]) then
    return 0
  end
  for i = 2, #ARGV do redis.call('LPUSH', KEYS[1], ARGV[i]) end
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
  local reserved = redis.call('SET', KEYS[3], ARGV[2], 'NX', 'EX', 3600)
  if reserved then return 'reserved' end
  return 'duplicate'
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
  if not jobOk or type(job) ~= 'table' or type(job.id) ~= 'string'
    or type(job.payload) ~= 'table' or type(job.payload.events) ~= 'table'
    or type(job.payload.events[1]) ~= 'table'
    or type(job.payload.events[1].webhookEventId) ~= 'string' then return 'invalid' end
  if redis.call('LLEN', KEYS[2]) + redis.call('HLEN', KEYS[3]) >= tonumber(ARGV[2]) then return 'full' end
  local key = ARGV[1] .. job.payload.events[1].webhookEventId
  local marker = redis.call('GET', key)
  if marker and marker ~= job.id then return 'conflict' end
  redis.call('LPUSH', KEYS[2], entry.rawJob)
  if marker then redis.call('DEL', key) end
  redis.call('RPOP', KEYS[1])
  return 'replayed'
`;

function createQueue(redis, config) {
  return {
    async enqueue(payload) {
      if (payload.events.length === 0) return 0;
      const receivedAt = Date.now();
      const jobs = payload.events.map(event => JSON.stringify({
        version: 1,
        id: randomUUID(),
        receivedAt,
        payload: { destination: payload.destination, events: [event] }
      }));
      const count = await redis.eval(ENQUEUE, 2, KEYS.main, KEYS.processing, config.queueMaxLength, ...jobs);
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
      return redis.eval(RESERVE_EVENT, 3, KEYS.processing, KEYS.leases,
        KEYS.idempotency + job.payload.events[0].webhookEventId, claim.receipt, job.id);
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
