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
  for (let i = 0; i < cw * ch; i++) { canvas[i * 4] = 40; canvas[i * 4 + 1] = 40; canvas[i * 4 + 2] = 48; canvas[i * 4 + 3] = 255; }
  function blend(sd, sw, sx, sy, dx, dy, fx, fy, tw, th, rot) {
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let ux = x, uy = y;
      if (rot) { const t = ux; ux = uy; uy = tw - 1 - t; }
      if (fx) ux = tw - 1 - ux; if (fy) uy = th - 1 - uy;
      const si = ((sy + uy) * sw + sx + ux) * 4;
      const a = sd[si + 3]; if (!a) continue;
      const px = dx + x - X0, py = dy + y - Y0;
      if (px < 0 || py < 0 || px >= cw || py >= ch) continue;
      const di = (py * cw + px) * 4, al = a / 255;
      for (let c = 0; c < 3; c++) canvas[di + c] = Math.round(sd[si + c] * al + canvas[di + c] * (1 - al));
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
        blend(tsImg.data, TW, (id % COLS) * T, Math.floor(id / COLS) * T, cx, cy, !!(v & 0x10000000), !!(v & 0x20000000), T, T, !!(v & 0x40000000));
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
        blend(s.data, s.w, 0, 0, i.scaleX < 0 ? Math.round(i.x - (s.w - s.xo)) : dx, dy, i.scaleX < 0, false, s.w, s.h, false);
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
