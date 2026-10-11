const sharp = require("sharp");
const fract = x => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 0) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = fract(h / 6); }
  return [h, mx === 0 ? 0 : d / mx, mx]; }
function hsv2rgb(h, s, v) { return [0, 2 / 3, 1 / 3].map(o => { const p = Math.abs(fract(h + o) * 6 - 3); return v * (1 + (clamp(p - 1, 0, 1) - 1) * s); }); }
const stops = JSON.parse(process.env.STOPS);
function grad(l) { for (let i = 1; i < stops.length; i++) if (l <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i]; return mix(hex(ca), hex(cb), (l - a) / (b - a)); } return hex(stops[stops.length - 1][1]); }
function candy(r, g, b) { const [h, s, v] = rgb2hsv(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const purple = ss(0.66, 0.74, h) * (1 - ss(0.94, 0.99, h));
  const lav = hsv2rgb(h, clamp(s * 0.9 + 0.1, 0, 0.6), clamp(0.45 + v * 0.65, 0, 1));
  return mix(grad(clamp(lum * 0.88 + 0.04, 0, 1)), lav, purple); }
(async () => {
  const args = process.argv.slice(2);
  for (let a = 0; a < args.length; a += 2) {
    const { data, info } = await sharp(args[a]).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += 4) { const c = candy(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255); for (let k = 0; k < 3; k++) data[i + k] = Math.round(clamp(c[k], 0, 1) * 255); }
    await sharp(data, { raw: info }).png().toFile(args[a + 1]);
  }
})();
