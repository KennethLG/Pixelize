// Frames: thumbnails (click to edit, drag to reorder), frame buttons and
// durations, and the animated preview.

import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { DEFAULT_DURATION, addFrame, composite, duplicateFrame, moveFrame, removeFrame } from '../../../core/sprite';
import { useSp } from '../hooks';
import { emit, pushDoc, setFrame, sp, versions } from '../state';
import { NumberField } from '../../components/common';
import { useReorder } from '../../components/useReorder';

function paint(c: HTMLCanvasElement, fi: number): void {
  const { w, h } = sp.doc;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext('2d')!.putImageData(new ImageData(composite(sp.doc, fi), w, h), 0, 0);
}

/** One frame's picture. `stamp` changes whenever the frame needs repainting. */
const Thumb = memo(function Thumb(props: { index: number; stamp: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => { if (props.index < sp.doc.frames.length) paint(ref.current!, props.index); }, [props.index, props.stamp]);
  return <canvas ref={ref} />;
});

function moveTo(from: number, to: number): void {
  if (to < 0 || to >= sp.doc.frames.length || from === to) return;
  pushDoc();
  moveFrame(sp.doc, from, to);
  sp.frame = to;
  emit('structure', 'cursor', 'pixels');
}

function newFrame(copy: boolean): void {
  pushDoc();
  if (copy) duplicateFrame(sp.doc, sp.frame);
  else addFrame(sp.doc, sp.frame + 1);
  sp.frame++;
  emit('structure', 'cursor', 'pixels');
}

export const togglePlay = () => { sp.playing = !sp.playing && sp.doc.frames.length > 1; emit('playback'); };

function Preview() {
  useSp('playback', 'cursor', 'pixels', 'structure');
  const ref = useRef<HTMLCanvasElement>(null);
  const playing = sp.playing && sp.doc.frames.length > 1;
  useLayoutEffect(() => { if (!playing) paint(ref.current!, Math.min(sp.frame, sp.doc.frames.length - 1)); });
  useEffect(() => {
    if (!playing) return;
    let i = sp.frame, last = performance.now(), raf = 0;
    paint(ref.current!, i);
    const tick = (t: number) => {
      const frames = sp.doc.frames;
      if (i >= frames.length) i = 0;
      if (t - last >= frames[i].duration) { last = t; i = (i + 1) % frames.length; paint(ref.current!, i); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
  return (
    <div className="sp-preview">
      <div className="stage"><canvas id="spPreview" ref={ref} aria-label="Animation preview" /></div>
      <button type="button" className="ghost small" title="Play or pause (P)" onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
    </div>
  );
}

export function Timeline() {
  useSp('structure', 'cursor', 'pixels');
  const strip = useRef<HTMLDivElement>(null);
  const { itemProps, marks } = useReorder('x', (from, over, before) => {
    let to = before ? over : over + 1;
    if (from < to) to--;
    moveTo(from, to);
  });
  const frames = sp.doc.frames, n = frames.length;
  // the current frame repaints on every stroke, the others only when the document changes
  const doc = `${versions.get('structure') || 0}.${sp.doc.w}x${sp.doc.h}`, px = versions.get('pixels') || 0;

  // scroll the strip (never the page) so the current frame shows
  useEffect(() => {
    const box = strip.current, el = box?.querySelector<HTMLElement>('.sel');
    if (!box || !el) return;
    const l = el.offsetLeft;
    if (l < box.scrollLeft) box.scrollLeft = l;
    else if (l + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = l + el.offsetWidth - box.clientWidth;
  }, [sp.frame, n]);

  return (
    <div className="panel sp-timeline">
      <Preview />
      <div className="sp-frames-col">
        <div className="frames sp-frames" id="spFrames" ref={strip} title="Drag frames to reorder them. , and . go to the previous and next frame, P plays.">
          {frames.map((f, i) => (
            <div
              key={i}
              className={'frame sp-frame' + (i === sp.frame ? ' sel' : '') + marks(i)}
              tabIndex={0}
              title={`Frame ${i + 1} · ${f.duration} ms`}
              onClick={() => setFrame(i)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFrame(i); } }}
              {...itemProps(i)}
            >
              <Thumb index={i} stamp={i === sp.frame ? `${doc}.${px}` : doc} />
              <span>{i + 1}</span>
            </div>
          ))}
        </div>
        <div className="row sel-row">
          <span className="frame-info">{`Frame ${sp.frame + 1} of ${n}`}</span>
          <button type="button" className="ghost small" title="New empty frame" onClick={() => newFrame(false)}>+ Frame</button>
          <button type="button" className="ghost small" title="Copy of this frame" onClick={() => newFrame(true)}>Duplicate</button>
          <button type="button" className="ghost small" aria-label="Move frame earlier" disabled={sp.frame < 1} onClick={() => moveTo(sp.frame, sp.frame - 1)}>◀</button>
          <button type="button" className="ghost small" aria-label="Move frame later" disabled={sp.frame >= n - 1} onClick={() => moveTo(sp.frame, sp.frame + 1)}>▶</button>
          <button
            type="button"
            className="ghost small"
            title="Delete this frame"
            disabled={n < 2}
            onClick={() => { pushDoc(); if (removeFrame(sp.doc, sp.frame)) { sp.frame = Math.min(sp.frame, sp.doc.frames.length - 1); emit('structure', 'cursor', 'pixels'); } }}
          >Delete</button>
          <span className="muted">Duration</span>
          <NumberField
            value={frames[sp.frame].duration}
            min={10}
            max={10000}
            step={10}
            label="Frame duration in ms"
            onCommit={(v) => { const d = Math.round(v) || DEFAULT_DURATION; if (d === frames[sp.frame].duration) return; pushDoc(); sp.doc.frames[sp.frame].duration = d; emit('structure'); }}
          />
          <span className="muted">ms</span>
          <button
            type="button"
            className="ghost small"
            title="Give every frame this duration"
            onClick={() => { const d = frames[sp.frame].duration; pushDoc(); for (const fr of sp.doc.frames) fr.duration = d; emit('structure'); }}
          >All</button>
        </div>
      </div>
    </div>
  );
}
