// Modèles procéduraux des trois montures de Veyra : Skarel, Tormaq, Vexil (designs originaux, docs/DESIGN.md §5.2–5.4).
//
// Conventions (voir src/entities/types.ts) : origine de `root` au sol sous le centre du corps, regard vers -Z, Y vers le
// haut, échelle réelle en mètres. Le modèle n'écrit JAMAIS dans root.position / root.rotation : le contrôleur place et
// oriente la racine ; le modèle n'anime que ses sous-groupes (corps, membres, ailes, cou…).
//
// Convention d'angle des membres : un segment pend vers -Y depuis son pivot ; rotation.x = φ envoie son extrémité en
// (y, z) = L·(-cos φ, -sin φ). φ > 0 avance donc le bout du segment vers l'avant (-Z), et lève le museau d'une tête.

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Shape,
  ShapeGeometry,
  Sphere,
  SphereGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CreatureModel, CreatureAnim } from '../types.ts';
import { injectGlobals } from '../../render/Globals.ts';
import { createVegetationMaterial } from '../../render/VegetationMaterial.ts';
import { lamelleGeometry } from '../../world/VegetationGeometry.ts';
import { mulberry32 } from '../../world/noise.ts';

// ---------------------------------------------------------------------------------------------
// Outils communs

const TAU = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);
const Q0 = new Quaternion();

const C = (hex: string): Color => new Color(hex);
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const fract = (x: number): number => x - Math.floor(x);
const smooth01 = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
/** Facteur de lissage exponentiel indépendant de la cadence : 1 - e^(-k·dt). */
const ease = (k: number, dt: number): number => 1 - Math.exp(-k * Math.max(0, dt));
/** Pseudo-bruit lisse et déterministe (marbrures des peaux), ≈ [0, 1]. */
const mottle = (x: number, y: number, z: number): number =>
  0.5 + 0.25 * Math.sin(x * 3.1 + Math.sin(z * 2.3 + y)) + 0.25 * Math.sin(z * 2.7 + y * 1.9 - x * 0.7);

type StdParams = ConstructorParameters<typeof MeshStandardMaterial>[0];
const std = (o: StdParams): MeshStandardMaterial => new MeshStandardMaterial(o);

/** État de repos, utilisé pour poser chaque modèle dès sa construction. */
const REST_ANIM: CreatureAnim = {
  time: 0,
  speed: 0,
  gait: 0,
  grounded: true,
  crouch: 0,
  night: 0,
  call: 0,
  flying: 0,
  flap: 0,
  bank: 0,
  dive: 0,
  boost: 0,
};

/** Registre des ressources GPU d'un modèle, libérées en bloc par dispose(). */
class Kit {
  private readonly geos = new Set<BufferGeometry>();
  private readonly mats = new Set<Material>();
  private readonly inst: InstancedMesh[] = [];

  geo<T extends BufferGeometry>(g: T): T {
    this.geos.add(g);
    return g;
  }

  mat<T extends Material>(m: T): T {
    this.mats.add(m);
    return m;
  }

  mesh(g: BufferGeometry, m: Material, parent: Object3D, shadow = true): Mesh {
    this.geos.add(g);
    this.mats.add(m);
    const me = new Mesh(g, m);
    me.castShadow = shadow;
    me.receiveShadow = shadow;
    parent.add(me);
    return me;
  }

  instanced(g: BufferGeometry, m: Material, count: number, parent: Object3D, shadow = true): InstancedMesh {
    this.geos.add(g);
    this.mats.add(m);
    const im = new InstancedMesh(g, m, count);
    im.castShadow = shadow;
    im.receiveShadow = false;
    parent.add(im);
    this.inst.push(im);
    return im;
  }

  dispose(): void {
    for (const im of this.inst) im.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.inst.length = 0;
    this.geos.clear();
    this.mats.clear();
  }
}

type Painter = (p: Vector3, n: Vector3, out: Color) => void;
const _p = new Vector3();
const _n = new Vector3();
const _c = new Color();

/** Ajoute des couleurs de sommets (constante ou calculée depuis position/normale). */
function paint<T extends BufferGeometry>(g: T, f: Painter | Color): T {
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    if (f instanceof Color) _c.copy(f);
    else {
      _p.fromBufferAttribute(pos, i);
      _n.fromBufferAttribute(nor, i);
      f(_p, _n, _c);
    }
    col[i * 3] = _c.r;
    col[i * 3 + 1] = _c.g;
    col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  return g;
}

/** Fusionne des géométries (une seule draw call) et libère les morceaux. */
function mergeAll(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!g) throw new Error('créatures : fusion de géométries impossible');
  g.computeBoundingSphere();
  return g;
}

/** Fusionne des copies transformées d'une même géométrie. */
function mergeCopies(base: BufferGeometry, mats: Matrix4[]): BufferGeometry {
  return mergeAll(mats.map((m) => base.clone().applyMatrix4(m)));
}

/** Segment de membre unitaire : du pivot (y = 0, rayon 1) vers -Y (y = -1, rayon 0,72). Mis à l'échelle (r, L, r). */
function limbGeo(radial: number): CylinderGeometry {
  const g = new CylinderGeometry(1, 0.72, 1, radial, 1, true);
  g.translate(0, -0.5, 0);
  return g;
}

/** Ajoute un segment de membre sous `pivot` et renvoie le pivot de l'articulation suivante (au bout du segment). */
function addSegment(kit: Kit, g: BufferGeometry, m: Material, pivot: Group, len: number, r: number): Group {
  const seg = kit.mesh(g, m, pivot);
  seg.scale.set(r, len, r);
  const next = new Group();
  next.position.y = -len;
  pivot.add(next);
  return next;
}

interface Ik {
  a: number; // angle du segment haut (repère du parent)
  b: number; // angle du segment bas, relatif au segment haut
}

/**
 * Cinématique inverse plane (plan YZ) à deux segments pendant vers -Y (convention d'angle en tête de fichier).
 * (ty, tz) : cible relative au pivot. bend = +1 : articulation intermédiaire vers l'avant, -1 : vers l'arrière.
 */
