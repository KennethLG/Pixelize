// The settings of each step, in the left column.

import { useRef, useState, type ReactNode } from 'react';
import { hex, rgbOfKey } from '../../core/color';
import { confidenceLevel } from '../../core/grid';
import { HsvPicker } from '../components/HsvPicker';
import { keyLabel, keysBus } from '../keys';
import { app, canRedo, canUndo, pxBus, redo, schedule, undo } from '../app';
import { animFrameCanvases, animInfo, downloadFramesZip, downloadGif, downloadSheet, downloadStrip } from '../anim';
import { runBatch } from '../batch';
import { setStatus } from '../dom';
import { downloadResult, scaleValue } from '../downloads';
import { clearEdits, ed, setDrawColor, setTool, type EditTool } from '../editor';
import { loadSample } from '../input';
import { setMode } from '../mode';
import { IMPORT_HINT, applyPastedCodes, importPaletteFile, pal, useResultColors } from '../palette';
import { resetSettings, setSettings, toManual } from '../settings';
import { loadFrames } from '../sprite';
import { Check, NumberSetting, SegField, Slider, SliderPair, useSettings } from './fields';

const Panel = (props: { step: string; title: string; children: ReactNode }) => (
  <section className="step-panel" data-panel={props.step}>
    <h2>{props.title}</h2>
    {props.children}
  </section>
);

const report = (p: Promise<unknown>) => { p.catch((e) => setStatus((e as Error).message, true)); };

// ---------- 1 · Image ----------

export function ImageStep() {
  pxBus.use('source');
  const src = app.source;
  return (
    <Panel step="image" title="Choose an image">
      <p>Start with an AI image that imitates pixel art: big blocky "pixels" of uneven size and slightly noisy colors. Pixelize finds the real grid and rebuilds the art at its true size.</p>
      <ul className="tips">
        <li>Drop the file on the box, click it, or paste it with <kbd>Ctrl</kbd>+<kbd>V</kbd>.</li>
        <li>PNG works best. A spritesheet with several frames is fine.</li>
        <li>Everything runs in your browser; nothing is uploaded.</li>
      </ul>
      <button type="button" className="ghost" id="sampleBtn" onClick={loadSample}>Try it with a sample</button>
      <p className="hint" id="srcName">
        {src && (src.isSample ? 'Loaded the sample: a 4-frame lantern spritesheet blown up to about 16 px per pixel, with noise.' : `Loaded: ${src.name}`)}
      </p>
    </Panel>
  );
}

// ---------- 2 · Pixels ----------

export function GridStep() {
  const s = useSettings();
  pxBus.use('base', 'source');
  const g = app.base?.grid, src = app.source;
  const level = g ? confidenceLevel(g.confidence) : null;
  // the sliders reach a quarter of the image's short side
  const maxCell = src ? Math.max(8, Math.floor(Math.min(src.w, src.h) / 4)) : 64;
  return (
    <Panel step="grid" title="Find the pixel grid">
      <p>The orange lines on the original mark each real pixel. If they line up with the blocks, go on. If not, adjust them here.</p>
      <SegField k="sizeMode" label="Grid mode" options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }, { value: 'exact', label: 'Exact size' }]} />
      {s.sizeMode === 'auto' && (
        <div className="box">
          <p className="hint" id="gridAutoInfo">
            {g?.cell ? `Detected ${g.cell.x.toFixed(2)} px per pixel (${level} confidence).` : 'Detects the size of the fake pixels on its own.'}
          </p>
          <button type="button" className="ghost small" id="toManual" onClick={toManual}>Fine-tune this grid</button>
        </div>
      )}
      {s.sizeMode === 'manual' && (
        <div className="box">
          <SliderPair k="cellX" label="Pixel size" min={2} max={maxCell} step={0.1} aria="Cell X" />
          <Check k="square">Square pixels</Check>
          {!s.square && <SliderPair k="cellY" label="Height" min={2} max={maxCell} step={0.1} aria="Cell Y" />}
          <Check k="snap">Snap lines to the edges in the image</Check>
          {/* the shift only places lines when they are not snapping to edges */}
          <SliderPair k="offX" label="Shift X" min={0} max={Math.max(1, s.cellX || 16)} step={0.5} aria="Offset X" disabled={s.snap} />
          <SliderPair k="offY" label="Shift Y" min={0} max={Math.max(1, (s.square ? s.cellX : s.cellY) || 16)} step={0.5} aria="Offset Y" disabled={s.snap} />
          <p className="hint">Sizes are in pixels of the original. Turn snapping off to place the lines yourself with Shift.</p>
        </div>
      )}
      {s.sizeMode === 'exact' && (
        <div className="box">
          <div className="row"><NumberSetting k="fw" label="Width" min={1} /><span>×</span><NumberSetting k="fh" label="Height" min={1} /><span>px</span></div>
          <p className="hint">Use this when you already know the size the art should have.</p>
        </div>
      )}
      <Check k="showGrid">Show the lines on the original</Check>
      <details className="more">
        <summary>Advanced</summary>
        <Slider k="alpha" label="Min alpha" min={0} max={255} />
        <p className="hint">Pixels more transparent than this become fully transparent.</p>
      </details>
    </Panel>
  );
}

