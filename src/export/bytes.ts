// Growable byte buffer for the binary writers.

export class ByteWriter {
  private buf = new Uint8Array(1024);
  length = 0;

  private ensure(n: number) {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }

  byte(v: number) { this.ensure(1); this.buf[this.length++] = v & 255; }
  u16(v: number) { this.ensure(2); this.buf[this.length++] = v & 255; this.buf[this.length++] = (v >> 8) & 255; }
  u32(v: number) { this.u16(v & 0xffff); this.u16((v >>> 16) & 0xffff); }
  ascii(s: string) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
  bytes(b: ArrayLike<number>) {
    this.ensure(b.length);
    this.buf.set(b, this.length);
    this.length += b.length;
  }

  result(): Uint8Array { return this.buf.slice(0, this.length); }
}
