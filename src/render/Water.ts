// Eau des rivières, lacs et marais : vagues analytiques, Fresnel vers le ciel, reflet du soleil,
// plancton bioluminescent la nuit. Limitée à l'intérieur du continent (au-delà : Mer de Brume).

import { BufferGeometry, Color, Float32BufferAttribute, Mesh, ShaderMaterial, Vector3 } from 'three';
import { FOG_GLSL } from './Globals.ts';
import { WATER_EDGE, WATER_LEVEL } from '../world/WorldGen.ts';

const VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDirW;
uniform vec3 uSunColorW;
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uFogCol;
uniform float uNight;
uniform float uRain;
uniform float uEdge;
varying vec3 vWPos;
${FOG_GLSL}

vec2 waveGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 dirs[4];
  dirs[0] = normalize(vec2(1.0, 0.3)); dirs[1] = normalize(vec2(-0.4, 1.0));
  dirs[2] = normalize(vec2(0.7, -0.8)); dirs[3] = normalize(vec2(-0.9, -0.2));
  float freqs[4]; freqs[0] = 0.35; freqs[1] = 0.6; freqs[2] = 1.3; freqs[3] = 2.4;
  float amps[4]; amps[0] = 0.09; amps[1] = 0.06; amps[2] = 0.035; amps[3] = 0.02;
  for (int i = 0; i < 4; i++) {
    float ph = dot(p, dirs[i]) * freqs[i] + t * (0.8 + freqs[i] * 0.9);
    g += dirs[i] * cos(ph) * freqs[i] * amps[i];
  }
  return g;
}

void main() {
  vec2 g = waveGrad(vWPos.xz, uTime) + waveGrad(vWPos.xz * 3.1 + 7.0, uTime * 1.3) * (0.35 + uRain * 0.8);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = normalize(cameraPosition - vWPos);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 R = reflect(-V, N);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(max(R.y, 0.0), 0.6));
  vec3 H = normalize(uSunDirW + V);
  float spec = pow(max(dot(N, H), 0.0), 220.0) * 6.0 * smoothstep(-0.05, 0.05, uSunDirW.y + 0.02);
  vec3 col = mix(uDeep, sky, fres) + uSunColorW * spec;
  // plancton bioluminescent
  float pl = fract(sin(dot(floor(vWPos.xz * 1.7), vec2(12.9898, 78.233))) * 43758.5453);
  float tw = 0.5 + 0.5 * sin(uTime * 2.0 + pl * 40.0);
  col += vec3(0.35, 0.25, 1.0) * step(0.985, pl) * tw * uNight * 1.6;
  float alpha = mix(0.78, 0.97, fres);
  col = veyraFog(col, vWPos, cameraPosition, uFogCol);
  gl_FragColor = vec4(col, alpha);
}
`;

export class Water {
  readonly mesh: Mesh;
  readonly uniforms = {
    uTime: { value: 0 },
    uSunDirW: { value: new Vector3(0, 1, 0) },
    uSunColorW: { value: new Color(1, 1, 1) },
    uSkyZenith: { value: new Color() },
    uSkyHorizon: { value: new Color() },
    uDeep: { value: new Color(0.02, 0.06, 0.07) },
    uFogCol: { value: new Color() },
    uNight: { value: 0 },
    uRain: { value: 0 },
    uEdge: { value: WATER_EDGE },
  };

  constructor() {
    const mat = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
    });
    const geo = superellipseDisk(WATER_EDGE, 160);
    this.mesh = new Mesh(geo, mat);
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.renderOrder = 10;
    this.mesh.name = 'water';
  }
}

/** Disque plat (y = 0) dont le bord suit la super-ellipse |x|⁴ + |z|⁴ = r⁴ (contour du continent). */
function superellipseDisk(r: number, segments: number): BufferGeometry {
  const pos: number[] = [0, 0, 0];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = r / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25);
    pos.push(c * k, 0, s * k);
  }
  const idx: number[] = [];
  for (let i = 1; i <= segments; i++) idx.push(0, i + 1, i);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
