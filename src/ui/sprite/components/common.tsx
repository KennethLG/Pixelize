// Small building blocks shared by the editor's panels.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { hex, type RGB } from '../../../core/color';

export interface SegOption<T extends string> { value: T; label: ReactNode; title?: string }

/** A row of mutually exclusive choices (radio buttons styled as a segmented control). */
export function Seg<T extends string>(props: { name: string; label: string; value: T; options: SegOption<T>[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div className={props.small === false ? 'seg' : 'seg small'} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <label key={o.value} title={o.title}>
          <input type="radio" name={props.name} value={o.value} checked={props.value === o.value} onChange={() => props.onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** A color square. Click and right click do different things (primary / secondary). */
export function Swatch(props: { rgb: RGB; selected?: boolean; onPick: (e: React.MouseEvent) => void; onSecondary?: () => void }) {
  const color = hex(props.rgb);
  return (
    <button
      type="button"
      className={props.selected ? 'sp-sw sel' : 'sp-sw'}
      style={{ '--c': color } as CSSProperties}
      title={color}
      onClick={props.onPick}
      onContextMenu={(e) => { e.preventDefault(); props.onSecondary?.(); }}
    />
  );
}

/** A number field that only reports when the user finishes typing (Enter or leaving the field). */
export function NumberField(props: { id?: string; value: number; min: number; max: number; step?: number; label: string; title?: string; onCommit: (v: number) => void; live?: boolean }) {
  const [draft, setDraft] = useState(String(props.value));
  useEffect(() => setDraft(String(props.value)), [props.value]);
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v)) props.onCommit(Math.max(props.min, Math.min(props.max, v)));
    else setDraft(String(props.value));
  };
  return (
    <input
      type="number"
      id={props.id}
      min={props.min}
      max={props.max}
      step={props.step}
      value={draft}
      aria-label={props.label}
      title={props.title}
      onChange={(e) => { setDraft(e.target.value); if (props.live && e.target.value !== '') props.onCommit(Math.max(props.min, Math.min(props.max, Number(e.target.value)))); }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}
