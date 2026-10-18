// The right side of the Pixelize mode: the drop zone, the stats, the original
// and the result, the palette and the animation. Each piece shows on its steps.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hex, hexToRgb, rgbOfKey } from '../../core/color';
import { confidenceLevel } from '../../core/grid';
import { useReorder } from '../components/useReorder';
import {
  animInfo, attachAlign, attachPreview, moveFrame, nudge, reorder, resetAllOffsets, selectFrame, setHold, setOffset, setPlaying, toggleExcluded,
} from '../anim';
import { app, pxBus } from '../app';
import { cssVar } from '../dom';
import { attachEditor, ed, refit, zoomStep } from '../editor';
import { loadFile } from '../input';
import { copyAll, copySelected, isLocked, onSwatch, pal, replaceSelected, resetColorChanges, toggleLock, toggleMerge } from '../palette';
import { setSettings, toManual } from '../settings';
import { stepClass } from '../steps';
import { Check, SegField, useSettings } from './fields';

function Welcome() {
  const file = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className={'welcome' + stepClass('image')}>
      <div
        className={over ? 'drop over' : 'drop'}
        id="drop"
        tabIndex={0}
        role="button"
        aria-label="Choose an image"
        onClick={() => file.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.current?.click(); } }}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}  // the page-wide drop handler loads the file
      >
        <strong>Drop an image here</strong>
        <small>or click to choose one</small>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { loadFile(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
}

function Stats() {
  const s = useSettings();
  pxBus.use('base', 'result');
  const base = app.base, src = app.source, g = base?.grid;
  const level = g ? confidenceLevel(g.confidence) : null;
  return (
    <>
      <div className={'stats' + stepClass('grid colors clean edit frames export')}>
        <div className="stat"><span>Original</span><b>{src ? `${src.w}×${src.h}` : '–'}</b></div>
        <div className="stat">
          <span>Fake pixel{level
            ? <span className={`conf ${level}`} title={`Detection confidence (${g!.confidence!.toFixed(2)})`}>{level}</span>
            : s.sizeMode === 'manual' && base ? <span className="conf medium">manual</span> : null}</span>
          <b title={g ? `Cells measure ${g.min} to ${g.max} px` : ''}>
            {!g ? '–' : !g.cell ? `${g.min}–${g.max} px` : g.cell.x === g.cell.y ? `${g.cell.x.toFixed(1)} px` : `${g.cell.x.toFixed(1)}×${g.cell.y.toFixed(1)}`}
          </b>
        </div>
        <div className="stat"><span>Real size</span><b>{base ? `${base.width}×${base.height}` : '–'}</b></div>
        <div className="stat"><span>Colors</span><b>{app.result ? app.resultColors.length : '–'}</b></div>
      </div>
      {level === 'low' && (
        <div className={'warnbar' + stepClass('grid')}>
          <p>The grid detection is unsure about this image. Check the lines on the original, or set the pixel size yourself.</p>
          <button type="button" className="ghost small" onClick={toManual}>Adjust manually</button>
        </div>
      )}
    </>
  );
}

/** The original with the fitted grid on top. */
function SourceView() {
  const s = useSettings();
  pxBus.use('source', 'base');
  const ref = useRef<HTMLCanvasElement>(null);
  const src = app.source, base = app.base;
  useLayoutEffect(() => {
    const canvas = ref.current!;
    if (!src) return;
    canvas.width = src.w;
    canvas.height = src.h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(src.img, 0, 0);
    if (!s.showGrid || !base) return;
    ctx.strokeStyle = cssVar('--grid') || 'rgba(217,115,43,.75)';
    ctx.lineWidth = Math.max(1, Math.round(src.w / 700));
    ctx.beginPath();
    for (const x of base.grid.xs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, src.h); }
    for (const y of base.grid.ys) { ctx.moveTo(0, y + 0.5); ctx.lineTo(src.w, y + 0.5); }
    ctx.stroke();
  });
  return (
    <figure className={'panel' + stepClass('grid')}>
      <figcaption><span className="label">Original</span><span className="tag">{src?.isSample ? 'Sample' : ''}</span></figcaption>
      <div className="stage" style={src ? { aspectRatio: `${src.w} / ${src.h}` } : undefined}><canvas id="srcCanvas" ref={ref} /></div>
    </figure>
  );
}

