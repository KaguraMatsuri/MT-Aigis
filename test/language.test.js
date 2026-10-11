const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { getAutofillSuggestion } = require('../lib/autofill');
const { trustedGameNewsUrl } = require('../lib/game-news');
const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const sidebarSource = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return source.slice(startIndex, endIndex);
}

function mainHarness(options = {}) {
  const saved = [];
  const calls = { preferred: 0, locale: 0, menu: 0, about: 0 };
  const context = vm.createContext({
    AUTHOR_NAME: 'No.zomu',
    currentConfig: { view: { language: options.language || 'auto' } },
    app: {
      getPreferredSystemLanguages() {
        calls.preferred += 1;
        return options.preferred || [];
      },
      getLocale() {
        calls.locale += 1;
        return options.locale || '';
      },
    },
    store: { save(config) { saved.push(JSON.parse(JSON.stringify(config))); } },
    configureAboutPanel() { calls.about += 1; },
    buildAppMenu() { return []; },
    Menu: { setApplicationMenu() { calls.menu += 1; } },
    getPublicConfig() {
      return { view: { ...context.currentConfig.view, effectiveLanguage: context.effectiveLanguage() } };
    },
    trustedGameNewsUrl,
  });
  vm.runInContext([
    section(mainSource, 'const APP_TEXT =', 'app.commandLine.appendSwitch'),
    section(mainSource, 'function appText(', 'function setUpdateState('),
    section(mainSource, 'function normalizeLanguage(', 'function applyOverlayBounds('),
    section(mainSource, 'function setLanguage(', 'function getScrollLevel('),
  ].join('\n'), context);
  return { context, calls, saved };
}

test('detects Chinese scripts and regions from the preferred system language', () => {
  for (const locale of ['zh-Hant', 'zh-Hant-TW', 'zh-Hant-CN', 'zh-TW', 'zh-HK', 'zh-MO', 'ZH_hant_HK']) {
    const harness = mainHarness({ preferred: [locale], locale: 'en-US' });
    assert.equal(harness.context.effectiveLanguage(), 'zh-Hant', locale);
    assert.equal(harness.calls.locale, 0);
  }
  for (const locale of ['zh', 'zh-CN', 'zh-SG', 'zh-Hans', 'zh-Hans-TW']) {
    assert.equal(mainHarness({ preferred: [locale] }).context.effectiveLanguage(), 'zh', locale);
  }
  assert.equal(mainHarness({ preferred: ['ja-JP'] }).context.effectiveLanguage(), 'ja');
  assert.equal(mainHarness({ preferred: ['en-GB'] }).context.effectiveLanguage(), 'en');
});

test('respects system preference order and falls back when language tags are unavailable', () => {
  const cases = [
    { preferred: ['en-US', 'zh-Hant'], locale: 'zh-TW', expected: 'en' },
    { preferred: ['fr-FR', 'zh-Hant', 'en-US'], expected: 'zh-Hant' },
    { preferred: ['not a locale', '', 'ja-JP'], expected: 'ja' },
    { preferred: [], locale: 'zh-TW', expected: 'zh-Hant' },
    { preferred: ['fr-FR'], locale: 'zh-CN', expected: 'zh' },
    { preferred: ['fr-FR'], locale: 'not a locale', expected: 'en' },
  ];
  for (const options of cases) {
    assert.equal(mainHarness(options).context.effectiveLanguage(), options.expected);
  }
});

test('preserves manual choices, saves Traditional Chinese, and resolves Auto without changing its stored value', () => {
  for (const language of ['zh', 'zh-Hant', 'en', 'ja']) {
    const harness = mainHarness({ language, preferred: ['zh-Hant'] });
    assert.equal(harness.context.effectiveLanguage(), language);
    assert.equal(harness.calls.preferred, 0);
  }
  const harness = mainHarness({ preferred: ['zh-TW'] });
  assert.equal(harness.context.setLanguage('zh-Hant').effectiveLanguage, 'zh-Hant');
  assert.equal(harness.saved[0].view.language, 'zh-Hant');
  assert.equal(harness.context.setLanguage('auto').effectiveLanguage, 'zh-Hant');
  assert.equal(harness.saved[1].view.language, 'auto');
  assert.equal(harness.calls.menu, 2);
  assert.equal(harness.calls.about, 2);
  assert.equal(harness.context.normalizeLanguage('unsupported'), 'auto');
});

test('provides complete Traditional Chinese dictionaries and preserves update interpolation', () => {
  const main = mainHarness({ language: 'zh-Hant' });
  const appTables = vm.runInContext('APP_TEXT', main.context);
  assert.deepEqual(Object.keys(appTables['zh-Hant']).sort(), Object.keys(appTables.zh).sort());
  assert.equal(main.context.appText('aboutMenu'), '關於 MT-Aigis');
  assert.equal(main.context.appText('updateAvailable', { version: '2.0.0' }), '發現新版本 2.0.0');
  assert.equal(main.context.appText('updateDownloadingPercent', { percent: 42 }), '正在下載 42%...');

  const sidebar = vm.createContext({});
  vm.runInContext(section(sidebarSource, '  var scrollLabels =', '  var pingFields ='), sidebar);
  assert.deepEqual(Object.keys(sidebar.i18n['zh-Hant']).sort(), Object.keys(sidebar.i18n.zh).sort());
  for (const [key, text] of Object.entries(sidebar.i18n['zh-Hant'])) {
    assert.equal(typeof text, 'string', key);
    assert.ok(text.length > 0, key);
  }
  assert.equal(sidebar.scrollLabels['zh-Hant'].length, 5);
});