// ---------- 3 · Colors ----------

export function ColorsStep() {
  const s = useSettings();
  pxBus.use('palette', 'result');
  const file = useRef<HTMLInputElement>(null);
  const [codes, setCodes] = useState('');
  return (
    <Panel step="colors" title="Pick the colors">
      <p>AI images have dozens of almost equal shades. This merges them into a clean palette.</p>
      <SegField k="palMode" label="Palette mode" options={[{ value: 'auto', label: 'Auto' }, { value: 'fixed', label: 'Fixed count' }, { value: 'imported', label: 'My palette' }]} />
      {s.palMode === 'auto' && <Slider k="tol" label="Merge" min={2} max={30} aria="Tolerance" />}
      {s.palMode === 'fixed' && <div className="row"><span>Colors</span><NumberSetting k="colors" label="Colors" min={2} max={256} /></div>}
      {s.palMode === 'imported' && (
        <div className="box">
          <div className="btns">
            <button type="button" className="ghost small" onClick={() => file.current?.click()}>Load palette file</button>
            <button type="button" className="ghost small" onClick={useResultColors}>Use the current colors</button>
          </div>
          <input ref={file} type="file" accept="image/*,.hex,.gpl,.txt,.pal" hidden
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) report(importPaletteFile(f)); }} />
          <div className="row">
            <input type="text" placeholder="#1b1530 #5a5470 …" aria-label="Paste hex codes" value={codes}
              onChange={(e) => setCodes(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyPastedCodes(codes); }} />
            <button type="button" className="ghost small" onClick={() => applyPastedCodes(codes)}>Apply</button>
          </div>
          <div className="mini-swatches">{app.imported.map((c, i) => <i key={i} style={{ background: hex(c) }} title={hex(c)} />)}</div>
          <p className="hint">{pal.importInfo || IMPORT_HINT}</p>
        </div>
      )}
      {s.palMode !== 'imported' && (
        <p className="hint">{s.palMode === 'fixed' ? 'Groups every shade into exactly this many colors.' : 'Move it right to merge more shades and get fewer colors.'}</p>
      )}
      <Check k="clean">Remove stray noise pixels</Check>
      {s.clean && <Slider k="cleanStr" label="Strength" min={2} max={40} />}
      <p className="hint">Click a color under the image to lock it, replace it or merge it into another one.</p>
    </Panel>
  );
}

// ---------- 4 · Background & crop ----------

export function CleanStep() {
  const s = useSettings();
  pxBus.use('base', 'editor');
  const base = app.base;
  const bgHex = !base || base.bgKey === null ? null : hex(rgbOfKey(base.bgKey));
  const cropped = !!base && (base.width !== base.fullW || base.height !== base.fullH);
  return (
    <Panel step="clean" title="Background and crop">
      <div className="sub">
        <Check k="removeBg" strong>Make the background transparent</Check>
        <div className={s.removeBg ? 'box' : 'box dim'}>
          <div className="row bgrow">
            <span className="bgchip"><i style={{ background: bgHex || '' }} /><code>{bgHex ? `${bgHex} ${base!.bgAuto ? '(auto)' : '(picked)'}` : '–'}</code></span>
            <button type="button" className="ghost small" disabled={!base || base.bgAuto} onClick={() => { app.bgPick = null; schedule(); }}>Auto</button>
          </div>
          <button type="button" className="tool wide" aria-pressed={ed.tool === 'bg'} onClick={() => setTool(ed.tool === 'bg' ? 'pan' : 'bg')}>Pick the background on the image</button>
          <SegField k="bgMode" label="Background removal mode" options={[{ value: 'edge', label: 'Only around the art' }, { value: 'all', label: 'Everywhere' }]} />
          <Slider k="bgTol" label="Similar shades" min={0} max={30} aria="Background tolerance" />
          <p className="hint">"Only around the art" keeps the same color inside the sprite (eyes, highlights).</p>
        </div>
      </div>
      <div className="sub">
        <span className="label">Crop</span>
        <SegField k="cropMode" label="Crop mode" options={[{ value: 'off', label: 'None' }, { value: 'trim', label: 'Trim empty' }, { value: 'manual', label: 'Manual' }]} />
        {s.cropMode === 'trim' && (
          <div className="box">
            <div className="row"><span>Keep a margin of</span><NumberSetting k="cropPad" label="Margin in px" min={0} /><span>px</span></div>
            <p className="hint">Cuts the empty rows and columns around the art.</p>
          </div>
        )}
        {s.cropMode === 'manual' && (
          <div className="box">
            <div className="margins">
              <label>Top<NumberSetting k="cropT" label="Top" min={0} /></label>
              <label>Left<NumberSetting k="cropL" label="Left" min={0} /></label>
              <label>Right<NumberSetting k="cropR" label="Right" min={0} /></label>
              <label>Bottom<NumberSetting k="cropB" label="Bottom" min={0} /></label>
            </div>
            <p className="hint">Pixels to cut from each side.</p>
          </div>
        )}
        <p className="crop-info">
          {base && (cropped ? `${base.fullW}×${base.fullH} → ${base.width}×${base.height} px` : `${base.width}×${base.height} px${s.cropMode === 'trim' ? ', nothing to trim' : ''}`)}
        </p>
      </div>
    </Panel>
  );
}

