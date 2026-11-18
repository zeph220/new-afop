/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// BASE_PATH permet de servir le jeu depuis un sous-dossier (ex. GitHub Pages : /nom-du-depot/).
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: {
    format: 'es',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
