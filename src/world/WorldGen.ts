// Génération du relief de Veyra : fonction de hauteur analytique et déterministe.
// Partagée entre le thread principal (physique, placement) et les workers (maillages).
// Convention : nord = -Z, est = +X, sud = +Z, ouest = -X. Unités : mètres.

import { createSimplex2D, fbm, ridged, smoothstep, lerp, type Noise2D } from './noise.ts';

export const WORLD_SEED = 7391;
export const WORLD_HALF = 4096; // le continent tient dans [-4096, 4096]²
export const WATER_LEVEL = 0;
export const GRID_SPACING = 2; // résolution des feuilles du quadtree (m)
/** Distance « super-ellipse » au-delà de laquelle l'eau n'est plus dessinée (bord du continent). */
export const WATER_EDGE = 3580;

const n = (k: number): Noise2D => createSimplex2D(WORLD_SEED * 31 + k * 977);
const nWarpA = n(1);
const nWarpB = n(2);
const nBase = n(3);
const nHill = n(4);
const nDetail = n(5);
const nRidge = n(6);
const nMesa = n(7);
const nMesaTop = n(8);
const nMesaSide = n(9);
const nCanyon = n(10);
const nMarsh = n(11);
const nRiver = n(12);
const nEdge = n(13);
const nForest = n(14);
const nErode = n(15);
const nRough = n(16);

/** Résultat détaillé d'un échantillon du monde (réutilisé pour éviter les allocations). */
export interface WorldSample {
  h: number;
  mesa: number; // 0..1 : sur un plateau des Tables de Sorr
  canyon: number; // 0..1 : dans la Faille d'Ambre
  river: number; // 0..1 : dans le lit d'une rivière
  bank: number; // 0..1 : sur les berges
  north: number;
  east: number;
  west: number;
  south: number;
  edge: number; // 0..1 : proximité du bord du monde
  pad: number; // 0..1 : sur une esplanade aménagée
}

export function createSample(): WorldSample {
  return { h: 0, mesa: 0, canyon: 0, river: 0, bank: 0, north: 0, east: 0, west: 0, south: 0, edge: 0, pad: 0 };
}

/** Distance « carré arrondi » depuis le centre (super-ellipse d'exposant 4). */
export function edgeDistance(x: number, z: number): number {
  const ax = x * x;
  const az = z * z;
  return Math.pow(ax * ax + az * az, 0.25);
}

/** Ligne centrale de la Faille d'Ambre (x en fonction de z). */
export function canyonCenterX(z: number): number {
  return 2350 + 280 * fbm(nCanyon, z / 1600, 3.3, 3);
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
  /** rayon de l'esplanade aplanie (0 = pas d'aplanissement) */
  padRadius: number;
  padHeight: number;
  faction: 'sylmar' | 'halden' | 'neutral';
}

export const LANDMARKS: Landmark[] = [
  { id: 'vehra-tal', name: 'Vehra-Tal', x: -2350, z: 250, padRadius: 70, padHeight: 0, faction: 'sylmar' },
  { id: 'kessel', name: 'Forage Kessel', x: 0, z: -450, padRadius: 115, padHeight: 0, faction: 'halden' },
  { id: 'sorr', name: 'Tables de Sorr', x: -300, z: -2500, padRadius: 0, padHeight: 0, faction: 'neutral' },
  { id: 'vesh', name: 'Marais de Vesh', x: 400, z: 2600, padRadius: 0, padHeight: 0, faction: 'neutral' },
  { id: 'ilun', name: "Bassin d'Ilun", x: 0, z: 0, padRadius: 0, padHeight: 0, faction: 'neutral' },
];

// La station Halden se trouve sur la rive ouest de la faille, à 300 m de son axe.
LANDMARKS[1].x = canyonCenterX(LANDMARKS[1].z) - 300;

const tmp = createSample();

