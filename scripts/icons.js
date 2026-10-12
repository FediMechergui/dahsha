// Renders the Dahsha mark to PNGs for the PWA manifest and the Android app (via @capacitor/assets).
// Uses sharp from mobile/node_modules.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'mobile', 'package.json'));
const sharp = require('sharp');

const MARK = (bg = '#ffcc00', pad = 0) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${64 + 2 * pad} ${64 + 2 * pad}">
  ${bg ? `<rect x="${-pad}" y="${-pad}" width="${64 + 2 * pad}" height="${64 + 2 * pad}" fill="${bg}"/>` : ''}
  <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/>
  <circle cx="32" cy="32" r="8.5" fill="#ffcc00"/>
  <circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/>
</svg>`;
const ROUNDED = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#ffcc00"/>
  <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/>
  <circle cx="32" cy="32" r="8.5" fill="#ffcc00"/>
  <circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/>
</svg>`;
const SPLASH = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732">
  <rect width="2732" height="2732" fill="#0a0b0d"/>
  <g transform="translate(1166 1166) scale(6.25)">
    <rect width="64" height="64" rx="14" fill="#ffcc00"/>
    <path d="M8 32c6.5-9.5 15-14.5 24-14.5S49.5 22.5 56 32c-6.5 9.5-15 14.5-24 14.5S14.5 41.5 8 32z" fill="#0a0b0d"/>
    <circle cx="32" cy="32" r="8.5" fill="#ffcc00"/>
    <circle cx="35" cy="29" r="2.6" fill="#0a0b0d"/>
  </g>
</svg>`;

const out = async (svg, file, size) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(file);
  console.log('wrote', path.relative(root, file));
};

await out(ROUNDED, path.join(root, 'client/public/icon-192.png'), 192);
await out(ROUNDED, path.join(root, 'client/public/icon-512.png'), 512);
await out(MARK('#ffcc00', 8), path.join(root, 'client/public/icon-maskable-512.png'), 512);
// @capacitor/assets inputs
await out(MARK('#ffcc00', 6), path.join(root, 'mobile/assets/icon-only.png'), 1024);
await out(MARK('', 10), path.join(root, 'mobile/assets/icon-foreground.png'), 1024);
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ffcc00' } }).png().toFile(path.join(root, 'mobile/assets/icon-background.png'));
await out(SPLASH, path.join(root, 'mobile/assets/splash.png'), 2732);
await out(SPLASH, path.join(root, 'mobile/assets/splash-dark.png'), 2732);
console.log('icons done');
