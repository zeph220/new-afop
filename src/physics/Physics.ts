// Monde physique Rapier (chargé à la demande : seuls les véhicules Halden en ont besoin).
// Le terrain est fourni en tuiles HeightField de 128 m générées dans les workers, uniquement
// autour des corps actifs ; les troncs et rochers proches deviennent des cylindres fixes.

import type * as RAPIER_NS from '@dimforge/rapier3d-compat';
import type { WorkerPool } from '../core/WorkerPool.ts';
import { collidersNear, type Cylinder } from '../world/VegetationPlacement.ts';
import { WORLD_HALF } from '../world/WorldGen.ts';
import { GRAVITY } from '../player/PlayerController.ts';

export type Rapier = typeof RAPIER_NS;

export const TILE_SIZE = 128;
const TILE_CELLS = 64; // 2 m de résolution, comme le maillage affiché
export const PHYSICS_STEP = 1 / 60;

interface Tile {
  collider: RAPIER_NS.Collider | null;
  pending: boolean;
  lastUsed: number;
}

export class Physics {
  readonly R: Rapier;
  readonly world: RAPIER_NS.World;
  private pool: WorkerPool;
  private tiles = new Map<string, Tile>();
  private obstacles = new Map<Cylinder, RAPIER_NS.Collider>();
  private obstacleUse = new Map<Cylinder, number>();
  private acc = 0;
  private frame = 0;
  private cyl: Cylinder[] = [];
  vegDensity = 1;

  private constructor(R: Rapier, pool: WorkerPool) {
    this.R = R;
    this.pool = pool;
    this.world = new R.World({ x: 0, y: -GRAVITY, z: 0 });
    this.world.timestep = PHYSICS_STEP;
  }

  /** Charge le module WebAssembly (intégré au paquet « compat », aucun fichier .wasm à servir). */
  static async load(pool: WorkerPool): Promise<Physics> {
    const mod = await import('@dimforge/rapier3d-compat');
    const R = (mod as unknown as { default: Rapier }).default ?? (mod as unknown as Rapier);
    await R.init();
    return new Physics(R, pool);
  }

  private tileKey(tx: number, tz: number): string {
    return `${tx}:${tz}`;
  }

  /**
   * Demande le terrain et les obstacles autour d'un point (à appeler chaque image pour chaque corps actif).
   * @returns vrai si le sol sous le point est déjà présent dans la simulation.
   */
  require(x: number, z: number, radius = 96): boolean {
    const tx0 = Math.floor((x - radius + WORLD_HALF) / TILE_SIZE);
    const tx1 = Math.floor((x + radius + WORLD_HALF) / TILE_SIZE);
    const tz0 = Math.floor((z - radius + WORLD_HALF) / TILE_SIZE);
    const tz1 = Math.floor((z + radius + WORLD_HALF) / TILE_SIZE);
    for (let tz = tz0; tz <= tz1; tz++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const key = this.tileKey(tx, tz);
        let t = this.tiles.get(key);
        if (!t) {
          t = { collider: null, pending: false, lastUsed: this.frame };
          this.tiles.set(key, t);
        }
        t.lastUsed = this.frame;
        if (!t.collider && !t.pending) this.requestTile(tx, tz, t, Math.hypot(x - (tx + 0.5) * TILE_SIZE + WORLD_HALF, z - (tz + 0.5) * TILE_SIZE + WORLD_HALF));
      }
    }
    // Obstacles (troncs, rochers, structures) dans un rayon réduit.
    collidersNear(x, z, 40, this.vegDensity, this.cyl);
    for (const c of this.cyl) {
      this.obstacleUse.set(c, this.frame);
      if (this.obstacles.has(c)) continue;
      const hh = (c.y1 - c.y0) / 2;
      const desc = this.R.ColliderDesc.cylinder(hh, c.r).setTranslation(c.x, c.y0 + hh, c.z).setFriction(0.8);
      this.obstacles.set(c, this.world.createCollider(desc));
    }
    return this.groundReady(x, z);
  }

  groundReady(x: number, z: number): boolean {
    const tx = Math.floor((x + WORLD_HALF) / TILE_SIZE);
    const tz = Math.floor((z + WORLD_HALF) / TILE_SIZE);
    return !!this.tiles.get(this.tileKey(tx, tz))?.collider;
  }

  private requestTile(tx: number, tz: number, t: Tile, dist: number): void {
    t.pending = true;
    const x0 = tx * TILE_SIZE - WORLD_HALF;
    const z0 = tz * TILE_SIZE - WORLD_HALF;
    this.pool
      .request<Float32Array>({ type: 'hf', x0, z0, size: TILE_SIZE, cells: TILE_CELLS }, -100 + dist * 0.01)
      .then((heights) => {
        t.pending = false;
        if (this.tiles.get(this.tileKey(tx, tz)) !== t) return;
        const desc = this.R.ColliderDesc.heightfield(TILE_CELLS, TILE_CELLS, heights, { x: TILE_SIZE, y: 1, z: TILE_SIZE })
          .setTranslation(x0 + TILE_SIZE / 2, 0, z0 + TILE_SIZE / 2)
          .setFriction(0.9);
        t.collider = this.world.createCollider(desc);
      })
      .catch(() => {
        t.pending = false;
      });
  }

  /** Avance la simulation à pas fixe ; `onStep` applique les commandes avant chaque pas. */
  update(dt: number, onStep: (h: number) => void, afterStep?: (h: number) => void): number {
    this.frame++;
    this.acc += dt;
    let n = 0;
    while (this.acc >= PHYSICS_STEP && n < 5) {
      onStep(PHYSICS_STEP);
      this.world.step();
      afterStep?.(PHYSICS_STEP);
      this.acc -= PHYSICS_STEP;
      n++;
    }
    if (n === 5) this.acc = 0;
    if (this.frame % 60 === 0) this.evict();
    return n;
  }

  private evict(): void {
    for (const [key, t] of this.tiles) {
      if (this.frame - t.lastUsed > 600 && !t.pending) {
        if (t.collider) this.world.removeCollider(t.collider, false);
        this.tiles.delete(key);
      }
    }
    for (const [c, col] of this.obstacles) {
      if (this.frame - (this.obstacleUse.get(c) ?? 0) > 300) {
        this.world.removeCollider(col, false);
        this.obstacles.delete(c);
        this.obstacleUse.delete(c);
      }
    }
  }

  /** Purge les obstacles (changement de densité de végétation). */
  resetObstacles(): void {
    for (const col of this.obstacles.values()) this.world.removeCollider(col, false);
    this.obstacles.clear();
    this.obstacleUse.clear();
  }

  get stats(): { tiles: number; obstacles: number } {
    let tiles = 0;
    for (const t of this.tiles.values()) if (t.collider) tiles++;
    return { tiles, obstacles: this.obstacles.size };
  }
}
