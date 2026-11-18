// Aperçu du relief : carte ombrée (vue de dessus) écrite en PNG.
// Usage : node scripts/preview-world.ts <sortie.png> [taille=768] [x0 z0 x1 z1]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { sampleWorld, createSample, WATER_LEVEL, LANDMARKS, forestDensity, edgeDistance, WATER_EDGE } from '../src/world/WorldGen.ts';

const out = process.argv[2] ?? 'world.png';
const size = Number(process.argv[3] ?? 768);
const [x0, z0, x1, z1] = process.argv.length >= 8 ? process.argv.slice(4, 8).map(Number) : [-4096, -4096, 4096, 4096];

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())]);
}

const s = createSample();
const H = new Float32Array(size * size);
const F = new Float32Array(size * size);
let minH = Infinity;
let maxH = -Infinity;
let water = 0;
const t0 = performance.now();
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const x = x0 + ((i + 0.5) / size) * (x1 - x0);
    const z = z0 + ((j + 0.5) / size) * (z1 - z0);
    sampleWorld(x, z, s);
    H[j * size + i] = s.h;
    F[j * size + i] = forestDensity(x, z, s);
    minH = Math.min(minH, s.h);
    maxH = Math.max(maxH, s.h);
    if (s.h < WATER_LEVEL && edgeDistance(x, z) < WATER_EDGE) water++;
  }
}
const ms = performance.now() - t0;
const px = (x1 - x0) / size;
const rgb = new Uint8Array(size * size * 3);
for (let j = 0; j < size; j++) {
  for (let i = 0; i < size; i++) {
    const k = j * size + i;
    const h = H[k];
    const hx = H[j * size + Math.min(size - 1, i + 1)] - h;
    const hz = H[Math.min(size - 1, j + 1) * size + i] - h;
    const shade = Math.max(0.25, Math.min(1.3, 0.85 - (hx + hz) / px * 0.9));
    let r: number, g: number, b: number;
    const x = x0 + ((i + 0.5) / size) * (x1 - x0);
    const z = z0 + ((j + 0.5) / size) * (z1 - z0);
    if (h < WATER_LEVEL && edgeDistance(x, z) < WATER_EDGE) {
      r = 40; g = 90; b = 120;
    } else if (h < -30) {
      r = 180; g = 170; b = 190;
    } else {
      const t = Math.min(1, Math.max(0, h / 220));
      const f = F[k];
      r = 70 + 120 * t - 30 * f;
      g = 110 + 60 * t - 20 * f;
      b = 60 + 110 * t;
      r *= shade; g *= shade; b *= shade;
    }
    rgb[k * 3] = Math.max(0, Math.min(255, r));
    rgb[k * 3 + 1] = Math.max(0, Math.min(255, g));
    rgb[k * 3 + 2] = Math.max(0, Math.min(255, b));
  }
}
// repères
for (const lm of LANDMARKS) {
  const ci = Math.round(((lm.x - x0) / (x1 - x0)) * size);
  const cj = Math.round(((lm.z - z0) / (z1 - z0)) * size);
  for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
    const ii = ci + di, jj = cj + dj;
    if (ii < 0 || jj < 0 || ii >= size || jj >= size) continue;
    const k = jj * size + ii;
    rgb[k * 3] = 255; rgb[k * 3 + 1] = lm.faction === 'halden' ? 140 : 40; rgb[k * 3 + 2] = lm.faction === 'sylmar' ? 255 : 30;
  }
}
writeFileSync(out, encodePNG(size, size, rgb));
console.log(`ok ${out} ${size}px  min=${minH.toFixed(1)} max=${maxH.toFixed(1)}  eau=${((water / (size * size)) * 100).toFixed(1)}%  ${((ms / (size * size)) * 1000).toFixed(2)} µs/échantillon`);
for (const lm of LANDMARKS) console.log(lm.id, Math.round(lm.x), Math.round(lm.z), 'pad', lm.padHeight.toFixed(1));
