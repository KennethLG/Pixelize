// A panel that floats over the page and can be dragged by its title bar, so
// it can stay open while you keep working (Check, Variants).

import { useState, type ReactNode } from 'react';

export function FloatingPanel(props: { title: string; onClose: () => void; children: ReactNode; className?: string; at?: { right: number; top: number } }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - box.left, dy = e.clientY - box.top;
    const move = (ev: PointerEvent) => setPos({
      x: Math.max(0, Math.min(window.innerWidth - 120, ev.clientX - dx)),
      y: Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy)),
    });
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const at = props.at ?? { right: 24, top: 120 };
  return (
    <div className={'float-panel ' + (props.className ?? '')} role="dialog" aria-label={props.title}
      style={pos ? { left: pos.x, top: pos.y } : { right: at.right, top: at.top }}>
      <div className="float-head" onPointerDown={startDrag}>
        <span className="label">{props.title}</span>
        <button type="button" className="ghost small" aria-label={`Close ${props.title}`} onClick={props.onClose}>×</button>
      </div>
      <div className="float-body">{props.children}</div>
    </div>
  );
}
