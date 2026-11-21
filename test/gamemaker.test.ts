import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  artBox, evenTiming, fpsFor, gmName, hasSprite, originPoint, parseGm, projectFolders, projectSprites, registerSprite, spriteFiles, spriteMeta, type GmSprite,
} from '../src/export/gamemaker';

const YYP = `{
  "$GMProject":"v1",
  "%Name":"Game",
  "Folders":[
    {"$GMFolder":"","%Name":"Sprites","folderPath":"folders/Sprites.yy","name":"Sprites","resourceType":"GMFolder","resourceVersion":"2.0",},
    {"$GMFolder":"","%Name":"chars","folderPath":"folders/Sprites/chars.yy","name":"chars","resourceType":"GMFolder","resourceVersion":"2.0",},
  ],
  "name":"Game",
  "resources":[
    {"id":{"name":"objPlayer","path":"objects/objPlayer/objPlayer.yy",},},
    {"id":{"name":"sprAlpha","path":"sprites/sprAlpha/sprAlpha.yy",},},
    {"id":{"name":"sprZeta","path":"sprites/sprZeta/sprZeta.yy",},},
  ],
}`;

const px = (w: number, h: number, on: [number, number][]) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of on) a.set([255, 0, 0, 255], (y * w + x) * 4);
  return a;
};

const fakePng = async (p: Uint8ClampedArray, w: number, h: number) => new TextEncoder().encode(`png ${w}x${h} ${p.length}`);

function sprite(over: Partial<GmSprite> = {}): GmSprite {
  const top = px(4, 4, [[1, 1]]), bottom = px(4, 4, [[2, 3]]);
  return {
    name: 'sprTest', w: 4, h: 4, fps: 10, origin: null, folder: { name: 'chars', path: 'folders/Sprites/chars.yy' },
    layers: [{ name: 'Top "one"', visible: true, opacity: 100 }, { name: 'Bottom', visible: false, opacity: 50 }],
    frames: [{ composite: px(4, 4, [[1, 1], [2, 3]]), layers: [top, bottom] }, { composite: px(4, 4, [[0, 0]]), layers: [px(4, 4, [[0, 0]]), px(4, 4, [])] }],
    ...over,
  };
}

