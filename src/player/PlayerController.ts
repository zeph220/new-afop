// Contrôleur cinématique du personnage (sans Three.js : testable sous Node).
// Il interroge la heightmap (même triangulation que le maillage affiché) et des cylindres
// de collision (troncs, ombrelles, rochers, structures).

import type { FactionDef } from './Factions.ts';
import type { Cylinder } from '../world/VegetationPlacement.ts';

export const GRAVITY = 7.6; // 0,78 g
const COS_WALK = 0.69; // ≈ 46° : pente maximale praticable à pied
const COS_CLIMB_EXIT = 0.8; // ≈ 37° : en escalade, on se rétablit en dessous
const WORLD_LIMIT = 3640;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface WorldQuery {
  ground(x: number, z: number, normalOut?: Vec3): number;
  colliders(x: number, z: number, radius: number, out: Cylinder[]): Cylinder[];
  waterLevel: number;
  edgeDistance(x: number, z: number): number;
}

export interface PlayerInput {
  /** Direction de déplacement voulue dans le monde (longueur 0..1). */
  moveX: number;
  moveZ: number;
  /** Axes bruts relatifs à la caméra (pour l'escalade). */
  fwd: number;
  right: number;
  sprint: boolean;
  crouch: boolean;
  crouchPressed: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
}

export type MoveState = 'ground' | 'air' | 'climb' | 'trunk' | 'mantle' | 'swim';

export interface PlayerEvents {
  onStep?(strength: number): void;
  onJump?(): void;
  onLand?(impact: number): void;
  onClimbStart?(): void;
  onSplash?(): void;
}

export class PlayerController {
  readonly pos: Vec3 = { x: 0, y: 0, z: 0 };
  readonly vel: Vec3 = { x: 0, y: 0, z: 0 };
  state: MoveState = 'air';
  yaw = 0; // orientation du corps (0 = regarde vers -Z)
  stamina: number;
  fuel: number;
  jetpack = 0; // intensité 0..1 (rendu, son)
  crouching = false;
  airTime = 0;
  groundTime = 0;
  stepPhase = 0;
  readonly normal: Vec3 = { x: 0, y: 1, z: 0 };
  private trunk: Cylinder | null = null;
  private trunkAngle = 0;
  private mantleFrom: Vec3 = { x: 0, y: 0, z: 0 };
  private mantleTo: Vec3 = { x: 0, y: 0, z: 0 };
  private mantleT = 0;
  private regrabCooldown = 0;
  private cyl: Cylinder[] = [];
  private blockedBy: Cylinder | null = null;
  private onPlatform = false;
  readonly f: FactionDef;
  private world: WorldQuery;
  events: PlayerEvents = {};

  constructor(faction: FactionDef, world: WorldQuery) {
    this.f = faction;
    this.world = world;
    this.stamina = faction.staminaMax;
    this.fuel = faction.fuelMax;
  }

