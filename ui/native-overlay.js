(function () {
  'use strict';

  var api = window.mtAigisOverlay;
  var dialog = document.getElementById('native-overlay-dialog');
  var currentUrl = '';
  var currentKind = '';
  if (!api || !dialog) return;

  function closeOverlay() {
    if (dialog.open) dialog.close();
    currentUrl = '';
    if (currentKind === 'app-update') api.respondUpdate('later');
    else api.close();
    currentKind = '';
  }

  api.onState(function (state) {
    if (!state || ['game-news', 'app-update'].indexOf(state.kind) < 0) return;
    currentKind = state.kind;
    document.documentElement.lang = state.language === 'zh' ? 'zh-CN' : state.language || 'en';
    document.querySelector('.update-dialog-mark').textContent = state.kind === 'app-update' ? '↑' : 'i';
    document.getElementById('native-overlay-kicker').textContent = state.kicker || '';
    document.getElementById('native-overlay-title').textContent = state.title || 'MT-Aigis';
    document.getElementById('native-overlay-date').textContent = state.date || '';
    document.getElementById('native-overlay-body').textContent = state.body || '';
    document.getElementById('native-overlay-close').textContent = state.closeLabel || 'Close';
    document.getElementById('native-overlay-open').textContent = state.visitLabel || 'Open';
    currentUrl = state.url || '';
    document.getElementById('native-overlay-open').disabled = state.kind !== 'app-update' && !currentUrl;
    if (!dialog.open) dialog.showModal();
    setTimeout(function () { document.getElementById('native-overlay-close').focus(); }, 0);
  });

  document.getElementById('native-overlay-close').addEventListener('click', closeOverlay);
  document.getElementById('native-overlay-open').addEventListener('click', function () {
    if (currentKind === 'app-update') {
      if (dialog.open) dialog.close();
      api.respondUpdate('install');
      currentKind = '';
      return;
    }
    if (currentUrl) api.openExternal(currentUrl);
  });
  dialog.addEventListener('click', function (event) {
    if (currentKind !== 'game-news') return;
    var rect = dialog.getBoundingClientRect();
    var outside = event.clientX < rect.left || event.clientX > rect.right ||
      event.clientY < rect.top || event.clientY > rect.bottom;
    if (outside) closeOverlay();
  });
  dialog.addEventListener('cancel', function (event) {
    event.preventDefault();
    closeOverlay();
  });
})();
