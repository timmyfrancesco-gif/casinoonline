import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The workspace packages are pure modules (no import-time effects). Without this hint the zod
// schemas of @casino/shared, unused by the web, would be bundled.
const treeshake = {
  moduleSideEffects: [
    { test: /[\\/]packages[\\/](shared|engine)[\\/]src[\\/]/, sideEffects: false },
  ],
};

// The production server sends a strict CSP (default-src 'self'): no inline assets, no CDNs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: false },
    },
  },
  preview: { port: 4173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Never inline assets as data: URIs (blocked by the CSP).
    assetsInlineLimit: 0,
    sourcemap: false,
    target: 'es2022',
    rolldownOptions: { treeshake },
  },
  worker: { format: 'es', rolldownOptions: { treeshake } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
    unstubGlobals: true,
  },
});
