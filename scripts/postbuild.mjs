// Turns Vite's dist/index.html into dist/pixelize.html without the document
// skeleton (doctype, html, head, body). The artifact host adds its own skeleton,
// and browsers open the fragment fine from a double click.
// The full document is kept as dist/desktop/index.html for the Electron app.
import { readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';

let html = readFileSync('dist/index.html', 'utf8');
mkdirSync('dist/desktop', { recursive: true });
writeFileSync('dist/desktop/index.html', html);

const removeFirst = (re) => { html = html.replace(re, ''); };
const removeLast = (tag) => {
  const i = html.lastIndexOf(tag);
  if (i >= 0) html = html.slice(0, i) + html.slice(i + tag.length);
};

removeFirst(/<!doctype html>/i);
removeFirst(/<html[^>]*>/i);
removeFirst(/<head>/i);
removeFirst(/<\/head>/i);
removeFirst(/<body>/i);
removeLast('</body>');
removeLast('</html>');

html = html.trim() + '\n';
writeFileSync('dist/pixelize.html', html);
rmSync('dist/index.html');
console.log(`dist/pixelize.html ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
