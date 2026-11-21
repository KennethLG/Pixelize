// The Export window: the format and its options on one side, and on the other
// a preview of exactly what will be written (playing at the speed it will play
// at, with GameMaker's origin and collision box), the frames, the layers and
// the files.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { GM_ORIGINS, spriteInfo, type GmOrigin } from '../../../export/gamemaker';
import { NumberField, Seg } from '../../components/common';
import { setStatus } from '../../dom';
import { useSp } from '../hooks';
import {
  clampScale, defaultGmName, exportFrame, gmLayers, gmSprite, loadOptions, plan, runExport, saveOptions,
  type ExportFormat, type ExportOptions,
} from '../exportPlan';
import { canPickFolders, readSprite } from '../gmProject';
import { GmProjectBox, useGmProject } from './GmProjectBox';
import { closeDialog, sp, versions } from '../state';

const ORIGIN_LABELS: Record<GmOrigin, string> = {
  'top-left': 'Top left', top: 'Top centre', 'top-right': 'Top right',
  left: 'Middle left', center: 'Centre', right: 'Middle right',
  'bottom-left': 'Bottom left', bottom: 'Bottom centre (feet)', 'bottom-right': 'Bottom right',
};

const FORMATS: { value: ExportFormat; label: string; title: string }[] = [
  { value: 'png', label: 'PNG', title: 'The current frame' },
  { value: 'strip', label: 'Strip', title: 'The frames side by side, named _stripN.png (GameMaker imports it as frames)' },
  { value: 'gif', label: 'GIF', title: 'An animated GIF' },
  { value: 'gamemaker', label: 'GameMaker', title: 'A sprite asset with its layers, written straight into a GameMaker project' },
];

/** room around the preview for the origin mark */
const PAD = 12;

export const closeExport = closeDialog;

