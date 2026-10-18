import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';
import react from '@vitejs/plugin-react';

// Everything (CSS, JS and the worker) is inlined into one HTML file, so the page
// works from a double click and publishes as a single artifact.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
