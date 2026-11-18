// Terrain par quadtree LOD (type CDLOD) : sélection des nœuds selon la distance 3D à la caméra,
// génération dans les workers, et échange ATOMIQUE de l'ensemble affiché (jamais de trou).

import { BufferAttribute, BufferGeometry, Box3, Group, Mesh, Sphere, Vector3, type Material } from 'three';
import { buildIndexTemplate, estimateNodeYRange, LEAF_SIZE, MAX_LOD, nodeOrigin, nodeSize, type NodeMeshData } from './TerrainMesh.ts';
import type { WorkerPool } from '../core/WorkerPool.ts';

interface TerrainNode {
  key: string;
  lod: number;
  x0: number;
  z0: number;
  size: number;
  yMin: number;
  yMax: number;
  mesh: Mesh | null;
  pending: boolean;
  lastUsed: number;
}

export class TerrainSystem {
  readonly group = new Group();
  private nodes = new Map<string, TerrainNode>();
  private shown = new Set<string>();
  private desiredKeys: string[] = [];
  private desiredSig = '';
  private shownSig = '';
  private index = new BufferAttribute(buildIndexTemplate(), 1);
  private ranges: number[] = [];
  private frame = 0;
  private generatedThisSession = 0;
  private retiring: Mesh[] = [];
  rangeFactor = 2.4;
  private pool: WorkerPool;
  private material: Material;

  constructor(pool: WorkerPool, material: Material) {
    this.pool = pool;
    this.material = material;
    this.group.name = 'terrain';
    this.setRangeFactor(this.rangeFactor);
  }

  setRangeFactor(f: number): void {
    this.rangeFactor = f;
    this.ranges = [];
    for (let k = 0; k <= MAX_LOD; k++) this.ranges.push(LEAF_SIZE * (1 << k) * f);
    // Le morphing dépend des plages : les nœuds sont régénérés, mais ceux affichés restent
    // visibles jusqu'à ce que le nouvel ensemble soit prêt (aucun trou).
    for (const n of this.nodes.values()) {
      if (n.mesh && this.shown.has(n.key)) this.retiring.push(n.mesh);
      else this.disposeNode(n);
    }
    this.nodes.clear();
    this.shown.clear();
    this.shownSig = '';
    this.desiredSig = '';
  }

  get stats(): { shown: number; cached: number; generated: number } {
    return { shown: this.shown.size, cached: this.nodes.size, generated: this.generatedThisSession };
  }

  /** Vrai quand l'ensemble affiché correspond à l'ensemble voulu. */
  get settled(): boolean {
    return this.shownSig !== '' && this.shownSig === this.desiredSig;
  }

  private getNode(lod: number, ix: number, iz: number): TerrainNode {
    const key = `${lod}:${ix}:${iz}`;
    let n = this.nodes.get(key);
    if (!n) {
      const [x0, z0] = nodeOrigin(lod, ix, iz);
      const size = nodeSize(lod);
      const [yMin, yMax] = estimateNodeYRange(x0, z0, size);
      n = { key, lod, x0, z0, size, yMin, yMax, mesh: null, pending: false, lastUsed: 0 };
      this.nodes.set(key, n);
    }
    return n;
  }