  get grounded(): boolean {
    return this.state === 'ground';
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get climbing(): boolean {
    return this.state === 'climb' || this.state === 'trunk' || this.state === 'mantle';
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.x = x;
    this.pos.y = y;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.state = 'air';
  }

  update(dt: number, input: PlayerInput): void {
    this.regrabCooldown = Math.max(0, this.regrabCooldown - dt);
    this.jetpack = Math.max(0, this.jetpack - dt * 4);
    if (input.crouchPressed && !this.climbing) this.crouching = !this.crouching;
    if (input.sprint && this.crouching && this.horizontalSpeed > 0.5) this.crouching = false;
    switch (this.state) {
      case 'climb':
        this.updateClimb(dt, input);
        break;
      case 'trunk':
        this.updateTrunk(dt, input);
        break;
      case 'mantle':
        this.updateMantle(dt);
        break;
      default:
        this.updateFree(dt, input);
    }
    // Endurance (Sylmar) et carburant (Halden).
    if (this.f.staminaMax > 0 && !this.climbing && !(input.sprint && this.horizontalSpeed > 1 && this.state === 'ground')) {
      this.stamina = Math.min(this.f.staminaMax, this.stamina + 16 * dt);
    }
    if (this.f.fuelMax > 0 && this.state === 'ground' && this.groundTime > 0.6) {
      this.fuel = Math.min(this.f.fuelMax, this.fuel + 32 * dt);
    }
    this.clampWorld();
  }

  // -------------------------------------------------------------------------------------------
  private updateFree(dt: number, input: PlayerInput): void {
    const f = this.f;
    const w = this.world;
    const swimming = this.state === 'swim';
    const moving = Math.hypot(input.moveX, input.moveZ) > 0.05;
    let sprint = input.sprint && moving;
    if (f.staminaMax > 0 && this.stamina <= 1) sprint = false;
    let speed = this.crouching ? f.crouch : sprint ? f.run : f.walk;
    if (swimming) speed = sprint ? f.swim * 1.5 : f.swim;
    if (sprint && f.staminaMax > 0 && this.state === 'ground') this.stamina = Math.max(0, this.stamina - 9 * dt);

    const tx = input.moveX * speed;
    const tz = input.moveZ * speed;
    const jetOn = f.hasJetpack && !swimming && this.state === 'air' && input.jumpHeld && this.fuel > 0 && this.airTime > 0.22;
    const accel = this.state === 'ground' ? (moving ? 34 : 44) : swimming ? 8 : jetOn ? 11 : 4;
    approach(this.vel, tx, tz, accel * dt);

    // Saut
    if (input.jumpPressed) {
      if (this.state === 'ground') {
        this.vel.y = this.crouching ? f.jump * 0.8 : f.jump;
        this.state = 'air';
        this.airTime = 0;
        this.crouching = false;
        this.events.onJump?.();
      } else if (swimming) {
        this.vel.y = 4.2;
      }
    }
    // Propulseur
    if (jetOn) {
      this.vel.y = Math.min(9, this.vel.y + 16.5 * dt);
      this.fuel = Math.max(0, this.fuel - 24 * dt);
      this.jetpack = 1;
    }
    // Gravité / flottaison
    const swimLine = w.waterLevel - f.height * 0.62;
    if (swimming) {
      this.vel.y += ((swimLine - this.pos.y) * 9 - this.vel.y * 3.2) * dt;
    } else {
      this.vel.y -= GRAVITY * dt;
    }

    // Déplacement horizontal avec blocage par les pentes trop raides.
    const wasGround = this.state === 'ground';
    const n = this.normal;
    let nx = this.pos.x + this.vel.x * dt;
    let nz = this.pos.z + this.vel.z * dt;
    const g = w.ground(nx, nz, n);
    if ((wasGround || swimming) && n.y < COS_WALK && g > this.pos.y + 0.12) {
      if (f.canClimb && moving && this.stamina > 5 && this.regrabCooldown <= 0 && towards(input, -n.x, -n.z)) {
        this.startClimb();
        return;
      }
      const ul = Math.hypot(n.x, n.z) || 1;
      const ux = -n.x / ul;
      const uz = -n.z / ul;
      const d = this.vel.x * ux + this.vel.z * uz;
      if (d > 0) {
        this.vel.x -= ux * d;
        this.vel.z -= uz * d;
      }
      nx = this.pos.x + this.vel.x * dt;
      nz = this.pos.z + this.vel.z * dt;
      if (w.ground(nx, nz) > this.pos.y + 0.3) {
        nx = this.pos.x;
        nz = this.pos.z;
      }
    }
    const prevY = this.pos.y;
    this.pos.x = nx;
    this.pos.z = nz;
    this.pos.y += this.vel.y * dt;

    // Cylindres (troncs, ombrelles, rochers).
    const platformTop = this.resolveCylinders(prevY);
    if (f.canClimb && this.blockedBy?.climbable && moving && this.stamina > 5 && this.regrabCooldown <= 0) {
      const c = this.blockedBy;
      if (towards(input, c.x - this.pos.x, c.z - this.pos.z)) {
        this.startTrunk(c);
        return;
      }
    }

    // Sol
    const terrain = w.ground(this.pos.x, this.pos.z, n);
    let floor = terrain;
    this.onPlatform = false;
    if (platformTop > terrain) {
      floor = platformTop;
      this.onPlatform = true;
    }
    const snap = wasGround && this.vel.y <= 0.01 ? 0.5 : 0;
    if (this.pos.y <= floor + snap) {
      const steep = !this.onPlatform && n.y < COS_WALK;
      if (steep) {
        if (f.canClimb && moving && this.stamina > 5 && this.regrabCooldown <= 0 && towards(input, -n.x, -n.z)) {
          this.pos.y = floor;
          this.startClimb();
          return;
        }
        const nl = Math.hypot(n.x, n.z) || 1;
        const reach = f.radius * 1.5;
        const gDown = w.ground(this.pos.x + (n.x / nl) * reach, this.pos.z + (n.z / nl) * reach);
        if (floor - gDown < 0.6) {
          // Pied de pente : on reste au sol, légèrement repoussé hors de la paroi.
          this.pos.x += (n.x / nl) * 0.03;
          this.pos.z += (n.z / nl) * 0.03;
          this.pos.y = w.ground(this.pos.x, this.pos.z);
          this.vel.y = 0;
          this.state = 'ground';
        } else {
          // Glissade le long de la pente.
          this.pos.y = floor;
          const slide = GRAVITY * (1 - n.y) * 1.6;
          this.vel.x += n.x * slide * dt * 4;
          this.vel.z += n.z * slide * dt * 4;
          this.vel.y = Math.min(this.vel.y, 0);
          this.state = 'air';
          this.airTime = 0.05;
        }
      } else {
        if (this.state === 'air' && this.vel.y < -3) this.events.onLand?.(-this.vel.y);
        this.pos.y = floor;
        this.vel.y = 0;
        this.state = 'ground';
      }
    } else if (this.state === 'ground') {
      this.state = 'air';
      this.airTime = 0;
    }

    // Eau
    if (this.pos.y < swimLine - 0.05 && this.state !== 'ground') {
      if (this.state !== 'swim') {
        this.events.onSplash?.();
        this.vel.y *= 0.3;
      }
      this.state = 'swim';
      this.crouching = false;
    } else if (this.state === 'swim' && this.pos.y > swimLine + 0.25) {
      this.state = 'air';
    } else if (this.state === 'swim' && floor > swimLine - 0.1) {
      this.state = 'ground';
      this.pos.y = Math.max(this.pos.y, floor);
    }

    if (this.state === 'ground') {
      this.groundTime += dt;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      this.groundTime = 0;
    }

    // Orientation du corps vers la direction de déplacement.
    if (moving && this.horizontalSpeed > 0.3) this.turnTowards(Math.atan2(-this.vel.x, -this.vel.z), dt * 10);

    // Pas
    if (this.state === 'ground' && this.horizontalSpeed > 0.4) {
      const stride = this.f.height * 0.62;
      this.stepPhase += (this.horizontalSpeed * dt) / stride;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.events.onStep?.(this.crouching ? 0.15 : Math.min(1, this.horizontalSpeed / this.f.run));
      }
    }
  }

