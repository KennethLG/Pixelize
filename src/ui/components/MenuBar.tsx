// A menu bar like a desktop app's: File, Edit… with drop-down menus, submenus
// (Open Recent ▸), check marks, shortcuts on the right, and the keyboard:
// arrows move, Enter runs, Escape closes, F10 opens the first menu. Menus are
// built when they open, so they always show the current state.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export type MenuItem =
  | 'sep'
  | {
    label: string;
    /** the key shown on the right */
    shortcut?: string;
    run?: () => void;
    disabled?: boolean;
    /** a check mark (true/false), or no mark at all (undefined) */
    checked?: boolean;
    /** a submenu */
    items?: MenuItem[];
    title?: string;
  };

export interface Menu { label: string; items: () => MenuItem[] }

type Entry = Exclude<MenuItem, 'sep'>;
const usable = (i: MenuItem): i is Entry => i !== 'sep' && !i.disabled;

function MenuList(props: { items: MenuItem[]; active: number; sub: number | null; subActive: number; onHover: (i: number) => void; onRun: (e: Entry) => void; onSubHover: (i: number) => void; nested?: boolean }) {
  const { items, active } = props;
  const box = useRef<HTMLDivElement>(null);
  // a menu that would go past the right edge of the window opens to the left
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (r && r.right > window.innerWidth - 4) setFlip(true);
  }, []);
  return (
    <div ref={box} className={'mb-menu panel' + (props.nested ? ' nested' : '') + (flip ? ' flip' : '')} role="menu">
      {items.map((it, i) => {
        if (it === 'sep') return <div key={`s${i}`} className="mb-sep" role="separator" />;
        const open = props.sub === i && !!it.items;
        return (
          <div key={`${it.label}${i}`} className="mb-item-wrap">
            <button
              type="button"
              role={it.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={it.checked}
              aria-haspopup={it.items ? 'menu' : undefined}
              aria-expanded={it.items ? open : undefined}
              className={'mb-item' + (i === active ? ' on' : '')}
              disabled={it.disabled}
              title={it.title}
              onPointerEnter={() => props.onHover(i)}
              onClick={() => { if (!it.items) props.onRun(it); }}
            >
              <span className="mb-check">{it.checked ? '✓' : ''}</span>
              <span className="mb-label">{it.label}</span>
              <span className="mb-key">{it.items ? '▸' : it.shortcut ?? ''}</span>
            </button>
            {open && (
              <MenuList items={it.items!} active={props.subActive} sub={null} subActive={-1} nested
                onHover={props.onSubHover} onRun={props.onRun} onSubHover={() => {}} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export function MenuBar(props: { menus: Menu[]; label: string }) {
  const { menus } = props;
  const [open, setOpen] = useState<number | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<number | null>(null);
  const [subActive, setSubActive] = useState(-1);
  const bar = useRef<HTMLDivElement>(null);

  const show = (i: number | null, focusFirst = false) => {
    setOpen(i);
    setSub(null);
    setSubActive(-1);
    if (i === null) { setItems([]); setActive(-1); return; }
    const list = menus[i].items();
    setItems(list);
    setActive(focusFirst ? list.findIndex(usable) : -1);
  };
  const close = () => show(null);
  const run = (e: Entry) => { close(); if (!e.disabled) e.run?.(); };

  // a click anywhere else closes the menu
  useEffect(() => {
    if (open === null) return;
    const down = (e: PointerEvent) => { if (!bar.current?.contains(e.target as Node)) close(); };
    const blur = () => close();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', blur);
    return () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('blur', blur); };
  }, [open]);

  // the keyboard drives the open menu, and nothing else hears it meanwhile
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open === null) {
        if (e.key === 'F10' && !e.ctrlKey && !e.altKey && bar.current?.offsetParent) { e.preventDefault(); show(0, true); }
        return;
      }
      const subItems = sub !== null ? (items[sub] as Entry).items ?? [] : null;
      const list = subItems ?? items;
      const at = subItems ? subActive : active;
      const setAt = subItems ? setSubActive : setActive;
      const step = (d: number) => {
        if (!list.some(usable)) return;
        let i = at;
        do { i = (i + d + list.length) % list.length; } while (!usable(list[i]));
        setAt(i);
      };
      const cur = list[at];
      switch (e.key) {
        case 'ArrowDown': step(1); break;
        case 'ArrowUp': step(-1); break;
        case 'ArrowRight':
          if (!subItems && cur !== undefined && usable(cur) && cur.items) { setSub(at); setSubActive(cur.items.findIndex(usable)); }
          else show((open + 1) % menus.length, true);
          break;
        case 'ArrowLeft':
          if (subItems) { setSub(null); setSubActive(-1); } else show((open - 1 + menus.length) % menus.length, true);
          break;
        case 'Enter': case ' ':
          if (cur !== undefined && usable(cur)) {
            if (cur.items) { setSub(at); setSubActive(cur.items.findIndex(usable)); } else run(cur);
          }
          break;
        case 'Escape':
          if (subItems) { setSub(null); setSubActive(-1); } else close();
          break;
        case 'Tab': close(); return;
        default: return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, items, active, sub, subActive, menus]);

  return (
    <div className="mb-bar" role="menubar" aria-label={props.label} ref={bar}>
      {menus.map((m, i) => (
        <div key={m.label} className="mb-top-wrap">
          <button
            type="button"
            className={'mb-top' + (open === i ? ' on' : '')}
            aria-haspopup="menu"
            aria-expanded={open === i}
            onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); show(open === i ? null : i); } }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); show(i, true); } }}
            onPointerEnter={() => { if (open !== null && open !== i) show(i); }}
          >{m.label}</button>
          {open === i && (
            <MenuList
              items={items}
              active={active}
              sub={sub}
              subActive={subActive}
              onHover={(k) => {
                setActive(k);
                const it = items[k];
                if (it !== 'sep' && it.items && !it.disabled) { setSub(k); setSubActive(-1); } else { setSub(null); setSubActive(-1); }
              }}
              onSubHover={setSubActive}
              onRun={run}
            />
          )}
        </div>
      ))}
    </div>
  );
}
