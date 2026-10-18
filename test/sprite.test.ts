import { describe, expect, it } from 'vitest';
import {
  blit, boxOf, clearMasked, colorMask, combineMasks, drawEllipse, drawLine, drawRect, extract, fill, flip, floatingMask,
  getPixel, isLCorner, maskBounds, newBitmap, outline, pixelPerfect, plot, rectMask, replaceColor, rotate90, scaleNearest,
  snapAngle, stamp, type Bitmap,
} from '../src/core/bitmap';
import {
  addFrame, addLayer, addTag, composite, createDoc, cropCanvas, duplicateFrame, mergeDown, mirrorFrames, moveFrame, moveLayer, parseDoc,
  removeFrame, removeLayer, resizeCanvas, scaleDoc, serializeDoc, tagAt, translateBitmap, usedColors, type SpriteDoc,
} from '../src/core/sprite';
import type { RGBA } from '../src/core/color';

const RED: RGBA = [255, 0, 0, 255], BLUE: RGBA = [0, 0, 255, 255];
const count = (b: Bitmap) => { let n = 0; for (let i = 3; i < b.px.length; i += 4) if (b.px[i]) n++; return n; };
const sum = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

describe('drawing', () => {
  it('the brush covers size × size pixels', () => {
    const b = newBitmap(10, 10);
    stamp(b, 5, 5, 3, RED);
    expect(count(b)).toBe(9);
    expect(getPixel(b, 4, 4)).toEqual(RED);
    expect(getPixel(b, 7, 7)[3]).toBe(0);
  });

  it('lines have no gaps', () => {
    const b = newBitmap(10, 10);
    drawLine(b, 0, 0, 9, 3, 1, RED);
    expect(count(b)).toBe(10);
  });

  it('rectangles: outline or filled, either corner order', () => {
    const b = newBitmap(10, 10);
    drawRect(b, boxOf(6, 6, 1, 1), false, 1, RED);
    expect(count(b)).toBe(20);
    const f = newBitmap(10, 10);
    drawRect(f, boxOf(1, 1, 6, 6), true, 1, RED);
    expect(count(f)).toBe(36);
  });

  it('ellipses: symmetric, filled inside the outline, touching every side of the box', () => {
    const f = newBitmap(9, 9);
    drawEllipse(f, boxOf(0, 0, 8, 8), true, 1, RED);
    const o = newBitmap(9, 9);
    drawEllipse(o, boxOf(0, 0, 8, 8), false, 1, RED);
    expect(getPixel(f, 4, 4)).toEqual(RED);
    expect(getPixel(o, 4, 4)[3]).toBe(0);
    for (const [x, y] of [[4, 0], [4, 8], [0, 4], [8, 4]]) expect(getPixel(o, x, y)).toEqual(RED);
    expect(getPixel(o, 0, 0)[3]).toBe(0);
    for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) expect(getPixel(o, x, y)[3]).toBe(getPixel(o, 8 - x, y)[3]);
    expect(count(o)).toBeLessThan(count(f));
    // a thicker outline covers more
    const t = newBitmap(9, 9);
    drawEllipse(t, boxOf(0, 0, 8, 8), false, 2, RED);
    expect(count(t)).toBeGreaterThan(count(o));
    // tiny boxes still draw
    const one = newBitmap(3, 3);
    drawEllipse(one, boxOf(1, 1, 1, 1), false, 1, RED);
    expect(count(one)).toBe(1);
  });

  it('replace color changes every pixel of that color only', () => {
    const b = newBitmap(4, 1);
    b.px.set(RED, 0); b.px.set(BLUE, 4); b.px.set(RED, 12);
    expect(replaceColor(b, RED, BLUE)).toBe(2);
    expect(getPixel(b, 3, 0)).toEqual(BLUE);
    expect(replaceColor(b, BLUE, BLUE)).toBe(0);
    expect(replaceColor(b, [0, 0, 0, 0], RED)).toBe(1);
    expect(getPixel(b, 2, 0)).toEqual(RED);
  });

  it('a selection limits drawing', () => {
    const b = newBitmap(10, 10);
    drawRect(b, boxOf(0, 0, 9, 9), true, 1, RED, rectMask(10, 10, { x: 0, y: 0, w: 5, h: 10 }));
    expect(count(b)).toBe(50);
  });
});

