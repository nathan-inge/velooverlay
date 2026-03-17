import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Tauri expects the dev server on port 5173.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: {
    // Point workspace packages directly at their TypeScript source so that
    // Vite (Rollup) bundles them as ESM without needing a separate CJS build.
    alias: {
      '@velooverlay/widget-sdk': resolve(__dirname, '../packages/widget-sdk/src/index.ts'),
      '@velooverlay/widgets-builtin': resolve(
        __dirname,
        '../packages/widgets-builtin/src/index.ts',
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
});
