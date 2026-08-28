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

test('keeps the sidebar toggle independent and resizes the live game in sync', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'ui', 'sidebar.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  const gameFocus = fs.readFileSync(path.join(root, 'resources', 'game-focus.js'), 'utf8');
  const containerFocus = fs.readFileSync(path.join(root, 'resources', 'game-container-focus.js'), 'utf8');
  const togglePosition = html.indexOf('id="btn-toggle-sidebar"');
  const sidebarPosition = html.indexOf('<aside id="sidebar">');

  assert.ok(togglePosition > 0 && togglePosition < sidebarPosition);
  assert.match(html, /aria-controls="sidebar" aria-expanded="true"/);
  assert.match(html, /id="game-loading-surface" aria-hidden="true"/);
  assert.match(styles, /\.game-loading-frame \{[\s\S]*?background: #101011;/);
  assert.match(styles, /body\.sidebar-collapsed #game-loading-surface \{\s*right: var\(--sidebar-collapsed-width\);/);
  assert.match(styles, /#btn-toggle-sidebar \{[\s\S]*?position: fixed;/);
  assert.match(styles, /#sidebar\.collapsed \{[\s\S]*?border-left-color: transparent;/);
  assert.match(styles, /#sidebar\.collapsed::before \{\s*opacity: 0;/);
  assert.match(styles, /\.sidebar-content \{[\s\S]*?transition:/);
  assert.match(styles, /#btn-toggle-sidebar \{[\s\S]*?right: 7px;/);
  assert.doesNotMatch(styles, /body\.sidebar-collapsed #btn-toggle-sidebar/);
  assert.match(styles, /\.sidebar-toggle-glyph \{[\s\S]*?transform-origin: 50% 50%;[\s\S]*?transition: transform/);
  assert.match(styles, /body\.sidebar-collapsed \.sidebar-toggle-glyph \{\s*transform: rotate\(180deg\);/);
  assert.doesNotMatch(styles, /#btn-toggle-sidebar:active[\s\S]*?transform:/);
  assert.doesNotMatch(renderer, /sidebarToggleRotation/);
  assert.doesNotMatch(renderer, /toggleGlyph\.textContent/);
  assert.match(renderer, /toggleButton\.setAttribute\('aria-expanded', String\(!collapsed\)\)/);
  assert.match(renderer, /function toggleSidebar\(\) \{[\s\S]*?waitForSidebarTransition\(sidebar\)/);
  assert.doesNotMatch(renderer, /sidebar:resize-frame/);
  assert.doesNotMatch(main, /setTimeout\(step, 16\)/);
  assert.doesNotMatch(main, /ipcMain\.handle\('sidebar:resize-frame'/);
  assert.match(main, /prepareViewportTransition/);
  assert.match(gameFocus, /beginViewportTransition/);
  assert.match(gameFocus, /left \$\{duration\}ms cubic-bezier/);
  assert.match(main, /did-start-navigation[\s\S]*?gameViewLoadingMasked = isGameUrl\(url\)/);
  assert.match(main, /pathname = parsed\.pathname\.toLowerCase\(\)/);
  assert.match(main, /function markGameContentReady\(\)[\s\S]*?Promise\.all\(\[applyGamePresentation\(\), focusAllGameContainers\(\)\]\)\.finally[\s\S]*?gameViewLoadingMasked = false;[\s\S]*?syncGameViewVisibility\(\)/);
  assert.match(main, /gameView\.setVisible\(!gameViewLoadingMasked && !gameViewFallbackHidden\)/);
  assert.match(main, /host === 'osapi\.dmm\.com' \|\| host === 'osapi\.dmm\.co\.jp'/);
  assert.match(main, /focusGameContainer\(frame\)/);
  assert.match(containerFocus, /function hideOutsideGamePath\(frame\)/);
  assert.match(containerFocus, /setStyle\(document\.body, 'visibility', 'hidden'\)/);
  assert.match(containerFocus, /host === 'drc1bk94f7rq8\.cloudfront\.net'/);
  assert.match(gameFocus, /configure\(options\)/);
  assert.match(gameFocus, /observer\.disconnect\(\);[\s\S]*?observerActive = false/);
  assert.match(gameFocus, /left', `calc\(50% - \$\{GAME_WIDTH \/ 2\}px\)`/);
  assert.match(gameFocus, /reason: 'game-content-loading'/);
  assert.match(gameFocus, /transform \$\{duration\}ms cubic-bezier\(0\.4, 0, 0\.2, 1\)/);
  assert.match(gameFocus, /animateUserScale/);
  assert.match(gameFocus, /waitForFrameTransition\(\s*frame,\s*'left'/);
  assert.match(gameFocus, /waitForFrameTransition\(\s*frame,\s*'transform'[\s\S]*?true\s*\)/);
  assert.match(gameFocus, /if \(clearStyle\) setStyle\(frame, 'transition', 'none'\)/);
  assert.match(gameFocus, /cancelTransitionFrame\(frame, true\)/);
  assert.match(gameFocus, /getComputedStyle\(frame\)[\s\S]*?computed\.transform/);
  assert.match(gameFocus, /prefersReducedMotion/);
  assert.match(renderer, /prefers-reduced-motion: reduce/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.sidebar-toggle-glyph[\s\S]*?transition: none !important;/);
  assert.match(main, /applyGamePresentation\(\{ animateScale: true, duration: 180 \}\)/);
  assert.doesNotMatch(main, /dumpPageState|focusTimers/);
});

test('keeps native title-bar zoom and window resizing synchronized with the game view', () => {
  const root = path.join(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'ui', 'sidebar.css'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.match(main, /mainWindow\.on\('resize', updateLayout\)/);
  assert.match(main, /'resized',[\s\S]*?'maximize',[\s\S]*?'unmaximize'/);
  assert.match(main, /mainWindow\.on\(eventName, \(\) => updateLayout\(false\)\)/);
  assert.match(main, /layoutPresentationTimer = setTimeout\(\(\) => \{[\s\S]*?applyGamePresentation\(\)/);
  assert.match(main, /debounce === false \? 20 : 90/);
  assert.match(main, /overlayState\) applyOverlayBounds\(\)/);
  assert.match(html, /id="titlebar-double-click-zone"/);
  assert.match(styles, /#titlebar-double-click-zone \{[\s\S]*?bottom: 0;[\s\S]*?-webkit-app-region: no-drag;/);
  assert.match(renderer, /titlebar-double-click-zone'\)\.addEventListener\('dblclick'/);
  assert.match(main, /ipcMain\.handle\('window:titlebar-toggle'/);
  assert.match(main, /mainWindow\.isMaximized\(\)[\s\S]*?mainWindow\.unmaximize\(\)[\s\S]*?mainWindow\.maximize\(\)/);
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
