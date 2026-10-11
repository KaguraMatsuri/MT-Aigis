const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sidebar = fs.readFileSync(path.join(root, 'ui/sidebar.js'), 'utf8');

function section(source, start, end) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function ui(options = {}) {
  const nodes = new Map(), requests = [];
  let progressUpdates = 0;
  function node(id) {
    if (!nodes.has(id)) {
      const classes = new Set();
      if (id === 'sidebar' && options.collapsed) classes.add('collapsed');
      if (id === 'page-vault' && options.active !== false) classes.add('active');
      if (id === 'vault-edit' && !options.editing) classes.add('hidden');
      nodes.set(id, {
        textContent: '',
        classList: {
          contains(name) { return classes.has(name); },
          toggle(name, value) { if (value) classes.add(name); else classes.delete(name); },
        },
        setAttribute(name, value) { this[name] = value; },
      });
    }
    return nodes.get(id);
  }
  const context = vm.createContext({
    byId: node, document: { body: node('body') }, vaultState: null, sidebarScrolling: false,
    t(key) { return key; },
    setVaultMessage() { assert.fail('resolved vault errors must be rendered in the status'); },
    updateTotpProgress() { progressUpdates++; },
    api: {
      async invoke(channel) {
        requests.push(channel);
        return { exists: true, error: '', fields: { email: '-', password: '-', twofa: '123456' } };
      },
    },
  });
  vm.runInContext([
    section(sidebar, '  function errorText(', '  function formatBytes('),
    section(sidebar, '  function applySidebarState(', '  function waitForSidebarTransition('),
    section(sidebar, '  function renderVault(', '  function setVaultEditing('),
  ].join('\n'), context);
  return { context, node, requests, get progressUpdates() { return progressUpdates; } };
}

test('renders a failed plaintext migration as a read failure while preserving the original credentials', () => {
  const original = '{"email":"fixture@example.test","password":"fixture-password","twofa":""}';
  const fakeFs = {
    mkdirSync() {}, chmodSync() {}, existsSync() { return true; },
    readFileSync() { return original; },
    writeFileSync() { throw new Error('fixture EACCES'); },
  };
  const moduleContext = vm.createContext({
    Buffer, module: { exports: {} },
    require(name) {
      if (name === 'fs') return fakeFs;
      if (name === './secure-config') return require('../lib/secure-config');
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/plain-vault.js'), 'utf8'), moduleContext);
  const { PlainVault, emptyVault } = moduleContext.module.exports;
  const model = vm.createContext({
    vault: new PlainVault('/virtual/vault.json'), emptyVault,
    existingLegacyCredentialFiles() { return []; },
    maskSecret() { assert.fail('failed migration must not expose a password'); },
    currentTotp() { return '-'; },
  });
  const main = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
  vm.runInContext(section(main, 'function vaultViewModel(', 'function decodeBase32('), model);
  const state = model.vaultViewModel();
  const h = ui();
  h.context.renderVault(state);
  assert.equal(h.node('vault-status-title').textContent, 'readFailed');
  assert.equal(h.node('vault-status-copy').textContent, 'fixture EACCES');
  assert.equal(h.node('secret-password').textContent, '-');
  assert.equal(fakeFs.readFileSync(), original);
  h.context.renderVault({ ...state, error: '' });
  assert.equal(h.node('vault-status-title').textContent, 'vaultSaved');
  assert.equal(h.node('vault-status-copy').textContent, 'vaultCopy');
});

test('refreshes the visible vault immediately on expand and does not duplicate the native state notification', async () => {
  const h = ui({ collapsed: true });
  h.context.applySidebarState(false, false);
  assert.deepEqual(h.requests, ['vault:status']);
  await new Promise(setImmediate);
  assert.equal(h.node('secret-twofa').textContent, '123456');
  assert.equal(h.progressUpdates, 1);
  h.context.applySidebarState(false, false);
  assert.equal(h.requests.length, 1);
});

test('does not refresh the vault on collapse, initial state, another tab, or while editing', () => {
  for (const options of [
    { collapsed: false },
    { collapsed: true, active: false },
    { collapsed: true, editing: true },
  ]) {
    const h = ui(options);
    h.context.applySidebarState(false, false);
    assert.equal(h.requests.length, 0);
  }
  const h = ui();
  h.context.applySidebarState(true, false);
  assert.equal(h.requests.length, 0);
});
