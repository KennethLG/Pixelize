// The colors used in the sprite, and the user's own palette.

import { useEffect, useRef, useState } from 'react';
import { keyOf, rgbOfKey, type RGB } from '../../../core/color';
import { parsePaletteText } from '../../../core/paletteText';
import { usedColors } from '../../../core/sprite';
import { setStatus } from '../../dom';
import { decodeFile, imageToData } from '../../input';
import { pickSlot } from '../actions';
import { useSp } from '../hooks';
import { addToPalette, clearPalette, removeFromPalette, userPalette } from '../prefs';
import { setColor, sp, versions } from '../state';
import { Swatch } from './common';

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
    </div>
  );
}