// ---------- 5 · Touch up ----------

const EDIT_TOOLS: { tool: EditTool; name: string; title: string }[] = [
  { tool: 'pan', name: 'Move', title: 'Move the view' },
  { tool: 'pencil', name: 'Pencil', title: 'Pencil' },
  { tool: 'eraser', name: 'Eraser', title: 'Eraser' },
  { tool: 'fill', name: 'Fill', title: 'Fill an area of one color' },
  { tool: 'picker', name: 'Eyedropper', title: 'Take a color from the image' },
];

export function EditStep() {
  pxBus.use('editor', 'result');
  keysBus.use('keys');
  const n = app.edits.size;
  return (
    <Panel step="edit" title="Touch up pixels">
      <p>Fix single pixels by hand. You can skip this.</p>
      <div className="toolgrid" role="toolbar" aria-label="Editing tools">
        {EDIT_TOOLS.map((t) => (
          <button key={t.tool} type="button" className="tool" title={`${t.title} (${keyLabel(`pixelize.${t.tool}`)})`} aria-pressed={ed.tool === t.tool} onClick={() => setTool(t.tool)}>
            {t.name} <kbd>{keyLabel(`pixelize.${t.tool}`)}</kbd>
          </button>
        ))}
      </div>
      <div className="colorpick-panel">
        <div className="row"><span className="muted">Color</span><code>{hex(ed.color)}</code></div>
        <HsvPicker color={ed.color} onChange={(c) => { setDrawColor(c); if (ed.tool === 'pan' || ed.tool === 'picker' || ed.tool === 'bg') setTool('pencil'); }} />
      </div>
      <div className="btns">
        <button type="button" className="ghost small" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>Undo</button>
        <button type="button" className="ghost small" title="Redo (Ctrl+Y)" disabled={!canRedo()} onClick={redo}>Redo</button>
        <button type="button" className="ghost small" disabled={!n} onClick={clearEdits}>Clear edits</button>
      </div>
      <p className="hint">{n ? `${n} pixel${n === 1 ? '' : 's'} edited` : 'No pixel edits'}</p>
      <p className="hint">Click a color in the palette below the image to draw with it. Edits are lost if the size of the result changes, so finish the earlier steps first.</p>
    </Panel>
  );
}

// ---------- 6 · Animation ----------

