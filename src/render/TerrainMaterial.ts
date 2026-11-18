// Matériau du terrain : MeshStandardMaterial étendu (géomorphing, mélange de 4 matériaux PBR,
// roche triplanaire, strates, veines d'orvène, teinte sous-marine, canopée lointaine, scan Halden).

import {
  DataArrayTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { injectGlobals } from './Globals.ts';
import type { MaterialTexture } from '../textures/TextureGen.ts';

export function buildArrayTextures(layers: MaterialTexture[], anisotropy: number): { albedo: DataArrayTexture; normal: DataArrayTexture } {
  const size = layers[0].size;
  const albedoData = new Uint8Array(size * size * 4 * layers.length);
  const normalData = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((l, i) => {
    albedoData.set(l.albedoRough, i * size * size * 4);
    normalData.set(l.normalHeight, i * size * size * 4);
  });
  const make = (data: Uint8Array, srgb: boolean) => {
    const t = new DataArrayTexture(data, size, size, layers.length);
    t.format = RGBAFormat;
    t.type = UnsignedByteType;
    t.wrapS = t.wrapT = RepeatWrapping;
    t.minFilter = LinearMipmapLinearFilter;
    t.magFilter = LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = anisotropy;
    t.colorSpace = srgb ? SRGBColorSpace : NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { albedo: make(albedoData, true), normal: make(normalData, false) };
}

const VERT_PARS = /* glsl */ `
attribute vec3 aMorph;
varying vec3 vTWPos;
varying vec3 vTWNormal;
varying float vTForest;
`;

const VERT_MAIN = /* glsl */ `
#include <begin_vertex>
{
  vec4 tWp0 = modelMatrix * vec4(transformed, 1.0);
  float tCamD = distance(tWp0.xyz, cameraPosition);
  float tMorph = clamp((tCamD - aMorph.y * 0.7) / (aMorph.y * 0.25), 0.0, 1.0);
  transformed.y = mix(transformed.y, aMorph.x, tMorph);
  vTWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vTWNormal = objectNormal;
  vTForest = aMorph.z;
}
`;

const FRAG_PARS = /* glsl */ `
uniform highp sampler2DArray tAlbedoArr;
uniform highp sampler2DArray tNormalArr;
uniform float uNight;
uniform vec4 uPulse;
uniform vec3 uPulseColor;
uniform float uPulseMode;
uniform float uWaterLevel;
varying vec3 vTWPos;
varying vec3 vTWNormal;
varying float vTForest;
float tHash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float tNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 tUnpack(vec4 s) { return s.xyz * 2.0 - 1.0; }
`;

const FRAG_MAP = /* glsl */ `
vec3 tN = normalize(vTWNormal);
float tDist = distance(vTWPos, cameraPosition);
float tSlope = 1.0 - tN.y;
vec2 tuv = vTWPos.xz * 0.22;
vec2 tdx = dFdx(tuv);
vec2 tdy = dFdy(tuv);
vec3 tpdx = dFdx(vTWPos);
vec3 tpdy = dFdy(vTWPos);
float tMacro = tNoise(vTWPos.xz * 0.045);
float tMacro2 = tNoise(vTWPos.xz * 0.0125 + 3.7) * 0.7 + tNoise(vTWPos.xz * 0.04 + 1.3) * 0.3;

// Poids calculés AVANT l'échantillonnage : on ne lit que les matériaux présents.
float wR = smoothstep(0.2, 0.4, tSlope + (tMacro - 0.5) * 0.12);
float wS = (1.0 - smoothstep(0.5, 2.6, vTWPos.y - uWaterLevel + (tMacro - 0.5) * 1.6)) * (1.0 - wR);
float wH = smoothstep(0.55, 0.78, tMacro2 + (tMacro - 0.5) * 0.3) * (1.0 - wR) * (1.0 - wS);
float wM = max(0.0, 1.0 - wR - wS - wH);
bool tNear = tDist < 360.0;
const vec4 FLAT = vec4(0.5, 0.5, 1.0, 0.5);

vec4 aMoss = textureGrad(tAlbedoArr, vec3(tuv, 0.0), tdx, tdy);
vec4 nMoss = tNear ? textureGrad(tNormalArr, vec3(tuv, 0.0), tdx, tdy) : FLAT;
vec4 aHum = vec4(0.0);
vec4 nHum = FLAT;
if (wH > 0.01) {
  vec2 u2 = tuv * 0.85 + 0.31;
  aHum = textureGrad(tAlbedoArr, vec3(u2, 1.0), tdx * 0.85, tdy * 0.85);
  if (tNear) nHum = textureGrad(tNormalArr, vec3(u2, 1.0), tdx * 0.85, tdy * 0.85);
}
vec4 aSil = vec4(0.0);
vec4 nSil = FLAT;
if (wS > 0.01) {
  vec2 u3 = tuv * 1.3;
  aSil = textureGrad(tAlbedoArr, vec3(u3, 3.0), tdx * 1.3, tdy * 1.3);
  if (tNear) nSil = textureGrad(tNormalArr, vec3(u3, 3.0), tdx * 1.3, tdy * 1.3);
}

vec3 rockN = tN;
vec4 aR = vec4(0.5);
float rockH = 0.5;
if (wR > 0.01) {
  float rs = 0.12;
  vec3 bw = pow(abs(tN), vec3(4.0));
  bw /= (bw.x + bw.y + bw.z);
  vec2 uvX = vTWPos.zy * rs; vec2 dxX = tpdx.zy * rs; vec2 dyX = tpdy.zy * rs;
  vec2 uvY = vTWPos.xz * rs; vec2 dxY = tpdx.xz * rs; vec2 dyY = tpdy.xz * rs;
  vec2 uvZ = vTWPos.xy * rs; vec2 dxZ = tpdx.xy * rs; vec2 dyZ = tpdy.xy * rs;
  bool tri = false;
  #ifdef TERRAIN_TRIPLANAR
  tri = tDist < 160.0;
  #endif
  if (tri) {
    aR = textureGrad(tAlbedoArr, vec3(uvX, 2.0), dxX, dyX) * bw.x + textureGrad(tAlbedoArr, vec3(uvY, 2.0), dxY, dyY) * bw.y + textureGrad(tAlbedoArr, vec3(uvZ, 2.0), dxZ, dyZ) * bw.z;
    vec4 sX = textureGrad(tNormalArr, vec3(uvX, 2.0), dxX, dyX);
    vec4 sY = textureGrad(tNormalArr, vec3(uvY, 2.0), dxY, dyY);
    vec4 sZ = textureGrad(tNormalArr, vec3(uvZ, 2.0), dxZ, dyZ);
    vec3 tnX = tUnpack(sX); vec3 tnY = tUnpack(sY); vec3 tnZ = tUnpack(sZ);
    tnX = vec3(tnX.xy + tN.zy, abs(tnX.z) * tN.x);
    tnY = vec3(tnY.xy + tN.xz, abs(tnY.z) * tN.y);
    tnZ = vec3(tnZ.xy + tN.xy, abs(tnZ.z) * tN.z);
    rockN = normalize(tnX.zyx * bw.x + tnY.xzy * bw.y + tnZ.xyz * bw.z);
    rockH = sX.a * bw.x + sY.a * bw.y + sZ.a * bw.z;
  } else {
    // Projection unique selon l'axe dominant (2 lectures au lieu de 6).
    vec2 uv; vec2 ddx; vec2 ddy;
    int axis;
    if (bw.y >= bw.x && bw.y >= bw.z) { uv = uvY; ddx = dxY; ddy = dyY; axis = 1; }
    else if (bw.x >= bw.z) { uv = uvX; ddx = dxX; ddy = dyX; axis = 0; }
    else { uv = uvZ; ddx = dxZ; ddy = dyZ; axis = 2; }
    aR = textureGrad(tAlbedoArr, vec3(uv, 2.0), ddx, ddy);
    if (tNear) {
      vec4 sA = textureGrad(tNormalArr, vec3(uv, 2.0), ddx, ddy);
      vec3 tn = tUnpack(sA);
      if (axis == 1) rockN = normalize(vec3(tn.xy + tN.xz, abs(tn.z) * tN.y).xzy);
      else if (axis == 0) rockN = normalize(vec3(tn.xy + tN.zy, abs(tn.z) * tN.x).zyx);
      else rockN = normalize(vec3(tn.xy + tN.xy, abs(tn.z) * tN.z));
      rockH = sA.a;
    }
  }
}

// Strates à grande échelle sur les falaises (gris-bleu / ocre rouillé).
float tBand = 0.5 + 0.5 * sin(vTWPos.y * 0.55 + tMacro * 4.0);
aR.rgb = mix(aR.rgb, aR.rgb * vec3(1.18, 0.97, 0.8), smoothstep(0.55, 0.9, tBand));

vec4 tW = vec4(wM, wH, wR, wS) * (vec4(nMoss.a, nHum.a, rockH, nSil.a) + 0.4);
tW = tW * tW * tW;
tW /= (tW.x + tW.y + tW.z + tW.w + 1e-5);

// Prairies dorées au sommet des Tables.
vec3 mossCol = mix(aMoss.rgb, aMoss.rgb * vec3(1.35, 1.15, 0.6), smoothstep(110.0, 150.0, vTWPos.y) * 0.8);
vec3 tAlb = mossCol * tW.x + aHum.rgb * tW.y + aR.rgb * tW.z + aSil.rgb * tW.w;
float tRough = aMoss.a * tW.x + aHum.a * tW.y + aR.a * tW.z + aSil.a * tW.w;

// Normale : projection verticale (whiteout) pour les sols, triplanaire pour la roche.
vec3 tTop = tUnpack(nMoss) * tW.x + tUnpack(nHum) * tW.y + tUnpack(nSil) * tW.w + vec3(0.0, 0.0, 1.0) * tW.z;
tTop = vec3(tTop.xy + tN.xz, abs(tTop.z) * tN.y);
vec3 tNormalW = normalize(tTop.xzy * (1.0 - tW.z) + rockN * tW.z);

// Émission : fleurs de mousse la nuit, veines d'orvène dans la Faille d'Ambre.
vec3 tEmissive = vec3(0.0);
float violet = smoothstep(0.05, 0.16, aMoss.b - aMoss.g) * tW.x;
tEmissive += vec3(0.55, 0.25, 1.0) * violet * uNight * 0.9;
float tEast = smoothstep(1650.0, 2150.0, vTWPos.x);
if (tEast > 0.0) {
  float vn = tNoise(vec2(vTWPos.x + vTWPos.y * 0.7, vTWPos.z - vTWPos.y * 0.45) * 0.045);
  float vein = 1.0 - smoothstep(0.0, 0.035, abs(vn - 0.5));
  vein *= tEast * smoothstep(0.1, 0.5, tW.z + 0.15);
  tAlb = mix(tAlb, vec3(0.8, 0.45, 0.12), vein * 0.7);
  tEmissive += vec3(1.0, 0.55, 0.12) * vein * (0.35 + 2.2 * uNight);
}

// Sous l'eau : assombrissement et teinte selon la profondeur.
float tDepth = uWaterLevel - vTWPos.y;
if (tDepth > 0.0) tAlb = mix(tAlb, vec3(0.04, 0.1, 0.11), clamp(tDepth * 0.2, 0.0, 0.88));
float tWet = 1.0 - smoothstep(0.0, 1.2, vTWPos.y - uWaterLevel);
tRough = mix(tRough, 0.25, tWet * 0.7);
tAlb *= 1.0 - tWet * 0.25;

// Canopée lointaine : la forêt instanciée s'arrête, la teinte du sol prend le relais.
float tFar = smoothstep(180.0, 900.0, tDist);
float tCan = clamp(vTForest, 0.0, 1.0) * tFar * (1.0 - tW.z * 0.7);
tAlb = mix(tAlb, vec3(0.06, 0.13, 0.1) * (0.75 + 0.5 * tMacro), tCan * 0.85);
tRough = mix(tRough, 0.92, tCan);
tNormalW = normalize(mix(tNormalW, tN, smoothstep(250.0, 800.0, tDist)));

// Onde de capacité : scan Halden (courbes de niveau) ou Écho sylmar (halo violet).
if (uPulse.w > 0.001) {
  float pd = distance(vTWPos.xz, uPulse.xy);
  float ring = exp(-abs(pd - uPulse.z) * 0.18) * uPulse.w;
  if (uPulseMode > 0.5) {
    float cl = abs(fract(vTWPos.y * 0.25) - 0.5) * 2.0;
    float line = smoothstep(0.86, 0.97, cl) * step(pd, uPulse.z) * uPulse.w;
    tEmissive += uPulseColor * (line * 0.9 + ring * 0.8);
  } else {
    tEmissive += uPulseColor * ring * 0.5 * (tW.x + tW.y);
  }
}

diffuseColor.rgb *= tAlb;
`;

export function createTerrainMaterial(albedo: DataArrayTexture, normal: DataArrayTexture, triplanar: boolean): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  mat.defines = triplanar ? { TERRAIN_TRIPLANAR: '' } : {};
  mat.onBeforeCompile = (shader) => {
    injectGlobals(shader.uniforms);
    shader.uniforms.tAlbedoArr = { value: albedo };
    shader.uniforms.tNormalArr = { value: normal };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_PARS)
      .replace('#include <begin_vertex>', VERT_MAIN);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_PARS)
      .replace('#include <map_fragment>', FRAG_MAP)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(tRough, 0.05, 1.0);')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += tEmissive;');
  };
  mat.customProgramCacheKey = () => 'veyra-terrain-' + (triplanar ? 't' : 'p');
  return mat;
}
