// The timeline: a grid of layers × frames (one cel each), tags above the
// frame numbers, frame and cel buttons, and the small animated preview.

import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { DEFAULT_DURATION, TAG_COLORS, composite, moveFrame, removeFrame } from '../../../core/sprite';
import { NumberField, Seg } from '../../components/common';
import { useReorder } from '../../components/useReorder';
import {
  copyCel, mirrorSelection, newFrame, pasteCel, pickFrame, removeTag, selectTag, selectedFrames, tagSelection, togglePlay, updateTag,
} from '../animation';
import { useSp } from '../hooks';
import { emit, pushDoc, setFrame, setLayer, sp, versions } from '../state';

const CELL = 40; // px per frame column, so tags line up with their frames

/** Draws a frame as it exports (reference layers left out). */
export function paintFrame(c: HTMLCanvasElement, fi: number): void {
  const { w, h } = sp.doc;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext('2d')!.putImageData(new ImageData(composite(sp.doc, fi, null, { refs: false }), w, h), 0, 0);
}

/** One cel's picture. `stamp` changes whenever it needs repainting. */
const CelThumb = memo(function CelThumb(props: { frame: number; layer: number; stamp: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const f = sp.doc.frames[props.frame], cel = f?.cels[props.layer];
    if (!cel) return;
    const c = ref.current!;
    if (c.width !== cel.w || c.height !== cel.h) { c.width = cel.w; c.height = cel.h; }
    c.getContext('2d')!.putImageData(new ImageData(cel.px, cel.w, cel.h), 0, 0);
  }, [props.frame, props.layer, props.stamp]);
  return <canvas ref={ref} />;
});

function moveTo(from: number, to: number): void {
  if (to < 0 || to >= sp.doc.frames.length || from === to) return;
  pushDoc();
  moveFrame(sp.doc, from, to);
  sp.frame = to;
  sp.range = null;
  emit('structure', 'cursor', 'pixels');
}

function Preview() {
  useSp('playback', 'playframe', 'cursor', 'pixels', 'structure', 'view');
  const ref = useRef<HTMLCanvasElement>(null);
  const shown = sp.playing ? sp.playFrame : sp.frame;
  useLayoutEffect(() => { paintFrame(ref.current!, Math.min(shown, sp.doc.frames.length - 1)); });
  return (
    <div className="sp-preview">
      <div className="stage"><canvas id="spPreview" ref={ref} aria-label="Animation preview" /></div>
      <div className="sp-preview-btns">
        <button type="button" className="ghost small" title="Play or pause" onClick={togglePlay}>{sp.playing ? 'Pause' : 'Play'}</button>
        <button type="button" className="ghost small" title="Open a bigger preview, at game scale" aria-pressed={sp.previewOpen}
          onClick={() => { sp.previewOpen = !sp.previewOpen; emit('view'); }}>⤢</button>
      </div>
    </div>
  );
}

function TagEditor() {
  const i = sp.editingTag;
  const t = i === null ? null : sp.doc.tags[i];
  if (i === null || !t) return null;
  return (
    <div className="row sp-tag-editor">
      <span className="tag-chip" style={{ '--c': t.color } as CSSProperties} />
      <input type="text" aria-label="Tag name" defaultValue={t.name} key={`${i}-${t.name}`}
        onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) updateTag(i, { name: v }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      <span className="muted">Frames {t.from + 1}–{t.to + 1}</span>
      <Seg name="spTagDir" label="Tag direction" value={t.dir}
        options={[{ value: 'forward', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }, { value: 'pingpong', label: 'Ping-pong' }]}
        onChange={(dir) => updateTag(i, { dir })} />
      <div className="group">
        {TAG_COLORS.map((c) => (
          <button key={c} type="button" className={t.color === c ? 'sp-sw sel' : 'sp-sw'} style={{ '--c': c, width: 18 } as CSSProperties}
            title="Tag color" onClick={() => updateTag(i, { color: c })} />
        ))}
      </div>
      <button type="button" className="ghost small" onClick={() => removeTag(i)}>Delete tag</button>
      <button type="button" className="ghost small" onClick={() => { sp.editingTag = null; emit('structure'); }}>Close</button>
    </div>
  );
}