function ik2(L1: number, L2: number, ty: number, tz: number, bend: number, out: Ik): Ik {
  const dist = Math.hypot(ty, tz);
  const d = clamp(dist, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const s = d / Math.max(dist, 1e-6); // cible ramenée à une distance atteignable
  const y = ty * s;
  const z = tz * s;
  const phiT = Math.atan2(-z, -y);
  const g = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
  const a = phiT + bend * g;
  const ky = -L1 * Math.cos(a);
  const kz = -L1 * Math.sin(a);
  const phi2 = Math.atan2(-(z - kz), -(y - ky));
  const b = phi2 - a;
  out.a = a;
  out.b = Math.atan2(Math.sin(b), Math.cos(b));
  return out;
}

interface Cycle {
  z: number; // -1 = pied en avant … +1 = pied en arrière
  lift: number; // 0 au sol … 1 au plus haut de la foulée
}

/** Trajectoire d'un pied sur un cycle u ∈ [0, 1) : appui (le pied recule) puis retour aérien. */
function footCycle(u: number, duty: number, out: Cycle): Cycle {
  if (u < duty) {
    out.z = -1 + (2 * u) / duty;
    out.lift = 0;
  } else {
    const s = (u - duty) / (1 - duty);
    out.z = 1 - 2 * smooth01(s);
    out.lift = Math.sin(Math.PI * s);
  }
  return out;
}

const _bx = new Vector3();
const _by = new Vector3();
const _bz = new Vector3();

/** Matrice d'une lamelle : base en `p`, longueur le long de `dir`, face tournée vers `face`, échelle (larg., long., pli). */
function bladeMatrix(out: Matrix4, p: Vector3, dir: Vector3, face: Vector3, w: number, len: number, depth: number): Matrix4 {
  _by.copy(dir).normalize();
  _bz.copy(face).addScaledVector(_by, -face.dot(_by));
  if (_bz.lengthSq() < 1e-6) _bz.crossVectors(X_AXIS, _by);
  _bz.normalize();
  _bx.crossVectors(_by, _bz);
  _bx.multiplyScalar(w);
  _by.multiplyScalar(len);
  _bz.multiplyScalar(depth);
  out.makeBasis(_bx, _by, _bz);
  out.setPosition(p);
  return out;
}

// =============================================================================================
// Skarel — planeur des Tables (§5.2)
// Corps plat et fuselé, tête ronde à deux paires d'yeux sans bec, trois paires d'ailes étagées (8,5 / 6 / 3,5 m)
// tendues sur 4 baguettes, ruban caudal souple de 2 m, crête lumineuse de 1,1 m depuis le front.

/** Profil du tour du corps : (rayon, position axiale ; +y = vers l'avant avant rotation). */
const SK_PROFILE: readonly (readonly [number, number])[] = [
  [0.0, -2.36],
  [0.17, -2.22],
  [0.34, -1.8],
  [0.5, -1.0],
  [0.61, -0.1],
  [0.64, 0.7],
  [0.59, 1.4],
  [0.47, 1.95],
  [0.3, 2.3],
  [0.0, 2.45],
];
const SK_FLAT = 0.4; // aplatissement vertical du corps
const SK_WIDE = 1.15; // élargissement latéral
const SK_STAND_Y = 0.74; // centre du corps au sol, dressé sur les membres antérieurs
const SK_CROUCH_Y = 0.5; // posé à plat
const SK_FLY_Y = 0.8; // en vol
const SK_ARM_L1 = 0.44;
const SK_ARM_L2 = 0.42;
const SK_SHOULDER_Y = -0.14;
const SK_SHOULDER_Z = -1.55;
const SK_STRIDE = 0.8; // m par cycle de marche (lente)
const SK_TAIL_Z = 2.22; // attache du ruban
const SK_RIBBON_LEN = 2.0;
const SK_RIBBON_SEG = 12;
const SK_SADDLE_Z = -0.3; // entre les ailes avant et médianes
const SK_VIOLET = C('#B884FF');
const SK_AMBER = C('#FFB347');

interface SkWingDef {
  span: number; // envergure bout à bout (m)
  z: number; // position de l'emplanture le long du corps
  y: number; // hauteur de l'emplanture (la paire avant la plus haute)
  chord: number; // corde à l'emplanture
  dihedral: number; // dièdre au repos (rad)
  sweep: number; // flèche au repos (rad, + = vers l'arrière)
  amp: number; // part de l'amplitude de battement
}

const SK_WINGS: readonly SkWingDef[] = [
  { span: 8.5, z: -1.15, y: 0.15, chord: 1.55, dihedral: 0.16, sweep: 0.0, amp: 1.0 },
  { span: 6.0, z: 0.35, y: 0.02, chord: 1.25, dihedral: 0.08, sweep: 0.1, amp: 0.9 },
  { span: 3.5, z: 1.5, y: -0.09, chord: 0.95, dihedral: 0.02, sweep: 0.22, amp: 0.75 },
];

/** Rayon du tour (avant aplatissement) à la position z du corps. */
function skRadius(z: number): number {
  const y = -z;
  const P = SK_PROFILE;
  if (y <= P[0][1]) return P[0][0];
  for (let i = 1; i < P.length; i++) {
    if (y <= P[i][1]) return lerp(P[i - 1][0], P[i][0], (y - P[i - 1][1]) / (P[i][1] - P[i - 1][1]));
  }
  return 0;
}

/**
 * Contour d'une aile droite dans son plan (x = envergure vers l'extérieur, y = vers l'avant) : bord d'attaque légèrement
 * bombé, puis festons concaves entre les extrémités des 4 baguettes, qui rayonnent en éventail depuis l'emplanture.
 */
function skarelWingOutline(S: number, ch: number): { shape: Shape; roots: Vector2[]; tips: Vector2[] } {
  const roots = [0, 1, 2, 3].map((i) => new Vector2(0, (0.4 - 0.25 * i) * ch));
  const tips = [
    new Vector2(S, 0.42 * ch),
    new Vector2(0.9 * S, -0.05 * ch),
    new Vector2(0.68 * S, -0.55 * ch),
    new Vector2(0.38 * S, -0.85 * ch),
  ];
  const shape = new Shape();
  shape.moveTo(0, 0.45 * ch);
  shape.quadraticCurveTo(0.55 * S, 0.62 * ch, tips[0].x, tips[0].y);
  // Feston : point de contrôle = milieu des deux extrémités, tiré de 14 % vers l'emplanture.
  const scallop = (a: Vector2, b: Vector2): void => {
    shape.quadraticCurveTo((a.x + b.x) * 0.43, (a.y + b.y) * 0.43, b.x, b.y);
  };
  scallop(tips[0], tips[1]);
  scallop(tips[1], tips[2]);
  scallop(tips[2], tips[3]);
  scallop(tips[3], new Vector2(0, -0.5 * ch));
  shape.lineTo(0, 0.45 * ch);
  return { shape, roots, tips };
}

interface SkWing {
  pivot: Group;
  side: number; // +1 droite, -1 gauche (le groupe parent est en miroir)
  idx: number; // 0 avant, 1 médiane, 2 arrière
}

interface SkArm {
  shoulder: Group;
  elbow: Group;
  wrist: Group;
  side: number;
}

class SkarelModel implements CreatureModel {
  readonly root = new Group();
  readonly saddle = new Object3D();
  readonly height = 1.7;
  private readonly kit = new Kit();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly wings: SkWing[] = [];
  private readonly arms: SkArm[] = [];
  private readonly crestMat: MeshStandardMaterial;
  private readonly ribbonGeo: BufferGeometry;
  private readonly ribbonPos: BufferAttribute;
  private readonly ribbonArr: Float32Array;
  private readonly st = { fly: 0, flap: 0, dive: 0, bank: 0, boost: 0, call: 0, crouch: 0, walk: 0 };
  private flapPhase = 0; // rad
  private walkPhase = 0; // cycles
  private ribbonPhase = 0; // rad
  private readonly cyc: Cycle = { z: 0, lift: 0 };
  private readonly ik: Ik = { a: 0, b: 0 };

  constructor() {
    const k = this.kit;
    this.root.name = 'skarel';
    this.root.add(this.body);

    const back = C('#3F4A3C');
    const backDark = C('#2B3429');
    const belly = C('#C9B89B');
    const memRoot = C('#D8C2AC');
    const memTip = C('#E9D7C6');
    const skin = k.mat(std({ vertexColors: true, roughness: 0.78 }));
    const membrane = k.mat(
      std({ vertexColors: true, roughness: 0.6, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }),
    );
    const rodMat = k.mat(std({ color: C('#8A5A3B'), roughness: 0.65 }));
    this.crestMat = k.mat(std({ color: C('#2A2036'), emissive: SK_VIOLET.clone(), emissiveIntensity: 0.6, roughness: 0.35 }));
    const eyeMat = k.mat(std({ color: C('#120E18'), roughness: 0.12, metalness: 0.2, emissive: C('#5A3D8A'), emissiveIntensity: 0.25 }));
    const skinPaint: Painter = (p, n, out) => {
      out.copy(back).lerp(backDark, 0.7 * smooth01(mottle(p.x * 2.2, p.y * 3, p.z * 1.3) * 1.8 - 0.7));
      out.lerp(belly, smooth01((0.12 - n.y) / 0.55));
    };

    // Corps : tour aplati et fuselé (l'axe du tour devient l'axe Z, l'avant vers -Z).
    const bodyGeo = new LatheGeometry(
      SK_PROFILE.map(([r, y]) => new Vector2(r, y)),
      10,
    );
    bodyGeo.rotateX(-Math.PI / 2);
    bodyGeo.scale(SK_WIDE, SK_FLAT, 1);
    k.mesh(paint(bodyGeo, skinPaint), skin, this.body);

    // Tête courte et ronde, sans bec ; deux paires d'yeux (la grande sur les côtés, la petite au-dessus, en retrait).
    this.head.position.set(0, 0.03, -2.42);
    this.head.rotation.order = 'YXZ';
    this.body.add(this.head);
    const skull = new SphereGeometry(0.4, 10, 7);
    skull.scale(1.05, 0.78, 0.95);
    skull.translate(0, 0, -0.14);
    k.mesh(paint(skull, skinPaint), skin, this.head);
    const ico = k.geo(paint(new IcosahedronGeometry(1, 0), back));
    const eyeM: Matrix4[] = [];
    const eyeDefs: readonly (readonly [number, number, number, number])[] = [
      [0.27, 0.06, -0.4, 0.075],
      [0.22, 0.23, -0.3, 0.05],
    ];
    for (const [x, y, z, r] of eyeDefs) {
      for (const s of [-1, 1]) eyeM.push(new Matrix4().compose(new Vector3(s * x, y, z), Q0, new Vector3(r, r * 0.85, r)));
    }
    k.mesh(k.geo(mergeCopies(ico, eyeM)), eyeMat, this.head, false);

    // Crête : 12 lames coniques émissives, du front jusqu'à 1,1 m en arrière (4 sur la tête, 8 sur le dos).
    const headCrest: BufferGeometry[] = [];
    const bodyCrest: BufferGeometry[] = [];
    for (let i = 0; i < 12; i++) {
      const t = i / 11;
      const zAbs = -2.72 + t * 1.1;
      const h = 0.1 + 0.24 * Math.sin(Math.PI * clamp(0.18 + t * 0.9, 0, 1));
      const cone = new ConeGeometry(0.075, h, 4, 1, true);
      cone.translate(0, h / 2, 0);
      cone.scale(0.4, 1, 1);
      cone.rotateX(0.38);
      if (zAbs < -2.3) {
        const zl = zAbs + 2.42;
        const e = (zl + 0.14) / 0.38;
        cone.translate(0, 0.312 * Math.sqrt(Math.max(0, 1 - e * e)) - 0.025, zl);
        headCrest.push(cone);
      } else {
        cone.translate(0, skRadius(zAbs) * SK_FLAT - 0.025, zAbs);
        bodyCrest.push(cone);
      }
    }
    k.mesh(k.geo(mergeAll(headCrest)), this.crestMat, this.head, false);
    k.mesh(k.geo(mergeAll(bodyCrest)), this.crestMat, this.body, false);

    // Ailes : trois paires étagées. Chaque côté est un groupe en miroir (scale.x = ±1) : mêmes géométries, mêmes angles.
    const rodBase = new CylinderGeometry(0.012, 0.03, 1, 3, 1, true);
    rodBase.translate(0, 0.5, 0);
    const fairM: Matrix4[] = [];
    for (let i = 0; i < SK_WINGS.length; i++) {
      const w = SK_WINGS[i];
      const ht = skRadius(w.z) * SK_FLAT;
      const hw = skRadius(w.z) * SK_WIDE;
      const rootX = hw * Math.sqrt(Math.max(0, 1 - (w.y / ht) ** 2)) - 0.05;
      const S = w.span / 2 - rootX;
      const o = skarelWingOutline(S, w.chord);
      const mem = new ShapeGeometry(o.shape, 5);
      mem.rotateX(-Math.PI / 2); // plan XY → XZ, l'avant du contour vers -Z, normale vers +Y
      paint(mem, (p, _n, out) => {
        out.copy(memRoot).lerp(memTip, clamp(p.x / S, 0, 1));
      });
      k.geo(mem);
      const rods: BufferGeometry[] = [];
      for (let r = 0; r < 4; r++) {
        const a = new Vector3(o.roots[r].x, 0.012, -o.roots[r].y);
        const d = new Vector3(o.tips[r].x, 0.012, -o.tips[r].y).sub(a);
        const len = d.length();
        const th = r === 0 ? 1.4 : 1; // baguette de bord d'attaque plus épaisse
        const q = new Quaternion().setFromUnitVectors(UP, d.normalize());
        rods.push(rodBase.clone().applyMatrix4(new Matrix4().compose(a, q, new Vector3(th, len, th))));
      }
      const rodGeo = k.geo(mergeAll(rods));
      for (const side of [-1, 1]) {
        const mirror = new Group();
        mirror.scale.x = side;
        this.body.add(mirror);
        const pivot = new Group();
        pivot.position.set(rootX, w.y, w.z);
        mirror.add(pivot);
        k.mesh(mem, membrane, pivot).receiveShadow = false;
        k.mesh(rodGeo, rodMat, pivot);
        this.wings.push({ pivot, side, idx: i });
        // Épaule charnue qui masque l'emplanture
        fairM.push(new Matrix4().compose(new Vector3(side * (rootX + 0.02), w.y, w.z + 0.05), Q0, new Vector3(0.2, 0.11, w.chord * 0.42)));
      }
    }
    rodBase.dispose();
    k.mesh(k.geo(mergeCopies(ico, fairM)), skin, this.body);

    // Membres antérieurs (marche lente au sol, repliés sous le ventre en vol)
    const limb = k.geo(paint(limbGeo(6), skinPaint));
    const pad = k.geo(paint(new BoxGeometry(0.2, 0.06, 0.28), backDark));
    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * 0.4, SK_SHOULDER_Y, SK_SHOULDER_Z);
      this.body.add(shoulder);
      const elbow = addSegment(k, limb, skin, shoulder, SK_ARM_L1, 0.09);
      const wrist = addSegment(k, limb, skin, elbow, SK_ARM_L2, 0.07);
      k.mesh(pad, skin, wrist).position.set(0, -0.02, -0.06);
      this.arms.push({ shoulder, elbow, wrist, side });
    }

    // Ruban caudal : bande souple de 2 m, ondulée sur le processeur (26 sommets).
    const n = SK_RIBBON_SEG;
    const rg = new BufferGeometry();
    this.ribbonArr = new Float32Array((n + 1) * 6);
    this.ribbonPos = new BufferAttribute(this.ribbonArr, 3).setUsage(DynamicDrawUsage);
    rg.setAttribute('position', this.ribbonPos);
    const rc = new Float32Array((n + 1) * 6);
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      _c.copy(back).lerp(memTip, smooth01((i / n) * 1.6));
      rc.set([_c.r, _c.g, _c.b, _c.r, _c.g, _c.b], i * 6);
      if (i < n) {
        const a = 2 * i;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    rg.setAttribute('color', new Float32BufferAttribute(rc, 3));
    rg.setIndex(idx);
    rg.boundingSphere = new Sphere(new Vector3(0, -0.3, SK_TAIL_Z + 1), 1.8);
    this.ribbonGeo = k.geo(rg);
    k.mesh(rg, membrane, this.body).receiveShadow = false;

    // Selle : sur le dos, entre les ailes avant et médianes.
    this.saddle.name = 'skarel-saddle';
    this.saddle.position.set(0, skRadius(SK_SADDLE_Z) * SK_FLAT, SK_SADDLE_Z);
    this.body.add(this.saddle);

    this.update(0, REST_ANIM);
  }

  update(dt: number, a: CreatureAnim): void {
    const s = this.st;
    s.fly += (clamp(a.flying, 0, 1) - s.fly) * ease(3, dt);
    s.flap += (clamp(a.flap, 0, 1) - s.flap) * ease(12, dt);
    s.dive += (clamp(a.dive, 0, 1) - s.dive) * ease(6, dt);
    s.bank += (clamp(a.bank, -1.2, 1.2) - s.bank) * ease(5, dt);
    s.boost += (clamp(a.boost, 0, 1) - s.boost) * ease(3, dt);
    s.call += (clamp(a.call, 0, 1) - s.call) * ease(8, dt);
    s.crouch += (clamp(a.crouch, 0, 1) - s.crouch) * ease(3, dt);
    const ground = 1 - s.fly;
    const spd = Math.max(0, a.speed);
    s.walk += (ground * (1 - s.crouch) * smooth01(spd / 0.8) - s.walk) * ease(4, dt);

    this.flapPhase = (this.flapPhase + dt * TAU * (lerp(0.5, 2.4, s.flap) + 0.3 * s.boost)) % (TAU * 1000);
    this.walkPhase = fract(this.walkPhase + (dt * Math.min(spd, 2.5) * ground) / SK_STRIDE);
    this.ribbonPhase = (this.ribbonPhase + dt * TAU * lerp(0.5, 1.5 + 0.8 * s.boost, s.fly)) % (TAU * 1000);
    const wp = TAU * this.walkPhase;

    // Corps : dressé sur les membres antérieurs au sol, à plat en vol.
    const flapBob = -0.06 * s.flap * s.fly * Math.sin(this.flapPhase + 0.5);
    const bodyY = lerp(lerp(SK_STAND_Y, SK_CROUCH_Y, s.crouch), SK_FLY_Y, s.fly) + flapBob + 0.025 * s.walk * Math.cos(2 * wp);
    const pitch = ground * (0.1 * (1 - s.crouch) + 0.04 * s.call) - 0.05 * s.dive * s.fly;
    this.body.position.y = bodyY;
    this.body.rotation.x = pitch;
    this.body.rotation.z = 0.045 * s.walk * Math.sin(wp);

    // Tête : regard qui balaie au sol, levée pendant le cri.
    this.head.rotation.x = 0.5 * s.call + 0.04 * ground * Math.sin(a.time * 0.9) - 0.08 * s.dive * s.fly;
    this.head.rotation.y = 0.14 * ground * (1 - s.call) * Math.sin(a.time * 0.37);

    // Ailes : vague de battement d'avant en arrière (déphasage 0 / 0,35 / 0,7 rad), repli au sol et en piqué.
    for (const w of this.wings) {
      const def = SK_WINGS[w.idx];
      let fold = ground;
      if (w.idx === 2) fold = Math.max(fold, s.dive);
      else if (w.idx === 1) fold = Math.max(fold, 0.3 * s.dive);
      const spread = 1 - fold;
      const amp = (0.06 + 0.72 * s.flap) * def.amp * spread;
      const flapA = amp * Math.sin(this.flapPhase - w.idx * 0.35);
      const p = w.pivot;
      p.rotation.z = lerp(def.dihedral + flapA - w.side * s.bank * 0.16, -0.3, fold);
      p.rotation.y = -lerp(def.sweep + (w.idx === 0 ? 0.3 * s.dive : 0), 1.38, fold);
      p.rotation.x = (w.side * s.bank * 0.07 + 0.04 * s.dive) * spread;
      p.scale.set(lerp(1, 0.55, fold), 1, lerp(1, 0.42, fold));
    }

    // Membres antérieurs : appuis au sol (IK dans le repère du corps), plaqués vers l'arrière en vol.
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    for (const arm of this.arms) {
      footCycle(fract(this.walkPhase + (arm.side > 0 ? 0.5 : 0)), 0.6, this.cyc);
      const gz = SK_SHOULDER_Z - 0.07 + this.cyc.z * 0.2 * s.walk;
      const gy = 0.04 + this.cyc.lift * 0.14 * s.walk;
      const ry = gy - bodyY;
      let by = ry * cosP + gz * sinP;
      let bz = -ry * sinP + gz * cosP;
      by = lerp(by, SK_SHOULDER_Y - 0.08, s.fly);
      bz = lerp(bz, SK_SHOULDER_Z + 0.82, s.fly);
      ik2(SK_ARM_L1, SK_ARM_L2, by - SK_SHOULDER_Y, bz - SK_SHOULDER_Z, -1, this.ik);
      arm.shoulder.rotation.x = this.ik.a;
      arm.elbow.rotation.x = this.ik.b;
      arm.wrist.rotation.x = -(pitch + this.ik.a + this.ik.b); // paume à plat
    }

    // Crête : violet → ambre en vol rapide, plus vive la nuit et pendant le cri.
    const cm = this.crestMat;
    cm.emissive.copy(SK_VIOLET).lerp(SK_AMBER, s.boost);
    cm.emissiveIntensity = 0.5 + 1.8 * clamp(a.night, 0, 1) + 2.4 * s.call + 0.5 * s.boost + 0.15 * Math.sin(a.time * 2.2);

    this.layoutRibbon(bodyY, pitch, ground);
  }

  /** Ondulation du ruban (dans le repère du corps) ; au sol, il traîne et se pose par terre. */
  private layoutRibbon(bodyY: number, pitch: number, ground: number): void {
    const s = this.st;
    const n = SK_RIBBON_SEG;
    const amp = (lerp(0.05, 0.2, s.fly) + 0.1 * s.boost * s.fly) * (1 - 0.65 * s.dive * s.fly);
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    const arr = this.ribbonArr;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const z = SK_TAIL_Z + t * SK_RIBBON_LEN;
      const wave = Math.sin(this.ribbonPhase - t * 5.5) * amp * Math.pow(t, 1.2);
      const lat = Math.sin(this.ribbonPhase * 0.55 - t * 3.2) * amp * 0.6 * t;
      const gy = (0.03 - bodyY + z * sinP) / cosP; // y local qui pose le ruban au sol
      const y = lerp(wave, gy + 0.3 * wave, ground * smooth01(t * 2.4));
      const hw = 0.2 * (1 - 0.65 * t) + 0.05 * t ** 4;
      const o = i * 6;
      arr[o] = lat - hw;
      arr[o + 1] = y;
      arr[o + 2] = z;
      arr[o + 3] = lat + hw;
      arr[o + 4] = y;
      arr[o + 5] = z;
    }
    this.ribbonPos.needsUpdate = true;
    this.ribbonGeo.computeVertexNormals();
  }

  dispose(): void {
    this.kit.dispose();
  }
}

