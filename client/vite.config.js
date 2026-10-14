import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const product = process.env.VITE_PRODUCT || process.env.APP_PRODUCT || 'dahsha';
if (!['dahsha', 'flixer'].includes(product)) throw new Error('Invalid app product');
const documentaries = product === 'dahsha';
const dataDir = path.join(root, 'public', documentaries ? 'data' : 'data-flixer');
let buildConfig;
const assets = {
  name: 'product-assets',
  configResolved(config) { buildConfig = config; },
  configureServer(server) {
    const assetDir = documentaries ? path.join(root, 'public') : path.resolve(root, '../client-terrarium');
    server.middlewares.use((req, res, next) => {
      const name = (req.url || '').split('?')[0].slice(1);
      if (!['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'manifest.webmanifest'].includes(name)) return next();
      const file = path.join(assetDir, name);
      if (!fs.existsSync(file)) return next();
      res.setHeader('Content-Type', name.endsWith('.svg') ? 'image/svg+xml' : name.endsWith('.png') ? 'image/png' : 'application/manifest+json');
      fs.createReadStream(file).pipe(res);
    });
  },
  transformIndexHtml(html) {
    const title = documentaries ? 'Dahsha — Documentaries that amaze' : 'Flixer — Movies & TV Series';
    const description = documentaries ? 'Full-length documentaries in Arabic and English, organised by show and topic.' : 'Movies and TV series with multi-server playback.';
    return html.replace(/<title>.*?<\/title>/, `<title>${title}</title>`).replace(/(<meta name="description" content=")[^"]*/, `$1${description}`);
  },
  closeBundle() {
    const out = path.resolve(root, buildConfig.build.outDir);
    const assetDir = documentaries ? path.join(root, 'public') : path.resolve(root, '../client-terrarium');
    for (const name of ['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      const source = path.join(assetDir, name);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(out, name));
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(assetDir, 'manifest.webmanifest'), 'utf8'));
    manifest.start_url = './';
    manifest.icons = manifest.icons.map(icon => ({ ...icon, src: icon.src.replace(/^\//, '') }));
    fs.writeFileSync(path.join(out, 'manifest.webmanifest'), JSON.stringify(manifest));
    if (process.env.VITE_STATIC === '1' && !process.env.VITE_DATA_BASE && fs.existsSync(dataDir)) {
      const catalog = JSON.parse(fs.readFileSync(path.join(dataDir, 'catalog.json'), 'utf8'));
      if (catalog.product !== product) throw new Error(`Re-export ${product} data before building`);
      fs.cpSync(dataDir, path.join(out, 'data'), { recursive: true });
    }
  },
};

// PORT is the UI port (set by the launcher); API_PORT is where the Express API listens.
const UI_PORT = Number(process.env.PORT) || 5173;
const API_PORT = Number(process.env.API_PORT) || 4545;

export default defineConfig({
  plugins: [react(), assets],
  publicDir: false,
  define: { 'import.meta.env.VITE_PRODUCT': JSON.stringify(product) },
  server: {
    port: UI_PORT,
    strictPort: false,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: { outDir: documentaries ? 'dist' : 'dist-flixer', sourcemap: false },
});
