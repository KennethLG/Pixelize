import { describe, expect, it } from 'vitest';
import { getPixel, newBitmap, type Bitmap } from '../src/core/bitmap';
import type { RGBA } from '../src/core/color';
import {
  bakePart, freeFrame, jointOf, makePart, parentChoices, poseOf, setParent, setPivot, setPose, shiftPoses, syncParts, toRest,
} from '../src/core/parts';
import {
  addLayer, cloneDoc, createDoc, duplicateFrame, duplicateLayer, parseDoc, removeLayer, resizeCanvas, serializeDoc, type SpriteDoc,
} from '../src/core/sprite';

const RED: RGBA = [255, 0, 0, 255], BLUE: RGBA = [0, 0, 255, 255];
const count = (b: Bitmap) => { let n = 0; for (let i = 3; i < b.px.length; i += 4) if (b.px[i]) n++; return n; };
const put = (b: Bitmap, x: number, y: number, c: RGBA) => b.px.set(c, (y * b.w + x) * 4);

/** A 20 × 20 sprite: layer 0 an upper arm (x 10, y 2–7), layer 1 a forearm (x 10, y 8–12). */
function arm(): SpriteDoc {
  const d = createDoc(20, 20);
  addLayer(d, 1);
  for (let y = 2; y <= 7; y++) put(d.frames[0].cels[0], 10, y, RED);
  for (let y = 8; y <= 12; y++) put(d.frames[0].cels[1], 10, y, BLUE);
  return d;
}

