// Placement déterministe de la flore (sans DOM ni Three.js) : mêmes résultats dans le worker
// (rendu) et sur le thread principal (collisions, escalade).

import { hash2 } from './noise.ts';
import { groundHeight, sampleWorld, createSample, forestDensity, WATER_LEVEL } from './WorldGen.ts';

export type VegLayerId = 'colonnier' | 'arque' | 'fougere' | 'lamelle' | 'coupe' | 'bloc';

export interface VegLayerDef {
  id: VegLayerId;
  cellSize: number; // taille d'une cellule de rendu (m)
  spacing: number; // pas de la grille de candidats (m)
  viewDist: number; // distance d'affichage à qualité maximale (m)
  nearDist?: number; // en deçà : modèle détaillé (sinon modèle simplifié)
  castShadow: boolean;
  seed: number;
}

export const VEG_LAYERS: VegLayerDef[] = [
  { id: 'colonnier', cellSize: 512, spacing: 44, viewDist: 1300, nearDist: 230, castShadow: true, seed: 101 },
  { id: 'arque', cellSize: 256, spacing: 15, viewDist: 340, castShadow: false, seed: 202 },
  { id: 'bloc', cellSize: 256, spacing: 22, viewDist: 600, castShadow: true, seed: 303 },
  { id: 'fougere', cellSize: 64, spacing: 3.8, viewDist: 120, castShadow: false, seed: 404 },
  { id: 'coupe', cellSize: 64, spacing: 6, viewDist: 100, castShadow: false, seed: 505 },
  { id: 'lamelle', cellSize: 32, spacing: 1.4, viewDist: 75, castShadow: false, seed: 606 },
];

export const LAYER_BY_ID: Record<VegLayerId, VegLayerDef> = Object.fromEntries(VEG_LAYERS.map((l) => [l.id, l])) as Record<
  VegLayerId,
  VegLayerDef
>;

/** Dimensions d'un Colonnier à l'échelle 1 (partagées avec la géométrie). */
export const COLONNIER = {
  height: 38,
  trunkBase: 1.5,
  trunkTop: 0.9,
  discs: [
    { at: 0.62, r: 9, t: 1.2 },
    { at: 0.8, r: 6.8, t: 1.1 },
    { at: 1.0, r: 4.6, t: 1.0 },
  ],
};

export const INSTANCE_STRIDE = 6; // x y z rot scale tint

const sample = createSample();
const normal = { x: 0, y: 1, z: 0 };

/**
 * Instances d'une cellule (cx, cz) d'une couche, sous forme compacte [x,y,z,rot,scale,tint]×n.
 * @param density facteur de densité (qualité graphique) dans ]0, 1].
 */
export function placeCell(layerId: VegLayerId, cx: number, cz: number, density = 1): Float32Array {
  const L = LAYER_BY_ID[layerId];
  const x0 = cx * L.cellSize;
  const z0 = cz * L.cellSize;
  const sp = L.spacing;
  const gx0 = Math.ceil(x0 / sp);
  const gz0 = Math.ceil(z0 / sp);
  const gx1 = Math.ceil((x0 + L.cellSize) / sp);
  const gz1 = Math.ceil((z0 + L.cellSize) / sp);
  const out: number[] = [];
  for (let gz = gz0; gz < gz1; gz++) {
    for (let gx = gx0; gx < gx1; gx++) {
      const roll = hash2(gx, gz, L.seed);
      if (roll > density) continue; // amincissement selon la qualité
      const x = (gx + hash2(gx, gz, L.seed + 1)) * sp;
      const z = (gz + hash2(gx, gz, L.seed + 2)) * sp;
      sampleWorld(x, z, sample);
      if (sample.edge > 0.2) continue;
      const accept = hash2(gx, gz, L.seed + 3);
      const p = probability(layerId, x, z);
      if (accept > p) continue;
      const y = groundHeight(x, z, normal);
      if (!fits(layerId, y, normal.y)) continue;
      const rot = hash2(gx, gz, L.seed + 4) * Math.PI * 2;
      const r5 = hash2(gx, gz, L.seed + 5);
      const scale = scaleFor(layerId, r5);
      const tint = hash2(gx, gz, L.seed + 6);
      out.push(x, y, z, rot, scale, tint);
    }
  }
  return new Float32Array(out);
}

function probability(id: VegLayerId, x: number, z: number): number {
  const s = sample;
  const forest = forestDensity(x, z, s);
  const clear = 1 - s.pad;
  switch (id) {
    case 'colonnier':
      return clear * (1 - s.mesa * 0.85) * Math.min(1, Math.max(0, (forest - 0.42) * 2.2)) * (0.35 + 0.65 * s.west);
    case 'arque':
      return clear * (0.08 + 0.75 * forest) * (1 - s.river);
    case 'bloc':
      return (0.05 + 0.4 * s.mesa + 0.3 * s.east + 0.45 * s.canyon) * (1 - s.river) * (1 - s.pad * 0.8);
    case 'fougere':
      return clear * (0.25 + 0.6 * forest) * (1 - s.river);
    case 'coupe':
      return (0.06 + 0.45 * s.south + 0.25 * forest) * (1 - s.pad);
    case 'lamelle':
      return (0.5 + 0.3 * (1 - forest) + 0.2 * s.mesa) * (1 - s.river) * (1 - s.pad * 0.6);
  }
}

