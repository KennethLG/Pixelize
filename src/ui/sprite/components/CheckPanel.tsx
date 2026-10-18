// Check: finds orphan pixels, jaggies, banding and near-duplicate colors.
// Click a problem to go to it; the canvas rings every problem of the frame.

import { useEffect, useState, type CSSProperties } from 'react';
import { hex, rgbOfKey } from '../../../core/color';
import { lintImage, type LintKind } from '../../../core/lint';
import { composite } from '../../../core/sprite';
import { FloatingPanel } from '../../components/FloatingPanel';
import { centerOn } from '../canvas';
import { useSp } from '../hooks';
import { emit, setFrame, sp, versions } from '../state';

const KINDS: { kind: LintKind; name: string; help: string }[] = [
  { kind: 'orphan', name: 'Orphan pixels', help: 'A pixel with no neighbour of its color. Often noise; sometimes a highlight on purpose.' },
  { kind: 'jaggy', name: 'Jaggies', help: 'A doubled pixel at the corner of an L in a 1 px line. Lines look smoother without it.' },
  { kind: 'banding', name: 'Banding', help: 'A 1 px band of color that follows an edge step by step. It makes shapes look blurry and outlined twice.' },
  { kind: 'duplicate', name: 'Almost the same colors', help: 'Two colors you can hardly tell apart. Merging them keeps the palette small.' },
];
const SHOW = 200; // per kind

function runCheck(scope: 'frame' | 'all', kinds: LintKind[]): typeof sp.issues {
  const frames = scope === 'frame' ? [sp.frame] : sp.doc.frames.map((_, i) => i);
  const out: typeof sp.issues = [];
  for (const f of frames) {
    for (const it of lintImage(composite(sp.doc, f, null, { refs: false }), sp.doc.w, sp.doc.h, kinds)) out.push({ ...it, frame: f });
  }
  return out;
}

export function CheckPanel() {
  useSp('view', 'pixels', 'structure', 'cursor');
  const [scope, setScope] = useState<'frame' | 'all'>('frame');
  const [kinds, setKinds] = useState<LintKind[]>(KINDS.map((k) => k.kind));
  const [open, setOpen] = useState<LintKind | null>('orphan');
  // check again a moment after the drawing changes
  const stamp = `${versions.get('pixels') || 0}.${versions.get('structure') || 0}.${scope === 'frame' ? sp.frame : ''}.${kinds.join()}`;
  useEffect(() => {
    if (!sp.checkOpen) return;
    const t = setTimeout(() => { sp.issues = runCheck(scope, kinds); sp.issueFocus = null; emit('view'); }, 250);
    return () => clearTimeout(t);
  }, [stamp, sp.checkOpen]);

  if (!sp.checkOpen) return null;
  const close = () => { sp.checkOpen = false; sp.issues = []; sp.issueFocus = null; emit('view'); };
  const go = (i: number) => {
    const it = sp.issues[i];
    sp.issueFocus = i;
    setFrame(it.frame);
    centerOn(it.x, it.y);
    emit('view');
  };

  return (
    <FloatingPanel title="Check" onClose={close} className="sp-check">
      <div className="row">
        <div className="seg small" role="radiogroup" aria-label="What to check">
          <label><input type="radio" name="spCheckScope" checked={scope === 'frame'} onChange={() => setScope('frame')} />This frame</label>
          <label><input type="radio" name="spCheckScope" checked={scope === 'all'} onChange={() => setScope('all')} />All frames</label>
        </div>
        <span className="muted">{sp.issues.length ? `${sp.issues.length} to look at` : 'All clear'}</span>
      </div>
      {KINDS.map(({ kind, name, help }) => {
        const items = sp.issues.map((it, i) => [it, i] as const).filter(([it]) => it.kind === kind);
        const on = kinds.includes(kind);
        return (
          <div key={kind} className={'chk-kind chk-' + kind}>
            <div className="chk-head">
              <input type="checkbox" checked={on} aria-label={`Check ${name}`} onChange={(e) => setKinds(e.target.checked ? [...kinds, kind] : kinds.filter((k) => k !== kind))} />
              <button type="button" className="chk-title" aria-expanded={open === kind} onClick={() => setOpen(open === kind ? null : kind)}>
                <i className="chk-dot" />{name}<b>{on ? items.length : '–'}</b>
              </button>
            </div>
            {open === kind && (
              <div className="chk-list">
                <p className="hint">{help}</p>
                {items.slice(0, SHOW).map(([it, i]) => (
                  <button key={i} type="button" className={'chk-item' + (sp.issueFocus === i ? ' sel' : '')} onClick={() => go(i)}>
                    <i style={{ '--c': hex(rgbOfKey(it.color)) } as CSSProperties} />
                    {it.other !== undefined && <i style={{ '--c': hex(rgbOfKey(it.other)) } as CSSProperties} />}
                    <span>{scope === 'all' ? `Frame ${it.frame + 1} · ` : ''}{it.x}, {it.y}</span>
                    {it.other !== undefined && <code>{hex(rgbOfKey(it.color))} ≈ {hex(rgbOfKey(it.other))}</code>}
                  </button>
                ))}
                {items.length > SHOW && <p className="hint">…and {items.length - SHOW} more.</p>}
                {on && !items.length && <p className="hint">None found.</p>}
              </div>
            )}
          </div>
        );
      })}
    </FloatingPanel>
  );
}
