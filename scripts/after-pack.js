const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const contentsPath = path.join(appPath, 'Contents');
  const resourcesPath = path.join(contentsPath, 'Resources');
  const plistPath = path.join(contentsPath, 'Info.plist');
  const fallbackAssets = path.join(context.packager.projectDir, 'resources', 'Assets.car');
  const bundledAssets = path.join(resourcesPath, 'Assets.car');

  if (!fs.existsSync(plistPath)) return;

  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleDisplayName', '-string', 'MT-Aigis', plistPath]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleName', '-string', 'MT-Aigis', plistPath]);
  execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleExecutable', '-string', 'MT-Aigis', plistPath]);

  if (!fs.existsSync(bundledAssets) && fs.existsSync(fallbackAssets)) {
    fs.copyFileSync(fallbackAssets, bundledAssets);
  }

  let iconName = '';
  try {
    iconName = execFileSync('/usr/bin/plutil', [
      '-extract',
      'CFBundleIconName',
      'raw',
      '-o',
      '-',
      plistPath,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {}

  if (fs.existsSync(bundledAssets) && !iconName) {
    execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIconName', '-string', 'Icon', plistPath]);
  }
};