// =============================================================================================
// Tormaq — porteur des marais (§5.3)
// Quadrupède trapu de 5,5 m, 2,4 m au garrot, 3 m de large ; dos plat (carapace 3,5 × 2,4 m) couvert de mousse et de
// lamelles ; pattes en colonnes courtes à pieds larges ; tête basse en pelle ; pores ambrés sur les flancs.

const TQ_BODY_Y = 1.52; // centre du corps debout (dessus de carapace ≈ 2,38 m)
const TQ_CROUCH_Y = 0.85; // couché, ventre presque au sol
const TQ_HIP = { x: 1.0, y: -0.45, z: 1.15 };
const TQ_UPPER = 0.48;
const TQ_LOWER = 0.45;
const TQ_NECK = { y: -0.02, z: -1.62 };
const TQ_TOP = 0.86; // dessus de la carapace (repère du corps)
// Décalages de phase des pattes (fractions de cycle) — ordre AG, AD, ArG, ArD.
const TQ_WALK = [0.25, 0.75, 0.0, 0.5]; // pas latéral à 4 temps
const TQ_TROT = [0.0, 0.5, 0.5, 0.0]; // diagonales
const TQ_CHARGE = [0.0, 0.12, 0.55, 0.67]; // galop lourd

interface TqLeg {
  hip: Group;
  knee: Group;
  foot: Group;
  sx: number; // -1 gauche, +1 droite
  front: boolean;
  idx: number;
}