  private boxDistance(n: TerrainNode, c: Vector3): number {
    const dx = Math.max(n.x0 - c.x, 0, c.x - (n.x0 + n.size));
    const dy = Math.max(n.yMin - c.y, 0, c.y - n.yMax);
    const dz = Math.max(n.z0 - c.z, 0, c.z - (n.z0 + n.size));
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private select(lod: number, ix: number, iz: number, cam: Vector3, out: TerrainNode[]): void {
    const n = this.getNode(lod, ix, iz);
    if (lod > 0 && this.boxDistance(n, cam) < this.ranges[lod - 1]) {
      for (let c = 0; c < 4; c++) this.select(lod - 1, ix * 2 + (c & 1), iz * 2 + (c >> 1), cam, out);
    } else out.push(n);
  }

  update(cam: Vector3): void {
    this.frame++;
    const desired: TerrainNode[] = [];
    this.select(MAX_LOD, 0, 0, cam, desired);
    const keys = desired.map((n) => n.key);
    const sig = keys.join('|');
    if (sig !== this.desiredSig) {
      this.desiredSig = sig;
      this.desiredKeys = keys;
      for (const n of desired) {
        n.lastUsed = this.frame;
        if (!n.mesh && !n.pending) this.requestNode(n, cam);
      }
    }
    if (this.shownSig !== this.desiredSig && this.desiredKeys.every((k) => this.nodes.get(k)?.mesh)) this.swap();
    if (this.frame % 120 === 0) this.evict();
  }

  private requestNode(n: TerrainNode, cam: Vector3): void {
    n.pending = true;
    const morphEnd = n.lod >= MAX_LOD ? 1e9 : this.ranges[n.lod] * 0.95;
    const dist = this.boxDistance(n, cam);
    const want = () => this.desiredKeys.includes(n.key) || this.shown.has(n.key);
    this.pool
      .request<NodeMeshData>({ type: 'node', x0: n.x0, z0: n.z0, size: n.size, morphEnd }, dist, want)
      .then((data) => {
        n.pending = false;
        if (!this.nodes.has(n.key)) return; // purgé entre-temps
        n.mesh = this.buildMesh(n, data);
        this.generatedThisSession++;
      })
      .catch(() => {
        n.pending = false;
      });
  }

  private buildMesh(n: TerrainNode, d: NodeMeshData): Mesh {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(d.positions, 3));
    g.setAttribute('normal', new BufferAttribute(d.normals, 3));
    g.setAttribute('aMorph', new BufferAttribute(d.morph, 3));
    g.setIndex(this.index);
    const half = n.size / 2;
    g.boundingBox = new Box3(new Vector3(-half, d.minY - 2, -half), new Vector3(half, d.maxY + 2, half));
    g.boundingSphere = g.boundingBox.getBoundingSphere(new Sphere());
    const m = new Mesh(g, this.material);
    m.position.set(n.x0 + half, 0, n.z0 + half);
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.receiveShadow = true;
    m.castShadow = n.lod === 0;
    m.name = 'terrain-' + n.key;
    return m;
  }

  private swap(): void {
    const next = new Set(this.desiredKeys);
    for (const k of this.shown) {
      if (!next.has(k)) {
        const n = this.nodes.get(k);
        if (n?.mesh) this.group.remove(n.mesh);
      }
    }
    for (const k of next) {
      if (!this.shown.has(k)) {
        const n = this.nodes.get(k)!;
        this.group.add(n.mesh!);
      }
    }
    this.shown = next;
    this.shownSig = this.desiredSig;
    for (const m of this.retiring) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.retiring = [];
  }

  private evict(): void {
    const limit = 700;
    if (this.nodes.size <= limit) return;
    const candidates = [...this.nodes.values()].filter((n) => !this.shown.has(n.key) && !n.pending && !this.desiredKeys.includes(n.key));
    candidates.sort((a, b) => a.lastUsed - b.lastUsed);
    const remove = this.nodes.size - limit;
    for (let i = 0; i < remove && i < candidates.length; i++) {
      this.disposeNode(candidates[i]);
      this.nodes.delete(candidates[i].key);
    }
  }

  private disposeNode(n: TerrainNode): void {
    if (n.mesh) {
      this.group.remove(n.mesh);
      n.mesh.geometry.dispose();
      n.mesh = null;
    }
  }

  /** Préchauffe : génère l'ensemble voulu pour une position donnée et attend qu'il soit affiché. */
  async warmup(cam: Vector3, onProgress?: (p: number) => void): Promise<void> {
    this.update(cam);
    const total = Math.max(1, this.desiredKeys.length);
    while (!this.settled) {
      await new Promise((r) => setTimeout(r, 30));
      this.update(cam);
      const done = this.desiredKeys.filter((k) => this.nodes.get(k)?.mesh).length;
      onProgress?.(done / total);
    }
  }
}
