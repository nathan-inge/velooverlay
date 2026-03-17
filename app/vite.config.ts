import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri expects the dev server on port 5173.
// `TAURI_DEV_HOST` is set by the Tauri CLI in mobile development — not needed for desktop yet.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Tauri supports ES2021 on all desktop platforms.
    target: ['es2021', 'chrome100', 'safari13'],
    minify: !process.env.TAURI_DEBUG,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: 'dist',
  },
});
