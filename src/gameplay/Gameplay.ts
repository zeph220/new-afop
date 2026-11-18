// Gameplay : santé et satiété, armes et projectiles, récolte, conteneurs, établis et feux de camp,
// faune. Branché sur Game par quelques appels (preInput, update, interact, save).

import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
} from 'three';
import type { Input } from '../core/Input.ts';
import type { AudioEngine } from '../audio/AudioEngine.ts';
import type { FactionId } from '../player/Factions.ts';
import { GRAVITY } from '../player/PlayerController.ts';
import { groundHeight, LANDMARKS, sampleWorld, createSample, forestDensity, WATER_LEVEL } from '../world/WorldGen.ts';
import { collidersNear, staticColliders, type Cylinder } from '../world/VegetationPlacement.ts';
import { hash2 } from '../world/noise.ts';
import { WIND } from '../world/Wind.ts';
import { FaunaManager, loadFaunaModels, type Animal } from './Fauna.ts';
import { GameplayUI, type WeaponView } from './GameplayUI.ts';
import { ITEMS, Inventory, lootText, rollLoot, type LootTable, type Recipe } from './Items.ts';

// ---------------------------------------------------------------------------------------------
// Armes

type WeaponType = 'arc' | 'melee' | 'pulse' | 'flare';
interface WeaponDef {
  id: string;
  name: string;
  type: WeaponType;
  dmg: number;
  range: number;
  cd: number;
  ammo?: string;
  arc?: number; // demi-angle du cône (rad)
}

const WEAPONS: Record<FactionId, WeaponDef[]> = {
  sylmar: [
    { id: 'arc', name: 'Arc de Vehra', type: 'arc', dmg: 60, range: 90, cd: 0.25, ammo: 'fleche' },
    { id: 'arc_feu', name: 'Arc · flèches à résine', type: 'arc', dmg: 75, range: 80, cd: 0.3, ammo: 'fleche_feu' },
    { id: 'lance', name: 'Lance', type: 'melee', dmg: 34, range: 3.2, cd: 0.85, arc: 0.45 },
    { id: 'couteau', name: 'Couteau d’os', type: 'melee', dmg: 16, range: 1.9, cd: 0.4, arc: 0.6 },
  ],
  halden: [
    { id: 'pulseur', name: 'Pulseur sismique', type: 'pulse', dmg: 30, range: 14, cd: 0.9, ammo: 'charge', arc: 0.42 },
    { id: 'fusees', name: 'Lance-fusées', type: 'flare', dmg: 12, range: 70, cd: 1.2, ammo: 'fusee' },
    { id: 'outil', name: 'Clé de forage', type: 'melee', dmg: 22, range: 2.3, cd: 0.7, arc: 0.55 },
  ],
};

// ---------------------------------------------------------------------------------------------
// Monde interactif

interface Container {
  id: string;
  name: string;
  pos: Vector3;
  loot: LootTable;
  mesh: Group | null;
  lid: Object3D | null;
  open: number; // animation 0..1
}

type NodeKind = 'herbe' | 'baies' | 'fibre' | 'cailloux' | 'epave' | 'veine';
interface HarvestNode {
  key: string;
  kind: NodeKind;
  pos: Vector3;
  mesh: Object3D;
}

interface Projectile {
  kind: 'fleche' | 'fleche_feu' | 'fusee';
  pos: Vector3;
  vel: Vector3;
  dmg: number;
  mesh: Object3D;
  stuck: number; // > 0 : planté depuis n s
  light?: PointLight;
}

interface Fire {
  pos: Vector3;
  mesh: Group;
  flame: Mesh;
  placed: boolean;
}

const NODE_INFO: Record<NodeKind, { name: string; loot: LootTable }> = {
  herbe: { name: 'herbe-sève', loot: [['herbe_soin', 1, 2, 1], ['fibre', 0, 1, 0.5]] },
  baies: { name: 'buisson à baies', loot: [['baie', 2, 4, 1]] },
  fibre: { name: 'touffe de fibres', loot: [['fibre', 2, 3, 1]] },
  cailloux: { name: 'éboulis', loot: [['pierre', 2, 3, 1], ['os', 0, 1, 0.15]] },
  epave: { name: 'épave de sonde', loot: [['ferraille', 1, 3, 1], ['cellule', 0, 1, 0.25]] },
  veine: { name: 'veine d’orvène', loot: [['orvene', 1, 2, 1], ['pierre', 0, 1, 0.5]] },
};

export interface GameplaySave {
  hp: number;
  food: number;
  weapon: number;
  charge: number;
  opened: string[];
  fires: [number, number][];
}

export interface GameplayFrame {
  dt: number;
  time: number;
  input: Input;
  camera: PerspectiveCamera;
  camYaw: number;
  baseFov: number;
  player: { pos: { x: number; y: number; z: number }; yaw: number; crouching: boolean };
  sprinting: boolean;
  /** À bord d'un véhicule (armes indisponibles, abri). */
  inVehicle: boolean;
  /** Sur une monture. */
  mounted: boolean;
  night: number;
  vegDensity: number;
  movers: { pos: Vector3; speed: number; radius: number }[];
  /** Le joueur a la main (pas de panneau d'interface ouvert). */
  active: boolean;
}

export interface GameplayHost {
  add(o: Object3D): void;
  remove(o: Object3D): void;
  toast(msg: string): void;
  audio: AudioEngine;
  hudRoot: HTMLElement;
  onDeath(): void;
  onRest(): void;
  setPointerLock(on: boolean): void;
}

const _v = new Vector3();
const _w = new Vector3();
const _dir = new Vector3();
const _cyl: Cylinder[] = [];

export class Gameplay {
  readonly inv: Inventory;
  readonly fauna: FaunaManager;
  readonly ui: GameplayUI;
  readonly faction: FactionId;
  hp = 100;
  food = 85;
  weapon = 0;
  charge = 10; // décharges du pulseur
  private host: GameplayHost;
  private weapons: WeaponDef[];
  private cd = 0;
  private draw = 0;
  private meleeT = -1;
  private zoom = 0;
  private projectiles: Projectile[] = [];
  private containers: Container[] = [];
  private opened = new Set<string>();
  private nodes = new Map<string, HarvestNode>();
  private harvested = new Map<string, number>();
  private trees = new Map<string, number>();
  private fires: Fire[] = [];
  private benches: Vector3[] = [];
  private benchMeshes: Group[] = [];
  private lights: PointLight[] = [];
  private nodeTimer = 0;
  private time = 0;
  private prompt = '';
  private promptAction: (() => void) | null = null;
  private restCd = 0;
  private sample = createSample();
  private mats: Record<string, MeshStandardMaterial>;
  private geos: Record<string, import('three').BufferGeometry>;

