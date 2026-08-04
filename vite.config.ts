import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [vue()],
  root: resolve(__dirname, 'src/web'),
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    // SPA dev server proxies API calls to `wrangler dev` (npm run preview).
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
});
