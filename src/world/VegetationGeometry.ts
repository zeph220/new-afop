// Géométries procédurales de la flore de Veyra (designs originaux, voir docs/DESIGN.md §2.4).
// Chaque géométrie porte : color (sommets), aGlow (0..1 bioluminescence), aFlex (0..1 souplesse au vent).

import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  LatheGeometry,
  PlaneGeometry,
  QuadraticBezierCurve3,
  TubeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.ts';
import { COLONNIER, type VegLayerId } from './VegetationPlacement.ts';

type V3Fn<T> = (p: Vector3, n: Vector3) => T;
interface PartOpts {
  color: Color | V3Fn<Color>;
  glow?: number | V3Fn<number>;
  flex?: number | V3Fn<number>;
}

const C = (hex: string) => new Color(hex);
const tmpC = new Color();

/** Convertit en non indexé, retire les UV et ajoute color/aGlow/aFlex. */
function part(g: BufferGeometry, o: PartOpts): BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g;
  if (geo.getAttribute('uv')) geo.deleteAttribute('uv');
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const count = pos.count;
  const col = new Float32Array(count * 3);
  const glow = new Float32Array(count);
  const flex = new Float32Array(count);
  const p = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const c = typeof o.color === 'function' ? o.color(p, n) : o.color;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    glow[i] = typeof o.glow === 'function' ? o.glow(p, n) : (o.glow ?? 0);
    flex[i] = typeof o.flex === 'function' ? o.flex(p, n) : (o.flex ?? 0);
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setAttribute('aGlow', new Float32BufferAttribute(glow, 1));
  geo.setAttribute('aFlex', new Float32BufferAttribute(flex, 1));
  return geo;
}

function merge(parts: BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('fusion de géométrie impossible');
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Colonnier : tronc à côtes en spirale, ombrelles étagées, filaments ambrés.

export function colonnierGeometry(near: boolean): BufferGeometry {
  const H = COLONNIER.height;
  const parts: BufferGeometry[] = [];
  const bark1 = C('#3a2a22');
  const bark2 = C('#6e4c35');
  const moss = C('#2f4f35');

  const trunk = new CylinderGeometry(COLONNIER.trunkTop, COLONNIER.trunkBase, H + 4, near ? 10 : 5, near ? 12 : 1, true);
  trunk.translate(0, (H + 4) / 2 - 4, 0);
  if (near) {
    const pos = trunk.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.14 * Math.sin(a * 5 + y * 0.3);
      pos.setXYZ(i, x * k, y, z * k);
    }
    trunk.computeVertexNormals();
  }
  parts.push(
    part(trunk, {
      color: (p) => {
        const ridge = 0.5 + 0.5 * Math.sin(Math.atan2(p.z, p.x) * 5 + p.y * 0.3);
        tmpC.copy(bark1).lerp(bark2, near ? ridge : 0.5);
        if (p.y < 3) tmpC.lerp(moss, (3 - p.y) / 7);
        return tmpC;
      },
      flex: (p) => Math.pow(Math.max(0, p.y) / H, 2) * 0.1,
    }),
  );

  if (near) {
    // Contreforts racinaires.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const b = new ConeGeometry(1.0, 5.5, 4, 1);
      b.scale(0.32, 1, 1.5);
      b.translate(0, 2.75 - 1.2, 1.3);
      b.rotateY(a);
      parts.push(part(b, { color: bark1 }));
    }
  }

  const top = C('#2c5a46');
  const side = C('#5a4030');
  const under = C('#1b2627');
  for (const d of COLONNIER.discs) {
    const y = H * d.at;
    const g = new CylinderGeometry(d.r, d.r * 0.8, d.t, near ? 22 : 8, 1, false);
    g.translate(0, y, 0);
    parts.push(
      part(g, {
        color: (_p, n) => (n.y > 0.5 ? top : n.y < -0.5 ? under : side),
        glow: (p, n) => (n.y < -0.5 ? (near ? 0.12 : 0.3) : Math.abs(n.y) < 0.5 && p.y < y ? 0.25 : 0),
        flex: 0.04,
      }),
    );
    if (near) {
      const rand = mulberry32(Math.round(d.r * 100));
      const count = Math.round(d.r * 1.3);
      for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + rand() * 0.3;
        const len = 2.5 + rand() * 4;
        const f = new ConeGeometry(0.08, len, 3, 1, true);
        f.rotateX(Math.PI);
        const rr = d.r * (0.6 + rand() * 0.25);
        const yb = y - d.t / 2;
        f.translate(Math.cos(a) * rr, yb - len / 2, Math.sin(a) * rr);
        const amberA = C('#5a3a1f');
        const amberB = C('#ffb347');
        parts.push(
          part(f, {
            color: (p) => tmpC.copy(amberA).lerp(amberB, Math.min(1, (yb - p.y) / len)),
            glow: (p) => 0.25 + 0.75 * Math.min(1, (yb - p.y) / len),
            flex: (p) => 0.3 + 0.7 * Math.min(1, (yb - p.y) / len),
          }),
        );
      }
    }
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------
// Arqué : tronc courbé en arc, grappes de feuilles tombantes, nœuds violets.

