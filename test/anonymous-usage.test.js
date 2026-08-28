const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createAnonymousUsageClient,
  createInstallationId,
  hashInstallationId,
  isValidInstallationId,
  normalizeStats,
  normalizeTelemetryEndpoint,
} = require('../lib/anonymous-usage');

const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const INSTALLATION_HASH = '4886f5c85315c96d881def73eaa3f41225b37c07c9598404efcd0598912f88dd';

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('creates valid installation IDs and derives a stable opaque hash', () => {
  const generatedId = createInstallationId();

  assert.equal(isValidInstallationId(generatedId), true);
  assert.equal(isValidInstallationId(INSTALLATION_ID), true);
  assert.equal(isValidInstallationId('not-an-installation-id'), false);
  assert.equal(hashInstallationId(INSTALLATION_ID), INSTALLATION_HASH);
  assert.equal(hashInstallationId(INSTALLATION_ID.toUpperCase()), INSTALLATION_HASH);
  assert.match(INSTALLATION_HASH, /^[0-9a-f]{64}$/);
  assert.equal(INSTALLATION_HASH.includes(INSTALLATION_ID), false);
  assert.equal(hashInstallationId('not-an-installation-id'), '');
});

test('accepts only credential-free HTTPS telemetry endpoints', () => {
  assert.equal(
    normalizeTelemetryEndpoint(' https://metrics.example.test/collect/?token=secret#fragment '),
    'https://metrics.example.test/collect'
  );
  assert.equal(normalizeTelemetryEndpoint('https://metrics.example.test/'), 'https://metrics.example.test');
  assert.equal(normalizeTelemetryEndpoint('http://metrics.example.test'), '');
  assert.equal(normalizeTelemetryEndpoint('https://user:password@metrics.example.test'), '');
  assert.equal(normalizeTelemetryEndpoint('https://<worker>.workers.dev'), '');
  assert.equal(normalizeTelemetryEndpoint('not a url'), '');
  assert.equal(normalizeTelemetryEndpoint(''), '');
});

test('normalizes public counters without trusting malformed service data', () => {
  assert.deepEqual(normalizeStats({
    onlineNow: '7',
    dailyActive: -1,
    totalInstallations: 3.5,
    dayUtc: '2026-08-27',
    onlineWindowSeconds: 300,
    generatedAt: '2026-08-27T09:00:00.000Z',
  }), {
    onlineNow: 7,
    dailyActive: 0,
    totalInstallations: 0,
    dayUtc: '2026-08-27',
    onlineWindowSeconds: 300,
    generatedAt: '2026-08-27T09:00:00.000Z',
  });

  assert.deepEqual(normalizeStats({
    onlineNow: Number.MAX_SAFE_INTEGER + 1,
    dayUtc: '2026-8-27',
  }), {
    onlineNow: 0,
    dailyActive: 0,
    totalInstallations: 0,
    dayUtc: '',
    onlineWindowSeconds: 0,
    generatedAt: '',
  });
  assert.deepEqual(normalizeStats(null), {
    onlineNow: 0,
    dailyActive: 0,
    totalInstallations: 0,
    dayUtc: '',
    onlineWindowSeconds: 0,
    generatedAt: '',
  });
});

