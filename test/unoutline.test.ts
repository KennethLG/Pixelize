import { describe, expect, it } from 'vitest';
import { cloneBitmap, drawRect, boxOf, getPixel, newBitmap, outline, plot, type Bitmap } from '../src/core/bitmap';
import { analyzeOutline, OutlineClass, removeOutline } from '../src/core/unoutline';
import type { RGBA } from '../src/core/color';

const SKIN: RGBA = [230, 180, 140, 255], SKIN_DARK: RGBA = [205, 155, 120, 255];
const SHIRT: RGBA = [60, 120, 200, 255], BLACK: RGBA = [20, 15, 25, 255];
const TRANSPARENT: RGBA = [0, 0, 0, 0];

/** A body with a soft shaded bottom row, an arm over it and an eye: the art without its outline. */
function art(): Bitmap {
  const b = newBitmap(20, 20);
  drawRect(b, boxOf(4, 4, 15, 14), true, 1, SKIN);
  drawRect(b, boxOf(4, 15, 15, 15), true, 1, SKIN_DARK);
  drawRect(b, boxOf(5, 5, 10, 13), true, 1, SHIRT);
  plot(b, 13, 7, BLACK);
  return b;
}

/** The same art outlined: the silhouette, and the arm where it lies over the body. */
function outlined(): Bitmap {
  const b = art();
  drawRect(b, boxOf(5, 5, 10, 13), false, 1, BLACK);
  outline(b, BLACK, false);
  return b;
}

const same = (a: Bitmap, b: Bitmap) => {
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) expect([x, y, ...getPixel(a, x, y)]).toEqual([x, y, ...getPixel(b, x, y)]);
};

describe('outline removal', () => {
  it('sorts edge, contour and detail', () => {
    const a = analyzeOutline(outlined());
    const at = (x: number, y: number) => a.classes[y * 20 + x];
    expect(a.colors).toHaveLength(1);
    expect(at(3, 8)).toBe(OutlineClass.Edge);
    expect(at(5, 8)).toBe(OutlineClass.Contour);
    expect(at(13, 7)).toBe(OutlineClass.Detail);
    expect(at(8, 8)).toBe(OutlineClass.None);
  });

  it('shrink gives back the art without outline', () => {
    const b = outlined();
    removeOutline(b, { shrink: true });
    same(b, art());
  });

  it('fill keeps the silhouette and continues the colors next to it', () => {
    const b = outlined();
    removeOutline(b);
    expect(getPixel(b, 3, 8)).toEqual(SKIN);
    expect(getPixel(b, 8, 16)).toEqual(SKIN_DARK);
    expect(getPixel(b, 5, 8)).toEqual(SHIRT);
    expect(getPixel(b, 13, 7)).toEqual(BLACK);
    expect(getPixel(b, 2, 8)).toEqual(TRANSPARENT);
  });

  it('a darker shade of each color as outline (selout) is found too', () => {
    const b = art();
    outline(b, [150, 105, 80, 255], false);
    const a = removeOutline(b, { shrink: true });
    expect(a.edge).toBeGreaterThan(0);
    same(b, art());
  });

  it('art without outline is left alone, even with dark shading along one side', () => {
    const b = newBitmap(20, 20);
    drawRect(b, boxOf(4, 4, 15, 14), true, 1, SKIN);
    drawRect(b, boxOf(4, 15, 15, 15), true, 1, [120, 70, 50, 255]);
    const before = cloneBitmap(b);
    const a = removeOutline(b);
    expect(a.colors).toEqual([]);
    same(b, before);
  });

  it('a dark area (hair) between two regions is not a line', () => {
    const b = outlined();
    drawRect(b, boxOf(11, 9, 14, 12), true, 1, BLACK);
    drawRect(b, boxOf(11, 13, 14, 14), true, 1, SHIRT);
    const a = analyzeOutline(b);
    expect(a.classes[10 * 20 + 12]).toBe(OutlineClass.None);
    expect(a.classes[9 * 20 + 11]).toBe(OutlineClass.None);
    expect(a.classes[8 * 20 + 5]).toBe(OutlineClass.Contour);
  });

  it('art cut by the canvas border has its outline there too', () => {
    const b = newBitmap(20, 20);
    drawRect(b, boxOf(4, 0, 15, 14), true, 1, SKIN);
    outline(b, BLACK, false);
    const a = analyzeOutline(b);
    expect(a.classes[0 * 20 + 3]).toBe(OutlineClass.Edge);
    expect(a.classes[0 * 20 + 8]).toBe(OutlineClass.None);
  });

  it('only looks inside the mask', () => {
    const b = outlined();
    const mask = new Uint8Array(400);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 10; x++) mask[y * 20 + x] = 1;
    removeOutline(b, { mask, shrink: true });
    expect(getPixel(b, 3, 8)).toEqual(TRANSPARENT);
    expect(getPixel(b, 16, 8)).toEqual(BLACK);
  });
});
