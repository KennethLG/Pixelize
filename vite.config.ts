import { defineConfig } from 'vitest/config';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Everything (CSS, JS and the worker) is inlined into one HTML file, so the page
// works from a double click and publishes as a single artifact.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