describe('symmetry, tile mode, lines', () => {
  it('mirrors land on the other side of the center', () => {
    const b = newBitmap(5, 4);
    plot(b, 0, 0, RED, { symX: true, symY: true });
    expect([getPixel(b, 0, 0), getPixel(b, 4, 0), getPixel(b, 0, 3), getPixel(b, 4, 3)].every((c) => c[3] === 255)).toBe(true);
    expect(count(b)).toBe(4);
  });

  it('a mirrored brush stays symmetric', () => {
    const b = newBitmap(8, 8);
    stamp(b, 1, 1, 2, RED, { symX: true });
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(getPixel(b, x, y)[3]).toBe(getPixel(b, 7 - x, y)[3]);
  });

  it('symmetry still respects the selection', () => {
    const b = newBitmap(4, 1);
    plot(b, 0, 0, RED, { symX: true, mask: rectMask(4, 1, { x: 0, y: 0, w: 2, h: 1 }) });
    expect(count(b)).toBe(1);
  });

  it('tile mode wraps strokes around the edges', () => {
    const b = newBitmap(4, 4);
    drawLine(b, 2, 1, 5, 1, 1, RED, { wrap: true });
    expect([0, 1, 2, 3].map((x) => getPixel(b, x, 1)[3])).toEqual([255, 255, 255, 255]);
    plot(b, -1, -1, BLUE, { wrap: true });
    expect(getPixel(b, 3, 3)).toEqual(BLUE);
  });

  it('Shift snaps lines to straight or 45°', () => {
    expect(snapAngle(0, 0, 9, 2)).toEqual([9, 0]);
    expect(snapAngle(0, 0, 1, 8)).toEqual([0, 8]);
    expect(snapAngle(0, 0, 5, -4)).toEqual([5, -5]);
  });

  it('pixel perfect drops the corners of L shapes', () => {
    expect(isLCorner([0, 0], [1, 0], [1, 1])).toBe(true);
    expect(isLCorner([0, 0], [1, 0], [2, 0])).toBe(false);
    // a staircase drawn by hand: right, down, right, down
    const path: [number, number][] = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [2, 2]];
    expect(pixelPerfect(path)).toEqual([[0, 0], [1, 1], [2, 2]]);
    // straight lines are untouched
    expect(pixelPerfect([[0, 0], [1, 0], [2, 0]])).toHaveLength(3);
  });
});

describe('rotate and outline', () => {
  it('a quarter turn swaps the size and moves the corners', () => {
    const b = newBitmap(3, 2);
    b.px.set(RED, 0);              // top left
    const cw = rotate90(b, true);
    expect([cw.w, cw.h]).toEqual([2, 3]);
    expect(getPixel(cw, 1, 0)).toEqual(RED); // top right
    const ccw = rotate90(b, false);
    expect(getPixel(ccw, 0, 2)).toEqual(RED); // bottom left
    expect([...rotate90(rotate90(cw, false), true).px]).toEqual([...cw.px]);
  });

  it('outline paints the empty pixels around the art', () => {
    const b = newBitmap(5, 5);
    plot(b, 2, 2, RED);
    expect(outline(b, BLUE, false)).toBe(4);
    expect(getPixel(b, 2, 1)).toEqual(BLUE);
    expect(getPixel(b, 1, 1)[3]).toBe(0);
    const c = newBitmap(5, 5);
    plot(c, 2, 2, RED);
    expect(outline(c, BLUE, true)).toBe(8);
    expect(getPixel(c, 2, 2)).toEqual(RED);
  });

  it('with a selection only the selected art gets an outline', () => {
    const b = newBitmap(7, 3);
    plot(b, 1, 1, RED);
    plot(b, 5, 1, RED);
    outline(b, BLUE, false, rectMask(7, 3, { x: 0, y: 0, w: 3, h: 3 }));
    expect(getPixel(b, 1, 0)).toEqual(BLUE);
    expect(getPixel(b, 5, 0)[3]).toBe(0);
  });
});

