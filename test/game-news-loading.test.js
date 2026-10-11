const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const news = require('../lib/game-news');

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

function section(start, end) {
  const first = mainSource.indexOf(start);
  const last = mainSource.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return mainSource.slice(first, last);
}

function listHtml(ids) {
  return ids.map(id => `<li><a href="/notification/detail/id/${id}"><h2 class="text-title">notice ${id}</h2><span class="created">2026-10-09</span></a></li>`).join('');
}

function detailHtml(id) {
  return `<h2 class="title-2">notice ${id}</h2><p class="title-open">2026-10-09</p><div class="body"><p>body ${id}</p></div></div><div class="to-list"></div>`;
}

function response(html) {
  return { ok: true, async text() { return html; } };
}

function harness(initialDiskCache) {
  const requests = [];
  const writes = [];
  const disk = new Map();
  let failWrites = false;
  if (initialDiskCache) disk.set('/virtual/news.json', JSON.stringify(initialDiskCache));
  const context = vm.createContext({
    ...news, path, AbortController,
    GAME_NEWS_CACHE_MS: 1800000,
    GAME_NEWS_LIMIT: 3,
    GAME_NEWS_CACHE_FILE: '/virtual/news.json',
    gameNewsCache: { items: [], fetchedAt: 0 },
    gameNewsTask: null,
    gameNewsForceDetails: false,
    gameNewsDiskCacheContent: '',
    gameNewsDetailCache: new Map(),
    gameNewsDetailTasks: new Map(),
    gameNewsDetailUrls: new Set(),
    debugLog() {},
    setTimeout() { return 1; },
    clearTimeout() {},
    fs: {
      existsSync(file) { return disk.has(file); },
      readFileSync(file) { return disk.get(file); },
      mkdirSync() {},
      writeFileSync(file, content) {
        if (failWrites) throw new Error('fixture write failure');
        writes.push(JSON.parse(content));
        disk.set(file, content);
      },
      renameSync(from, to) { disk.set(to, disk.get(from)); disk.delete(from); },
    },
    fetchThroughGameSession(url, options) {
      return new Promise((resolve, reject) => requests.push({ url, options, resolve, reject }));
    },
  });
  vm.runInContext([
    section('function loadGameNewsDiskCache(', 'function loadResource('),
    section('async function getGameNews(', 'async function pingTarget('),
  ].join('\n'), context);
  context.loadGameNewsDiskCache();
  return {
    context, requests, writes,
    failWrites(value) { failWrites = value; },
    async turn() { await new Promise(setImmediate); },
    async loadList(ids) {
      const pending = context.getGameNews(true);
      requests.at(-1).resolve(response(listHtml(ids)));
      return pending;
    },
    async finishDetails() {
      requests.filter(request => request.url !== news.GAME_NEWS_LIST_URL).forEach(request => {
        request.resolve(response(detailHtml(request.url.split('/').at(-1))));
      });
      await new Promise(setImmediate);
    },
  };
}

test('returns the latest three notices before their detail requests complete', async () => {
  const h = harness();
  const list = await h.loadList([6, 5, 4, 3]);
  assert.equal(list.items.length, 3);
  assert.equal(list.items[0].id, '6');
  assert.equal(list.error, false);
  assert.equal(h.context.gameNewsDetailCache.size, 0);
  assert.equal(h.requests.length, 4);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].details.length, 0);
  await h.finishDetails();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].details.length, 3);
});

test('shares pending list and detail requests when refreshing or opening notices', async () => {
  const h = harness();
  const first = h.context.getGameNews(true);
  const second = h.context.getGameNews(true);
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(response(listHtml([3, 2, 1])));
  const [list] = await Promise.all([first, second]);
  const opened = h.context.getGameNewsDetail(list.items[0].url);
  await h.context.getGameNews(false);
  assert.equal(h.requests.length, 4);
  await h.finishDetails();
  assert.equal((await opened).body, 'body 3');
  assert.equal(h.writes.length, 2);
});

test('does not request or write unchanged complete cache hits, including after startup', async () => {
  const original = harness();
  await original.loadList([3, 2, 1]);
  await original.finishDetails();
  const h = harness(original.writes.at(-1));
  await h.context.getGameNews(false);
  await h.context.getGameNews(false);
  await h.turn();
  assert.equal(h.requests.length, 0);
  assert.equal(h.writes.length, 0);
});

test('refreshes the same notice URLs in the background and persists their revised bodies', async () => {
  const original = harness();
  await original.loadList([3, 2, 1]);
  await original.finishDetails();
  const h = harness(original.writes.at(-1));
  const list = await h.loadList([3, 2, 1]);
  assert.equal(list.error, false);
  assert.equal(h.requests.length, 4);
  assert.equal(h.context.gameNewsDetailCache.size, 0);
  assert.equal(h.writes[0].details.length, 0);
  const opened = h.context.getGameNewsDetail(list.items[0].url);
  assert.equal(h.requests.length, 4);
  for (const request of h.requests.slice(1)) {
    const id = request.url.split('/').at(-1);
    request.resolve(response(detailHtml(id).replace(`body ${id}`, `revised body ${id}`)));
  }
  assert.equal((await opened).body, 'revised body 3');
  await h.turn();
  const restarted = harness(h.writes.at(-1));
  assert.equal((await restarted.context.getGameNewsDetail(list.items[0].url)).body, 'revised body 3');
  assert.equal(restarted.requests.length, 0);
});

