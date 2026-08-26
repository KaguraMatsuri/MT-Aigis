const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildGameNewsDiskCache,
  GAME_NEWS_LIST_URL,
  latestGameNewsItems,
  normalizeGameNewsDiskCache,
  parseGameNewsDetail,
  parseGameNewsList,
  pruneGameNewsDetailCache,
  trustedGameNewsUrl,
} = require('../lib/game-news');

const fixture = `
  <ul>
    <li>
      <a href="/notification/detail/id/11478">
        <source srcset="/assets/images/common/pc_whats_mainte.png">
        <h2 class="text-title">メンテナンスのお知らせ</h2>
        <span class="created">2026-08-26</span>
      </a>
    </li>
    <li>
      <a href="/notification/detail/id/11477">
        <img src="/assets/images/common/sp_whats_defect.png">
        <h2 class="text-title">既知不具合 &amp; 修正</h2>
        <span class="created">2026-08-25</span>
      </a>
    </li>
  </ul>
`;

test('parses official Aigis notice rows into a bounded public model', () => {
  assert.equal(GAME_NEWS_LIST_URL, 'https://aigis1000.jp/notification/list?page=1');
  assert.deepEqual(parseGameNewsList(fixture), [
    {
      id: '11478',
      category: 'mainte',
      title: 'メンテナンスのお知らせ',
      date: '2026-08-26',
      url: 'https://aigis1000.jp/notification/detail/id/11478',
    },
    {
      id: '11477',
      category: 'defect',
      title: '既知不具合 & 修正',
      date: '2026-08-25',
      url: 'https://aigis1000.jp/notification/detail/id/11477',
    },
  ]);
  assert.equal(parseGameNewsList(fixture, 1).length, 1);
});

test('only accepts exact official detail links', () => {
  assert.equal(
    trustedGameNewsUrl('/notification/detail/id/11478'),
    'https://aigis1000.jp/notification/detail/id/11478'
  );
  assert.equal(trustedGameNewsUrl('https://evil.example/notification/detail/id/11478'), '');
  assert.equal(trustedGameNewsUrl('https://aigis1000.jp/notification/detail/id/11478?next=evil'), '');
});

test('extracts a safe plain-text detail for the in-app dialog', () => {
  const detailHtml = `
    <div class="common-red-container">
      <p class="title-open">2026-08-26 15:00:00</p>
      <h2 class="title-2">メンテナンスのお知らせ</h2>
      <div class="body">
        <p><img src="https://example.test/banner.png"></p>
        <p>いつもありがとうございます。<br>11:00 ～ 15:00<br><br>よろしくお願いします。</p>
      </div>
    </div>
    <div class="to-list"></div>
  `;
  assert.deepEqual(
    parseGameNewsDetail(detailHtml, '/notification/detail/id/11478'),
    {
      title: 'メンテナンスのお知らせ',
      date: '2026-08-26',
      body: 'いつもありがとうございます。\n11:00 ～ 15:00\n\nよろしくお願いします。',
      url: 'https://aigis1000.jp/notification/detail/id/11478',
    }
  );
  assert.equal(parseGameNewsDetail(detailHtml, 'https://evil.example/notification/detail/id/11478'), null);
});

test('keeps the latest three notices regardless of their dates', () => {
  const items = [
    { title: 'first', date: '2026-08-26', url: 'https://aigis1000.jp/notification/detail/id/3' },
    { title: 'second', date: '2026-08-20', url: 'https://aigis1000.jp/notification/detail/id/2' },
    { title: 'third', date: '2026-07-01', url: 'https://aigis1000.jp/notification/detail/id/1' },
    { title: 'fourth', date: '2026-06-01', url: 'https://aigis1000.jp/notification/detail/id/0' },
  ];
  assert.deepEqual(latestGameNewsItems(items), items.slice(0, 3));
});