/** The result, drawn and edited by the editor engine. */
function ResultView() {
  const s = useSettings();
  pxBus.use('editor', 'base');
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => attachEditor(stage.current!, canvas.current!), []);
  const g = app.base?.grid;
  return (
    <figure className="panel">
      <figcaption><span className="label">Result</span><span className="tag">{g?.cell ? `cells ${g.min}–${g.max} px` : ''}</span></figcaption>
      <div className={'stage edit-stage' + (ed.tool === 'pan' ? ' pan' : ' draw')} id="editStage" ref={stage}><canvas id="editCanvas" ref={canvas} aria-label="Result" /></div>
      <div className="toolbar">
        <div className="group">
          <button type="button" className="ghost small" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomStep(-1)}>−</button>
          <output>{Math.round(ed.zoom * 100)}%</output>
          <button type="button" className="ghost small" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomStep(1)}>+</button>
          <button type="button" className="ghost small" title="Fit (0)" onClick={refit}>Fit</button>
          <Check k="pixGrid">Grid</Check>
        </div>
        <div className={'group compare' + stepClass('colors clean edit')}>
          <Check k="compare">Compare</Check>
          <input type="range" min={0} max={100} value={s.split} aria-label="Before and after split" disabled={!s.compare}
            onChange={(e) => setSettings({ split: Number(e.target.value) })} />
        </div>
      </div>
    </figure>
  );
}

function Views() {
  pxBus.use('source');
  const src = app.source;
  // on the grid step the result matches the original's shape, and wide images stack
  const wide = !!src && src.w > src.h * 1.25;
  return (
    <div className={'views' + (wide ? ' wide' : '') + stepClass('grid colors clean edit export')}
      style={src ? { '--src-ar': `${src.w} / ${src.h}` } as React.CSSProperties : undefined}>
      <SourceView />
      <ResultView />
    </div>
  );
}

function PalettePanel() {
  pxBus.use('result', 'palette', 'settings');
  const sel = app.resultColors.find((c) => c.key === pal.selected);
  const importedMode = useSettings().palMode === 'imported';
  return (
    <div className={'panel' + stepClass('colors edit')}>
      <div className="pal-head">
        <span className="label">Palette · click a color</span>
        <div className="group">
          <button type="button" className="ghost small" onClick={copyAll}>Copy all hex</button>
          {(app.locks.length > 0 || app.colorMaps.length > 0) && <button type="button" className="ghost small" onClick={resetColorChanges}>Undo color changes</button>}
        </div>
      </div>
      <div className="swatches" id="swatches">
        {app.resultColors.map((c) => (
          <button key={c.key} type="button"
            className={'sw' + (c.key === pal.selected ? ' sel' : '') + (pal.mergeFrom !== null && c.key !== pal.mergeFrom ? ' target' : '')}
            title={`${hex(c.rgb)} · ${c.count} px`} onClick={() => onSwatch(c.key)}>
            <i style={{ background: hex(c.rgb) }} />{hex(c.rgb)}{isLocked(c.key) && <b>LOCK</b>}
          </button>
        ))}
      </div>
      {sel && (
        <div className="sw-editor">
          <span className="sw-info">{pal.mergeFrom !== null ? `Click the color to merge ${hex(sel.rgb)} into` : `${hex(sel.rgb)} · ${sel.count} px`}</span>
          <button type="button" className="ghost small" onClick={copySelected}>Copy hex</button>
          {/* in palette mode the imported colors are the palette; editing them here would not stick */}
          <button type="button" className="ghost small" title="Locked colors stay when you change the settings" disabled={importedMode} onClick={toggleLock}>{isLocked(sel.key) ? 'Unlock' : 'Lock'}</button>
          <label className="colorpick">Replace with <input type="color" aria-label="Replacement color" disabled={importedMode}
            value={hex(rgbOfKey(sel.key))} onChange={(e) => replaceSelected(hexToRgb(e.target.value))} /></label>
          <button type="button" className="ghost small" disabled={importedMode} onClick={toggleMerge}>{pal.mergeFrom !== null ? 'Cancel merge' : 'Merge into…'}</button>
        </div>
      )}
    </div>
  );
}

