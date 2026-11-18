// Cycle jour/nuit et météo de Veyra. Pilote les lumières, le ciel, la brume, l'eau,
// l'intensité bioluminescente, la pluie et les éclairs.

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  HemisphereLight,
  LineSegments,
  ShaderMaterial,
  Vector3,
  type Scene,
  type Fog,
} from 'three';
import { G } from '../render/Globals.ts';
import type { Sky } from '../render/Sky.ts';
import type { Water } from '../render/Water.ts';
import { clamp, lerp, smoothstep } from './noise.ts';

export type WeatherKind = 'clair' | 'brume' | 'orage';

export const WEATHER_LABEL: Record<WeatherKind, string> = { clair: 'Ciel clair', brume: 'Brume', orage: 'Orage' };

interface WeatherParams {
  cloud: number;
  fogDensity: number;
  fogFalloff: number;
  wind: number;
  rain: number;
  dim: number; // assombrissement de la lumière
  noise: number;
}

const WEATHER: Record<WeatherKind, WeatherParams> = {
  clair: { cloud: 0.32, fogDensity: 0.0045, fogFalloff: 0.045, wind: 0.35, rain: 0, dim: 0, noise: 0.55 },
  brume: { cloud: 0.5, fogDensity: 0.022, fogFalloff: 0.03, wind: 0.15, rain: 0, dim: 0.25, noise: 0.85 },
  orage: { cloud: 0.95, fogDensity: 0.011, fogFalloff: 0.02, wind: 1.0, rain: 1, dim: 0.65, noise: 0.6 },
};

const DURATION: Record<WeatherKind, [number, number]> = { clair: [240, 420], brume: [140, 240], orage: [110, 190] };

/** Durée d'un cycle jour/nuit complet en secondes réelles. */
export const DAY_LENGTH = 24 * 60;

const c = (r: number, g: number, b: number) => new Color(r, g, b);
const PAL = {
  zenithDay: c(0.1, 0.3, 0.36),
  zenithSet: c(0.16, 0.1, 0.26),
  zenithNight: c(0.012, 0.01, 0.03),
  horizonDay: c(0.62, 0.7, 0.62),
  horizonSet: c(0.95, 0.42, 0.24),
  horizonNight: c(0.035, 0.022, 0.05),
  fogDay: c(0.44, 0.54, 0.52),
  fogSet: c(0.55, 0.32, 0.28),
  fogNight: c(0.018, 0.017, 0.032),
  sunDay: c(1.0, 0.93, 0.82),
  sunSet: c(1.0, 0.45, 0.2),
  orunLight: c(0.95, 0.58, 0.62),
  hemiSkyDay: c(0.42, 0.58, 0.62),
  hemiSkyNight: c(0.07, 0.045, 0.1),
  hemiGroundDay: c(0.16, 0.18, 0.1),
  hemiGroundNight: c(0.02, 0.018, 0.03),
  storm: c(0.18, 0.2, 0.24),
};

export class Environment {
  time = 0.36; // 0 = minuit, 0.25 = lever, 0.5 = midi, 0.75 = coucher
  timeScale = 1;
  weather: WeatherKind = 'clair';
  private nextWeather: WeatherKind = 'clair';
  private weatherBlend = 1;
  private weatherTimer = 300;
  private cur: WeatherParams = { ...WEATHER.clair };
  private flash = 0;
  private nextFlash = 6;
  private elapsed = 0;
  readonly sunDir = new Vector3();
  readonly lightDir = new Vector3();
  readonly orunDir: Vector3;
  nightFactor = 0;
  exposure = 1;
  /** Bonus d'exposition nocturne (vision des Sylmar). */
  nightVision = 0;
  onThunder?: (delay: number, strength: number) => void;
  readonly sun: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly rain: Rain;
  private sky: Sky;
  private water: Water;
  private fog: Fog;

  constructor(scene: Scene, sky: Sky, water: Water, fog: Fog) {
    this.sky = sky;
    this.water = water;
    this.fog = fog;
    this.orunDir = sky.uniforms.uOrunDir.value.clone();
    this.sun = new DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new HemisphereLight(0xffffff, 0x222222, 0.6);
    scene.add(this.hemi);
    this.rain = new Rain();
    scene.add(this.rain.mesh);
  }

  /** Force une météo (sauvegarde, débogage). */
  setWeather(w: WeatherKind, immediate = false): void {
    this.weather = w;
    this.nextWeather = w;
    this.weatherBlend = immediate ? 1 : 0;
    this.weatherTimer = lerp(DURATION[w][0], DURATION[w][1], Math.random());
    if (immediate) this.cur = { ...WEATHER[w] };
  }

  get weatherLabel(): string {
    return WEATHER_LABEL[this.nextWeather];
  }