class TormaqModel implements CreatureModel {
  readonly root = new Group();
  readonly saddle = new Object3D();
  readonly height = 2.6;
  private readonly kit = new Kit();
  private readonly body = new Group();
  private readonly neck = new Group();
  private readonly head = new Group();
  private readonly tail = new Group();
  private readonly legs: TqLeg[] = [];
  private readonly poreMat: MeshStandardMaterial;
  private readonly eyeMat: MeshStandardMaterial;
  private readonly st = { move: 0, gait: 0, crouch: 0, call: 0, air: 0 };
  private phase = 0; // cycles

  constructor() {
    const k = this.kit;
    this.root.name = 'tormaq';
    this.root.add(this.body);

    const shell = C('#6B5A44');
    const shellDark = C('#4E4132');
    const moss = C('#5E7A3A');
    const mossLight = C('#7C9A4A');
    const skin = C('#8C705A');
    const skinDark = C('#6A523F');
    const belly = C('#B39A7C');
    const hide = k.mat(std({ vertexColors: true, roughness: 0.92 }));
    this.eyeMat = k.mat(std({ color: C('#E3A33B'), roughness: 0.25, emissive: C('#E3A33B'), emissiveIntensity: 0.15 }));
    this.poreMat = k.mat(std({ color: C('#4A3524'), roughness: 0.5, emissive: C('#FFB347'), emissiveIntensity: 0 }));
    const skinPaint: Painter = (p, n, out) => {
      out.copy(skin).lerp(skinDark, 0.45 * mottle(p.x * 1.3, p.y * 2, p.z * 1.1));
      if (n.y < -0.3) out.lerp(belly, smooth01((-n.y - 0.3) / 0.5));
    };

    // Corps : boîte arrondie 3,5 × 1,2 × 2,4, flancs bombés, ventre légèrement affaissé.
    const bodyGeo = new RoundedBoxGeometry(2.4, 1.2, 3.5, 2, 0.36);
    const bp = bodyGeo.getAttribute('position');
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i);
      const y = bp.getY(i);
      const z = bp.getZ(i);
      const v = y / 0.6;
      const bulge = 1 - v * v;
      bp.setXYZ(i, x * (1 + 0.07 * bulge), y < 0 ? y * (1 + 0.06 * (1 - (x / 1.2) ** 2)) : y, z * (1 + 0.025 * bulge));
    }
    k.mesh(
      paint(bodyGeo, (p, n, out) => {
        skinPaint(p, n, out);
        if (n.y > 0.5) out.lerp(shell, smooth01((n.y - 0.5) / 0.4));
      }),
      hide,
      this.body,
    );

    // Carapace : dalle plate qui déborde un peu, mousse sur le pourtour.
    const shellGeo = new RoundedBoxGeometry(2.66, 0.3, 3.74, 1, 0.12);
    paint(shellGeo, (p, n, out) => {
      out.copy(shell).lerp(shellDark, 0.5 * mottle(p.x * 2.2, 0, p.z * 1.7));
      if (n.y > 0.3) {
        const rim = smooth01((Math.max(Math.abs(p.x) / 1.33, Math.abs(p.z) / 1.87) - 0.55) / 0.4);
        out.lerp(moss, clamp(rim * 0.8 + 0.6 * (mottle(p.x * 3, 1, p.z * 2.5) - 0.5), 0, 1));
      }
    });
    k.mesh(shellGeo, hide, this.body).position.y = TQ_TOP - 0.15;

    // Coussins de mousse (fusionnés) et touffes de lamelles de la flore (même géométrie et même matériau que le sol).
    const ico = k.geo(paint(new IcosahedronGeometry(1, 0), (p, _n, out) => {
      out.copy(moss).lerp(mossLight, 0.5 * mottle(p.x * 4, p.y * 4, p.z * 4));
    }));
    const mossDefs: readonly (readonly [number, number, number, number])[] = [
      [-1.05, 0.95, 0.42, 0.3],
      [1.08, -0.3, 0.38, 0.34],
      [0.55, 1.6, 0.4, 0.26],
      [-0.85, -1.55, 0.36, 0.3],
      [1.0, 1.15, 0.3, 0.3],
      [-1.15, -0.2, 0.3, 0.42],
    ];
    k.mesh(
      k.geo(mergeCopies(ico, mossDefs.map(([x, z, sx, sz]) => new Matrix4().compose(new Vector3(x, TQ_TOP, z), Q0, new Vector3(sx, 0.12, sz))))),
      hide,
      this.body,
    );
    const tuftDefs: readonly (readonly [number, number, number])[] = [
      [-1.0, 1.45, 0.75],
      [0.95, 1.55, 0.68],
      [0.15, 1.65, 0.55],
      [-1.08, -1.4, 0.62],
      [1.05, -1.45, 0.7],
      [-1.12, 0.45, 0.55],
      [1.12, 0.5, 0.6],
      [-0.5, -1.65, 0.5],
    ];
    const vegMat = createVegetationMaterial({ glowColor: new Color(0.62, 0.32, 1.0), glowBoost: 0.7, doubleSide: true, windAmp: 0.5 });
    const tufts = k.instanced(lamelleGeometry(), vegMat, tuftDefs.length, this.body, false);
    const tm = new Matrix4();
    const tq = new Quaternion();
    tuftDefs.forEach(([x, z, sc], i) => {
      tq.setFromAxisAngle(UP, i * 2.39);
      tufts.setMatrixAt(i, tm.compose(new Vector3(x, TQ_TOP - 0.02, z), tq, new Vector3(sc, sc, sc)));
    });
    tufts.computeBoundingSphere();

    // Pores ambrés des flancs (disques fusionnés, émissifs la nuit).
    const pore = new CircleGeometry(0.065, 5);
    const poreM: Matrix4[] = [];
    const poreDefs: readonly (readonly [number, number, number])[] = [
      [0.06, -0.9, 0.9],
      [0.06, -0.45, 1.15],
      [0.06, 0.0, 1.0],
      [0.06, 0.45, 1.2],
      [0.06, 0.9, 0.85],
      [-0.16, -0.675, 1.1],
      [-0.16, -0.225, 0.85],
      [-0.16, 0.225, 1.15],
      [-0.16, 0.675, 0.95],
    ];
    for (const side of [-1, 1]) {
      const q = new Quaternion().setFromAxisAngle(UP, (side * Math.PI) / 2);
      for (const [y, z, sc] of poreDefs) {
        const xs = 1.2 * (1 + 0.07 * (1 - (y / 0.6) ** 2)) + 0.012;
        poreM.push(new Matrix4().compose(new Vector3(side * xs, y, z * 1.02), q, new Vector3(sc, sc, sc)));
      }
    }
    k.mesh(k.geo(mergeCopies(pore, poreM)), this.poreMat, this.body, false);
    pore.dispose();

    // Pattes en colonnes : cuisse, jambe, pied large.
    const limb = k.geo(paint(limbGeo(8), skinPaint));
    const footGeo = k.geo(paint(new CylinderGeometry(0.3, 0.46, 0.14, 8, 1), skinDark));
    const legDefs: readonly (readonly [number, number])[] = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    legDefs.forEach(([sx, sz], idx) => {
      const hip = new Group();
      hip.position.set(sx * TQ_HIP.x, TQ_HIP.y, sz * TQ_HIP.z);
      this.body.add(hip);
      const knee = addSegment(k, limb, hide, hip, TQ_UPPER, 0.36);
      const foot = addSegment(k, limb, hide, knee, TQ_LOWER, 0.31);
      k.mesh(footGeo, hide, foot).position.y = -0.07;
      this.legs.push({ hip, knee, foot, sx, front: sz < 0, idx });
    });

    // Cou court et tête basse en pelle.
    this.neck.position.set(0, TQ_NECK.y, TQ_NECK.z);
    this.body.add(this.neck);
    const neckMesh = k.mesh(limb, hide, this.neck);
    neckMesh.scale.set(0.45, 0.62, 0.45);
    neckMesh.rotation.x = 1.2;
    this.head.position.set(0, -0.62 * Math.cos(1.2), -0.62 * Math.sin(1.2));
    this.head.rotation.order = 'YXZ';
    this.neck.add(this.head);
    const skull = new SphereGeometry(0.5, 10, 7);
    skull.scale(1.1, 0.6, 1.0);
    skull.translate(0, 0, -0.3);
    k.mesh(paint(skull, skinPaint), hide, this.head);
    const shovel = k.mesh(paint(new BoxGeometry(0.95, 0.1, 0.6), shellDark), hide, this.head);
    shovel.position.set(0, -0.2, -0.72);
    shovel.rotation.x = -0.12;
    const eyeM = [-1, 1].map((s) => new Matrix4().compose(new Vector3(s * 0.36, 0.17, -0.42), Q0, new Vector3(0.075, 0.075, 0.075)));
    k.mesh(k.geo(mergeCopies(ico, eyeM)), this.eyeMat, this.head, false);

    // Queue courte, tombante.
    this.tail.position.set(0, -0.15, 1.72);
    this.body.add(this.tail);
    const tailGeo = new ConeGeometry(0.28, 0.65, 6, 1, true);
    tailGeo.translate(0, 0.325, 0);
    k.mesh(paint(tailGeo, skinPaint), hide, this.tail).rotation.x = Math.PI / 2 + 0.45;

    // Selle : sur le dos plat, légèrement en avant du centre.
    this.saddle.name = 'tormaq-saddle';
    this.saddle.position.set(0, TQ_TOP, -0.15);
    this.body.add(this.saddle);

    this.update(0, REST_ANIM);
  }

  update(dt: number, a: CreatureAnim): void {
    const s = this.st;
    const spd = Math.max(0, a.speed);
    s.move += (smooth01(spd / 0.6) - s.move) * ease(4, dt);
    s.gait += (clamp(a.gait, 0, 3) - s.gait) * ease(3, dt);
    s.crouch += (clamp(a.crouch, 0, 1) - s.crouch) * ease(2.2, dt);
    s.call += (clamp(a.call, 0, 1) - s.call) * ease(6, dt);
    s.air += ((a.grounded ? 0 : 1) - s.air) * ease(8, dt);
    const g = s.gait;
    if (a.grounded) this.phase = fract(this.phase + (dt * spd) / (1.7 + 0.45 * g));
    const mv = s.move * (1 - s.crouch);
    const legAmt = mv * (1 - s.air);
    const swingA = legAmt * (0.2 + 0.07 * g);
    const liftA = legAmt * (0.3 + 0.12 * g);
    const tw = smooth01(g - 1);
    const ch = smooth01(g - 2);
    const u0 = TAU * this.phase;

    // Corps : lourd balancement (toujours vers le haut, pour ne pas enfoncer les pieds), plus marqué à la charge.
    this.body.position.y = lerp(TQ_BODY_Y, TQ_CROUCH_Y, s.crouch) + legAmt * (0.025 + 0.02 * g) * (0.5 + 0.5 * Math.cos(2 * u0));
    this.body.rotation.z = 0.03 * legAmt * Math.sin(u0);
    this.body.rotation.x = -0.035 * ch * mv + 0.02 * legAmt * Math.sin(2 * u0 + 0.6);
    const pitch = this.body.rotation.x;

    // Pattes : balancier à la hanche, genou qui plie pendant le retour ; repliées couché, regroupées en l'air.
    const air = s.air * (1 - s.crouch);
    for (const leg of this.legs) {
      const off = lerp(lerp(TQ_WALK[leg.idx], TQ_TROT[leg.idx], tw), TQ_CHARGE[leg.idx], ch);
      const u = TAU * (this.phase + off);
      let hip = swingA * Math.sin(u);
      let knee = -liftA * Math.max(0, Math.cos(u));
      // Couché : cuisse presque horizontale, jambe repliée dessous (genoux avant vers l'avant, arrière vers l'arrière).
      hip = lerp(hip, leg.front ? 1.3 : -1.3, s.crouch);
      knee = lerp(knee, leg.front ? -2.59 : 2.59, s.crouch);
      hip = lerp(hip, leg.front ? -0.35 : 0.35, air);
      knee = lerp(knee, leg.front ? 0.55 : -0.55, air);
      leg.hip.rotation.x = hip;
      leg.hip.rotation.z = leg.sx * 0.15 * s.crouch;
      leg.knee.rotation.x = knee;
      leg.foot.rotation.x = -(hip + knee + pitch); // semelle à plat
    }

    // Cou et tête : broute au repos (tête basse qui balaie la vase), oscille en marchant, se lève pour l'appel.
    const graze = (1 - s.move) * (1 - s.call) * (1 - s.crouch);
    this.neck.rotation.x =
      lerp(-0.05, -0.32 + 0.06 * Math.sin(a.time * 0.6), graze) + 0.5 * s.call + 0.05 * legAmt * Math.sin(2 * u0 + 1.2) - 0.25 * s.crouch;
    this.neck.rotation.y = 0.22 * graze * Math.sin(a.time * 0.33);
    this.neck.position.set(0, TQ_NECK.y + 0.06 * s.call, TQ_NECK.z - 0.14 * s.call);
    this.head.rotation.x = 0.28 * s.call - 0.06 * legAmt * Math.sin(2 * u0);
    this.tail.rotation.y = 0.18 * legAmt * Math.sin(u0 + 0.8) + 0.05 * Math.sin(a.time * 0.8);

    // Émissifs : pores proportionnels à la nuit (pulsation lente), yeux légèrement lumineux.
    const night = clamp(a.night, 0, 1);
    this.poreMat.emissiveIntensity = night * (2.6 * (0.85 + 0.15 * Math.sin(a.time * 1.3)) + 0.8 * s.call);
    this.eyeMat.emissiveIntensity = 0.15 + 0.6 * night;
  }

  dispose(): void {
    this.kit.dispose();
  }
}

