// The colors used in the sprite, and the user's own palette.

import { useEffect, useRef, useState } from 'react';
import { keyOf, rgbOfKey, type RGB } from '../../../core/color';
import { parsePaletteText } from '../../../core/paletteText';
import { usedColors } from '../../../core/sprite';
import { setStatus } from '../../dom';
import { decodeFile, imageToData } from '../../input';
import { pickSlot } from '../actions';
import { useSp } from '../hooks';
import { addRamp, addToPalette, clearPalette, ramps, removeFromPalette, removeRamp, setPaletteLock, userPalette } from '../prefs';
import { DEFAULT_RAMP, hueShiftRamp } from '../../../core/shading';
import { NumberField } from '../../components/common';
import { setColor, sp, versions } from '../state';
import { Swatch } from '../../components/common';

async function readPaletteFile(file: File): Promise<RGB[]> {
  if (!file.type.startsWith('image/')) return parsePaletteText(await file.text());
  const { data } = imageToData(await decodeFile(file));
  const seen = new Set<number>(), cols: RGB[] = [];
  for (let i = 0; i < data.length && cols.length < 256; i += 4) {
    const k = keyOf(data[i], data[i + 1], data[i + 2]);
    if (data[i + 3] >= 128 && !seen.has(k)) { seen.add(k); cols.push(rgbOfKey(k)); }
  }
  return cols;
}

/** Scanning every cel can wait a moment after a stroke. */
function useUsedColors(): number[] {
  useSp('pixels', 'structure');
  const stamp = `${versions.get('pixels') || 0}.${versions.get('structure') || 0}`;
  const [keys, setKeys] = useState(() => usedColors(sp.doc).slice(0, 256));
  useEffect(() => {
    const t = setTimeout(() => setKeys(usedColors(sp.doc).slice(0, 256)), 150);
    return () => clearTimeout(t);
  }, [stamp]);
  return keys;
}

/** Ramps: generated from the primary color with hue shifting, saved for the shading brush. */
function Ramps(props: { onPick: (rgb: RGB) => void; onSecondary: (rgb: RGB) => void }) {
  const [opts, setOpts] = useState(DEFAULT_RAMP);
  const p = sp.primary;
  const preview = p[3] ? hueShiftRamp([p[0], p[1], p[2]], opts) : [];
  return (
    <details className="sp-ramps">
      <summary className="label">Ramps{ramps.length ? ` · ${ramps.length}` : ''}</summary>
      <div className="row ramp-opts">
        <span>Steps</span><NumberField value={opts.steps} min={1} max={4} label="Steps on each side" onCommit={(v) => setOpts({ ...opts, steps: Math.round(v) })} live />
        <span>Hue</span><NumberField value={opts.hueShift} min={0} max={45} label="Hue shift per step, in degrees" title="How far shadows turn toward blue and highlights toward yellow" onCommit={(v) => setOpts({ ...opts, hueShift: Math.round(v) })} live />
        <span>Contrast</span><NumberField value={Math.round(opts.contrast * 100)} min={4} max={30} label="Brightness change per step, in percent" onCommit={(v) => setOpts({ ...opts, contrast: v / 100 })} live />
      </div>
      {preview.length > 0 ? (
        <div className="ramp" title="From the primary color: darker on the left, lighter on the right">
          {preview.map((c, i) => <Swatch key={i} rgb={c} onPick={() => props.onPick(c)} onSecondary={() => props.onSecondary(c)} />)}
        </div>
      ) : <p className="hint">Pick a primary color to build a ramp from it.</p>}
      <div className="btns">
        <button type="button" className="ghost small" disabled={!preview.length} title="Keep it for the shading brush" onClick={() => addRamp(preview)}>Save ramp</button>
        <button type="button" className="ghost small" disabled={!preview.length} onClick={() => addToPalette(preview)}>+ My palette</button>
      </div>
      {ramps.map((r, i) => (
        <div key={i} className="ramp saved">
          {r.map((c, k) => <Swatch key={k} rgb={c} onPick={() => props.onPick(c)} onSecondary={() => props.onSecondary(c)} />)}
          <button type="button" className="ghost small" title="Add these colors to My palette" onClick={() => addToPalette(r)}>+</button>
          <button type="button" className="ghost small" aria-label="Delete this ramp" onClick={() => removeRamp(i)}>×</button>
        </div>
      ))}
      <p className="hint">The shading brush steps along these ramps (or My palette in its order when there are none).</p>
    </details>
  );
}

