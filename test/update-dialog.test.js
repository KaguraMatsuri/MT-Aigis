const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('uses the browser dialog for update content and download choice', () => {
  const html = fs.readFileSync(path.join(root, 'ui', 'index.html'), 'utf8');
  const renderer = fs.readFileSync(path.join(root, 'ui', 'sidebar.js'), 'utf8');
  const styles = fs.readFileSync(path.join(root, 'ui', 'sidebar.css'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  assert.match(html, /<dialog id="update-dialog"/);
  assert.match(html, /id="btn-update-download"/);
  assert.match(renderer, /dialog\.showModal\(\)/);
  assert.match(renderer, /api\.invoke\('update:respond', action\)/);
  assert.match(main, /mainWindow\.removeBrowserView\(gameView\)/);
  assert.doesNotMatch(main, /dialog\.showMessageBox|dialog\.showErrorBox/);
  const backdropRule = styles.match(/\.update-dialog::backdrop\s*\{([\s\S]*?)\}/)[1];
  assert.match(backdropRule, /background:\s*rgba\(/);
  assert.doesNotMatch(backdropRule, /backdrop-filter/);
});
