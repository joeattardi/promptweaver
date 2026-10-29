import { deflateSync } from 'node:zlib'

/**
 * The menu-bar icon: a small woven square (two bars over and under two bars).
 * Black with transparency by default, which is what macOS "template" icons
 * are. Drawn in code so there is no image file to find in a packaged app.
 */
export function weaveIconPng(
  size: number,
  color: readonly [number, number, number] = [0, 0, 0]
): Buffer {
  const scale = size / 36
  const rgba = Buffer.alloc(size * size * 4)
  const SAMPLES = 4
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hits = 0
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = (px + (sx + 0.5) / SAMPLES) / scale
          const y = (py + (sy + 0.5) / SAMPLES) / scale
          if (inWeave(x, y)) hits++
        }
      }
      const offset = (py * size + px) * 4
      rgba[offset] = color[0]
      rgba[offset + 1] = color[1]
      rgba[offset + 2] = color[2]
      rgba[offset + 3] = Math.round((hits / (SAMPLES * SAMPLES)) * 255)
    }
  }
  return encodePng(size, size, rgba)
}

// All in a 36 x 36 grid.
const BARS = [
  [9, 15],
  [21, 27]
] as const
const START = 4
const END = 32
/** The cut left in the bar that goes under, on each side of the one going over. */
const GAP = 2

const within = (v: number, [from, to]: readonly [number, number]): boolean => v >= from && v < to

function inWeave(x: number, y: number): boolean {
  const column = BARS.findIndex((b) => within(x, b))
  const row = BARS.findIndex((b) => within(y, b))
  const inVertical = column >= 0 && y >= START && y < END
  const inHorizontal = row >= 0 && x >= START && x < END
  // Where two bars cross, the vertical goes over when (column + row) is even.
  const verticalOver = (c: number, r: number): boolean => (c + r) % 2 === 0

  if (inVertical && inHorizontal) return true
  if (inVertical) {
    // Cut the vertical bar next to each horizontal bar that passes over it.
    return !BARS.some(
      (bar, r) =>
        !verticalOver(column, r) && within(y, [bar[0] - GAP, bar[1] + GAP]) && !within(y, bar)
    )
  }
  if (inHorizontal) {
    return !BARS.some(
      (bar, c) => verticalOver(c, row) && within(x, [bar[0] - GAP, bar[1] + GAP]) && !within(x, bar)
    )
  }
  return false
}

// --- A minimal PNG encoder (8-bit RGBA, no interlace) --------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}

function encodePng(width: number, height: number, rgba: Buffer): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0 // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}
