const AUTOFILL_HOSTS = new Set(['accounts.dmm.com', 'accounts.dmm.co.jp']);
const AUTOFILL_KINDS = new Set(['login', 'totp']);

function isTrustedAutofillUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.protocol === 'https:' &&
      AUTOFILL_HOSTS.has(parsed.hostname.toLowerCase()) &&
      (parsed.pathname === '/service/login' || parsed.pathname.startsWith('/service/login/'))
    );
  } catch {
    return false;
  }
}

function getAutofillSuggestion(vault) {
  const data = vault || {};
  return {
    available: !!(data.email || data.password || data.twofa),
    label: String(data.email || ''),
    fields: {
      username: !!data.email,
      password: !!data.password,
      totp: !!data.twofa,
    },
  };
}

function getAutofillValues(vault, kind, totpFactory) {
  if (!AUTOFILL_KINDS.has(kind)) throw new Error('Unknown autofill field.');
  const data = vault || {};
  if (kind === 'login') {
    return {
      username: String(data.email || ''),
      password: String(data.password || ''),
    };
  }
  return { totp: String(totpFactory(data.twofa) || '') };
}

module.exports = {
  AUTOFILL_HOSTS,
  getAutofillSuggestion,
  getAutofillValues,
  isTrustedAutofillUrl,
};
