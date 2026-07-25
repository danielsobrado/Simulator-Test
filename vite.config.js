import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
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