export function Palettes() {
  useSp('palette', 'color');
  const used = useUsedColors();
  const file = useRef<HTMLInputElement>(null);
  const p = sp.primary, selKey = p[3] ? keyOf(p[0], p[1], p[2]) : -1;
  // a palette click is for drawing: the picker goes back to the primary color
  const pickPrimary = (rgb: RGB) => { if (sp.pickSlot === 'paper') pickSlot('primary'); setColor('primary', [...rgb, 255]); };
  const pickSecondary = (rgb: RGB) => setColor('secondary', [...rgb, 255]);

  const importFile = async (f: File) => {
    const cols = await readPaletteFile(f);
    if (!cols.length) { setStatus('No colors found in that file.', true); return; }
    addToPalette(cols);
    setStatus(`Added ${cols.length} colors from ${f.name}`);
  };

  return (
    <div className="panel sp-palettes">
      <div className="pal-head"><span className="label">In this sprite · <span id="spUsedCount">{used.length}</span></span></div>
      <div className="sp-swatches" id="spUsed">
        {used.map((k) => { const rgb = rgbOfKey(k); return <Swatch key={k} rgb={rgb} selected={k === selKey} onPick={() => pickPrimary(rgb)} onSecondary={() => pickSecondary(rgb)} />; })}
      </div>
      {!used.length && <p className="hint">The colors you draw with show up here.</p>}
      <div className="pal-head sp-pal-head">
        <span className="label" title="Click: primary. Right click: secondary. Ctrl+click removes a color.">My palette</span>
        <div className="group">
          <button type="button" className="ghost small" title="Add the primary color" onClick={() => { if (p[3]) addToPalette([[p[0], p[1], p[2]]]); }}>+ Add</button>
          <button type="button" className="ghost small" title="Add every color of the sprite" onClick={() => addToPalette(usedColors(sp.doc).map(rgbOfKey))}>+ Sprite</button>
          <button type="button" className="ghost small" title="Load a .hex, .gpl or PNG palette" onClick={() => file.current?.click()}>Load</button>
          <button type="button" className="ghost small" title="Remove every color" onClick={() => { if (userPalette.length && confirm('Remove every color from your palette?')) clearPalette(); }}>Clear</button>
        </div>
      </div>
      <input
        ref={file}
        type="file"
        accept="image/*,.hex,.gpl,.txt,.pal"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f).catch((err) => setStatus((err as Error).message, true)); e.target.value = ''; }}
      />
      <div className="sp-swatches" id="spPal">
        {userPalette.map((c, i) => (
          <Swatch
            key={`${i}-${keyOf(...c)}`}
            rgb={c}
            selected={keyOf(...c) === selKey}
            onPick={(e) => { if (e.ctrlKey || e.metaKey) removeFromPalette(i); else pickPrimary(c); }}
            onSecondary={() => pickSecondary(c)}
          />
        ))}
      </div>
      {!userPalette.length && <p className="hint">Empty. Add colors or load a Lospec palette.</p>}
      <label className="check" title="Everything you paint, fill or paste snaps to the closest color of My palette">
        <input type="checkbox" checked={sp.paletteLock} disabled={!userPalette.length} onChange={(e) => setPaletteLock(e.target.checked)} />Lock to my palette
      </label>
      <Ramps onPick={pickPrimary} onSecondary={pickSecondary} />
    </div>
  );
}
