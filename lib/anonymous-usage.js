const crypto = require('crypto');

const INSTALLATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_CONTEXT = 'mt-aigis-anonymous-usage:v1\0';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 3000;

function createInstallationId() {
  return crypto.randomUUID();
}

function isValidInstallationId(value) {
  return INSTALLATION_ID_PATTERN.test(String(value || ''));
}

function hashInstallationId(value) {
  if (!isValidInstallationId(value)) return '';
  return crypto
    .createHash('sha256')
    .update(HASH_CONTEXT, 'utf8')
    .update(String(value).toLowerCase(), 'utf8')
    .digest('hex');
}

function normalizeTelemetryEndpoint(value) {
  try {
    const endpoint = new URL(String(value || '').trim());
    if (
      endpoint.protocol !== 'https:' ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hostname.includes('<')
    ) return '';
    endpoint.hash = '';
    endpoint.search = '';
    return endpoint.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

function normalizeStats(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  return {
    onlineNow: normalizeCount(source.onlineNow),
    dailyActive: normalizeCount(source.dailyActive),
    totalInstallations: normalizeCount(source.totalInstallations),
    dayUtc: /^\d{4}-\d{2}-\d{2}$/.test(String(source.dayUtc || ''))
      ? String(source.dayUtc)
      : '',
    onlineWindowSeconds: normalizeCount(source.onlineWindowSeconds),
    generatedAt: String(source.generatedAt || ''),
  };
}

function createAnonymousUsageClient(options = {}) {
  const endpoint = normalizeTelemetryEndpoint(options.endpoint);
  const fetchImpl = options.fetchImpl || global.fetch;
  const getInstallationId = options.getInstallationId || (() => '');
  const onState = options.onState || (() => {});
  const heartbeatIntervalMs = Number(options.heartbeatIntervalMs) > 0
    ? Number(options.heartbeatIntervalMs)
    : DEFAULT_HEARTBEAT_INTERVAL_MS;
  const requestTimeoutMs = Number(options.requestTimeoutMs) > 0
    ? Number(options.requestTimeoutMs)
    : DEFAULT_REQUEST_TIMEOUT_MS;

  let enabled = false;
  let generation = 0;
  let timer = null;
  let inFlight = null;
  const requestControllers = new Set();
  let currentState = {
    configured: !!endpoint,
    enabled: false,
    status: endpoint ? 'idle' : 'unconfigured',
    stats: null,
  };

  function snapshot() {
    return {
      ...currentState,
      stats: currentState.stats ? { ...currentState.stats } : null,
    };
  }

  function publish(patch = {}, expectedGeneration) {
    if (expectedGeneration !== undefined && expectedGeneration !== generation) {
      return snapshot();
    }
    currentState = {
      ...currentState,
      ...patch,
      configured: !!endpoint,
      enabled,
    };
    onState(snapshot());
    return snapshot();
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function nextInterval() {
    const jitter = Math.round(heartbeatIntervalMs * 0.08 * Math.random());
    return heartbeatIntervalMs + jitter;
  }

  function schedule(delayMs, expectedGeneration = generation) {
    clearTimer();
    if (!enabled || !endpoint || expectedGeneration !== generation) return;
    timer = setTimeout(async () => {
      if (!enabled || expectedGeneration !== generation) return;
      timer = null;
      await heartbeat(expectedGeneration);
      if (enabled && expectedGeneration === generation) {
        schedule(nextInterval(), expectedGeneration);
      }
    }, Math.max(0, Number(delayMs) || 0));
    if (typeof timer.unref === 'function') timer.unref();
  }

  async function request(pathname, init) {
    const requestController = new AbortController();
    requestControllers.add(requestController);
    const timeout = setTimeout(() => requestController.abort(), requestTimeoutMs);
    if (typeof timeout.unref === 'function') timeout.unref();
    try {
      const response = await fetchImpl(`${endpoint}${pathname}`, {
        ...init,
        redirect: 'error',
        cache: 'no-store',
        signal: requestController.signal,
        headers: {
          Accept: 'application/json',
          ...(init && init.headers ? init.headers : {}),
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return normalizeStats(await response.json());
    } finally {
      clearTimeout(timeout);
      requestControllers.delete(requestController);
    }
  }

  function heartbeat(expectedGeneration = generation) {
    if (
      !enabled ||
      expectedGeneration !== generation ||
      !endpoint ||
      typeof fetchImpl !== 'function'
    ) {
      return Promise.resolve(snapshot());
    }
    if (inFlight && inFlight.generation === expectedGeneration) return inFlight.promise;
    const installationHash = hashInstallationId(getInstallationId());
    if (!installationHash) {
      return Promise.resolve(publish({ status: 'unavailable' }, expectedGeneration));
    }

    publish({ status: 'connecting' }, expectedGeneration);
    let task;
    task = request('/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationHash }),
    })
      .then((stats) => publish({ status: 'ready', stats }, expectedGeneration))
      .catch(() => {
        if (!enabled || expectedGeneration !== generation) return snapshot();
        return publish({ status: 'unavailable' }, expectedGeneration);
      })
      .finally(() => {
        if (inFlight && inFlight.promise === task) inFlight = null;
      });
    inFlight = { generation: expectedGeneration, promise: task };
    return task;
  }

  function refresh(expectedGeneration = generation) {
    if (
      !enabled ||
      expectedGeneration !== generation ||
      !endpoint ||
      typeof fetchImpl !== 'function'
    ) {
      return Promise.resolve(snapshot());
    }
    if (inFlight && inFlight.generation === expectedGeneration) return inFlight.promise;
    publish({ status: 'connecting' }, expectedGeneration);
    let task;
    task = request('/v1/stats', { method: 'GET' })
      .then((stats) => publish({ status: 'ready', stats }, expectedGeneration))
      .catch(() => {
        if (!enabled || expectedGeneration !== generation) return snapshot();
        return publish({ status: 'unavailable' }, expectedGeneration);
      })
      .finally(() => {
        if (inFlight && inFlight.promise === task) inFlight = null;
      });
    inFlight = { generation: expectedGeneration, promise: task };
    return task;
  }

  function start(initialDelayMs = 0) {
    if (enabled) return snapshot();
    generation += 1;
    enabled = true;
    publish({ status: endpoint ? 'idle' : 'unconfigured' });
    schedule(initialDelayMs, generation);
    return snapshot();
  }

  function stop() {
    if (!enabled && !timer && !inFlight) return snapshot();
    generation += 1;
    enabled = false;
    clearTimer();
    for (const controller of requestControllers) controller.abort();
    requestControllers.clear();
    inFlight = null;
    publish({ status: endpoint ? 'idle' : 'unconfigured' });
    return snapshot();
  }

  return {
    getState: snapshot,
    heartbeat,
    refresh,
    start,
    stop,
  };
}

module.exports = {
  createAnonymousUsageClient,
  createInstallationId,
  hashInstallationId,
  isValidInstallationId,
  normalizeStats,
  normalizeTelemetryEndpoint,
};
