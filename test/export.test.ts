import { describe, expect, it } from 'vitest';
import { encodeGif } from '../src/export/gif';
import { crc32, makeZip } from '../src/export/zip';
import { nextIndex, playbackSequence, type Direction } from '../src/core/frames';
import { makeRng } from '../src/core/fake';
import { decodeGif } from './helpers';

function randomFrames(count: number, w: number, h: number, colors: number, seed: number, withAlpha = false) {
  const rng = makeRng(seed);
  const pal = [...Array(colors)].map((_, i) => [(i * 53) % 256, (i * 97) % 256, (i * 29) % 256]);
  return [...Array(count)].map(() => {
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      if (withAlpha && rng() < 0.2) continue;
      const c = pal[Math.floor(rng() * colors)];
      d.set([c[0], c[1], c[2], 255], i * 4);
    }
    return d;
  });
}

// Every decoded pixel must match its source pixel (or be the transparent index).
function mismatches(frames: Uint8ClampedArray[], w: number, scale: number, gif: ReturnType<typeof decodeGif>) {
  let bad = 0;
  gif.frames.forEach((f, k) => {
    const d = frames[k];
    for (let y = 0; y < gif.height; y++) for (let x = 0; x < gif.width; x++) {
      const ix = f.indices[y * gif.width + x];
      const i = (Math.floor(y / scale) * w + Math.floor(x / scale)) * 4;
      if (d[i + 3] < 128) { if (ix !== f.transparent) bad++; continue; }
      const c = gif.table[ix];
      if (c[0] !== d[i] || c[1] !== d[i + 1] || c[2] !== d[i + 2]) bad++;
    }
  });
  return bad;
}

describe('gif', () => {
  it('round-trips small transparent frames with delays and looping', () => {
    const frames = randomFrames(4, 10, 14, 6, 1, true);
    const gif = decodeGif(encodeGif(frames, 10, 14, 4, [13, 38, 13, 13], true));
    expect([gif.width, gif.height, gif.frames.length, gif.loop]).toEqual([40, 56, 4, true]);
    expect(gif.frames.map((f) => f.delay)).toEqual([13, 38, 13, 13]);
    expect(gif.frames.every((f) => f.disposal === 2 && f.transparent === 0)).toBe(true);
    expect(mismatches(frames, 10, 4, gif)).toBe(0);
  });

  it('plays once when not looping', () => {
    expect(decodeGif(encodeGif(randomFrames(2, 4, 4, 3, 2), 4, 4, 1, [10, 10], false)).loop).toBe(false);
  });

  it('survives full LZW tables (code size 12 and resets)', () => {
    const frames = randomFrames(3, 200, 200, 200, 7);
    const gif = decodeGif(encodeGif(frames, 200, 200, 1, [10, 10, 10], true));
    expect(gif.frames.map((f) => f.indices.length)).toEqual([40000, 40000, 40000]);
    expect(mismatches(frames, 200, 1, gif)).toBe(0);
  });
});

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('writes a directory that points at every stored file', () => {
    const files = [{ name: 'a.png', data: new Uint8Array([1, 2, 3]) }, { name: 'frames/b.png', data: new Uint8Array([4, 5]) }];
    const z = makeZip(files);
    const dv = new DataView(z.buffer);
    const end = z.length - 22;
    expect(dv.getUint32(end, true)).toBe(0x06054b50);
    expect(dv.getUint16(end + 10, true)).toBe(2);
    let cd = dv.getUint32(end + 16, true);
    for (const f of files) {
      expect(dv.getUint32(cd, true)).toBe(0x02014b50);
      const local = dv.getUint32(cd + 42, true), nameLen = dv.getUint16(cd + 28, true);
      expect(dv.getUint32(local, true)).toBe(0x04034b50);
      expect(new TextDecoder().decode(z.slice(local + 30, local + 30 + nameLen))).toBe(f.name);
      expect([...z.slice(local + 30 + nameLen, local + 30 + nameLen + f.data.length)]).toEqual([...f.data]);
      expect(dv.getUint32(cd + 16, true)).toBe(crc32(f.data));
      cd += 46 + nameLen;
    }
  });
});

describe('playback', () => {
  const play = (dir: Direction, once: boolean, start: number, steps: number) => {
    let i = start, ping = 1;
    const out = [i + 1];
    for (let k = 0; k < steps; k++) {
      const r = nextIndex(i, 4, dir, once, ping);
      ping = r.pingDir;
      if (r.next === null) { out.push(0); break; }
      i = r.next;
      out.push(i + 1);
    }
    return out.join('');
  };
  it('steps in every direction, looping or stopping', () => {
    expect(play('forward', false, 0, 9)).toBe('1234123412');
    expect(play('forward', true, 0, 9)).toBe('12340');
    expect(play('reverse', false, 3, 9)).toBe('4321432143');
    expect(play('reverse', true, 3, 9)).toBe('43210');
    expect(play('pingpong', false, 0, 12)).toBe('1234321234321');
    expect(play('pingpong', true, 0, 12)).toBe('12343210');
  });
  it('bakes one cycle for export', () => {
    expect(playbackSequence([0, 1, 2, 3], 'pingpong', false)).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playbackSequence([0, 1, 2, 3], 'pingpong', true)).toEqual([0, 1, 2, 3, 2, 1, 0]);
    expect(playbackSequence([0, 1, 2], 'reverse', false)).toEqual([2, 1, 0]);
  });
});
