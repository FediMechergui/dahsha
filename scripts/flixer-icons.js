// Renders the Flixer mark: PWA icons for client-terrarium/ and launcher icons (legacy + adaptive)
// for the Capacitor Android project. Uses sharp from mobile/node_modules.
//   node scripts/flixer-icons.js
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'mobile', 'package.json'));
const sharp = require('sharp');

const AMBER = '#F3B257', INK = '#0C1210', FERN = '#7CCB95';
// The mark: a dark screen frame with an amber play wedge and the live "fern" dot.
const FRAME = `
  <rect x="11" y="15" width="42" height="34" rx="8" fill="${INK}"/>
  <path d="M27 24.5v15l13-7.5z" fill="${AMBER}"/>
  <circle cx="46" cy="21.5" r="2.6" fill="${FERN}"/>`;
const svg = (pad, bg, shape) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${64 + 2 * pad} ${64 + 2 * pad}">
  ${bg === 'round' ? `<circle cx="32" cy="32" r="${32 + pad}" fill="${AMBER}"/>` : bg === 'square' ? `<rect x="${-pad}" y="${-pad}" width="${64 + 2 * pad}" height="${64 + 2 * pad}" fill="${AMBER}"/>` : bg === 'rounded' ? `<rect width="64" height="64" rx="14" fill="${AMBER}"/>` : ''}
  ${shape || FRAME}
</svg>`;

const write = async (markup, file, size, flatten) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let img = sharp(Buffer.from(markup)).resize(size, size);
  if (flatten) img = img.flatten({ background: flatten });
  await img.png().toFile(file);
  console.log('wrote', path.relative(root, file));
};

// PWA / web
const web = path.join(root, 'client-terrarium');
fs.writeFileSync(path.join(web, 'favicon.svg'), svg(0, 'rounded').trim() + '\n');
console.log('wrote client-terrarium/favicon.svg');
await write(svg(0, 'rounded'), path.join(web, 'icon-192.png'), 192);
await write(svg(0, 'rounded'), path.join(web, 'icon-512.png'), 512);
await write(svg(8, 'square'), path.join(web, 'icon-maskable-512.png'), 512);

// Android launcher icons
const res = path.join(root, 'mobile', 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const DENS = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(DENS)) {
    const dir = path.join(res, `mipmap-${d}`);
    await write(svg(0, 'rounded'), path.join(dir, 'ic_launcher.png'), s);
    await write(svg(0, 'round'), path.join(dir, 'ic_launcher_round.png'), s);
    // Adaptive: 108dp canvas, mark inside the 66dp safe zone.
    await write(svg(18, ''), path.join(dir, 'ic_launcher_foreground.png'), Math.round(s * 108 / 48));
    await write(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="${AMBER}"/></svg>`, path.join(dir, 'ic_launcher_background.png'), Math.round(s * 108 / 48));
  }
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  fs.mkdirSync(anydpi, { recursive: true });
  const adaptive = `<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@mipmap/ic_launcher_background"/>\n    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n`;
  fs.writeFileSync(path.join(anydpi, 'ic_launcher.xml'), adaptive);
  fs.writeFileSync(path.join(anydpi, 'ic_launcher_round.xml'), adaptive);
  // Splash (Capacitor splash screen drawable) in the app colours.
  const splash = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="${INK}"/><g transform="translate(1166 1166) scale(6.25)">${svg(0, 'rounded').replace(/^[\s\S]*?<svg[^>]*>/, '').replace('</svg>', '')}</g></svg>`;
  for (const d of ['drawable', 'drawable-land-mdpi', 'drawable-land-hdpi', 'drawable-land-xhdpi', 'drawable-land-xxhdpi', 'drawable-land-xxxhdpi', 'drawable-port-mdpi', 'drawable-port-hdpi', 'drawable-port-xhdpi', 'drawable-port-xxhdpi', 'drawable-port-xxxhdpi']) {
    const f = path.join(res, d, 'splash.png');
    if (fs.existsSync(f)) await write(splash, f, d === 'drawable' ? 480 : 1024);
  }
  console.log('android launcher icons done');
}
console.log('flixer icons done');
