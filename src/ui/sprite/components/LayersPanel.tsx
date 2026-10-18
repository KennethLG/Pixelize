// Layers, top layer first: click to select, eye to hide, double click to
// rename, drag to reorder, and an opacity slider for the selected one.

import { useRef, useState } from 'react';
import { addLayer, duplicateLayer, mergeDown, moveLayer, removeLayer } from '../../../core/sprite';
import { useSp } from '../hooks';
import { emit, pushDoc, setLayer, sp } from '../state';
import { useReorder } from './useReorder';

function moveTo(from: number, to: number): void {
  if (to < 0 || to >= sp.doc.layers.length || from === to) return;
  pushDoc();
  moveLayer(sp.doc, from, to);
  sp.layer = to;
  emit('structure', 'cursor', 'pixels');
}

function RenameField(props: { index: number; onDone: () => void }) {
  const [name, setName] = useState(sp.doc.layers[props.index].name);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const v = name.trim();
    if (save && v && v !== sp.doc.layers[props.index].name) { pushDoc(); sp.doc.layers[props.index].name = v; emit('structure'); }
    props.onDone();
  };
  return (
    <input
      type="text"
      className="sp-lrename"
      autoFocus
      value={name}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setName(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); }}
      onBlur={() => finish(true)}
    />
  );
}

export function LayersPanel() {
  useSp('structure', 'cursor', 'pixels');
  const [renaming, setRenaming] = useState<number | null>(null);
  const sliding = useRef(false);
  // the list shows the top layer first, so dropping "before" an item means above it: a higher index
  const { itemProps, marks } = useReorder('y', (from, over, before) => {
    let to = before ? over + 1 : over;
    if (from < to) to--;
    moveTo(from, to);
  });
  const layers = sp.doc.layers, cur = layers[sp.layer];
  const order = layers.map((_, i) => i).reverse();

  const act = (fn: () => boolean | void, cursor: () => void) => { pushDoc(); if (fn() !== false) { cursor(); emit('structure', 'cursor', 'pixels'); } };

  return (
    <div className="panel sp-layers-panel">
      <div className="pal-head">
        <span className="label">Layers</span>
        <div className="group">
          <button type="button" className="ghost small" title="New layer" onClick={() => act(() => addLayer(sp.doc, sp.layer + 1), () => sp.layer++)}>+</button>
          <button type="button" className="ghost small" title="Duplicate layer" onClick={() => act(() => duplicateLayer(sp.doc, sp.layer), () => sp.layer++)}>Dup</button>
          <button type="button" className="ghost small" title="Move up" aria-label="Move layer up" disabled={sp.layer >= layers.length - 1} onClick={() => moveTo(sp.layer, sp.layer + 1)}>↑</button>
          <button type="button" className="ghost small" title="Move down" aria-label="Move layer down" disabled={sp.layer < 1} onClick={() => moveTo(sp.layer, sp.layer - 1)}>↓</button>
          <button type="button" className="ghost small" title="Merge into the layer below" disabled={sp.layer < 1} onClick={() => act(() => mergeDown(sp.doc, sp.layer), () => sp.layer--)}>Merge</button>
          <button type="button" className="ghost small" title="Delete layer" aria-label="Delete layer" disabled={layers.length < 2} onClick={() => act(() => removeLayer(sp.doc, sp.layer), () => { sp.layer = Math.max(0, sp.layer - 1); })}>×</button>
        </div>
      </div>
      <div className="sp-layers" id="spLayers">
        {order.map((li) => {
          const l = layers[li];
          return (
            <div
              key={li}
              className={'sp-layer' + (li === sp.layer ? ' sel' : '') + (l.visible ? '' : ' hidden-layer') + marks(li)}
              tabIndex={0}
              onClick={() => setLayer(li)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setLayer(li); } }}
              {...itemProps(li)}
            >
              <button
                type="button"
                className="sp-eye"
                title={l.visible ? 'Hide layer' : 'Show layer'}
                aria-pressed={l.visible}
                onClick={(e) => { e.stopPropagation(); pushDoc(); l.visible = !l.visible; emit('structure', 'pixels'); }}
              >{l.visible ? '◉' : '○'}</button>
              {renaming === li
                ? <RenameField index={li} onDone={() => setRenaming(null)} />
                : <span className="sp-lname" title="Double click to rename" onDoubleClick={() => setRenaming(li)}>{l.name}</span>}
              <small>{l.opacity < 1 ? `${Math.round(l.opacity * 100)}%` : ''}</small>
            </div>
          );
        })}
      </div>
      <div className="row">
        <span>Opacity</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(cur.opacity * 100)}
          aria-label="Layer opacity"
          onChange={(e) => {
            // one undo step per slider drag
            if (!sliding.current) { pushDoc(); sliding.current = true; }
            cur.opacity = Number(e.target.value) / 100;
            emit('pixels');
          }}
          onPointerUp={() => { sliding.current = false; emit('structure'); }}
          onKeyUp={() => { sliding.current = false; emit('structure'); }}
        />
        <output>{Math.round(cur.opacity * 100)}%</output>
      </div>
    </div>
  );
}
