import { describe, expect, it } from 'vitest';
import { newBitmap, plot, drawLine } from '../src/core/bitmap';
import { hex, labOf, rgbToHsv, type RGB, type RGBA } from '../src/core/color';
import { findBanding, findJaggies, findNearDuplicates, findOrphans } from '../src/core/lint';
import { applyVariant, hueShiftRamp, nearestColor, shadeColor, snapPalette, snapPixels } from '../src/core/shading';
import { cloneDoc, createDoc, parseDoc, serializeDoc } from '../src/core/sprite';

const RED: RGBA = [200, 40, 40, 255], BLUE: RGBA = [40, 60, 200, 255], GREEN: RGBA = [40, 160, 60, 255];

describe('ramps and shading', () => {
  const base: RGB = [200, 120, 60];
  const ramp = hueShiftRamp(base, { steps: 2, hueShift: 15, contrast: 0.15 });

  it('goes from dark to light with the base color in the middle', () => {
    expect(ramp).toHaveLength(5);
    expect(ramp[2]).toEqual(base);
    const light = ramp.map((c) => labOf(c)[0]);
    for (let i = 1; i < light.length; i++) expect(light[i]).toBeGreaterThan(light[i - 1]);
  });

  it('turns shadows toward blue and highlights toward yellow', () => {
    const h = (c: RGB) => rgbToHsv(c)[0];
    const toward = (from: number, to: number, target: number) => Math.abs(((target - to + 540) % 360) - 180) < Math.abs(((target - from + 540) % 360) - 180);
    expect(toward(h(base), h(ramp[0]), 240)).toBe(true);
    expect(toward(h(base), h(ramp[4]), 60)).toBe(true);
  });

  it('dark and light colors still get distinct steps', () => {
    const distinct = (r: RGB[]) => new Set(r.map((c) => c.join())).size === r.length;
    for (const c of [[27, 21, 48], [250, 245, 235], [0, 0, 0], [255, 255, 255]] as RGB[]) {
      const r = hueShiftRamp(c);
      expect(distinct(r)).toBe(true);
    }
  });

  it('a grey ramp stays grey', () => {
    for (const c of hueShiftRamp([128, 128, 128])) expect(c[0]).toBe(c[1]);
  });

  it('shading moves one step along the ramp and stops at the ends', () => {
    expect(shadeColor(ramp[2], [ramp], 1)).toEqual(ramp[3]);
    expect(shadeColor(ramp[2], [ramp], -1)).toEqual(ramp[1]);
    expect(shadeColor(ramp[4], [ramp], 1)).toBeNull();
    expect(shadeColor([1, 2, 3], [ramp], 1)).toBeNull();
  });
});

describe('palette lock and variants', () => {
  const pal = snapPalette([[0, 0, 0], [255, 255, 255], [200, 40, 40]]);

  it('snaps to the closest color', () => {
    expect(nearestColor([30, 20, 20], pal)).toEqual([0, 0, 0]);
    expect(nearestColor([210, 60, 50], pal)).toEqual([200, 40, 40]);
    const px = new Uint8ClampedArray([240, 240, 230, 128, 0, 0, 0, 0]);
    snapPixels(px, pal);
    expect([...px]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
  });

  it('variants are saved with the project and copied with it', () => {
    const d = createDoc(2, 2);
    d.variants.push({ name: 'blue', map: { '#c82828': '#283cc8', bad: '#000000' } });
    const back = parseDoc(serializeDoc(d))!;
    expect(back.variants).toEqual([{ name: 'blue', map: { '#c82828': '#283cc8' } }]);
    const copy = cloneDoc(d);
    copy.variants[0].map['#c82828'] = '#000000';
    expect(d.variants[0].map['#c82828']).toBe('#283cc8');
  });

  it('a variant swaps only its colors', () => {
    const px = new Uint8ClampedArray([...RED, ...BLUE, 0, 0, 0, 0]);
    const out = applyVariant(px, { name: 'blue team', map: { [hex(RED)]: hex(BLUE) } });
    expect([...out.slice(0, 4)]).toEqual(BLUE);
    expect([...out.slice(4, 8)]).toEqual(BLUE);
    expect(out[11]).toBe(0);
    expect([...px.slice(0, 4)]).toEqual(RED); // the original is untouched
  });
});

describe('linter', () => {
  it('finds a lone pixel but not pixels of a line', () => {
    const b = newBitmap(8, 8);
    plot(b, 6, 6, RED);
    drawLine(b, 0, 0, 4, 0, 1, BLUE);
    const o = findOrphans(b.px, 8, 8);
    expect(o.map((i) => [i.x, i.y])).toEqual([[6, 6]]);
  });

  it('finds the doubled corner of a staircase line', () => {
    const b = newBitmap(6, 6);
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]]) plot(b, x, y, BLUE);
    const j = findJaggies(b.px, 6, 6).map((i) => [i.x, i.y]);
    expect(j).toEqual([[1, 0], [2, 1]]);
    // a clean diagonal has none
    const c = newBitmap(6, 6);
    drawLine(c, 0, 0, 5, 5, 1, BLUE);
    expect(findJaggies(c.px, 6, 6)).toHaveLength(0);
  });

  it('finds a 1 px band stepping along an edge', () => {
    const b = newBitmap(10, 6);
    // rows of RED | GREEN | BLUE with the green band moving right one pixel per row
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 10; x++) plot(b, x, y, x < 3 + y ? RED : x === 3 + y ? GREEN : BLUE);
    }
    const band = findBanding(b.px, 10, 6);
    expect(band.length).toBe(4);
    expect(band.every((i) => i.color === ((40 << 16) | (160 << 8) | 60))).toBe(true);
    // a straight band (no steps) is fine
    const s = newBitmap(10, 6);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 10; x++) plot(s, x, y, x < 3 ? RED : x === 3 ? GREEN : BLUE);
    expect(findBanding(s.px, 10, 6)).toHaveLength(0);
  });

  it('finds colors that are almost the same, at the rarer one', () => {
    const b = newBitmap(4, 1);
    plot(b, 0, 0, RED); plot(b, 1, 0, RED); plot(b, 2, 0, [202, 41, 40, 255]); plot(b, 3, 0, BLUE);
    const d = findNearDuplicates(b.px, 4, 1);
    expect(d).toHaveLength(1);
    expect([d[0].x, d[0].y]).toEqual([2, 0]);
  });
});