describe('fill and select by color', () => {
  // a red ring with a hole in the middle, on transparent
  const ring = () => { const b = newBitmap(7, 7); drawRect(b, boxOf(1, 1, 5, 5), false, 1, RED); return b; };

  it('the bucket stops at other colors', () => {
    const b = ring();
    expect(fill(b, 3, 3, BLUE, true)).toBe(true);
    expect(getPixel(b, 3, 3)).toEqual(BLUE);
    expect(getPixel(b, 0, 0)[3]).toBe(0);
    expect(fill(b, 3, 3, BLUE, true)).toBe(false);
  });

  it('non-contiguous fill changes every pixel of that color', () => {
    const b = ring();
    fill(b, 0, 0, BLUE, false);
    expect(getPixel(b, 3, 3)).toEqual(BLUE);
    expect(getPixel(b, 6, 6)).toEqual(BLUE);
  });

  it('select by color, connected or everywhere', () => {
    const b = ring();
    expect(sum(colorMask(b, 1, 1, true))).toBe(16);
    expect(sum(colorMask(b, 0, 0, true))).toBe(24);
    expect(sum(colorMask(b, 0, 0, false))).toBe(33);
  });

  it('mask math', () => {
    const a = rectMask(4, 4, { x: 0, y: 0, w: 2, h: 4 });
    const b = rectMask(4, 4, { x: 0, y: 0, w: 4, h: 1 });
    expect(sum(combineMasks(a, b, 'add'))).toBe(10);
    expect(sum(combineMasks(a, b, 'subtract'))).toBe(6);
    expect(maskBounds(combineMasks(a, b, 'add'), 4)).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    expect(maskBounds(new Uint8Array(16), 4)).toBeNull();
  });
});

describe('floating pieces', () => {
  it('cut and paste moves the pixels', () => {
    const b = newBitmap(8, 8);
    drawRect(b, boxOf(1, 1, 2, 2), true, 1, RED);
    const m = rectMask(8, 8, { x: 0, y: 0, w: 4, h: 4 });
    const { piece, box } = extract(b, m)!;
    expect(box).toEqual({ x: 0, y: 0, w: 4, h: 4 });
    clearMasked(b, m);
    expect(count(b)).toBe(0);
    blit(b, piece, 4, 4);
    expect(getPixel(b, 5, 5)).toEqual(RED);
    expect(count(b)).toBe(4);
  });

  it('scaling is nearest neighbor and flips', () => {
    const b = newBitmap(2, 1);
    b.px.set(RED, 0);
    b.px.set(BLUE, 4);
    const big = scaleNearest(b, 4, 2);
    expect(getPixel(big, 1, 1)).toEqual(RED);
    expect(getPixel(big, 2, 0)).toEqual(BLUE);
    expect(getPixel(flip(b, true), 0, 0)).toEqual(BLUE);
    const small = scaleNearest(big, 2, 1);
    expect([...small.px]).toEqual([...b.px]);
  });

  it('the footprint of a floating piece only counts opaque pixels', () => {
    const p = newBitmap(2, 2);
    p.px.set(RED, 0);
    expect(sum(floatingMask(4, 4, { src: p, x: 1, y: 1, w: 4, h: 4 }))).toBe(4);
  });
});

