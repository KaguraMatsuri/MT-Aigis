const ipcRenderer = typeof document === 'undefined' ? null : require('electron').ipcRenderer;

const TRUSTED_HOSTS = new Set(['accounts.dmm.com', 'accounts.dmm.co.jp']);
const GAME_LAUNCH_PAGES = new Set([
  'play.games.dmm.com/game/aigisc',
  'play.games.dmm.com/game/aigis',
  'play.games.dmm.co.jp/game/aigis',
]);
const GAME_LAUNCH_MASK_ID = 'mt-aigis-launch-mask';
let gameLaunchMaskObserver = null;
const FIELD_PATTERNS = {
  username: /(?:e-?mail|mail|login(?:[_-]?id)?|account|user(?:name)?|ログイン|メール|アカウント)/i,
  totp: /(?:otp|totp|one.?time|two.?factor|verification|auth(?:entication)?.?code|確認コード|認証コード)/i,
};

function isGameLaunchUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return GAME_LAUNCH_PAGES.has(`${parsed.hostname.toLowerCase()}${pathname}`);
  } catch {
    return false;
  }
}

function installGameLaunchMask() {
  if (window.top !== window || !isGameLaunchUrl(location.href)) return false;
  if (!document.documentElement) {
    if (!gameLaunchMaskObserver) {
      gameLaunchMaskObserver = new MutationObserver(() => {
        if (!document.documentElement) return;
        gameLaunchMaskObserver.disconnect();
        gameLaunchMaskObserver = null;
        installGameLaunchMask();
      });
      gameLaunchMaskObserver.observe(document, { childList: true });
    }
    return true;
  }
  if (document.getElementById(GAME_LAUNCH_MASK_ID)) return true;
  const style = document.createElement('style');
  style.id = GAME_LAUNCH_MASK_ID;
  style.textContent = `
    html,
    body {
      background: #101011 !important;
    }
    body,
    #game_frame {
      visibility: hidden !important;
    }
    #game_frame {
      opacity: 0 !important;
    }
  `;
  document.documentElement.appendChild(style);
  return true;
}

function isTrustedDocument() {
  return (
    location.protocol === 'https:' &&
    TRUSTED_HOSTS.has(location.hostname.toLowerCase()) &&
    (location.pathname === '/service/login' || location.pathname.startsWith('/service/login/'))
  );
}

function fieldText(input) {
  const labels = input.labels ? [...input.labels].map((label) => label.textContent || '') : [];
  return [
    input.type,
    input.name,
    input.id,
    input.placeholder,
    input.getAttribute('aria-label'),
    ...labels,
  ].filter(Boolean).join(' ');
}

function classifyField(input) {
  if (!(input instanceof HTMLInputElement)) return '';
  if (input.disabled || input.readOnly) return '';
  const type = String(input.type || 'text').toLowerCase();
  if (!['email', 'number', 'password', 'search', 'tel', 'text'].includes(type)) return '';

  const autocomplete = String(input.autocomplete || '').toLowerCase();
  const text = fieldText(input);
  if (autocomplete.includes('one-time-code') || FIELD_PATTERNS.totp.test(text)) return 'totp';
  if (type === 'password' || autocomplete.includes('current-password')) return 'password';
  if (
    type === 'email' ||
    autocomplete.includes('username') ||
    autocomplete.includes('email') ||
    FIELD_PATTERNS.username.test(text)
  ) {
    return 'username';
  }
  return '';
}

function setNativeValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  if (!descriptor || typeof descriptor.set !== 'function') return false;
  descriptor.set.call(input, value);
  const inputEvent = typeof InputEvent === 'function'
    ? new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value })
    : new Event('input', { bubbles: true });
  input.dispatchEvent(inputEvent);
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return input.value === value;
}

