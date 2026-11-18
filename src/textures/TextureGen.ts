// Textures PBR procédurales raccordables (exécutées dans un worker, sans DOM).
// Sortie par matériau : albédo+rugosité (RGBA) et normale+hauteur (RGBA), 8 bits.

import { createTileableNoise, tileFbm, hash2, type TileNoise } from '../world/noise.ts';

export const TERRAIN_MATERIALS = ['mousse', 'humus', 'roche', 'limon', 'feuilles'] as const;
export type TerrainMaterialId = (typeof TERRAIN_MATERIALS)[number];

export interface MaterialTexture {
  size: number;
  albedoRough: Uint8Array; // r g b = albédo (sRGB), a = rugosité
  normalHeight: Uint8Array; // r g b = normale tangente, a = hauteur
}

interface Texel {
  r: number;
  g: number;
  b: number;
  rough: number;
  h: number;
}

/** Distances au 1er et 2e point le plus proche (Worley périodique). */
function worley2(u: number, v: number, period: number, seed: number, out: { f1: number; f2: number; id: number }) {
  const x = u * period;
  const y = v * period;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  let id = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = ix + ox;
      const cy = iy + oy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 101);
      const d = Math.sqrt((px - x) * (px - x) + (py - y) * (py - y));
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash2(wx, wy, seed + 202);
      } else if (d < f2) f2 = d;
    }
  }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
}

