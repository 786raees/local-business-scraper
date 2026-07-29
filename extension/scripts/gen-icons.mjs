// Generates the extension icons: navy rounded square with a green phone dot.
// Zero dependencies — writes PNGs via zlib + manual chunk encoding.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NAVY = [15, 20, 45] // tokens.css --bg-surface
const GREEN = [33, 194, 94] // --state-incall
const AMBER = [255, 191, 0] // --state-ringing

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixelAt) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      raw.writeUInt8(r, row + 1 + x * 4)
      raw.writeUInt8(g, row + 2 + x * 4)
      raw.writeUInt8(b, row + 3 + x * 4)
      raw.writeUInt8(a, row + 4 + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function icon(size) {
  const c = size / 2
  const corner = size * 0.19
  const dotR = size * 0.21
  const dotC = size * 0.60
  const ringR = size * 0.34
  return png(size, (x, y) => {
    // Rounded-square mask
    const dx = Math.max(0, Math.max(corner - x, x - (size - 1 - corner)))
    const dy = Math.max(0, Math.max(corner - y, y - (size - 1 - corner)))
    if (Math.hypot(dx, dy) > corner) return [0, 0, 0, 0]
    // Amber ring arc (upper-left)
    const dRing = Math.hypot(x - c * 0.75, y - c * 0.75)
    if (Math.abs(dRing - ringR) < size * 0.055 && x < c && y < c) return [...AMBER, 255]
    // Green dot (lower-right)
    if (Math.hypot(x - dotC, y - dotC) < dotR) return [...GREEN, 255]
    return [...NAVY, 255]
  })
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(outDir, { recursive: true })
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon${size}.png`), icon(size))
  console.log(`icon${size}.png`)
}
