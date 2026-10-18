// The in-app color picker: a saturation/brightness square and a hue bar.
// Used by the sprite editor's color panel and Pixelize's Touch up step.

import { useLayoutEffect, useRef } from 'react';
import { hex, hsvToRgb, rgbToHsv, type RGB } from '../../core/color';

type HSV = [number, number, number];

function paint(sv: HTMLCanvasElement, hue: HTMLCanvasElement, hsv: HSV): void {
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
function dragProps(fn: (x: number, y: number) => void) {
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  };
  return {
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); },
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); },
  };
}

export function HsvPicker(props: { color: RGB; onChange: (c: RGB) => void; ids?: { sv: string; hue: string } }) {
  const sv = useRef<HTMLCanvasElement>(null);
  const hue = useRef<HTMLCanvasElement>(null);
  // the picker's own HSV, so the hue survives greys and black (which have none)
  const hsv = useRef<HSV>(rgbToHsv(props.color));
  const next = rgbToHsv(props.color);
  if (next[1] === 0 || next[2] === 0) next[0] = hsv.current[0];
  if (next[2] === 0) next[1] = hsv.current[1];
  if (hex(hsvToRgb(...hsv.current)) !== hex(props.color)) hsv.current = next;

  useLayoutEffect(() => { paint(sv.current!, hue.current!, hsv.current); });

  const set = (v: HSV) => { hsv.current = v; props.onChange(hsvToRgb(...v)); };
  return (
    <>
      <canvas id={props.ids?.sv} className="hsv-sv" ref={sv} width={240} height={140} aria-label="Saturation and brightness"
        {...dragProps((x, y) => set([hsv.current[0], x, 1 - y]))} />
      <canvas id={props.ids?.hue} className="hsv-hue" ref={hue} width={240} height={14} aria-label="Hue"
        {...dragProps((x) => set([Math.min(359.9, x * 360), hsv.current[1] || 1, hsv.current[2] || 1]))} />
    </>
  );
}
