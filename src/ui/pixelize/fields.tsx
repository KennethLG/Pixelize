// Form controls bound to one Pixelize setting each.

import type { ReactNode } from 'react';
import { NumberField, Seg, type SegOption } from '../components/common';
import { pxBus } from '../app';
import { setSettings, settings, type Settings } from '../settings';

type Keys<T> = { [K in keyof Settings]: Settings[K] extends T ? K : never }[keyof Settings];

/** The settings, re-rendering the component when any of them changes. */
export function useSettings(): Settings {
  pxBus.use('settings');
  return settings;
}

export function Check(props: { k: Keys<boolean>; children: ReactNode; strong?: boolean; title?: string }) {
  const s = useSettings();
  return (
    <label className={props.strong ? 'check strong' : 'check'} title={props.title}>
      <input type="checkbox" checked={s[props.k]} onChange={(e) => setSettings({ [props.k]: e.target.checked })} />
      {props.children}
    </label>
  );
}

export function SegField<K extends Keys<string>>(props: { k: K; label: string; options: SegOption<Settings[K] & string>[]; small?: boolean }) {
  const s = useSettings();
  return (
    <Seg name={props.k} label={props.label} value={s[props.k] as Settings[K] & string} small={props.small ?? false}
      options={props.options} onChange={(v) => setSettings({ [props.k]: v } as Partial<Settings>)} />
  );
}

/** A slider with its value next to it. */
export function Slider(props: { k: Keys<number>; label: string; min: number; max: number; step?: number; unit?: string; aria?: string; disabled?: boolean }) {
  const s = useSettings();
  return (
    <div className="row">
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 1} value={s[props.k]} aria-label={props.aria ?? props.label}
        disabled={props.disabled} onChange={(e) => setSettings({ [props.k]: Number(e.target.value) })} />
      <output>{s[props.k]}</output>
      {props.unit && <span>{props.unit}</span>}
    </div>
  );
}

/** A slider and a number field for the same value (pixel sizes and shifts). */
export function SliderPair(props: { k: Keys<number>; label: string; min: number; max: number; step: number; aria: string; disabled?: boolean }) {
  const s = useSettings();
  const set = (v: number) => setSettings({ [props.k]: v });
  return (
    <div className="row pair">
      <span>{props.label}</span>
      <input type="range" min={props.min} max={props.max} step={props.step} value={Math.min(props.max, s[props.k])} aria-label={`${props.aria} slider`}
        disabled={props.disabled} onChange={(e) => set(Number(e.target.value))} />
      <NumberField value={s[props.k]} min={props.min} max={9999} step={props.step} label={`${props.aria} in px`} onCommit={set} live disabled={props.disabled} />
    </div>
  );
}

export function NumberSetting(props: { k: Keys<number>; label: string; min: number; max?: number; id?: string }) {
  const s = useSettings();
  return <NumberField id={props.id} value={s[props.k]} min={props.min} max={props.max ?? 99999} label={props.label} onCommit={(v) => setSettings({ [props.k]: v })} live />;
}
