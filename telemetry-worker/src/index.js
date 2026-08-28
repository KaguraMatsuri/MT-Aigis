const HEARTBEAT_INTERVAL_SECONDS = 5 * 60;
const ONLINE_WINDOW_SECONDS = 12 * 60;
const INSTALLATION_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_HEARTBEAT_BODY_BYTES = 256;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...extraHeaders,
    },
  });
}

function methodNotAllowed(allowedMethods) {
  return jsonResponse(
    { error: 'Method not allowed.' },
    405,
    { allow: allowedMethods.join(', ') },
  );
}

function utcDay(timestampMilliseconds) {
  return new Date(timestampMilliseconds).toISOString().slice(0, 10);
}

function numericValue(result) {
  const value = result && result.value;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function parseInstallationHash(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) return null;

  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HEARTBEAT_BODY_BYTES) {
    return null;
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_HEARTBEAT_BODY_BYTES) return null;

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const installationHash = payload.installationHash;
  return typeof installationHash === 'string' && INSTALLATION_HASH_PATTERN.test(installationHash)
    ? installationHash
    : null;
}

async function recordHeartbeat(request, env) {
  const installationHash = await parseInstallationHash(request);
  if (!installationHash) {
    return jsonResponse(
      { error: 'installationHash must be a 64-character lowercase hexadecimal SHA-256 hash.' },
      400,
    );
  }

  const nowMilliseconds = Date.now();
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const dayUtc = utcDay(nowMilliseconds);

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO installations (id_hash, last_seen_at)
      VALUES (?1, ?2)
      ON CONFLICT(id_hash) DO UPDATE SET last_seen_at = excluded.last_seen_at
    `).bind(installationHash, nowSeconds),
    env.DB.prepare(`
      INSERT OR IGNORE INTO daily_active (day_utc, id_hash)
      VALUES (?1, ?2)
    `).bind(dayUtc, installationHash),
  ]);

  return readStats(env);
}

async function readStats(env) {
  const nowMilliseconds = Date.now();
  const nowSeconds = Math.floor(nowMilliseconds / 1000);
  const dayUtc = utcDay(nowMilliseconds);
  const onlineCutoff = nowSeconds - ONLINE_WINDOW_SECONDS;

  const [totalResult, dailyResult, onlineResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT value
      FROM counters
      WHERE metric = 'total_installations'
    `),
    env.DB.prepare(`
      SELECT value
      FROM daily_counts
      WHERE day_utc = ?1
    `).bind(dayUtc),
    env.DB.prepare(`
      SELECT COUNT(*) AS value
      FROM installations
      WHERE last_seen_at >= ?1
    `).bind(onlineCutoff),
  ]);

  return jsonResponse({
    totalInstallations: numericValue(totalResult.results && totalResult.results[0]),
    dailyActive: numericValue(dailyResult.results && dailyResult.results[0]),
    onlineNow: numericValue(onlineResult.results && onlineResult.results[0]),
    dayUtc,
    heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_SECONDS,
    onlineWindowSeconds: ONLINE_WINDOW_SECONDS,
    generatedAt: new Date(nowMilliseconds).toISOString(),
  });
}

async function deleteExpiredDailyIdentifiers(env) {
  const dayUtc = utcDay(Date.now());
  await env.DB.prepare(`
    DELETE FROM daily_active
    WHERE day_utc < ?1
  `).bind(dayUtc).run();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (url.pathname === '/v1/heartbeat') {
        if (request.method !== 'POST') return methodNotAllowed(['POST']);
        return await recordHeartbeat(request, env);
      }

      if (url.pathname === '/v1/stats') {
        if (request.method !== 'GET') return methodNotAllowed(['GET']);
        return await readStats(env);
      }

      return jsonResponse({ error: 'Not found.' }, 404);
    } catch {
      return jsonResponse({ error: 'Service unavailable.' }, 503);
    }
  },

  scheduled(_event, env, context) {
    context.waitUntil(deleteExpiredDailyIdentifiers(env));
  },
};
