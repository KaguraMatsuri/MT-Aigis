const fs = require('fs');
const path = require('path');
const { decryptEnvelope, encryptEnvelope } = require('./secure-config');

const FIELDS = ['email', 'password', 'twofa'];
const CLIENT_KEY = Buffer.from('2d893c779b3f04276d69cb380812d6b93e1818cd40c4b2741a8def58457e3d68', 'hex');

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
  constructor(filePath, key = CLIENT_KEY) {
    this.filePath = filePath;
    this.key = key;
    const directory = path.dirname(filePath);
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.chmodSync(directory, 0o700);
  }

  exists() {
    return fs.existsSync(this.filePath);
  }

  status(includeData = false) {
    if (!this.exists()) return { exists: false, updatedAt: '', error: '' };
    try {
      const data = this.load();
      const stats = fs.statSync(this.filePath);
      return {
        exists: true,
        updatedAt: stats.mtime.toISOString(),
        error: '',
        ...(includeData ? { data } : {}),
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
    const encrypted = parsed && ['algorithm', 'iv', 'tag', 'data'].some(field =>
      Object.prototype.hasOwnProperty.call(parsed, field)
    );
    const source = encrypted
      ? JSON.parse(decryptEnvelope(parsed, this.key).toString('utf8'))
      : parsed;
    const data = normalizeVault({
      email: source.email,
      password: source.password,
      twofa: source.twofa || source.twoFactorCode,
    });
    if (!encrypted) this.write(data);
    return data;
  }

  save(payload) {
    const clean = normalizeVault(payload);
    this.write(clean);
    return this.status();
  }

  write(clean) {
    const payload = encryptEnvelope(Buffer.from(JSON.stringify(clean), 'utf8'), this.key);
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
    fs.chmodSync(this.filePath, 0o600);
  }
}

module.exports = {
  PlainVault,
  emptyVault,
};
