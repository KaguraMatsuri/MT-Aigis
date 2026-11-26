const { isIP } = require('node:net');

function getGameProxyConfig(proxy) {
  if (proxy?.enabled === undefined || proxy.enabled === false) return { mode: 'system' };
  const { scheme } = proxy;
  const host = typeof proxy.host === 'string' ? proxy.host.trim() : '';
  const port = typeof proxy.port === 'number' || typeof proxy.port === 'string'
    ? String(proxy.port).trim() : '';
  const address = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const ipv6 = !address.includes('%') && isIP(address) === 6;
  const labels = host.replace(/\.$/, '').split('.');
  const hostname = host.length <= 254 && labels.every(label =>
    /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)
  );
  if (proxy.enabled !== true || !['http', 'https', 'socks5'].includes(scheme) || (!ipv6 && !hostname) ||
    !/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw Object.assign(new Error('ERR_INVALID_GAME_PROXY'), { code: 'ERR_INVALID_GAME_PROXY' });
  }
  return {
    mode: 'fixed_servers',
    proxyRules: `${scheme}://${ipv6 ? `[${address}]` : host}:${Number(port)}`,
    proxyBypassRules: '<-loopback>',
  };
}

module.exports = { getGameProxyConfig };
