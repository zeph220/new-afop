// Textures photoréalistes du terrain (scans Poly Haven, CC0 — voir docs/CREDITS.md).
// Chargées dans un worker : décodage, mise à la taille voulue et regroupement des canaux
// au format MaterialTexture (albédo + rugosité, normale + hauteur).

import type { MaterialTexture } from './TextureGen.ts';
import type { TerrainMaterialId } from './TextureGen.ts';

/** Dossier de textures selon la taille demandée (1k, 2k, 4k). */
export function photoTextureDir(size: number): string {
  return size >= 4096 ? '4k' : size >= 2048 ? '2k' : '1k';
}

async function readPixels(url: string, size: number, srgb: boolean): Promise<Uint8ClampedArray> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} : ${res.status}`);
  const bmp = await createImageBitmap(await res.blob(), {
    colorSpaceConversion: srgb ? 'default' : 'none',
    premultiplyAlpha: 'none',
    resizeWidth: size,
    resizeHeight: size,
    resizeQuality: 'high',
  });
  const canvas = new OffscreenCanvas(size, size);
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  // Retournement vertical : la ligne 0 correspond à v = 0 (convention OpenGL des normales).
  g.translate(0, size);
  g.scale(1, -1);
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, size, size).data;
}

export async function loadPhotoTexture(material: TerrainMaterialId, size: number, baseUrl: string): Promise<MaterialTexture> {
  const dir = `${baseUrl}${photoTextureDir(size)}/${material}_`;
  const [diff, nor, rough, disp] = await Promise.all([
    readPixels(`${dir}diff.jpg`, size, true),
    readPixels(`${dir}nor.jpg`, size, false),
    readPixels(`${dir}rough.jpg`, size, false),
    readPixels(`${dir}disp.jpg`, size, false),
  ]);
  const n = size * size * 4;
  const albedoRough = new Uint8Array(n);
  const normalHeight = new Uint8Array(n);
  for (let i = 0; i < n; i += 4) {
    albedoRough[i] = diff[i];
    albedoRough[i + 1] = diff[i + 1];
    albedoRough[i + 2] = diff[i + 2];
    albedoRough[i + 3] = rough[i];
    normalHeight[i] = nor[i];
    normalHeight[i + 1] = nor[i + 1];
    normalHeight[i + 2] = nor[i + 2];
    normalHeight[i + 3] = disp[i];
  }
  return { size, albedoRough, normalHeight };
}
