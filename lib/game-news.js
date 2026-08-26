const GAME_NEWS_ORIGIN = 'https://aigis1000.jp';
const GAME_NEWS_LIST_URL = `${GAME_NEWS_ORIGIN}/notification/list?page=1`;
const DETAIL_PATH_PATTERN = /^\/notification\/detail\/id\/(\d+)$/;
const KNOWN_CATEGORIES = new Set(['update', 'mainte', 'defect', 'campaign', 'important']);

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return String(value || '').replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] || match;
    const hexadecimal = entity.slice(0, 2).toLowerCase() === '#x';
    const codePoint = Number.parseInt(entity.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return '';
    return String.fromCodePoint(codePoint);
  });
}

function cleanText(value) {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  ).replace(/\s+/g, ' ').trim();
}

function cleanBodyText(value) {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<img\b[^>]*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:div|h[1-6]|li|p|section)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
  )
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 12000);
}

function trustedGameNewsUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl, GAME_NEWS_ORIGIN);
    return (
      parsed.protocol === 'https:' &&
      parsed.hostname.toLowerCase() === 'aigis1000.jp' &&
      DETAIL_PATH_PATTERN.test(parsed.pathname) &&
      !parsed.search &&
      !parsed.hash
    ) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

function parseGameNewsList(source, limit = 10) {
  const items = [];
  const itemPattern = /<li>\s*<a\s+href=["'](\/notification\/detail\/id\/(\d+))["'][^>]*>([\s\S]*?)<\/a>\s*<\/li>/gi;
  for (const match of String(source || '').matchAll(itemPattern)) {
    const body = match[3];
    const titleMatch = body.match(/<h2[^>]*class=["'][^"']*\btext-title\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
    const dateMatch = body.match(/<span[^>]*class=["'][^"']*\bcreated\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const categoryMatch = body.match(/(?:pc|sp)_whats_([a-z_]+)\.png/i);
    const title = titleMatch ? cleanText(titleMatch[1]) : '';
    const date = dateMatch ? cleanText(dateMatch[1]) : '';
    const url = trustedGameNewsUrl(match[1]);
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !url) continue;
    const rawCategory = categoryMatch ? categoryMatch[1].toLowerCase() : '';
    items.push({
      id: match[2],
      category: KNOWN_CATEGORIES.has(rawCategory) ? rawCategory : 'important',
      title,
      date,
      url,
    });
    if (items.length >= Math.max(1, Number(limit) || 10)) break;
  }
  return items;
}

function latestGameNewsItems(items, limit = 3) {
  const count = Math.min(20, Math.max(1, Number(limit) || 3));
  return (Array.isArray(items) ? items : []).slice(0, count);
}

function pruneGameNewsDetailCache(cache, items, limit = 3) {
  const retainedItems = latestGameNewsItems(items, limit);
  const retainedUrls = new Set(retainedItems.map((item) => item.url).filter(Boolean));
  for (const url of cache.keys()) {
    if (!retainedUrls.has(url)) cache.delete(url);
  }
  return retainedUrls;
}

function normalizeCachedItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = /^\d+$/.test(String(item.id || '')) ? String(item.id) : '';
  const url = trustedGameNewsUrl(item.url);
  const title = typeof item.title === 'string' ? item.title.trim().slice(0, 500) : '';
  const date = typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item.date)
    ? item.date
    : '';
  const category = KNOWN_CATEGORIES.has(item.category) ? item.category : '';
  if (!id || !url || !title || !date || !category || !url.endsWith(`/id/${id}`)) return null;
  return { id, category, title, date, url };
}

function normalizeCachedDetail(detail, allowedUrls) {
  if (!detail || typeof detail !== 'object') return null;
  const url = trustedGameNewsUrl(detail.url);
  const title = typeof detail.title === 'string' ? detail.title.trim().slice(0, 500) : '';
  const date = typeof detail.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(detail.date)
    ? detail.date
    : '';
  const body = typeof detail.body === 'string' ? detail.body.trim().slice(0, 12000) : '';
  if (!url || !allowedUrls.has(url) || !title || !date || !body) return null;
  return { title, date, body, url };
}

function normalizeGameNewsDiskCache(payload, now = Date.now(), limit = 3) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.items)) return null;
  const fetchedAt = Number(payload.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt <= 0 || fetchedAt > now + 5 * 60 * 1000) return null;
  const items = latestGameNewsItems(payload.items.map(normalizeCachedItem).filter(Boolean), limit);
  if (!items.length) return null;
  const allowedUrls = new Set(items.map((item) => item.url));
  const details = (Array.isArray(payload.details) ? payload.details : [])
    .map((detail) => normalizeCachedDetail(detail, allowedUrls))
    .filter(Boolean);
  return { fetchedAt, items, details };
}

function buildGameNewsDiskCache(items, fetchedAt, detailCache, limit = 3) {
  const retainedItems = latestGameNewsItems(items, limit).map(normalizeCachedItem).filter(Boolean);
  const retainedUrls = new Set(retainedItems.map((item) => item.url));
  const details = retainedItems
    .map((item) => detailCache.get(item.url))
    .filter(Boolean)
    .map((detail) => normalizeCachedDetail(detail, retainedUrls))
    .filter(Boolean);
  return { version: 1, fetchedAt, items: retainedItems, details };
}

function parseGameNewsDetail(source, rawUrl) {
  const url = trustedGameNewsUrl(rawUrl);
  if (!url) return null;
  const html = String(source || '');
  const titleMatch = html.match(/<h2[^>]*class=["'][^"']*\btitle-2\b[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i);
  const dateMatch = html.match(/<p[^>]*class=["'][^"']*\btitle-open\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
  const bodyMatch = html.match(/<div[^>]*class=["'][^"']*\bbody\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<div[^>]*class=["'][^"']*\bto-list\b/i);
  const title = titleMatch ? cleanText(titleMatch[1]) : '';
  const dateText = dateMatch ? cleanText(dateMatch[1]) : '';
  const body = bodyMatch ? cleanBodyText(bodyMatch[1]) : '';
  if (!title || !body) return null;
  return {
    title,
    date: /^\d{4}-\d{2}-\d{2}/.test(dateText) ? dateText.slice(0, 10) : '',
    body,
    url,
  };
}

module.exports = {
  buildGameNewsDiskCache,
  GAME_NEWS_LIST_URL,
  latestGameNewsItems,
  normalizeGameNewsDiskCache,
  parseGameNewsDetail,
  parseGameNewsList,
  pruneGameNewsDetailCache,
  trustedGameNewsUrl,
};
