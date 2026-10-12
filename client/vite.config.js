import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// PORT is the UI port (set by the launcher); API_PORT is where the Express API listens.
const UI_PORT = Number(process.env.PORT) || 5173;
const API_PORT = Number(process.env.API_PORT) || 4545;

export default defineConfig({
  plugins: [react()],
  server: {
    port: UI_PORT,
    strictPort: false,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', sourcemap: false },
});
