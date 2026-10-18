// The bar above the canvas: options of the current tool, and what you can do
// with the selection when there is one.

import { commitFloating, deselect, sp } from '../state';
import { deleteSelection, setBrush, setOption, transform } from '../actions';
import { selectAll, selectionBox } from '../canvas';
import { copy, cut } from '../io';
import { useSp } from '../hooks';
import { Seg } from '../../components/common';

const HINTS: Partial<Record<typeof sp.tool, string>> = {
  rect: 'Shift: square or circle. Right click: secondary color.',
  ellipse: 'Shift: square or circle. Right click: secondary color.',
  select: 'Shift adds, Alt subtracts. Drag inside the selection to move it, or its squares to resize it.',
  wand: 'Shift adds, Alt subtracts. Drag inside the selection to move it, or its squares to resize it.',
  move: 'Drag to move the selection, or the whole layer if nothing is selected. Arrow keys move 1 px.',
  picker: 'Left click: primary color. Right click: secondary.',
  pan: 'Drag to move the view. Scroll to zoom.',
  canvas: 'Drag the orange squares on the edges of the paper. Drag elsewhere to move the view.',
};

function SelectionActions() {
  const box = selectionBox();
  if (!box) return null;
  const btn = (label: string, title: string, fn: () => void) => (
    <button type="button" className="ghost small" title={title} onClick={fn}>{label}</button>
  );
  return (
    <div className="group sp-sel">
      <span className="tag">{`${box.w}×${box.h}${sp.floating ? ' · moving' : ''}`}</span>
      {btn('×2', 'Make it twice as big', () => transform((w, h) => [w * 2, h * 2]))}
      {btn('½', 'Make it half as big', () => transform((w, h) => [w / 2, h / 2]))}
      {btn('Flip ↔', 'Flip horizontally', () => transform(() => 'flipH'))}
      {btn('Flip ↕', 'Flip vertically', () => transform(() => 'flipV'))}
      {btn('Copy', 'Copy (Ctrl+C)', copy)}
      {btn('Cut', 'Cut (Ctrl+X)', cut)}
      {btn('Delete', 'Delete', deleteSelection)}
      {btn('Apply', 'Put the moved pixels down (Enter)', commitFloating)}
      {btn('Deselect', 'Deselect (Ctrl+D or Esc)', deselect)}
    </div>
  );
}

export function ToolOptions() {
  useSp('tool', 'selection', 'pixels');
  const t = sp.tool;
  const hasSelection = !!(sp.mask || sp.floating);
  return (
    <div className="sp-options panel">
      {(t === 'pencil' || t === 'eraser' || t === 'rect' || t === 'ellipse') && (
        <div className="group">
          <span className="muted">Brush</span>
          <input type="range" min={1} max={16} value={Math.min(16, sp.brush)} aria-label="Brush size slider" onChange={(e) => setBrush(Number(e.target.value))} />
          <input type="number" min={1} max={32} value={sp.brush} aria-label="Brush size in pixels" onChange={(e) => setBrush(Number(e.target.value))} />
          <span className="muted">px <kbd>[</kbd> <kbd>]</kbd></span>
        </div>
      )}
      {(t === 'rect' || t === 'ellipse') && (
        <Seg name="spRectMode" label="Shape" value={sp.rectFilled ? 'filled' : 'outline'}
          options={[{ value: 'outline', label: 'Outline' }, { value: 'filled', label: 'Filled' }]}
          onChange={(v) => setOption('rectFilled', v === 'filled')} />
      )}
      {t === 'bucket' && (
        <>
          <Seg name="spBucketMode" label="Bucket" value={sp.bucketMode}
            options={[
              { value: 'fill', label: 'Fill area', title: 'Fill the connected area' },
              { value: 'replace', label: 'Replace color', title: 'Repaint every pixel of the clicked color on this layer' },
            ]}
            onChange={(v) => setOption('bucketMode', v)} />
          {sp.bucketMode === 'replace' && (
            <label className="check">
              <input type="checkbox" checked={sp.replaceAllFrames} onChange={(e) => setOption('replaceAllFrames', e.target.checked)} />In every frame
            </label>
          )}
        </>
      )}
      {t === 'wand' && (
        <label className="check">
          <input type="checkbox" checked={sp.contiguous} onChange={(e) => setOption('contiguous', e.target.checked)} />Only connected pixels
        </label>
      )}
      {t === 'canvas' && (
        <Seg name="spCanvasMode" label="When the canvas changes size" value={sp.canvasMode}
          options={[
            { value: 'keep', label: 'Keep pixel size', title: 'The art keeps its size; space is added or cut around it' },
            { value: 'stretch', label: 'Stretch art', title: 'The art stretches with the paper' },
          ]}
          onChange={(v) => setOption('canvasMode', v)} />
      )}
      {!hasSelection && HINTS[t] && <span className="hint">{HINTS[t]}</span>}
      {hasSelection && <SelectionActions />}
      <button type="button" className="ghost small sp-selall" title="Select all (Ctrl+A)" onClick={selectAll}>Select all</button>
    </div>
  );
}
