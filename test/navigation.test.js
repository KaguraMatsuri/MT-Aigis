const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_URL,
  isAdaptedPage,
  isWebUrl,
  normalizeCustomUrl,
} = require('../lib/navigation');
const { defaultConfig } = require('../lib/secure-config');

test('normalizes user-entered web addresses and treats empty input as reset', () => {
  assert.equal(normalizeCustomUrl(''), '');
  assert.equal(normalizeCustomUrl('example.com/path'), 'https://example.com/path');
  assert.equal(normalizeCustomUrl('http://example.com/'), 'http://example.com/');
  assert.equal(normalizeCustomUrl('file:///tmp/example'), null);
  assert.equal(normalizeCustomUrl('not a link'), null);
  assert.equal(isWebUrl('https://example.com'), true);
  assert.equal(isWebUrl(''), false);
  assert.equal(DEFAULT_URL, 'https://play.games.dmm.com/game/aigisc');
});

test('limits page adaptation to the supported launch pages', () => {
  assert.equal(isAdaptedPage('https://play.games.dmm.com/game/aigisc'), true);
  assert.equal(isAdaptedPage('https://play.games.dmm.com/game/aigis'), true);
  assert.equal(isAdaptedPage('https://play.games.dmm.co.jp/game/aigis/'), true);
  assert.equal(isAdaptedPage('https://example.com/game/aigis'), false);
  assert.equal(isAdaptedPage('https://play.games.dmm.com/'), false);
});

test('places the compact editable address control in the top bar', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const header = html.match(/<header id="chrome-bar">[\s\S]*?<\/header>/)[0];

  assert.match(header, /id="custom-url"/);
  assert.match(header, /id="btn-custom-url"/);
  assert.match(renderer, /browser:custom-url:set/);
  assert.match(renderer, /input\.readOnly = !customUrlEditing/);
  assert.match(main, /currentConfig\.view\.customUrl = customUrl/);
  assert.match(main, /const targetUrl = getHomeUrl\(\)/);
});

test('keeps the saved address outside app updates and clears the whole browsing session', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

  assert.equal(defaultConfig().view.customUrl, '');
  assert.match(main, /new SecureConfigStore\(path\.join\(USER_DATA, 'secure'\)\)/);
  assert.match(main, /customUrl: normalizeCustomUrl\(source\.view && source\.view\.customUrl\) \|\| ''/);
  assert.match(main, /await session\.clearCache\(\)/);
  assert.match(main, /storages: \['serviceworkers', 'cachestorage', 'shadercache'\]/);
  assert.match(main, /await session\.clearStorageData\(\{ storages: \['cookies'\] \}\)/);
  assert.doesNotMatch(main, /clearStorageData\(\{\s*origin:/);
});
