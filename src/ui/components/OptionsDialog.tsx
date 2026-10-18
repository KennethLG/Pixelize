// Options: the theme and the keyboard shortcuts of both modes.

import { useEffect, useRef, useState } from 'react';
import { ACTIONS, comboOf, isCustom, keysBus, keysOf, resetKeys, setKeys, usedBy, type KeyAction, type KeyGroup } from '../keys';
import { getTheme, setTheme, type Theme } from '../theme';
import { Seg } from './common';

const GROUPS: { group: KeyGroup; title: string }[] = [
  { group: 'sprite', title: 'Sprite editor' },
  { group: 'pixelize', title: 'Pixelize (Touch up)' },
];

function KeyRow(props: { a: KeyAction; capturing: boolean; onCapture: (on: boolean) => void }) {
  const { a } = props;
  const keys = keysOf(a.id);
  return (
    <div className={'opt-key' + (props.capturing ? ' capturing' : '')}>
      <span className="opt-key-label">{a.label}{a.hold && <small> (hold)</small>}</span>
      <span className="opt-key-keys">
        {keys.length ? keys.map((k) => (
          <span key={k} className="opt-chip">
            <kbd>{k}</kbd>
            <button type="button" aria-label={`Remove ${k}`} title="Remove this key" onClick={() => setKeys(a.id, keys.filter((x) => x !== k))}>×</button>
          </span>
        )) : <span className="muted">none</span>}
        {props.capturing
          ? <span className="opt-wait">Press a key… <button type="button" className="ghost small" onClick={() => props.onCapture(false)}>Cancel</button></span>
          : <button type="button" className="ghost small" onClick={() => props.onCapture(true)}>{keys.length ? 'Add key' : 'Set key'}</button>}
        {isCustom(a.id) && <button type="button" className="ghost small" title="Back to the default keys" onClick={() => resetKeys(a.id)}>Reset</button>}
      </span>
    </div>
  );
}

export function OptionsDialog(props: { onClose: () => void }) {
  keysBus.use('keys');
  const [capture, setCapture] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [theme, setThemeState] = useState<Theme>(getTheme());
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLDivElement>(null);

  // while waiting for a key, the next key press is the new binding (and nothing else sees it)
  useEffect(() => {
    if (!capture) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { setCapture(null); return; }
      const combo = comboOf(e);
      if (!combo) return;
      const a = ACTIONS.find((x) => x.id === capture)!;
      const other = usedBy(a.group, combo, a.id);
      setKeys(a.id, [...keysOf(a.id), combo]);
      setNote(other ? `${combo} was used by "${other.label}"; it now does "${a.label}".` : `${combo} now does "${a.label}".`);
      setCapture(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [capture]);

  // Escape closes the dialog when not capturing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !capture) props.onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [capture, props]);

  useEffect(() => { box.current?.focus(); }, []);

  const q = filter.trim().toLowerCase();
  return (
    <div className="opt-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) props.onClose(); }}>
      <div className="opt-dialog panel" role="dialog" aria-modal="true" aria-label="Options" tabIndex={-1} ref={box}>
        <div className="opt-head">
          <h2>Options</h2>
          <button type="button" className="ghost small" aria-label="Close options" onClick={props.onClose}>×</button>
        </div>
        <div className="opt-body">
          <section className="opt-section">
            <span className="label">General</span>
            <div className="row">
              <span>Theme</span>
              <Seg name="theme" label="Theme" value={theme} small={false}
                options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]}
                onChange={(t) => { setTheme(t); setThemeState(t); }} />
            </div>
          </section>
          <section className="opt-section">
            <div className="opt-keys-head">
              <span className="label">Keyboard shortcuts</span>
              <input type="text" placeholder="Search…" aria-label="Search shortcuts" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <button type="button" className="ghost small" onClick={() => { if (confirm('Put every shortcut back to its default key?')) { resetKeys(); setNote('All shortcuts are back to their defaults.'); } }}>Reset all</button>
            </div>
            <p className="hint">{note || 'Add a key, then press it. Each key does one thing per mode: giving it to an action takes it from the other one. Escape cancels. The arrow keys (move the selection, Alt: the whole frame) and Ctrl+V are fixed.'}</p>
            {GROUPS.map(({ group, title }) => {
              const list = ACTIONS.filter((a) => a.group === group && (!q || a.label.toLowerCase().includes(q) || keysOf(a.id).some((k) => k.toLowerCase().includes(q))));
              if (!list.length) return null;
              const sections = [...new Set(list.map((a) => a.section))];
              return (
                <div key={group} className="opt-group">
                  <h3>{title}</h3>
                  {sections.map((s) => (
                    <div key={s} className="opt-sub">
                      <span className="muted">{s}</span>
                      {list.filter((a) => a.section === s).map((a) => (
                        <KeyRow key={a.id} a={a} capturing={capture === a.id} onCapture={(on) => { setNote(''); setCapture(on ? a.id : null); }} />
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
