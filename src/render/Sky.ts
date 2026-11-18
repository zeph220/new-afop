// Ciel procédural de Veyra : dégradé atmosphérique, soleil Kaïr, géante gazeuse Orun
// (bandes cuivre/rose/ivoire, phase, anneau fin), étoiles, nuages, éclairs.

import { BackSide, Color, Mesh, ShaderMaterial, SphereGeometry, Vector2, Vector3 } from 'three';
import { FOG_GLSL } from './Globals.ts';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // toujours au plan lointain
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uOrunDir;
uniform vec3 uOrunAxis;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uFogCol;
uniform vec3 uCloudColor;
uniform float uCloudCover;
uniform float uStars;
uniform float uFlash;
uniform float uSkyTime;
uniform float uDay;
uniform vec2 uCloudWind;
varying vec3 vDir;
${FOG_GLSL}

float sh(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  float d = fract(sin(dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm2(vec2 p) {
  float s = 0.0; float a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float hz = pow(1.0 - max(y, 0.0), 3.5);
  vec3 col = mix(uZenith, uHorizon, hz);

  // Kaïr : halo et disque
  float sd = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(sd, 6.0) * 0.18 + pow(sd, 90.0) * 0.8);
  col += uSunColor * smoothstep(0.99955, 0.9998, sd) * 30.0 * smoothstep(-0.06, 0.02, uSunDir.y);

  // Étoiles
  if (uStars > 0.01 && y > -0.05) {
    vec3 sp = d * 260.0;
    vec3 cell = floor(sp);
    float h = sh(cell);
    if (h > 0.9965) {
      vec3 c = cell + vec3(sh(cell + 1.1), sh(cell + 2.3), sh(cell + 3.7));
      float dd = length(sp - c);
      float tw = 0.6 + 0.4 * sin(uSkyTime * 2.5 + h * 517.0);
      vec3 sc = mix(vec3(1.0, 0.85, 0.75), vec3(0.75, 0.85, 1.0), fract(h * 91.0));
      col += sc * smoothstep(0.4, 0.0, dd) * uStars * tw * 2.5;
    }
  }

  // Orun : sphère éclairée par Kaïr
  vec3 C = uOrunDir;
  float Rp = sin(0.2);
  float b = dot(d, C);
  float disc = b * b - (dot(C, C) - Rp * Rp);
  float tPlanet = 1e9;
  if (disc > 0.0) {
    tPlanet = b - sqrt(disc);
    vec3 P = d * tPlanet;
    vec3 N = normalize(P - C);
    float lat = dot(N, uOrunAxis);
    vec3 ref = normalize(cross(uOrunAxis, vec3(0.0, 1.0, 0.0)));
    vec3 ref2 = cross(uOrunAxis, ref);
    float lon = atan(dot(N, ref2), dot(N, ref));
    float turb = fbm2(vec2(lon * 2.0 + uSkyTime * 0.004, lat * 14.0));
    float band = lat * 9.0 + 0.3 * sin(lon * 3.0 + lat * 11.0) + 0.6 * turb;
    vec3 copper = vec3(0.62, 0.32, 0.2);
    vec3 rose = vec3(0.78, 0.52, 0.5);
    vec3 ivory = vec3(0.9, 0.85, 0.76);
    vec3 pc = mix(copper, rose, 0.5 + 0.5 * sin(band * 3.1));
    pc = mix(pc, ivory, smoothstep(0.55, 1.0, sin(band * 1.7 + 1.0)));
    // Tempête ovale ambrée (« l'Œil d'Orun »)
    vec2 eye = vec2(lon - 0.9, (lat + 0.32) * 3.2);
    pc = mix(pc, vec3(0.95, 0.6, 0.25), smoothstep(0.35, 0.1, length(eye)) * 0.8);
    float lit = max(dot(N, uSunDir), 0.0);
    float term = smoothstep(-0.05, 0.25, dot(N, uSunDir));
    float rim = pow(1.0 - max(dot(N, -d), 0.0), 3.0);
    vec3 planet = pc * (lit * 1.25 * term + 0.03) + vec3(0.9, 0.55, 0.45) * rim * 0.25 * (term + 0.15);
    float edge = smoothstep(0.0, 0.0012, disc);
    col = mix(col, planet + col * (0.25 + 0.45 * uDay), edge);
  }
  // Anneau d'Orun (plan équatorial)
  float dn = dot(d, uOrunAxis);
  if (abs(dn) > 1e-4) {
    float tr = dot(C, uOrunAxis) / dn;
    if (tr > 0.0 && tr < tPlanet) {
      float rr = length(d * tr - C) / Rp;
      if (rr > 1.4 && rr < 2.15) {
        float rb = 0.5 + 0.5 * sin(rr * 46.0) * sin(rr * 13.0);
        float alpha = smoothstep(1.4, 1.5, rr) * smoothstep(2.15, 2.0, rr) * (0.25 + 0.45 * rb);
        vec3 ringCol = vec3(0.86, 0.8, 0.72) * (0.25 + 1.1 * max(dot(uOrunAxis, uSunDir) * sign(dn) * -1.0 + 0.6, 0.15));
        col = mix(col, ringCol, alpha * 0.55);
      }
    }
  }

  // Nuages (couche plane projetée)
  if (y > 0.0 && uCloudCover > 0.01) {
    vec2 uv = d.xz / (y + 0.1) * 0.9 + uCloudWind * uSkyTime;
    float n = fbm2(uv);
    float cov = smoothstep(1.0 - uCloudCover, 1.0 - uCloudCover + 0.3, n);
    float sn = fbm2(uv + uSunDir.xz * 0.12);
    vec3 cc = mix(uCloudColor * 0.5, uCloudColor * 1.15, clamp(0.5 + (n - sn) * 3.0, 0.0, 1.0));
    cc += uSunColor * pow(sd, 5.0) * 0.5 * (1.0 - cov * 0.5);
    col = mix(col, cc, cov * smoothstep(0.0, 0.12, y) * 0.95);
  }

  // Brume d'horizon (même modèle que le terrain)
  vec3 far = cameraPosition + d * 4000.0;
  float f = veyraFogAmount(far, cameraPosition) * mix(1.0, 0.1, smoothstep(0.0, 0.45, y));
  float sunAmt = pow(sd, 6.0);
  col = mix(col, uFogCol + uFogSunColor * sunAmt, clamp(f, 0.0, 1.0));
  col += uFlash * vec3(0.55, 0.6, 0.85) * (0.6 + 0.4 * max(y, 0.0));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  readonly mesh: Mesh;
  readonly uniforms = {
    uSunDir: { value: new Vector3(0, 1, 0) },
    uOrunDir: { value: new Vector3(-0.55, 0.53, 0.64).normalize() },
    uOrunAxis: { value: new Vector3(0.25, 0.92, -0.3).normalize() },
    uZenith: { value: new Color() },
    uHorizon: { value: new Color() },
    uSunColor: { value: new Color() },
    uFogCol: { value: new Color() },
    uCloudColor: { value: new Color(1, 1, 1) },
    uCloudCover: { value: 0.35 },
    uStars: { value: 0 },
    uFlash: { value: 0 },
    uSkyTime: { value: 0 },
    uDay: { value: 1 },
    uCloudWind: { value: new Vector2(0.004, 0.0015) },
  };

  constructor() {
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1000, 48, 24), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1000; // après les opaques : ne colore que les pixels encore vides
    this.mesh.name = 'sky';
  }

  follow(camPos: Vector3): void {
    this.mesh.position.copy(camPos);
  }
}
