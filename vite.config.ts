import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // The native addon locates its prebuilt .node via __dirname, so it cannot be bundled.
        vite: { build: { rolldownOptions: { external: ['better-sqlite3'] } } },
      },
      preload: {
        input: 'electron/preload.ts',
        // package.json sets "type": "module", so the CJS preload must not use .mjs.
        vite: {
          build: {
            rollupOptions: {
              output: { format: 'cjs', entryFileNames: 'preload.cjs', inlineDynamicImports: true },
            },
          },
        },
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 2000 },
});
