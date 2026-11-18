// Uniformes partagés par tous les matériaux + remplacement du brouillard de Three.js
// par un brouillard de hauteur analytique (brume qui s'accumule dans les vallées).

import { Color, Material, ShaderChunk, Vector3, Vector4 } from 'three';

export const G = {
  uFogParams: { value: new Vector4(0.006, 0.04, 0, 0.00012) }, // densité à la base, décroissance, hauteur de base, densité de distance
  uFogParams2: { value: new Vector4(0.6, 0.004, 0.002, 0) }, // part de bruit, dérive x, dérive z, temps
  uFogSunDir: { value: new Vector3(0, 1, 0) },
  uFogSunColor: { value: new Color(0, 0, 0) },
  uTime: { value: 0 },
  uWind: { value: new Vector3(1, 0, 0.4) }, // direction xy + force z
  uNight: { value: 0 }, // 0 jour → 1 nuit (intensité bioluminescente)
  uPulse: { value: new Vector4(0, 0, 0, 0) }, // origine xz, rayon, intensité
  uPulseColor: { value: new Color(0.5, 0.3, 1) },
  uPulseMode: { value: 0 }, // 0 = Écho sylmar, 1 = scan Halden
  uWaterLevel: { value: 0 },
};

export const FOG_GLSL = /* glsl */ `
uniform vec4 uFogParams;
uniform vec4 uFogParams2;
uniform vec3 uFogSunDir;
uniform vec3 uFogSunColor;
float vfHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vfNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(vfHash(i), vfHash(i + vec2(1.0, 0.0)), u.x), mix(vfHash(i + vec2(0.0, 1.0)), vfHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float veyraFogAmount(vec3 wp, vec3 cam) {
  vec3 ray = wp - cam;
  float dist = length(ray);
  float b = uFogParams.y;
  float h0 = clamp(cam.y - uFogParams.z, -60.0, 600.0);
  float h1 = clamp(wp.y - uFogParams.z, -60.0, 600.0);
  float dy = h1 - h0;
  float e0 = exp(-b * h0);
  float hint = abs(dy) > 0.05 ? (e0 - exp(-b * h1)) / (b * dy) * dist : e0 * dist;
  vec2 drift = uFogParams2.yz * uFogParams2.w;
  float nz = vfNoise(wp.xz * 0.006 + drift) * 0.65 + vfNoise(wp.xz * 0.021 - drift * 1.7) * 0.35;
  hint *= mix(1.0, nz * 1.6 + 0.1, uFogParams2.x);
  float t = uFogParams.x * hint + uFogParams.w * dist;
  return 1.0 - exp(-max(t, 0.0));
}
vec3 veyraFog(vec3 col, vec3 wp, vec3 cam, vec3 fogCol) {
  float f = veyraFogAmount(wp, cam);
  vec3 dir = normalize(wp - cam);
  float sunAmt = pow(max(dot(dir, uFogSunDir), 0.0), 6.0);
  return mix(col, fogCol + uFogSunColor * sunAmt, f);
}
`;

let installed = false;

/** À appeler une fois avant toute compilation de matériau. */
export function installGlobalShaderHooks(): void {
  if (installed) return;
  installed = true;
  ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
#endif`;
  ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorldPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorldPos;
  ${FOG_GLSL}
#endif`;
  ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  gl_FragColor.rgb = veyraFog(gl_FragColor.rgb, vFogWorldPos, cameraPosition, fogColor);
#endif`;

  // Chaque matériau reçoit les uniformes globaux (références partagées).
  Material.prototype.onBeforeCompile = function (shader: { uniforms: Record<string, { value: unknown }> }) {
    injectGlobals(shader.uniforms);
  };
}

export function injectGlobals(uniforms: Record<string, { value: unknown }>): void {
  for (const k of Object.keys(G) as (keyof typeof G)[]) uniforms[k] = G[k];
}