  get clockText(): string {
    const h = Math.floor(this.time * 24);
    const m = Math.floor((this.time * 24 - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  update(dt: number, camPos: Vector3, focus: Vector3): void {
    this.elapsed += dt;
    this.time = (this.time + (dt * this.timeScale) / DAY_LENGTH) % 1;
    this.updateWeather(dt);

    // Trajectoire de Kaïr : se lève à l'est (+X), culmine au sud, se couche à l'ouest.
    const a = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a) * 0.92, Math.sin(a) * 0.39).normalize();
    const e = this.sunDir.y;
    const day = smoothstep(-0.08, 0.25, e);
    const set = Math.exp(-((e - 0.04) * (e - 0.04)) / 0.008);
    const night = 1 - smoothstep(-0.2, 0.03, e);
    this.nightFactor = clamp(night + this.cur.dim * 0.35, 0, 1);
    const w = this.cur;
    const stormMix = clamp(w.dim, 0, 1);

    const zen = mixColor(PAL.zenithNight, PAL.zenithDay, day).lerp(PAL.zenithSet, set * 0.6);
    const hor = mixColor(PAL.horizonNight, PAL.horizonDay, day).lerp(PAL.horizonSet, set * 0.75);
    const fogC = mixColor(PAL.fogNight, PAL.fogDay, day).lerp(PAL.fogSet, set * 0.6);
    const stormTint = PAL.storm.clone().multiplyScalar(0.15 + 0.85 * day);
    zen.lerp(stormTint, stormMix * 0.8);
    hor.lerp(stormTint, stormMix * 0.7);
    fogC.lerp(stormTint, stormMix * 0.6);

    // Lumière principale : Kaïr le jour, reflet d'Orun la nuit (bascule quand l'intensité est minimale).
    const sunI = smoothstep(-0.04, 0.12, e) * 2.7 * (1 - w.dim * 0.75);
    const orunI = (1 - smoothstep(-0.12, 0.02, e)) * 0.22 * (1 - w.dim * 0.5);
    const sunCol = mixColor(PAL.sunSet, PAL.sunDay, smoothstep(0.02, 0.3, e));
    if (sunI >= orunI) {
      this.lightDir.copy(this.sunDir);
      this.sun.color.copy(sunCol);
      this.sun.intensity = sunI;
    } else {
      this.lightDir.copy(this.orunDir);
      this.sun.color.copy(PAL.orunLight);
      this.sun.intensity = orunI;
    }
    this.sun.intensity += this.flash * 3.5;

    this.hemi.color.copy(mixColor(PAL.hemiSkyNight, PAL.hemiSkyDay, day)).lerp(stormTint, stormMix * 0.4);
    this.hemi.groundColor.copy(mixColor(PAL.hemiGroundNight, PAL.hemiGroundDay, day));
    this.hemi.intensity = 0.75 + this.flash * 2;

    // Ombres centrées sur le point d'intérêt, avec accrochage aux texels (pas de scintillement).
    const shadowCam = this.sun.shadow.camera;
    const extent = (shadowCam.right - shadowCam.left) || 120;
    const texel = extent / (this.sun.shadow.mapSize.x || 2048);
    const snap = (v: number) => Math.round(v / texel) * texel;
    const fx = snap(focus.x);
    const fz = snap(focus.z);
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.lightDir.x * 300, focus.y + this.lightDir.y * 300, fz + this.lightDir.z * 300);
    this.sun.target.updateMatrixWorld();

    // Ciel
    const u = this.sky.uniforms;
    u.uSunDir.value.copy(this.sunDir);
    u.uZenith.value.copy(zen);
    u.uHorizon.value.copy(hor);
    u.uSunColor.value.copy(sunCol).multiplyScalar(smoothstep(-0.06, 0.05, e) * (1 - w.dim * 0.8));
    u.uFogCol.value.copy(fogC);
    u.uCloudCover.value = w.cloud;
    u.uCloudColor.value.copy(mixColor(c(0.05, 0.045, 0.07), c(1, 0.98, 0.95), day)).lerp(c(0.95, 0.55, 0.4), set * 0.6).lerp(stormTint, stormMix * 0.8);
    u.uStars.value = night * (1 - w.cloud * 0.8);
    u.uFlash.value = this.flash;
    u.uSkyTime.value = this.elapsed;
    u.uDay.value = day;
    this.sky.follow(camPos);

    // Brume (uniformes globaux)
    this.fog.color.copy(fogC);
    G.uFogParams.value.set(w.fogDensity, w.fogFalloff, 0, 0.00011 + w.dim * 0.0001);
    G.uFogParams2.value.set(w.noise, 0.004 + w.wind * 0.01, 0.002 + w.wind * 0.004, this.elapsed);
    G.uFogSunDir.value.copy(this.sunDir);
    G.uFogSunColor.value.copy(sunCol).multiplyScalar(0.35 * smoothstep(-0.05, 0.1, e) * (1 - w.dim));
    G.uNight.value = this.nightFactor;
    G.uWind.value.set(0.85, 0.5, w.wind);
    G.uTime.value = this.elapsed;

    // Eau
    const wu = this.water.uniforms;
    wu.uSunDirW.value.copy(this.lightDir);
    wu.uSunColorW.value.copy(this.sun.color).multiplyScalar(this.sun.intensity * 0.6);
    wu.uSkyZenith.value.copy(zen);
    wu.uSkyHorizon.value.copy(hor);
    wu.uFogCol.value.copy(fogC);
    wu.uRain.value = w.rain;

    this.exposure = lerp(0.95, 1.2 + this.nightVision * 0.6, night) * (1 + w.dim * 0.12);
    this.rain.update(camPos, this.elapsed, w.rain, fogC);

    // Éclairs
    if (w.rain > 0.5) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.nextFlash = 3 + Math.random() * 10;
        this.flash = 1;
        this.onThunder?.(0.4 + Math.random() * 2.5, 0.5 + Math.random() * 0.5);
      }
    }
    this.flash = Math.max(0, this.flash - dt * 3.5) * (Math.random() > 0.15 ? 1 : 0.4);
  }

  private updateWeather(dt: number): void {
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) {
      const r = Math.random();
      const from = this.nextWeather;
      const to: WeatherKind =
        from === 'clair' ? (r < 0.5 ? 'brume' : r < 0.8 ? 'orage' : 'clair') : from === 'brume' ? (r < 0.6 ? 'clair' : 'orage') : r < 0.7 ? 'clair' : 'brume';
      this.nextWeather = to;
      this.weather = to;
      this.weatherBlend = 0;
      this.weatherTimer = lerp(DURATION[to][0], DURATION[to][1], Math.random());
    }
    const target = WEATHER[this.nextWeather];
    if (this.weatherBlend < 1) this.weatherBlend = Math.min(1, this.weatherBlend + dt / 25);
    const k = Math.min(1, dt * 0.08 + (this.weatherBlend >= 1 ? 1 : 0));
    for (const key of Object.keys(target) as (keyof WeatherParams)[]) {
      this.cur[key] = lerp(this.cur[key], target[key], k);
    }
  }

  get windStrength(): number {
    return this.cur.wind;
  }
  get rainAmount(): number {
    return this.cur.rain;
  }
}