const mixc = (a: number, b: number, t: number) => a + (b - a) * t;
const sat = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const sstep = (e0: number, e1: number, x: number) => {
  const t = sat((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

type Shader = (u: number, v: number, out: Texel) => void;

function mossShader(n: TileNoise): Shader {
  const w = { f1: 0, f2: 0, id: 0 };
  return (u, v, o) => {
    const big = tileFbm(n, u, v, 4, 4);
    worley2(u, v, 22, 11, w);
    const clump = 1 - sat(w.f1 * 1.6); // touffes de mousse
    const fine = tileFbm(n, u + 0.37, v + 0.11, 48, 3);
    const h = 0.45 + 0.3 * clump + 0.12 * fine + 0.1 * big;
    // vert-sarcelle profond, sommets plus clairs et jaunâtres
    o.r = mixc(0.1, 0.24, h) + 0.04 * big;
    o.g = mixc(0.2, 0.36, h);
    o.b = mixc(0.15, 0.2, h) - 0.03 * big;
    // minuscules fleurs violettes
    worley2(u, v, 70, 23, w);
    if (w.f1 < 0.09 && w.id > 0.72) {
      const f = 1 - w.f1 / 0.09;
      o.r = mixc(o.r, 0.45, f);
      o.g = mixc(o.g, 0.22, f);
      o.b = mixc(o.b, 0.6, f);
    }
    o.rough = 0.9 - 0.08 * clump;
    o.h = h;
  };
}

function humusShader(n: TileNoise): Shader {
  const w = { f1: 0, f2: 0, id: 0 };
  return (u, v, o) => {
    const base = tileFbm(n, u, v, 6, 4);
    worley2(u, v, 18, 31, w);
    // feuilles mortes : cellules allongées aux bords nets
    const leaf = sstep(0.0, 0.12, w.f2 - w.f1);
    const tone = w.id;
    o.r = mixc(0.2, 0.4, tone) * (0.6 + 0.4 * leaf);
    o.g = mixc(0.12, 0.22, tone) * (0.6 + 0.4 * leaf);
    o.b = mixc(0.08, 0.12, tone) * (0.6 + 0.4 * leaf);
    // brindilles
    const twig = Math.abs(n(u * 30 + 3.1, v * 9 + 1.7, 30));
    if (twig < 0.04) {
      o.r *= 0.55;
      o.g *= 0.5;
      o.b *= 0.5;
    }
    o.r += 0.04 * base;
    o.g += 0.03 * base;
    o.rough = 0.82 + 0.1 * (1 - leaf);
    o.h = 0.35 + 0.35 * leaf + 0.15 * base - (twig < 0.04 ? 0 : 0) + 0.1 * tone;
  };
}

function rockShader(n: TileNoise): Shader {
  const w = { f1: 0, f2: 0, id: 0 };
  return (u, v, o) => {
    const big = tileFbm(n, u, v, 3, 5);
    // strates horizontales (v = vertical sur les falaises en projection latérale)
    const strata = 0.5 + 0.5 * Math.sin((v * 14 + big * 0.9) * Math.PI * 2);
    worley2(u, v, 9, 47, w);
    const crack = 1 - sstep(0.0, 0.05, w.f2 - w.f1);
    const grain = tileFbm(n, u + 0.5, v + 0.25, 40, 3);
    const h = 0.55 + 0.2 * big + 0.12 * strata + 0.08 * grain - 0.45 * crack;
    const tone = 0.3 + 0.1 * strata + 0.08 * big + 0.05 * w.id;
    o.r = tone * 0.96;
    o.g = tone * 0.95;
    o.b = tone * 1.04;
    // lichen cuivré dans les creux
    const lichen = sstep(0.55, 0.75, tileFbm(n, u + 0.71, v + 0.33, 10, 3) * 0.5 + 0.5);
    o.r = mixc(o.r, 0.55, lichen * 0.45);
    o.g = mixc(o.g, 0.4, lichen * 0.45);
    o.b = mixc(o.b, 0.28, lichen * 0.45);
    o.r *= 1 - 0.6 * crack;
    o.g *= 1 - 0.6 * crack;
    o.b *= 1 - 0.6 * crack;
    o.rough = 0.72 + 0.15 * crack - 0.1 * strata * 0.3;
    o.h = h;
  };
}

function siltShader(n: TileNoise): Shader {
  const w = { f1: 0, f2: 0, id: 0 };
  return (u, v, o) => {
    const big = tileFbm(n, u, v, 4, 4);
    const ripple = 0.5 + 0.5 * Math.sin((u * 26 + v * 7 + big * 1.6) * Math.PI * 2);
    worley2(u, v, 34, 59, w);
    const pebble = 1 - sstep(0.18, 0.3, w.f1);
    const isPebble = w.id > 0.6 ? pebble : 0;
    let h = 0.4 + 0.18 * ripple + 0.15 * big;
    h = mixc(h, 0.85, isPebble);
    o.r = mixc(0.52, 0.62, ripple) + 0.05 * big;
    o.g = mixc(0.44, 0.52, ripple) + 0.04 * big;
    o.b = mixc(0.32, 0.38, ripple);
    if (isPebble > 0) {
      const t = 0.3 + 0.4 * w.id;
      o.r = mixc(o.r, t * 0.9, isPebble);
      o.g = mixc(o.g, t * 0.88, isPebble);
      o.b = mixc(o.b, t, isPebble);
    }
    o.rough = mixc(0.55, 0.35, isPebble) + 0.1 * big;
    o.h = h;
  };
}

function linearToSrgb8(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.round(sat(v) * 255);
}

/** Génère les deux cartes d'un matériau à la taille demandée (puissance de 2). */
export function generateMaterialTexture(id: TerrainMaterialId, size: number): MaterialTexture {
  const noise = createTileableNoise(1000 + TERRAIN_MATERIALS.indexOf(id) * 77);
  const shader =
    id === 'mousse' ? mossShader(noise) : id === 'humus' || id === 'feuilles' ? humusShader(noise) : id === 'roche' ? rockShader(noise) : siltShader(noise);
  const albedoRough = new Uint8Array(size * size * 4);
  const normalHeight = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const t: Texel = { r: 0, g: 0, b: 0, rough: 0, h: 0 };
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      shader(u, v, t);
      const k = (y * size + x) * 4;
      albedoRough[k] = linearToSrgb8(t.r);
      albedoRough[k + 1] = linearToSrgb8(t.g);
      albedoRough[k + 2] = linearToSrgb8(t.b);
      albedoRough[k + 3] = Math.round(sat(t.rough) * 255);
      heights[y * size + x] = sat(t.h);
    }
  }
  // Normale par différences finies (raccordée sur les bords).
  const strength = id === 'roche' ? 5 : id === 'humus' ? 3.5 : 2.5;
  const scale = (strength * size) / 512;
  for (let y = 0; y < size; y++) {
    const ym = ((y - 1 + size) % size) * size;
    const yp = ((y + 1) % size) * size;
    const yc = y * size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const dx = (heights[yc + xp] - heights[yc + xm]) * scale;
      const dy = (heights[yp + x] - heights[ym + x]) * scale;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const k = (yc + x) * 4;
      normalHeight[k] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      normalHeight[k + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      normalHeight[k + 2] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      normalHeight[k + 3] = Math.round(heights[yc + x] * 255);
    }
  }
  return { size, albedoRough, normalHeight };
}
