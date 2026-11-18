// Bruits procéduraux déterministes (aucune dépendance au DOM : utilisable dans un worker et sous Node).

/** Générateur pseudo-aléatoire mulberry32 : rapide, déterministe, période 2^32. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hachage entier 2D → [0, 1). Sert au placement déterministe (végétation, détails). */
export function hash2(ix: number, iz: number, seed = 0): number {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const GRAD2 = new Float32Array([
  1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1, 0.7071, 0.7071, -0.7071, 0.7071, 0.7071, -0.7071, -0.7071, -0.7071,
]);
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function buildPerm(seed: number): Uint8Array {
  const rand = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  return perm;
}

export type Noise2D = (x: number, y: number) => number;

/** Bruit simplex 2D (algorithme de Perlin, formulation de Gustavson). Sortie ≈ [-1, 1]. */
export function createSimplex2D(seed: number): Noise2D {
  const perm = buildPerm(seed);
  return (xin: number, yin: number): number => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = (perm[ii + perm[jj]] % 12) * 2;
      t0 *= t0;
      n += t0 * t0 * (GRAD2[g] * x0 + GRAD2[g + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = (perm[ii + i1 + perm[jj + j1]] % 12) * 2;
      t1 *= t1;
      n += t1 * t1 * (GRAD2[g] * x1 + GRAD2[g + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = (perm[ii + 1 + perm[jj + 1]] % 12) * 2;
      t2 *= t2;
      n += t2 * t2 * (GRAD2[g] * x2 + GRAD2[g + 1] * y2);
    }
    return 70 * n;
  };
}

/** Somme fractale (fBm) normalisée dans ≈ [-1, 1]. */
export function fbm(noise: Noise2D, x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq + o * 17.13, y * freq - o * 9.71);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Bruit « en crêtes » dans [0, 1] (1 sur les crêtes). */
export function ridged(noise: Noise2D, x: number, y: number, octaves: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let prev = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(noise(x * freq + o * 31.7, y * freq + o * 11.3));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------------------------
// Bruit de gradient PÉRIODIQUE : pour des textures qui se raccordent sans couture.

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export type TileNoise = (x: number, y: number, period: number) => number;

/** Bruit de Perlin 2D périodique (période entière en cellules). Sortie ≈ [-1, 1]. */
export function createTileableNoise(seed: number): TileNoise {
  const perm = buildPerm(seed);
  const grad = (ix: number, iy: number, period: number, dx: number, dy: number): number => {
    const px = ((ix % period) + period) % period;
    const py = ((iy % period) + period) % period;
    const h = perm[(px & 255) + perm[py & 255]] & 7;
    const a = (h / 8) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  return (x: number, y: number, period: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const u = fade(fx);
    const v = fade(fy);
    const n00 = grad(ix, iy, period, fx, fy);
    const n10 = grad(ix + 1, iy, period, fx - 1, fy);
    const n01 = grad(ix, iy + 1, period, fx, fy - 1);
    const n11 = grad(ix + 1, iy + 1, period, fx - 1, fy - 1);
    const nx0 = n00 + u * (n10 - n00);
    const nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.41;
  };
}

/** fBm périodique : la période double avec chaque octave pour rester raccordable. */
export function tileFbm(noise: TileNoise, u: number, v: number, basePeriod: number, octaves: number, gain = 0.5): number {
  let amp = 1;
  let period = basePeriod;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(u * period + o * 13, v * period + o * 7, period);
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  return sum / norm;
}

/** Bruit cellulaire (Worley) périodique : distance au point le plus proche, dans [0, ~1]. */
export function tileWorley(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let best = 9;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 101);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
