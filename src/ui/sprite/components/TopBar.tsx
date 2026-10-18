// File actions, canvas size, undo/redo and exports.

import { useRef, useState } from 'react';
import { setStatus } from '../../dom';
import { useSp } from '../hooks';
import { MAX_SIDE, exportGif, exportPng, exportStrip, newSprite, openFile, resizeSprite, saveProject } from '../io';
import { canRedo, canUndo, redo, sp, undo } from '../state';
import { NumberField } from '../../components/common';

const report = (p: Promise<unknown>) => { p.catch((e) => setStatus((e as Error).message, true)); };

export function TopBar() {
  useSp('structure', 'pixels', 'selection');
  const file = useRef<HTMLInputElement>(null);
  // what the size fields hold; they follow the canvas when it changes
  const [w, setW] = useState(sp.doc.w);
  const [h, setH] = useState(sp.doc.h);
  const [shown, setShown] = useState(`${sp.doc.w}x${sp.doc.h}`);
  if (shown !== `${sp.doc.w}x${sp.doc.h}`) { setShown(`${sp.doc.w}x${sp.doc.h}`); setW(sp.doc.w); setH(sp.doc.h); }
  const [scale, setScale] = useState(1);
  // what Strip and GIF export: everything, or one tag
  const [what, setWhat] = useState('all');
  const tag = what === 'all' || !sp.doc.tags[Number(what)] ? null : Number(what);

  return (
    <div className="sp-bar panel">
      <div className="group">
        <button type="button" className="ghost small" title="Open a PNG, a _stripN.png strip or a .pixelize file" onClick={() => file.current?.click()}>Open…</button>
        <input
          ref={file}
          type="file"
          accept="image/*,.pixelize,.json"
          hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) report(openFile(f)); e.target.value = ''; }}
        />
        <button type="button" className="ghost small" title="Save layers and frames as a .pixelize file" onClick={() => report(saveProject())}>Save project</button>
      </div>
      <div className="group">
        <NumberField value={w} min={1} max={MAX_SIDE} label="Width" onCommit={setW} live />
        <span className="muted">×</span>
        <NumberField value={h} min={1} max={MAX_SIDE} label="Height" onCommit={setH} live />
        <button type="button" className="ghost small" title="Start a blank sprite of this size" onClick={() => newSprite(w, h)}>New</button>
        <button type="button" className="ghost small" title="Change the canvas size (keeping the art centered, or stretching it with the Canvas tool's option)" onClick={() => resizeSprite(w, h)}>Resize canvas</button>
      </div>
      <div className="group">
        <button type="button" className="ghost small" title="Undo (Ctrl+Z)" disabled={!canUndo()} onClick={undo}>Undo</button>
        <button type="button" className="ghost small" title="Redo (Ctrl+Y)" disabled={!canRedo()} onClick={redo}>Redo</button>
      </div>
      <div className="group sp-export">
        <span className="muted">Export</span>
        <NumberField value={scale} min={1} max={64} label="Export scale" title="Scale" onCommit={setScale} live />
        <span className="muted">×</span>
        <button type="button" className="small" title="The current frame" onClick={() => report(exportPng(scale))}>PNG</button>
        {sp.doc.tags.length > 0 && (
          <select aria-label="Frames to export" title="Strip and GIF export all frames or one tag" value={tag === null ? 'all' : String(tag)} onChange={(e) => setWhat(e.target.value)}>
            <option value="all">All frames</option>
            {sp.doc.tags.map((t, i) => <option key={i} value={String(i)}>{t.name}</option>)}
          </select>
        )}
        <button type="button" className="small" title="The frames side by side, named _stripN.png for GameMaker" onClick={() => report(exportStrip(scale, tag))}>Strip</button>
        <button type="button" className="small" onClick={() => report(exportGif(scale, tag))}>GIF</button>
      </div>
      <p className="status" id="spStatus" role="status" />
    </div>
  );
}
