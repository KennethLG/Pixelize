// Variants: color swaps of the whole sprite (red team, blue team, elite…).
// Each one maps some colors to others; the canvas can show it, and every
// variant exports at once into a ZIP.

import { useRef, useState, type CSSProperties } from 'react';
import { hex, hexToRgb, rgbOfKey } from '../../../core/color';
import { usedColors } from '../../../core/sprite';
import { FloatingPanel } from '../../components/FloatingPanel';
import { HsvPicker } from '../../components/HsvPicker';
import { NumberField, Seg } from '../../components/common';
import { setStatus } from '../../dom';
import { exportVariantsZip } from '../io';
import { useSp } from '../hooks';
import { emit, pushDoc, sp } from '../state';

export function VariantsPanel() {
  useSp('view', 'structure', 'pixels');
  const [sel, setSel] = useState(0);
  const [row, setRow] = useState<string | null>(null);
  const [format, setFormat] = useState<'strip' | 'gif' | 'png'>('strip');
  const [scale, setScale] = useState(1);
  // one undo step per color being edited
  const pushed = useRef(false);

  if (!sp.variantsOpen) return null;
  const vs = sp.doc.variants, v = vs[Math.min(sel, vs.length - 1)];
  const idx = v ? vs.indexOf(v) : -1;
  const colors = usedColors(sp.doc).slice(0, 64).map((k) => hex(rgbOfKey(k)));

  const close = () => { sp.variantsOpen = false; sp.showVariant = null; emit('view'); };
  const show = (i: number | null) => { sp.showVariant = i; emit('view'); };
  const add = () => {
    pushDoc();
    vs.push({ name: `Variant ${vs.length + 1}`, map: {} });
    setSel(vs.length - 1);
    show(vs.length - 1);
    emit('structure');
  };
  const edit = (fn: () => void, once = false) => {
    if (!once || !pushed.current) pushDoc();
    pushed.current = once;
    fn();
    emit('structure', 'view');
  };

  return (
    <FloatingPanel title="Variants" onClose={close} className="sp-variants" at={{ right: 24, top: 160 }}>
      <div className="row">
        {vs.length > 0 && (
          <select aria-label="Variant" value={idx} onChange={(e) => { const i = Number(e.target.value); setSel(i); setRow(null); show(i); }}>
            {vs.map((x, i) => <option key={i} value={i}>{x.name}</option>)}
          </select>
        )}
        <button type="button" className="ghost small" onClick={add}>+ New variant</button>
      </div>
      {!v && <p className="hint">A variant swaps some colors of the whole sprite: the same character in red, blue or gold. Make one, pick new colors, and export them all at once.</p>}
      {v && (
        <>
          <div className="row">
            <input type="text" aria-label="Variant name" defaultValue={v.name} key={`${idx}-${v.name}`}
              onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== v.name) edit(() => { v.name = name; }); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
            <label className="check"><input type="checkbox" checked={sp.showVariant === idx} onChange={(e) => show(e.target.checked ? idx : null)} />Show</label>
            <button type="button" className="ghost small" onClick={() => { edit(() => { vs.splice(idx, 1); }); setSel(0); setRow(null); show(null); }}>Delete</button>
          </div>
          <div className="var-rows">
            {colors.map((from) => {
              const to = v.map[from];
              return (
                <button key={from} type="button" className={'var-row' + (row === from ? ' sel' : '')} onClick={() => { setRow(row === from ? null : from); pushed.current = false; }}>
                  <i style={{ '--c': from } as CSSProperties} /><span>→</span>
                  <i className={to ? '' : 'same'} style={{ '--c': to ?? from } as CSSProperties} />
                  <code>{to ? to : 'same'}</code>
                </button>
              );
            })}
          </div>
          {row && (
            <div className="var-pick">
              <HsvPicker color={hexToRgb(v.map[row] ?? row)} onChange={(c) => edit(() => { v.map[row] = hex(c); }, true)} />
              <button type="button" className="ghost small" onClick={() => edit(() => { delete v.map[row]; })}>Keep the original color</button>
            </div>
          )}
          <div className="var-export">
            <span className="label">Export every variant</span>
            <div className="row">
              <Seg name="spVarFormat" label="Format" value={format}
                options={[{ value: 'strip', label: 'Strip' }, { value: 'gif', label: 'GIF' }, { value: 'png', label: 'This frame' }]} onChange={setFormat} />
              <NumberField value={scale} min={1} max={32} label="Export scale" title="Scale" onCommit={setScale} live /><span className="muted">×</span>
            </div>
            <button type="button" onClick={() => exportVariantsZip(format, scale).catch((e) => setStatus((e as Error).message, true))}>Export ZIP</button>
            <p className="hint">The ZIP has the original and one file per variant.</p>
          </div>
        </>
      )}
    </FloatingPanel>
  );
}