describe('parts', () => {
  it('making a part keeps the pixels and puts the frame in the rest pose', () => {
    const d = arm();
    const before = d.frames[0].cels[0].px.slice();
    const p = makePart(d, 0, 0);
    expect(p.pivot).toEqual([10.5, 5]);
    expect(poseOf(d, 0, 0)).toEqual({ x: 0, y: 0, angle: 0 });
    expect([...d.frames[0].cels[0].px]).toEqual([...before]);
  });

  it('a pose turns the part around its pivot and children follow', () => {
    const d = arm();
    const upper = makePart(d, 0, 0);
    makePart(d, 1, 0);
    setPivot(d, 0, [10.5, 2.5]);       // the shoulder
    setPivot(d, 1, [10.5, 8.5]);       // the elbow
    expect(setParent(d, 1, upper.id)).toBe(true);
    expect(parentChoices(d, 0)).toEqual([]);   // the forearm hangs from it: no loops
    duplicateFrame(d, 0);
    setPose(d, 1, 0, { x: 0, y: 0, angle: 90 });
    // the upper arm now points left from the shoulder
    const c = d.frames[1].cels[0];
    expect(count(c)).toBe(6);
    expect(getPixel(c, 5, 2)).toEqual(RED);
    // the elbow followed: it is to the left of the shoulder, and the forearm with it
    const elbow = jointOf(d, 1, 1);
    expect(elbow.x).toBeCloseTo(4.5);
    expect(elbow.y).toBeCloseTo(2.5);
    expect(elbow.angle).toBe(90);
    expect(getPixel(d.frames[1].cels[1], 10, 10)[3]).toBe(0);
    expect(count(d.frames[1].cels[1])).toBe(5);
    // the first frame did not move
    expect(getPixel(d.frames[0].cels[0], 10, 5)).toEqual(RED);
  });

  it('painting in the rest pose changes every posed frame', () => {
    const d = arm();
    makePart(d, 0, 0);
    setPivot(d, 0, [10.5, 2]);
    duplicateFrame(d, 0);
    setPose(d, 1, 0, { x: 3, y: 0, angle: 0 });
    put(d.frames[0].cels[0], 11, 7, RED);
    expect(syncParts(d)).toBe(true);
    expect(getPixel(d.frames[1].cels[0], 14, 7)).toEqual(RED);
    expect(syncParts(d)).toBe(false);
  });

  it('painting on a moved pose frees that frame only', () => {
    const d = arm();
    makePart(d, 0, 0);
    duplicateFrame(d, 0);
    setPose(d, 1, 0, { x: 2, y: 0, angle: 0 });
    put(d.frames[1].cels[0], 0, 0, BLUE);
    syncParts(d);
    expect(poseOf(d, 1, 0)).toBeUndefined();
    expect(getPixel(d.frames[1].cels[0], 0, 0)).toEqual(BLUE);
    expect(poseOf(d, 0, 0)).toBeDefined();
  });

  it('moving the pivot or the parent leaves the art in place', () => {
    const d = arm();
    const upper = makePart(d, 0, 0);
    makePart(d, 1, 0);
    duplicateFrame(d, 0);
    setPose(d, 1, 0, { x: 0, y: 0, angle: 30 });
    const j = jointOf(d, 1, 0), rest = toRest(d, 1, 0, j.x, j.y);
    expect(rest[0]).toBeCloseTo(10.5);
    setPivot(d, 0, [10.5, 2]);
    const point = toRest(d, 1, 0, j.x, j.y);
    expect(point[0]).toBeCloseTo(10.5);
    expect(point[1]).toBeCloseTo(5);
    setParent(d, 1, upper.id);
    expect(jointOf(d, 1, 1).angle % 360).toBeCloseTo(0);
    expect(poseOf(d, 1, 1)!.angle).toBeCloseTo(330);
  });

  it('baking or removing a part keeps the pixels and the children in place', () => {
    const d = arm();
    const upper = makePart(d, 0, 0);
    makePart(d, 1, 0);
    setParent(d, 1, upper.id);
    duplicateFrame(d, 0);
    setPose(d, 1, 0, { x: 0, y: 0, angle: 45 });
    const before = jointOf(d, 1, 1);
    bakePart(d, 0);
    expect(d.layers[0].part).toBeUndefined();
    expect(d.layers[1].part!.parent).toBeNull();
    const after = jointOf(d, 1, 1);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.angle).toBeCloseTo(45);
    removeLayer(d, 1);
    expect(d.frames[1].poses ?? {}).toEqual({});
  });

  it('frees a frame and shifts poses', () => {
    const d = arm();
    makePart(d, 0, 0);
    shiftPoses(d, 0, 2, 1);
    expect(getPixel(d.frames[0].cels[0], 12, 3)).toEqual(RED);
    freeFrame(d, 0, 0);
    expect(poseOf(d, 0, 0)).toBeUndefined();
  });

  it('survives cloning, duplicating layers, canvas changes and saving', () => {
    const d = arm();
    const upper = makePart(d, 0, 0);
    makePart(d, 1, 0);
    setParent(d, 1, upper.id);
    setPose(d, 0, 0, { x: 1, y: 0, angle: 15 });
    const c = cloneDoc(d);
    expect(c.layers[0].part!.src).not.toBe(d.layers[0].part!.src);
    expect(c.frames[0].poses).toEqual(d.frames[0].poses);
    duplicateLayer(c, 0);
    expect(c.layers[1].part!.id).not.toBe(upper.id);
    expect(c.frames[0].poses![c.layers[1].part!.id]).toEqual(c.frames[0].poses![upper.id]);
    resizeCanvas(c, 24, 24);
    expect(c.layers[0].part!.pivot).toEqual([12.5, 7]);
    const back = parseDoc(serializeDoc(d))!;
    expect(back.layers[1].part).toMatchObject({ parent: upper.id, pivot: d.layers[1].part!.pivot });
    expect(back.frames[0].poses).toEqual(d.frames[0].poses);
    expect([...back.layers[0].part!.src.px]).toEqual([...d.layers[0].part!.src.px]);
    // older files without parts still open
    const old = JSON.parse(serializeDoc(createDoc(4, 4)));
    expect(parseDoc(JSON.stringify(old))!.layers[0].part).toBeUndefined();
    expect(newBitmap(1, 1).w).toBe(1);
  });
});