function isVisibleField(input) {
  if (!input || !input.isConnected || input.getClientRects().length === 0) return false;
  const style = getComputedStyle(input);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function planTotpValues(value, fieldCount, segmented) {
  const code = String(value || '');
  if (!segmented) return [code];
  return code.replace(/\D/g, '').slice(0, fieldCount).split('');
}

function languageText(kind) {
  const language = String(navigator.language || '').toLowerCase();
  const labels = language.startsWith('ja')
    ? { username: 'ログインIDとパスワードを入力', password: 'ログインIDとパスワードを入力', totp: '認証コードを入力' }
    : language.startsWith('zh')
      ? { username: '填充账号和密码', password: '填充账号和密码', totp: '填充验证码' }
      : { username: 'Fill login and password', password: 'Fill login and password', totp: 'Fill verification code' };
  return labels[kind] || labels.username;
}

function installAutofill() {
  if (!isTrustedDocument() || !document.documentElement) return;

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    button {
      position: fixed;
      display: none;
      box-sizing: border-box;
      width: 280px;
      min-height: 58px;
      padding: 9px 12px;
      border: 1px solid rgba(60, 60, 67, 0.22);
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.98);
      color: #1d1d1f;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
      cursor: pointer;
      font: 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      text-align: left;
      z-index: 2147483647;
      -webkit-font-smoothing: antialiased;
    }
    button.visible { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 10px; align-items: center; }
    button:hover, button:focus-visible { border-color: #16a8c7; background: #f6fdff; outline: none; }
    .mark {
      display: grid;
      width: 32px;
      height: 32px;
      border-radius: 9px;
      place-items: center;
      background: #16a8c7;
      color: white;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: -0.3px;
    }
    .copy { min-width: 0; }
    strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    strong { font-size: 13px; font-weight: 650; }
    small { margin-top: 2px; color: #6e6e73; font-size: 11px; }
    @media (prefers-color-scheme: dark) {
      button { border-color: rgba(255, 255, 255, 0.18); background: rgba(35, 35, 37, 0.98); color: #f5f5f7; }
      button:hover, button:focus-visible { border-color: #4bc8e1; background: #252d30; }
      small { color: #a1a1a6; }
    }
  `;
  const button = document.createElement('button');
  button.type = 'button';
  button.innerHTML = '<span class="mark">MT</span><span class="copy"><strong></strong><small></small></span>';
  shadow.append(style, button);
  document.documentElement.appendChild(host);

  let activeInput = null;
  let activeKind = '';
  let requestVersion = 0;
  let totpScanTimer = null;
  let totpRequestInFlight = false;

  function hide() {
    button.classList.remove('visible');
    host.setAttribute('aria-hidden', 'true');
    activeInput = null;
    activeKind = '';
    requestVersion += 1;
  }

  function place() {
    if (!activeInput || !button.classList.contains('visible')) return;
    const rect = activeInput.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return hide();
    const width = Math.max(220, Math.min(360, rect.width));
    const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left));
    const below = rect.bottom + 6;
    const top = below + 64 <= window.innerHeight ? below : Math.max(8, rect.top - 64);
    button.style.width = `${width}px`;
    button.style.left = `${left}px`;
    button.style.top = `${top}px`;
  }

  async function showFor(input) {
    const kind = classifyField(input);
    if (!kind) return hide();
    if (kind === 'totp') {
      hide();
      autoFillTotpFields();
      return;
    }
    const version = ++requestVersion;
    activeInput = input;
    activeKind = kind;
    try {
      const suggestion = await ipcRenderer.invoke('autofill:suggestion');
      if (version !== requestVersion || activeInput !== input || activeKind !== kind) return;
      if (!suggestion || !suggestion.available || !suggestion.fields || !suggestion.fields[kind]) {
        return hide();
      }
      button.querySelector('strong').textContent = suggestion.label || 'MT-Aigis';
      button.querySelector('small').textContent = languageText(kind);
      button.setAttribute('aria-label', languageText(kind));
      host.setAttribute('aria-hidden', 'false');
      button.classList.add('visible');
      place();
    } catch {
      hide();
    }
  }

  button.addEventListener('pointerdown', (event) => event.preventDefault());
  button.addEventListener('click', async (event) => {
    if (!event.isTrusted || !activeInput || !activeKind) return;
    const input = activeInput;
    try {
      const result = await ipcRenderer.invoke('autofill:fill', { kind: 'login' });
      if (!result || !result.ok || !result.values) return;
      input.focus();
      for (const candidate of document.querySelectorAll('input')) {
        if (!isVisibleField(candidate)) continue;
        const candidateKind = classifyField(candidate);
        if (candidateKind === 'username' && result.values.username) {
          setNativeValue(candidate, result.values.username);
        } else if (candidateKind === 'password' && result.values.password) {
          setNativeValue(candidate, result.values.password);
        }
      }
      hide();
    } catch {
      hide();
    }
  });

  async function autoFillTotpFields() {
    if (totpRequestInFlight) return;
    const fields = [...document.querySelectorAll('input')].filter((input) =>
      classifyField(input) === 'totp' && isVisibleField(input)
    );
    if (!fields.length || fields.some((input) => input.value)) return;

    const segmented = fields.length > 1 && fields.every((input) => input.maxLength === 1);
    totpRequestInFlight = true;
    try {
      const result = await ipcRenderer.invoke('autofill:fill', { kind: 'totp' });
      const value = result && result.values && result.values.totp;
      if (!result || !result.ok || typeof value !== 'string' || !value) return;
      const plannedValues = planTotpValues(value, fields.length, segmented);
      if (segmented && plannedValues.length !== fields.length) return;
      for (let index = 0; index < plannedValues.length; index += 1) {
        const input = fields[index];
        if (input && input.isConnected && !input.value) {
          setNativeValue(input, plannedValues[index]);
        }
      }
    } catch {
      // The page remains usable for manual entry if secure retrieval fails.
    } finally {
      totpRequestInFlight = false;
    }
  }

  function scanTotpFields() {
    totpScanTimer = null;
    autoFillTotpFields();
  }

  function scheduleTotpScan() {
    if (totpScanTimer) return;
    totpScanTimer = setTimeout(scanTotpFields, 50);
  }

  document.addEventListener('focusin', (event) => {
    showFor(event.target);
  }, true);
  document.addEventListener('pointerdown', (event) => {
    if (event.composedPath().includes(host)) return;
    if (event.target === activeInput) return;
    hide();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  }, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  new MutationObserver(scheduleTotpScan).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  scheduleTotpScan();
}

if (typeof document !== 'undefined') {
  installGameLaunchMask();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installAutofill, { once: true });
  } else {
    installAutofill();
  }
}

if (typeof module !== 'undefined') {
  module.exports = { isGameLaunchUrl, planTotpValues };
}