// ---------- animation ----------

function FrameCard(props: { i: number; pos: number; extra: string; dragProps: object }) {
  const a = animInfo();
  const host = useRef<HTMLDivElement>(null);
  const canvas = a.anim?.canvases[props.i];
  // the frame's canvas is built by anim.ts; this card only shows it
  useLayoutEffect(() => { if (canvas) host.current!.replaceChildren(canvas); }, [canvas]);
  const out = a.excluded.has(props.i), o = a.offsetOf(props.i), hold = a.holdOf(props.i);
  return (
    <div
      className={'frame' + (out ? ' off' : '') + (a.selected === props.i ? ' sel' : '') + (a.current === props.i ? ' on' : '') + props.extra}
      tabIndex={0}
      role="button"
      aria-label={`Frame ${props.pos + 1}${out ? ', excluded from the animation' : ''}`}
      data-frame={props.i}
      onClick={() => selectFrame(props.i)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFrame(props.i); }
        else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveFrame(props.i, -1); }
        else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveFrame(props.i, 1); }
      }}
      {...props.dragProps}
    >
      <button type="button" className="ftoggle" title={out ? 'Add back to the animation' : 'Take out of the animation'}
        aria-label={out ? 'Add back to the animation' : 'Take out of the animation'}
        onClick={(e) => { e.stopPropagation(); toggleExcluded(props.i); }}>{out ? '+' : '×'}</button>
      <div ref={host} className="frame-pic" />
      <span>{props.pos + 1}{hold > 1 && <em> {hold}×</em>}{(o.dx || o.dy) ? <em title="Moved"> •</em> : null}</span>
    </div>
  );
}

