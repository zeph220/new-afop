// Gestion de la flore instanciée : cellules par couche, streaming autour de la caméra,
// deux niveaux de détail pour les Colonniers (répartition par instance).

import { BufferGeometry, Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Vector3, type Material, type MeshStandardMaterial } from 'three';
import { VEG_LAYERS, type VegLayerDef, type VegLayerId } from './VegetationPlacement.ts';
import { geometryFor } from './VegetationGeometry.ts';
import { createVegetationMaterial, setVegetationFade } from '../render/VegetationMaterial.ts';
import type { WorkerPool } from '../core/WorkerPool.ts';

interface CellData {
  count: number;
  matrices: Float32Array;
  colors: Float32Array;
}

interface Cell {
  key: string;
  layer: VegLayerDef;
  cx: number;
  cz: number;
  data: CellData | null;
  pending: boolean;
  mesh: InstancedMesh | null; // couches simples / Colonniers lointains
  nearMesh: InstancedMesh | null; // Colonniers détaillés
  lastSplit: Vector3 | null;
}

export class VegetationSystem {
  readonly group = new Group();
  private cells = new Map<string, Cell>();
  private geos = new Map<string, BufferGeometry>();
  private mats = new Map<VegLayerId, Material | Material[]>();
  private lods = new Map<VegLayerId, { nearGeo: BufferGeometry; nearMat: Material | Material[]; farGeo: BufferGeometry; farMat: Material | Material[]; nearDist: number }>();
  private pool: WorkerPool;
  private frame = 0;
  private lastCam = new Vector3(1e9, 0, 1e9);
  density = 1;
  distance = 1;
  shadows = true;

  constructor(pool: WorkerPool) {
    this.pool = pool;
    this.group.name = 'vegetation';
    const amber = new Color(1.0, 0.62, 0.22);
    const violet = new Color(0.62, 0.32, 1.0);
    this.mats.set('colonnier', createVegetationMaterial({ glowColor: amber, glowBoost: 0.8, windAmp: 1 }));
    this.mats.set('arque', createVegetationMaterial({ glowColor: violet, glowBoost: 1.2, windAmp: 1 }));
    this.mats.set('fougere', createVegetationMaterial({ glowColor: amber, glowBoost: 1.4, doubleSide: true, windAmp: 1 }));
    this.mats.set('lamelle', createVegetationMaterial({ glowColor: violet, glowBoost: 0.7, doubleSide: true, windAmp: 0.5 }));
    this.mats.set('coupe', createVegetationMaterial({ glowColor: violet, glowBoost: 1.1, doubleSide: true, windAmp: 0.3 }));
    this.mats.set('bloc', createVegetationMaterial({ glowColor: violet, glowBoost: 0, roughness: 0.9, windAmp: 0 }));
    for (const L of VEG_LAYERS) {
      this.geos.set(L.id, geometryFor(L.id, true));
      if (L.id === 'colonnier') {
        this.geos.set('colonnier-far', geometryFor('colonnier', false));
        const m = this.mats.get('colonnier')!;
        this.lods.set('colonnier', { nearGeo: this.geos.get('colonnier')!, nearMat: m, farGeo: this.geos.get('colonnier-far')!, farMat: m, nearDist: L.nearDist ?? 300 });
      }
      fadeAll(this.mats.get(L.id)!, L.viewDist * 0.8, L.viewDist);
    }
  }

  get stats(): { cells: number; instances: number } {
    let instances = 0;
    for (const c of this.cells.values()) instances += c.data?.count ?? 0;
    return { cells: this.cells.size, instances };
  }

  /** Change la qualité (densité et distance) : toutes les cellules sont régénérées. */
  configure(density: number, distance: number, shadows: boolean): void {
    if (density !== this.density) {
      for (const c of [...this.cells.values()]) this.dropCell(c);
    }
    this.density = density;
    this.distance = distance;
    this.shadows = shadows;
    // Fondu d'apparition sur les derniers 20 % de la distance d'affichage de chaque espèce.
    for (const L of VEG_LAYERS) {
      const end = L.viewDist * distance;
      fadeAll(this.mats.get(L.id)!, end * 0.8, end);
    }
    for (const c of this.cells.values()) {
      if (c.mesh) c.mesh.castShadow = shadows && c.layer.castShadow;
      if (c.nearMesh) c.nearMesh.castShadow = shadows;
    }
    this.lastCam.set(1e9, 0, 1e9);
  }

