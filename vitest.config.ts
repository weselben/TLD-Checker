import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    include: ['test/**/*.test.ts', 'src/web/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/web/**/*.test.ts', 'jsdom'],
      ['test/**/*.test.ts', 'node'],
    ],
  },
});