  constructor(faction: FactionId, host: GameplayHost, inventory: Record<string, number>, save?: Partial<GameplaySave>) {
    this.faction = faction;
    this.host = host;
    this.weapons = WEAPONS[faction];
    this.inv = new Inventory(inventory);
    // Équipement de départ (une seule fois).
    if (!save) {
      if (faction === 'sylmar') {
        this.inv.add('fleche', 12);
        this.inv.add('herbe_soin', 2);
      } else {
        this.inv.add('fusee', 3);
        this.inv.add('cellule', 1);
        this.inv.add('trousse', 1);
      }
      this.inv.add('baie', 3);
    }
    if (save) {
      this.hp = clampN(save.hp, 1, 100, 100);
      this.food = clampN(save.food, 0, 100, 80);
      this.weapon = clampN(save.weapon, 0, this.weapons.length - 1, 0);
      this.charge = clampN(save.charge, 0, 10, 10);
      if (Array.isArray(save.opened)) for (const id of save.opened) if (typeof id === 'string') this.opened.add(id);
    }
    this.mats = {
      wood: new MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.85 }),
      metal: new MeshStandardMaterial({ color: 0x5d646b, roughness: 0.45, metalness: 0.7 }),
      olive: new MeshStandardMaterial({ color: 0x4b5034, roughness: 0.7, metalness: 0.2 }),
      weave: new MeshStandardMaterial({ color: 0x9a7a45, roughness: 0.95 }),
      leaf: new MeshStandardMaterial({ color: 0x3f6b35, roughness: 0.8, emissive: new Color(0x0d2a10), emissiveIntensity: 0.6 }),
      berry: new MeshStandardMaterial({ color: 0xff9a2a, roughness: 0.4, emissive: new Color(0xff7a10), emissiveIntensity: 0.5 }),
      fiber: new MeshStandardMaterial({ color: 0x9c9a5a, roughness: 0.9 }),
      stone: new MeshStandardMaterial({ color: 0x77736b, roughness: 0.95 }),
      ore: new MeshStandardMaterial({ color: 0xc87a22, roughness: 0.3, emissive: new Color(0xff8a20), emissiveIntensity: 1.2 }),
      flame: new MeshStandardMaterial({ color: 0xffa040, emissive: new Color(0xff7a20), emissiveIntensity: 3, transparent: true, opacity: 0.85 }),
      arrow: new MeshStandardMaterial({ color: 0xd8c8a0, roughness: 0.6 }),
      flare: new MeshStandardMaterial({ color: 0xff4020, emissive: new Color(0xff3010), emissiveIntensity: 4 }),
      pulse: new MeshStandardMaterial({ color: 0x9fd8ff, emissive: new Color(0x60b0ff), emissiveIntensity: 2, transparent: true, opacity: 0.35, depthWrite: false }),
    };
    this.geos = {
      box: new BoxGeometry(1, 1, 1),
      cyl: new CylinderGeometry(0.5, 0.5, 1, 10),
      cone: new ConeGeometry(0.5, 1, 10),
      sph: new SphereGeometry(0.5, 12, 8),
      rock: new DodecahedronGeometry(0.5, 0),
    };
    // Lumières pré-allouées (ajouter des lumières en cours de jeu recompilerait les shaders).
    for (let i = 0; i < 3; i++) {
      const l = new PointLight(0xff8a40, 0, 28, 2);
      l.position.set(0, -1000, 0);
      host.add(l);
      this.lights.push(l);
    }
    this.fauna = new FaunaManager(host.add, host.remove);
    void loadFaunaModels(new URL('models/fauna/', document.baseURI).href);
    this.fauna.events = {
      onPlayerHit: (dmg, a) => this.hurt(dmg, a.def.name),
      onSound: (k, g) => this.host.audio.sfx(k === 'death' ? 'death' : k, g),
      onKill: (a, cause) => {
        if (cause !== 'vehicule') this.host.toast(`${a.def.name} abattu. E : dépecer.`);
      },
    };
    this.ui = new GameplayUI(host.hudRoot, faction, {
      onUse: (id) => this.useItem(id),
      onCraft: (r) => this.craft(r),
      onEquip: (i) => {
        this.weapon = i;
        this.refreshInv();
      },
      onClose: () => this.toggleInventory(false),
      canCraftHere: (r) => this.stationOk(r),
    });
    this.inv.onChange = () => this.refreshInv();
    const fires = Array.isArray(save?.fires) ? save.fires.filter((f) => Array.isArray(f) && f.every((n) => typeof n === 'number' && isFinite(n))) : [];
    this.buildWorldObjects(fires.slice(0, 30));
  }

  get blocking(): boolean {
    return this.ui.open;
  }

  // -------------------------------------------------------------------------------------------
  private buildWorldObjects(fires: [number, number][]): void {
    const vehra = LANDMARKS.find((l) => l.id === 'vehra-tal');
    const kessel = LANDMARKS.find((l) => l.id === 'kessel');
    const at = (x: number, z: number) => new Vector3(x, groundHeight(x, z), z);
    if (vehra) {
      [[14, 9], [-12, 13], [17, -11], [-15, -12]].forEach(([dx, dz], i) =>
        this.containers.push({ id: `vehra-${i}`, name: 'panier de réserve', pos: at(vehra.x + dx, vehra.z + dz), loot: [['fleche', 3, 6, 1], ['fibre', 1, 3, 0.8], ['herbe_soin', 1, 2, 0.6], ['baie', 2, 4, 0.7], ['resine', 1, 2, 0.5]], mesh: null, lid: null, open: 0 }),
      );
      this.benches.push(at(vehra.x + 9, vehra.z - 6));
      this.addFire(vehra.x - 6, vehra.z + 5, false);
    }
    if (kessel) {
      [[22, 12], [24, 16], [-18, 30], [30, -24], [12, 34]].forEach(([dx, dz], i) =>
        this.containers.push({ id: `kessel-${i}`, name: 'caisse de matériel', pos: at(kessel.x + dx, kessel.z + dz), loot: [['ferraille', 1, 3, 1], ['cellule', 1, 1, 0.6], ['fusee', 1, 2, 0.6], ['trousse', 1, 1, 0.35], ['ration', 1, 1, 0.4]], mesh: null, lid: null, open: 0 }),
      );
      this.benches.push(at(kessel.x + 16, kessel.z - 14));
      this.addFire(kessel.x + 12, kessel.z - 22, false);
    }
    for (const b of this.benches) {
      const m = this.benchMesh(b);
      this.benchMeshes.push(m);
      this.host.add(m);
    }
    for (const c of this.containers) this.spawnContainerMesh(c);
    for (const [x, z] of fires) this.addFire(x, z, true);
  }

  private benchMesh(p: Vector3): Group {
    const g = new Group();
    const top = new Mesh(this.geos.box, this.mats.wood);
    top.scale.set(2.2, 0.12, 1);
    top.position.y = 0.95;
    g.add(top);
    for (const [x, z] of [[-1, -0.4], [1, -0.4], [-1, 0.4], [1, 0.4]]) {
      const leg = new Mesh(this.geos.box, this.mats.wood);
      leg.scale.set(0.1, 0.95, 0.1);
      leg.position.set(x, 0.47, z);
      g.add(leg);
    }
    const vise = new Mesh(this.geos.box, this.mats.metal);
    vise.scale.set(0.3, 0.25, 0.3);
    vise.position.set(0.8, 1.13, 0);
    g.add(vise);
    g.position.copy(p);
    g.traverse((o) => ((o as Mesh).castShadow = true));
    return g;
  }

  private spawnContainerMesh(c: Container): void {
    const g = new Group();
    const crate = c.id.startsWith('kessel') || c.id.startsWith('cache-h');
    const body = new Mesh(crate ? this.geos.box : this.geos.cyl, crate ? this.mats.olive : this.mats.weave);
    body.scale.set(crate ? 1.2 : 0.9, 0.7, crate ? 0.8 : 0.9);
    body.position.y = 0.35;
    g.add(body);
    const lid = new Group();
    lid.position.set(0, 0.7, crate ? -0.4 : 0);
    const lm = new Mesh(crate ? this.geos.box : this.geos.cyl, crate ? this.mats.metal : this.mats.weave);
    lm.scale.set(crate ? 1.25 : 0.95, 0.08, crate ? 0.85 : 0.95);
    lm.position.z = crate ? 0.4 : 0;
    lid.add(lm);
    g.add(lid);
    g.position.copy(c.pos);
    g.rotation.y = hash2(Math.round(c.pos.x), Math.round(c.pos.z), 3) * Math.PI * 2;
    g.traverse((o) => ((o as Mesh).castShadow = true));
    c.mesh = g;
    c.lid = lid;
    c.open = this.opened.has(c.id) ? 1 : 0;
    if (c.open) lid.rotation.x = crate ? -1.9 : 0;
    if (c.open && !crate) lid.position.y = 0.1;
    this.host.add(g);
  }

  private addFire(x: number, z: number, placed: boolean): void {
    const g = new Group();
    for (let i = 0; i < 7; i++) {
      const s = new Mesh(this.geos.rock, this.mats.stone);
      const a = (i / 7) * Math.PI * 2;
      s.position.set(Math.cos(a) * 0.7, 0.1, Math.sin(a) * 0.7);
      s.scale.setScalar(0.35);
      g.add(s);
    }
    for (let i = 0; i < 3; i++) {
      const l = new Mesh(this.geos.cyl, this.mats.wood);
      l.scale.set(0.12, 0.9, 0.12);
      l.rotation.set(Math.PI / 2, (i / 3) * Math.PI, 0.3);
      l.position.y = 0.15;
      g.add(l);
    }
    const flame = new Mesh(this.geos.cone, this.mats.flame);
    flame.scale.set(0.55, 1.0, 0.55);
    flame.position.y = 0.6;
    g.add(flame);
    const y = groundHeight(x, z);
    g.position.set(x, y, z);
    this.host.add(g);
    this.fires.push({ pos: new Vector3(x, y, z), mesh: g, flame, placed });
  }

  // -------------------------------------------------------------------------------------------
  /** Juste après la lecture des entrées : inventaire (Tab) et gel des commandes. */
  preInput(input: Input): void {
    // Panneau rapide : A maintenue ; T bascule armes / nourriture ; molette ou 1–9 ; clic pour valider.
    if (!this.ui.open && input.held('quick')) {
      if (input.pressed('quickMode')) {
        this.quickMode = this.quickMode === 'armes' ? 'nourriture' : 'armes';
        this.quickSel = this.quickMode === 'armes' ? this.weapon : 0;
        this.host.audio.click();
      }
      const entries = this.quickEntries();
      if (entries.length) {
        if (input.wheel) this.quickSel = (this.quickSel + Math.sign(input.wheel) + entries.length) % entries.length;
        const d = input.digitPressed();
        if (d && d <= entries.length) {
          this.quickSel = d - 1;
          this.quickApply(entries[this.quickSel].id);
        }
        this.quickSel = Math.min(this.quickSel, entries.length - 1);
        if (input.pressed('attack')) this.quickApply(entries[this.quickSel].id);
      }
      input.wheel = 0;
      input.consume('attack');
      input.consume('quickMode');
      this.ui.quick(true, this.quickMode, entries, this.quickSel);
    } else this.ui.quick(false, this.quickMode, [], 0);
    if (input.pressed('inventory')) this.toggleInventory(!this.ui.open);
    if (this.ui.open && input.pressed('pause')) {
      input.consume('pause');
      this.toggleInventory(false);
    }
    if (this.ui.open) input.freeze();
  }

  private quickMode: 'armes' | 'nourriture' = 'armes';
  private quickSel = 0;

  private quickEntries(): { id: string; label: string; detail: string }[] {
    if (this.quickMode === 'armes') return this.weapons.map((w) => ({ id: 'w:' + w.id, label: w.name, detail: this.ammoText(w) }));
    return Object.entries(this.inv.items)
      .filter(([id, n]) => n > 0 && (ITEMS[id]?.kind === 'nourriture' || ITEMS[id]?.kind === 'soin'))
      .map(([id, n]) => {
        const d = ITEMS[id];
        return { id, label: `${d.name} × ${n}`, detail: `${d.heal ? (d.heal > 0 ? '+' : '') + d.heal + ' santé ' : ''}${d.food ? '+' + d.food + ' satiété' : ''}` };
      });
  }

  private quickApply(id: string): void {
    if (id.startsWith('w:')) {
      const i = this.weapons.findIndex((w) => 'w:' + w.id === id);
      if (i >= 0 && i !== this.weapon) {
        this.weapon = i;
        this.draw = 0;
        this.host.toast(this.weapons[i].name);
        this.host.audio.click();
      }
    } else this.useItem(id);
  }

  toggleInventory(open: boolean): void {
    if (open === this.ui.open) return;
    this.ui.setOpen(open);
    this.host.setPointerLock(!open);
    this.draw = 0;
    if (open) this.refreshInv();
    this.host.audio.click();
  }

  private refreshInv(): void {
    const stats = `Santé ${Math.ceil(this.hp)} / 100<br>Satiété ${Math.ceil(this.food)} %<br>Protection ${Math.round((1 - this.armor()) * 100)} %` +
      (this.faction === 'halden' ? `<br>Pulseur : ${this.charge} / 10 décharges` : '');
    this.ui.render(this.inv, this.weaponViews(), this.weapon, stats);
  }

  private weaponViews(): WeaponView[] {
    return this.weapons.map((w) => ({ id: w.id, name: w.name, ammo: this.ammoText(w) }));
  }

  private ammoText(w: WeaponDef): string {
    if (w.ammo === 'charge') return `${this.charge} décharges · ${this.inv.count('cellule')} cellules`;
    if (w.ammo) return `${this.inv.count(w.ammo)} ${ITEMS[w.ammo]?.name.toLowerCase() ?? w.ammo}${this.inv.count(w.ammo) > 1 ? 's' : ''}`;
    return 'corps à corps';
  }

  private armor(): number {
    let k = 1;
    if (this.inv.has('blindage')) k *= 0.75;
    if (this.inv.has('armure_peau')) k *= 0.8;
    return k;
  }

  private dmgMult(w: WeaponDef): number {
    if (w.type === 'arc' && this.inv.has('arc_composite')) return 1.35;
    if (w.type === 'melee' && this.inv.has('lame_os')) return 1.4;
    if (w.type === 'pulse' && this.inv.has('condensateur')) return 1.4;
    return 1;
  }

  hurt(dmg: number, source: string): void {
    if (this.hp <= 0) return;
    this.hp -= dmg * this.armor();
    this.ui.hurt();
    this.host.audio.sfx('hurt', Math.min(1.5, dmg / 15));
    if (this.hp <= 0) {
      this.hp = 0;
      this.host.toast(`Vous perdez connaissance (${source}).`);
      this.host.onDeath();
      this.hp = 60;
      this.food = Math.max(this.food, 40);
    }
  }

  /** Dégâts de chute (vitesse d'impact en m/s). */
  onLand(impact: number): void {
    if (impact > 15) this.hurt((impact - 15) * 7, 'chute');
  }

  private useItem(id: string): void {
    const d = ITEMS[id];
    if (!d) return;
    if (id === 'feu_camp') {
      this.toggleInventory(false);
      this.pendingFire = true;
      return;
    }
    if (!this.inv.remove(id)) return;
    if (d.heal) this.hp = Math.max(1, Math.min(100, this.hp + d.heal));
    if (d.food) this.food = Math.min(100, this.food + d.food);
    this.host.audio.sfx('pickup');
    this.host.toast(`${d.name} : ${d.heal ? (d.heal > 0 ? '+' : '') + d.heal + ' santé ' : ''}${d.food ? '+' + d.food + ' satiété' : ''}`);
  }
  private pendingFire = false;

  private stationOk(r: Recipe): boolean {
    if (!r.station) return true;
    const p = this.lastPos;
    const near = (list: Vector3[], d: number) => list.some((q) => q.distanceTo(p) < d);
    return r.station === 'feu' ? near(this.fires.map((f) => f.pos), 6) : near(this.benches, 6);
  }
  private lastPos = new Vector3();

  private craft(r: Recipe): void {
    if (!this.stationOk(r) || !this.inv.craft(r)) return;
    this.host.audio.sfx('craft');
    this.host.toast(`Fabriqué : ${r.qty > 1 ? r.qty + ' × ' : ''}${ITEMS[r.out]?.name ?? r.out}`);
  }

  private gain(loot: Record<string, number>, what: string): void {
    for (const [k, n] of Object.entries(loot)) this.inv.add(k, n);
    const txt = lootText(loot);
    this.host.toast(txt ? `${what} : ${txt}` : `${what} : rien d’utile.`);
    this.host.audio.sfx(txt ? 'pickup' : 'empty');
  }

  // -------------------------------------------------------------------------------------------
  update(f: GameplayFrame): void {
    const dt = f.dt;
    this.time = f.time;
    const p = f.player.pos;
    this.lastPos.set(p.x, p.y, p.z);
    this.cd = Math.max(0, this.cd - dt);
    this.restCd = Math.max(0, this.restCd - dt);

    // Besoins vitaux.
    this.food = Math.max(0, this.food - dt * (100 / 2400) * (f.sprinting ? 2 : 1));
    if (this.food > 40 && this.hp < 100) this.hp = Math.min(100, this.hp + dt * 0.5);
    if (this.food <= 0) this.hurt(dt * 0.4, 'faim');

    // Faune.
    const night = f.night;
    this.fauna.update(dt, {
      player: _v.set(p.x, p.y, p.z),
      crouching: f.player.crouching,
      sprinting: f.sprinting,
      sheltered: f.inVehicle,
      night,
      time: f.time,
      movers: f.movers,
    });
    for (const fire of this.fires) if (fire.pos.distanceTo(_v.set(p.x, p.y, p.z)) < 200) this.fauna.scare(fire.pos.x, fire.pos.z, 14, 1.6);

    // Armes.
    const w = this.weapons[this.weapon];
    const canFight = f.active && !f.inVehicle && !this.ui.open;
    if (f.active && f.input.pressed('weapon')) {
      this.weapon = (this.weapon + 1) % this.weapons.length;
      this.draw = 0;
      this.host.toast(this.weapons[this.weapon].name);
      this.host.audio.click();
    }
    const ranged = w.type !== 'melee';
    const aiming = canFight && (f.input.held('aim') || this.draw > 0);
    this.zoom += ((aiming && ranged ? 1 : 0) - this.zoom) * Math.min(1, dt * 8);
    const fov = f.baseFov * (1 - 0.33 * this.zoom);
    if (Math.abs(f.camera.fov - fov) > 0.01 && !f.mounted) {
      f.camera.fov = fov;
      f.camera.updateProjectionMatrix();
    }
    if (canFight) this.handleWeapon(f, w);

    this.updateProjectiles(dt, f);
    this.updateWorld(dt, f);

    // Pose d'un feu de camp.
    if (this.pendingFire && f.active) {
      this.pendingFire = false;
      const x = p.x - Math.sin(f.player.yaw) * 2.2;
      const z = p.z - Math.cos(f.player.yaw) * 2.2;
      if (groundHeight(x, z) < WATER_LEVEL + 0.1) this.host.toast('Impossible d’allumer un feu dans l’eau.');
      else if (this.inv.remove('feu_camp')) {
        this.addFire(x, z, true);
        this.host.toast('Feu de camp allumé : cuisine possible, la faune se tient à distance.');
        this.host.audio.sfx('flare', 0.6);
      }
    }
    if (f.active && f.input.pressed('use')) {
      if (this.inv.has('feu_camp')) this.pendingFire = true;
      else {
        const heal = ['trousse', 'baume', 'herbe_soin'].find((id) => this.inv.has(id));
        if (heal && this.hp < 100) this.useItem(heal);
        else this.host.toast('G : soin rapide ou pose d’un feu de camp (rien à utiliser).');
      }
    }

    this.ui.update(dt, {
      hp: this.hp,
      maxHp: 100,
      food: this.food,
      weapon: { id: w.id, name: w.name, ammo: this.ammoText(w) },
      windFrom: WIND.fromDegrees,
      windKmh: WIND.speedKmh,
      camYawDeg: (-f.camYaw * 180) / Math.PI,
      aiming: aiming && ranged,
      draw: this.draw,
      prompt: f.inVehicle || this.ui.open ? '' : this.prompt,
    });
  }

  private aimDir(f: GameplayFrame, from: Vector3, out: Vector3): Vector3 {
    // Vise le point au centre de l'écran (premier contact avec le relief ou à 120 m).
    f.camera.getWorldDirection(_dir);
    const cp = f.camera.position;
    let t = 120;
    for (let s = 2; s < 120; s += 2) {
      const x = cp.x + _dir.x * s;
      const y = cp.y + _dir.y * s;
      const z = cp.z + _dir.z * s;
      if (y < groundHeight(x, z)) {
        t = s;
        break;
      }
    }
    return out.set(cp.x + _dir.x * t - from.x, cp.y + _dir.y * t - from.y, cp.z + _dir.z * t - from.z).normalize();
  }

  private handleWeapon(f: GameplayFrame, w: WeaponDef): void {
    const inp = f.input;
    const p = f.player.pos;
    const chest = _w.set(p.x, p.y + (this.faction === 'sylmar' ? 1.9 : 1.45), p.z);
    const faceCam = () => (f.player.yaw = f.camYaw);
    if (w.type === 'arc') {
      if (inp.held('attack') && this.cd <= 0) {
        if (!this.inv.has(w.ammo!)) {
          if (inp.pressed('attack')) {
            this.host.toast(`Plus de ${ITEMS[w.ammo!].name.toLowerCase()}s. Fabriquez-en (Tab).`);
            this.host.audio.sfx('empty');
          }
          return;
        }
        if (this.draw === 0) this.host.audio.sfx('bowDraw');
        this.draw = Math.min(1, this.draw + f.dt / 0.9);
        faceCam();
      } else if (this.draw > 0) {
        if (this.draw > 0.15 && this.inv.remove(w.ammo!)) {
          const k = this.dmgMult(w);
          const speed = (28 + 48 * this.draw) * (k > 1 ? 1.15 : 1);
          const dir = this.aimDir(f, chest, new Vector3());
          this.spawnProjectile(w.ammo as 'fleche', chest, dir.multiplyScalar(speed), (w.dmg * 0.3 + w.dmg * 0.7 * this.draw) * k);
          this.host.audio.sfx('bowShot');
          this.cd = w.cd;
        }
        this.draw = 0;
      }
      return;
    }
    if (!inp.pressed('attack') || this.cd > 0) return;
    faceCam();
    if (w.type === 'melee') {
      this.cd = w.cd;
      this.meleeT = 0.15;
      this.host.audio.sfx('swing');
      return;
    }
    if (w.type === 'pulse') {
      if (this.charge <= 0) {
        if (this.inv.remove('cellule')) {
          this.charge = 10;
          this.host.toast('Cellule d’orvène insérée : 10 décharges.');
        } else {
          this.host.toast('Pulseur vide : fabriquez des cellules (orvène + ferraille).');
          this.host.audio.sfx('empty');
          this.cd = 0.4;
          return;
        }
      }
      this.charge--;
      this.cd = w.cd;
      const dir = this.aimDir(f, chest, new Vector3());
      const range = w.range * (this.inv.has('condensateur') ? 1.3 : 1);
      const hit = this.fauna.inCone(chest, dir, range, w.arc!);
      for (const a of hit) {
        const fall = 1 - Math.min(1, a.pos.distanceTo(chest) / (range + 2)) * 0.6;
        this.fauna.damage(a, w.dmg * this.dmgMult(w) * fall, chest, 'pulseur');
        // Recul
        a.pos.x += dir.x * 3;
        a.pos.z += dir.z * 3;
        a.pos.y = groundHeight(a.pos.x, a.pos.z);
      }
      if (hit.length) this.ui.hitMarker();
      this.pulseFx(chest, dir, range);
      this.host.audio.sfx('pulse');
      return;
    }
    if (w.type === 'flare') {
      if (!this.inv.remove('fusee')) {
        this.host.toast('Plus de fusées : ferraille + résine (Tab).');
        this.host.audio.sfx('empty');
        return;
      }
      const dir = this.aimDir(f, chest, new Vector3());
      this.spawnProjectile('fusee', chest, dir.multiplyScalar(34), w.dmg);
      this.host.audio.sfx('flare');
      this.cd = w.cd;
    }
  }

  private pulseFx(o: Vector3, dir: Vector3, range: number): void {
    const m = new Mesh(this.geos.cone, this.mats.pulse);
    m.position.copy(o).addScaledVector(dir, range / 2);
    m.lookAt(o);
    m.rotateX(-Math.PI / 2);
    m.scale.set(range * 0.8, range, range * 0.8);
    this.host.add(m);
    setTimeout(() => this.host.remove(m), 180);
  }

  private spawnProjectile(kind: Projectile['kind'], from: Vector3, vel: Vector3, dmg: number): void {
    let mesh: Object3D;
    let light: PointLight | undefined;
    if (kind === 'fusee') {
      mesh = new Mesh(this.geos.sph, this.mats.flare);
      mesh.scale.setScalar(0.18);
      light = this.lights.reduce((a, b) => (a.intensity <= b.intensity ? a : b));
      light.color.set(0xff5030);
      light.intensity = 30;
      light.distance = 40;
    } else {
      const g = new Group();
      const shaft = new Mesh(this.geos.cyl, this.mats.arrow);
      shaft.scale.set(0.025, 0.85, 0.025);
      shaft.rotation.x = Math.PI / 2;
      g.add(shaft);
      const head = new Mesh(this.geos.cone, kind === 'fleche_feu' ? this.mats.flame : this.mats.stone);
      head.scale.set(0.05, 0.12, 0.05);
      head.rotation.x = -Math.PI / 2;
      head.position.z = -0.47;
      g.add(head);
      mesh = g;
    }
    mesh.position.copy(from);
    this.host.add(mesh);
    this.projectiles.push({ kind, pos: from.clone(), vel: vel.clone(), dmg, mesh, stuck: 0, light });
    if (this.projectiles.length > 40) this.dropProjectile(0);
  }

  private dropProjectile(i: number): void {
    const pr = this.projectiles[i];
    this.host.remove(pr.mesh);
    if (pr.light) pr.light.intensity = 0;
    this.projectiles.splice(i, 1);
  }

  private updateProjectiles(dt: number, f: GameplayFrame): void {
    const p0 = new Vector3();
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.stuck > 0) {
        pr.stuck += dt;
        if (pr.light) {
          pr.light.position.copy(pr.pos).y += 0.6;
          pr.light.intensity = 30 * Math.max(0, 1 - pr.stuck / 45) * (0.85 + 0.15 * Math.sin(this.time * 23));
        }
        if (pr.stuck > (pr.kind === 'fusee' ? 45 : 60)) this.dropProjectile(i);
        continue;
      }
      p0.copy(pr.pos);
      // Gravité, traînée et vent (les flèches dérivent légèrement).
      const wv = WIND.velocityAt(Math.max(0, pr.pos.y - groundHeight(pr.pos.x, pr.pos.z)));
      pr.vel.y -= GRAVITY * 1.2 * dt;
      pr.vel.x += (wv.x - pr.vel.x) * 0.02 * dt * 10 * 0.25;
      pr.vel.z += (wv.z - pr.vel.z) * 0.02 * dt * 10 * 0.25;
      pr.pos.addScaledVector(pr.vel, dt);
      // Contact avec un animal.
      const hit = this.fauna.raycast(p0, pr.pos);
      if (hit) {
        const extra = pr.kind === 'fleche_feu' ? 15 : 0;
        this.fauna.damage(hit, pr.dmg + extra, p0, pr.kind);
        if (pr.kind !== 'fleche') this.fauna.scare(hit.pos.x, hit.pos.z, 25, 12);
        this.ui.hitMarker();
        this.host.audio.sfx('hit');
        this.dropProjectile(i);
        continue;
      }
      // Sol ou tronc.
      const g = groundHeight(pr.pos.x, pr.pos.z);
      let stuck = pr.pos.y <= g;
      if (!stuck) {
        for (const c of collidersNear(pr.pos.x, pr.pos.z, 1.5, f.vegDensity, _cyl)) {
          if (Math.hypot(pr.pos.x - c.x, pr.pos.z - c.z) < c.r && pr.pos.y > c.y0 && pr.pos.y < c.y1) {
            stuck = true;
            break;
          }
        }
      }
      if (stuck || pr.pos.distanceTo(p0) > 1000) {
        pr.pos.y = Math.max(pr.pos.y, g + 0.05);
        pr.stuck = 0.001;
        this.host.audio.sfx('thud', 0.5);
        if (pr.kind !== 'fleche') this.fauna.scare(pr.pos.x, pr.pos.z, pr.kind === 'fusee' ? 32 : 18, pr.kind === 'fusee' ? 40 : 12);
      }
      pr.mesh.position.copy(pr.pos);
      if (pr.kind !== 'fusee') pr.mesh.lookAt(_v.copy(pr.pos).sub(pr.vel));
      if (pr.light) pr.light.position.copy(pr.pos);
    }
  }

  // -------------------------------------------------------------------------------------------
  private updateWorld(dt: number, f: GameplayFrame): void {
    const p = this.lastPos;
    // Coup de mêlée (après l'élan).
    if (this.meleeT > 0) {
      this.meleeT -= dt;
      if (this.meleeT <= 0) {
        const w = this.weapons[this.weapon];
        const chest = _w.set(p.x, p.y + 1.3, p.z);
        const dir = _dir.set(-Math.sin(f.camYaw), 0, -Math.cos(f.camYaw));
        const hits = this.fauna.inCone(chest, dir, w.range, w.arc ?? 0.5);
        hits.sort((a, b) => a.pos.distanceTo(chest) - b.pos.distanceTo(chest));
        for (const a of w.id === 'lance' ? hits.slice(0, 2) : hits.slice(0, 1)) this.fauna.damage(a, w.dmg * this.dmgMult(w), chest, w.id);
        if (hits.length) {
          this.ui.hitMarker();
          this.host.audio.sfx('hit');
        }
      }
    }
    // Animation des conteneurs.
    for (const c of this.containers) {
      if (!c.lid || !this.opened.has(c.id) || c.open >= 1) continue;
      c.open = Math.min(1, c.open + dt * 2);
      if (c.id.startsWith('vehra') || c.id.startsWith('cache-s')) c.lid.position.y = 0.7 - 0.6 * c.open;
      else c.lid.rotation.x = -1.9 * c.open;
    }
    for (const fire of this.fires) {
      fire.flame.scale.y = 0.85 + 0.25 * Math.sin(this.time * 11 + fire.pos.x) * Math.sin(this.time * 7.3);
      fire.flame.rotation.y += dt * 2;
    }
    // Lumière des feux proches (les fusées gardent la priorité).
    const nearFires = this.fires.filter((fi) => fi.pos.distanceTo(p) < 60).sort((a, b) => a.pos.distanceTo(p) - b.pos.distanceTo(p));
    const freeLights = this.lights.filter((l) => !this.projectiles.some((pr) => pr.light === l));
    freeLights.forEach((l, i) => {
      const fi = nearFires[i];
      if (fi) {
        l.color.set(0xff8a40);
        l.distance = 22;
        l.position.set(fi.pos.x, fi.pos.y + 1.2, fi.pos.z);
        l.intensity = 14 * (0.85 + 0.15 * Math.sin(this.time * 17 + i));
      } else l.intensity = 0;
    });

    // Caches et plantes autour du joueur.
    this.nodeTimer -= dt;
    if (this.nodeTimer <= 0) {
      this.nodeTimer = 1;
      this.refreshNodes(p);
      this.refreshCaches(p);
    }

    // Interaction la plus proche.
    this.findInteraction(f);
  }

  private refreshCaches(p: Vector3): void {
    const C = 320;
    const cx0 = Math.floor((p.x - 260) / C);
    const cz0 = Math.floor((p.z - 260) / C);
    for (let cx = cx0; cx <= cx0 + 2; cx++) {
      for (let cz = cz0; cz <= cz0 + 2; cz++) {
        if (hash2(cx, cz, 71) > 0.3) continue;
        const sylvan = hash2(cx, cz, 73) < 0.55;
        const id = `cache-${sylvan ? 's' : 'h'}-${cx}-${cz}`;
        if (this.containers.some((c) => c.id === id)) continue;
        const x = (cx + 0.2 + 0.6 * hash2(cx, cz, 75)) * C;
        const z = (cz + 0.2 + 0.6 * hash2(cx, cz, 77)) * C;
        if (Math.hypot(x - p.x, z - p.z) > 300 || groundHeight(x, z) < WATER_LEVEL + 0.5) continue;
        const loot: LootTable = sylvan
          ? [['fleche', 2, 5, 0.8], ['baume', 1, 1, 0.4], ['os', 1, 3, 0.6], ['resine', 1, 3, 0.6], ['plume', 1, 3, 0.5]]
          : [['ferraille', 2, 4, 1], ['cellule', 1, 2, 0.5], ['trousse', 1, 1, 0.4], ['fusee', 1, 2, 0.5], ['orvene', 1, 2, 0.4]];
        const c: Container = { id, name: sylvan ? 'cache sylmar' : 'conteneur largué', pos: new Vector3(x, groundHeight(x, z), z), loot, mesh: null, lid: null, open: 0 };
        this.containers.push(c);
        this.spawnContainerMesh(c);
      }
    }
    // Retire les caches lointaines (les conteneurs fixes restent).
    for (let i = this.containers.length - 1; i >= 0; i--) {
      const c = this.containers[i];
      if (c.id.startsWith('cache') && c.pos.distanceTo(p) > 420) {
        if (c.mesh) this.host.remove(c.mesh);
        this.containers.splice(i, 1);
      }
    }
  }

  private refreshNodes(p: Vector3): void {
    const C = 34;
    const R = 120;
    const want = new Set<string>();
    const east = p.x > 1500;
    for (let cx = Math.floor((p.x - R) / C); cx <= Math.floor((p.x + R) / C); cx++) {
      for (let cz = Math.floor((p.z - R) / C); cz <= Math.floor((p.z + R) / C); cz++) {
        if (hash2(cx, cz, 91) > 0.42) continue;
        const key = `${cx},${cz}`;
        const t = this.harvested.get(key);
        if (t !== undefined && this.time - t < 480) continue;
        const x = (cx + 0.15 + 0.7 * hash2(cx, cz, 93)) * C;
        const z = (cz + 0.15 + 0.7 * hash2(cx, cz, 95)) * C;
        if (Math.hypot(x - p.x, z - p.z) > R) continue;
        const y = groundHeight(x, z);
        if (y < WATER_LEVEL + 0.3) continue;
        want.add(key);
        if (this.nodes.has(key)) continue;
        const s = sampleWorld(x, z, this.sample);
        const forest = forestDensity(x, z, s);
        const r = hash2(cx, cz, 97);
        let kind: NodeKind;
        if ((s.canyon > 0.4 || x > 1650) && r < 0.35) kind = 'veine';
        else if (s.mesa > 0.5 || s.canyon > 0.5) kind = r < 0.6 ? 'cailloux' : 'fibre';
        else if (east && r < 0.25) kind = 'epave';
        else if (r < 0.06) kind = 'epave';
        else kind = forest > 0.4 ? (r < 0.45 ? 'herbe' : r < 0.75 ? 'baies' : 'fibre') : r < 0.35 ? 'fibre' : r < 0.6 ? 'cailloux' : r < 0.8 ? 'herbe' : 'baies';
        const mesh = this.nodeMesh(kind, r);
        mesh.position.set(x, y, z);
        mesh.rotation.y = r * 20;
        this.host.add(mesh);
        this.nodes.set(key, { key, kind, pos: new Vector3(x, y, z), mesh });
      }
    }
    for (const [k, n] of this.nodes) {
      if (!want.has(k)) {
        this.host.remove(n.mesh);
        this.nodes.delete(k);
      }
    }
  }

  private nodeMesh(kind: NodeKind, r: number): Object3D {
    const g = new Group();
    const add = (geo: keyof typeof this.geos, mat: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) => {
      const m = new Mesh(this.geos[geo], this.mats[mat]);
      m.position.set(x, y, z);
      m.scale.set(sx, sy, sz);
      m.rotation.set(rx, 0, rz);
      m.castShadow = true;
      g.add(m);
    };
    if (kind === 'herbe') for (let i = 0; i < 7; i++) add('cone', 'leaf', Math.cos(i) * 0.25, 0.3, Math.sin(i) * 0.25, 0.18, 0.7, 0.05, Math.sin(i * 2) * 0.5, Math.cos(i * 3) * 0.5);
    else if (kind === 'baies') {
      add('sph', 'leaf', 0, 0.45, 0, 1.1, 0.9, 1.1);
      for (let i = 0; i < 9; i++) add('sph', 'berry', Math.cos(i * 2.4) * 0.48, 0.35 + (i % 3) * 0.18, Math.sin(i * 2.4) * 0.48, 0.09, 0.09, 0.09);
    } else if (kind === 'fibre') for (let i = 0; i < 9; i++) add('cyl', 'fiber', Math.cos(i * 1.7) * 0.2, 0.55, Math.sin(i * 1.7) * 0.2, 0.025, 1.1 + r * 0.4, 0.025, Math.sin(i) * 0.25, Math.cos(i) * 0.25);
    else if (kind === 'cailloux') for (let i = 0; i < 5; i++) add('rock', 'stone', Math.cos(i * 1.3) * 0.45, 0.12, Math.sin(i * 1.3) * 0.45, 0.45, 0.32, 0.4);
    else if (kind === 'epave') {
      add('box', 'metal', 0, 0.3, 0, 1.4, 0.5, 0.8, 0.2, 0.3);
      add('cyl', 'metal', 0.6, 0.6, 0.2, 0.15, 1.2, 0.15, 0.9, 0.4);
      add('box', 'olive', -0.4, 0.15, 0.5, 0.6, 0.3, 0.5, 0, 0.6);
    } else for (let i = 0; i < 5; i++) add('cone', 'ore', Math.cos(i * 1.2) * 0.3, 0.3, Math.sin(i * 1.2) * 0.3, 0.22, 0.8 + (i % 2) * 0.4, 0.22, Math.sin(i) * 0.4, Math.cos(i) * 0.4);
    return g;
  }

  private findInteraction(f: GameplayFrame): void {
    const p = this.lastPos;
    this.prompt = '';
    this.promptAction = null;
    if (f.inVehicle || this.ui.open) return;
    let best = 3.2;
    const offer = (d: number, text: string, act: () => void) => {
      if (d < best) {
        best = d;
        this.prompt = text;
        this.promptAction = act;
      }
    };
    for (const c of this.containers) {
      if (this.opened.has(c.id)) continue;
      offer(c.pos.distanceTo(p) - 0.6, `E : fouiller le ${c.name}`, () => {
        this.opened.add(c.id);
        const rnd = seeded(hash2(Math.round(c.pos.x), Math.round(c.pos.z), 5));
        this.host.audio.sfx('open');
        this.gain(rollLoot(c.loot, rnd), c.name[0].toUpperCase() + c.name.slice(1));
      });
    }
    for (const n of this.nodes.values()) {
      const info = NODE_INFO[n.kind];
      offer(n.pos.distanceTo(p) - 0.3, `E : récolter (${info.name})`, () => {
        if (n.kind === 'veine' && !this.weapons.some((w) => w.type === 'melee')) return;
        this.harvested.set(n.key, this.time);
        this.host.remove(n.mesh);
        this.nodes.delete(n.key);
        this.host.audio.sfx(n.kind === 'veine' || n.kind === 'cailloux' ? 'chop' : 'pickup');
        const bonus = this.weapons[this.weapon].type === 'melee' ? 1 : 0;
        const loot = rollLoot(info.loot, Math.random);
        if (bonus) for (const k of Object.keys(loot)) loot[k] += 1;
        this.gain(loot, info.name[0].toUpperCase() + info.name.slice(1));
      });
    }
    const carcass = this.fauna.nearestCarcass(p, 3 + 1);
    if (carcass) {
      offer(carcass.pos.distanceTo(p) - carcass.def.radius, `E : dépecer (${carcass.def.name})`, () => this.skin(carcass));
    }
    for (const fire of this.fires) {
      offer(fire.pos.distanceTo(p) - 0.8, f.night > 0.5 ? 'E : dormir jusqu’à l’aube près du feu' : 'E : se reposer près du feu', () => {
        if (this.restCd > 0) return;
        this.restCd = 20;
        if (f.night > 0.5) {
          this.host.onRest();
          this.hp = 100;
          this.food = Math.max(0, this.food - 25);
          this.host.toast('Vous dormez jusqu’à l’aube. Santé restaurée.');
        } else {
          this.hp = Math.min(100, this.hp + 20);
          this.host.toast('Un moment de repos : +20 santé.');
        }
      });
    }
    for (const b of this.benches) offer(b.distanceTo(p) - 1, 'E : établi (Tab pour fabriquer ici)', () => this.toggleInventory(true));
    // Arbres et rochers (troncs de la flore générée).
    if (!this.prompt) {
      for (const c of collidersNear(p.x, p.z, 3.5, f.vegDensity, _cyl)) {
        if (staticColliders.includes(c)) continue;
        const d = Math.hypot(c.x - p.x, c.z - p.z) - c.r;
        if (d > 1.4 || p.y < c.y0 - 1 || p.y > c.y1) continue;
        const key = `${Math.round(c.x)},${Math.round(c.z)}`;
        const tree = c.climbable;
        offer(d, tree ? 'E : entailler le tronc (bois, résine)' : 'E : tailler la roche (pierre)', () => {
          const last = this.trees.get(key);
          if (last !== undefined && this.time - last < 300) {
            this.host.toast(tree ? 'Ce tronc a déjà été entaillé récemment.' : 'Cette roche a déjà été taillée.');
            return;
          }
          this.trees.set(key, this.time);
          this.host.audio.sfx('chop');
          const tool = this.weapons[this.weapon].type === 'melee' ? 1 : 0;
          const loot = tree
            ? rollLoot([['bois', 1 + tool, 2 + tool, 1], ['resine', 1, 1, 0.45], ['fibre', 1, 1, 0.3]], Math.random)
            : rollLoot([['pierre', 1 + tool, 2 + tool, 1], ['orvene', 1, 1, c.x > 1650 ? 0.4 : 0.03]], Math.random);
          this.gain(loot, tree ? 'Tronc' : 'Roche');
        });
      }
    }
    // Flèches plantées à ramasser.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.stuck <= 0 || pr.kind !== 'fleche') continue;
      offer(pr.pos.distanceTo(p), 'E : ramasser la flèche', () => {
        this.inv.add('fleche');
        this.dropProjectile(this.projectiles.indexOf(pr));
        this.host.audio.sfx('pickup');
      });
    }
  }

  /** E : interaction gameplay. Retourne true si quelque chose a été fait. */
  interact(): boolean {
    if (!this.promptAction) return false;
    this.promptAction();
    this.promptAction = null;
    return true;
  }

  private skin(a: Animal): void {
    a.looted = true;
    const knife = this.weapons[this.weapon].id === 'couteau' || this.weapons[this.weapon].id === 'outil';
    const rnd = a.rnd;
    const loot = rollLoot(a.def.loot, rnd);
    if (knife && loot.peau) loot.peau += 1;
    this.host.audio.sfx('chop');
    this.gain(loot, a.def.name);
  }

  save(): GameplaySave {
    return {
      hp: Math.round(this.hp),
      food: Math.round(this.food),
      weapon: this.weapon,
      charge: this.charge,
      opened: [...this.opened],
      fires: this.fires.filter((f) => f.placed).map((f) => [Math.round(f.pos.x * 10) / 10, Math.round(f.pos.z * 10) / 10]),
    };
  }

  dispose(): void {
    this.fauna.dispose();
    for (const pr of this.projectiles) this.host.remove(pr.mesh);
    for (const c of this.containers) if (c.mesh) this.host.remove(c.mesh);
    for (const n of this.nodes.values()) this.host.remove(n.mesh);
    for (const f of this.fires) this.host.remove(f.mesh);
    for (const l of this.lights) this.host.remove(l);
    for (const m of this.benchMeshes) this.host.remove(m);
    this.ui.dispose();
  }
}

function clampN(v: unknown, lo: number, hi: number, def: number): number {
  return typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : def;
}

function seeded(seed: number): () => number {
  let s = Math.floor(seed * 2147483646) + 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