function mixColor(a: Color, b: Color, t: number): Color {
  return a.clone().lerp(b, t);
}

/** Pluie : traînées instanciées autour de la caméra, animées dans le vertex shader. */
class Rain {
  readonly mesh: LineSegments;
  private mat: ShaderMaterial;
  constructor(count = 6000) {
    const pos = new Float32Array(count * 2 * 3);
    const seed = new Float32Array(count * 2 * 4);
    for (let i = 0; i < count; i++) {
      const sx = Math.random();
      const sy = Math.random();
      const sz = Math.random();
      for (let e = 0; e < 2; e++) {
        const k = (i * 2 + e) * 4;
        seed[k] = sx;
        seed[k + 1] = sy;
        seed[k + 2] = sz;
        seed[k + 3] = e;
      }
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new Float32BufferAttribute(seed, 4));
    this.mat = new ShaderMaterial({
      uniforms: {
        uCam: { value: new Vector3() },
        uT: { value: 0 },
        uRainAmt: { value: 0 },
        uCol: { value: new Color() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        uniform vec3 uCam; uniform float uT;
        varying float vEnd;
        void main() {
          vec3 box = vec3(70.0, 40.0, 70.0);
          vec3 vel = vec3(2.5, -22.0, 1.2);
          vec3 p = aSeed.xyz * box + vel * uT;
          p = mod(p - uCam - box * 0.5, box) + uCam - box * 0.5;
          p -= vel * 0.035 * aSeed.w;
          vEnd = aSeed.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uRainAmt; uniform vec3 uCol;
        varying float vEnd;
        void main() { gl_FragColor = vec4(uCol, (0.08 + 0.25 * vEnd) * uRainAmt); }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new LineSegments(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'rain';
  }

  update(cam: Vector3, t: number, amount: number, fogColor: Color): void {
    this.mesh.visible = amount > 0.02;
    const u = this.mat.uniforms;
    u.uCam.value.copy(cam);
    u.uT.value = t;
    u.uRainAmt.value = amount;
    (u.uCol.value as Color).copy(fogColor).multiplyScalar(1.4).addScalar(0.15);
  }
}
