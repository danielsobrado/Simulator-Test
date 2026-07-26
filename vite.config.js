import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { contentLibraryPlugin } from './scripts/content-library-plugin.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [contentLibraryPlugin(root)],
  resolve: {
    alias: [
      { find: /^three$/, replacement: 'three/webgpu' },
    ],
  },
  build: {
    rollupOptions: {
      input: {
        app: path.resolve(root, 'index.html'),
        workshopQa: path.resolve(root, 'workshop-qa.html'),
      },
    },
  },
});