test('start, heartbeat, refresh, and stop follow the anonymous request contract', async (context) => {
  const calls = [];
  const publishedStates = [];
  const fetchImpl = async (url, init) => {
    calls.push({ init, url });
    if (url.endsWith('/v1/heartbeat')) {
      return jsonResponse({
        onlineNow: 4,
        dailyActive: '12',
        totalInstallations: 30,
        dayUtc: '2026-08-27',
        onlineWindowSeconds: 300,
        generatedAt: '2026-08-27T09:00:00.000Z',
      });
    }
    return jsonResponse({
      onlineNow: 5,
      dailyActive: 13,
      totalInstallations: 31,
      dayUtc: '2026-08-27',
      onlineWindowSeconds: 300,
      generatedAt: '2026-08-27T09:01:00.000Z',
    });
  };
  const client = createAnonymousUsageClient({
    endpoint: 'https://metrics.example.test/collect/',
    fetchImpl,
    getInstallationId: () => INSTALLATION_ID,
    heartbeatIntervalMs: 60_000,
    requestTimeoutMs: 60_000,
    onState: (state) => publishedStates.push(state),
  });
  context.after(() => client.stop());

  assert.deepEqual(await client.heartbeat(), {
    configured: true,
    enabled: false,
    status: 'idle',
    stats: null,
  });
  assert.equal(calls.length, 0);
  assert.deepEqual(client.start(60_000), {
    configured: true,
    enabled: true,
    status: 'idle',
    stats: null,
  });

  const heartbeatState = await client.heartbeat();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://metrics.example.test/collect/v1/heartbeat');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.deepEqual(calls[0].init.headers, {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  });
  assert.equal(calls[0].init.signal.aborted, false);
  assert.deepEqual(JSON.parse(calls[0].init.body), { installationHash: INSTALLATION_HASH });
  assert.equal(calls[0].init.body.includes(INSTALLATION_ID), false);
  assert.equal(heartbeatState.status, 'ready');
  assert.deepEqual(heartbeatState.stats, {
    onlineNow: 4,
    dailyActive: 12,
    totalInstallations: 30,
    dayUtc: '2026-08-27',
    onlineWindowSeconds: 300,
    generatedAt: '2026-08-27T09:00:00.000Z',
  });

  const refreshedState = await client.refresh();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, 'https://metrics.example.test/collect/v1/stats');
  assert.equal(calls[1].init.method, 'GET');
  assert.deepEqual(calls[1].init.headers, { Accept: 'application/json' });
  assert.equal(refreshedState.stats.onlineNow, 5);
  assert.deepEqual(
    publishedStates.map((state) => state.status),
    ['idle', 'connecting', 'ready', 'connecting', 'ready']
  );

  const stoppedState = client.stop();
  assert.equal(stoppedState.enabled, false);
  assert.equal(stoppedState.status, 'idle');
});

test('stop aborts an active request and stale generations cannot overwrite restarted state', async (context) => {
  const firstResponse = deferred();
  const calls = [];
  const publishedStates = [];
  const fetchImpl = (url, init) => {
    calls.push({ init, url });
    if (calls.length === 1) return firstResponse.promise;
    return Promise.resolve(jsonResponse({
      onlineNow: 9,
      dailyActive: 20,
      totalInstallations: 40,
      dayUtc: '2026-08-27',
      onlineWindowSeconds: 300,
      generatedAt: '2026-08-27T09:02:00.000Z',
    }));
  };
  const client = createAnonymousUsageClient({
    endpoint: 'https://metrics.example.test',
    fetchImpl,
    getInstallationId: () => INSTALLATION_ID,
    heartbeatIntervalMs: 60_000,
    requestTimeoutMs: 60_000,
    onState: (state) => publishedStates.push(state),
  });
  context.after(() => client.stop());

  client.start(60_000);
  const staleHeartbeat = client.heartbeat();
  assert.equal(client.heartbeat(), staleHeartbeat);
  assert.equal(calls.length, 1);
  assert.equal(client.getState().status, 'connecting');

  const staleSignal = calls[0].init.signal;
  client.stop();
  assert.equal(staleSignal.aborted, true);
  assert.deepEqual(client.start(60_000), {
    configured: true,
    enabled: true,
    status: 'idle',
    stats: null,
  });

  firstResponse.resolve(jsonResponse({
    onlineNow: 999,
    dailyActive: 999,
    totalInstallations: 999,
    dayUtc: '2026-08-27',
    onlineWindowSeconds: 300,
    generatedAt: '2026-08-27T09:01:30.000Z',
  }));
  await staleHeartbeat;
  assert.equal(client.getState().status, 'idle');
  assert.equal(client.getState().stats, null);

  const currentState = await client.heartbeat();
  assert.equal(calls.length, 2);
  assert.equal(currentState.status, 'ready');
  assert.equal(currentState.stats.onlineNow, 9);
  assert.equal(
    publishedStates.some((state) => state.stats && state.stats.onlineNow === 999),
    false
  );
});