  /** Retourne le sommet de plateforme le plus haut sous les pieds ; repousse latéralement. */
  private resolveCylinders(prevY: number): number {
    const R = this.f.radius;
    const H = this.crouching ? this.f.height * 0.65 : this.f.height;
    let top = -Infinity;
    this.blockedBy = null;
    const list = this.world.colliders(this.pos.x, this.pos.z, R + 0.5, this.cyl);
    for (const c of list) {
      const dx = this.pos.x - c.x;
      const dz = this.pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const minD = c.r + R;
      if (d >= minD) continue;
      const feet = this.pos.y;
      const head = feet + H;
      if (c.platform && feet >= c.y1 - 0.45 && prevY >= c.y1 - 0.45 && d < c.r + R * 0.4) {
        if (c.y1 > top) top = c.y1;
        continue;
      }
      if (head <= c.y0 || feet >= c.y1) continue;
      if (prevY + H <= c.y0 + 0.05 && this.vel.y > 0) {
        this.pos.y = c.y0 - H;
        this.vel.y = 0;
        continue;
      }
      // Poussée latérale
      const k = d > 1e-4 ? minD / d : 1;
      this.pos.x = c.x + (d > 1e-4 ? dx : 1) * k;
      this.pos.z = c.z + (d > 1e-4 ? dz : 0) * k;
      const nl = Math.hypot(dx, dz) || 1;
      const ux = dx / nl;
      const uz = dz / nl;
      const vd = this.vel.x * ux + this.vel.z * uz;
      if (vd < 0) {
        this.vel.x -= ux * vd;
        this.vel.z -= uz * vd;
      }
      this.blockedBy = c;
    }
    return top;
  }