test('applies Traditional Chinese to sidebar text, accessibility labels, and scroll labels', () => {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '',
      value: '3',
      classList: { contains() { return false; } },
      setAttribute(name, value) { this[name] = value; },
    });
    return nodes.get(id);
  }
  const label = { dataset: { i18n: 'tabSettings' } };
  const aria = { dataset: { i18nAria: 'customUrl' }, setAttribute(name, value) { this[name] = value; } };
  const document = {
    documentElement: {},
    querySelectorAll(selector) { return selector === '[data-i18n]' ? [label] : [aria]; },
  };
  const context = vm.createContext({
    document,
    byId: node,
    currentLanguage: 'zh',
    customUrlEditing: false,
    alwaysOnTopEnabled: false,
    gameNewsState: null,
    telemetryState: null,
    syncMuteState() {},
    applyAlwaysOnTopState() {},
  });
  vm.runInContext([
    section(sidebarSource, '  var scrollLabels =', '  var pingFields ='),
    section(sidebarSource, '  function t(', '  function errorText('),
    section(sidebarSource, '  function applyLanguage(', '  function showPage('),
    section(sidebarSource, '  function updateScrollControl(', '  function renderCache('),
  ].join('\n'), context);
  context.applyLanguage('zh-Hant');
  assert.equal(document.documentElement.lang, 'zh-Hant');
  assert.equal(label.textContent, '設定');
  assert.equal(aria['aria-label'], '連結');
  assert.equal(node('scroll-level-label').textContent, '標準');
  context.applyLanguage('en');
  assert.equal(label.textContent, 'Settings');
  context.applyLanguage('zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(label.textContent, '设置');
});

test('renders the Traditional Chinese About window using the existing query parameters', () => {
  const source = fs.readFileSync(path.join(root, 'ui', 'about.html'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  const nodes = new Map();
  const document = {
    documentElement: {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {});
      return nodes.get(id);
    },
    querySelectorAll() { return []; },
  };
  vm.runInNewContext(source, {
    URLSearchParams,
    document,
    location: { search: '?lang=zh-Hant&version=1.2.0&author=No.zomu' },
    window: {},
  });
  assert.equal(document.documentElement.lang, 'zh-Hant');
  assert.equal(document.title, '關於 MT-Aigis');
  assert.equal(nodes.get('contact-label').textContent, '聯絡方式');
  assert.equal(nodes.get('version-value').textContent, '1.2.0');
});

test('keeps Traditional Chinese through overlay state updates and rendering', () => {
  const main = mainHarness();
  const state = main.context.normalizeOverlayState({
    kind: 'app-update', language: 'zh-Hant', kicker: '下個版本', title: 'MT-Aigis', body: '繁體說明', closeLabel: '稍後', visitLabel: '下載更新',
  });
  const updated = main.context.normalizeOverlayState({ kind: 'app-update', body: '更新說明' }, state);
  assert.equal(updated.language, 'zh-Hant');
  let onState;
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, { addEventListener() {}, showModal() { this.open = true; }, focus() {} });
    return nodes.get(id);
  }
  const document = {
    documentElement: {},
    getElementById: node,
    querySelector: node,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'ui', 'native-overlay.js'), 'utf8'), {
    document,
    window: { mtAigisOverlay: { onState(listener) { onState = listener; } } },
    setTimeout() {},
  });
  onState(updated);
  assert.equal(document.documentElement.lang, 'zh-Hant');
  assert.equal(node('native-overlay-body').textContent, '更新說明');
  assert.equal(node('native-overlay-close').textContent, '稍後');
  assert.equal(node('native-overlay-open').textContent, '下載更新');
});

test('passes the effective client language through the existing autofill suggestion request', () => {
  const main = mainHarness({ preferred: ['zh-Hant'] });
  let handler;
  Object.assign(main.context, {
    ipcMain: { handle(channel, callback) { assert.equal(channel, 'autofill:suggestion'); handler = callback; } },
    assertTrustedAutofillFrame() {},
    vault: { status() { return { exists: true }; }, load() { return { email: 'test@example.com', password: 'secret', twofa: '' }; } },
    getAutofillSuggestion,
  });
  vm.runInContext(section(mainSource, "ipcMain.handle('autofill:suggestion'", "ipcMain.handle('autofill:fill'"), main.context);
  const suggestion = handler({});
  assert.equal(suggestion.language, 'zh-Hant');
  assert.equal(suggestion.available, true);
  assert.equal(suggestion.label, 'test@example.com');
  assert.equal(JSON.stringify(suggestion).includes('secret'), false);
});
