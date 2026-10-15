const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVICE = 'com.matsuri.mt-aigis';
const ACCOUNT = 'config-master-key';
const FORMAT_VERSION = 2;

function encryptEnvelope(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    version: FORMAT_VERSION,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: body.toString('base64'),
  };
}

function decryptEnvelope(envelope, key) {
  if (
    !envelope ||
    envelope.version !== FORMAT_VERSION ||
    envelope.algorithm !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported encrypted config format.');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.iv, 'base64'),
    { authTagLength: 16 }
  );
  decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.data, 'base64')),
    decipher.final(),
  ]);
}

function defaultConfig() {
  return {
    proxy: {
      enabled: false,
      scheme: 'http',
      host: '',
      port: '8080',
    },
    view: {
      zoomFactor: 1,
      sidebarCollapsed: false,
      scrollLevel: 5,
      language: 'auto',
      customUrl: '',
      alwaysOnTop: false,
      audioVolume: 100,
    },
    session: {
      cookies: [],
    },
    clicker: {
      enabled: true,
      cps: 10,
      keyCode: 'KeyB',
      acknowledged: false,
    },
    telemetry: {
      consent: null,
      installationId: '',
    },
  };
}

class SecureConfigStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.filePath = path.join(baseDir, 'config.enc');
    this.fallbackKeyPath = path.join(baseDir, 'master.key');
    this.masterKey = null;
    this.loadError = null;
    this.status = {
      backend: 'uninitialized',
      healthy: true,
      error: '',
    };
    fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(baseDir, 0o700); } catch {}
  }

  load() {
    if (!fs.existsSync(this.filePath)) return defaultConfig();
    try {
      const encrypted = fs.readFileSync(this.filePath);
      const isEnvelope = encrypted[0] === 0x7b;
      const plain = isEnvelope
        ? this.decryptEnvelope(JSON.parse(encrypted.toString('utf8')))
        : this.decryptLegacy(encrypted);
      const config = {
        ...defaultConfig(),
        ...JSON.parse(plain.toString('utf8')),
      };
      this.loadError = null;
      this.status.healthy = true;
      if (!isEnvelope) this.save(config);
      this.status.error = '';
      return config;
    } catch (error) {
      this.loadError = error;
      this.status.healthy = false;
      this.status.error = error && error.message ? error.message : String(error);
      return defaultConfig();
    }
  }

  save(config) {
    // A fallback UI configuration must never replace data that failed to load.
    if (!this.status.healthy) throw this.loadError;
    const payload = Buffer.from(JSON.stringify(config), 'utf8');
    const envelope = this.encryptEnvelope(payload);
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(envelope), { mode: 0o600 });
    fs.renameSync(tempPath, this.filePath);
    try { fs.chmodSync(this.filePath, 0o600); } catch {}
    this.status.healthy = true;
    this.status.error = '';
    return true;
  }

  getStatus() {
    return { ...this.status };
  }

  encryptEnvelope(plain) {
    return encryptEnvelope(plain, this.getOrCreateKey());
  }

  decryptEnvelope(envelope) {
    if (
      !envelope ||
      envelope.version !== FORMAT_VERSION ||
      envelope.algorithm !== 'aes-256-gcm'
    ) {
      throw new Error('Unsupported encrypted config format.');
    }
    const key = this.getOrCreateKey();
    try {
      return decryptEnvelope(envelope, key);
    } catch (error) {
      this.masterKey = null;
      throw error;
    }
  }

  decryptLegacy(cipherText) {
    if (cipherText.length < 29) throw new Error('Encrypted config is truncated.');
    const key = this.getOrCreateKey();
    const iv = cipherText.subarray(0, 12);
    const tag = cipherText.subarray(12, 28);
    const body = cipherText.subarray(28);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(body), decipher.final()]);
    } catch (error) {
      this.masterKey = null;
      throw error;
    }
  }

  getOrCreateKey() {
    if (this.masterKey) return this.masterKey;
    if (process.platform === 'darwin') {
      let lookupError;
      try {
        const keychainKey = this.readKeychainKey();
        this.status.backend = 'macOS Keychain';
        this.masterKey = keychainKey;
        return this.masterKey;
      } catch (error) {
        lookupError = error;
      }

      const existingConfig = fs.existsSync(this.filePath);
      const existingFallback = fs.existsSync(this.fallbackKeyPath);
      if (existingConfig && !existingFallback) throw lookupError;

      // Only a missing item (security exit 44) permits first-time creation.
      // Never upsert a key after denied access, or for existing encrypted data.
      if (!existingConfig && !existingFallback && lookupError.status === 44) {
        const newKey = crypto.randomBytes(32);
        try {
          execFileSync('security', [
            'add-generic-password',
            '-a', ACCOUNT,
            '-s', SERVICE,
            '-w', newKey.toString('base64'),
          ], { stdio: ['ignore', 'ignore', 'pipe'] });
          const verified = this.readKeychainKey();
          this.status.backend = 'macOS Keychain';
          this.masterKey = verified;
          return this.masterKey;
        } catch (error) {
          this.status.error = `Keychain unavailable: ${error.message}`;
        }
      } else {
        this.status.error = `Keychain unavailable: ${lookupError.message}`;
      }
    }

    this.status.backend = 'protected local key';
    this.masterKey = this.getOrCreateFallbackKey();
    return this.masterKey;
  }

  readKeychainKey() {
    const encoded = execFileSync('security', [
      'find-generic-password',
      '-a', ACCOUNT,
      '-s', SERVICE,
      '-w',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32) throw new Error('Keychain did not return the saved key.');
    return key;
  }

  getOrCreateFallbackKey() {
    if (fs.existsSync(this.fallbackKeyPath)) {
      const key = fs.readFileSync(this.fallbackKeyPath);
      if (key.length !== 32) throw new Error('Local master key is invalid.');
      try { fs.chmodSync(this.fallbackKeyPath, 0o600); } catch {}
      return key;
    }
    if (fs.existsSync(this.filePath)) throw new Error('Local master key is invalid.');
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.fallbackKeyPath, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
}

module.exports = {
  SecureConfigStore,
  decryptEnvelope,
  defaultConfig,
  encryptEnvelope,
};
