// Writes launcher icons (legacy + adaptive) into the Capacitor Android project from the Dahsha mark.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'mobile', 'package.json'));
const sharp = require('sharp');
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
if (!fs.existsSync(res)) { console.error('Android project not found - run "npx cap add android" in mobile/ first'); process.exit(1); }

const MARK = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${64 + 2 * pad} ${64 + 2 * pad}">
  <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/>
  <circle cx="32" cy="32" r="8.5" fill="#ffcc00"/>
  <circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/>
</svg>`;
const LEGACY = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#ffcc00"/>
  <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/>
  <circle cx="32" cy="32" r="8.5" fill="#ffcc00"/>
  <circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/>
</svg>`;
const ROUND = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="32" fill="#ffcc00"/>
  <path d="M10 32c6-8.5 13.5-13 22-13s16 4.5 22 13c-6 8.5-13.5 13-22 13s-16-4.5-22-13z" fill="#0a0b0d"/>
  <circle cx="32" cy="32" r="7.5" fill="#ffcc00"/>
  <circle cx="34.6" cy="29.4" r="2.3" fill="#0a0b0d"/>
</svg>`;

const DENS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const write = async (svg, file, size, bg) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let img = sharp(Buffer.from(svg)).resize(size, size);
  if (bg) img = img.flatten({ background: bg });
  await img.png().toFile(file);
};
for (const [d, s] of Object.entries(DENS)) {
  const dir = path.join(res, `mipmap-${d}`);
  await write(LEGACY, path.join(dir, 'ic_launcher.png'), s);
  await write(ROUND, path.join(dir, 'ic_launcher_round.png'), s);
  // Adaptive foreground: 108dp canvas with the mark inside the 66dp safe zone.
  await write(MARK(18), path.join(dir, 'ic_launcher_foreground.png'), Math.round(s * 108 / 48));
  await write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="#ffcc00"/></svg>`, path.join(dir, 'ic_launcher_background.png'), Math.round(s * 108 / 48));
}
const anydpi = path.join(res, 'mipmap-anydpi-v26');
fs.mkdirSync(anydpi, { recursive: true });
const adaptive = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
// Remove template drawables that would otherwise shadow ours.
for (const f of ['drawable/ic_launcher_background.xml', 'drawable-v24/ic_launcher_foreground.xml']) fs.rmSync(path.join(res, f), { force: true });
// Splash: solid brand background.
for (const d of ['drawable', 'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi', 'drawable-land-xxhdpi', 'drawable-land-xxxhdpi', 'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi', 'drawable-port-xxhdpi', 'drawable-port-xxxhdpi']) {
  const f = path.join(res, d, 'splash.png');
  if (fs.existsSync(f)) await write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0a0b0d"/><g transform="translate(22 22) scale(0.3125)"><rect width="64" height="64" rx="14" fill="#ffcc00"/><path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/><circle cx="32" cy="32" r="8.5" fill="#ffcc00"/><circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/></g></svg>`, f, 1024);
}
console.log('android icons written');
