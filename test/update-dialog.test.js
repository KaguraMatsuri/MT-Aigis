const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('uses the browser dialog for update content and download choice', () => {
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');
  const overlayRenderer = fs.readFileSync(path.join(root, 'ui', 'native-overlay.js'), 'utf8');
  const overlayPreload = fs.readFileSync(path.join(root, 'resources', 'native-overlay-preload.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'ui', 'sidebar.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.match(html, /<dialog id="update-dialog"/);
  assert.match(html, /id="btn-update-download"/);
  assert.match(renderer, /dialog\.showModal\(\)/);
  assert.match(renderer, /api\.invoke\('update:respond', action\)/);
  assert.match(main, /kind: 'app-update'/);
  assert.match(main, /showOverlay\(\{/);
  assert.doesNotMatch(main, /removeChildView\(gameView\)/);
  assert.match(main, /backgroundThrottling: false/);
  assert.match(overlayRenderer, /api\.respondUpdate\('install'\)/);
  assert.match(overlayRenderer, /api\.respondUpdate\('later'\)/);
  assert.match(overlayPreload, /native-overlay:update-respond/);
  assert.doesNotMatch(main, /dialog\.showMessageBox|dialog\.showErrorBox/);
  const backdropRule = styles.match(/\.update-dialog::backdrop\s*\{([\s\S]*?)\}/)[1];
  assert.match(backdropRule, /background:\s*rgba\(/);
  assert.doesNotMatch(backdropRule, /backdrop-filter/);
});
