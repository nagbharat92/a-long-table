import { defineConfig } from 'vite';

export default defineConfig({
  cacheDir: '.cache/vite',
  base: './',
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
  preview: { host: '127.0.0.1', port: 5186, strictPort: true },
  build: {
    manifest: true,
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'phaser', test: /node_modules[\\/]phaser[\\/]/ },
            { name: 'reference-data', test: /fixtures[\\/]packed-worlds\.json$/ },
          ],
        },
      },
    },
  },
});
