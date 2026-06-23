const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SERVICE = 'com.matsuri.mt-aigis';
const ACCOUNT = 'config-master-key';
const FORMAT_VERSION = 2;

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
    },
    session: {
      cookies: [],
    },
  };
}

class SecureConfigStore {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.filePath = path.join(baseDir, 'config.enc');
    this.fallbackKeyPath = path.join(baseDir, 'master.key');
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
      if (!isEnvelope) this.save(config);
      this.status.healthy = true;
      this.status.error = '';
      return config;
    } catch (error) {
      this.status.healthy = false;
      this.status.error = error && error.message ? error.message : String(error);
      return defaultConfig();
    }
  }

  save(config) {
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
    const key = this.getOrCreateKey();
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

  decryptEnvelope(envelope) {
    if (
      !envelope ||
      envelope.version !== FORMAT_VERSION ||
      envelope.algorithm !== 'aes-256-gcm'
    ) {
      throw new Error('Unsupported encrypted config format.');
    }
    const key = this.getOrCreateKey();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final(),
    ]);
  }

  decryptLegacy(cipherText) {
    if (cipherText.length < 29) throw new Error('Encrypted config is truncated.');
    const key = this.getOrCreateKey();
    const iv = cipherText.subarray(0, 12);
    const tag = cipherText.subarray(12, 28);
    const body = cipherText.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]);
  }

  getOrCreateKey() {
    if (process.platform === 'darwin') {
      const keychainKey = this.readKeychainKey();
      if (keychainKey) {
        this.status.backend = 'macOS Keychain';
        return keychainKey;
      }

      const newKey = crypto.randomBytes(32);
      try {
        execFileSync('security', [
          'add-generic-password',
          '-U',
          '-a', ACCOUNT,
          '-s', SERVICE,
          '-w', newKey.toString('base64'),
        ], { stdio: ['ignore', 'ignore', 'pipe'] });
        const verified = this.readKeychainKey();
        if (!verified) throw new Error('Keychain did not return the saved key.');
        this.status.backend = 'macOS Keychain';
        return verified;
      } catch (error) {
        this.status.error = `Keychain unavailable: ${error.message}`;
      }
    }

    this.status.backend = 'protected local key';
    return this.getOrCreateFallbackKey();
  }

  readKeychainKey() {
    try {
      const encoded = execFileSync('security', [
        'find-generic-password',
        '-a', ACCOUNT,
        '-s', SERVICE,
        '-w',
      ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const key = Buffer.from(encoded, 'base64');
      return key.length === 32 ? key : null;
    } catch {
      return null;
    }
  }

  getOrCreateFallbackKey() {
    if (fs.existsSync(this.fallbackKeyPath)) {
      const key = fs.readFileSync(this.fallbackKeyPath);
      if (key.length !== 32) throw new Error('Local master key is invalid.');
      try { fs.chmodSync(this.fallbackKeyPath, 0o600); } catch {}
      return key;
    }
    const key = crypto.randomBytes(32);
    fs.writeFileSync(this.fallbackKeyPath, key, { mode: 0o600, flag: 'wx' });
    return key;
  }
}

module.exports = {
  SecureConfigStore,
  defaultConfig,
};