function AnimationPanel() {
  const s = useSettings();
  pxBus.use('anim');
  const a = animInfo();
  const preview = useRef<HTMLCanvasElement>(null);
  const alignStage = useRef<HTMLDivElement>(null);
  const alignCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => attachPreview(preview.current!), []);
  useEffect(() => attachAlign(alignStage.current!, alignCanvas.current!), []);
  const { itemProps, marks } = useReorder('x', (fromPos, overPos, before) => {
    let to = before ? overPos : overPos + 1;
    if (fromPos < to) to--;
    reorder(a.order[fromPos], to);
  });
  const n = a.anim?.frames.length ?? 0;
  const sel = a.selected, pos = sel === null ? -1 : a.order.indexOf(sel), has = pos >= 0;
  const o = has ? a.offsetOf(sel!) : null;
  const withSel = (fn: (i: number) => void) => () => { if (sel !== null) fn(sel); };
  const cur = a.current;
  return (
    <div className={'anim' + stepClass('frames')}>
      {!s.animOn && (
        <div className="panel anim-off">
          <p>Animation is off. Turn on <b>This image has several frames</b> on the left if this is a spritesheet, or go on to export.</p>
        </div>
      )}
      <div className="anim-body" hidden={!s.animOn}>
        <figure className="panel">
          <figcaption><span className="label">Preview</span><span className="tag">{a.anim ? (n ? `${a.active.length} of ${n} frames · ${a.anim.W}×${a.anim.H} px` : 'No frames found') : ''}</span></figcaption>
          <div className="stage anim-stage"><canvas id="animCanvas" ref={preview} /></div>
          <div className="toolbar">
            <button type="button" className="ghost small" onClick={() => setPlaying(!a.playing)}>{a.playing ? 'Pause' : a.ended ? 'Replay' : 'Play'}</button>
            <span className="frame-info">
              {!a.anim || cur === null ? (n ? 'All frames are excluded' : '') : `Frame ${a.order.indexOf(cur) + 1} of ${a.order.length}` + (a.excluded.has(cur) ? ' · excluded' : '')}
            </span>
          </div>
        </figure>
        <figure className="panel">
          <figcaption><span className="label">Align frame</span><span className="tag">{has ? `Frame ${pos + 1} of ${a.order.length}` : ''}</span></figcaption>
          <div className="stage align-stage" id="alignStage" ref={alignStage}>
            <canvas id="alignCanvas" ref={alignCanvas} tabIndex={0} aria-label="Selected frame. Drag it or use the arrow keys to move it." />
          </div>
          <div className="toolbar">
            <div className="group">
              <button type="button" className="ghost small" aria-label="Move left" disabled={!has} onClick={withSel((i) => nudge(i, -1, 0))}>←</button>
              <button type="button" className="ghost small" aria-label="Move up" disabled={!has} onClick={withSel((i) => nudge(i, 0, -1))}>↑</button>
              <button type="button" className="ghost small" aria-label="Move down" disabled={!has} onClick={withSel((i) => nudge(i, 0, 1))}>↓</button>
              <button type="button" className="ghost small" aria-label="Move right" disabled={!has} onClick={withSel((i) => nudge(i, 1, 0))}>→</button>
              <output>{o ? `${o.dx > 0 ? '+' : ''}${o.dx}, ${o.dy > 0 ? '+' : ''}${o.dy}` : '–'}</output>
              <button type="button" className="ghost small" disabled={!has} onClick={withSel((i) => setOffset(i, 0, 0))}>Reset</button>
            </div>
            <div className="group">
              <span className="muted">Ghost</span>
              <SegField k="ghost" label="Ghost frame" small options={[{ value: 'prev', label: 'Previous' }, { value: 'first', label: 'First' }, { value: 'none', label: 'None' }]} />
            </div>
          </div>
          <p className="hint">Drag the frame or use the arrow keys to move it 1 px. The faint frame behind it and the center lines help you line it up.</p>
        </figure>
        <div className="panel frames-panel">
          <div className="frames" id="frames">
            {a.anim && a.order.map((i, p) => <FrameCard key={i} i={i} pos={p} extra={marks(p)} dragProps={itemProps(p)} />)}
          </div>
          <div className="row sel-row">
            <button type="button" className="ghost small" aria-label="Move frame earlier" disabled={pos <= 0} onClick={withSel((i) => moveFrame(i, -1))}>◀ Earlier</button>
            <button type="button" className="ghost small" aria-label="Move frame later" disabled={!has || pos >= a.order.length - 1} onClick={withSel((i) => moveFrame(i, 1))}>Later ▶</button>
            <button type="button" className="ghost small" disabled={!has} onClick={withSel(toggleExcluded)}>{has && a.excluded.has(sel!) ? 'Include' : 'Exclude'}</button>
            <span className="muted">Duration</span>
            <button type="button" className="ghost small" aria-label="Shorter" disabled={!has} onClick={withSel((i) => setHold(i, a.holdOf(i) - 1))}>−</button>
            <output>{has ? `${a.holdOf(sel!)}×` : '–'}</output>
            <button type="button" className="ghost small" aria-label="Longer" disabled={!has} onClick={withSel((i) => setHold(i, a.holdOf(i) + 1))}>+</button>
            <button type="button" className="ghost small" disabled={!a.anim || ![...a.order].some((i) => { const q = a.offsetOf(i); return q.dx || q.dy; })} onClick={resetAllOffsets}>Reset all positions</button>
          </div>
          <p className="hint">Click a frame to align it. Drag frames to reorder them. × takes a frame out of the animation.</p>
        </div>
      </div>
    </div>
  );
}

export function Workspace() {
  pxBus.use('step');
  return (
    <section className="work">
      <Welcome />
      <Stats />
      <Views />
      <PalettePanel />
      <AnimationPanel />
    </section>
  );
}
