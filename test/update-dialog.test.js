const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

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

test('shows the approved empty-notes message in the fallback dialog without disabling download', () => {
  const source = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', open: false, disabled: false,
      showModal() { this.open = true; }, focus() {},
    });
    return nodes.get(id);
  }
  const context = vm.createContext({ byId: node, currentLanguage: 'zh', setTimeout(callback) { callback(); } });
  const dictionary = source.slice(source.indexOf('  var scrollLabels ='), source.indexOf('  var pingFields ='));
  const translate = source.slice(source.indexOf('  function t('), source.indexOf('  function errorText('));
  const prompt = source.slice(source.indexOf('  function showUpdatePrompt('), source.indexOf('  function respondToUpdatePrompt('));
  vm.runInContext(dictionary + translate + prompt, context);
  for (const notes of [undefined, '', '  \n\t']) {
    context.showUpdatePrompt({ version: '1.3.0', notes });
    assert.equal(node('update-dialog-notes').textContent, '无法显示更新内容, 可能 Github 调用额度已用完. 但更新仍然可以继续.');
    assert.equal(node('update-dialog-version').textContent, '1.3.0');
    assert.equal(node('update-dialog').open, true);
    assert.equal(node('btn-update-download').disabled, false);
  }
  context.showUpdatePrompt({ notes: '• [功能] fixture release notes.' });
  assert.equal(node('update-dialog-notes').textContent, '• [功能] fixture release notes.');
});
