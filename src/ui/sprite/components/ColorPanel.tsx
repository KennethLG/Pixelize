// The in-app color picker: primary/secondary slots, a saturation/brightness
// square, a hue bar and a hex field. It also edits the paper color when the
// paper swatch under the canvas is chosen.

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { hex, hexToRgb, type RGBA } from '../../../core/color';
import { hsvToRgb, pickSlot, pickedColor, rgbToHsv, setPickedColor, setPaperMode, swapColors } from '../actions';
import { useSp } from '../hooks';
import { sp, setColor } from '../state';

type HSV = [number, number, number];

function paintPicker(sv: HTMLCanvasElement, hue: HTMLCanvasElement, hsv: HSV): void {
  const g = sv.getContext('2d')!, W = sv.width, H = sv.height;
  g.fillStyle = `hsl(${hsv[0]} 100% 50%)`;
  g.fillRect(0, 0, W, H);
  const white = g.createLinearGradient(0, 0, W, 0);
  white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = white; g.fillRect(0, 0, W, H);
  const black = g.createLinearGradient(0, 0, 0, H);
  black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
  g.fillStyle = black; g.fillRect(0, 0, W, H);
  g.lineWidth = 2;
  g.strokeStyle = hsv[2] > 0.5 ? '#000' : '#fff';
  g.beginPath(); g.arc(hsv[1] * W, (1 - hsv[2]) * H, 5, 0, Math.PI * 2); g.stroke();

  const hg = hue.getContext('2d')!, HW = hue.width, HH = hue.height;
  const grad = hg.createLinearGradient(0, 0, HW, 0);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
  hg.fillStyle = grad; hg.fillRect(0, 0, HW, HH);
  const hx = (hsv[0] / 360) * HW;
  hg.fillStyle = '#fff'; hg.fillRect(hx - 2, 0, 4, HH);
  hg.strokeStyle = '#000'; hg.lineWidth = 1; hg.strokeRect(hx - 2.5, 0.5, 5, HH - 1);
}

/** Pointer drags on a canvas, reported as 0–1 coordinates. */
function useDrag(fn: (x: number, y: number) => void) {
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); },
  };
}

function Slot(props: { id: string; which: 'primary' | 'secondary'; label: string }) {
  const c = sp[props.which];
  return (
    <button
      type="button"
      className={sp.pickSlot === props.which ? 'sp-slot on' : 'sp-slot'}
      id={props.id}
      aria-label={props.label}
      title={`${props.which === 'primary' ? 'Primary (left click)' : 'Secondary (right click)'}: ${c[3] ? hex(c) : 'transparent'}`}
      style={{ '--c': c[3] ? hex(c) : 'transparent' } as CSSProperties}
      onClick={() => pickSlot(props.which)}
    />
  );
}

export function ColorPanel() {
  useSp('color', 'paper');
  const sv = useRef<HTMLCanvasElement>(null);
  const hue = useRef<HTMLCanvasElement>(null);
  // the picker's own HSV, so the hue survives greys and black (which have none)
  const hsv = useRef<HSV>(rgbToHsv([sp.primary[0], sp.primary[1], sp.primary[2]]));
  const c = pickedColor();
  const next = rgbToHsv([c[0], c[1], c[2]]);
  if (next[1] === 0 || next[2] === 0) next[0] = hsv.current[0];
  if (next[2] === 0) next[1] = hsv.current[1];
  if (hex(hsvToRgb(...hsv.current)) !== hex(c)) hsv.current = next;

  useLayoutEffect(() => { paintPicker(sv.current!, hue.current!, hsv.current); });

  const fromHsv = () => { const [r, g, b] = hsvToRgb(...hsv.current); setPickedColor([r, g, b, 255]); };
  const svDrag = useDrag((x, y) => { hsv.current = [hsv.current[0], x, 1 - y]; fromHsv(); });
  const hueDrag = useDrag((x) => { hsv.current = [Math.min(359.9, x * 360), hsv.current[1] || 1, hsv.current[2] || 1]; fromHsv(); });

  // the hex field shows the color unless the user is typing in it
  const shown = c[3] ? hex(c) : '';
  const [draft, setDraft] = useState(shown);
  const [typing, setTyping] = useState(false);
  useEffect(() => { if (!typing) setDraft(shown); }, [shown, typing]);
  const commitHex = () => {
    setTyping(false);
    const v = draft.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) setPickedColor([...hexToRgb(v), 255] as RGBA);
    else setDraft(shown);
  };

  // "Clear" makes the color transparent; on the paper it goes back to the checkerboard
  const clear = () => {
    if (sp.pickSlot === 'paper') { setPaperMode('checker'); pickSlot('primary'); }
    else setColor(sp.pickSlot, [0, 0, 0, 0]);
  };

  return (
    <div className="panel sp-color">
      <div className="sp-slots">
        <Slot id="spPrimary" which="primary" label="Primary color" />
        <Slot id="spSecondary" which="secondary" label="Secondary color" />
        <button type="button" className="ghost small" title="Swap colors (X)" onClick={swapColors}>⇄</button>
        <button type="button" className="ghost small" title="Make this color transparent (draws like an eraser)" onClick={clear}>Clear</button>
        <span className="tag" id="spEditing">{sp.pickSlot === 'paper' ? 'Paper' : ''}</span>
        <input
          type="text"
          id="spHex"
          maxLength={7}
          aria-label="Hex color"
          spellCheck={false}
          value={draft}
          placeholder={c[3] ? '' : 'transparent'}
          onFocus={() => setTyping(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => { if (e.key === 'Enter') commitHex(); }}
        />
      </div>
      <canvas id="spSV" ref={sv} width={240} height={140} aria-label="Saturation and brightness" {...svDrag} />
      <canvas id="spHue" ref={hue} width={240} height={14} aria-label="Hue" {...hueDrag} />
    </div>
  );
}