function baseSample(x: number, z: number, out: WorldSample): WorldSample {
  const wx = x + 260 * fbm(nWarpA, x / 1500, z / 1500, 3);
  const wz = z + 260 * fbm(nWarpB, x / 1500 + 19.1, z / 1500 - 7.7, 3);

  const north = smoothstep(-300, -1700, z);
  const east = smoothstep(900, 2100, x);
  const west = smoothstep(-700, -1900, x);
  const south = smoothstep(700, 1900, z);

  // Collines de fond, collines moyennes et détail fin.
  let h = 30 + 24 * fbm(nBase, wx / 1700, wz / 1700, 5);
  h += 9 * fbm(nHill, wx / 420, wz / 420, 4);
  const detail = fbm(nDetail, x / 70, z / 70, 3);
  h += 2.2 * detail;

  // Crêtes (surtout à l'est) et hautes-terres orientales.
  const r = ridged(nRidge, wx / 950, wz / 950, 4);
  h += r * r * (16 + 90 * east);
  h += 38 * east + 8 * west;

  // Relief érodé : réseau de ravines et de contreforts (crêtes déformées), plus marqué en altitude,
  // puis rugosité fine de 1 à 2 m. Casse l'aspect « collines lisses » de la génération par zones.
  const hilly = smoothstep(26, 75, h);
  const er = ridged(nErode, wx / 230 + 0.35 * detail, wz / 230 - 0.3 * detail, 4);
  h += (er * er - 0.28) * (5 + 26 * hilly) * (1 - south * 0.9);
  const gully = ridged(nErode, wx / 75 + 13.1, wz / 75 - 4.2, 2);
  h -= gully * gully * (0.6 + 3.2 * hilly) * (1 - south);
  h += fbm(nRough, x / 17, z / 17, 2) * (0.45 + 1.4 * hilly) + fbm(nRough, x / 6.5 + 50, z / 6.5, 1) * 0.25;

  // Tables de Sorr : plateaux à falaises, certaines faces en pente d'éboulis praticable.
  let mesa = 0;
  const m = fbm(nMesa, wx / 650, wz / 650, 3) + 0.62 * north - 0.44;
  if (m > -0.25) {
    const side = 0.5 + 0.5 * nMesaSide(x / 380, z / 380);
    const sharp = lerp(0.025, 0.22, side * side);
    mesa = smoothstep(-sharp, sharp, m);
    if (mesa > 0) {
      const top = 150 + 45 * fbm(nMesaTop, x / 600, z / 600, 2) + 3 * detail;
      const t = lerp(h, Math.max(h, top), mesa);
      // Strates : corniches successives sur les flancs (comme une roche sédimentaire).
      const step = 8.5;
      const f = t / step - Math.floor(t / step);
      const terraced = (Math.floor(t / step) + smoothstep(0.55, 0.95, f)) * step;
      const flank = 4 * mesa * (1 - mesa);
      h = lerp(t, terraced, Math.min(1, flank * 1.6) * 0.7);
    }
  }

  // Faille d'Ambre : canyon sinueux orienté nord-sud, avec un chenal d'eau au fond.
  let canyon = 0;
  if (x > 1300) {
    const cx = canyonCenterX(z);
    const dC = Math.abs(x - cx);
    if (dC < 260) {
      const cw = 60 + 25 * fbm(nCanyon, z / 400, 8.1, 2);
      const along = smoothstep(-3300, -2500, z) * smoothstep(3300, 2500, z);
      canyon = (1 - smoothstep(cw, cw + 45, dC)) * along;
      if (canyon > 0) {
        const floor = 5 + 2 * detail;
        h = lerp(h, floor, canyon);
        const chan = (1 - smoothstep(cw * 0.3, cw * 0.5, dC)) * along;
        h = lerp(h, -3 + detail * 0.4, chan);
      }
    }
  }

  // Marais de Vesh : terres basses à fleur d'eau.
  if (south > 0) {
    const marsh = -0.4 + 2.6 * fbm(nMarsh, x / 160, z / 160, 3) + 1.0 * detail;
    h = lerp(h, marsh, south * 0.985);
  }

  // Réseau de rivières (isolignes d'un bruit basse fréquence).
  const rv = Math.abs(fbm(nRiver, wx / 1700, wz / 1700, 2));
  const rw = 0.028;
  const allowed = (1 - mesa) * (1 - east);
  const bank = (1 - smoothstep(rw, rw * 3.2, rv)) * allowed;
  const river = (1 - smoothstep(rw * 0.35, rw, rv)) * allowed;
  if (bank > 0) {
    h = lerp(h, Math.min(h, 2.5 + (h - 2.5) * 0.25), bank);
    h = lerp(h, -3.2 + detail * 0.5, river);
  }

  out.h = h;
  out.mesa = mesa;
  out.canyon = canyon;
  out.river = river;
  out.bank = bank;
  out.north = north;
  out.east = east;
  out.west = west;
  out.south = south;
  out.edge = 0;
  out.pad = 0;
  return out;
}

// Hauteur des esplanades : hauteur brute au centre, calculée une seule fois.
for (const lm of LANDMARKS) {
  if (lm.padRadius > 0) lm.padHeight = Math.max(baseSample(lm.x, lm.z, tmp).h, 4);
}

