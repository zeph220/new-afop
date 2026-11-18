// Modèles procéduraux des véhicules Halden (docs/DESIGN.md §6). Le moteur physique positionne `root`.
// Palette : ocre, gris acier, graphite, ivoire, bandes orange de danger.

import {
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import type { VehicleAnim, VehicleModel, WalkerLegs } from '../types.ts';

interface Kit {
  root: Group;
  mats: Material[];
  geos: BufferGeometry[];
  ochre: MeshStandardMaterial;
  steel: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  stripe: MeshStandardMaterial;
  lamp: MeshStandardMaterial;
  beacon: MeshStandardMaterial;
  glass: MeshStandardMaterial;
}

function kit(): Kit {
  const mats: Material[] = [];
  const m = (o: ConstructorParameters<typeof MeshStandardMaterial>[0]) => {
    const x = new MeshStandardMaterial(o);
    mats.push(x);
    return x;
  };
  return {
    root: new Group(),
    mats,
    geos: [],
    ochre: m({ color: new Color('#C8862E'), roughness: 0.65 }),
    steel: m({ color: new Color('#6E757B'), roughness: 0.45, metalness: 0.55 }),
    dark: m({ color: new Color('#232427'), roughness: 0.7 }),
    stripe: m({ color: new Color('#F06A1F'), roughness: 0.6 }),
    lamp: m({ color: new Color('#EDE6D8'), emissive: new Color(1, 0.95, 0.8), emissiveIntensity: 0 }),
    beacon: m({ color: new Color('#3a1000'), emissive: new Color(1, 0.35, 0.05), emissiveIntensity: 0 }),
    glass: m({ color: new Color('#1a2a30'), roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.55 }),
  };
}

function add(k: Kit, parent: Object3D, geo: BufferGeometry, mat: Material, x = 0, y = 0, z = 0, shadow = true): Mesh {
  k.geos.push(geo);
  const mesh = new Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Feux communs : phares, gyrophare clignotant, teinte de dégâts. */
function commonUpdate(k: Kit, a: VehicleAnim): void {
  k.lamp.emissiveIntensity = a.lights ? 3 : 0;
  k.beacon.emissiveIntensity = a.power > 0.05 && Math.sin(a.time * 6) > 0.3 ? 3 : 0.2;
  const rust = Math.max(0, (a.damage - 0.3) / 0.7);
  k.ochre.color.set('#C8862E').lerp(new Color('#7A4A2A'), rust * 0.8);
}

function finish(k: Kit, seat: Object3D, half: Vector3, update: (dt: number, a: VehicleAnim) => void, legs?: WalkerLegs): VehicleModel {
  return {
    root: k.root,
    seat,
    halfExtents: half,
    legs,
    update: (dt, a) => {
      commonUpdate(k, a);
      update(dt, a);
    },
    dispose: () => {
      for (const g of k.geos) g.dispose();
      for (const m of k.mats) m.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------
export function createGyroModel(): VehicleModel {
  const k = kit();
  const r = k.root;
  const half = new Vector3(1.1, 0.9, 1.9);
  add(k, r, new BoxGeometry(2.2, 1.8, 3.8), k.ochre);
  add(k, r, new SphereGeometry(1.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), k.glass, 0, 0.2, -1.4).rotation.x = -Math.PI / 2;
  add(k, r, new BoxGeometry(2.25, 0.25, 3.85), k.stripe, 0, -0.35, 0, false);
  add(k, r, new BoxGeometry(0.4, 0.45, 4.2), k.steel, 0, 0.35, 3.9);
  add(k, r, new BoxGeometry(0.1, 1.2, 0.8), k.ochre, 0, 0.9, 5.7);
  for (const s of [-1, 1]) {
    add(k, r, new CylinderGeometry(0.08, 0.08, 4, 6), k.dark, s * 0.9, -1.25, 0).rotation.x = Math.PI / 2;
    add(k, r, new CylinderGeometry(0.06, 0.06, 0.45, 6), k.dark, s * 0.9, -1.0, -1);
    add(k, r, new CylinderGeometry(0.06, 0.06, 0.45, 6), k.dark, s * 0.9, -1.0, 1);
    add(k, r, new BoxGeometry(0.25, 0.15, 0.1), k.lamp, s * 0.6, -0.4, -1.92, false);
  }
  add(k, r, new CylinderGeometry(0.12, 0.15, 0.6, 8), k.steel, 0, 1.2, 0);
  add(k, r, new SphereGeometry(0.12, 6, 4), k.beacon, 0, 0.98, 1.5, false);
  const rotor = new Group();
  rotor.position.set(0, 1.55, 0);
  r.add(rotor);
  const blades: Mesh[] = [];
  for (const s of [0, Math.PI]) {
    const b = add(k, rotor, new BoxGeometry(4.5, 0.05, 0.32), k.dark, 0, 0, 0);
    b.geometry.translate(2.25, 0, 0);
    b.rotation.y = s;
    blades.push(b);
  }
  const blurMat = new MeshStandardMaterial({ color: '#2a2b2e', transparent: true, opacity: 0.25, side: DoubleSide, depthWrite: false });
  k.mats.push(blurMat);
  const blur = add(k, rotor, new CircleGeometry(4.5, 32), blurMat, 0, 0, 0, false);
  blur.rotation.x = -Math.PI / 2;
  const tail = new Group();
  tail.position.set(0.12, 0.9, 5.7);
  r.add(tail);
  add(k, tail, new BoxGeometry(0.04, 1.3, 0.16), k.dark);
  const seat = new Object3D();
  seat.position.set(0, -0.8, -0.5);
  r.add(seat);
  let ang = 0;
  return finish(k, seat, half, (dt, a) => {
    ang += dt * a.power * 40;
    rotor.rotation.y = ang;
    tail.rotation.x = ang * 1.6;
    const fast = a.power > 0.6;
    for (const b of blades) b.visible = !fast;
    blur.visible = a.power > 0.3;
    blurMat.opacity = 0.12 + a.power * 0.2;
  });
}

// ---------------------------------------------------------------------------------------------
const UP = new Vector3(0, 1, 0);

/** Oriente un cylindre unitaire (hauteur 1, axe Y) entre deux points. */
function between(m: Mesh, a: Vector3, b: Vector3): void {
  const d = new Vector3().subVectors(b, a);
  const len = d.length() || 1e-3;
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.copy(new Quaternion().setFromUnitVectors(UP, d.multiplyScalar(1 / len)));
  m.scale.set(1, len, 1);
}

export function createWalkerModel(): VehicleModel {
  const k = kit();
  const r = k.root;
  const half = new Vector3(2.25, 0.4, 3.5);
  add(k, r, new BoxGeometry(4.5, 0.8, 7), k.ochre);
  add(k, r, new BoxGeometry(4.55, 0.2, 7.05), k.stripe, 0, 0.3, 0, false);
  for (let i = 0; i < 3; i++) add(k, r, new BoxGeometry(1.4, 1, 1.4), i === 1 ? k.steel : k.ochre, -1 + i * 1, 0.9, 1.8);
  add(k, r, new SphereGeometry(1.1, 14, 10), k.glass, 0, -0.9, -2.6);
  add(k, r, new CylinderGeometry(1.15, 1.15, 0.2, 14), k.steel, 0, -0.45, -2.6);
  for (const s of [-1, 1]) add(k, r, new BoxGeometry(0.3, 0.2, 0.1), k.lamp, s * 0.7, -1.1, -3.65, false);
  add(k, r, new SphereGeometry(0.15, 6, 4), k.beacon, 1.9, 0.55, 3.2, false);
  const legs: WalkerLegs = {
    hips: [new Vector3(-2.3, -0.3, -2.8), new Vector3(2.3, -0.3, -2.8), new Vector3(-2.3, -0.3, 2.8), new Vector3(2.3, -0.3, 2.8)],
    upper: 2.6,
    lower: 2.8,
  };
  const unit = new CylinderGeometry(0.22, 0.22, 1, 8);
  const unit2 = new CylinderGeometry(0.16, 0.2, 1, 8);
  k.geos.push(unit, unit2);
  const parts = legs.hips.map((h) => {
    add(k, r, new SphereGeometry(0.4, 8, 6), k.steel, h.x, h.y, h.z);
    const up = new Mesh(unit, k.steel);
    const lo = new Mesh(unit2, k.ochre);
    const knee = new Mesh(new SphereGeometry(0.3, 8, 6), k.dark);
    const foot = new Mesh(new CylinderGeometry(0.55, 0.65, 0.18, 12), k.dark);
    k.geos.push(knee.geometry, foot.geometry);
    for (const m of [up, lo, knee, foot]) {
      m.castShadow = true;
      r.add(m);
    }
    return { hip: h, up, lo, knee, foot };
  });
  const rest = legs.hips.map((h) => new Vector3(h.x * 1.35, h.y - 4.2, h.z * 1.1));
  const seat = new Object3D();
  seat.position.set(0, -1.5, -2.6);
  r.add(seat);
  const dir = new Vector3();
  const bend = new Vector3();
  const knee = new Vector3();
  const tgt = new Vector3();
  return finish(
    k,
    seat,
    half,
    (_dt, a) => {
      parts.forEach((p, i) => {
        tgt.copy(a.feet?.[i] ?? rest[i]);
        dir.subVectors(tgt, p.hip);
        let d = dir.length();
        const max = legs.upper + legs.lower - 0.02;
        if (d > max) {
          dir.multiplyScalar(max / d);
          d = max;
          tgt.copy(p.hip).add(dir);
        }
        dir.normalize();
        // Genou plié vers l'extérieur et le haut (silhouette de crabe).
        bend.set(Math.sign(p.hip.x), 1, 0).normalize();
        bend.addScaledVector(dir, -bend.dot(dir)).normalize();
        const aa = (legs.upper * legs.upper - legs.lower * legs.lower + d * d) / (2 * d);
        const hh = Math.sqrt(Math.max(0, legs.upper * legs.upper - aa * aa));
        knee.copy(p.hip).addScaledVector(dir, aa).addScaledVector(bend, hh);
        between(p.up, p.hip, knee);
        between(p.lo, knee, tgt);
        p.knee.position.copy(knee);
        p.foot.position.copy(tgt);
      });
    },
    legs,
  );
}

// ---------------------------------------------------------------------------------------------
export function createCrawlerModel(): VehicleModel {
  const k = kit();
  const r = k.root;
  const half = new Vector3(2.5, 1.2, 6);
  add(k, r, new BoxGeometry(3.8, 1.6, 11), k.ochre, 0, 0.3, 0);
  add(k, r, new BoxGeometry(3.85, 0.25, 11.05), k.stripe, 0, -0.35, 0, false);
  add(k, r, new BoxGeometry(2.6, 1.6, 2.6), k.steel, 0, 1.9, -3);
  add(k, r, new BoxGeometry(2.4, 0.8, 0.1), k.glass, 0, 2.1, -4.32, false);
  add(k, r, new SphereGeometry(0.2, 6, 4), k.beacon, 0, 2.8, -2.2, false);
  for (const s of [-1, 1]) add(k, r, new BoxGeometry(0.4, 0.25, 0.1), k.lamp, s * 1.3, 0.6, -5.52, false);
  const wheels: Mesh[][] = [[], []];
  const wGeo = new CylinderGeometry(0.55, 0.55, 0.8, 10);
  k.geos.push(wGeo);
  [-1, 1].forEach((s, si) => {
    add(k, r, new BoxGeometry(0.95, 1.5, 12), k.dark, s * 2.3, -0.5, 0);
    for (let i = 0; i < 6; i++) {
      const w = new Mesh(wGeo, k.steel);
      w.rotation.z = Math.PI / 2;
      w.position.set(s * 2.85, -0.75, -4.8 + i * 1.92);
      r.add(w);
      wheels[si].push(w);
    }
  });
  const drill = new Group();
  drill.position.set(0, 0.2, -6.2);
  r.add(drill);
  const cone = add(k, drill, new ConeGeometry(1.1, 3.5, 12), k.steel, 0, 0, -1.6);
  cone.rotation.x = -Math.PI / 2;
  const spiral = add(k, drill, new TorusGeometry(0.8, 0.12, 6, 16), k.dark, 0, 0, -1);
  void spiral;
  const seat = new Object3D();
  seat.position.set(0, 1.1, -3);
  r.add(seat);
  let rl = 0;
  let rr = 0;
  let dr = 0;
  return finish(k, seat, half, (dt, a) => {
    rl += (a.trackLeft * dt) / 0.55;
    rr += (a.trackRight * dt) / 0.55;
    for (const w of wheels[0]) w.rotation.x = -rl;
    for (const w of wheels[1]) w.rotation.x = -rr;
    dr += dt * a.drill * 12;
    drill.rotation.z = dr;
  });
}

// ---------------------------------------------------------------------------------------------
export function createHydroModel(): VehicleModel {
  const k = kit();
  const r = k.root;
  const half = new Vector3(1.4, 0.5, 3);
  add(k, r, new BoxGeometry(2.8, 1, 6), k.ochre);
  add(k, r, new BoxGeometry(2.6, 0.5, 1.6), k.ochre, 0, -0.05, -3.4).rotation.x = 0.35;
  add(k, r, new BoxGeometry(2.85, 0.2, 6.05), k.stripe, 0, 0.3, 0, false);
  for (let i = 0; i < 3; i++) add(k, r, new BoxGeometry(0.7, 0.5, 0.6), k.dark, -0.8 + i * 0.8, 0.75, -0.5 + (i % 2) * 0.9);
  for (const s of [-1, 1]) add(k, r, new BoxGeometry(0.3, 0.15, 0.1), k.lamp, s * 0.8, 0.2, -3.05, false);
  add(k, r, new SphereGeometry(0.12, 6, 4), k.beacon, 0, 2.4, 2.4, false);
  const cage = add(k, r, new TorusGeometry(1.25, 0.06, 6, 24), k.steel, 0, 1.6, 2.4);
  void cage;
  add(k, r, new CylinderGeometry(0.08, 0.08, 1.3, 6), k.steel, 0, 0.95, 2.4);
  const prop = new Group();
  prop.position.set(0, 1.6, 2.3);
  r.add(prop);
  for (let i = 0; i < 3; i++) {
    const b = add(k, prop, new BoxGeometry(0.18, 1.1, 0.05), k.dark);
    b.geometry.translate(0, 0.55, 0);
    b.rotation.z = (i / 3) * Math.PI * 2;
  }
  const rudders: Group[] = [];
  for (const s of [-0.5, 0.5]) {
    const g = new Group();
    g.position.set(s, 1.6, 2.85);
    r.add(g);
    add(k, g, new BoxGeometry(0.05, 1.4, 0.6), k.ochre, 0, 0, 0.3);
    rudders.push(g);
  }
  const seat = new Object3D();
  seat.position.set(0, 0.5, 0.4);
  r.add(seat);
  let ang = 0;
  return finish(k, seat, half, (dt, a) => {
    ang += dt * a.power * 35;
    prop.rotation.z = ang;
    for (const g of rudders) g.rotation.y = -a.steer * 0.5;
  });
}