export function arqueGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const curve = new QuadraticBezierCurve3(new Vector3(0, -1, 0), new Vector3(0.6, 8.5, 0), new Vector3(4.4, 11.5, 0));
  const seg = 9;
  const radial = 5;
  const tube = new TubeGeometry(curve, seg, 0.36, radial, false);
  const pos = tube.getAttribute('position');
  const c = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const t = ring / seg;
    curve.getPointAt(t, c);
    const k = 1 - 0.6 * t;
    pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
  }
  tube.computeVertexNormals();
  const b1 = C('#3f3946');
  const b2 = C('#6a6072');
  parts.push(part(tube, { color: (p) => tmpC.copy(b1).lerp(b2, Math.min(1, Math.max(0, p.y / 12))), flex: (p) => Math.pow(Math.max(0, p.y) / 12, 2) * 0.45 }));

  const leafA = C('#1c3a40');
  const leafB = C('#3d6b5c');
  const attach = [
    { t: 1.0, k: 1.15, dx: 0, dz: 0 },
    { t: 0.93, k: 0.9, dx: -0.8, dz: 1.1 },
    { t: 0.9, k: 0.85, dx: 0.4, dz: -1.2 },
    { t: 0.78, k: 0.8, dx: -0.6, dz: -0.9 },
    { t: 0.72, k: 0.7, dx: 0.7, dz: 1.0 },
    { t: 0.97, k: 0.75, dx: 1.3, dz: 0.2 },
  ];
  for (const a of attach) {
    curve.getPointAt(a.t, c);
    const cone = new ConeGeometry(1.35 * a.k, 3.0 * a.k, 6, 1, false);
    cone.translate(c.x + a.dx, c.y - 1.5 * a.k + 0.3, c.z + a.dz);
    const yTop = c.y + 0.3;
    parts.push(
      part(cone, {
        color: (p) => tmpC.copy(leafB).lerp(leafA, Math.min(1, (yTop - p.y) / (3 * a.k))),
        flex: (p) => 0.45 + 0.4 * Math.min(1, (yTop - p.y) / (3 * a.k)),
      }),
    );
  }
  const violet = C('#b48cff');
  for (const t of [0.38, 0.62, 0.86, 1.0]) {
    curve.getPointAt(t, c);
    const s = new IcosahedronGeometry(t === 1 ? 0.32 : 0.22, 0);
    s.translate(c.x, c.y, c.z);
    parts.push(part(s, { color: violet, glow: 1, flex: Math.pow(c.y / 12, 2) * 0.45 }));
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------
// Fougère-lanterne : rosette de frondes arquées autour d'un bulbe ambré.

export function fougereGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const rand = mulberry32(77);
  const green = C('#4d7a32');
  const tip = C('#9a6533');
  const L = 1.5;
  const fronds = 7;
  for (let f = 0; f < fronds; f++) {
    const g = new PlaneGeometry(1, 1, 1, 4).toNonIndexed();
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position');
    const phi0 = 0.3 + rand() * 0.25;
    const kappa = 0.9 + rand() * 0.4;
    const len = L * (0.75 + rand() * 0.35);
    const sArr = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i); // -0.5..0.5 (largeur)
      const s = (pos.getY(i) + 0.5) * len; // abscisse curviligne
      const w = 0.16 * (0.35 + 0.65 * Math.sin(Math.PI * Math.min(1, (s / len) * 1.05)));
      // φ mesuré depuis la verticale : ∫sin φ → horizontal, ∫cos φ → vertical
      const out = (Math.cos(phi0) - Math.cos(phi0 + kappa * s)) / kappa;
      pos.setXYZ(i, u * w * 2, verticalOf(phi0, kappa, s), out);
      sArr[i] = s / len;
    }
    g.rotateY((f / fronds) * Math.PI * 2 + rand() * 0.3);
    g.computeVertexNormals();
    const col = new Float32Array(pos.count * 3);
    const flex = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      tmpC.copy(green).lerp(tip, sArr[i] * sArr[i]);
      col.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
      flex[i] = sArr[i] * 0.7;
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    g.setAttribute('aGlow', new Float32BufferAttribute(new Float32Array(pos.count), 1));
    g.setAttribute('aFlex', new Float32BufferAttribute(flex, 1));
    parts.push(g);
  }
  const stalk = new CylinderGeometry(0.025, 0.04, 0.95, 4, 1, true);
  stalk.translate(0, 0.47, 0);
  parts.push(part(stalk, { color: C('#4a5a2a'), flex: (p) => p.y * 0.25 }));
  const bulb = new IcosahedronGeometry(0.15, 1);
  bulb.scale(1, 1.25, 1);
  bulb.translate(0, 1.0, 0);
  parts.push(part(bulb, { color: C('#ffc266'), glow: 1, flex: 0.25 }));
  return merge(parts);
}

/** Hauteur d'un point d'une fronde en arc de cercle (φ depuis la verticale). */
function verticalOf(phi0: number, kappa: number, s: number): number {
  return (Math.sin(phi0 + kappa * s) - Math.sin(phi0)) / kappa;
}

