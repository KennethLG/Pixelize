// Command-line version of the conversion, on the same core as the web page.
// Run with: npm run cli -- <input> [options]

import sharp from 'sharp';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { hex, keyAt, labOfKey, rgbOfKey, type RGB } from '../src/core/color';
import { confidenceLevel } from '../src/core/grid';
import { parsePaletteText } from '../src/core/paletteText';
import { defaultOptions, processImage } from '../src/core/pipeline';

const HELP = `Usage: npm run cli -- <input> [options]

  -o, --out <file>        output PNG (default: <input>_pixel.png)
  --colors <n>            exactly n palette colors (k-means)
  --tolerance <dE>        auto palette: merge colors closer than this (Lab deltaE, default 10)
  --use-palette <file>    snap to a palette file (.hex, .gpl or a PNG of colors)
  --cell <px>             skip detection: cell size in source px (can be fractional)
  --size <WxH>            skip detection: exact output size, e.g. 64x64
  --remove-bg             make the background (the most common edge color) transparent
  --trim [pad]            crop the empty space around the art, keeping pad px (default 0)
  --clean                 remove stray noise pixels
  --alpha <0-255>         cells with alpha below this become transparent (default 128)
  --preview <n>           also write a preview scaled n times (default 8, 0 = off)
  --palette               also write <out>_palette.png and print the hex codes`;

interface Args {
  input?: string;
  out?: string;
  colors?: number;
  tolerance: number;
  usePalette?: string;
  cell?: number;
  size?: [number, number];
  removeBg: boolean;
  trim: number | null;
  clean: boolean;
  alpha: number;
  preview: number;
  palette: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { tolerance: 10, removeBg: false, trim: null, clean: false, alpha: 128, preview: 8, palette: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      return v;
    };
    if (arg === '-o' || arg === '--out') a.out = next();
    else if (arg === '--colors') a.colors = parseInt(next(), 10);
    else if (arg === '--tolerance') a.tolerance = parseFloat(next());
    else if (arg === '--use-palette') a.usePalette = next();
    else if (arg === '--cell') a.cell = parseFloat(next());
    else if (arg === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(next());
      if (!m) throw new Error('--size must look like 64x64');
      a.size = [parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    else if (arg === '--remove-bg') a.removeBg = true;
    else if (arg === '--trim') a.trim = /^\d+$/.test(argv[i + 1] ?? '') ? parseInt(argv[++i], 10) : 0;
    else if (arg === '--clean') a.clean = true;
    else if (arg === '--alpha') a.alpha = parseInt(next(), 10);
    else if (arg === '--preview') a.preview = parseInt(next(), 10);
    else if (arg === '--palette') a.palette = true;
    else if (arg === '-h' || arg === '--help') a.help = true;
    else if (arg.startsWith('-')) throw new Error(`Unknown option ${arg}. Run with --help to see the options.`);
    else a.input = arg;
  }
  return a;
}

async function loadPalette(file: string): Promise<RGB[]> {
  if (/\.(png|gif|jpe?g|webp)$/i.test(file)) {
    const { data } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const seen = new Set<number>();
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128) seen.add(keyAt(data, i));
    return [...seen].slice(0, 256).map(rgbOfKey);
  }
  return parsePaletteText(readFileSync(file, 'utf8'));
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.input) {
    console.log(HELP);
    process.exit(a.input || a.help ? 0 : 1);
  }

  const { data, info } = await sharp(a.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const src = { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height };
  console.log(`Input: ${src.w}x${src.h}`);

  const o = defaultOptions();
  o.alpha = a.alpha;
  o.palette.tol = a.tolerance;
  if (a.colors) { o.palette.mode = 'fixed'; o.palette.count = a.colors; }
  if (a.usePalette) {
    o.palette.mode = 'imported';
    o.palette.imported = await loadPalette(a.usePalette);
    console.log(`Palette file: ${o.palette.imported.length} colors`);
  }
  if (a.cell) o.size = { ...o.size, mode: 'manual', cellX: a.cell, cellY: a.cell };
  if (a.size) o.size = { ...o.size, mode: 'exact', fw: a.size[0], fh: a.size[1] };
  o.bg.on = a.removeBg;
  if (a.trim !== null) o.crop = { ...o.crop, mode: 'trim', pad: a.trim };
  o.clean.on = a.clean;

  const r = processImage(src, {}, o);
  const g = r.grid;
  if (g.cell) {
    const level = confidenceLevel(g.confidence);
    console.log(`Cell size: ~${g.cell.x.toFixed(2)} px (cells vary ${g.min}-${g.max} px)${level ? `, ${level} confidence` : ''}`);
    if (level === 'low') console.log('  The detection is uncertain; check the result or pass --cell / --size.');
  }
  console.log(`Output size: ${r.width}x${r.height}`);

  const colors = new Set<number>();
  for (let i = 0; i < r.pixels.length; i += 4) if (r.pixels[i + 3]) colors.add(keyAt(r.pixels, i));
  const palette = [...colors].sort((x, y) => labOfKey(x)[0] - labOfKey(y)[0]);
  console.log(`Palette: ${palette.length} colors (from ${r.sampled} sampled)`);

  const parsed = path.parse(a.input!);
  const out = a.out || path.join(parsed.dir, `${parsed.name}_pixel.png`);
  const raw = { raw: { width: r.width, height: r.height, channels: 4 as const } };
  const pixels = Buffer.from(r.pixels.buffer, r.pixels.byteOffset, r.pixels.length);
  await sharp(pixels, raw).png().toFile(out);
  console.log(`Wrote ${out}`);

  const outParsed = path.parse(out);
  if (a.preview > 0) {
    const prev = path.join(outParsed.dir, `${outParsed.name}_x${a.preview}.png`);
    await sharp(pixels, raw).resize(r.width * a.preview, r.height * a.preview, { kernel: 'nearest' }).png().toFile(prev);
    console.log(`Wrote ${prev}`);
  }
  if (a.palette) {
    const strip = Buffer.alloc(palette.length * 4);
    palette.forEach((k, i) => { const c = rgbOfKey(k); strip.set([c[0], c[1], c[2], 255], i * 4); });
    const palFile = path.join(outParsed.dir, `${outParsed.name}_palette.png`);
    await sharp(strip, { raw: { width: palette.length, height: 1, channels: 4 } }).png().toFile(palFile);
    console.log(`Wrote ${palFile}`);
    console.log(palette.map((k) => hex(rgbOfKey(k))).join(' '));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
