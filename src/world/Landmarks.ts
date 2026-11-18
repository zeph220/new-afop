// Structures des repères de départ : village sylmar Vehra-Tal et station Halden Forage Kessel.

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANDMARKS, groundHeight } from './WorldGen.ts';
import { instanceColliders, staticColliders, COLONNIER } from './VegetationPlacement.ts';
import { colonnierGeometry } from './VegetationGeometry.ts';
import { createVegetationMaterial } from '../render/VegetationMaterial.ts';

const std = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => new MeshStandardMaterial(o);

export class Landmarks {
  readonly group = new Group();
  private blinkers: MeshStandardMaterial[] = [];
  private time = 0;

  constructor() {
    this.group.name = 'landmarks';
    this.buildVehraTal();
    this.buildKessel();
    this.mergeStatic();
  }

  /** Fusionne les maillages statiques par matériau : quelques appels de rendu au lieu de centaines. */
  private mergeStatic(): void {
    const byMat = new Map<Material, { geos: BufferGeometry[]; shadow: boolean }>();
    for (const child of [...this.group.children]) {
      const m = child as Mesh;
      if (!m.isMesh) continue;
      m.updateMatrixWorld(true);
      let g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      const mat = m.material as Material;
      let e = byMat.get(mat);
      if (!e) byMat.set(mat, (e = { geos: [], shadow: false }));
      e.geos.push(g);
      e.shadow ||= m.castShadow;
      this.group.remove(m);
    }
    for (const [mat, e] of byMat) {
      const merged = mergeGeometries(e.geos, false);
      for (const g of e.geos) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new Mesh(merged, mat);
      mesh.castShadow = e.shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }

  private add(mesh: Mesh, x: number, y: number, z: number, shadow = true): Mesh {
    mesh.position.set(x, y, z);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  private buildVehraTal(): void {
    const lm = LANDMARKS.find((l) => l.id === 'vehra-tal')!;
    const cx = lm.x;
    const cz = lm.z;
    const weave = std({ color: 0xa47b48, roughness: 0.95 });
    const weaveDark = std({ color: 0x7a5634, roughness: 0.95 });
    const lantern = std({ color: 0x3a2410, emissive: new Color(1.0, 0.62, 0.22), emissiveIntensity: 1.6 });
    // Colonniers géants qui ceinturent la clairière.
    const treeGeo = colonnierGeometry(true);
    const treeMat = createVegetationMaterial({ glowColor: new Color(1.0, 0.62, 0.22), glowBoost: 1.0 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const r = 58 + (i % 2) * 10;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const s = 1.35 + (i % 3) * 0.12;
      const y = groundHeight(x, z);
      const tree = new Mesh(treeGeo, treeMat);
      tree.scale.setScalar(s);
      tree.rotation.y = a * 2.1;
      this.add(tree, x, y, z);
      instanceColliders('colonnier', x, y, z, s, staticColliders);
      // Lanternes accrochées sous la première ombrelle
      const dy = y + COLONNIER.height * s * COLONNIER.discs[0].at - 2.5;
      for (let k = 0; k < 4; k++) {
        const b = (k / 4) * Math.PI * 2 + a;
        const l = new Mesh(new SphereGeometry(0.35, 8, 6), lantern);
        this.add(l, x + Math.cos(b) * 5, dy - (k % 2) * 1.2, z + Math.sin(b) * 5, false);
      }
    }
    // Huttes tressées en dôme
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const x = cx + Math.cos(a) * 26;
      const z = cz + Math.sin(a) * 26;
      const y = groundHeight(x, z);
      const dome = new Mesh(new SphereGeometry(3.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), i % 2 ? weave : weaveDark);
      dome.scale.y = 0.85;
      this.add(dome, x, y - 0.1, z);
      const ring = new Mesh(new TorusGeometry(3.6, 0.12, 5, 18), weaveDark);
      ring.rotation.x = Math.PI / 2;
      this.add(ring, x, y + 0.3, z, false);
      staticColliders.push({ x, z, r: 3.3, y0: y - 1, y1: y + 2.6, climbable: false, platform: true });
    }
    // Foyer central
    const y0 = groundHeight(cx, cz);
    const stones = std({ color: 0x55585e, roughness: 0.9 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.add(new Mesh(new SphereGeometry(0.45, 6, 5), stones), cx + Math.cos(a) * 1.6, y0 + 0.15, cz + Math.sin(a) * 1.6);
    }
    const embers = std({ color: 0x220800, emissive: new Color(1.0, 0.45, 0.12), emissiveIntensity: 3 });
    this.add(new Mesh(new CylinderGeometry(1.1, 1.3, 0.3, 10), embers), cx, y0 + 0.1, cz, false);
    this.blinkers.push(embers);
  }

  private buildKessel(): void {
    const lm = LANDMARKS.find((l) => l.id === 'kessel')!;
    const cx = lm.x;
    const cz = lm.z;
    const ochre = std({ color: 0xa8772e, roughness: 0.7 });
    const steel = std({ color: 0x6b7178, roughness: 0.45, metalness: 0.6 });
    const darkSteel = std({ color: 0x3a3e44, roughness: 0.6, metalness: 0.5 });
    const concrete = std({ color: 0x77736c, roughness: 0.95 });
    const yellow = std({ color: 0xd8b02a, roughness: 0.6 });
    const ground = (x: number, z: number) => groundHeight(x, z);

    // Aire de fret
    const padY = ground(cx, cz);
    this.add(new Mesh(new CylinderGeometry(14, 14.5, 0.6, 32), concrete), cx, padY + 0.05, cz);
    const ringMesh = new Mesh(new TorusGeometry(10, 0.25, 4, 40), yellow);
    ringMesh.rotation.x = Math.PI / 2;
    this.add(ringMesh, cx, padY + 0.37, cz, false);
    staticColliders.push({ x: cx, z: cz, r: 14, y0: padY - 2, y1: padY + 0.35, climbable: false, platform: true });

    // Tour de forage en treillis
    const tx = cx + 40;
    const tz = cz - 10;
    const ty = ground(tx, tz);
    const H = 36;
    for (const [ox, oz] of [
      [-3, -3],
      [3, -3],
      [-3, 3],
      [3, 3],
    ]) {
      const leg = new Mesh(new CylinderGeometry(0.25, 0.35, H, 6), ochre);
      leg.rotation.z = -ox * 0.025;
      leg.rotation.x = oz * 0.025;
      this.add(leg, tx + ox * 0.8, ty + H / 2, tz + oz * 0.8);
      staticColliders.push({ x: tx + ox, z: tz + oz, r: 0.5, y0: ty - 1, y1: ty + H, climbable: false, platform: false });
    }
    for (let k = 1; k < 7; k++) {
      const y = ty + (k / 7) * H;
      const w = 6 - (k / 7) * 1.6;
      for (const rot of [0, Math.PI / 2]) {
        for (const s of [-1, 1]) {
          const beam = new Mesh(new BoxGeometry(w, 0.25, 0.25), steel);
          beam.rotation.y = rot;
          const off = (w / 2) * s;
          this.add(beam, tx + (rot ? off : 0), y, tz + (rot ? 0 : off), false);
        }
      }
    }
    const drill = new Mesh(new CylinderGeometry(0.6, 0.15, 10, 10), darkSteel);
    this.add(drill, tx, ty + 4, tz);
    const head = new Mesh(new BoxGeometry(5, 3, 5), ochre);
    this.add(head, tx, ty + H + 1.5, tz);
    const warn = std({ color: 0x300000, emissive: new Color(1.0, 0.25, 0.05), emissiveIntensity: 4 });
    this.blinkers.push(warn);
    for (const s of [-1, 1]) this.add(new Mesh(new SphereGeometry(0.4, 8, 6), warn), tx + 2.6 * s, ty + H + 3.4, tz, false);

    // Conteneurs modulaires numérotés
    const rng = (i: number) => Math.abs(Math.sin(i * 12.9898) * 43758.5453) % 1;
    for (let i = 0; i < 10; i++) {
      const a = 0.4 + i * 0.55;
      const r = 32 + rng(i) * 40;
      const x = cx + Math.cos(a) * r - 15;
      const z = cz + Math.sin(a) * r;
      const y = ground(x, z);
      const box = new Mesh(new BoxGeometry(6, 2.6, 2.5), i % 3 === 0 ? steel : ochre);
      box.rotation.y = rng(i + 5) * Math.PI;
      this.add(box, x, y + 1.3, z);
      const stripe = new Mesh(new BoxGeometry(6.05, 0.3, 2.55), darkSteel);
      stripe.rotation.y = box.rotation.y;
      this.add(stripe, x, y + 2.1, z, false);
      staticColliders.push({ x, z, r: 2.4, y0: y - 1, y1: y + 2.6, climbable: false, platform: true });
    }

    // Mâts d'éclairage
    const flood = std({ color: 0x222222, emissive: new Color(1.0, 0.92, 0.75), emissiveIntensity: 3.5 });
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.78;
      const x = cx + Math.cos(a) * 60;
      const z = cz + Math.sin(a) * 60;
      const y = ground(x, z);
      this.add(new Mesh(new CylinderGeometry(0.18, 0.25, 14, 6), steel), x, y + 7, z);
      const lamp = new Mesh(new BoxGeometry(1.4, 0.6, 0.5), flood);
      lamp.lookAt(cx, y + 14, cz);
      this.add(lamp, x, y + 14, z, false);
      staticColliders.push({ x, z, r: 0.35, y0: y - 1, y1: y + 14, climbable: false, platform: false });
    }

    // Pipeline vers la faille
    const pipe = std({ color: 0x8a6a3a, roughness: 0.6, metalness: 0.3 });
    for (let i = 0; i < 14; i++) {
      const x = tx + 6 + i * 6;
      const z = tz + Math.sin(i * 0.4) * 2;
      const y = Math.max(ground(x, z), ground(x + 6, z)) + 1.2;
      const seg = new Mesh(new CylinderGeometry(0.5, 0.5, 6.1, 10), pipe);
      seg.rotation.z = Math.PI / 2;
      this.add(seg, x + 3, y, z);
      const sup = new Mesh(new BoxGeometry(0.3, 1.4, 0.8), darkSteel);
      this.add(sup, x, y - 0.6, z, false);
    }
  }

  update(dt: number, night: number): void {
    this.time += dt;
    const blink = Math.sin(this.time * 3) > 0 ? 1 : 0.15;
    if (this.blinkers[1]) this.blinkers[1].emissiveIntensity = 4 * blink;
    if (this.blinkers[0]) this.blinkers[0].emissiveIntensity = 2.6 + Math.sin(this.time * 7) * 0.4 + Math.sin(this.time * 13) * 0.3;
    void night;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as Material).dispose();
      }
    });
  }
}
