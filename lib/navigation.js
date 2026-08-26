const DEFAULT_URL = 'https://play.games.dmm.com/game/aigisc';

const ADAPTED_PAGES = new Set([
  'play.games.dmm.com/game/aigisc',
  'play.games.dmm.com/game/aigis',
  'play.games.dmm.co.jp/game/aigis',
]);

function normalizeCustomUrl(rawValue) {
  const value = String(rawValue || '').trim();
  if (!value) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isWebUrl(rawValue) {
  const normalized = normalizeCustomUrl(rawValue);
  return normalized !== null && normalized !== '';
}

function isAdaptedPage(rawValue) {
  try {
    const parsed = new URL(rawValue);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return ADAPTED_PAGES.has(`${parsed.hostname.toLowerCase()}${pathname}`);
  } catch {
    return false;
  }
}

module.exports = {
  DEFAULT_URL,
  isAdaptedPage,
  isWebUrl,
  normalizeCustomUrl,
};
