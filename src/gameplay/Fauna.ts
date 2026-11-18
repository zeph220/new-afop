// Faune sauvage aléatoire et diversifiée : apparition par habitat, perception (vue, bruit, odeur
// portée par le vent), comportements (fuite, troupeau, territoire, meute, embuscade, vol, carapace),
// dégâts, mort et dépouille à récolter. Les corps sont procéduraux ; un modèle glTF animé peut
// les remplacer espèce par espèce via public/models/fauna/manifest.json.

import {
  AnimationMixer,
  Box3,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  Group,
  LoopOnce,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
  type AnimationAction,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { forestDensity, groundHeight, sampleWorld, createSample, WATER_LEVEL, LANDMARKS } from '../world/WorldGen.ts';
import { hash2 } from '../world/noise.ts';
import { WIND } from '../world/Wind.ts';
import type { LootTable } from './Items.ts';

export type Temperament = 'proie' | 'territorial' | 'predateur' | 'volant' | 'carapace' | 'fouisseur';
export type FaunaKind = 'ruminel' | 'cornard' | 'fouisseur' | 'griffal' | 'rodeur' | 'echassier' | 'nuee' | 'carapace';

export interface FaunaDef {
  kind: FaunaKind;
  name: string;
  temper: Temperament;
  hp: number;
  height: number; // hauteur au garrot (m)
  length: number;
  radius: number; // rayon de collision
  walk: number;
  run: number;
  sense: number; // rayon de perception de base (m)
  bite?: number; // dégâts par attaque
  group: [number, number];
  loot: LootTable;
  color: [number, number, number];
  belly: [number, number, number];
  sound: 'growl' | 'bleat' | 'chirp' | 'squeal';
  plan: 'quadrupede' | 'oiseau' | 'echassier' | 'carapace';
  horns?: boolean;
  /** Poids d'habitat (0 = absent). */
  habitat: (h: Habitat) => number;
}

export interface Habitat {
  forest: number;
  water: number; // proximité de l'eau 0..1
  mesa: number;
  canyon: number;
  night: number;
  height: number;
}

export const FAUNA: Record<FaunaKind, FaunaDef> = {
  ruminel: {
    kind: 'ruminel', name: 'Ruminel', temper: 'proie', hp: 60, height: 1.25, length: 1.7, radius: 0.7, walk: 1.6, run: 13, sense: 34,
    group: [3, 7], sound: 'bleat', plan: 'quadrupede',
    loot: [['viande', 2, 3, 1], ['peau', 1, 2, 1], ['os', 1, 2, 0.8]],
    color: [0.42, 0.3, 0.2], belly: [0.75, 0.68, 0.55],
    habitat: (h) => (0.4 + h.forest * 0.6) * (1 - h.canyon) * (h.water > 0.8 ? 0.3 : 1),
  },
  cornard: {
    kind: 'cornard', name: 'Cornard', temper: 'territorial', hp: 240, height: 1.9, length: 3.0, radius: 1.3, walk: 1.3, run: 10, sense: 26, bite: 24,
    group: [1, 3], sound: 'growl', plan: 'quadrupede', horns: true,
    loot: [['viande', 4, 6, 1], ['peau', 2, 4, 1], ['os', 2, 4, 1]],
    color: [0.24, 0.2, 0.17], belly: [0.4, 0.34, 0.28],
    habitat: (h) => (0.3 + h.water * 0.7) * (1 - h.forest * 0.5) + h.mesa * 0.6,
  },
  fouisseur: {
    kind: 'fouisseur', name: 'Fouisseur', temper: 'fouisseur', hp: 14, height: 0.32, length: 0.5, radius: 0.3, walk: 1.2, run: 9, sense: 14,
    group: [2, 4], sound: 'squeal', plan: 'quadrupede',
    loot: [['viande', 1, 1, 1], ['peau', 1, 1, 0.7]],
    color: [0.5, 0.42, 0.3], belly: [0.8, 0.74, 0.62],
    habitat: (h) => 0.5 + h.mesa * 0.5 + (1 - h.forest) * 0.4,
  },
  griffal: {
    kind: 'griffal', name: 'Griffal', temper: 'predateur', hp: 70, height: 0.95, length: 1.6, radius: 0.6, walk: 2.2, run: 12.5, sense: 42, bite: 11,
    group: [3, 5], sound: 'growl', plan: 'quadrupede',
    loot: [['peau', 1, 2, 1], ['os', 1, 3, 1], ['viande', 1, 1, 0.6]],
    color: [0.23, 0.24, 0.26], belly: [0.45, 0.45, 0.47],
    habitat: (h) => (0.2 + h.forest * 0.6 + h.night * 0.8) * (1 - h.water * 0.5),
  },
  rodeur: {
    kind: 'rodeur', name: 'Rôdeur des cimes', temper: 'predateur', hp: 160, height: 1.15, length: 2.3, radius: 0.85, walk: 1.8, run: 14, sense: 48, bite: 24,
    group: [1, 1], sound: 'growl', plan: 'quadrupede',
    loot: [['peau', 2, 4, 1], ['os', 2, 3, 1], ['viande', 2, 3, 1]],
    color: [0.16, 0.14, 0.13], belly: [0.3, 0.27, 0.24],
    habitat: (h) => (h.forest * 0.5 + h.canyon * 0.6 + h.night * 0.4) * 0.45,
  },
  echassier: {
    kind: 'echassier', name: 'Échassier gris', temper: 'volant', hp: 18, height: 1.3, length: 0.9, radius: 0.45, walk: 0.9, run: 4, sense: 30,
    group: [1, 4], sound: 'chirp', plan: 'echassier',
    loot: [['plume', 2, 4, 1], ['viande', 1, 1, 0.7]],
    color: [0.62, 0.64, 0.66], belly: [0.88, 0.88, 0.86],
    habitat: (h) => (h.water > 0.4 ? 1.4 * h.water : 0),
  },
  nuee: {
    kind: 'nuee', name: 'Passereau des brumes', temper: 'volant', hp: 6, height: 0.18, length: 0.22, radius: 0.25, walk: 0.6, run: 3, sense: 16,
    group: [4, 7], sound: 'chirp', plan: 'oiseau',
    loot: [['plume', 1, 2, 1]],
    color: [0.35, 0.3, 0.24], belly: [0.7, 0.6, 0.45],
    habitat: (h) => 0.6 + h.forest * 0.3,
  },
  carapace: {
    kind: 'carapace', name: 'Dos-de-pierre', temper: 'carapace', hp: 130, height: 0.75, length: 1.4, radius: 0.75, walk: 0.8, run: 2.2, sense: 7,
    group: [1, 2], sound: 'squeal', plan: 'carapace',
    loot: [['os', 2, 4, 1], ['viande', 2, 3, 1], ['pierre', 1, 2, 0.5]],
    color: [0.4, 0.38, 0.34], belly: [0.55, 0.5, 0.42],
    habitat: (h) => 0.35 + h.canyon * 0.8 + h.mesa * 0.3,
  },
};

export const FAUNA_KINDS = Object.keys(FAUNA) as FaunaKind[];

// ---------------------------------------------------------------------------------------------
// Corps (procédural ou glTF)

export interface FaunaBody {
  root: Group;
  /** speed : vitesse au sol ; mode : état d'animation. */
  update(dt: number, speed: number, mode: AnimMode, t: number): void;
  dispose(): void;
}
export type AnimMode = 'idle' | 'walk' | 'run' | 'attack' | 'dead' | 'fly' | 'curl' | 'graze';

const geoCache = new Map<string, BufferGeometry>();
function geo(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

function mat(c: [number, number, number], rough = 0.85): MeshStandardMaterial {
  return new MeshStandardMaterial({ color: new Color(...c), roughness: rough, metalness: 0 });
}

function part(g: BufferGeometry, m: MeshStandardMaterial, parent: Object3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh {
  const mesh = new Mesh(g, m);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function proceduralBody(d: FaunaDef, seed: number): FaunaBody {
  const root = new Group();
  const body = new Group();
  root.add(body);
  const tint = 0.85 + 0.3 * seed;
  const coat = mat([d.color[0] * tint, d.color[1] * tint, d.color[2] * tint]);
  const belly = mat(d.belly);
  const dark = mat([0.05, 0.045, 0.04], 0.5);
  const sphere = geo('sph', () => new SphereGeometry(0.5, 16, 12));
  const cap = geo('cap', () => new CapsuleGeometry(0.5, 1, 6, 10));
  const cone = geo('cone', () => new ConeGeometry(0.5, 1, 10));
  const H = d.height;
  const L = d.length;
  const legs: Group[] = [];
  const wings: Group[] = [];
  let head: Object3D | null = null;
  let tail: Object3D | null = null;
  let shell: Mesh | null = null;

  if (d.plan === 'quadrupede' || d.plan === 'carapace') {
    const bh = d.plan === 'carapace' ? H * 0.55 : H * 0.42;
    const by = d.plan === 'carapace' ? H * 0.55 : H * 0.78;
    part(cap, coat, body, 0, by, 0, bh * 1.05, L * 0.5, bh).rotation.x = Math.PI / 2;
    part(sphere, belly, body, 0, by - bh * 0.25, 0, bh * 0.9, bh * 0.7, L * 0.7);
    if (d.plan === 'carapace') {
      shell = part(sphere, mat([0.36, 0.34, 0.3], 0.95), body, 0, by + bh * 0.15, 0, bh * 2.4, bh * 1.6, L * 1.05);
    }
    // Cou et tête
    const neck = new Group();
    neck.position.set(0, by + bh * 0.25, -L * 0.42);
    body.add(neck);
    part(cap, coat, neck, 0, H * 0.12, -H * 0.06, H * 0.13, H * 0.22, H * 0.13).rotation.x = -0.7;
    const hd = new Group();
    hd.position.set(0, H * 0.26, -H * 0.2);
    neck.add(hd);
    part(sphere, coat, hd, 0, 0, 0, H * 0.24, H * 0.22, H * 0.3);
    part(cap, coat, hd, 0, -H * 0.04, -H * 0.2, H * 0.12, H * 0.12, H * 0.14).rotation.x = Math.PI / 2;
    part(sphere, dark, hd, H * 0.08, H * 0.04, -H * 0.1, H * 0.035, H * 0.035, H * 0.035);
    part(sphere, dark, hd, -H * 0.08, H * 0.04, -H * 0.1, H * 0.035, H * 0.035, H * 0.035);
    part(cone, coat, hd, H * 0.08, H * 0.13, H * 0.03, H * 0.06, H * 0.14, H * 0.04);
    part(cone, coat, hd, -H * 0.08, H * 0.13, H * 0.03, H * 0.06, H * 0.14, H * 0.04);
    if (d.horns) {
      const horn = mat([0.82, 0.78, 0.66], 0.6);
      const h1 = part(cone, horn, hd, H * 0.13, H * 0.1, -H * 0.05, H * 0.07, H * 0.45, H * 0.07);
      h1.rotation.set(-0.9, 0, -0.5);
      const h2 = part(cone, horn, hd, -H * 0.13, H * 0.1, -H * 0.05, H * 0.07, H * 0.45, H * 0.07);
      h2.rotation.set(-0.9, 0, 0.5);
    }
    head = neck;
    // Pattes (hanche → genou → sabot)
    const legH = by - bh * 0.4;
    for (const [lx, lz] of [[1, -1], [-1, -1], [1, 1], [-1, 1]]) {
      const hip = new Group();
      hip.position.set(lx * bh * 0.55, by - bh * 0.2, lz * L * 0.33);
      body.add(hip);
      part(cap, coat, hip, 0, -legH * 0.25, 0, H * 0.09, legH * 0.42, H * 0.09);
      const knee = new Group();
      knee.position.set(0, -legH * 0.5, 0);
      hip.add(knee);
      part(cap, coat, knee, 0, -legH * 0.25, 0, H * 0.06, legH * 0.42, H * 0.06);
      part(sphere, dark, knee, 0, -legH * 0.5, 0, H * 0.08, H * 0.05, H * 0.09);
      legs.push(hip);
    }
    const tl = new Group();
    tl.position.set(0, by + bh * 0.1, L * 0.5);
    body.add(tl);
    part(cone, coat, tl, 0, -H * 0.05, H * 0.15, H * 0.08, H * 0.4, H * 0.08).rotation.x = 1.9;
    tail = tl;
  } else if (d.plan === 'oiseau' || d.plan === 'echassier') {
    const wader = d.plan === 'echassier';
    const by = wader ? H * 0.62 : H * 0.6;
    const bs = wader ? H * 0.22 : H * 0.55;
    part(sphere, coat, body, 0, by, 0, bs, bs * 0.9, bs * 1.6);
    part(sphere, belly, body, 0, by - bs * 0.2, -bs * 0.1, bs * 0.8, bs * 0.6, bs * 1.2);
    const neck = new Group();
    neck.position.set(0, by + bs * 0.3, -bs * 0.6);
    body.add(neck);
    if (wader) part(cap, coat, neck, 0, H * 0.12, 0, H * 0.04, H * 0.25, H * 0.04);
    const hd = part(sphere, coat, neck, 0, wader ? H * 0.28 : bs * 0.4, -bs * 0.2, bs * 0.5, bs * 0.5, bs * 0.6);
    part(cone, mat([0.75, 0.6, 0.25], 0.5), hd, 0, 0, -0.9, 0.35, wader ? 2.2 : 0.8, 0.35).rotation.x = -Math.PI / 2;
    head = neck;
    for (const s of [1, -1]) {
      const w = new Group();
      w.position.set(s * bs * 0.8, by + bs * 0.3, 0);
      body.add(w);
      part(sphere, coat, w, s * bs * 1.3, 0, 0, bs * 1.6, bs * 0.12, bs * 0.9);
      wings.push(w);
    }
    if (wader) {
      for (const s of [1, -1]) {
        const hip = new Group();
        hip.position.set(s * bs * 0.4, by - bs * 0.5, 0);
        body.add(hip);
        part(cap, mat([0.55, 0.45, 0.3]), hip, 0, -by * 0.45, 0, H * 0.025, by * 0.85, H * 0.025);
        legs.push(hip);
      }
    }
    const tl = new Group();
    tl.position.set(0, by, bs * 1.4);
    body.add(tl);
    part(sphere, coat, tl, 0, 0, bs * 0.4, bs * 0.6, bs * 0.1, bs * 0.9);
    tail = tl;
  }

  let phase = seed * 10;
  let deadT = 0;
  return {
    root,
    update(dt, speed, mode, t) {
      const stride = Math.max(0.6, d.length * 0.9);
      phase += (speed / stride) * dt * Math.PI * 2 + (mode === 'idle' || mode === 'graze' ? 0 : 0);
      const amp = Math.min(0.75, speed / Math.max(1, d.walk * 2)) * (mode === 'run' ? 1 : 0.6);
      legs.forEach((leg, i) => {
        const off = i === 0 || i === 3 ? 0 : Math.PI;
        leg.rotation.x = Math.sin(phase + off) * amp;
        const knee = leg.children[1] as Object3D | undefined;
        if (knee) knee.rotation.x = Math.max(0, -Math.sin(phase + off + 0.6)) * amp * 1.2;
      });
      body.position.y = Math.abs(Math.sin(phase)) * amp * 0.06 * d.height;
      if (head) head.rotation.x = mode === 'graze' ? 1.1 + 0.1 * Math.sin(t * 2) : mode === 'attack' ? 0.5 : mode === 'run' ? 0.25 : 0.05 * Math.sin(t * 0.7 + seed);
      if (tail) tail.rotation.y = Math.sin(t * 3 + seed) * 0.3;
      const flapping = mode === 'fly';
      wings.forEach((w, i) => {
        const s = i === 0 ? 1 : -1;
        w.rotation.z = flapping ? s * Math.sin(t * (d.plan === 'oiseau' ? 22 : 7)) * 0.9 : s * -0.1;
      });
      if (shell) {
        const c = mode === 'curl' ? 1 : 0;
        body.scale.y += ((1 - c * 0.35) - body.scale.y) * Math.min(1, dt * 6);
      }
      if (mode === 'dead') {
        deadT = Math.min(1, deadT + dt * 2);
        root.rotation.z = (Math.PI / 2) * deadT;
      } else root.rotation.z = 0;
    },
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) (m.material as MeshStandardMaterial).dispose();
      });
    },
  };
}