describe('sprite document', () => {
  it('layers and frames stay in step', () => {
    const d = createDoc(4, 4);
    addLayer(d, 1);
    addFrame(d, 1);
    expect(d.frames.every((f) => f.cels.length === 2)).toBe(true);
    stamp(d.frames[0].cels[1], 0, 0, 1, RED);
    moveLayer(d, 1, 0);
    expect(getPixel(d.frames[0].cels[0], 0, 0)).toEqual(RED);
    expect(removeLayer(d, 0)).toBe(true);
    expect(removeLayer(d, 0)).toBe(false);
  });

  it('composite draws upper layers on top and skips hidden ones', () => {
    const d = createDoc(2, 1);
    addLayer(d, 1);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    stamp(d.frames[0].cels[1], 0, 0, 1, BLUE);
    expect([...composite(d, 0).slice(0, 4)]).toEqual(BLUE);
    d.layers[1].visible = false;
    expect([...composite(d, 0).slice(0, 4)]).toEqual(RED);
    d.layers[1].visible = true;
    d.layers[1].opacity = 0.5;
    const half = composite(d, 0);
    expect(half[0]).toBeGreaterThan(120);
    expect(half[2]).toBeGreaterThan(120);
  });

  it('merge down keeps what was visible', () => {
    const d = createDoc(2, 1);
    addLayer(d, 1);
    stamp(d.frames[0].cels[1], 1, 0, 1, BLUE);
    const before = composite(d, 0);
    mergeDown(d, 1);
    expect(d.layers).toHaveLength(1);
    expect([...composite(d, 0)]).toEqual([...before]);
  });

  it('frames reorder and duplicate', () => {
    const d = createDoc(2, 2);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    duplicateFrame(d, 0);
    addFrame(d, 0);
    expect(d.frames).toHaveLength(3);
    moveFrame(d, 0, 2);
    expect(getPixel(d.frames[0].cels[0], 0, 0)).toEqual(RED);
    expect(getPixel(d.frames[2].cels[0], 0, 0)[3]).toBe(0);
  });

  it('canvas resize keeps the art centered', () => {
    const d = createDoc(2, 2);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    resizeCanvas(d, 4, 4);
    expect(getPixel(d.frames[0].cels[0], 1, 1)).toEqual(RED);
    resizeCanvas(d, 1, 1, 0, 0);
    expect(getPixel(d.frames[0].cels[0], 0, 0)[3]).toBe(0);
  });

  it('crop canvas keeps pixel size and can grow on any side', () => {
    const d = createDoc(2, 2);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    cropCanvas(d, -3, -1, 6, 4);
    expect([d.w, d.h]).toEqual([6, 4]);
    expect(getPixel(d.frames[0].cels[0], 3, 1)).toEqual(RED);
    cropCanvas(d, 3, 1, 1, 1);
    expect(getPixel(d.frames[0].cels[0], 0, 0)).toEqual(RED);
  });

  it('scale doc stretches every frame and layer', () => {
    const d = createDoc(2, 1);
    addLayer(d, 1);
    addFrame(d, 1);
    stamp(d.frames[1].cels[1], 1, 0, 1, BLUE);
    scaleDoc(d, 4, 2);
    expect([d.w, d.h]).toEqual([4, 2]);
    expect(d.frames.every((f) => f.cels.every((c) => c.w === 4 && c.h === 2))).toBe(true);
    expect(getPixel(d.frames[1].cels[1], 3, 1)).toEqual(BLUE);
    expect(getPixel(d.frames[1].cels[1], 1, 1)[3]).toBe(0);
  });

  it('reference layers show while drawing but not in exports or colors in use', () => {
    const d = createDoc(2, 1);
    addLayer(d, 1);
    d.layers[1].ref = true;
    stamp(d.frames[0].cels[1], 0, 0, 1, BLUE);
    expect([...composite(d, 0).slice(0, 4)]).toEqual(BLUE);
    expect(composite(d, 0, null, { refs: false })[3]).toBe(0);
    expect(usedColors(d)).toEqual([]);
    expect(parseDoc(serializeDoc(d))!.layers[1].ref).toBe(true);
    expect(parseDoc(serializeDoc(d))!.layers[0].ref).toBeUndefined();
  });

  it('tags follow their frames', () => {
    const d = createDoc(2, 2);
    for (let i = 0; i < 5; i++) addFrame(d, d.frames.length);   // 6 frames
    const t = addTag(d, 1, 3, 'walk');
    const span = () => [t.from, t.to];
    addFrame(d, 0); expect(span()).toEqual([2, 4]);              // before: shifts
    addFrame(d, 3); expect(span()).toEqual([2, 5]);              // inside: grows
    addFrame(d, 6); expect(span()).toEqual([2, 5]);              // right after: unchanged
    duplicateFrame(d, 5); expect(span()).toEqual([2, 6]);        // copy of its last frame joins it
    removeFrame(d, 2); expect(span()).toEqual([2, 5]);
    expect(tagAt(d, 4)?.name).toBe('walk');
    expect(tagAt(d, 0)).toBeNull();
  });

  it('a tag disappears with its last frame, and moves with its frames', () => {
    const d = createDoc(2, 2);
    for (let i = 0; i < 3; i++) addFrame(d, d.frames.length);   // 4 frames
    addTag(d, 3, 3, 'one');
    moveFrame(d, 3, 0);
    expect([d.tags[0].from, d.tags[0].to]).toEqual([0, 0]);
    moveFrame(d, 1, 3);                                          // another frame moving past it does not change it
    expect([d.tags[0].from, d.tags[0].to]).toEqual([0, 0]);
    removeFrame(d, 0);
    expect(d.tags).toHaveLength(0);
  });

  it('mirror adds flipped copies, with their own tag', () => {
    const d = createDoc(3, 1);
    addFrame(d, 1);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    stamp(d.frames[1].cels[0], 1, 0, 1, BLUE);
    addTag(d, 0, 1, 'walk');
    expect(mirrorFrames(d, 0, 1)).toEqual([2, 3]);
    expect(getPixel(d.frames[2].cels[0], 2, 0)).toEqual(RED);
    expect(getPixel(d.frames[3].cels[0], 1, 0)).toEqual(BLUE);
    expect(d.tags.map((t) => [t.name, t.from, t.to])).toEqual([['walk', 0, 1], ['walk mirrored', 2, 3]]);
  });

  it('translate moves a cel and cuts what leaves the canvas', () => {
    const b = newBitmap(3, 3);
    plot(b, 0, 0, RED);
    plot(b, 2, 2, BLUE);
    const m = translateBitmap(b, 1, 1);
    expect(getPixel(m, 1, 1)).toEqual(RED);
    expect(count(m)).toBe(1);
  });

  it('tags are saved, and broken ones are dropped on load', () => {
    const d: SpriteDoc = createDoc(2, 2);
    addFrame(d, 1);
    addTag(d, 0, 1, 'idle').dir = 'pingpong';
    const back = parseDoc(serializeDoc(d))!;
    expect(back.tags).toEqual([{ name: 'idle', from: 0, to: 1, dir: 'pingpong', color: d.tags[0].color }]);
    const raw = JSON.parse(serializeDoc(d));
    raw.tags.push({ name: 'bad', from: 5, to: 9 });
    expect(parseDoc(JSON.stringify(raw))!.tags).toHaveLength(1);
    delete raw.tags;
    expect(parseDoc(JSON.stringify(raw))!.tags).toEqual([]);
  });

  it('colors in use and saving round trip', () => {
    const d = createDoc(3, 3);
    addLayer(d, 1);
    addFrame(d, 1);
    stamp(d.frames[1].cels[1], 1, 1, 3, BLUE);
    stamp(d.frames[0].cels[0], 0, 0, 1, RED);
    d.layers[1].opacity = 0.4;
    expect(usedColors(d)).toEqual([0x0000ff, 0xff0000]);
    const back = parseDoc(serializeDoc(d))!;
    expect(back.layers).toEqual(d.layers);
    expect([...back.frames[1].cels[1].px]).toEqual([...d.frames[1].cels[1].px]);
    expect(parseDoc('nope')).toBeNull();
  });
});
