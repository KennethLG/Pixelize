// Renders a region of a room: tile layers + instance sprites, with the arena and camera drawn over it
const sharp = require("sharp");
const fs = require("fs");
const P = "C:/Users/User/Desktop/SearchingLightProject/";
const room = process.argv[2], X0 = +process.argv[3], Y0 = +process.argv[4], W = +process.argv[5], H = +process.argv[6], Z = +process.argv[7], out = process.argv[8];
const overlay = process.argv[9] !== "nooverlay";
const J = f => JSON.parse(fs.readFileSync(f, "utf8").replace(/,(\s*[}\]])/g, "$1"));
const r = J(`${P}rooms/${room}/${room}.yy`);
const ts = J(`${P}tilesets/bgTileset_tileset/bgTileset_tileset.yy`);
const COLS = 18, T = 16;

function rgb2hsv(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d > 1e-9) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h /= 6; if (h < 0) h += 1; } return [h, mx ? d / mx : 0, mx]; }
function hsv2rgb(h, s, v) { h = h - Math.floor(h); const k = n => { const p = Math.abs(((h + n / 3) % 1) * 6 - 3); return v * (1 - s + s * Math.min(1, Math.max(0, p - 1))); }; return [k(3), k(2), k(1)]; }
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const CFG = JSON.parse(process.env.CANDYCFG || "{}");
const K = CFG.k ?? 0.5;
function candy(r, g, b, st) {
  const [h, s0, v0] = rgb2hsv(r, g, b);
  return hsv2rgb(st.shift + (h - 0.6) * K, Math.min(1, s0 * st.sat), Math.min(1, v0 + (1 - v0) * st.lift));
}
function hash(x, y) { const v = Math.sin((x % 289) * 127.1 + (y % 289) * 311.7) * 43758.5453; return v - Math.floor(v); }
function vnoise(x, y) { const ix = Math.floor(x), iy = Math.floor(y); let fx = x - ix, fy = y - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1); return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy; }
const CANDY = process.env.CANDY !== "0";
function styleFn(st, drift) {
  return (r, g, b, wx, wy) => {
    let shift = st.shift, lift = st.lift;
    if (drift) { const d = vnoise(wx * 0.009 + 7.3, wy * 0.009 + 7.3) * 0.65 + vnoise(wx * 0.031 + 2.1, wy * 0.031 + 2.1) * 0.35; shift += (d - 0.5) * 0.12; lift += (d - 0.5) * 0.08; }
    const o = candy(r / 255, g / 255, b / 255, { shift, lift, sat: st.sat }); return [o[0] * 255, o[1] * 255, o[2] * 255];
  };
}
const treeShifts = CFG.trees ?? [0.92, 0.87, 0.95, 0.98, 0.84];
const LAYER_STYLE = { Tiles_1: styleFn(CFG.floor ?? { shift: 0.92, lift: 0.45, sat: 0.7 }, true), Tiles_2: styleFn(CFG.cliff ?? { shift: 0.88, lift: 0.35, sat: 0.7 }), Tiles_3: styleFn(CFG.stones ?? { shift: 0.95, lift: 0.55, sat: 0.6 }), Tiles_4: styleFn(CFG.stones ?? { shift: 0.95, lift: 0.55, sat: 0.6 }) };
const sprCache = {};
async function sprite(name, idx = 0) {
  const ck = name + ":" + idx;
  if (sprCache[ck] !== undefined) return sprCache[ck];
  try {
    const y = J(`${P}sprites/${name}/${name}.yy`);
    const f = y.frames[idx % y.frames.length].name;
    const buf = await sharp(`${P}sprites/${name}/${f}.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return (sprCache[ck] = { data: buf.data, w: buf.info.width, h: buf.info.height, xo: y.sequence.xorigin, yo: y.sequence.yorigin });
  } catch (e) { return (sprCache[ck] = null); }
}
const objSpr = {};
function objSprite(o) {
  if (objSpr[o] !== undefined) return objSpr[o];
  const y = J(`${P}objects/${o}/${o}.yy`);
  return (objSpr[o] = { s: y.spriteId && y.spriteId.name, vis: y.visible });
}
function decode(layer) {
  const d = layer.tiles.TileCompressedData, out = [];
  for (let i = 0; i < d.length;) { const n = d[i++]; if (n < 0) { const v = d[i++]; for (let k = 0; k < -n; k++) out.push(v); } else for (let k = 0; k < n; k++) out.push(d[i++]); }
  return out;
}
(async () => {
  const tsImg = await sharp(`${P}sprites/bgTileset/${require("fs").readdirSync(P + "sprites/bgTileset").find(f => f.endsWith(".png"))}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const TW = tsImg.info.width;
  const cw = W, ch = H;
  const canvas = Buffer.alloc(cw * ch * 4);
  let bgBuf = null;
  try {
    const by = J(P + "sprites/bgCandyH/bgCandyH.yy");
    const bg = await sharp(P + "sprites/bgCandyH/" + by.frames[0].name + ".png").resize(cw, ch, { fit: "cover" }).ensureAlpha().raw().toBuffer();
    bgBuf = bg;
  } catch (e) {}
  for (let i = 0; i < cw * ch; i++) { if (bgBuf && CANDY) { canvas[i * 4] = bgBuf[i * 4]; canvas[i * 4 + 1] = bgBuf[i * 4 + 1]; canvas[i * 4 + 2] = bgBuf[i * 4 + 2]; } else { canvas[i * 4] = 40; canvas[i * 4 + 1] = 40; canvas[i * 4 + 2] = 48; } canvas[i * 4 + 3] = 255; }
  function blend(sd, sw, sx, sy, dx, dy, fx, fy, tw, th, rot, fn) {
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let ux = x, uy = y;
      if (rot) { const t = ux; ux = uy; uy = tw - 1 - t; }
      if (fx) ux = tw - 1 - ux; if (fy) uy = th - 1 - uy;
      const si = ((sy + uy) * sw + sx + ux) * 4;
      const a = sd[si + 3]; if (!a) continue;
      const px = dx + x - X0, py = dy + y - Y0;
      if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
      const di = (py * cw + px) * 4, al = a / 255;
      const sc = (fn && CANDY) ? fn(sd[si], sd[si + 1], sd[si + 2], dx + x, dy + y) : [sd[si], sd[si + 1], sd[si + 2]];
      for (let c = 0; c < 3; c++) canvas[di + c] = Math.round(sc[c] * al + canvas[di + c] * (1 - al));
    }
  }
  const layers = r.layers.filter(l => l.visible !== false).sort((a, b) => b.depth - a.depth);
  for (const l of layers) {
    if (l.resourceType === "GMRTileLayer") {
      const w = l.tiles.SerialiseWidth, data = decode(l);
      for (let i = 0; i < data.length; i++) {
        const v = data[i]; const id = v & 0x7FFFF; if (v === -2147483648 || id === 0) continue;
        const cx = (i % w) * T, cy = Math.floor(i / w) * T;
        if (cx + T < X0 || cy + T < Y0 || cx > X0 + cw || cy > Y0 + ch) continue;
        blend(tsImg.data, TW, (id % COLS) * T, Math.floor(id / COLS) * T, cx, cy, !!(v & 0x10000000), !!(v & 0x20000000), T, T, !!(v & 0x40000000), LAYER_STYLE[l.name]);
      }
    } else if (l.resourceType === "GMRAssetLayer") {
      for (const a of l.assets || []) {
        const sn = a.spriteId && a.spriteId.name; if (!sn) continue;
        const sp = await sprite(sn, 0); if (!sp) continue;
        const sx = a.scaleX || a.xscale || 1;
        blend(sp.data, sp.w, 0, 0, Math.round(a.x - sp.xo * sx), Math.round(a.y - sp.yo * (a.scaleY || a.yscale || 1)), false, false, sp.w, sp.h, false, styleFn(CFG.house ?? { shift: 0.95, lift: 0.3, sat: 0.8 }));
      }
    } else if (l.resourceType === "GMRInstanceLayer") {
      const list = [...l.instances].sort((a, b) => a.y - b.y);
      for (const i of list) {
        const o = i.objectId.name; const os = objSprite(o);
        if (!os.s || os.vis === false) continue;
        const s = await sprite(os.s, i.imageIndex || 0); if (!s) continue;
        if (i.scaleX !== 1 || i.scaleY !== 1 || i.rotation) { /* ignore: drawn unscaled */ }
        const dx = Math.round(i.x - s.xo * (i.scaleX < 0 ? -1 : 1) - (i.scaleX < 0 ? s.w : 0) + (i.scaleX < 0 ? 2 * s.xo : 0) * 0), dy = Math.round(i.y - s.yo);
        if (dx + s.w < X0 || dy + s.h < Y0 || dx > X0 + cw || dy > Y0 + ch) continue;
        let fn = null;
        if (/^objRainTree\d?$/.test(o)) fn = styleFn({ shift: treeShifts[(Math.floor(i.x / 16) * 7 + Math.floor(i.y / 16) * 3) % 5], lift: CFG.treeLift ?? 0.35, sat: CFG.treeSat ?? 0.8 });
        else if (o === "objRainLamp") fn = styleFn(CFG.lamp ?? { shift: 0.94, lift: 0.4, sat: 0.7 });
        blend(s.data, s.w, 0, 0, i.scaleX < 0 ? Math.round(i.x - (s.w - s.xo)) : dx, dy, i.scaleX < 0, false, s.w, s.h, false, fn);
      }
    }
  }
  let img = sharp(canvas, { raw: { width: cw, height: ch, channels: 4 } });
  if (overlay) {
    // arena (50% x 70% of the camera at size 1.2) and the fixed camera view
    const mx = 768, my = 1088, camW = 768 * 1.2, camH = 432 * 1.2;
    const rect = (cx, cy, w, h, col) => `<rect x="${cx - w / 2 - X0}" y="${cy - h / 2 - Y0}" width="${w}" height="${h}" fill="none" stroke="${col}" stroke-width="2" stroke-dasharray="6 4"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cw}" height="${ch}">${rect(mx, my, camW * .5, camH * .7, "#ff3030")}${rect(752, 1088, camW, camH, "#30ffff")}<circle cx="${768 - X0}" cy="${1088 - Y0}" r="3" fill="#ff0"/></svg>`;
    img = sharp(await img.png().toBuffer()).composite([{ input: Buffer.from(svg) }]);
  }
  await img.resize(Math.round(cw * Z), Math.round(ch * Z), { kernel: "nearest" }).png().toFile(out);
  console.log("ok", out);
})();