// =============================================================================================
// Vexil — coureur des lamelles (§5.4)
// Bipède digitigrade de 2,8 m à la tête, corps compact en goutte (1,4 m), long cou en S, tête étroite à museau corné,
// pas de bras, pattes de 1,6 m à trois doigts, queue courte en éventail, plumage de lamelles rigides (0,3–0,5 m).

const VX_L1 = 0.5; // fémur
const VX_L2 = 0.62; // tibia
const VX_L3 = 0.48; // métatarse (le « genou à l'envers » est la cheville)
const VX_HIP_X = 0.26;
const VX_HIP_Y = -0.17; // hanche dans le repère du corps
const VX_HIP_Z = 0.1;
const VX_STAND = 1.36; // hauteur de hanche debout
const VX_CROUCH = 0.42; // couché
const VX_NS = 10; // anneaux du cou
const VX_NR = 6; // côtés du cou
const VX_NECK_K = 9; // rangées de lamelles sur le cou
const VX_NECK_ANG = [-1.9, -0.95, 0, 0.95, 1.9]; // autour de la ligne dorsale du cou (rad)
// Points de contrôle du cou (y, z) dans le repère du corps.
type NeckPose = readonly (readonly [number, number])[];
const VX_NECK_STAND: NeckPose = [
  [0.2, -0.46],
  [0.58, -0.74],
  [0.95, -0.58],
  [1.2, -0.8],
];
const VX_NECK_RUN: NeckPose = [
  [0.2, -0.46],
  [0.48, -0.85],
  [0.72, -1.02],
  [0.9, -1.3],
];
const VX_NECK_CALL: NeckPose = [
  [0.2, -0.46],
  [0.62, -0.6],
  [1.02, -0.62],
  [1.45, -0.66],
];
const VX_NECK_LOW: NeckPose = [
  [0.15, -0.5],
  [0.05, -0.9],
  [-0.06, -1.25],
  [-0.1, -1.6],
];

