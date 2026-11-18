// Vent global : direction qui tourne lentement, rafales, force liée à la météo.
// Une seule source de vérité pour la flore, la pluie, les projectiles, le vol et l'audio.

import { Vector3 } from 'three';

const _v = new Vector3();

export class Wind {
  /** Direction horizontale (unitaire, x/z). */
  readonly dir = new Vector3(0.86, 0, 0.5);
  /** Force de base 0..1 (météo). */
  base = 0.35;
  /** Force instantanée 0..1.6 (base + rafale). */
  strength = 0.35;
  /** Rafale courante 0..1. */
  gust = 0;
  private heading = 0.53;
  private t = 0;

  update(dt: number, weatherWind: number): void {
    this.t += dt;
    this.base += (weatherWind - this.base) * Math.min(1, dt * 0.2);
    // Le cap dérive lentement (quelques degrés par minute), plus vite par tempête.
    this.heading += Math.sin(this.t * 0.011) * dt * 0.01 + Math.sin(this.t * 0.037 + 1.3) * dt * 0.006 * (1 + this.base * 3);
    this.dir.set(Math.cos(this.heading), 0, Math.sin(this.heading));
    const g = 0.5 + 0.5 * Math.sin(this.t * 0.31) * Math.sin(this.t * 0.73 + 2.1) + 0.25 * Math.sin(this.t * 1.9);
    this.gust = Math.max(0, Math.min(1, g));
    this.strength = this.base * (0.65 + 0.7 * this.gust);
  }

  /** Vitesse du vent (m/s) à une altitude donnée au-dessus du sol. */
  velocityAt(heightAboveGround: number, out = _v): Vector3 {
    const prof = Math.min(1.6, 0.45 + Math.log1p(Math.max(0, heightAboveGround)) * 0.22);
    return out.copy(this.dir).multiplyScalar(this.strength * 14 * prof);
  }

  /** Cap en degrés (0 = nord/–Z, sens horaire) d'où VIENT le vent. */
  get fromDegrees(): number {
    const a = (Math.atan2(-this.dir.x, this.dir.z) * 180) / Math.PI;
    return (a + 360) % 360;
  }

  get speedKmh(): number {
    return Math.round(this.strength * 14 * 3.6);
  }
}

/** Instance partagée (le jeu n'a qu'un vent). */
export const WIND = new Wind();