// --- Modèles glTF optionnels -----------------------------------------------------------------

interface ManifestEntry {
  file: string;
  scale: number;
  yOffset?: number;
  rotY?: number;
  clips?: Partial<Record<AnimMode, string>>;
}
type Template = { scene: Object3D; animations: import('three').AnimationClip[]; entry: ManifestEntry };
const templates = new Map<FaunaKind, Template>();
let manifestLoading: Promise<void> | null = null;

/** Charge (une fois) les modèles glTF déclarés dans public/models/fauna/manifest.json. */
export function loadFaunaModels(baseUrl: string): Promise<void> {
  if (manifestLoading) return manifestLoading;
  manifestLoading = (async () => {
    let manifest: Record<string, ManifestEntry>;
    try {
      const r = await fetch(`${baseUrl}manifest.json`);
      if (!r.ok) return;
      manifest = await r.json();
    } catch {
      return;
    }
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    await Promise.all(
      Object.entries(manifest).map(async ([kind, entry]) => {
        if (!(kind in FAUNA)) return;
        try {
          const g = await loader.loadAsync(baseUrl + entry.file);
          g.scene.traverse((o) => {
            const m = o as Mesh;
            if (m.isMesh) m.castShadow = true;
          });
          templates.set(kind as FaunaKind, { scene: g.scene, animations: g.animations, entry });
        } catch (e) {
          console.warn('Modèle de faune illisible :', kind, e);
        }
      }),
    );
  })();
  return manifestLoading;
}

