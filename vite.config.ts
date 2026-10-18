import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const HTML_DIR = fileURLToPath(new URL('./src/html', import.meta.url));

// The page's markup is split into partials under src/html. A line holding
// only <!-- @include some/file.html --> is replaced by that file, indented
// like the comment, so the built page is the same as one big index.html.
function htmlIncludes(): Plugin {
  const expand = (html: string, depth = 0): string => {
    if (depth > 8) throw new Error('html-includes: includes nested too deep (a loop?)');
    return html.replace(/^([ \t]*)<!-- @include (\S+) -->[ \t]*\r?$/gm, (_, indent: string, file: string) => {
      const text = readFileSync(resolve(HTML_DIR, file), 'utf8').replace(/\r\n/g, '\n').replace(/\n$/, '');
      return expand(text, depth + 1).split('\n').map((line) => (line ? indent + line : line)).join('\n');
    });
  };
  return {
    name: 'html-includes',
    transformIndexHtml: { order: 'pre', handler: (html) => expand(html) },
    configureServer(server) {
      server.watcher.add(HTML_DIR);
      server.watcher.on('change', (file) => {
        if (resolve(file).startsWith(HTML_DIR)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

// Everything (CSS, JS and the worker) is inlined into one HTML file, so the page
// works from a double click and publishes as a single artifact.
export default defineConfig({
  plugins: [htmlIncludes(), viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