/** Point de la surface du corps en goutte pour une direction unitaire `d`. */
function vxBodyPoint(d: Vector3, out: Vector3): Vector3 {
  out.set(d.x * 0.42, d.y * 0.42, d.z * 0.7);
  if (out.z > 0) {
    const q = (out.z / 0.7) ** 2;
    out.x *= 1 - 0.38 * q;
    out.y = out.y * (1 - 0.38 * q) + 0.07 * q;
  }
  return out;
}

/** Lamelle : losange plié à 2 triangles (base en 0, pointe en y = 1, largeur 1, pli 0,25), cuivre → ivoire. */
function bladeGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, -0.5, 0.35, 0.25, 0.5, 0.35, 0.25, 0, 1, 0], 3));
  g.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0.45, 0, 0.9, -0.45, 0, 0.9, 0, 0, 1], 3));
  const base = C('#B5733A');
  const tip = C('#EDE3CE');
  const mid = base.clone().lerp(tip, 0.3);
  g.setAttribute('color', new Float32BufferAttribute([base.r, base.g, base.b, mid.r, mid.g, mid.b, mid.r, mid.g, mid.b, tip.r, tip.g, tip.b], 3));
  g.setAttribute('aTip', new Float32BufferAttribute([0, 0.35, 0.35, 1], 1));
  g.setIndex([0, 3, 1, 0, 2, 3]);
  g.computeBoundingSphere();
  return g;
}

/**
 * Matériau des lamelles : frémissement dans le vertex shader (amplitude uniforme, phase par instance) et seules les
 * pointes émissives (masque aTip²). Reprend aussi les uniformes globaux (brouillard de hauteur).
 */
function lamelleMaterial(uShiver: { value: number }, uTime: { value: number }): MeshStandardMaterial {
  const mat = std({ vertexColors: true, roughness: 0.5, metalness: 0.25, side: DoubleSide, emissive: C('#9B6BFF'), emissiveIntensity: 0 });
  mat.onBeforeCompile = (shader) => {
    injectGlobals(shader.uniforms);
    shader.uniforms.uVxShiver = uShiver;
    shader.uniforms.uVxTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTip;\nuniform float uVxShiver;\nuniform float uVxTime;\nvarying float vVxTip;')
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
  vVxTip = aTip;
  {
    float ph = float(gl_InstanceID) * 2.399;
    float sh = sin(uVxTime * 34.0 + ph) * 0.7 + sin(uVxTime * 21.0 + ph * 1.7) * 0.3;
    transformed.z += sh * uVxShiver * aTip;
    transformed.x += sh * uVxShiver * 0.35 * aTip * aTip;
  }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vVxTip;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance *= vVxTip * vVxTip;');
  };
  mat.customProgramCacheKey = () => 'veyra-vexil-lamelle';
  return mat;
}

interface VxLeg {
  hip: Group;
  knee: Group;
  ankle: Group;
  toe: Group;
  off: number; // décalage de phase (cycles)
}

const _P = new Vector3();
const _T = new Vector3();
const _D = new Vector3();
const _N = new Vector3();
const _dir = new Vector3();
const _pos = new Vector3();
const _m = new Matrix4();

class VexilModel implements CreatureModel {
  readonly root = new Group();
  readonly saddle = new Object3D();
  readonly height = 2.8;
  private readonly kit = new Kit();
  private readonly body = new Group();
  private readonly head = new Group();
  private readonly legs: VxLeg[] = [];
  private readonly ctrl: Vector3[];
  private readonly curve: CatmullRomCurve3;
  private readonly neckPos: BufferAttribute;
  private readonly neckNor: BufferAttribute;
  private readonly neckP: Float32Array;
  private readonly neckN: Float32Array;
  private readonly lamelles: InstancedMesh;
  private readonly neckStart: number;
  private readonly neckLen: Float32Array;
  private readonly lamMat: MeshStandardMaterial;
  private readonly eyeMat: MeshStandardMaterial;
  private readonly uShiver = { value: 0 };
  private readonly uTime = { value: 0 };
  private readonly st = { move: 0, run: 0, crouch: 0, call: 0, air: 0 };
  private phase = 0; // cycles
  private readonly cyc: Cycle = { z: 0, lift: 0 };
  private readonly ik: Ik = { a: 0, b: 0 };

