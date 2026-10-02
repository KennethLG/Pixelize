// Minimal ZIP writer. Entries are stored without compression: they are PNGs,
// which are already compressed.

import { ByteWriter } from './bytes';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export function makeZip(files: ZipEntry[], date = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const out = new ByteWriter();
  const central = new ByteWriter();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length, offset = out.length;
    // local file header (flag 0x0800: UTF-8 names)
    out.u32(0x04034b50); out.u16(20); out.u16(0x0800); out.u16(0); out.u16(time); out.u16(day);
    out.u32(crc); out.u32(size); out.u32(size); out.u16(name.length); out.u16(0);
    out.bytes(name); out.bytes(f.data);
    // central directory entry
    central.u32(0x02014b50); central.u16(20); central.u16(20); central.u16(0x0800); central.u16(0);
    central.u16(time); central.u16(day); central.u32(crc); central.u32(size); central.u32(size);
    central.u16(name.length); central.u16(0); central.u16(0); central.u16(0); central.u16(0); central.u32(0);
    central.u32(offset);
    central.bytes(name);
  }
  const cdOffset = out.length, cd = central.result();
  out.bytes(cd);
  // end of central directory
  out.u32(0x06054b50); out.u16(0); out.u16(0); out.u16(files.length); out.u16(files.length);
  out.u32(cd.length); out.u32(cdOffset); out.u16(0);
  return out.result();
}
