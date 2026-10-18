// The drawing area and the bar under it (zoom, grid, onion skin, paper).
// The canvas itself is driven by the engine in canvas.ts.

import { useEffect, useRef, type CSSProperties } from 'react';
import { hex } from '../../../core/color';
import { pickSlot, setPaperMode, setTileMode } from '../actions';
import { attachCanvas, fitView, hoverText, zoomPercent, zoomStep } from '../canvas';
import { useSp } from '../hooks';
import { clampGrid } from '../prefs';
import { emit, sp } from '../state';
import { NumberField, Seg } from '../../components/common';

function HoverReadout() {
  useSp('hover', 'structure');
  return <code className="muted" id="spPos">{hoverText()}</code>;
}

export function CanvasPanel() {
  useSp('view', 'paper', 'color');
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => attachCanvas(stage.current!, canvas.current!), []);

  const setGrid = (patch: Partial<Pick<typeof sp, 'showGrid' | 'gridW' | 'gridH'>>) => { Object.assign(sp, patch); emit('view'); };

  return (
    <div className="panel sp-canvas-panel">
      <div className="sp-stage" id="spStage" ref={stage}>
        <canvas id="spCanvas" ref={canvas} tabIndex={0} aria-label="Sprite canvas" />
      </div>
      <div className="toolbar">
        <div className="group">
          <button type="button" className="ghost small" title="Zoom out (−)" aria-label="Zoom out" onClick={() => zoomStep(-1)}>−</button>
          <output id="spZoom">{zoomPercent()}%</output>
          <button type="button" className="ghost small" title="Zoom in (+)" aria-label="Zoom in" onClick={() => zoomStep(1)}>+</button>
          <button type="button" className="ghost small" title="Fit (0)" onClick={fitView}>Fit</button>
          <label className="check"><input type="checkbox" checked={sp.showGrid} onChange={(e) => setGrid({ showGrid: e.target.checked })} />Grid</label>
          <NumberField id="spGridW" value={sp.gridW} min={1} max={512} label="Grid cell width" title="Grid cell size in pixels (1 = every pixel)" onCommit={(v) => setGrid({ gridW: clampGrid(v) })} live />
          <span className="muted">×</span>
          <NumberField id="spGridH" value={sp.gridH} min={1} max={512} label="Grid cell height" title="Grid cell size in pixels (1 = every pixel)" onCommit={(v) => setGrid({ gridH: clampGrid(v) })} live />
          <label className="check"><input type="checkbox" checked={sp.onion} onChange={(e) => { sp.onion = e.target.checked; emit('view'); }} />Onion skin</label>
          <label className="check" title="Show 3 × 3 copies of the canvas; strokes wrap around the edges, for seamless tiles"><input type="checkbox" checked={sp.tileMode} onChange={(e) => setTileMode(e.target.checked)} />Tile</label>
        </div>
        <div className="group" role="group" aria-label="Paper">
          <span className="muted">Paper</span>
          <Seg name="spPaper" label="Paper background" value={sp.paperMode}
            options={[{ value: 'checker', label: 'Checker' }, { value: 'color', label: 'Color' }]}
            onChange={setPaperMode} />
          <button
            type="button"
            className={sp.pickSlot === 'paper' ? 'sp-slot on' : 'sp-slot'}
            id="spPaperColor"
            aria-label="Paper color"
            title={`Paper color: ${hex(sp.paperColor)}. Click to edit it with the color picker.`}
            style={{ '--c': hex(sp.paperColor) } as CSSProperties}
            onClick={() => pickSlot('paper')}
          />
        </div>
        <HoverReadout />
      </div>
    </div>
  );
}
