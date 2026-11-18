import { describe, expect, it } from 'vitest';
import { createSimplex2D, createTileableNoise, hash2, tileFbm } from '../src/world/noise.ts';
import { groundHeight, heightAt, LANDMARKS, regionName, spawnPoint, WATER_LEVEL, edgeDistance, WORLD_HALF, GRID_SPACING } from '../src/world/WorldGen.ts';
import { buildIndexTemplate, buildNodeMesh, perimeter, vertexCount, NODE_SEGMENTS, LEAF_SIZE } from '../src/world/TerrainMesh.ts';
import { placeCell, INSTANCE_STRIDE, collidersNear, VEG_LAYERS } from '../src/world/VegetationPlacement.ts';
import { generateMaterialTexture } from '../src/textures/TextureGen.ts';

describe('bruit', () => {
  it('est déterministe et borné', () => {
    const a = createSimplex2D(42);
    const b = createSimplex2D(42);
    for (let i = 0; i < 500; i++) {
      const x = i * 0.37 - 50;
      const y = i * 0.11 + 3;
      expect(a(x, y)).toBe(b(x, y));
      expect(Math.abs(a(x, y))).toBeLessThanOrEqual(1.01);
    }
  });

  it('hash2 reste dans [0, 1[', () => {
    for (let i = -100; i < 100; i++) {
      const h = hash2(i, i * 7, 3);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(1);
    }
  });

  it('le bruit périodique se raccorde', () => {
    const n = createTileableNoise(9);
    for (let i = 0; i < 20; i++) {
      const v = i / 20;
      expect(tileFbm(n, 0, v, 4, 3)).toBeCloseTo(tileFbm(n, 1, v, 4, 3), 5);
      expect(tileFbm(n, v, 0, 4, 3)).toBeCloseTo(tileFbm(n, v, 1, 4, 3), 5);
    }
  });
});

describe('relief de Veyra', () => {
  it('est continu (pas de falaise infinie entre deux points voisins)', () => {
    let maxStep = 0;
    for (let i = 0; i < 2000; i++) {
      const x = -3400 + ((i * 97) % 6800);
      const z = -3400 + ((i * 53) % 6800);
      maxStep = Math.max(maxStep, Math.abs(heightAt(x + 0.5, z) - heightAt(x, z)));
    }
    expect(maxStep).toBeLessThan(10);
  });

  it('les esplanades des repères sont planes et hors de l’eau', () => {
    for (const lm of LANDMARKS.filter((l) => l.padRadius > 0)) {
      const h0 = heightAt(lm.x, lm.z);
      expect(h0).toBeGreaterThan(WATER_LEVEL + 2);
      for (const [dx, dz] of [[20, 0], [0, 20], [-20, -10]]) {
        expect(Math.abs(heightAt(lm.x + dx, lm.z + dz) - h0)).toBeLessThan(0.5);
      }
    }
  });

  it('le bord du monde plonge dans la Mer de Brume', () => {
    expect(heightAt(4000, 0)).toBeLessThan(-150);
    expect(heightAt(0, -4050)).toBeLessThan(-150);
    expect(edgeDistance(3000, 0)).toBeCloseTo(3000, 5);
    expect(regionName(3950, 0)).toBe('Mer de Brume');
  });

  it('groundHeight reproduit la triangulation du maillage (sommets exacts)', () => {
    const x = -2000 + 7 * GRID_SPACING;
    const z = 600 + 3 * GRID_SPACING;
    expect(groundHeight(x, z)).toBeCloseTo(heightAt(x, z), 4);
    // milieu de la diagonale = moyenne des extrémités
    const h00 = heightAt(x, z);
    const h11 = heightAt(x + GRID_SPACING, z + GRID_SPACING);
    expect(groundHeight(x + GRID_SPACING / 2, z + GRID_SPACING / 2)).toBeCloseTo((h00 + h11) / 2, 4);
  });

  it('les points d’apparition sont au sol, hors de l’eau', () => {
    for (const f of ['sylmar', 'halden'] as const) {
      const s = spawnPoint(f);
      expect(s.y).toBeGreaterThan(WATER_LEVEL);
      expect(Math.abs(s.x)).toBeLessThan(WORLD_HALF);
    }
  });
});

describe('maillage du terrain', () => {
  const N = NODE_SEGMENTS;

  it('a une topologie cohérente (indices valides, jupe complète)', () => {
    const idx = buildIndexTemplate(N);
    const count = vertexCount(N);
    expect(perimeter(N).length).toBe(4 * N);
    expect(idx.length).toBe(N * N * 6 + 4 * N * 6);
    for (const i of idx) expect(i).toBeLessThan(count);
  });

  it('les sommets pairs ne bougent pas pendant le géomorphing ; les bords se raccordent', () => {
    const size = LEAF_SIZE;
    const x0 = -1024;
    const z0 = 512;
    const m = buildNodeMesh(x0, z0, size, 300, N);
    const v = (i: number, j: number) => j * (N + 1) + i;
    // sommet pair : hauteur grossière = hauteur réelle
    expect(m.morph[v(4, 6) * 3]).toBeCloseTo(m.positions[v(4, 6) * 3 + 1], 5);
    // le nœud voisin partage exactement les hauteurs du bord commun
    const right = buildNodeMesh(x0 + size, z0, size, 300, N);
    for (let j = 0; j <= N; j++) {
      expect(right.positions[v(0, j) * 3 + 1]).toBeCloseTo(m.positions[v(N, j) * 3 + 1], 4);
      expect(right.morph[v(0, j) * 3]).toBeCloseTo(m.morph[v(N, j) * 3], 4);
    }
  });
});

describe('végétation', () => {
  it('le placement est déterministe (rendu et collisions identiques)', () => {
    const a = placeCell('colonnier', -5, 0, 1);
    const b = placeCell('colonnier', -5, 0, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(a.length % INSTANCE_STRIDE).toBe(0);
  });

  it('les Colonniers sont nombreux à l’ouest, absents de la faille', () => {
    const west = placeCell('colonnier', -5, 0, 1).length / INSTANCE_STRIDE;
    expect(west).toBeGreaterThan(5);
    const L = VEG_LAYERS.find((l) => l.id === 'colonnier')!;
    const cz = 0;
    const cx = Math.floor(2350 / L.cellSize);
    const inst = placeCell('colonnier', cx, cz, 1);
    for (let i = 0; i < inst.length; i += INSTANCE_STRIDE) {
      expect(regionName(inst[i], inst[i + 2])).not.toBe("Faille d'Ambre");
    }
  });

  it('fournit des troncs escaladables près du village', () => {
    const lm = LANDMARKS.find((l) => l.id === 'vehra-tal')!;
    const out = collidersNear(lm.x + 150, lm.z, 120, 1, []);
    expect(out.some((c) => c.climbable)).toBe(true);
  });
});

describe('textures procédurales', () => {
  it('produit des cartes de la bonne taille, normales valides', () => {
    const t = generateMaterialTexture('roche', 32);
    expect(t.albedoRough.length).toBe(32 * 32 * 4);
    expect(t.normalHeight.length).toBe(32 * 32 * 4);
    for (let i = 0; i < t.normalHeight.length; i += 4) {
      const nx = t.normalHeight[i] / 127.5 - 1;
      const ny = t.normalHeight[i + 1] / 127.5 - 1;
      const nz = t.normalHeight[i + 2] / 127.5 - 1;
      expect(Math.hypot(nx, ny, nz)).toBeGreaterThan(0.9);
      expect(nz).toBeGreaterThan(0);
    }
  });
});