test('prunes detail cache entries older than the latest three notices', () => {
  const items = [
    { url: 'https://aigis1000.jp/notification/detail/id/3' },
    { url: 'https://aigis1000.jp/notification/detail/id/2' },
    { url: 'https://aigis1000.jp/notification/detail/id/1' },
    { url: 'https://aigis1000.jp/notification/detail/id/0' },
  ];
  const cache = new Map(items.map((item) => [item.url, item.url]));
  const retainedUrls = pruneGameNewsDetailCache(cache, items);
  assert.deepEqual([...cache.keys()], items.slice(0, 3).map((item) => item.url));
  assert.deepEqual([...retainedUrls], items.slice(0, 3).map((item) => item.url));
});

test('round-trips only three validated notices through the disk cache', () => {
  const items = [3, 2, 1, 0].map((id) => ({
    id: String(id),
    category: 'important',
    title: `notice ${id}`,
    date: '2026-08-26',
    url: `https://aigis1000.jp/notification/detail/id/${id}`,
  }));
  const details = new Map(items.map((item) => [item.url, {
    title: item.title,
    date: item.date,
    body: `body ${item.id}`,
    url: item.url,
  }]));
  const fetchedAt = Date.parse('2026-08-26T08:00:00Z');
  const payload = buildGameNewsDiskCache(items, fetchedAt, details);
  assert.equal(payload.items.length, 3);
  assert.equal(payload.details.length, 3);
  assert.deepEqual(
    normalizeGameNewsDiskCache(payload, fetchedAt + 1000),
    { fetchedAt, items: items.slice(0, 3), details: [...details.values()].slice(0, 3) }
  );

  payload.items[0].url = 'https://evil.example/notification/detail/id/3';
  const sanitized = normalizeGameNewsDiskCache(payload, fetchedAt + 1000);
  assert.equal(sanitized.items.length, 2);
  assert.equal(sanitized.details.length, 2);
  assert.equal(normalizeGameNewsDiskCache(payload, fetchedAt - 10 * 60 * 1000), null);
});

test('shows game news on the game page and keeps network diagnostics in settings', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'ui', 'sidebar.js'), 'utf8');
  const gamePage = html.match(/<section id="page-game"[\s\S]*?<section id="page-vault"/)[0];
  const settingsPage = html.match(/<section id="page-settings"[\s\S]*?<\/main>/)[0];
  assert.match(gamePage, /id="game-news-list"/);
  assert.doesNotMatch(gamePage, /id="btn-ping-all"/);
  assert.match(settingsPage, /id="btn-ping-all"/);
  assert.match(html, /<dialog id="game-news-dialog"/);
  assert.match(html, /id="game-view-snapshot"/);
  assert.match(html, /id="btn-news-open"/);
  assert.match(renderer, /api\.invoke\('game-news:list'/);
  assert.match(renderer, /api\.invoke\('game-news:detail', requestedUrl\)/);
  assert.match(renderer, /api\.invoke\('game-news:snapshot'\)/);
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(main, /function hasVisibleSnapshotContent\(image\)/);
  assert.match(main, /visiblePixels \/ sampledPixels >= 0\.02/);
  assert.match(main, /if \(!hasVisibleSnapshotContent\(image\)\)/);
  assert.match(renderer, /button\.addEventListener\('mouseenter', warmGameViewSnapshot\)/);
  assert.match(renderer, /if \(gameViewSnapshotCache\)/);
  assert.match(renderer, /warmGameViewSnapshot\(true\)/);
  assert.match(renderer, /gameViewSnapshotCache\.ready = preloadGameViewSnapshot/);
  assert.match(renderer, /preload\.decode\(\)/);
  assert.match(renderer, /image\.decode\(\)/);
  assert.match(renderer, /requestAnimationFrame\(function \(\) \{\s*requestAnimationFrame/);
  assert.match(renderer, /api\.invoke\('game-news:dialog-state', 'open'\)/);
  assert.match(renderer, /api\.invoke\('game-news:dialog-state', 'close'\)/);
  assert.match(renderer, /api\.invoke\('game-news:open', currentGameNewsUrl\)/);
});
