// Color helpers. Colors are compared in CIELAB, where distance follows how
// different two colors look; packed keys (0xRRGGBB) are used as map keys.

export type RGB = [number, number, number];
export type RGBA = [number, number, number, number];
export type Lab = [number, number, number];

export function srgbToLinear(c: number): number {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export const dist2 = (a: Lab, b: Lab): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
export const keyOf = (r: number, g: number, b: number): number => (r << 16) | (g << 8) | b;
export const keyAt = (px: ArrayLike<number>, i: number): number => (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
export const rgbOfKey = (k: number): RGB => [(k >> 16) & 255, (k >> 8) & 255, k & 255];
export const labOfKey = (k: number): Lab => { const c = rgbOfKey(k); return rgbToLab(c[0], c[1], c[2]); };
export const labOf = (c: RGB): Lab => rgbToLab(c[0], c[1], c[2]);

export const hex = (rgb: ArrayLike<number>): string =>
  '#' + [rgb[0], rgb[1], rgb[2]].map((v) => v.toString(16).padStart(2, '0')).join('');

export function hexToRgb(h: string): RGB {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
