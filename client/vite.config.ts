import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Point at the shared *source* so `npm run dev` picks up protocol edits
      // without a separate build step.
      '@doodl/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // The game server owns /ws; proxying keeps dev single-origin like prod.
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8080', ws: true },
      '/healthz': { target: 'http://127.0.0.1:8080' },
    },
  },
  build: {
    outDir: `${root}dist`,
    emptyOutDir: true,
    sourcemap: false,
  },
});
