// Caméra à la troisième personne : orbite souris/manette, collision avec le relief, zoom.

import { PerspectiveCamera, Vector3 } from 'three';
import type { Input } from '../core/Input.ts';
import type { Cylinder } from '../world/VegetationPlacement.ts';

export class CameraRig {
  yaw = 0;
  pitch = 0.25;
  distance = 6;
  targetDistance = 6;
  sensitivity = 1;
  invertY = false;
  private target = new Vector3();
  private smoothedTarget = new Vector3();
  private initialized = false;
  private camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Vecteurs de déplacement horizontaux relatifs à la caméra. */
  forward(): [number, number] {
    return [-Math.sin(this.yaw), -Math.cos(this.yaw)];
  }
  right(): [number, number] {
    return [Math.cos(this.yaw), -Math.sin(this.yaw)];
  }

  handleInput(input: Input, dt: number): void {
    const s = 0.0022 * this.sensitivity;
    this.yaw -= input.mouseDX * s;
    this.pitch += input.mouseDY * s * (this.invertY ? -1 : 1);
    this.yaw -= input.lookX * 2.6 * this.sensitivity * dt;
    this.pitch += input.lookY * 1.8 * this.sensitivity * dt * (this.invertY ? -1 : 1);
    this.pitch = Math.max(-1.0, Math.min(1.25, this.pitch));
    if (input.wheel) this.targetDistance = Math.max(2.2, Math.min(18, this.targetDistance * (1 + input.wheel * 0.12)));
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, focus: Vector3, ground: (x: number, z: number) => number, obstacles: Cylinder[] = []): void {
    this.target.copy(focus);
    if (!this.initialized) {
      this.smoothedTarget.copy(focus);
      this.distance = this.targetDistance;
      this.initialized = true;
    }
    const k = 1 - Math.exp(-18 * dt);
    this.smoothedTarget.lerp(this.target, k);
    // Décalage d'épaule
    const [rx, rz] = this.right();
    const t = this.smoothedTarget;
    const tx = t.x + rx * 0.45;
    const tz = t.z + rz * 0.45;
    const ty = t.y + 0.15;
    const cp = Math.cos(this.pitch);
    const dx = Math.sin(this.yaw) * cp;
    const dy = Math.sin(this.pitch);
    const dz = Math.cos(this.yaw) * cp;
    // Collision : recul limité par le relief.
    let allowed = this.targetDistance;
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * this.targetDistance;
      const x = tx + dx * d;
      const y = ty + dy * d;
      const z = tz + dz * d;
      if (y < ground(x, z) + 0.45 || insideAny(obstacles, x, y, z)) {
        allowed = Math.max(0.8, d - 0.5);
        break;
      }
    }
    const kd = allowed < this.distance ? 1 - Math.exp(-25 * dt) : 1 - Math.exp(-4 * dt);
    this.distance += (allowed - this.distance) * kd;
    const cx = tx + dx * this.distance;
    const cz = tz + dz * this.distance;
    let cy = ty + dy * this.distance;
    cy = Math.max(cy, ground(cx, cz) + 0.4);
    this.camera.position.set(cx, cy, cz);
    this.camera.lookAt(tx, ty, tz);
  }
}

/** Vrai si le point est dans un cylindre (tronc, ombrelle, rocher), avec une petite marge. */
function insideAny(list: Cylinder[], x: number, y: number, z: number): boolean {
  for (const c of list) {
    if (y < c.y0 - 0.2 || y > c.y1 + 0.2) continue;
    const dx = x - c.x;
    const dz = z - c.z;
    const r = c.r + 0.3;
    if (dx * dx + dz * dz < r * r) return true;
  }
  return false;
}