// ---------------------------------------------------------------------------------------------
// Lamelle : touffe de lames raides à pointe violette.

export function lamelleGeometry(): BufferGeometry {
  const rand = mulberry32(5);
  const positions: number[] = [];
  const colors: number[] = [];
  const glows: number[] = [];
  const flexes: number[] = [];
  const normals: number[] = [];
  const base = C('#2d5642');
  const mid = C('#5f985a');
  const tipC = C('#a774ee');
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + rand() * 0.6;
    const tilt = 0.12 + rand() * 0.38;
    const h = 0.45 + rand() * 0.35;
    const w = 0.035 + rand() * 0.02;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz;
    const pz = dx;
    const r0 = rand() * 0.12;
    const pt = (t: number, side: number) => {
      const lean = Math.sin(tilt) * h * Math.pow(t, 1.6);
      const width = w * (1 - t);
      return [dx * (r0 + lean) + px * width * side, h * t, dz * (r0 + lean) + pz * width * side];
    };
    const ts = [0, 0.55, 1];
    const verts = [pt(0, -1), pt(0, 1), pt(0.55, -1), pt(0.55, 1), pt(1, 0)];
    const tv = [0, 0, ts[1], ts[1], 1];
    const tris = [
      [0, 1, 2],
      [1, 3, 2],
      [2, 3, 4],
    ];
    for (const tri of tris) {
      for (const k of tri) {
        positions.push(...verts[k]);
        const t = tv[k];
        tmpC.copy(base).lerp(mid, Math.min(1, t * 1.6));
        if (t > 0.6) tmpC.lerp(tipC, (t - 0.6) / 0.4);
        colors.push(tmpC.r, tmpC.g, tmpC.b);
        glows.push(Math.pow(t, 3));
        flexes.push(t);
        normals.push(dx * 0.3, 1, dz * 0.3);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.normalizeNormals();
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.setAttribute('aGlow', new Float32BufferAttribute(glows, 1));
  g.setAttribute('aFlex', new Float32BufferAttribute(flexes, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Coupe-de-brume : bouquet de champignons en coupe évasée.

export function coupeGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const profile = [new Vector2(0.03, 0), new Vector2(0.2, 0.08), new Vector2(0.36, 0.2), new Vector2(0.43, 0.31)];
  const items = [
    { x: 0, z: 0, h: 0.62, s: 1 },
    { x: 0.32, z: 0.18, h: 0.4, s: 0.7 },
    { x: -0.25, z: 0.28, h: 0.86, s: 1.2 },
    { x: 0.05, z: -0.34, h: 0.3, s: 0.55 },
  ];
  const stalkC = C('#c8b8de');
  const capOut = C('#7e5fb0');
  const capIn = C('#d9c2ff');
  for (const it of items) {
    const st = new CylinderGeometry(0.03 * it.s, 0.045 * it.s, it.h, 4, 1, true);
    st.translate(it.x, it.h / 2, it.z);
    parts.push(part(st, { color: stalkC, glow: 0.1, flex: (p) => (p.y / 1.2) * 0.3 }));
    const cap = new LatheGeometry(profile, 7);
    cap.scale(it.s, it.s, it.s);
    cap.translate(it.x, it.h - 0.02, it.z);
    parts.push(
      part(cap, {
        color: (_p, n) => (n.y > 0.2 ? capIn : capOut),
        glow: (_p, n) => (n.y > 0.2 ? 0.95 : 0.45),
        flex: 0.3,
      }),
    );
  }
  return merge(parts);
}

// ---------------------------------------------------------------------------------------------
// Bloc : rocher arrondi, moussu sur le dessus.

export function blocGeometry(): BufferGeometry {
  const g = new IcosahedronGeometry(1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const r = 1 + 0.16 * Math.sin(3.1 * x + 1) * Math.sin(2.3 * y + 2) * Math.sin(2.7 * z) + 0.07 * Math.sin(7.3 * x + 3.1 * z);
    pos.setXYZ(i, x * r, y * r * 0.66 + 0.22, z * r);
  }
  g.computeVertexNormals();
  const rock = C('#5b5e67');
  const rock2 = C('#77716a');
  const mossC = C('#33553a');
  return part(g, {
    color: (p, n) => {
      tmpC.copy(rock).lerp(rock2, 0.5 + 0.5 * Math.sin(p.x * 4 + p.z * 3));
      if (n.y > 0.55) tmpC.lerp(mossC, Math.min(1, (n.y - 0.55) * 3));
      return tmpC;
    },
  });
}

export function geometryFor(id: VegLayerId, near = true): BufferGeometry {
  switch (id) {
    case 'colonnier':
      return colonnierGeometry(near);
    case 'arque':
      return arqueGeometry();
    case 'fougere':
      return fougereGeometry();
    case 'lamelle':
      return lamelleGeometry();
    case 'coupe':
      return coupeGeometry();
    case 'bloc':
      return blocGeometry();
  }
}
