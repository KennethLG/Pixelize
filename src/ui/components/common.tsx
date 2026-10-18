// Small building blocks shared by the editor's panels.

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { hex, type RGB } from '../../core/color';

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

/**
 * A number field. It reports when the user finishes typing (Enter or leaving
 * the field), clamped to min–max; with `live` it also reports while typing,
 * but only values already in range (so typing "16" with min 2 is not cut at "1").
 */
export function NumberField(props: { id?: string; value: number; min: number; max: number; step?: number; label: string; title?: string; onCommit: (v: number) => void; live?: boolean; disabled?: boolean }) {
  const [draft, setDraft] = useState(String(props.value));
  // follow outside changes, but not while the draft already means the same number
  useEffect(() => { setDraft((d) => (Number(d) === props.value && d !== '' ? d : String(props.value))); }, [props.value]);
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
      disabled={props.disabled}
      onChange={(e) => {
        const v = e.target.value;
        setDraft(v);
        if (props.live && v !== '' && Number(v) >= props.min && Number(v) <= props.max) props.onCommit(Number(v));
      }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
    />
  );
}