export function FramesStep() {
  const s = useSettings();
  return (
    <Panel step="frames" title="Animation">
      <Check k="animOn" strong>This image has several frames</Check>
      {!s.animOn && <p className="hint">Turn it on for spritesheets to split, align and play the frames. Single images can skip this step.</p>}
      {s.animOn && (
        <div className="box">
          <span className="label">Split into frames</span>
          <SegField k="splitMode" label="Split mode" options={[{ value: 'auto', label: 'Auto' }, { value: 'grid', label: 'Grid' }]} />
          {s.splitMode === 'grid' && (
            <div className="row">
              <span>Columns</span><NumberSetting k="cols" label="Columns" min={1} />
              <span>Rows</span><NumberSetting k="rows" label="Rows" min={1} />
            </div>
          )}
          {s.splitMode === 'auto' && (
            <div className="box">
              <div className="row"><span>Min gap</span><NumberSetting k="minGap" label="Min gap" min={1} /><span>px</span></div>
              <SegField k="align" label="Frame alignment" options={[{ value: 'bottom', label: 'Align feet' }, { value: 'center', label: 'Center' }]} />
            </div>
          )}
          <p className="hint">{s.splitMode === 'grid' ? 'Splits the result into equal parts, left to right and top to bottom.' : 'Finds each frame by the empty space around it.'}</p>

          <span className="label">Playback</span>
          <Slider k="fps" label="Speed" min={1} max={30} unit="fps" aria="Frames per second" />
          <SegField k="dir" label="Direction" options={[{ value: 'forward', label: 'Forward' }, { value: 'reverse', label: 'Reverse' }, { value: 'pingpong', label: 'Ping-pong' }]} />
          <SegField k="endMode" label="At the end" options={[{ value: 'loop', label: 'Loop' }, { value: 'once', label: 'Play once' }]} />
          <Check k="onion">Onion skin on the preview</Check>
        </div>
      )}
    </Panel>
  );
}

// ---------- 7 · Export ----------

function BatchBox() {
  const file = useRef<HTMLInputElement>(null);
  const [status, setBatchStatus] = useState<{ msg: string; err: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <details className="more sub">
      <summary>Batch: several images at once</summary>
      <p className="hint">Processes more images with these settings into one .zip. Pixel edits are not applied.</p>
      <Check k="batchPalette">Snap them all to this palette</Check>
      <button type="button" className="ghost" disabled={busy} onClick={() => file.current?.click()}>Choose images…</button>
      <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => {
        const files = [...(e.target.files || [])];
        e.target.value = '';
        setBusy(true);
        runBatch(files, (msg, err = false) => setBatchStatus({ msg, err })).finally(() => setBusy(false));
      }} />
      <p className={status?.err ? 'status err' : 'status'} role="status">{status?.msg}</p>
    </details>
  );
}

export function ExportStep() {
  const s = useSettings();
  pxBus.use('anim', 'result');
  const frames = animInfo().anim?.frames.length ?? 0;
  const hasAnim = s.animOn && frames > 0;
  return (
    <Panel step="export" title="Export">
      <div className="sub">
        <span className="label">Image</span>
        <div className="row"><span>Scale</span><NumberSetting k="scale" label="Download scale" min={1} max={64} /><span>×</span></div>
        <div className="btns">
          <button type="button" onClick={() => report(downloadResult(1))}>PNG 1×</button>
          <button type="button" className="ghost" onClick={() => report(downloadResult(scaleValue()))}>PNG ×{scaleValue()}</button>
        </div>
        <p className="hint">1× is the real pixel art. The scaled copy is for sharing.</p>
        <button type="button" className="ghost" id="toSprite" onClick={() => {
          if (app.result && loadFrames(animFrameCanvases() ?? [app.resultCanvas], app.source?.name || 'sprite')) setMode('sprite');
        }}>Edit in the sprite editor</button>
      </div>
      {hasAnim && (
        <div className="sub">
          <span className="label">Animation</span>
          <button type="button" onClick={() => report(downloadStrip())}>Strip PNG for GameMaker</button>
          <p className="hint">Saved as <code>_stripN.png</code>, which GameMaker splits into frames on import.</p>
          <div className="row">
            <span>GIF scale</span><NumberSetting k="gifScale" label="GIF scale" min={1} max={32} />
            <button type="button" className="ghost small" style={{ flex: 1 }} onClick={() => report(downloadGif())}>GIF</button>
          </div>
          <details className="more">
            <summary>More formats</summary>
            <div className="row">
              <span>Columns</span><NumberSetting k="sheetCols" label="Sheet columns, 0 for auto" min={0} />
              <span>Padding</span><NumberSetting k="sheetPad" label="Sheet padding in px" min={0} />
            </div>
            <button type="button" className="ghost" onClick={() => report(downloadSheet())}>Sheet PNG</button>
            <button type="button" className="ghost" onClick={() => report(downloadFramesZip())}>Frames ZIP</button>
            <Check k="repeatHolds">Repeat frames by their duration</Check>
            <p className="hint">Columns 0 makes a square-ish sheet.</p>
          </details>
        </div>
      )}
      <BatchBox />
      <div className="sub">
        <p className="hint">Settings are remembered in this browser.</p>
        <button type="button" className="ghost small" onClick={() => { resetSettings(); setStatus('Settings reset.'); setSettings({}); }}>Reset all settings</button>
      </div>
    </Panel>
  );
}
