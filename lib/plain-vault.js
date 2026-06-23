const fs = require('fs');
const path = require('path');

const FIELDS = ['email', 'password', 'twofa'];

function emptyVault() {
  return {
    email: '',
    password: '',
    twofa: '',
  };
}

function normalizeVault(payload) {
  const clean = emptyVault();
  for (const field of FIELDS) {
    clean[field] = String(payload && payload[field] || '');
  }
  clean.email = clean.email.trim();
  clean.twofa = clean.twofa.trim();
  return clean;
}

class PlainVault {
  constructor(filePath) {
    this.filePath = filePath;
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  status() {
    if (!this.exists()) return { exists: false, updatedAt: '', error: '' };
    try {
      const stats = fs.statSync(this.filePath);
      this.load();
      return {
        exists: true,
        updatedAt: stats.mtime.toISOString(),
        error: '',
      };
    } catch (error) {
      return {
        exists: true,
        updatedAt: '',
        error: error && error.message ? error.message : String(error),
      };
    }
  }

  load() {
    if (!this.exists()) return emptyVault();
    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    return normalizeVault({
      email: parsed.email,
      password: parsed.password,
      twofa: parsed.twofa || parsed.twoFactorCode,
    });
  }

  save(payload) {
    const clean = normalizeVault(payload);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(clean, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
    return this.status();
  }
}

module.exports = {
  PlainVault,
  emptyVault,
};