/** Échantillon complet du monde au point (x, z). */
export function sampleWorld(x: number, z: number, out: WorldSample = createSample()): WorldSample {
  baseSample(x, z, out);
  let h = out.h;

  // Esplanades aménagées (village, station).
  for (let i = 0; i < LANDMARKS.length; i++) {
    const lm = LANDMARKS[i];
    if (lm.padRadius <= 0) continue;
    const dx = x - lm.x;
    const dz = z - lm.z;
    const d2 = dx * dx + dz * dz;
    const outer = lm.padRadius * 1.9;
    if (d2 < outer * outer) {
      const p = 1 - smoothstep(lm.padRadius, outer, Math.sqrt(d2));
      h = lerp(h, lm.padHeight, p);
      if (p > out.pad) out.pad = p;
    }
  }

  // Bord du monde : bourrelet puis à-pic sur la Mer de Brume.
  const d = edgeDistance(x, z) + 40 * fbm(nEdge, x / 500, z / 500, 2);
  if (d > 3250) {
    h = lerp(h, Math.max(h, 22 + 4 * fbm(nDetail, x / 70, z / 70, 2)), smoothstep(3250, 3450, d));
    const drop = smoothstep(3700, 3840, d);
    h = lerp(h, -280, drop);
    out.edge = smoothstep(3450, 3800, d);
  }
  out.h = h;
  return out;
}

/** Hauteur analytique du terrain. */
export function heightAt(x: number, z: number): number {
  return sampleWorld(x, z, tmp).h;
}

/**
 * Hauteur du sol telle qu'elle est DESSINÉE au niveau de détail le plus fin :
 * interpolation sur la même triangulation que le maillage (grille de 2 m, diagonale (x0,z0)-(x1,z1)).
 */
export function groundHeight(x: number, z: number, normalOut?: { x: number; y: number; z: number }): number {
  const gx = (x + WORLD_HALF) / GRID_SPACING;
  const gz = (z + WORLD_HALF) / GRID_SPACING;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const fx = gx - ix;
  const fz = gz - iz;
  const x0 = ix * GRID_SPACING - WORLD_HALF;
  const z0 = iz * GRID_SPACING - WORLD_HALF;
  const h00 = heightAt(x0, z0);
  const h11 = heightAt(x0 + GRID_SPACING, z0 + GRID_SPACING);
  let h: number;
  let dhdx: number;
  let dhdz: number;
  if (fx >= fz) {
    const h10 = heightAt(x0 + GRID_SPACING, z0);
    h = h00 + fx * (h10 - h00) + fz * (h11 - h10);
    dhdx = (h10 - h00) / GRID_SPACING;
    dhdz = (h11 - h10) / GRID_SPACING;
  } else {
    const h01 = heightAt(x0, z0 + GRID_SPACING);
    h = h00 + fz * (h01 - h00) + fx * (h11 - h01);
    dhdx = (h11 - h01) / GRID_SPACING;
    dhdz = (h01 - h00) / GRID_SPACING;
  }
  if (normalOut) {
    const len = Math.sqrt(dhdx * dhdx + 1 + dhdz * dhdz);
    normalOut.x = -dhdx / len;
    normalOut.y = 1 / len;
    normalOut.z = -dhdz / len;
  }
  return h;
}

/** Densité forestière 0..1 (utilisée par la végétation et la teinte lointaine du terrain). */
export function forestDensity(x: number, z: number, s: WorldSample): number {
  let d = 0.5 + 0.38 * fbm(nForest, x / 650, z / 650, 3);
  d += 0.32 * s.west - 0.1 * s.south - 0.15 * s.east;
  d *= 1 - 0.75 * s.mesa;
  d *= 1 - s.canyon;
  d *= 1 - 0.9 * s.bank;
  d *= 1 - s.edge;
  return Math.min(1, Math.max(0, d));
}

/** Nom de la région au point donné (affichage HUD). */
export function regionName(x: number, z: number): string {
  const s = sampleWorld(x, z, tmp);
  if (s.edge > 0.5) return 'Mer de Brume';
  if (s.pad > 0.5) {
    for (const lm of LANDMARKS) {
      if (lm.padRadius > 0 && Math.hypot(x - lm.x, z - lm.z) < lm.padRadius * 1.6) return lm.name;
    }
  }
  if (s.canyon > 0.3) return "Faille d'Ambre";
  if (s.mesa > 0.5 || s.north > 0.6) return 'Tables de Sorr';
  if (s.west > 0.5) return 'Forêt des Colonniers';
  if (s.south > 0.5) return 'Marais de Vesh';
  if (s.east > 0.5) return "Hautes-terres d'Ambre";
  return "Bassin d'Ilun";
}

/** Point d'apparition d'un camp (sol sûr, hors de l'eau). */
export function spawnPoint(faction: 'sylmar' | 'halden'): { x: number; y: number; z: number } {
  const lm = LANDMARKS.find((l) => l.id === (faction === 'sylmar' ? 'vehra-tal' : 'kessel'))!;
  const x = lm.x + (faction === 'sylmar' ? 18 : -30);
  const z = lm.z + 10;
  return { x, y: groundHeight(x, z), z };
}
