// Builds small RGBA PNGs for tests, using every PNG row filter so the
// decoder's unfiltering is exercised.

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeAndData = new Uint8Array(4 + data.length);
  typeAndData.set(new TextEncoder().encode(type));
  typeAndData.set(data, 4);
  out.set(typeAndData, 4);
  view.setUint32(8 + data.length, crc32(typeAndData));
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

// pixel(x, y) returns [r, g, b, a]. Row y uses filter y % 5.
export async function encodePng(width, height, pixel, { colorType = 6 } = {}) {
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = new Uint8Array(stride);
    for (let x = 0; x < width; x++) row.set(pixel(x, y).slice(0, channels), x * channels);
    const filter = y % 5;
    raw[y * (stride + 1)] = filter;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      const predict = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      raw[y * (stride + 1) + 1 + i] = (row[i] - predict) & 0xff;
    }
    prev = row;
  }
  const idat = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer(),
  );
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, colorType, 0, 0, 0], 8);
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// A 100×200 "character": horns at the top that reach left, a torso band
// centred on x = 50, and a figure from y = 20 to y = 120 (height 100).
export function figurePixel(x, y) {
  const on =
    (y >= 20 && y < 30 && x >= 10 && x < 50) ||
    (y >= 30 && y < 35 && x >= 30 && x < 50) ||
    (y >= 35 && y < 55 && x >= 40 && x < 60) ||
    (y >= 55 && y < 120 && x >= 30 && x < 50);
  return on ? [200, 100, 50, 255] : [0, 0, 0, 0];
}