  update(cam: Vector3): void {
    this.frame++;
    const moved = this.lastCam.distanceToSquared(cam) > 64;
    if (!moved && this.frame % 30 !== 0) return;
    this.lastCam.copy(cam);
    for (const L of VEG_LAYERS) {
      const dist = L.viewDist * this.distance;
      const cs = L.cellSize;
      const cx0 = Math.floor((cam.x - dist) / cs);
      const cx1 = Math.floor((cam.x + dist) / cs);
      const cz0 = Math.floor((cam.z - dist) / cs);
      const cz1 = Math.floor((cam.z + dist) / cs);
      for (let cz = cz0; cz <= cz1; cz++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const d = rectDistance(cam, cx * cs, cz * cs, cs);
          if (d > dist) continue;
          const key = `${L.id}:${cx}:${cz}`;
          let cell = this.cells.get(key);
          if (!cell) {
            cell = { key, layer: L, cx, cz, data: null, pending: false, mesh: null, nearMesh: null, lastSplit: null };
            this.cells.set(key, cell);
          }
          if (!cell.data && !cell.pending) this.request(cell, d);
        }
      }
    }
    // Retrait des cellules trop lointaines (hystérésis de 15 %), répartition LOD des Colonniers.
    for (const c of [...this.cells.values()]) {
      const cs = c.layer.cellSize;
      const d = rectDistance(cam, c.cx * cs, c.cz * cs, cs);
      if (d > c.layer.viewDist * this.distance * 1.15) {
        this.dropCell(c);
        continue;
      }
      if (this.lods.has(c.layer.id) && c.data) this.splitColonnier(c, cam, d);
    }
  }

  private request(cell: Cell, dist: number): void {
    cell.pending = true;
    const L = cell.layer;
    this.pool
      .request<CellData>({ type: 'veg', layer: L.id, cx: cell.cx, cz: cell.cz, density: this.density }, 50 + dist * 0.5, () => this.cells.get(cell.key) === cell)
      .then((data) => {
        cell.pending = false;
        if (this.cells.get(cell.key) !== cell) return;
        cell.data = data;
        if (data.count === 0) return;
        if (this.lods.has(L.id)) {
          cell.lastSplit = null;
          this.splitColonnier(cell, this.lastCam, rectDistance(this.lastCam, cell.cx * L.cellSize, cell.cz * L.cellSize, L.cellSize));
        } else {
          cell.mesh = this.makeMesh(this.geos.get(L.id)!, this.mats.get(L.id)!, data.count, L.castShadow && this.shadows);
          (cell.mesh.instanceMatrix.array as Float32Array).set(data.matrices);
          cell.mesh.instanceColor!.array.set(data.colors);
          cell.mesh.count = data.count;
          cell.mesh.instanceMatrix.needsUpdate = true;
          cell.mesh.instanceColor!.needsUpdate = true;
          cell.mesh.computeBoundingSphere();
          this.group.add(cell.mesh);
        }
      })
      .catch(() => {
        cell.pending = false;
      });
  }

  private makeMesh(geo: BufferGeometry, mat: Material | Material[], capacity: number, castShadow: boolean): InstancedMesh {
    const m = new InstancedMesh(geo, mat, capacity);
    m.instanceMatrix.setUsage(DynamicDrawUsage);
    m.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    return m;
  }

  /** Répartit les instances d'une cellule entre modèle détaillé (proche) et simplifié (loin). */
  private splitColonnier(c: Cell, cam: Vector3, cellDist: number): void {
    const L = c.layer;
    const lod = this.lods.get(L.id)!;
    const nearDist = lod.nearDist * Math.max(0.7, this.distance);
    const data = c.data!;
    if (data.count === 0) return;
    const allFar = cellDist > nearDist + 10;
    if (c.lastSplit && allFar && !c.nearMesh) return; // rien à faire
    if (c.lastSplit && c.lastSplit.distanceToSquared(cam) < Math.min(400, nearDist * nearDist * 0.04)) return;
    c.lastSplit = (c.lastSplit ?? new Vector3()).copy(cam);
    if (!c.mesh) {
      c.mesh = this.makeMesh(lod.farGeo, lod.farMat, data.count, L.id === 'colonnier' ? false : L.castShadow && this.shadows);
      this.group.add(c.mesh);
    }
    if (!c.nearMesh && !allFar) {
      c.nearMesh = this.makeMesh(lod.nearGeo, lod.nearMat, data.count, this.shadows && (L.id === 'colonnier' || L.castShadow));
      this.group.add(c.nearMesh);
    }
    const farM = c.mesh.instanceMatrix.array as Float32Array;
    const farC = c.mesh.instanceColor!.array as Float32Array;
    let nf = 0;
    let nn = 0;
    const nearM = c.nearMesh ? (c.nearMesh.instanceMatrix.array as Float32Array) : null;
    const nearC = c.nearMesh ? (c.nearMesh.instanceColor!.array as Float32Array) : null;
    const nd2 = nearDist * nearDist;
    for (let i = 0; i < data.count; i++) {
      const x = data.matrices[i * 16 + 12];
      const z = data.matrices[i * 16 + 14];
      const d2 = (x - cam.x) * (x - cam.x) + (z - cam.z) * (z - cam.z);
      if (nearM && nearC && d2 < nd2) {
        nearM.set(data.matrices.subarray(i * 16, i * 16 + 16), nn * 16);
        nearC.set(data.colors.subarray(i * 3, i * 3 + 3), nn * 3);
        nn++;
      } else {
        farM.set(data.matrices.subarray(i * 16, i * 16 + 16), nf * 16);
        farC.set(data.colors.subarray(i * 3, i * 3 + 3), nf * 3);
        nf++;
      }
    }
    c.mesh.count = nf;
    c.mesh.instanceMatrix.needsUpdate = true;
    c.mesh.instanceColor!.needsUpdate = true;
    c.mesh.computeBoundingSphere();
    c.mesh.visible = nf > 0;
    if (c.nearMesh) {
      c.nearMesh.count = nn;
      c.nearMesh.instanceMatrix.needsUpdate = true;
      c.nearMesh.instanceColor!.needsUpdate = true;
      c.nearMesh.computeBoundingSphere();
      c.nearMesh.visible = nn > 0;
    }
  }

  private dropCell(c: Cell): void {
    for (const m of [c.mesh, c.nearMesh]) {
      if (m) {
        this.group.remove(m);
        m.dispose();
      }
    }
    this.cells.delete(c.key);
  }

  /** Remplace l'aspect d'une couche (modèle photoréaliste) ; les cellules existantes sont mises à jour. */
  override(id: VegLayerId, geo: BufferGeometry, mats: Material[], nearDist: number): void {
    const L = VEG_LAYERS.find((l) => l.id === id);
    if (!L) return;
    // Le modèle détaillé n'est utilisé que près de la caméra ; au-delà, la version procédurale légère.
    const farGeo = this.geos.get(id === 'colonnier' ? 'colonnier-far' : id)!;
    this.lods.set(id, { nearGeo: geo, nearMat: mats, farGeo, farMat: this.mats.get(id)!, nearDist });
    const end = L.viewDist * this.distance;
    fadeAll(mats, end * 0.8, end);
    for (const c of [...this.cells.values()]) if (c.layer.id === id) this.dropCell(c);
    this.lastCam.set(1e9, 0, 1e9);
  }

  get pendingCount(): number {
    let n = 0;
    for (const c of this.cells.values()) if (c.pending) n++;
    return n;
  }
}

function fadeAll(m: Material | Material[], start: number, end: number): void {
  for (const x of Array.isArray(m) ? m : [m]) setVegetationFade(x as MeshStandardMaterial, start, end);
}

function rectDistance(p: Vector3, x0: number, z0: number, size: number): number {
  const dx = Math.max(x0 - p.x, 0, p.x - (x0 + size));
  const dz = Math.max(z0 - p.z, 0, p.z - (z0 + size));
  return Math.sqrt(dx * dx + dz * dz);
}