  constructor() {
    const k = this.kit;
    this.root.name = 'vexil';
    this.root.add(this.body);

    const copperDark = C('#6B4126');
    const ivory = C('#C9B593');
    const skin = k.mat(std({ vertexColors: true, roughness: 0.7 }));
    const legMat = k.mat(std({ color: C('#4A3B30'), roughness: 0.75 }));
    const hornMat = k.mat(std({ color: C('#CDBB98'), roughness: 0.35 }));
    this.eyeMat = k.mat(std({ color: C('#F2B640'), roughness: 0.2, emissive: C('#F2B640'), emissiveIntensity: 0.25 }));
    this.lamMat = k.mat(lamelleMaterial(this.uShiver, this.uTime));
    const skinPaint: Painter = (_p, n, out) => {
      out.copy(copperDark).lerp(ivory, smooth01((-0.1 - n.y) / 0.5));
    };

    // Corps compact en goutte (1,4 m), queue effilée et légèrement relevée.
    const bodyGeo = new SphereGeometry(1, 10, 8);
    const bpos = bodyGeo.getAttribute('position');
    for (let i = 0; i < bpos.count; i++) {
      _D.fromBufferAttribute(bpos, i);
      vxBodyPoint(_D, _P);
      bpos.setXYZ(i, _P.x, _P.y, _P.z);
    }
    bodyGeo.computeVertexNormals();
    k.mesh(paint(bodyGeo, skinPaint), skin, this.body);

    // Pattes digitigrades : fémur, tibia, métatarse, trois doigts (IK simple à deux segments + métatarse orienté).
    const limb = k.geo(limbGeo(7));
    const ico = k.geo(new IcosahedronGeometry(1, 0));
    const toeBase = new ConeGeometry(1, 1, 4, 1, true);
    toeBase.rotateX(Math.PI);
    toeBase.translate(0, -0.5, 0);
    const toesGeo = k.geo(
      mergeCopies(
        toeBase,
        [-0.5, 0, 0.5].map((rz) =>
          new Matrix4().compose(new Vector3(0, 0, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz), new Vector3(0.035, rz === 0 ? 0.27 : 0.22, 0.035)),
        ),
      ),
    );
    toeBase.dispose();
    for (const side of [-1, 1]) {
      const hip = new Group();
      hip.position.set(side * VX_HIP_X, VX_HIP_Y, VX_HIP_Z);
      this.body.add(hip);
      const knee = addSegment(k, limb, legMat, hip, VX_L1, 0.13);
      const ankle = addSegment(k, limb, legMat, knee, VX_L2, 0.08);
      const toe = addSegment(k, limb, legMat, ankle, VX_L3, 0.052);
      k.mesh(ico, legMat, ankle).scale.setScalar(0.062); // talon saillant
      k.mesh(toesGeo, legMat, toe);
      this.legs.push({ hip, knee, ankle, toe, off: side < 0 ? 0 : 0.5 });
    }

    // Cou en S : tube recalculé à chaque image le long d'une Catmull-Rom (plan sagittal).
    this.ctrl = VX_NECK_STAND.map(([y, z]) => new Vector3(0, y, z));
    this.curve = new CatmullRomCurve3(this.ctrl, false, 'centripetal');
    const nv = (VX_NS + 1) * VX_NR;
    this.neckP = new Float32Array(nv * 3);
    this.neckN = new Float32Array(nv * 3);
    this.neckPos = new BufferAttribute(this.neckP, 3).setUsage(DynamicDrawUsage);
    this.neckNor = new BufferAttribute(this.neckN, 3).setUsage(DynamicDrawUsage);
    const ng = new BufferGeometry();
    ng.setAttribute('position', this.neckPos);
    ng.setAttribute('normal', this.neckNor);
    const ncol = new Float32Array(nv * 3);
    const nidx: number[] = [];
    for (let i = 0; i <= VX_NS; i++) {
      for (let j = 0; j < VX_NR; j++) {
        const dorsal = 0.5 + 0.5 * Math.cos((j / VX_NR) * TAU);
        _c.copy(ivory).lerp(copperDark, smooth01(dorsal * 1.6 - 0.3));
        const o = (i * VX_NR + j) * 3;
        ncol[o] = _c.r;
        ncol[o + 1] = _c.g;
        ncol[o + 2] = _c.b;
        if (i < VX_NS) {
          const a0 = i * VX_NR + j;
          const b0 = i * VX_NR + ((j + 1) % VX_NR);
          const c0 = a0 + VX_NR;
          const d0 = b0 + VX_NR;
          nidx.push(a0, b0, d0, a0, d0, c0);
        }
      }
    }
    ng.setAttribute('color', new Float32BufferAttribute(ncol, 3));
    ng.setIndex(nidx);
    ng.boundingSphere = new Sphere(new Vector3(0, 0.5, -0.8), 1.4);
    k.mesh(k.geo(ng), skin, this.body);

    // Tête étroite à museau corné.
    this.head.rotation.order = 'YXZ';
    this.body.add(this.head);
    const skull = new SphereGeometry(1, 8, 6);
    skull.scale(0.095, 0.1, 0.21);
    skull.translate(0, 0.02, -0.09);
    k.mesh(paint(skull, skinPaint), skin, this.head);
    const horn = new ConeGeometry(0.06, 0.3, 6, 1);
    horn.rotateX(-Math.PI / 2 - 0.12);
    horn.translate(0, -0.005, -0.35);
    k.mesh(horn, hornMat, this.head);
    const eyeM = [-1, 1].map((s) => new Matrix4().compose(new Vector3(s * 0.075, 0.05, -0.1), Q0, new Vector3(0.028, 0.028, 0.028)));
    k.mesh(k.geo(mergeCopies(ico, eyeM)), this.eyeMat, this.head, false);

    // Plumage de lamelles (InstancedMesh unique) : corps (Fibonacci), éventail caudal, puis cou (recalculé).
    const rand = mulberry32(0x5e11);
    const bodyM: Matrix4[] = [];
    const N = 250;
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (2 * (i + 0.5)) / N;
      if (y < -0.28) continue; // pas de lamelles sous le ventre
      const r = Math.sqrt(1 - y * y);
      _D.set(r * Math.cos(i * golden), y, r * Math.sin(i * golden));
      vxBodyPoint(_D, _P);
      _N.set(_D.x / 0.42, _D.y / 0.42, _D.z / 0.7).normalize();
      // Rabattue vers l'arrière et le bas le long de la peau, puis légèrement décollée.
      _dir.set(0, -0.45, 1).addScaledVector(_N, -_N.dot(_T.set(0, -0.45, 1)));
      if (_dir.lengthSq() < 0.04) _dir.set(0, -_N.z, _N.y);
      _dir.normalize().addScaledVector(_N, 0.38);
      const len = (y > 0.4 ? 0.38 : 0.3) + rand() * 0.12;
      _P.addScaledVector(_N, -0.015);
      bodyM.push(bladeMatrix(new Matrix4(), _P, _dir, _N, 0.075, len, 0.07));
    }
    vxBodyPoint(_D.set(0, 0.3, 0.95).normalize(), _P);
    for (let j = 0; j < 9; j++) {
      const al = -1.05 + (2.1 * j) / 8;
      _dir.set(Math.sin(al) * 0.8, 0.55 + 0.3 * Math.cos(al), 0.85);
      _N.set(0, 0.85, -0.45);
      bodyM.push(bladeMatrix(new Matrix4(), _P, _dir, _N, 0.12, 0.48 + 0.06 * Math.cos(al), 0.07));
    }
    this.neckStart = bodyM.length;
    const total = bodyM.length + VX_NECK_K * VX_NECK_ANG.length;
    this.neckLen = new Float32Array(VX_NECK_K * VX_NECK_ANG.length);
    for (let i = 0; i < this.neckLen.length; i++) this.neckLen[i] = 0.26 + rand() * 0.08;
    this.lamelles = k.instanced(k.geo(bladeGeometry()), this.lamMat, total, this.body, true);
    this.lamelles.instanceMatrix.setUsage(DynamicDrawUsage);
    for (let i = 0; i < total; i++) {
      if (i < bodyM.length) this.lamelles.setMatrixAt(i, bodyM[i]);
      this.lamelles.setColorAt(i, _c.setScalar(0.82 + rand() * 0.3));
    }

    // Selle : à la base du cou, sur le corps.
    this.saddle.name = 'vexil-saddle';
    this.saddle.position.set(0, 0.39, -0.26);
    this.body.add(this.saddle);

