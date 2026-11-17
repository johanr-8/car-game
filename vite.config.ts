import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: {
      '@core':    '/src/core',
      '@car':     '/src/car',
      '@world':   '/src/world',
      '@ui':      '/src/ui',
      '@audio':   '/src/audio',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: true,
  },
});