export function Timeline() {
  useSp('structure', 'cursor', 'pixels');
  const scroll = useRef<HTMLDivElement>(null);
  const { itemProps, marks } = useReorder('x', (from, over, before) => {
    let to = before ? over : over + 1;
    if (from < to) to--;
    moveTo(from, to);
  });
  const frames = sp.doc.frames, layers = sp.doc.layers, n = frames.length;
  const [ra, rb] = selectedFrames();
  // the current cel repaints on every stroke, the others when the document changes
  const doc = `${versions.get('structure') || 0}.${sp.doc.w}x${sp.doc.h}`, px = versions.get('pixels') || 0;
  const rowsTopFirst = layers.map((_, i) => i).reverse();

  // scroll the grid (never the page) so the current frame shows
  useEffect(() => {
    const box = scroll.current;
    if (!box) return;
    const l = sp.frame * CELL;
    if (l < box.scrollLeft) box.scrollLeft = l;
    else if (l + CELL > box.scrollLeft + box.clientWidth) box.scrollLeft = l + CELL - box.clientWidth;
  }, [sp.frame, n]);

  return (
    <div className="panel sp-timeline">
      <Preview />
      <div className="sp-frames-col">
        <div className="sp-tl">
          <div className="sp-tl-names">
            <div className="sp-tl-corner" />
            {rowsTopFirst.map((li) => (
              <button key={li} type="button" className={'sp-tl-name' + (li === sp.layer ? ' sel' : '') + (layers[li].visible ? '' : ' off')}
                title={layers[li].name} onClick={() => setLayer(li)}>{layers[li].name}{layers[li].ref ? ' (ref)' : ''}</button>
            ))}
          </div>
          <div className="sp-tl-scroll" ref={scroll} id="spFrames">
            <div className="sp-tl-tags" style={{ width: n * CELL }}>
              {sp.doc.tags.map((t, i) => (
                <button key={i} type="button" className={'sp-tl-tag' + (sp.editingTag === i ? ' sel' : '')}
                  style={{ left: t.from * CELL, width: (t.to - t.from + 1) * CELL - 2, '--c': t.color } as CSSProperties}
                  title={`${t.name} · ${t.dir} · frames ${t.from + 1}–${t.to + 1}`} onClick={() => selectTag(i)}>{t.name}</button>
              ))}
            </div>
            <div className="sp-tl-head" style={{ width: n * CELL }}>
              {frames.map((f, i) => (
                <div
                  key={i}
                  className={'sp-frame sp-tl-frame' + (i === sp.frame ? ' sel' : '') + (i >= ra && i <= rb && ra !== rb ? ' inrange' : '') + marks(i)}
                  tabIndex={0}
                  title={`Frame ${i + 1} · ${f.duration} ms. Drag to reorder, Shift+click to select a range.`}
                  onClick={(e) => pickFrame(i, e.shiftKey)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFrame(i, e.shiftKey); } }}
                  {...itemProps(i)}
                >
                  <b>{i + 1}</b><small>{f.duration}</small>
                </div>
              ))}
            </div>
            {rowsTopFirst.map((li) => (
              <div key={li} className="sp-tl-row" style={{ width: n * CELL }}>
                {frames.map((_, fi) => (
                  <button
                    key={fi}
                    type="button"
                    className={'sp-cel' + (fi === sp.frame && li === sp.layer ? ' sel' : '') + (fi === sp.frame ? ' cur' : '')
                      + (fi >= ra && fi <= rb && ra !== rb ? ' inrange' : '') + (layers[li].visible ? '' : ' off')}
                    title={`${layers[li].name}, frame ${fi + 1}`}
                    onClick={(e) => { if (e.shiftKey) pickFrame(fi, true); else { sp.range = null; setFrame(fi); setLayer(li); emit('cursor'); } }}
                  >
                    <CelThumb frame={fi} layer={li} stamp={fi === sp.frame && li === sp.layer ? `${doc}.${px}` : doc} />
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
        <TagEditor />
        <div className="row sel-row">
          <span className="frame-info">{ra !== rb ? `Frames ${ra + 1}–${rb + 1}` : `Frame ${sp.frame + 1} of ${n}`}</span>
          <button type="button" className="ghost small" title="New empty frame (N)" onClick={() => newFrame(false)}>+ Frame</button>
          <button type="button" className="ghost small" title="Copy of this frame (Shift+N)" onClick={() => newFrame(true)}>Duplicate</button>
          <button type="button" className="ghost small" aria-label="Move frame earlier" disabled={sp.frame < 1} onClick={() => moveTo(sp.frame, sp.frame - 1)}>◀</button>
          <button type="button" className="ghost small" aria-label="Move frame later" disabled={sp.frame >= n - 1} onClick={() => moveTo(sp.frame, sp.frame + 1)}>▶</button>
          <button
            type="button"
            className="ghost small"
            title="Delete this frame"
            disabled={n < 2}
            onClick={() => { pushDoc(); if (removeFrame(sp.doc, sp.frame)) { sp.frame = Math.min(sp.frame, sp.doc.frames.length - 1); sp.range = null; emit('structure', 'cursor', 'pixels'); } }}
          >Delete</button>
          <span className="muted">Duration</span>
          <NumberField
            value={frames[sp.frame].duration}
            min={10}
            max={10000}
            step={10}
            label="Frame duration in ms"
            onCommit={(v) => {
              const d = Math.round(v) || DEFAULT_DURATION;
              const [a, b] = selectedFrames();
              if (a === b && d === frames[sp.frame].duration) return;
              pushDoc();
              for (let i = a; i <= b; i++) sp.doc.frames[i].duration = d;
              emit('structure');
            }}
          />
          <span className="muted">ms</span>
          <button
            type="button"
            className="ghost small"
            title="Give every frame this duration"
            onClick={() => { const d = frames[sp.frame].duration; pushDoc(); for (const fr of sp.doc.frames) fr.duration = d; emit('structure'); }}
          >All</button>
          <span className="sp-tl-sep" />
          <button type="button" className="ghost small" title="Copy this cel (Shift+C)" onClick={copyCel}>Copy cel</button>
          <button type="button" className="ghost small" title="Paste into this cel, or into every selected frame (Shift+V)" onClick={pasteCel}>Paste cel</button>
          <button type="button" className="ghost small" title="Tag the selected frames (Shift+click frames to select several)" onClick={tagSelection}>+ Tag</button>
          <button type="button" className="ghost small" title="Add left/right mirrored copies of the selected frames (or of this frame's tag) at the end" onClick={mirrorSelection}>Mirror</button>
        </div>
      </div>
    </div>
  );
}
