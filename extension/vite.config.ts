import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync } from 'node:fs';

const rootDir = dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'copy-manifest-and-icons',
      closeBundle() {
        // Manifest is emitted at dist/src/popup/index.html by Vite's HTML
        // handling; we copy the source manifest to dist root here so the
        // unpacked extension finds it.
        copyFileSync(
          resolve(rootDir, 'public/manifest.json'),
          resolve(rootDir, 'dist/manifest.json')
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        popup: resolve(rootDir, 'src/popup/index.html'),
        'service-worker': resolve(rootDir, 'src/background/service-worker.ts'),
        'content-bridge': resolve(rootDir, 'src/content/bridge.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'service-worker') return 'background/service-worker.js';
          if (chunkInfo.name === 'content-bridge') return 'content/bridge.js';
          return '[name].js';
        },
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
});