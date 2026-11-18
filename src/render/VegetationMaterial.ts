// Matériau de la flore : vent dans le vertex shader, bioluminescence et ondes de capacité.

import { Color, DoubleSide, FrontSide, MeshStandardMaterial } from 'three';
import { injectGlobals } from './Globals.ts';

export interface VegMaterialOptions {
  glowColor: Color;
  glowBoost?: number; // intensité nocturne
  doubleSide?: boolean;
  roughness?: number;
  windAmp?: number;
}

const VERT_PARS = /* glsl */ `
attribute float aGlow;
attribute float aFlex;
uniform float uTime;
uniform vec3 uWind;
uniform float uWindAmp;
varying float vGlow;
varying vec3 vVegWorld;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
{
  vec3 instPos = vec3(0.0);
  #ifdef USE_INSTANCING
    instPos = instanceMatrix[3].xyz;
  #endif
  float ph = uTime * (1.3 + uWind.z * 0.8) + dot(instPos.xz, vec2(0.13, 0.17));
  float sway = sin(ph) * 0.6 + sin(ph * 2.3 + 1.3) * 0.25;
  vec2 gust = uWind.xy * uWind.z * (0.55 + 0.45 * sway);
  vec2 jitter = vec2(sway, cos(ph * 1.3)) * (0.12 + 0.25 * uWind.z);
  transformed.xz += (gust + jitter) * aFlex * uWindAmp;
  transformed.y -= length(gust + jitter) * aFlex * aFlex * uWindAmp * 0.25;
  vGlow = aGlow;
  vec4 vw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    vw = instanceMatrix * vw;
  #endif
  vVegWorld = (modelMatrix * vw).xyz;
}
`;

const FRAG_PARS = /* glsl */ `
uniform vec3 uGlowColor;
uniform float uGlowBoost;
uniform float uNight;
uniform vec4 uPulse;
uniform vec3 uPulseColor;
uniform float uPulseMode;
varying float vGlow;
varying vec3 vVegWorld;
`;

const FRAG_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float pulse = 0.0;
  if (uPulse.w > 0.001) {
    float d = distance(vVegWorld.xz, uPulse.xy);
    pulse = exp(-abs(d - uPulse.z) * 0.22) * uPulse.w;
    if (uPulseMode < 0.5) pulse += step(d, uPulse.z) * uPulse.w * 0.2; // l'Écho laisse la flore illuminée
  }
  float sylmarBoost = uPulseMode < 0.5 ? 1.6 : 0.5;
  totalEmissiveRadiance += uGlowColor * vGlow * (uNight * uGlowBoost + 0.04 + pulse * sylmarBoost);
  totalEmissiveRadiance += uPulseColor * pulse * 0.12 * (1.0 - vGlow);
}
`;

export function createVegetationMaterial(o: VegMaterialOptions): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({
    vertexColors: true,
    roughness: o.roughness ?? 0.82,
    metalness: 0,
    side: o.doubleSide ? DoubleSide : FrontSide,
  });
  const glowColor = { value: o.glowColor };
  const glowBoost = { value: o.glowBoost ?? 1.6 };
  const windAmp = { value: o.windAmp ?? 1 };
  mat.onBeforeCompile = (shader) => {
    injectGlobals(shader.uniforms);
    shader.uniforms.uGlowColor = glowColor;
    shader.uniforms.uGlowBoost = glowBoost;
    shader.uniforms.uWindAmp = windAmp;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + VERT_PARS).replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <emissivemap_fragment>', FRAG_EMISSIVE)
      // Feuillage double face : les deux faces gardent la normale « vers le ciel » (sinon le revers est noir).
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n  normal = normalize(vNormal);');
  };
  mat.customProgramCacheKey = () => 'veyra-veg';
  return mat;
}
