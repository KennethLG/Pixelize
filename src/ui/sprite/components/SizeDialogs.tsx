// File › New sprite… and Sprite › Canvas size…: small windows that ask for a size.

import { useEffect, useState } from 'react';
import { NumberField, Seg } from '../../components/common';
import { setOption } from '../actions';
import { MAX_SIDE, newSprite, resizeSprite } from '../io';
import { closeDialog, sp } from '../state';

const PRESETS = [16, 24, 32, 48, 64, 96, 128];

/** The frame of a small window: title, body, and the buttons at the bottom. Enter confirms, Escape closes. */
function SmallDialog(props: { title: string; ok: string; onOk: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeDialog(); }
      // Enter in a number field commits it first (on blur), then confirms
      if (e.key === 'Enter') { e.preventDefault(); (document.activeElement as HTMLElement)?.blur?.(); setTimeout(props.onOk, 0); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.onOk]);
  return (
    <div className="opt-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) closeDialog(); }}>
      <div className="opt-dialog panel size-dialog" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="opt-head">
          <h2>{props.title}</h2>
          <button type="button" className="ghost small" aria-label="Close" onClick={closeDialog}>×</button>
        </div>
        <div className="size-body">{props.children}</div>
        <div className="exp-foot">
          <button type="button" className="ghost" onClick={closeDialog}>Cancel</button>
          <button type="button" onClick={props.onOk}>{props.ok}</button>
        </div>
      </div>
    </div>
  );
}

function SizeFields(props: { w: number; h: number; setW: (v: number) => void; setH: (v: number) => void }) {
  return (
    <>
      <div className="exp-row">
        <span>Size</span>
        <NumberField value={props.w} min={1} max={MAX_SIDE} label="Width" onCommit={props.setW} live />
        <span className="muted">×</span>
        <NumberField value={props.h} min={1} max={MAX_SIDE} label="Height" onCommit={props.setH} live />
        <span className="muted">px</span>
      </div>
      <div className="exp-row size-presets">
        <span />
        {PRESETS.map((n) => (
          <button key={n} type="button" className={'ghost small' + (props.w === n && props.h === n ? ' on' : '')} onClick={() => { props.setW(n); props.setH(n); }}>{n}</button>
        ))}
      </div>
    </>
  );
}

export function NewSpriteDialog() {
  const [w, setW] = useState(sp.doc.w);
  const [h, setH] = useState(sp.doc.h);
  const ok = () => { closeDialog(); newSprite(w, h); };
  return (
    <SmallDialog title="New sprite" ok="Create" onOk={ok}>
      <SizeFields w={w} h={h} setW={setW} setH={setH} />
      <p className="hint">One layer, one frame. The current sprite is replaced (you are asked first if it has art).</p>
    </SmallDialog>
  );
}

export function CanvasSizeDialog() {
  const [w, setW] = useState(sp.doc.w);
  const [h, setH] = useState(sp.doc.h);
  const [mode, setMode] = useState(sp.canvasMode);
  const ok = () => { setOption('canvasMode', mode); closeDialog(); resizeSprite(w, h); };
  return (
    <SmallDialog title="Canvas size" ok="Resize" onOk={ok}>
      <SizeFields w={w} h={h} setW={setW} setH={setH} />
      <Seg name="canvasSizeMode" label="When the canvas changes size" value={mode} small={false}
        options={[
          { value: 'keep', label: 'Keep pixel size', title: 'The art keeps its size; space is added or cut around it' },
          { value: 'stretch', label: 'Stretch art', title: 'The art stretches with the canvas' },
        ]}
        onChange={setMode} />
      <p className="hint">Now {sp.doc.w}×{sp.doc.h}. {mode === 'keep' ? 'The art stays centered.' : 'Every frame and layer is scaled.'} The Canvas tool (C) does this by dragging the edges.</p>
    </SmallDialog>
  );
}
