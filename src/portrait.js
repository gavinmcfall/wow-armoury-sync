// Finds where the character stands in a transparent render (main-raw.png),
// so a site can crop a portrait from it.
//
// Blizzard renders every character with the same fixed camera: the feet sit
// at the same height, so a tall race's head is far higher in the image than
// a short race's. A fixed crop can't frame them all; this measures each one.

// Fractions of the figure's height, tuned against real renders. The focus
// starts a little above the topmost pixel and covers the head and upper
// body; the figure frame adds the same margin above and below the whole body.
const HEADROOM = 0.03;
const FOCUS_HEIGHT = 0.54;
// The horizontal centre comes from the upper torso, which ignores horns,
// raised weapons and shoulder pieces that reach out above the head.
const TORSO_FROM = 0.15;
const TORSO_TO = 0.35;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// Returns { focus, figure }, each { x, top, height } as fractions of the
// image: x is the figure's horizontal centre, top and height the window
// (focus: head and upper body; figure: the whole body). Null when the bytes
// aren't an 8-bit RGBA PNG or the image is empty.
export async function measureFigure(bytes) {
  const png = parsePng(bytes);
  if (!png) return null;
  const { width, height } = png;
  const pixels = await inflate(png.idat);
  const stride = width * 4;
  if (pixels.length < (stride + 1) * height) return null;

  // Unfilter row by row, recording each row's opaque extent.
  const minX = new Int32Array(height).fill(-1);
  const maxX = new Int32Array(height).fill(-1);
  let prev = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = pixels[start];
    for (let i = 0; i < stride; i++) {
      const raw = pixels[start + 1 + i];
      const a = i >= 4 ? row[i - 4] : 0;
      const b = prev[i];
      let value;
      switch (filter) {
        case 0: value = raw; break;
        case 1: value = raw + a; break;
        case 2: value = raw + b; break;
        case 3: value = raw + ((a + b) >> 1); break;
        case 4: value = raw + paeth(a, b, i >= 4 ? prev[i - 4] : 0); break;
        default: return null;
      }
      row[i] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      if (row[x * 4 + 3] !== 0) {
        if (minX[y] === -1) minX[y] = x;
        maxX[y] = x;
      }
    }
    [prev, row] = [row, prev];
  }

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    if (minX[y] !== -1) {
      if (top === -1) top = y;
      bottom = y + 1;
    }
  }
  if (top === -1) return null;

  const figure = bottom - top;
  let left = Infinity;
  let right = -Infinity;
  for (let y = top + Math.floor(figure * TORSO_FROM); y < top + Math.floor(figure * TORSO_TO); y++) {
    if (minX[y] === -1) continue;
    left = Math.min(left, minX[y]);
    right = Math.max(right, maxX[y] + 1);
  }
  const x = round((left === Infinity ? width / 2 : (left + right) / 2) / width);
  const frameTop = round((top - figure * HEADROOM) / height);

  return {
    focus: { x, top: frameTop, height: round((figure * FOCUS_HEIGHT) / height) },
    figure: { x, top: frameTop, height: round((figure * (1 + 2 * HEADROOM)) / height) },
  };
}

const round = (n) => Math.round(n * 1e4) / 1e4;

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Reads the header and joins the image data chunks. Only 8-bit RGBA,
// non-interlaced PNGs (what Blizzard serves for renders) are accepted.
function parsePng(bytes) {
  if (bytes.length < 33 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width, height;
  const idat = [];
  for (let o = 8; o + 8 <= bytes.length; ) {
    const length = view.getUint32(o);
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8));
    const data = bytes.subarray(o + 8, o + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(o + 8);
      height = view.getUint32(o + 12);
      const [bitDepth, colorType, , , interlace] = data.subarray(8, 13);
      if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return null;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    o += 12 + length;
  }
  if (!width || !height || idat.length === 0) return null;
  return { width, height, idat };
}

async function inflate(chunks) {
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
