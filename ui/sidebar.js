(function () {
  'use strict';

  var api = window.mtAigis;
  if (!api) return;

  var vaultState = null;
  var clipboardClearTimer = null;
  var cookieConfirmTimer = null;
  var currentLanguage = 'zh';
  var scrollLabels = {
    zh: ['极缓', '缓慢', '标准', '灵敏', '快速'],
    en: ['Very slow', 'Slow', 'Normal', 'Responsive', 'Fast'],
    ja: ['極遅', '遅い', '標準', '敏感', '高速'],
  };
  var i18n = {
    zh: {
      tabGame: '游戏',
      tabVault: '密码库',
      tabSettings: '设置',
      clientTitle: '千年战争 Aigis',
      back: 'Back',
      reload: 'Reload',
      next: 'Next',
      networkKicker: '网络',
      cacheKicker: '缓存',
      vaultKicker: '本地密码',
      settingsKicker: '偏好设置',
      updateKicker: '更新',
      aboutKicker: '关于',
      scrollResponse: '滚轮响应',
      network: '连接状态',
      testConnection: '连接测试',
      exitIp: '出口 IP',
      gameCache: '游戏缓存',
      refresh: '刷新',
      diskCache: '磁盘缓存',
      clearGameCache: '清除游戏缓存',
      clearCookies: '清除 Cookies',
      vaultTitle: '密码库',
      edit: '编辑',
      email: '邮箱',
      password: '密码',
      settingsTitle: '设置',
      language: '语言',
      languageHelp: '默认跟随系统语言。',
      langAuto: '自动',
      updates: '更新',
      checkNow: '检查',
      version: '版本',
      author: '作者',
      contact: '联系方式',
      gameName: '千年战争Aigis macOS Client',
      qqServer: '腾讯 QQ 群',
      muted: '恢复声音',
      unmuted: '静音游戏',
      ready: '准备就绪',
      copied: '已复制',
      cacheClearing: '清除中...',
      clearAgain: '再次点击确认退出登录',
      cookiesCleared: 'Cookies 已清除',
      cacheClearedButton: '已清除',
      scrollSaved: '滚轮响应已调整',
      languageSaved: '语言已保存',
      starting: '正在启动',
      loading: '加载中',
      gameSession: '游戏会话',
      error: '错误',
      expandSidebar: '展开侧栏',
      collapseSidebar: '折叠侧栏',
      zoomOut: '缩小',
      zoomIn: '放大',
      detectingRegion: '检测地区中',
      detecting: '检测中',
      calculating: '计算中',
      unavailable: '不可用',
      unknownRegion: '地区未知',
      dmmIpWarning: 'DMM 通常要求日本出口 IP，请切换节点后 Reload。',
      networkRefreshed: '网络信息已刷新',
      networkFailed: '检测失败',
      pingFailed: '失败',
      readFailed: '读取失败',
      vaultMissing: '密码库未创建',
      vaultSaved: '密码库已保存',
      vaultCreate: '点击编辑开始保存。',
      vaultCopy: '点击隐藏内容即可复制。',
      editing: '正在编辑',
      emailLogin: '邮箱 / Login ID',
      twofaSecret: '2FA / TOTP Secret',
      cancel: '取消',
      save: '保存',
      legacyTitle: '检测到旧版密码',
      legacyCopy: '可以导入当前资料。',
      legacyImport: '导入旧版密码',
      clearFailed: '清除失败',
      saved: '已保存',
      imported: '已导入',
      loadFailed: '加载失败',
    },
    en: {
      tabGame: 'Game',
      tabVault: 'Vault',
      tabSettings: 'Settings',
      clientTitle: '千年戦争アイギス',
      back: 'Back',
      reload: 'Reload',
      next: 'Next',
      networkKicker: 'Network',
      cacheKicker: 'Cache',
      vaultKicker: 'Local Passwords',
      settingsKicker: 'Preferences',
      updateKicker: 'Update',
      aboutKicker: 'About',
      scrollResponse: 'Wheel',
      network: 'Network',
      testConnection: 'Test',
      exitIp: 'Exit IP',
      gameCache: 'Game Cache',
      refresh: 'Refresh',
      diskCache: 'Disk Cache',
      clearGameCache: 'Clear Game Cache',
      clearCookies: 'Clear Cookies',
      vaultTitle: 'Vault',
      edit: 'Edit',
      email: 'Email',
      password: 'Password',
      settingsTitle: 'Settings',
      language: 'Language',
      languageHelp: 'Follows system language by default.',
      langAuto: 'Auto',
      updates: 'Updates',
      checkNow: 'Check',
      version: 'Version',
      author: 'Author',
      contact: 'Contact',
      gameName: '千年戦争アイギス macOS Client',
      qqServer: 'Tencent QQ Server',
      muted: 'Unmute',
      unmuted: 'Mute Game',
      ready: 'Ready',
      copied: 'Copied',
      cacheClearing: 'Clearing...',
      clearAgain: 'Click again to sign out',
      cookiesCleared: 'Cookies cleared',
      cacheClearedButton: 'Cleared',
      scrollSaved: 'Wheel response saved',
      languageSaved: 'Language saved',
      starting: 'Starting',
      loading: 'Loading',
      gameSession: 'Game Session',
      error: 'Error',
      expandSidebar: 'Expand Sidebar',
      collapseSidebar: 'Collapse Sidebar',
      zoomOut: 'Zoom Out',
      zoomIn: 'Zoom In',
      detectingRegion: 'Checking region',
      detecting: 'Checking',
      calculating: 'Calculating',
      unavailable: 'Unavailable',
      unknownRegion: 'Region unknown',
      dmmIpWarning: 'DMM usually requires a Japan exit IP. Switch node, then Reload.',
      networkRefreshed: 'Network info refreshed',
      networkFailed: 'Check failed',
      pingFailed: 'Failed',
      readFailed: 'Read failed',
      vaultMissing: 'Vault not created',
      vaultSaved: 'Vault saved',
      vaultCreate: 'Click Edit to save.',
      vaultCopy: 'Click a hidden value to copy.',
      editing: 'Editing',
      emailLogin: 'Email / Login ID',
      twofaSecret: '2FA / TOTP Secret',
      cancel: 'Cancel',
      save: 'Save',
      legacyTitle: 'Legacy vault found',
      legacyCopy: 'Import it into the current profile.',
      legacyImport: 'Import Legacy Vault',
      clearFailed: 'Clear failed',
      saved: 'Saved',
      imported: 'Imported',
      loadFailed: 'Load failed',
    },
    ja: {
      tabGame: 'ゲーム',
      tabVault: 'パスワード',
      tabSettings: '設定',
      clientTitle: '千年戦争アイギス',
      back: 'Back',
      reload: 'Reload',
      next: 'Next',
      networkKicker: 'ネットワーク',
      cacheKicker: 'キャッシュ',
      vaultKicker: 'ローカルパスワード',
      settingsKicker: '設定',
      updateKicker: 'アップデート',
      aboutKicker: '情報',
      scrollResponse: 'ホイール',
      network: '接続状態',
      testConnection: 'テスト',
      exitIp: '出口 IP',
      gameCache: 'ゲームキャッシュ',
      refresh: '更新',
      diskCache: 'ディスクキャッシュ',
      clearGameCache: 'ゲームキャッシュを消去',
      clearCookies: 'Cookies を消去',
      vaultTitle: 'パスワード',
      edit: '編集',
      email: 'メール',
      password: 'パスワード',
      settingsTitle: '設定',
      language: '言語',
      languageHelp: '既定ではシステム言語に従います。',
      langAuto: '自動',
      updates: '更新',
      checkNow: '確認',
      version: 'バージョン',
      author: '作者',
      contact: '連絡先',
      gameName: '千年戦争アイギス macOS Client',
      qqServer: 'Tencent QQ Server',
      muted: '音声を戻す',
      unmuted: 'ゲームをミュート',
      ready: '準備完了',
      copied: 'コピーしました',
      cacheClearing: '消去中...',
      clearAgain: '再クリックでログアウト',
      cookiesCleared: 'Cookies を消去しました',
      cacheClearedButton: '消去済み',
      scrollSaved: 'ホイール応答を保存しました',
      languageSaved: '言語を保存しました',
      starting: '起動中',
      loading: '読み込み中',
      gameSession: 'ゲームセッション',
      error: 'エラー',
      expandSidebar: 'サイドバーを表示',
      collapseSidebar: 'サイドバーを隠す',
      zoomOut: '縮小',
      zoomIn: '拡大',
      detectingRegion: '地域を確認中',
      detecting: '確認中',
      calculating: '計算中',
      unavailable: '利用不可',
      unknownRegion: '地域不明',
      dmmIpWarning: 'DMM は通常、日本の出口 IP が必要です。ノードを切り替えて Reload してください。',
      networkRefreshed: 'ネットワーク情報を更新しました',
      networkFailed: '確認失敗',
      pingFailed: '失敗',
      readFailed: '読み取り失敗',
      vaultMissing: 'パスワード未作成',
      vaultSaved: 'パスワード保存済み',
      vaultCreate: '編集を押して保存します。',
      vaultCopy: '非表示の項目をクリックしてコピーします。',
      editing: '編集中',
      emailLogin: 'メール / Login ID',
      twofaSecret: '2FA / TOTP Secret',
      cancel: 'キャンセル',
      save: '保存',
      legacyTitle: '旧形式のパスワードを検出',
      legacyCopy: '現在のプロファイルへ取り込めます。',
      legacyImport: '旧形式を取り込む',
      clearFailed: '消去失敗',
      saved: '保存しました',
      imported: '取り込みました',
      loadFailed: '読み込み失敗',
    },
  };

  var pingFields = {
    proton: byId('ping-proton'),
    google: byId('ping-google'),
    dmm: byId('ping-dmm'),
    bilibili: byId('ping-bilibili'),
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function t(key) {
    return (i18n[currentLanguage] && i18n[currentLanguage][key]) || i18n.zh[key] || key;
  }

  function errorText(error) {
    return error && error.message ? error.message : String(error);
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(1) + ' MB';
  }

  function setRuntime(message, isError) {
    var element = byId('runtime-message');
    element.textContent = message || '';
    element.classList.toggle('error', !!isError);
  }

  function setSettingsMessage(message, isError) {
    var element = byId('settings-message');
    element.textContent = message || '';
    element.classList.toggle('error', !!isError);
  }

  function setVaultMessage(message, isError) {
    var element = byId('vault-message');
    element.textContent = message || '';
    element.classList.toggle('error', !!isError);
  }

  function applyLanguage(language) {
    currentLanguage = ['zh', 'en', 'ja'].indexOf(language) >= 0 ? language : 'zh';
    document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : currentLanguage;
    document.querySelectorAll('[data-i18n]').forEach(function (element) {
      element.textContent = t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (element) {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });
    byId('qq-label').textContent = t('qqServer');
    byId('runtime-message').textContent = byId('runtime-message').textContent || t('ready');
    syncMuteState(byId('btn-mute').classList.contains('muted'));
    updateScrollControl(byId('scroll-level').value || 5);
  }

  function showPage(name) {
    document.querySelectorAll('.tab').forEach(function (button) {
      button.classList.toggle('active', button.dataset.page === name);
    });
    document.querySelectorAll('.page').forEach(function (page) {
      page.classList.toggle('active', page.id === 'page-' + name);
    });
  }

  function applySidebarState(collapsed, notifyMain) {
    var sidebar = byId('sidebar');
    sidebar.classList.toggle('collapsed', collapsed);
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    byId('btn-toggle-sidebar').textContent = collapsed ? '›' : '‹';
    byId('btn-toggle-sidebar').title = collapsed ? t('expandSidebar') : t('collapseSidebar');
    byId('btn-toggle-sidebar').setAttribute('aria-label', collapsed ? t('expandSidebar') : t('collapseSidebar'));
    if (notifyMain) api.invoke('sidebar:toggle', collapsed ? 'collapse' : 'expand');
  }

  function syncMuteState(isMuted) {
    byId('btn-mute').classList.toggle('muted', isMuted);
    byId('btn-mute').title = isMuted ? t('muted') : t('unmuted');
    byId('btn-mute').setAttribute('aria-label', isMuted ? t('muted') : t('unmuted'));
    byId('mute-label').textContent = isMuted ? t('muted') : t('unmuted');
  }

  function refreshBrowserState() {
    return api.invoke('browser:state').then(function (browser) {
      byId('page-title').textContent = browser.title || 'MT-Aigis';
      byId('page-url').textContent = browser.url || 'https://play.games.dmm.com/game/aigisc';
      byId('top-status').textContent = browser.loading ? t('loading') : t('gameSession');
      byId('zoom-value').textContent = Math.round((browser.zoomFactor || 1) * 100) + '%';
      syncMuteState(!!browser.audioMuted);
      updateScrollControl(browser.scrollLevel || 5);
      if (!browser.loading) {
        byId('btn-reload').classList.remove('loading');
        byId('btn-reload').disabled = false;
      }
    }).catch(function (error) {
      byId('top-status').textContent = t('error');
      setRuntime(errorText(error), true);
    });
  }

  function refreshNetworkStatus(showMessage) {
    return api.invoke('network:status').then(function (network) {
      byId('network-ip').textContent = network.ip || network.error || t('unavailable');
      byId('network-region').textContent =
        [network.countryCode, network.city, network.provider].filter(Boolean).join(' · ') || t('unknownRegion');
      var warning = byId('network-warning');
      warning.classList.toggle('hidden', network.countryCode === 'JP' || !network.countryCode);
      warning.textContent = network.countryCode === 'JP' || !network.countryCode
        ? ''
        : t('dmmIpWarning');
      if (showMessage) setRuntime(t('networkRefreshed'), false);
    }).catch(function (error) {
      byId('network-ip').textContent = t('networkFailed');
      if (showMessage) setRuntime(errorText(error), true);
    });
  }

  function runPing(target) {
    var field = pingFields[target];
    field.textContent = '...';
    field.className = 'ping-value testing';
    api.invoke('network:ping', target).then(function (result) {
      field.textContent = result.ok ? result.ms + ' ms' : t('pingFailed');
      field.title = result.error || '';
      field.className = 'ping-value ' + (result.ok ? 'ok' : 'failed');
    }).catch(function (error) {
      field.textContent = t('pingFailed');
      field.title = errorText(error);
      field.className = 'ping-value failed';
    });
  }

  function updateScrollControl(level) {
    var normalized = Math.min(5, Math.max(1, Number(level) || 5));
    byId('scroll-level').value = String(normalized);
    byId('scroll-level-label').textContent = scrollLabels[currentLanguage][normalized - 1];
  }

  function renderCache(stats) {
    stats = stats || {};
    byId('cache-disk').textContent = formatBytes(stats.diskBytes || stats.httpBytes || 0);
  }

  function refreshCache(force) {
    return api.invoke('cache:stats', !!force).then(renderCache).catch(function () {
      byId('cache-disk').textContent = t('readFailed');
    });
  }

  function updateTotpProgress() {
    var remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
    byId('totp-progress').style.width = Math.round((remaining / 30) * 100) + '%';
  }

  function renderVault(state) {
    vaultState = state;
    byId('legacy-warning').classList.toggle('hidden', !state.hasLegacyData || state.exists);
    byId('secret-email').textContent = state.fields.email;
    byId('secret-password').textContent = state.fields.password;
    byId('secret-twofa').textContent = state.fields.twofa;
    byId('vault-status-title').textContent = !state.exists ? t('vaultMissing') : t('vaultSaved');
    byId('vault-status-copy').textContent = !state.exists ? t('vaultCreate') : t('vaultCopy');
    updateTotpProgress();
  }

  function refreshVault() {
    return api.invoke('vault:status').then(renderVault).catch(function (error) {
      setVaultMessage(errorText(error), true);
    });
  }

  function setVaultEditing(enabled) {
    byId('vault-view').classList.toggle('hidden', enabled);
    byId('vault-edit').classList.toggle('hidden', !enabled);
    byId('btn-vault-edit').textContent = enabled ? t('editing') : t('edit');
    byId('btn-vault-edit').disabled = enabled;
  }

  function loadVaultEditor() {
    api.invoke('vault:edit-data').then(function (data) {
      byId('vault-email').value = data.email || '';
      byId('vault-password').value = data.password || '';
      byId('vault-twofa').value = data.twofa || '';
      setVaultEditing(true);
    }).catch(function (error) {
      setVaultMessage(errorText(error), true);
    });
  }

  function copyVaultField(field) {
    if (!vaultState || !vaultState.exists) return loadVaultEditor();
    api.invoke('vault:copy', field).then(function () {
      setVaultMessage(t('copied'), false);
      if (field === 'password') {
        if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
        clipboardClearTimer = setTimeout(function () {
          api.invoke('clipboard:write', '');
          clipboardClearTimer = null;
        }, 60000);
      }
      setTimeout(function () { setVaultMessage('', false); }, 1200);
    }).catch(function (error) {
      setVaultMessage(errorText(error), true);
    });
  }

  function updateUpdateState(state) {
    byId('update-state').textContent = state && state.message ? state.message : t('ready');
  }

  document.querySelectorAll('.tab').forEach(function (button) {
    button.addEventListener('click', function () { showPage(button.dataset.page); });
  });
  document.querySelectorAll('.secret-row').forEach(function (button) {
    button.addEventListener('click', function () { copyVaultField(button.dataset.field); });
  });
  document.querySelectorAll('.copy-line').forEach(function (button) {
    button.addEventListener('click', function () {
      api.invoke('copy:text', button.dataset.copy).then(function () {
        setSettingsMessage(t('copied'), false);
        setTimeout(function () { setSettingsMessage('', false); }, 1200);
      });
    });
  });

  byId('btn-toggle-sidebar').addEventListener('click', function () {
    applySidebarState(!byId('sidebar').classList.contains('collapsed'), true);
  });
  byId('btn-back').addEventListener('click', function () { api.invoke('browser:navigate', 'back'); });
  byId('btn-forward').addEventListener('click', function () { api.invoke('browser:navigate', 'forward'); });
  byId('btn-reload').addEventListener('click', function () {
    api.invoke('browser:navigate', 'reload');
    byId('btn-reload').classList.add('loading');
    byId('btn-reload').disabled = true;
  });
  byId('scroll-level').addEventListener('input', function () {
    updateScrollControl(this.value);
  });
  byId('scroll-level').addEventListener('change', function () {
    api.invoke('scroll:set-level', Number(this.value)).then(function (result) {
      updateScrollControl(result.level);
      setRuntime(t('scrollSaved'), false);
    });
  });
  byId('language-select').addEventListener('change', function () {
    api.invoke('language:set', this.value).then(function (view) {
      applyLanguage(view.effectiveLanguage);
      setSettingsMessage(t('languageSaved'), false);
    });
  });
  byId('btn-check-update').addEventListener('click', function () {
    api.invoke('update:check').then(updateUpdateState);
  });
  byId('btn-zoom-out').addEventListener('click', function () { api.invoke('browser:navigate', 'zoom-out').then(refreshBrowserState); });
  byId('btn-zoom-reset').addEventListener('click', function () { api.invoke('browser:navigate', 'zoom-reset').then(refreshBrowserState); });
  byId('btn-zoom-in').addEventListener('click', function () { api.invoke('browser:navigate', 'zoom-in').then(refreshBrowserState); });
  byId('btn-mute').addEventListener('click', function () { api.invoke('browser:navigate', 'mute-toggle').then(refreshBrowserState); });
  byId('btn-ping-all').addEventListener('click', function () {
    Object.keys(pingFields).forEach(runPing);
    refreshNetworkStatus(false);
  });
  byId('btn-refresh-cache').addEventListener('click', function () { refreshCache(true); });
  byId('btn-clear-cache').addEventListener('click', function () {
    var button = this;
    button.disabled = true;
    button.textContent = t('cacheClearing');
    api.invoke('cache:clear-cache').then(function (result) {
      if (!result.ok) throw new Error(result.error || t('clearFailed'));
      renderCache(result.stats);
      button.textContent = t('cacheClearedButton');
      setTimeout(function () { button.textContent = t('clearGameCache'); }, 1200);
    }).catch(function (error) {
      setRuntime(errorText(error), true);
    }).finally(function () {
      setTimeout(function () { button.disabled = false; }, 1200);
    });
  });
  byId('btn-clear-cookies').addEventListener('click', function () {
    var button = this;
    if (!button.classList.contains('confirming')) {
      button.classList.add('confirming');
      button.textContent = t('clearAgain');
      cookieConfirmTimer = setTimeout(function () {
        button.classList.remove('confirming');
        button.textContent = t('clearCookies');
      }, 3500);
      return;
    }
    clearTimeout(cookieConfirmTimer);
    button.disabled = true;
    api.invoke('cache:clear-cookies').then(function (ok) {
      button.textContent = ok ? t('cookiesCleared') : t('pingFailed');
    }).finally(function () {
      button.classList.remove('confirming');
      setTimeout(function () {
        button.disabled = false;
        button.textContent = t('clearCookies');
      }, 1400);
    });
  });

  byId('btn-vault-edit').addEventListener('click', loadVaultEditor);
  byId('btn-cancel-vault').addEventListener('click', function () { setVaultEditing(false); });
  byId('vault-edit').addEventListener('submit', function (event) {
    event.preventDefault();
    var payload = {
      email: byId('vault-email').value.trim(),
      password: byId('vault-password').value,
      twofa: byId('vault-twofa').value.trim(),
    };
    api.invoke('vault:save', payload).then(function (state) {
      renderVault(state);
      setVaultEditing(false);
      setVaultMessage(t('saved'), false);
    }).catch(function (error) {
      setVaultMessage(errorText(error), true);
    });
  });
  byId('btn-migrate-vault').addEventListener('click', function () {
    api.invoke('vault:migrate-plaintext').then(function (state) {
      renderVault(state);
      setVaultMessage(t('imported'), false);
    }).catch(function (error) {
      setVaultMessage(errorText(error), true);
    });
  });

  api.on('browser:title', function (title) { byId('page-title').textContent = title || 'MT-Aigis'; });
  api.on('browser:error', function (message) { setRuntime(message || t('loadFailed'), true); });
  api.on('sidebar:state', function (state) { applySidebarState(!!state.collapsed, false); });
  api.on('update:state', updateUpdateState);

  api.invoke('config:get').then(function (config) {
    applySidebarState(!!(config.view && config.view.sidebarCollapsed), false);
    updateScrollControl(config.view && config.view.scrollLevel || 5);
    byId('language-select').value = config.view && config.view.language || 'auto';
    applyLanguage(config.view && config.view.effectiveLanguage || 'zh');
    if (config.app) {
      byId('about-version').textContent = config.app.version;
      byId('about-author').textContent = config.app.author;
    }
  });
  api.invoke('update:state').then(updateUpdateState);
  refreshVault();
  refreshBrowserState();
  refreshNetworkStatus(false);
  refreshCache(true);
  setTimeout(function () { Object.keys(pingFields).forEach(runPing); }, 700);
  setInterval(refreshBrowserState, 2000);
  setInterval(function () { refreshCache(false); }, 15000);
  setInterval(function () {
    updateTotpProgress();
    if (
      byId('page-vault').classList.contains('active') &&
      byId('vault-edit').classList.contains('hidden')
    ) refreshVault();
  }, 1000);
})();
