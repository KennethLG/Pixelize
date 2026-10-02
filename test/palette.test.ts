import { describe, expect, it } from 'vitest';
import { fakePixelArt, lanternSheet, makeRng } from '../src/core/fake';
import { hex, keyAt, rgbOfKey, type RGB } from '../src/core/color';
import { parsePaletteText } from '../src/core/paletteText';
import { cleanStray } from '../src/core/cleanup';
import { run } from './helpers';

const colorsOf = (px: Uint8ClampedArray) => {
  const s = new Set<number>();
  for (let i = 0; i < px.length; i += 4) if (px[i + 3]) s.add(keyAt(px, i));
  return [...s].map((k) => hex(rgbOfKey(k))).sort();
};

const lantern = () => fakePixelArt(lanternSheet(), makeRng(3));

describe('palette', () => {
  it('a fixed count gives exactly that many colors', () => {
    expect(colorsOf(run(lantern(), (o) => { o.palette.mode = 'fixed'; o.palette.count = 4; }).pixels)).toHaveLength(4);
  });

  it('an imported palette is the only thing used', () => {
    const imported: RGB[] = [[0, 0, 0], [255, 255, 255], [255, 136, 0], [68, 85, 102]];
    const r = run(lantern(), (o) => { o.palette.mode = 'imported'; o.palette.imported = imported; });
    for (const c of colorsOf(r.pixels)) expect(imported.map(hex)).toContain(c);
  });

  it('a locked color survives a much higher tolerance', () => {
    const base = colorsOf(run(lantern()).pixels);
    const locked = base[2];
    const lockedRgb = parsePaletteText(locked)[0];
    const loose = run(lantern(), (o) => { o.palette.tol = 30; o.palette.locks = [lockedRgb]; });
    expect(colorsOf(loose.pixels)).toContain(locked);
  });

  it('replace and merge maps chain', () => {
    const base = colorsOf(run(lantern()).pixels).map((h) => parsePaletteText(h)[0]);
    const [a, b] = base;
    const c: RGB = [0, 255, 0];
    const r = run(lantern(), (o) => { o.palette.maps = [{ from: a, to: b }, { from: b, to: c }]; });
    const out = colorsOf(r.pixels);
    expect(out).toContain('#00ff00');
    expect(out).not.toContain(hex(a));
    expect(out).not.toContain(hex(b));
  });

  it('reads hex lists and GIMP palettes', () => {
    expect(parsePaletteText('#000000 #ffffff\nff8800').map(hex)).toEqual(['#000000', '#ffffff', '#ff8800']);
    expect(parsePaletteText('GIMP Palette\nName: x\n#\n 10  20  30\tA\n255 0 0 red').map(hex)).toEqual(['#0a141e', '#ff0000']);
  });
});

describe('background', () => {
  it('edge mode keeps the background color inside the sprite', () => {
    const r = run(lantern(), (o) => { o.bg.on = true; });
    const bg = r.bgKey!;
    let opaqueBg = 0, transparent = 0;
    for (let i = 0; i < r.pixels.length; i += 4) {
      if (!r.pixels[i + 3]) transparent++;
      else if (keyAt(r.pixels, i) === bg) opaqueBg++;
    }
    expect(transparent).toBeGreaterThan(0);
    // the sample has no enclosed background, so nothing of that color stays
    expect(opaqueBg).toBe(0);
    expect(r.preBg.some((v, i) => i % 4 === 3 && v === 0)).toBe(false);
  });
});

describe('stray pixel cleanup', () => {
  const sprite = (center: RGB) => {
    const w = 5, px = new Uint8ClampedArray(w * w * 4);
    for (let i = 0; i < w * w; i++) px.set([100, 100, 100, 255], i * 4);
    px.set([...center, 255], 12 * 4);
    return px;
  };
  it('removes a low-contrast speck', () => {
    expect([...cleanStray(sprite([108, 104, 100]), 5, 5, 15).slice(48, 51)]).toEqual([100, 100, 100]);
  });
  it('keeps a high-contrast detail', () => {
    expect([...cleanStray(sprite([255, 255, 255]), 5, 5, 15).slice(48, 51)]).toEqual([255, 255, 255]);
  });
});