  // -------------------------------------------------------------------------------------------
  // Escalade de falaise (Sylmar)
  private startClimb(): void {
    this.state = 'climb';
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.crouching = false;
    this.events.onClimbStart?.();
  }

  private updateClimb(dt: number, input: PlayerInput): void {
    const w = this.world;
    const n = this.normal;
    w.ground(this.pos.x, this.pos.z, n);
    if (input.jumpPressed) {
      this.leap(n.x, n.z);
      return;
    }
    if (input.crouchPressed || this.stamina <= 0) {
      this.letGo(n.x, n.z);
      return;
    }
    // Repère tangent : u = pente montante, r = droite du joueur face à la paroi.
    let ux = -n.x * n.y;
    let uy = 1 - n.y * n.y;
    let uz = -n.z * n.y;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    const rx = uy * n.z - uz * n.y;
    const rz = ux * n.y - uy * n.x;
    const speed = input.sprint ? 3.4 : 2.3;
    const mx = (ux * input.fwd + rx * input.right) * speed * dt;
    const mz = (uz * input.fwd + rz * input.right) * speed * dt;
    const moving = Math.abs(input.fwd) + Math.abs(input.right) > 0.1;
    this.stamina = Math.max(0, this.stamina - (moving ? (input.sprint ? 9 : 5.5) : 2.5) * dt);
    const oldY = this.pos.y;
    this.pos.x += mx;
    this.pos.z += mz;
    this.pos.y = w.ground(this.pos.x, this.pos.z, n) + 0.02;
    this.vel.x = mx / dt;
    this.vel.z = mz / dt;
    this.vel.y = (this.pos.y - oldY) / dt;
    this.turnTowards(Math.atan2(n.x, n.z), dt * 12);
    if (moving) {
      this.stepPhase += dt * 1.6;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.events.onStep?.(0.35);
      }
    }
    // Rétablissement sur un replat.
    if (n.y > COS_CLIMB_EXIT) {
      this.state = 'ground';
      this.vel.x = this.vel.y = this.vel.z = 0;
    }
    if (this.pos.y < w.waterLevel - this.f.height * 0.5) this.letGo(n.x, n.z);
  }

  // -------------------------------------------------------------------------------------------
  // Escalade de tronc de Colonnier (Sylmar)
  private startTrunk(c: Cylinder): void {
    this.state = 'trunk';
    this.trunk = c;
    this.trunkAngle = Math.atan2(this.pos.z - c.z, this.pos.x - c.x);
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.crouching = false;
    this.events.onClimbStart?.();
  }

  private updateTrunk(dt: number, input: PlayerInput): void {
    const c = this.trunk!;
    const R = this.f.radius;
    const ox = Math.cos(this.trunkAngle);
    const oz = Math.sin(this.trunkAngle);
    if (input.jumpPressed) {
      this.leap(ox, oz);
      return;
    }
    if (input.crouchPressed || this.stamina <= 0) {
      this.letGo(ox, oz);
      return;
    }
    const speed = input.sprint ? 3.6 : 2.5;
    const moving = Math.abs(input.fwd) + Math.abs(input.right) > 0.1;
    this.stamina = Math.max(0, this.stamina - (moving ? 4.5 : 2) * dt);
    const oldY = this.pos.y;
    this.pos.y += input.fwd * speed * dt;
    this.trunkAngle -= (input.right * speed * dt) / (c.r + R);
    const rr = c.r + R + 0.03;
    this.pos.x = c.x + Math.cos(this.trunkAngle) * rr;
    this.pos.z = c.z + Math.sin(this.trunkAngle) * rr;
    this.vel.x = this.vel.z = 0;
    this.vel.y = (this.pos.y - oldY) / dt;
    this.turnTowards(Math.atan2(Math.cos(this.trunkAngle), Math.sin(this.trunkAngle)), dt * 14);
    if (moving) {
      this.stepPhase += dt * 1.8;
      if (this.stepPhase >= 1) {
        this.stepPhase -= 1;
        this.events.onStep?.(0.3);
      }
    }
    // Ombrelle au-dessus : se hisser dessus.
    const H = this.f.height;
    const list = this.world.colliders(c.x, c.z, 1, this.cyl);
    for (const d of list) {
      if (d === c || !d.platform || d.climbable) continue;
      if (Math.hypot(d.x - c.x, d.z - c.z) > 0.5) continue;
      if (this.pos.y + H > d.y0 && this.pos.y < d.y1) {
        const out = c.r + R + 1.4;
        this.startMantle(c.x + Math.cos(this.trunkAngle) * out, d.y1, c.z + Math.sin(this.trunkAngle) * out);
        return;
      }
    }
    if (this.pos.y > c.y1 - 0.2) {
      this.startMantle(c.x, c.y1, c.z);
      return;
    }
    // Retour au sol.
    const g = this.world.ground(this.pos.x, this.pos.z);
    if (this.pos.y <= g + 0.02 && input.fwd <= 0) {
      this.pos.y = g;
      this.state = 'ground';
      this.trunk = null;
    }
  }

  private startMantle(x: number, y: number, z: number): void {
    this.state = 'mantle';
    this.mantleFrom = { ...this.pos };
    this.mantleTo = { x, y, z };
    this.mantleT = 0;
    this.trunk = null;
  }

  private updateMantle(dt: number): void {
    this.mantleT = Math.min(1, this.mantleT + dt / 0.65);
    const t = this.mantleT;
    const up = Math.min(1, t * 1.8);
    const across = Math.max(0, (t - 0.35) / 0.65);
    const a = this.mantleFrom;
    const b = this.mantleTo;
    this.pos.y = a.y + (b.y - a.y) * (1 - (1 - up) * (1 - up));
    this.pos.x = a.x + (b.x - a.x) * across;
    this.pos.z = a.z + (b.z - a.z) * across;
    if (t >= 1) {
      this.state = 'ground';
      this.vel.x = this.vel.y = this.vel.z = 0;
    }
  }

  private leap(ox: number, oz: number): void {
    const l = Math.hypot(ox, oz) || 1;
    this.vel.x = (ox / l) * 4.5;
    this.vel.z = (oz / l) * 4.5;
    this.vel.y = 4.5;
    this.state = 'air';
    this.airTime = 0.3;
    this.trunk = null;
    this.regrabCooldown = 0.45;
    this.events.onJump?.();
  }

  private letGo(ox: number, oz: number): void {
    const l = Math.hypot(ox, oz) || 1;
    this.vel.x = (ox / l) * 1.2;
    this.vel.z = (oz / l) * 1.2;
    this.vel.y = 0;
    this.state = 'air';
    this.airTime = 0.3;
    this.trunk = null;
    this.regrabCooldown = 0.8;
  }

  private turnTowards(target: number, k: number): void {
    let d = target - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw += d * Math.min(1, k);
  }

  private clampWorld(): void {
    const d = this.world.edgeDistance(this.pos.x, this.pos.z);
    if (d > WORLD_LIMIT) {
      const k = WORLD_LIMIT / d;
      this.pos.x *= k;
      this.pos.z *= k;
      this.vel.x *= -0.2;
      this.vel.z *= -0.2;
    }
  }

  get nearWorldEdge(): boolean {
    return this.world.edgeDistance(this.pos.x, this.pos.z) > WORLD_LIMIT - 120;
  }
}

function approach(v: Vec3, tx: number, tz: number, maxDelta: number): void {
  const dx = tx - v.x;
  const dz = tz - v.z;
  const d = Math.hypot(dx, dz);
  if (d <= maxDelta) {
    v.x = tx;
    v.z = tz;
  } else {
    v.x += (dx / d) * maxDelta;
    v.z += (dz / d) * maxDelta;
  }
}

/** Vrai si le déplacement voulu pointe vers la direction (dx, dz). */
function towards(input: PlayerInput, dx: number, dz: number): boolean {
  const l = Math.hypot(dx, dz);
  const m = Math.hypot(input.moveX, input.moveZ);
  if (l < 1e-5 || m < 0.1) return false;
  return (input.moveX * dx + input.moveZ * dz) / (l * m) > 0.45;
}