function fits(id: VegLayerId, y: number, ny: number): boolean {
  switch (id) {
    case 'colonnier':
      return ny > 0.86 && y > WATER_LEVEL + 1.2;
    case 'arque':
      return ny > 0.8 && y > WATER_LEVEL + 0.6;
    case 'bloc':
      return ny > 0.45 && y > WATER_LEVEL - 1;
    case 'fougere':
      return ny > 0.78 && y > WATER_LEVEL + 0.3;
    case 'coupe':
      return ny > 0.7 && y > WATER_LEVEL - 0.25;
    case 'lamelle':
      return ny > 0.72 && y > WATER_LEVEL + 0.15;
  }
}

function scaleFor(id: VegLayerId, r: number): number {
  switch (id) {
    case 'colonnier':
      return 0.7 + 0.95 * r * r;
    case 'arque':
      return 0.7 + 0.7 * r;
    case 'bloc':
      return 0.8 + 3.2 * r * r * r;
    case 'fougere':
      return 0.7 + 0.7 * r;
    case 'coupe':
      return 0.6 + 1.0 * r;
    case 'lamelle':
      return 0.7 + 0.6 * r;
  }
}

// ---------------------------------------------------------------------------------------------
// Collisions : cylindres verticaux (troncs, ombrelles, rochers).

export interface Cylinder {
  x: number;
  z: number;
  r: number;
  y0: number;
  y1: number;
  climbable: boolean; // tronc escaladable (Sylmar)
  platform: boolean; // dessus praticable
}

/** Tranche de collision d'un modèle (échelle 1) : cylindre de rayon r entre y0 et y1. */
export interface ColliderSlice {
  r: number;
  y0: number;
  y1: number;
  climbable: boolean;
  platform: boolean;
}

const shapes = new Map<VegLayerId, ColliderSlice[]>();

/** Remplace les collisions d'une couche par la forme mesurée sur son modèle 3D. */
export function setColliderShape(id: VegLayerId, slices: ColliderSlice[]): void {
  shapes.set(id, slices);
  colliderCache.clear();
}

export function instanceColliders(id: VegLayerId, x: number, y: number, z: number, s: number, out: Cylinder[]): void {
  const shape = shapes.get(id);
  if (shape) {
    for (const c of shape) out.push({ x, z, r: c.r * s, y0: y + c.y0 * s - (c.y0 <= 0.01 ? 1 : 0), y1: y + c.y1 * s, climbable: c.climbable, platform: c.platform });
    return;
  }
  if (id === 'colonnier') {
    const H = COLONNIER.height * s;
    out.push({ x, z, r: ((COLONNIER.trunkBase + COLONNIER.trunkTop) / 2) * s + 0.15, y0: y - 4, y1: y + H, climbable: true, platform: true });
    for (const d of COLONNIER.discs) {
      const dy = y + H * d.at;
      out.push({ x, z, r: d.r * s, y0: dy - (d.t * s) / 2, y1: dy + (d.t * s) / 2, climbable: false, platform: true });
    }
  } else if (id === 'arque') {
    out.push({ x, z, r: 0.42 * s, y0: y - 1, y1: y + 5 * s, climbable: false, platform: false });
  } else if (id === 'bloc') {
    out.push({ x, z, r: 0.82 * s, y0: y - 1, y1: y + 0.86 * s, climbable: false, platform: true });
  }
}

/** Collisions supplémentaires (structures des repères), remplies par le thread principal. */
export const staticColliders: Cylinder[] = [];

const COLLIDER_LAYERS: VegLayerId[] = ['colonnier', 'arque', 'bloc'];
const colliderCache = new Map<string, Cylinder[]>();

/** Cylindres de collision de toutes les couches solides autour d'un point (cache par cellule). */
export function collidersNear(x: number, z: number, radius: number, density: number, out: Cylinder[]): Cylinder[] {
  out.length = 0;
  for (const id of COLLIDER_LAYERS) {
    const L = LAYER_BY_ID[id];
    const reach = radius + (id === 'colonnier' ? 16 : 5);
    const cx0 = Math.floor((x - reach) / L.cellSize);
    const cx1 = Math.floor((x + reach) / L.cellSize);
    const cz0 = Math.floor((z - reach) / L.cellSize);
    const cz1 = Math.floor((z + reach) / L.cellSize);
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${id}:${cx}:${cz}:${density}`;
        let list = colliderCache.get(key);
        if (!list) {
          list = [];
          const inst = placeCell(id, cx, cz, density);
          for (let i = 0; i < inst.length; i += INSTANCE_STRIDE) {
            instanceColliders(id, inst[i], inst[i + 1], inst[i + 2], inst[i + 4], list);
          }
          colliderCache.set(key, list);
          if (colliderCache.size > 400) colliderCache.delete(colliderCache.keys().next().value!);
        }
        for (const c of list) {
          const dx = c.x - x;
          const dz = c.z - z;
          const rr = radius + c.r;
          if (dx * dx + dz * dz < rr * rr) out.push(c);
        }
      }
    }
  }
  for (const c of staticColliders) {
    const dx = c.x - x;
    const dz = c.z - z;
    const rr = radius + c.r;
    if (dx * dx + dz * dz < rr * rr) out.push(c);
  }
  return out;
}