describe('gamemaker', () => {
  it('reads JSON with trailing commas, but not commas inside strings', () => {
    expect(parseGm('{"a":[1,2,],"b":"x,}",}')).toEqual({ a: [1, 2], b: 'x,}' });
    expect(projectFolders(YYP).map((f) => f.path)).toEqual(['folders/Sprites.yy', 'folders/Sprites/chars.yy']);
  });

  it('registers a sprite in name order, once', () => {
    const s = registerSprite(YYP, 'sprMid');
    expect(s.indexOf('sprAlpha')).toBeLessThan(s.indexOf('sprMid'));
    expect(s.indexOf('sprMid')).toBeLessThan(s.indexOf('sprZeta'));
    expect(hasSprite(s, 'sprMid')).toBe(true);
    expect(registerSprite(s, 'sprMid')).toBe(s);
    expect(parseGm(registerSprite(YYP, 'zzz')).resources.at(-1).id.name).toBe('zzz');
    expect(registerSprite(YYP.replace(/\n/g, '\r\n'), 'sprMid')).toContain('sprMid","path":"sprites/sprMid/sprMid.yy",},},\r\n');
  });

  it('writes the .yy, one PNG per frame and one per layer and frame', async () => {
    const files = await spriteFiles(sprite(), fakePng);
    const yyFile = files.find((f) => f.path === 'sprites/sprTest/sprTest.yy')!;
    const yy = parseGm(yyFile.data as string);
    expect(yy.frames).toHaveLength(2);
    expect(yy.layers.map((l: any) => [l.displayName, l.visible, l.opacity])).toEqual([['Top "one"', true, 100], ['Bottom', false, 50]]);
    expect(yy.parent).toEqual({ name: 'chars', path: 'folders/Sprites/chars.yy' });
    // new sprites: origin on the feet, box around the art of every frame
    expect([yy.origin, yy.sequence.xorigin, yy.sequence.yorigin]).toEqual([7, 2, 4]);
    expect([yy.bbox_left, yy.bbox_top, yy.bbox_right, yy.bbox_bottom]).toEqual([0, 0, 2, 3]);
    expect(yy.sequence.playbackSpeed).toBe(10);
    expect(yy.sequence.tracks[0].keyframes.Keyframes.map((k: any) => k.Channels['0'].Id.name)).toEqual(yy.frames.map((f: any) => f.name));
    for (const f of yy.frames) {
      expect(files.some((x) => x.path === `sprites/sprTest/${f.name}.png`)).toBe(true);
      for (const l of yy.layers) expect(files.some((x) => x.path === `sprites/sprTest/layers/${f.name}/${l.name}.png`)).toBe(true);
    }
    expect(files).toHaveLength(2 + 2 * 2 + 1);
  });

  it('keeps the settings of the sprite it replaces', async () => {
    const existing = {
      origin: 9, sequence: { xorigin: 3, yorigin: 1 }, collisionKind: 0, bboxMode: 2, bbox_left: 1, bbox_top: 1, bbox_right: 2, bbox_bottom: 2,
      textureGroupId: { name: 'tgChars', path: 'texturegroups/tgChars' }, parent: { name: 'old', path: 'folders/Sprites/old.yy' },
      ConfigValues: { Dev: { textureGroupId: '{ "name":"Default" }' } },
    };
    const yy = parseGm((await spriteFiles(sprite(), fakePng, existing)).at(-1)!.data as string);
    expect([yy.origin, yy.sequence.xorigin, yy.sequence.yorigin]).toEqual([9, 3, 1]);
    expect([yy.bbox_left, yy.bbox_right, yy.collisionKind]).toEqual([1, 2, 0]);
    expect(yy.textureGroupId.name).toBe('tgChars');
    expect(yy.parent.name).toBe('old');
    expect(yy.ConfigValues.Dev.textureGroupId).toBe('{ "name":"Default" }');
    // a preset origin of the old sprite follows the new size
    const yy2 = parseGm((await spriteFiles(sprite(), fakePng, { origin: 4 })).at(-1)!.data as string);
    expect([yy2.sequence.xorigin, yy2.sequence.yorigin]).toEqual([2, 2]);
    // an origin picked in the export wins
    const yy3 = parseGm((await spriteFiles(sprite({ origin: [1, 2] }), fakePng, existing)).at(-1)!.data as string);
    expect([yy3.origin, yy3.sequence.xorigin, yy3.sequence.yorigin]).toEqual([9, 1, 2]);
  });

  it('places origins like GameMaker and finds the art box', () => {
    expect(originPoint('bottom', 19, 24)).toEqual([9, 24]);
    expect(originPoint('center', 1141, 1536)).toEqual([570, 768]);
    expect(originPoint('top-left', 8, 8)).toEqual([0, 0]);
    expect(artBox([px(4, 4, [])], 4, 4)).toBeNull();
  });

  it('turns frame durations into a speed', () => {
    expect(fpsFor([100, 100])).toEqual({ fps: 10, even: true });
    expect(fpsFor([100, 200, 100]).even).toBe(false);
    expect(evenTiming([0, 1, 2], [100, 200, 100])).toEqual({ frames: [0, 1, 1, 2], fps: 10 });
    expect(gmName('my sprite-1')).toBe('my_sprite_1');
    expect(gmName('1abc')).toBe('spr_1abc');
  });

  it('reads a written sprite back', async () => {
    const yy = parseGm((await spriteFiles(sprite({ fps: 12.5 }), fakePng)).at(-1)!.data as string);
    const m = spriteMeta(yy);
    expect([m.name, m.w, m.h, m.frames.length, m.frameMs, m.folder, m.origin]).toEqual(['sprTest', 4, 4, 2, 80, 'Sprites/chars', [2, 4]]);
    expect(m.layers.map((l) => [l.name, l.visible, l.opacity])).toEqual([['Top "one"', true, 100], ['Bottom', false, 50]]);
    // speed per game frame: 0.25 sprite frames each game frame at 60 fps is 15 fps
    expect(spriteMeta({ ...yy, sequence: { ...yy.sequence, playbackSpeed: 0.25, playbackSpeedType: 1 } }, 60).frameMs).toBe(67);
    expect(projectSprites(YYP)).toEqual(['sprAlpha', 'sprZeta']);
  });

  // reads every sprite of the user's game, when it is on this machine
  const GAME = 'C:/Users/User/Desktop/SearchingLightProject';
  it.skipIf(!existsSync(GAME))('parses every sprite of a real project', () => {
    const dir = join(GAME, 'sprites');
    const yyp = readFileSync(join(GAME, 'Searching Light.yyp'), 'utf8');
    for (const n of readdirSync(dir)) {
      // only what the project lists (leftover folders can hold broken files)
      if (!hasSprite(yyp, n)) continue;
      let yy: any;
      try { yy = parseGm(readFileSync(join(dir, n, `${n}.yy`), 'utf8')); } catch (e) { throw new Error(`${n}: ${(e as Error).message}`); }
      // folder names on Windows may differ in case from the asset name
      expect(yy.name.toLowerCase()).toBe(n.toLowerCase());
      const m = spriteMeta(yy, 30);
      expect(m.frames.length).toBeGreaterThan(0);
      expect(m.w).toBeGreaterThan(0);
    }
    expect(projectFolders(yyp).length).toBeGreaterThan(0);
  });
});