async function cloneSkinned(o: Object3D): Promise<Object3D> {
  const { clone } = await import('three/examples/jsm/utils/SkeletonUtils.js');
  return clone(o);
}

function gltfBody(t: Template, d: FaunaDef, fallback: FaunaBody): FaunaBody {
  // Le corps procédural sert le temps que le clone glTF soit prêt.
  const root = fallback.root;
  let mixer: AnimationMixer | null = null;
  const actions = new Map<AnimMode, AnimationAction>();
  let current: AnimationAction | null = null;
  let ready = false;
  void cloneSkinned(t.scene).then((model) => {
    model.rotation.y = t.entry.rotY ?? 0;
    if (t.entry.scale > 0) {
      model.scale.setScalar(t.entry.scale);
      model.position.y = t.entry.yOffset ?? 0;
    } else {
      // Échelle automatique : la hauteur du modèle est ramenée à celle de l'espèce, pieds au sol.
      model.updateMatrixWorld(true);
      const box = new Box3().setFromObject(model);
      const h = Math.max(1e-3, box.max.y - box.min.y);
      const k = (d.height * (d.plan === 'quadrupede' ? 1.25 : 1.1)) / h;
      model.scale.multiplyScalar(k);
      model.position.y = -box.min.y * k;
    }
    for (const c of [...root.children]) c.visible = false;
    root.add(model);
    mixer = new AnimationMixer(model);
    const find = (name?: string) => (name ? t.animations.find((a) => a.name === name) : undefined);
    for (const mode of ['idle', 'walk', 'run', 'attack', 'dead', 'fly', 'curl', 'graze'] as AnimMode[]) {
      const clip = find(t.entry.clips?.[mode]) ?? (mode === 'graze' || mode === 'curl' ? find(t.entry.clips?.idle) : undefined);
      if (clip) {
        const a = mixer.clipAction(clip);
        if (mode === 'dead' || mode === 'attack') {
          a.setLoop(LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        actions.set(mode, a);
      }
    }
    ready = true;
  });
  return {
    root,
    update(dt, speed, mode, time) {
      if (!ready) return fallback.update(dt, speed, mode, time);
      const a = actions.get(mode) ?? actions.get(mode === 'run' ? 'walk' : 'idle') ?? null;
      if (a && a !== current) {
        a.reset().fadeIn(0.25).play();
        current?.fadeOut(0.25);
        current = a;
      }
      if (a && (mode === 'walk' || mode === 'run')) a.timeScale = Math.max(0.4, speed / (mode === 'run' ? d.run : d.walk));
      // Modèle à animation unique (marche) : presque figé à l'arrêt.
      else if (a && a === actions.get('walk')) a.timeScale = 0.08;
      else if (a) a.timeScale = 1;
      mixer?.update(dt);
      if (!actions.has('dead') && mode === 'dead') root.rotation.z = Math.min(Math.PI / 2, root.rotation.z + dt * 3);
    },
    dispose() {
      mixer?.stopAllAction();
      fallback.dispose();
    },
  };
}

function makeBody(d: FaunaDef, seed: number): FaunaBody {
  const base = proceduralBody(d, seed);
  const t = templates.get(d.kind);
  return t ? gltfBody(t, d, base) : base;
}

// ---------------------------------------------------------------------------------------------
// Animal

export type AIState = 'calme' | 'broute' | 'erre' | 'fuite' | 'alerte' | 'traque' | 'charge' | 'retraite' | 'envol' | 'repli' | 'mort';

let nextId = 1;

export class Animal {
  readonly id = nextId++;
  readonly def: FaunaDef;
  readonly pos = new Vector3();
  readonly body: FaunaBody;
  readonly group: number;
  yaw = 0;
  speed = 0;
  hp: number;
  state: AIState = 'calme';
  stateT = 0;
  target = new Vector3();
  altitude = 0; // oiseaux
  attackCd = 0;
  looted = false;
  deadT = 0;
  hitFlash = 0;
  aggressive = false;
  rnd: () => number;
  private seed: number;

  constructor(def: FaunaDef, x: number, z: number, group: number, seed: number) {
    this.def = def;
    this.group = group;
    this.hp = def.hp;
    this.seed = seed;
    let s = Math.floor(seed * 1e9) || 1;
    this.rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    this.pos.set(x, groundHeight(x, z), z);
    this.yaw = this.rnd() * Math.PI * 2;
    this.body = makeBody(def, seed);
    this.target.copy(this.pos);
  }

  get alive(): boolean {
    return this.state !== 'mort';
  }

  get center(): Vector3 {
    return _c.set(this.pos.x, this.pos.y + this.def.height * 0.6 + this.altitude, this.pos.z);
  }

  setState(s: AIState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateT = 0;
  }

  sync(dt: number, t: number): void {
    const r = this.body.root;
    r.position.set(this.pos.x, this.pos.y + this.altitude, this.pos.z);
    r.rotation.y = this.yaw;
    const mode: AnimMode =
      this.state === 'mort' ? 'dead'
      : this.altitude > 0.5 ? 'fly'
      : this.state === 'repli' ? 'curl'
      : this.state === 'broute' ? 'graze'
      : this.attackCd > 0.9 ? 'attack'
      : this.speed > this.def.walk * 1.8 ? 'run'
      : this.speed > 0.15 ? 'walk'
      : 'idle';
    this.body.update(dt, this.speed, mode, t + this.seed * 10);
  }
}

const _c = new Vector3();
const _d = new Vector3();

export interface FaunaContext {
  player: Vector3;
  crouching: boolean;
  sprinting: boolean;
  /** Le joueur est à l'abri dans un véhicule. */
  sheltered: boolean;
  night: number;
  time: number;
  /** Corps rapides (véhicules) qui écrasent la faune. */
  movers: { pos: Vector3; speed: number; radius: number }[];
}

export interface FaunaEvents {
  onPlayerHit?(dmg: number, from: Animal): void;
  onSound?(kind: FaunaDef['sound'] | 'death', gain: number): void;
  onKill?(a: Animal, cause: string): void;
}

interface FearZone {
  x: number;
  z: number;
  r: number;
  until: number;
}

const CELL = 112;

export class FaunaManager {
  readonly animals: Animal[] = [];
  events: FaunaEvents = {};
  maxAlive = 38;
  private add: (o: Object3D) => void;
  private remove: (o: Object3D) => void;
  private visited = new Set<string>();
  private spawnTimer = 0;
  private fears: FearZone[] = [];
  private groupSeq = 1;
  private sample = createSample();
  private time = 0;

  constructor(add: (o: Object3D) => void, remove: (o: Object3D) => void) {
    this.add = add;
    this.remove = remove;
  }

  habitatAt(x: number, z: number, night: number): Habitat {
    const s = sampleWorld(x, z, this.sample);
    return {
      forest: forestDensity(x, z, s),
      water: Math.max(s.river, s.bank, s.h < WATER_LEVEL + 2 ? 1 : 0),
      mesa: s.mesa,
      canyon: s.canyon,
      night,
      height: s.h,
    };
  }

  /** Une zone de peur (feu, fusée, flèche enflammée) fait fuir la faune. */
  scare(x: number, z: number, r: number, seconds: number): void {
    this.fears.push({ x, z, r, until: this.time + seconds });
  }

  private spawnAround(ctx: FaunaContext): void {
    const epoch = Math.floor(ctx.time / 300); // la faune se renouvelle toutes les 5 minutes
    const p = ctx.player;
    const R = 260;
    const c0x = Math.floor((p.x - R) / CELL);
    const c1x = Math.floor((p.x + R) / CELL);
    const c0z = Math.floor((p.z - R) / CELL);
    const c1z = Math.floor((p.z + R) / CELL);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        if (this.animals.length >= this.maxAlive) return;
        const key = `${cx},${cz},${epoch}`;
        if (this.visited.has(key)) continue;
        const x = (cx + 0.2 + 0.6 * hash2(cx * 7 + epoch, cz * 13, 11)) * CELL;
        const z = (cz + 0.2 + 0.6 * hash2(cx * 3, cz * 5 + epoch, 17)) * CELL;
        const dist = Math.hypot(x - p.x, z - p.z);
        if (dist > R) continue;
        this.visited.add(key);
        if (dist < 75) continue; // jamais sous les yeux du joueur
        if (groundHeight(x, z) < WATER_LEVEL + 0.2 && hash2(cx, cz, 5) > 0.3) continue;
        if (LANDMARKS.some((l) => Math.hypot(l.x - x, l.z - z) < 90)) continue;
        if (hash2(cx + epoch * 31, cz, 23) > 0.62) continue; // cellules vides
        const hab = this.habitatAt(x, z, ctx.night);
        // Tirage pondéré de l'espèce.
        const weights = FAUNA_KINDS.map((k) => Math.max(0, FAUNA[k].habitat(hab)));
        const total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) continue;
        let r = hash2(cx * 17 + epoch, cz * 29, 31) * total;
        let kind = FAUNA_KINDS[0];
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            kind = FAUNA_KINDS[i];
            break;
          }
        }
        this.spawnGroup(kind, x, z, hash2(cx, cz + epoch, 41));
      }
    }
  }

  spawnGroup(kind: FaunaKind, x: number, z: number, seed: number): Animal[] {
    const d = FAUNA[kind];
    const n = d.group[0] + Math.floor(seed * (d.group[1] - d.group[0] + 1));
    const gid = this.groupSeq++;
    const out: Animal[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed * 6;
      const r = d.radius * 3 + seed * 6 + i * 0.7;
      const ax = x + Math.cos(a) * r;
      const az = z + Math.sin(a) * r;
      const an = new Animal(d, ax, az, gid, (seed * 997 + i * 0.137) % 1);
      an.aggressive = d.temper === 'predateur' && an.rnd() < 0.75;
      this.animals.push(an);
      this.add(an.body.root);
      out.push(an);
    }
    return out;
  }

  /** Inflige des dégâts ; retourne true si l'animal meurt. */
  damage(a: Animal, amount: number, from: Vector3, cause = 'arme'): boolean {
    if (!a.alive) return false;
    const dmg = a.state === 'repli' ? amount * 0.15 : amount;
    a.hp -= dmg;
    a.hitFlash = 0.2;
    if (a.hp <= 0) {
      a.hp = 0;
      a.setState('mort');
      a.speed = 0;
      a.altitude = Math.max(0, a.altitude);
      this.events.onSound?.('death', 0.8);
      this.events.onKill?.(a, cause);
      return true;
    }
    const t = a.def.temper;
    if (t === 'carapace') a.setState('repli');
    else if (t === 'territorial' || (t === 'predateur' && a.hp > a.def.hp * 0.3)) {
      a.setState('charge');
      for (const o of this.animals) if (o.group === a.group && o.alive && o !== a) o.setState('charge');
    } else this.flee(a, from);
    return false;
  }

  private flee(a: Animal, from: Vector3): void {
    if (a.def.temper === 'volant') {
      a.setState('envol');
    } else a.setState('fuite');
    const dx = a.pos.x - from.x;
    const dz = a.pos.z - from.z;
    const l = Math.hypot(dx, dz) || 1;
    const dist = a.def.temper === 'volant' ? 120 : 60 + a.rnd() * 40;
    a.target.set(a.pos.x + (dx / l) * dist + (a.rnd() - 0.5) * 30, 0, a.pos.z + (dz / l) * dist + (a.rnd() - 0.5) * 30);
    // L'alarme se propage au troupeau.
    for (const o of this.animals) {
      if (o.group !== a.group || o === a || !o.alive || o.state === 'fuite' || o.state === 'envol') continue;
      if (o.pos.distanceToSquared(a.pos) < 900) this.flee(o, from);
    }
  }

  /** Premier animal touché par le segment p0→p1. */
  raycast(p0: Vector3, p1: Vector3, includeDead = false): Animal | null {
    _d.subVectors(p1, p0);
    const len = _d.length();
    if (len < 1e-6) return null;
    _d.divideScalar(len);
    let best: Animal | null = null;
    let bt = Infinity;
    for (const a of this.animals) {
      if (!includeDead && !a.alive) continue;
      const c = a.center;
      const r = a.def.radius + 0.15;
      const ox = c.x - p0.x;
      const oy = c.y - p0.y;
      const oz = c.z - p0.z;
      const t = Math.max(0, Math.min(len, ox * _d.x + oy * _d.y + oz * _d.z));
      const qx = p0.x + _d.x * t - c.x;
      const qy = p0.y + _d.y * t - c.y;
      const qz = p0.z + _d.z * t - c.z;
      if (qx * qx + qy * qy + qz * qz < r * r && t < bt) {
        bt = t;
        best = a;
      }
    }
    return best;
  }

  /** Animaux vivants dans un cône (pulseur, coup de lance). */
  inCone(origin: Vector3, dir: Vector3, range: number, halfAngle: number): Animal[] {
    const cos = Math.cos(halfAngle);
    return this.animals.filter((a) => {
      if (!a.alive) return false;
      const c = a.center;
      _d.subVectors(c, origin);
      const l = _d.length();
      if (l > range + a.def.radius) return false;
      if (l < a.def.radius + 0.5) return true;
      return _d.divideScalar(l).dot(dir) > cos;
    });
  }

  nearestCarcass(p: Vector3, r: number): Animal | null {
    let best: Animal | null = null;
    let bd = r * r;
    for (const a of this.animals) {
      if (a.alive || a.looted) continue;
      const d = a.pos.distanceToSquared(p);
      if (d < bd) {
        bd = d;
        best = a;
      }
    }
    return best;
  }

  update(dt: number, ctx: FaunaContext): void {
    this.time = ctx.time;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 1.5;
      this.spawnAround(ctx);
      this.fears = this.fears.filter((f) => f.until > this.time);
      if (this.visited.size > 4000) this.visited.clear();
    }
    const p = ctx.player;
    for (let i = this.animals.length - 1; i >= 0; i--) {
      const a = this.animals[i];
      const dist = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      const gone = dist > 330 || (a.state === 'mort' && a.deadT > (a.looted ? 25 : 300)) || (a.def.temper === 'fouisseur' && a.state === 'fuite' && a.stateT > 5);
      if (gone) {
        this.remove(a.body.root);
        a.body.dispose();
        this.animals.splice(i, 1);
        continue;
      }
      a.body.root.visible = dist < 300;
      // Mise à jour réduite au loin.
      if (dist > 160 && (a.id + Math.floor(ctx.time * 60)) % 3 !== 0) continue;
      const h = dist > 160 ? dt * 3 : dt;
      this.think(a, h, ctx, dist);
      if (a.body.root.visible) a.sync(h, ctx.time);
    }
  }

  private perception(a: Animal, ctx: FaunaContext, dist: number): number {
    const d = a.def;
    let r = d.sense;
    if (ctx.crouching) r *= 0.5;
    if (ctx.sprinting) r *= 1.5;
    if (d.temper === 'predateur') r *= 1 + ctx.night * 0.3;
    else r *= 1 - ctx.night * 0.25;
    // Odeur : le vent porte l'odeur du joueur vers l'animal (ou l'éloigne).
    if (dist > 0.1) {
      const dx = (a.pos.x - ctx.player.x) / dist;
      const dz = (a.pos.z - ctx.player.z) / dist;
      const down = dx * WIND.dir.x + dz * WIND.dir.z; // >0 : l'animal est sous le vent du joueur
      r *= 1 + down * Math.min(1, WIND.strength * 1.6) * 0.7;
    }
    if (ctx.sheltered) r *= 0.6;
    return r;
  }

  private think(a: Animal, dt: number, ctx: FaunaContext, dist: number): void {
    const d = a.def;
    a.stateT += dt;
    a.attackCd = Math.max(0, a.attackCd - dt);
    a.hitFlash = Math.max(0, a.hitFlash - dt);
    if (a.state === 'mort') {
      a.deadT += dt;
      if (a.altitude > 0) a.altitude = Math.max(0, a.altitude - dt * 9);
      if (a.looted && a.deadT > 20) a.pos.y -= dt * 0.3;
      return;
    }
    // Écrasement par les véhicules.
    for (const m of ctx.movers) {
      if (m.speed > 5 && m.pos.distanceTo(a.pos) < m.radius + d.radius) {
        this.damage(a, m.speed * 7, m.pos, 'vehicule');
        if (!a.alive) return;
      }
    }
    // Peur (feu, fusée).
    for (const f of this.fears) {
      if (Math.hypot(a.pos.x - f.x, a.pos.z - f.z) < f.r && a.state !== 'fuite' && a.state !== 'envol') {
        this.flee(a, _c.set(f.x, 0, f.z));
      }
    }
    const sense = this.perception(a, ctx, dist);
    const sees = dist < sense;
    const t = d.temper;

    // Prédateurs : les proies fuient aussi les autres prédateurs proches.
    if ((t === 'proie' || t === 'fouisseur' || t === 'volant') && a.state !== 'fuite' && a.state !== 'envol') {
      if (sees) this.flee(a, ctx.player);
      else {
        for (const o of this.animals) {
          if (o.def.temper === 'predateur' && o.alive && o.pos.distanceToSquared(a.pos) < 18 * 18) {
            this.flee(a, o.pos);
            break;
          }
        }
      }
    }

    switch (a.state) {
      case 'calme':
      case 'broute':
      case 'erre':
        if (t === 'territorial' && sees && dist < sense * 0.55) {
          a.setState('alerte');
          this.events.onSound?.(d.sound, 0.8);
        } else if (t === 'predateur' && sees && a.aggressive && !ctx.sheltered) {
          a.setState('traque');
          for (const o of this.animals) if (o.group === a.group && o.alive) o.setState('traque');
        } else if (t === 'carapace' && dist < 4) a.setState('repli');
        else this.idle(a, dt);
        break;
      case 'alerte':
        this.face(a, ctx.player, dt, 3);
        a.speed = 0;
        if (dist < sense * 0.35) {
          a.setState('charge');
          this.events.onSound?.(d.sound, 1);
        } else if (dist > sense * 0.8 || a.stateT > 8) a.setState('calme');
        break;
      case 'traque':
        if (ctx.sheltered || dist > sense * 1.6) {
          a.setState('erre');
          break;
        }
        this.moveToward(a, ctx.player, d.walk * 1.6, dt);
        if (dist < 16) {
          a.setState('charge');
          this.events.onSound?.(d.sound, 1);
        }
        break;
      case 'charge': {
        if (ctx.sheltered && dist > 6) {
          a.setState('retraite');
          break;
        }
        this.moveToward(a, ctx.player, d.run, dt);
        if (dist < d.radius + 1.3 && a.attackCd <= 0) {
          a.attackCd = t === 'territorial' ? 2.2 : 1.3;
          if (!ctx.sheltered) this.events.onPlayerHit?.(d.bite ?? 5, a);
          if (t === 'territorial') a.setState('retraite');
        }
        if (t === 'predateur' && a.hp < d.hp * 0.3) this.flee(a, ctx.player);
        else if (a.stateT > (t === 'territorial' ? 10 : 25)) a.setState('retraite');
        break;
      }
      case 'retraite': {
        const dx = a.pos.x - ctx.player.x;
        const dz = a.pos.z - ctx.player.z;
        const l = Math.hypot(dx, dz) || 1;
        this.moveToward(a, _c.set(a.pos.x + (dx / l) * 10, 0, a.pos.z + (dz / l) * 10), d.walk * 2, dt);
        if (a.stateT > 4) a.setState(t === 'territorial' && dist < sense * 0.4 ? 'charge' : 'calme');
        break;
      }
      case 'fuite':
        this.moveToward(a, a.target, d.run, dt);
        if (a.stateT > 9 || a.pos.distanceTo(_c.set(a.target.x, a.pos.y, a.target.z)) < 3) a.setState('calme');
        break;
      case 'envol': {
        a.altitude = Math.min(a.def.plan === 'oiseau' ? 28 : 18, a.altitude + dt * 6);
        this.moveToward(a, a.target, d.plan === 'oiseau' ? 14 : 9, dt, true);
        if (a.stateT > 6 && a.pos.distanceTo(_c.set(a.target.x, a.pos.y, a.target.z)) < 6) {
          a.altitude = Math.max(0, a.altitude - dt * 10);
          if (a.altitude <= 0) a.setState('calme');
        }
        break;
      }
      case 'repli':
        a.speed = 0;
        if (a.stateT > 6 && dist > 5) a.setState('calme');
        break;
    }
  }

  private idle(a: Animal, dt: number): void {
    const d = a.def;
    if (a.stateT > 3 + a.rnd() * 6) {
      const r = a.rnd();
      if (r < 0.45) {
        a.setState('erre');
        const ang = a.rnd() * Math.PI * 2;
        const dist = 6 + a.rnd() * 18;
        // Les membres d'un troupeau restent groupés autour du premier.
        const lead = this.animals.find((o) => o.group === a.group && o.alive) ?? a;
        a.target.set(lead.pos.x + Math.cos(ang) * dist, 0, lead.pos.z + Math.sin(ang) * dist);
      } else a.setState(d.temper === 'proie' || d.temper === 'territorial' ? 'broute' : 'calme');
      if (a.rnd() < 0.08) this.events.onSound?.(d.sound, 0.4);
    }
    if (a.state === 'erre') {
      this.moveToward(a, a.target, d.walk, dt);
      if (a.pos.distanceTo(_c.set(a.target.x, a.pos.y, a.target.z)) < 1.5) a.setState('calme');
    } else a.speed = Math.max(0, a.speed - dt * 4);
  }

  private face(a: Animal, p: Vector3, dt: number, rate: number): void {
    const want = Math.atan2(-(p.x - a.pos.x), -(p.z - a.pos.z));
    let dy = want - a.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    a.yaw += Math.max(-rate * dt, Math.min(rate * dt, dy));
  }

  private moveToward(a: Animal, p: Vector3, speed: number, dt: number, flying = false): void {
    const d = a.def;
    this.face(a, p, dt, flying ? 3 : 4.5);
    a.speed += (speed - a.speed) * Math.min(1, dt * (speed > a.speed ? 2.5 : 5));
    const fx = -Math.sin(a.yaw);
    const fz = -Math.cos(a.yaw);
    const nx = a.pos.x + fx * a.speed * dt;
    const nz = a.pos.z + fz * a.speed * dt;
    const ny = groundHeight(nx, nz);
    if (!flying) {
      // Pas d'eau profonde (sauf échassiers) ni de pente trop raide : on contourne.
      const slope = (ny - a.pos.y) / Math.max(0.01, a.speed * dt);
      const wet = ny < WATER_LEVEL - (d.plan === 'echassier' ? 0.6 : 0.2);
      if (wet || slope > 1.4) {
        a.yaw += (a.id % 2 ? 1 : -1) * dt * 3;
        a.speed *= 0.7;
        return;
      }
    }
    a.pos.set(nx, ny, nz);
  }

  dispose(): void {
    for (const a of this.animals) {
      this.remove(a.body.root);
      a.body.dispose();
    }
    this.animals.length = 0;
  }
}
