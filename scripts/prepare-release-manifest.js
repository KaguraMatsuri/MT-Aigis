const fs = require('node:fs');

const RELEASE_DOWNLOAD_URL = 'https://github.com/KaguraMatsuri/MT-Aigis/releases/latest/download/';

function prepareReleaseManifest(source) {
  let dmgFound = false;
  const output = String(source || '').replace(
    /^(\s*-\s+url:\s*)([^\s'"#]+)(\s*)$/gm,
    (line, prefix, rawUrl, suffix) => {
      const isDmg = /\.dmg$/i.test(rawUrl);
      if (/^https:\/\//i.test(rawUrl)) {
        if (isDmg && rawUrl.startsWith(RELEASE_DOWNLOAD_URL)) dmgFound = true;
        return line;
      }
      const absoluteUrl = new URL(rawUrl, RELEASE_DOWNLOAD_URL).toString();
      if (isDmg) dmgFound = true;
      return `${prefix}${absoluteUrl}${suffix}`;
    },
  );
  if (!dmgFound) throw new Error('release manifest does not contain a compatible DMG URL');
  return output;
}

if (require.main === module) {
  const manifestPath = process.argv[2] || 'dist/latest-mac.yml';
  const source = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(manifestPath, prepareReleaseManifest(source));
}

module.exports = prepareReleaseManifest;
