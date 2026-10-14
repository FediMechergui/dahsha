import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export function configureMobile(product) {
  if (!['dahsha', 'flixer'].includes(product)) throw new Error('Invalid mobile product');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const file = path.join(root, 'mobile/capacitor.config.json');
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  config.appId = `app.${product}.stream`;
  config.appName = product === 'dahsha' ? 'Dahsha' : 'Flixer';
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  const stringsFile = path.join(root, 'mobile/android/app/src/main/res/values/strings.xml');
  let strings = fs.readFileSync(stringsFile, 'utf8');
  strings = strings.replace(/(<string name="(?:app_name|title_activity_main)">)[^<]*/g, `$1${config.appName}`)
    .replace(/(<string name="(?:package_name|custom_url_scheme)">)[^<]*/g, `$1${config.appId}`);
  fs.writeFileSync(stringsFile, strings);
  const iconScript = path.join(root, 'scripts', product === 'dahsha' ? 'android-icons.js' : 'flixer-icons.js');
  const icons = spawnSync(process.execPath, [iconScript], { cwd: root, stdio: 'inherit' });
  if (icons.status !== 0) throw new Error(`Could not generate ${product} Android icons`);
}
