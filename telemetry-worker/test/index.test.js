import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const INSTALLATION_HASH = 'a'.repeat(64);
const FIXED_NOW = Date.parse('2026-08-27T12:34:56.789Z');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function createD1Mock(batchResults = []) {
  const prepared = [];
  const batchCalls = [];
  const runCalls = [];

  const DB = {
    prepare(sql) {
      const statement = {
        sql: normalizeSql(sql),
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async run() {
          runCalls.push(this);
          return { success: true };
        },
      };
      prepared.push(statement);
      return statement;
    },

    async batch(statements) {
      batchCalls.push(statements);
      return batchResults[batchCalls.length - 1] ?? [];
    },
  };

  return { DB, prepared, batchCalls, runCalls };
}

async function withFixedNow(callback) {
  const originalNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    return await callback();
  } finally {
    Date.now = originalNow;
  }
}

function statsBatchResults(totalInstallations = 120, dailyActive = 32, onlineNow = 7) {
  return [
    { results: [{ value: totalInstallations }] },
    { results: [{ value: dailyActive }] },
    { results: [{ value: onlineNow }] },
  ];
}

test('returns 404 JSON for routes outside the public API', async () => {
  const db = createD1Mock();
  const response = await worker.fetch(
    new Request('https://telemetry.example/v1/unknown'),
    { DB: db.DB },
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Not found.' });
  assert.equal(db.prepared.length, 0);
  assert.equal(db.batchCalls.length, 0);
});

test('rejects unsupported methods and advertises the allowed method', async () => {
  const heartbeatDb = createD1Mock();
  const heartbeatResponse = await worker.fetch(
    new Request('https://telemetry.example/v1/heartbeat'),
    { DB: heartbeatDb.DB },
  );
  assert.equal(heartbeatResponse.status, 405);
  assert.equal(heartbeatResponse.headers.get('allow'), 'POST');
  assert.deepEqual(await heartbeatResponse.json(), { error: 'Method not allowed.' });

  const statsDb = createD1Mock();
  const statsResponse = await worker.fetch(
    new Request('https://telemetry.example/v1/stats', { method: 'POST' }),
    { DB: statsDb.DB },
  );
  assert.equal(statsResponse.status, 405);
  assert.equal(statsResponse.headers.get('allow'), 'GET');
  assert.deepEqual(await statsResponse.json(), { error: 'Method not allowed.' });

  assert.equal(heartbeatDb.prepared.length, 0);
  assert.equal(statsDb.prepared.length, 0);
});

test('rejects an invalid installation hash before touching D1', async () => {
  const db = createD1Mock();
  const response = await worker.fetch(
    new Request('https://telemetry.example/v1/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installationHash: 'A'.repeat(64) }),
    }),
    { DB: db.DB },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'installationHash must be a 64-character lowercase hexadecimal SHA-256 hash.',
  });
  assert.equal(db.prepared.length, 0);
  assert.equal(db.batchCalls.length, 0);
});

test('records a valid heartbeat atomically, then returns current statistics', async () => {
  const db = createD1Mock([[], statsBatchResults()]);

  await withFixedNow(async () => {
    const response = await worker.fetch(
      new Request('https://telemetry.example/v1/heartbeat', {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ installationHash: INSTALLATION_HASH }),
      }),
      { DB: db.DB },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      totalInstallations: 120,
      dailyActive: 32,
      onlineNow: 7,
      dayUtc: '2026-08-27',
      heartbeatIntervalSeconds: 300,
      onlineWindowSeconds: 720,
      generatedAt: '2026-08-27T12:34:56.789Z',
    });
  });

  assert.equal(db.batchCalls.length, 2);
  assert.equal(db.batchCalls[0].length, 2);
  assert.match(db.batchCalls[0][0].sql, /^INSERT INTO installations /);
  assert.deepEqual(db.batchCalls[0][0].bindings, [
    INSTALLATION_HASH,
    Math.floor(FIXED_NOW / 1000),
  ]);
  assert.match(db.batchCalls[0][1].sql, /^INSERT OR IGNORE INTO daily_active /);
  assert.deepEqual(db.batchCalls[0][1].bindings, ['2026-08-27', INSTALLATION_HASH]);

  assert.equal(db.batchCalls[1].length, 3);
  assert.match(db.batchCalls[1][0].sql, /FROM counters/);
  assert.deepEqual(db.batchCalls[1][0].bindings, []);
  assert.match(db.batchCalls[1][1].sql, /FROM daily_counts/);
  assert.deepEqual(db.batchCalls[1][1].bindings, ['2026-08-27']);
  assert.match(db.batchCalls[1][2].sql, /FROM installations/);
  assert.deepEqual(db.batchCalls[1][2].bindings, [Math.floor(FIXED_NOW / 1000) - 720]);
});

test('GET /v1/stats exposes the documented aggregate fields', async () => {
  const db = createD1Mock([statsBatchResults(8, 5, 3)]);

  await withFixedNow(async () => {
    const response = await worker.fetch(
      new Request('https://telemetry.example/v1/stats'),
      { DB: db.DB },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      totalInstallations: 8,
      dailyActive: 5,
      onlineNow: 3,
      dayUtc: '2026-08-27',
      heartbeatIntervalSeconds: 300,
      onlineWindowSeconds: 720,
      generatedAt: '2026-08-27T12:34:56.789Z',
    });
  });

  assert.equal(db.batchCalls.length, 1);
  assert.equal(db.batchCalls[0].length, 3);
});

test('scheduled cleanup deletes expired daily identifiers through waitUntil', async () => {
  const db = createD1Mock();
  const pending = [];
  const context = {
    waitUntil(promise) {
      pending.push(promise);
    },
  };

  await withFixedNow(async () => {
    worker.scheduled({}, { DB: db.DB }, context);
    assert.equal(pending.length, 1);
    await pending[0];
  });

  assert.equal(db.prepared.length, 1);
  assert.match(db.prepared[0].sql, /^DELETE FROM daily_active /);
  assert.deepEqual(db.prepared[0].bindings, ['2026-08-27']);
  assert.deepEqual(db.runCalls, [db.prepared[0]]);
});