test('refreshes details when forced callers join an existing automatic list request without duplicating it', async () => {
  const original = harness();
  await original.loadList([3]); await original.finishDetails();
  const cache = { ...original.writes.at(-1), fetchedAt: Date.now() - 1800001 };
  const h = harness(cache);
  const automatic = h.context.getGameNews(false);
  const forced = Array.from({ length: 10 }, () => h.context.getGameNews(true));
  assert.equal(h.requests.length, 1);
  h.requests[0].resolve(response(listHtml([3])));
  await Promise.all([automatic, ...forced]);
  assert.equal(h.requests.length, 2);
  assert.equal(h.context.gameNewsDetailCache.size, 0);
  h.requests[1].resolve(response(detailHtml(3).replace('body 3', 'revised body 3')));
  await h.turn();
  assert.equal(h.context.gameNewsDetailCache.get(cache.items[0].url).body, 'revised body 3');
  assert.equal(h.context.gameNewsForceDetails, false);
});

test('does not let a superseded failed request remove the replacement detail task', async () => {
  const h = harness(), list = await h.loadList([3]), url = list.items[0].url;
  const oldOpened = h.context.getGameNewsDetail(url);
  const rejected = assert.rejects(oldOpened, /fixture old failure/);
  await h.loadList([3]);
  const replacement = h.context.gameNewsDetailTasks.get(url);
  h.requests[1].reject(new Error('fixture old failure'));
  await rejected;
  assert.equal(h.context.gameNewsDetailTasks.get(url), replacement);
  const current = h.context.getGameNewsDetail(url);
  assert.equal(h.requests.length, 4);
  h.requests[3].resolve(response(detailHtml(3).replace('body 3', 'revised body 3')));
  assert.equal((await current).body, 'revised body 3');
});

test('keeps a superseded request from writing or deleting the replacement task for the same URL', async (t) => {
  for (const oldFirst of [true, false]) {
    await t.test(oldFirst ? 'old finishes first' : 'new finishes first', async () => {
      const h = harness();
      const list = await h.loadList([3]);
      const url = list.items[0].url, oldRequest = h.requests[1];
      const oldOpened = h.context.getGameNewsDetail(url);
      await h.loadList([3]);
      const replacement = h.context.gameNewsDetailTasks.get(url), newRequest = h.requests[3];
      const newOpened = h.context.getGameNewsDetail(url);
      assert.equal(h.requests.length, 4);
      if (oldFirst) {
        oldRequest.resolve(response(detailHtml(3)));
        assert.equal((await oldOpened).body, 'body 3');
        assert.equal(h.context.gameNewsDetailCache.has(url), false);
        assert.equal(h.context.gameNewsDetailTasks.get(url), replacement);
      }
      newRequest.resolve(response(detailHtml(3).replace('body 3', 'revised body 3')));
      assert.equal((await newOpened).body, 'revised body 3');
      await h.turn();
      const writes = h.writes.length;
      if (!oldFirst) {
        oldRequest.resolve(response(detailHtml(3)));
        assert.equal((await oldOpened).body, 'body 3');
        await h.turn();
      }
      assert.equal(h.context.gameNewsDetailCache.get(url).body, 'revised body 3');
      assert.equal(h.context.gameNewsDetailTasks.size, 0);
      assert.equal(h.writes.length, writes);
      assert.equal(h.writes.at(-1).details[0].body, 'revised body 3');
    });
  }
});

test('keeps a newer list when old background requests finish late', async () => {
  const h = harness();
  await h.loadList([3, 2, 1]);
  const oldDetails = h.requests.filter(request => request.url !== news.GAME_NEWS_LIST_URL);
  await h.loadList([6, 5, 4]);
  const writesBeforeOldDetails = h.writes.length;
  oldDetails.forEach(request => request.resolve(response(detailHtml(request.url.split('/').at(-1)))));
  await h.turn();
  assert.equal(h.writes.length, writesBeforeOldDetails);
  assert.equal(h.context.gameNewsDetailCache.size, 0);
  await h.finishDetails();
  assert.deepEqual(h.writes.at(-1).items.map(item => item.id), ['6', '5', '4']);
  assert.deepEqual(h.writes.at(-1).details.map(detail => detail.body), ['body 6', 'body 5', 'body 4']);
});

test('keeps the list usable after detail failure and retries missing details without duplicate writes', async () => {
  const h = harness();
  const list = await h.loadList([3]);
  assert.equal(list.error, false);
  h.requests[1].reject(new Error('fixture detail timeout'));
  await h.turn();
  assert.equal(h.writes.length, 1);
  const cached = await h.context.getGameNews(false);
  assert.equal(cached.items.length, 1);
  assert.equal(h.requests.length, 3);
  h.requests[2].resolve(response(detailHtml(3)));
  await h.turn();
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes.at(-1).details[0].body, 'body 3');
});

test('returns stale notices when refreshing the list fails', async () => {
  const h = harness();
  await h.loadList([3]);
  await h.finishDetails();
  const before = h.writes.length;
  const pending = h.context.getGameNews(true);
  h.requests.at(-1).reject(new Error('fixture list timeout'));
  const list = await pending;
  assert.equal(list.stale, true);
  assert.equal(list.error, true);
  assert.equal(list.items[0].id, '3');
  assert.equal(h.writes.length, before);
  assert.equal(h.context.gameNewsDetailCache.get(list.items[0].url).body, 'body 3');
});

test('retries a failed cache write instead of treating it as saved', async () => {
  const h = harness();
  h.failWrites(true);
  const list = await h.loadList([3]);
  assert.equal(list.items.length, 1);
  await h.finishDetails();
  assert.equal(h.writes.length, 0);
  h.failWrites(false);
  await h.context.getGameNews(false);
  await h.turn();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].details.length, 1);
});