export function ExportDialog() {
  useSp('view', 'structure', 'pixels');
  const [o, setO] = useState<ExportOptions>(() => ({ ...loadOptions(), ...(sp.exportAs ? { format: sp.exportAs } : {}) }));
  const [name, setName] = useState(defaultGmName);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(0);
  const gmp = useGmProject();
  const { project, waiting, choose } = gmp;
  const set = (patch: Partial<ExportOptions>) => setO((prev) => { const next = { ...prev, ...patch }; saveOptions(next); return next; });

  const gm = o.format === 'gamemaker';
  const d = sp.doc;
  const stamp = `${versions.get('pixels')}.${versions.get('structure')}`;
  const planned = useMemo(() => plan(o, name), [o, name, stamp]);
  const shown = planned[Math.min(pick, planned.length - 1)];

  // the .yy of each GameMaker sprite this export replaces (its origin and box show in the preview)
  const [existing, setExisting] = useState<Record<string, any | null>>({});
  useEffect(() => {
    if (!gm || !project) { setExisting({}); return; }
    let live = true;
    Promise.all(planned.map(async (p) => [p.name, await readSprite(project, p.name)] as const))
      .then((list) => { if (live) setExisting(Object.fromEntries(list)); }, () => {});
    return () => { live = false; };
  }, [gm, project, planned]);

  const s = clampScale(o.scale), W = d.w * s, H = d.h * s;
  const info = useMemo(() => (gm && shown ? spriteInfo(gmSprite({ ...shown, frames: [...new Set(shown.frames)] }, o, project), existing[shown.name] ?? null) : null),
    [gm, shown, o, project, existing]);

  const go = () => {
    if (gm && !project) { choose(!waiting); return; }
    setBusy(true);
    runExport(o, name, project).then(closeExport, (e) => setStatus((e as Error).message, true)).finally(() => setBusy(false));
  };

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeExport(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const newOnes = gm ? planned.filter((p) => !existing[p.name]) : [];
  const updated = gm ? planned.filter((p) => existing[p.name]) : [];
  const files = gm ? planned.reduce((n, p) => n + p.frames.length * (1 + gmLayers().length) + 1, 0) : planned.length;
  const actionLabel = !gm ? `Export ${FORMATS.find((f) => f.value === o.format)!.label}`
    : !project ? (waiting ? `Allow access to ${waiting}` : 'Choose the project folder…')
      : planned.length > 1 ? `Send ${planned.length} sprites to GameMaker` : 'Send to GameMaker';

  return (
    <div className="opt-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeExport(); }}>
      <div className="opt-dialog panel exp-dialog" role="dialog" aria-modal="true" aria-label="Export">
        <div className="opt-head">
          <h2>Export</h2>
          <button type="button" className="ghost small" aria-label="Close export" onClick={closeExport}>×</button>
        </div>
        <div className="exp-body">
          <section className="exp-preview" aria-label="Preview">
            {planned.length > 1 && (
              <div className="exp-picks" role="tablist" aria-label="Sprites">
                {planned.map((p, i) => (
                  <button key={p.name + i} type="button" role="tab" aria-selected={p === shown} className={'ghost small' + (p === shown ? ' on' : '')} onClick={() => setPick(i)}>{p.name}</button>
                ))}
              </div>
            )}
            {shown && <PreviewCanvas o={o} frames={shown.frames} durations={shown.durations} strip={o.format === 'strip'} info={info} />}
            {shown && (
              <p className="exp-summary">
                <b>{gm ? shown.name : fileName(o, shown.name, shown.frames.length)}</b>
                <span className="muted">
                  {o.format === 'strip' ? ` · ${W * shown.frames.length}×${H} · ${shown.frames.length} frames` : ` · ${W}×${H}`}
                  {o.format !== 'png' && o.format !== 'strip' && ` · ${shown.frames.length} frames`}
                  {gm && ` · ${shown.fps} fps · ${gmLayers().length} layer${gmLayers().length === 1 ? '' : 's'}`}
                  {info && ` · origin ${info.origin[0]},${info.origin[1]}`}
                </span>
              </p>
            )}
            {gm && (
              <div className="exp-layers">
                <span className="label">Layers in GameMaker (top first)</span>
                <ol>
                  {gmLayers().map((li) => {
                    const l = d.layers[li];
                    return <li key={li}>{l.name}{!l.visible && <small> · hidden</small>}{l.opacity < 1 && <small> · {Math.round(l.opacity * 100)}%</small>}</li>;
                  })}
                </ol>
                {d.layers.some((l) => l.ref) && <p className="hint">Reference layers are left out.</p>}
              </div>
            )}
          </section>

          <section className="exp-options" aria-label="Options">
            <Seg name="expFormat" label="Format" value={o.format} options={FORMATS} onChange={(v) => { set({ format: v }); setPick(0); }} small={false} />

            <div className="exp-row">
              <span>Scale</span>
              <NumberField value={o.scale} min={1} max={64} label="Export scale" onCommit={(v) => set({ scale: v })} live />
              <span className="muted">× · {W}×{H} px</span>
            </div>

            {o.format !== 'png' && d.tags.length > 0 && !(gm && o.perTag) && (
              <label className="exp-row">
                <span>Frames</span>
                <select value={o.tag === null ? 'all' : String(o.tag)} onChange={(e) => set({ tag: e.target.value === 'all' ? null : Number(e.target.value) })}>
                  <option value="all">All frames ({d.frames.length})</option>
                  {d.tags.map((t, i) => <option key={i} value={String(i)}>{t.name} ({t.to - t.from + 1})</option>)}
                </select>
              </label>
            )}

            {d.variants.length > 0 && (
              <label className="exp-row">
                <span>Colors</span>
                <select value={o.variant === null ? 'orig' : String(o.variant)} onChange={(e) => set({ variant: e.target.value === 'orig' ? null : Number(e.target.value) })}>
                  <option value="orig">Original</option>
                  {d.variants.map((v, i) => <option key={i} value={String(i)}>{v.name}</option>)}
                </select>
              </label>
            )}

            {gm && (
              <>
                <GmProjectBox {...gmp} />

                <label className="exp-row">
                  <span>{o.perTag && d.tags.length ? 'Name prefix' : 'Sprite name'}</span>
                  <input type="text" value={name} spellCheck={false} onChange={(e) => setName(e.target.value)} onBlur={() => setName((n) => n.trim() || defaultGmName())} />
                </label>

                {d.tags.length > 0 && (
                  <label className="check" title="Each tag becomes its own sprite, named prefix_tag">
                    <input type="checkbox" checked={o.perTag} onChange={(e) => { set({ perTag: e.target.checked }); setPick(0); }} />One sprite per tag
                  </label>
                )}

                <label className="exp-row">
                  <span>Origin</span>
                  <select value={o.origin} onChange={(e) => set({ origin: e.target.value as ExportOptions['origin'] })}>
                    <option value="keep">Keep the sprite's own (new: bottom centre)</option>
                    {GM_ORIGINS.map((k) => <option key={k} value={k}>{ORIGIN_LABELS[k]}</option>)}
                    <option value="custom">Custom…</option>
                  </select>
                </label>
                {o.origin === 'custom' && (
                  <div className="exp-row">
                    <span>x</span><NumberField value={o.originX} min={-4096} max={4096} label="Origin x" onCommit={(v) => set({ originX: v })} live />
                    <span>y</span><NumberField value={o.originY} min={-4096} max={4096} label="Origin y" onCommit={(v) => set({ originY: v })} live />
                  </div>
                )}

                {project && newOnes.length > 0 && (
                  <label className="exp-row">
                    <span>Folder</span>
                    <select value={o.folder ?? ''} onChange={(e) => set({ folder: e.target.value || null })}>
                      <option value="">Sprites</option>
                      {project.folders.filter((f) => f.path !== 'folders/Sprites.yy').map((f) => <option key={f.path} value={f.path}>{f.path.replace(/^folders\//, '').replace(/\.yy$/, '')}</option>)}
                    </select>
                  </label>
                )}

                {(planned.some((p) => p.uneven) || o.evenTiming) && (
                  <label className="check" title="GameMaker plays every frame of a sprite equally long. This shows a long frame several times instead, so the animation keeps its timing (image_number grows).">
                    <input type="checkbox" checked={o.evenTiming} onChange={(e) => set({ evenTiming: e.target.checked })} />Keep frame timing (repeat long frames)
                  </label>
                )}
                {planned.some((p) => p.uneven) && <p className="hint">Frames have different durations; GameMaker plays them all at {shown?.fps} fps.</p>}

                {project && (
                  <div className="exp-notes">
                    {newOnes.length > 0 && <p className="hint">New: {newOnes.map((p) => p.name).join(', ')}.</p>}
                    {updated.length > 0 && <p className="hint">Updates {updated.map((p) => p.name).join(', ')}: {updated.length > 1 ? 'they keep their' : 'it keeps its'} origin, collision mask, texture group and folder; frames and layers are replaced.</p>}
                    <p className="hint">Writes {files} files into sprites/ and lists new sprites in {project.yyp}. Close the project in GameMaker first, or it may write over the changes.</p>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
        <div className="exp-foot">
          <button type="button" className="ghost" onClick={closeExport}>Cancel</button>
          <button type="button" disabled={busy || (gm && !canPickFolders())} onClick={go}>{busy ? 'Working…' : actionLabel}</button>
        </div>
      </div>
    </div>
  );
}

function fileName(o: ExportOptions, base: string, n: number): string {
  const v = o.variant === null ? '' : `_${sp.doc.variants[o.variant].name.replace(/[^\w.-]+/g, '_')}`;
  if (o.format === 'png') return `${base}${v}${sp.doc.frames.length > 1 ? `_${sp.frame + 1}` : ''}${o.scale > 1 ? `_x${o.scale}` : ''}.png`;
  if (o.format === 'strip') return `${base}${v}_strip${n}.png`;
  return `${base}${v}.gif`;
}

/** Plays the frames at their durations (a strip shows them side by side), with GameMaker's origin and box on top. */
function PreviewCanvas(props: { o: ExportOptions; frames: number[]; durations: number[]; strip: boolean; info: ReturnType<typeof spriteInfo> | null }) {
  const { o, frames, durations, strip, info } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const [k, setK] = useState(0);
  const [playing, setPlaying] = useState(true);
  const s = clampScale(o.scale), W = sp.doc.w * s, H = sp.doc.h * s;
  const stamp = `${versions.get('pixels')}.${versions.get('structure')}`;
  // each distinct frame drawn once
  const pics = useMemo(() => {
    const m = new Map<number, HTMLCanvasElement>();
    for (const fi of new Set(frames)) {
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d')!.putImageData(new ImageData(exportFrame(fi, o), W, H), 0, 0);
      m.set(fi, c);
    }
    return m;
  }, [frames, o, W, H, stamp]);

  useEffect(() => { setK(0); }, [frames]);
  useEffect(() => {
    if (strip || !playing || frames.length < 2) return;
    const t = setTimeout(() => setK((i) => (i + 1) % frames.length), Math.max(16, durations[k % frames.length] ?? 100));
    return () => clearTimeout(t);
  }, [k, strip, playing, frames, durations]);

  // as big as fits the box, in whole steps when it can
  const boxW = 380 - PAD * 2, boxH = 300 - PAD * 2;
  const fullW = strip ? W * frames.length : W;
  const fit = Math.min(boxW / fullW, boxH / H);
  const zoom = fit >= 1 ? Math.floor(fit) : fit;

  useLayoutEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const sw = Math.max(1, Math.round(fullW * zoom)), sh = Math.max(1, Math.round(H * zoom));
    // a margin, so an origin on the edge (the feet) still shows
    const pad = info ? PAD : 0;
    const cw = sw + pad * 2, ch = sh + pad * 2;
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const g = c.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cw, ch);
    // the checkerboard only behind the sprite itself
    const css = getComputedStyle(c);
    g.fillStyle = css.getPropertyValue('--check-b').trim() || '#ccc';
    g.fillRect(pad, pad, sw, sh);
    g.fillStyle = css.getPropertyValue('--check-a').trim() || '#999';
    for (let y = 0; y < sh; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < sw; x += 16) g.fillRect(pad + x, pad + y, Math.min(8, sw - x), Math.min(8, sh - y));
    g.translate(pad, pad);
    if (strip) frames.forEach((fi, i) => g.drawImage(pics.get(fi)!, i * W * zoom, 0, W * zoom, H * zoom));
    else {
      const fi = frames[k % frames.length];
      if (fi !== undefined) g.drawImage(pics.get(fi)!, 0, 0, sw, sh);
    }
    if (info) {
      const { box, origin } = info;
      g.strokeStyle = 'rgba(80, 200, 255, 0.9)';
      g.setLineDash([4, 3]);
      g.lineWidth = 1;
      g.strokeRect(box.l * zoom + 0.5, box.t * zoom + 0.5, (box.r - box.l + 1) * zoom - 1, (box.b - box.t + 1) * zoom - 1);
      g.setLineDash([]);
      const x = origin[0] * zoom, y = origin[1] * zoom;
      g.strokeStyle = '#ff4d6d';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x - 7, y); g.lineTo(x + 7, y);
      g.moveTo(x, y - 7); g.lineTo(x, y + 7);
      g.stroke();
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  });

  return (
    <div className="exp-stage">
      <div className="exp-canvas"><canvas ref={canvas} /></div>
      <div className="exp-row exp-play">
        {!strip && frames.length > 1 && (
          <>
            <button type="button" className="ghost small" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button>
            <input type="range" min={0} max={frames.length - 1} value={k % frames.length} aria-label="Frame" onChange={(e) => { setPlaying(false); setK(Number(e.target.value)); }} />
            <span className="muted">{(k % frames.length) + 1}/{frames.length}</span>
          </>
        )}
        {info && <span className="muted exp-legend"><i className="exp-key origin" />origin <i className="exp-key box" />collision box</span>}
        <span className="muted">{zoom >= 1 ? `${zoom}×` : `${Math.round(zoom * 100)}%`}</span>
      </div>
    </div>
  );
}
