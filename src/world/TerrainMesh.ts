// Construction des maillages de nœuds du quadtree de terrain (exécutée dans un worker).
// Grille N×N par nœud ; les sommets impairs portent la hauteur « grossière » du niveau parent
// pour le géomorphing ; une jupe verticale sur le pourtour masque toute fissure entre niveaux.

import { heightAt, sampleWorld, createSample, forestDensity, WORLD_HALF } from './WorldGen.ts';

export const NODE_SEGMENTS = 32; // segments par côté
export const LEAF_SIZE = 64; // taille d'une feuille (m) → 2 m de résolution
export const MAX_LOD = 7; // 64 · 2^7 = 8192 m = le monde entier

export interface NodeMeshData {
  positions: Float32Array; // relatives au centre du nœud (y absolu)
  normals: Float32Array;
  morph: Float32Array; // (hauteur grossière, distance de fin de morphing, densité forestière)
  minY: number;
  maxY: number;
}

export function nodeSize(lod: number): number {
  return LEAF_SIZE * (1 << lod);
}

/** Nombre de sommets : grille (N+1)² + jupe 4N. */
export function vertexCount(N = NODE_SEGMENTS): number {
  return (N + 1) * (N + 1) + 4 * N;
}

/** Parcours horaire (vu de dessus) du pourtour de la grille : indices de sommets. */
export function perimeter(N = NODE_SEGMENTS): number[] {
  const v = (i: number, j: number) => j * (N + 1) + i;
  const p: number[] = [];
  for (let i = 0; i < N; i++) p.push(v(i, 0));
  for (let j = 0; j < N; j++) p.push(v(N, j));
  for (let i = N; i > 0; i--) p.push(v(i, N));
  for (let j = N; j > 0; j--) p.push(v(0, j));
  return p;
}

/** Index partagé par tous les nœuds (même topologie). Diagonale de chaque quad : (i,j)→(i+1,j+1). */
export function buildIndexTemplate(N = NODE_SEGMENTS): Uint16Array {
  const idx: number[] = [];
  const v = (i: number, j: number) => j * (N + 1) + i;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = v(i, j);
      const b = v(i + 1, j);
      const c = v(i, j + 1);
      const d = v(i + 1, j + 1);
      idx.push(a, c, d, a, d, b);
    }
  }
  const per = perimeter(N);
  const base = (N + 1) * (N + 1);
  for (let k = 0; k < per.length; k++) {
    const a = per[k];
    const b = per[(k + 1) % per.length];
    const a2 = base + k;
    const b2 = base + ((k + 1) % per.length);
    idx.push(a, b, a2, b, b2, a2);
  }
  return new Uint16Array(idx);
}

/**
 * Génère un nœud couvrant [x0, x0+size] × [z0, z0+size].
 * @param morphEnd distance caméra-sommet à laquelle le sommet a fini de rejoindre la forme du parent.
 */
export function buildNodeMesh(x0: number, z0: number, size: number, morphEnd: number, N = NODE_SEGMENTS): NodeMeshData {
  const S = N + 3; // grille avec une bordure d'un sommet pour les normales
  const step = size / N;
  const hs = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    const z = z0 + (j - 1) * step;
    for (let i = 0; i < S; i++) {
      hs[j * S + i] = heightAt(x0 + (i - 1) * step, z);
    }
  }
  const H = (i: number, j: number) => hs[(j + 1) * S + (i + 1)];

  const count = vertexCount(N);
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const morph = new Float32Array(count * 3);
  const cx = x0 + size / 2;
  const cz = z0 + size / 2;
  const sample = createSample();
  let minY = Infinity;
  let maxY = -Infinity;

  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i;
      const x = x0 + i * step;
      const z = z0 + j * step;
      const h = H(i, j);
      positions[k * 3] = x - cx;
      positions[k * 3 + 1] = h;
      positions[k * 3 + 2] = z - cz;
      if (h < minY) minY = h;
      if (h > maxY) maxY = h;

      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const len = Math.sqrt(dx * dx + 1 + dz * dz);
      normals[k * 3] = -dx / len;
      normals[k * 3 + 1] = 1 / len;
      normals[k * 3 + 2] = -dz / len;

      // Hauteur grossière (niveau parent) selon la parité, cohérente avec la diagonale.
      const oi = i & 1;
      const oj = j & 1;
      let coarse = h;
      if (oi && !oj) coarse = 0.5 * (H(i - 1, j) + H(i + 1, j));
      else if (!oi && oj) coarse = 0.5 * (H(i, j - 1) + H(i, j + 1));
      else if (oi && oj) coarse = 0.5 * (H(i - 1, j - 1) + H(i + 1, j + 1));
      morph[k * 3] = coarse;
      morph[k * 3 + 1] = morphEnd;
      // Densité forestière (teinte de canopée au loin) : échantillonnage clairsemé suffisant.
      morph[k * 3 + 2] = (i % 4 === 0 && j % 4 === 0) || size <= 128 ? forestDensity(x, z, sampleWorld(x, z, sample)) : -1;
    }
  }
  // Complète la densité forestière par interpolation des échantillons calculés.
  if (size > 128) {
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        if (morph[k * 3 + 2] >= 0) continue;
        const i0 = Math.floor(i / 4) * 4;
        const j0 = Math.floor(j / 4) * 4;
        const i1 = Math.min(N, i0 + 4);
        const j1 = Math.min(N, j0 + 4);
        const fx = i1 === i0 ? 0 : (i - i0) / (i1 - i0);
        const fz = j1 === j0 ? 0 : (j - j0) / (j1 - j0);
        const f = (ii: number, jj: number) => morph[(jj * (N + 1) + ii) * 3 + 2];
        morph[k * 3 + 2] = (f(i0, j0) * (1 - fx) + f(i1, j0) * fx) * (1 - fz) + (f(i0, j1) * (1 - fx) + f(i1, j1) * fx) * fz;
      }
    }
  }

  // Jupe : copie du pourtour abaissée.
  const skirt = Math.min(size * 0.04 + 3, 120);
  const per = perimeter(N);
  const base = (N + 1) * (N + 1);
  for (let k = 0; k < per.length; k++) {
    const src = per[k];
    const dst = base + k;
    positions[dst * 3] = positions[src * 3];
    positions[dst * 3 + 1] = positions[src * 3 + 1] - skirt;
    positions[dst * 3 + 2] = positions[src * 3 + 2];
    normals[dst * 3] = normals[src * 3];
    normals[dst * 3 + 1] = normals[src * 3 + 1];
    normals[dst * 3 + 2] = normals[src * 3 + 2];
    morph[dst * 3] = morph[src * 3] - skirt;
    morph[dst * 3 + 1] = morphEnd;
    morph[dst * 3 + 2] = morph[src * 3 + 2];
  }
  return { positions, normals, morph, minY: minY - skirt, maxY };
}

/** Estimation rapide de l'étendue verticale d'un nœud (pour la sélection LOD avant génération). */
export function estimateNodeYRange(x0: number, z0: number, size: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  const n = 5;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const h = heightAt(x0 + (i / (n - 1)) * size, z0 + (j / (n - 1)) * size);
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  const margin = 8 + size * 0.03;
  return [lo - margin, hi + margin];
}

export function nodeOrigin(lod: number, ix: number, iz: number): [number, number] {
  const s = nodeSize(lod);
  return [-WORLD_HALF + ix * s, -WORLD_HALF + iz * s];
}
