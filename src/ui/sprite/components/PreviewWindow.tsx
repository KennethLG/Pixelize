// A floating preview of the animation at game scale (whole pixels), over a
// background: the checkerboard, the paper color, or an image of the game.

import { useLayoutEffect, useRef, useState } from 'react';
import { hex } from '../../../core/color';
import { Seg } from '../../components/common';
import { setStatus } from '../../dom';
import { decodeFile } from '../../input';
import { useSp } from '../hooks';
import { emit, sp } from '../state';
import { paintFrame } from './Timeline';

let bgImage: HTMLImageElement | null = null;

export function PreviewWindow() {
  useSp('view', 'playback', 'playframe', 'cursor', 'pixels', 'structure', 'paper');
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [, setBgVersion] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const frame = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const file = useRef<HTMLInputElement>(null);
  const shown = Math.min(sp.playing ? sp.playFrame : sp.frame, sp.doc.frames.length - 1);
  const s = sp.previewScale, W = sp.doc.w * s, H = sp.doc.h * s;

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, W, H);
    if (sp.previewBg === 'paper') { g.fillStyle = hex(sp.paperColor); g.fillRect(0, 0, W, H); }
    else if (sp.previewBg === 'image' && bgImage) {
      // the background covers the window, like a game screen behind the sprite
      const k = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight);
      const iw = bgImage.naturalWidth * k, ih = bgImage.naturalHeight * k;
      g.drawImage(bgImage, (W - iw) / 2, (H - ih) / 2, iw, ih);
    }
    paintFrame(frame.current, shown);
    g.drawImage(frame.current, 0, 0, W, H);
  });

  if (!sp.previewOpen) return null;

  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - box.left, dy = e.clientY - box.top;
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setPos({ x: Math.max(0, ev.clientX - dx), y: Math.max(0, ev.clientY - dy) });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const set = (patch: Partial<Pick<typeof sp, 'previewScale' | 'previewBg' | 'previewOpen'>>) => { Object.assign(sp, patch); emit('view'); };

  return (
    <div className={sp.previewBg === 'checker' ? 'sp-pwin checker' : 'sp-pwin'} style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined}
      role="dialog" aria-label="Animation preview">
      <div className="sp-pwin-head" onPointerDown={startDrag}>
        <span className="label">Preview · {sp.doc.w * s}×{sp.doc.h * s}</span>
        <button type="button" className="ghost small" aria-label="Close the preview" onPointerDown={(e) => e.stopPropagation()} onClick={() => set({ previewOpen: false })}>×</button>
      </div>
      <div className="sp-pwin-body"><canvas ref={canvas} /></div>
      <div className="sp-pwin-bar">
        <Seg name="spPrevScale" label="Scale" value={String(s)} options={[1, 2, 3, 4, 6].map((v) => ({ value: String(v), label: `${v}×` }))}
          onChange={(v) => set({ previewScale: Number(v) })} />
        <Seg name="spPrevBg" label="Background" value={sp.previewBg}
          options={[{ value: 'checker', label: 'Checker' }, { value: 'paper', label: 'Paper' }, { value: 'image', label: 'Image' }]}
          onChange={(v) => { if (v === 'image' && !bgImage) file.current?.click(); else set({ previewBg: v }); }} />
        <button type="button" className="ghost small" title="Pick a background image (a screenshot of your game works well)" onClick={() => file.current?.click()}>Load bg</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          decodeFile(f).then((img) => { bgImage = img; setBgVersion((n) => n + 1); set({ previewBg: 'image' }); }, (err) => setStatus((err as Error).message, true));
        }} />
      </div>
    </div>
  );
}