    this.update(0, REST_ANIM);
    this.lamelles.computeBoundingSphere();
    if (this.lamelles.boundingSphere) this.lamelles.boundingSphere.radius += 0.7;
  }

  update(dt: number, a: CreatureAnim): void {
    const s = this.st;
    const spd = Math.max(0, a.speed);
    s.move += (smooth01(spd / 1.2) - s.move) * ease(5, dt);
    s.run += (smooth01((spd - 3) / 9) - s.run) * ease(4, dt);
    s.crouch += (clamp(a.crouch, 0, 1) - s.crouch) * ease(3, dt);
    s.call += (clamp(a.call, 0, 1) - s.call) * ease(8, dt);
    s.air += ((a.grounded ? 0 : 1) - s.air) * ease(10, dt);
    const gait = clamp(a.gait, 0, 3);
    if (a.grounded) this.phase = fract(this.phase + (dt * spd) / (1.5 + 1.3 * gait));
    const mv = s.move * (1 - s.crouch);
    const legAmt = mv * (1 - s.air);
    const u0 = TAU * this.phase;

    // Corps : hanches abaissées en course, rebond à chaque foulée, buste penché vers l'avant.
    const hipY =
      lerp(VX_STAND - 0.1 * s.run, VX_CROUCH, s.crouch) - legAmt * (0.035 + 0.05 * s.run) * (0.5 + 0.5 * Math.cos(2 * u0));
    const bodyY = hipY - VX_HIP_Y;
    const pitch = -0.16 * s.run * mv + 0.06 * s.call * (1 - s.crouch) + 0.08 * s.air;
    this.body.position.y = bodyY;
    this.body.rotation.x = pitch;
    this.body.rotation.z = 0.035 * legAmt * Math.sin(u0);

    // Pattes : trajectoire de pied (appui / retour) → cheville via l'angle du métatarse → IK fémur + tibia.
    const sinP = Math.sin(pitch);
    const cosP = Math.cos(pitch);
    const A = legAmt * (0.22 + 0.5 * s.run);
    const H = legAmt * (0.14 + 0.3 * s.run);
    const duty = 0.58 - 0.22 * s.run;
    const air = s.air * (1 - s.crouch);
    const hy = bodyY + VX_HIP_Y * cosP - VX_HIP_Z * sinP; // hanche dans le repère root
    const hz = VX_HIP_Y * sinP + VX_HIP_Z * cosP;
    for (const leg of this.legs) {
      footCycle(fract(this.phase + leg.off), duty, this.cyc);
      const lift = this.cyc.lift * legAmt;
      let fy = 0.035 + this.cyc.lift * H;
      let fz = hz - 0.06 + this.cyc.z * A;
      let phi3 = lerp(0.32, -0.45, lift); // angle absolu du métatarse (cheville → pied)
      let toe = Math.PI / 2 - 0.8 * lift; // doigts à plat vers l'avant, recourbés pendant le retour
      fz = lerp(fz, hz - 0.22, s.crouch);
      fy = lerp(fy, 0.035, s.crouch);
      phi3 = lerp(phi3, 1.38, s.crouch);
      toe = lerp(toe, Math.PI / 2, s.crouch);
      fy = lerp(fy, hy - 0.78, air);
      fz = lerp(fz, hz + 0.18, air);
      phi3 = lerp(phi3, -1.0, air);
      toe = lerp(toe, Math.PI / 2 - 1.1, air);
      const ay = fy + VX_L3 * Math.cos(phi3);
      const az = fz + VX_L3 * Math.sin(phi3);
      const ry = ay - bodyY;
      const by = ry * cosP + az * sinP;
      const bz = -ry * sinP + az * cosP;
      ik2(VX_L1, VX_L2, by - VX_HIP_Y, bz - VX_HIP_Z, 1, this.ik);
      leg.hip.rotation.x = this.ik.a;
      leg.knee.rotation.x = this.ik.b;
      leg.ankle.rotation.x = phi3 - pitch - (this.ik.a + this.ik.b);
      leg.toe.rotation.x = toe - phi3;
    }

    // Cou : en S au repos, tendu vers l'avant à la course, dressé pour le cri, à ras du sol couché.
    const lean = Math.max(smooth01(spd / 10), 0.7 * s.air) * (1 - s.crouch);
    const bob = 0.035 * legAmt * Math.sin(2 * u0 + 0.8);
    const idleZ = 0.03 * (1 - mv) * Math.sin(a.time * 0.9);
    for (let i = 0; i < 4; i++) {
      let y = lerp(VX_NECK_STAND[i][0], VX_NECK_RUN[i][0], lean);
      let z = lerp(VX_NECK_STAND[i][1], VX_NECK_RUN[i][1], lean);
      y = lerp(y, VX_NECK_CALL[i][0], s.call);
      z = lerp(z, VX_NECK_CALL[i][1], s.call);
      y = lerp(y, VX_NECK_LOW[i][0], s.crouch);
      z = lerp(z, VX_NECK_LOW[i][1], s.crouch);
      if (i >= 2) {
        y += bob * (i - 1) * 0.5;
        z += idleZ * (i - 1) * 0.5;
      }
      this.ctrl[i].set(0, y, z);
    }
    this.layoutNeck();

    // Tête : stabilisée à l'horizontale, levée pendant le cri, regard qui balaie au repos.
    this.curve.getPoint(1, this.head.position);
    this.head.rotation.x = -pitch + 0.65 * s.call - 0.2 * s.crouch + 0.05 * legAmt * Math.sin(2 * u0);
    this.head.rotation.y = 0.35 * (1 - mv) * (1 - s.call) * (1 - s.crouch) * Math.sin(a.time * 0.5);

    // Lamelles : frémissement proportionnel à la vitesse (crécelle pendant le cri), pointes violettes la nuit.
    const night = clamp(a.night, 0, 1);
    this.uShiver.value = (0.04 + 0.42 * clamp(spd / 16, 0, 1)) * (1 - 0.7 * s.crouch) + 0.6 * s.call;
    this.uTime.value = a.time;
    this.lamMat.emissiveIntensity = night * (1.8 + 0.5 * s.call);
    this.eyeMat.emissiveIntensity = 0.25 + 0.9 * night;
  }

  /** Recalcule le tube du cou et les lamelles qui le couvrent. */
  private layoutNeck(): void {
    const P = this.neckP;
    const Nn = this.neckN;
    for (let i = 0; i <= VX_NS; i++) {
      const t = i / VX_NS;
      this.curve.getPoint(t, _P);
      this.curve.getTangent(t, _T);
      _D.set(0, -_T.z, _T.y).normalize(); // direction dorsale (perpendiculaire à la tangente dans le plan YZ)
      const r = lerp(0.16, 0.075, t);
      for (let j = 0; j < VX_NR; j++) {
        const th = (j / VX_NR) * TAU;
        const cx = Math.sin(th);
        const cd = Math.cos(th);
        const nx = cx;
        const ny = _D.y * cd;
        const nz = _D.z * cd;
        const o = (i * VX_NR + j) * 3;
        P[o] = _P.x + r * nx;
        P[o + 1] = _P.y + r * ny;
        P[o + 2] = _P.z + r * nz;
        Nn[o] = nx;
        Nn[o + 1] = ny;
        Nn[o + 2] = nz;
      }
    }
    this.neckPos.needsUpdate = true;
    this.neckNor.needsUpdate = true;

    let idx = this.neckStart;
    let li = 0;
    for (let kk = 0; kk < VX_NECK_K; kk++) {
      const t = 0.1 + (0.8 * kk) / (VX_NECK_K - 1);
      this.curve.getPoint(t, _P);
      this.curve.getTangent(t, _T);
      _D.set(0, -_T.z, _T.y).normalize();
      const r = lerp(0.16, 0.075, t);
      for (const th of VX_NECK_ANG) {
        _N.copy(_D).multiplyScalar(Math.cos(th)).addScaledVector(X_AXIS, Math.sin(th));
        _dir.copy(_T).negate().addScaledVector(_N, 0.55); // vers le corps, décollée de la peau
        _pos.copy(_P).addScaledVector(_N, r - 0.01);
        this.lamelles.setMatrixAt(idx++, bladeMatrix(_m, _pos, _dir, _N, 0.065, this.neckLen[li++], 0.07));
      }
    }
    this.lamelles.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.kit.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Fabriques publiques

export function createSkarelModel(): CreatureModel {
  return new SkarelModel();
}

export function createTormaqModel(): CreatureModel {
  return new TormaqModel();
}

export function createVexilModel(): CreatureModel {
  return new VexilModel();
}
