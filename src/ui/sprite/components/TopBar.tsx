// File actions, canvas size, undo/redo and exports.

import { useRef, useState } from 'react';
import { setStatus } from '../../dom';
import { useSp } from '../hooks';
import { MAX_SIDE, newSprite, openFile, resizeSprite, saveProject } from '../io';
import { keyLabel } from '../../keys';
import { canRedo, canUndo, emit, redo, sp, undo } from '../state';
import { NumberField } from '../../components/common';

const report = (p: Promise<unknown>) => { p.catch((e) => setStatus((e as Error).message, true)); };

export function TopBar() {
  useSp('structure', 'pixels', 'selection', 'view');
  const file = useRef<HTMLInputElement>(null);
  // what the size fields hold; they follow the canvas when it changes
  const [w, setW] = useState(sp.doc.w);
  const [h, setH] = useState(sp.doc.h);
  const [shown, setShown] = useState(`${sp.doc.w}x${sp.doc.h}`);
  if (shown !== `${sp.doc.w}x${sp.doc.h}`) { setShown(`${sp.doc.w}x${sp.doc.h}`); setW(sp.doc.w); setH(sp.doc.h); }

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
        <button type="button" className="ghost small" title={`Open a sprite of a GameMaker project, with its layers (${keyLabel('sprite.openGm')})`} onClick={() => { sp.gmOpen = true; emit('view'); }}>From GameMaker…</button>
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
      <div className="group">
        <button type="button" className="ghost small" title="Look for orphan pixels, jaggies, banding and colors that are almost the same" aria-pressed={sp.checkOpen}
          onClick={() => { sp.checkOpen = !sp.checkOpen; if (!sp.checkOpen) { sp.issues = []; sp.issueFocus = null; } emit('view'); }}>Check</button>
        <button type="button" className="ghost small" title="Color variants of the sprite (red team, blue team…)" aria-pressed={sp.variantsOpen}
          onClick={() => { sp.variantsOpen = !sp.variantsOpen; if (!sp.variantsOpen) sp.showVariant = null; emit('view'); }}>Variants</button>
      </div>
      <div className="group sp-export">
        <button type="button" className="small" title={`PNG, strip, GIF or straight into a GameMaker project, with a preview (${keyLabel('sprite.export')})`} onClick={() => { sp.exportOpen = true; emit('view'); }}>Export…</button>
      </div>
      <p className="status" id="spStatus" role="status" />
    </div>
  );
}
