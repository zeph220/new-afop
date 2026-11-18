// Télécharge des modèles de véhicules et d'arbres depuis Sketchfab (CC0 puis CC-BY uniquement),
// écrit public/models/{vehicles,trees}/manifest.json et docs/CREDITS-models.md.
// Clé : SKETCHFAB_TOKEN dans .env.local (jamais affichée). Usage : npm run fetch:models

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const token = existsSync(join(root, '.env.local')) ? readFileSync(join(root, '.env.local'), 'utf8').match(/^\s*SKETCHFAB_TOKEN\s*=\s*(\S+)/m)?.[1] : null;
if (!token) {
  console.error('SKETCHFAB_TOKEN absent de .env.local.');
  process.exit(1);
}

// [dossier, clé, recherches, mot exigé dans le nom, faces max]
const WANTED = [
  ['vehicles', 'gyro', ['autogyro', 'gyrocopter', 'civil helicopter', 'small helicopter'], /gyro|copter|helicopter/i, 60000],
  ['vehicles', 'marcheur', ['mech walk', 'walker mech', 'quadruped robot', 'mech'], /mech|walker|robot/i, 80000, true],
  ['vehicles', 'chenille', ['drilling rig', 'drill rig', 'mining drill', 'rock drill', 'drilling machine', 'tunnel boring machine'], /drill|boring|mining/i, 90000],
  ['vehicles', 'hydro', ['airboat', 'hovercraft', 'jet boat'], /airboat|hover|boat/i, 60000],
  ['trees', 'colonnier', ['giant tree', 'redwood tree', 'sequoia tree', 'big tree'], /tree|redwood|sequoia/i, 25000],
  ['trees', 'arque', ['realistic tree', 'deciduous tree', 'oak tree'], /tree|oak/i, 15000],
];
const BLOCKED = /avatar|pandora|na'?vi|banshee|ikran|thanator|samson|scorpion gunship|amp suit|valkyrie|star ?wars|marvel|disney|pokemon|gundam|halo|warhammer|cartoon|toon|chibi|stylized|low ?poly|anime|far ?cry|half[- ]?life|valve|ubisoft|gta|fortnite|minecraft|fallout|battlefield|call of duty|golem|creature|monster|xcmg|liebherr|komatsu|caterpillar|volvo|john deere|ark\b|rust\b|dota|hl2|\bhl\b|overwatch|team fortress|tf2|borderlands|apex|titanfall|mechwarrior|battletech|zuma|paw patrol|gun|weapon|military|missile|attack|combat|war\b|army/i;
const MAX_BYTES = 24 * 1024 * 1024;

const api = async (url, auth = false) => {
  const r = await fetch(url, { headers: auth ? { Authorization: `Token ${token}` } : {} });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

const manifests = {};
const credits = [];
for (const [dir, key, queries, nameRe, maxFaces, needAnim] of WANTED) {
  const outDir = join(root, 'public', 'models', dir);
  mkdirSync(outDir, { recursive: true });
  const mPath = join(outDir, 'manifest.json');
  manifests[dir] ??= existsSync(mPath) ? JSON.parse(readFileSync(mPath, 'utf8')) : {};
  if (manifests[dir][key] && existsSync(join(outDir, manifests[dir][key].file))) {
    console.log(`${key} : déjà présent`);
    continue;
  }
  let done = false;
  for (const license of ['cc0', 'by']) {
    for (const q of queries) {
      if (done) break;
      const res = await api(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&downloadable=true&license=${license}&count=24${needAnim ? '&animated=true' : ''}&sort_by=-likeCount&max_face_count=${maxFaces}`);
      const cands = (res.results ?? [])
        .filter((m) => nameRe.test(m.name) && !BLOCKED.test(`${m.name} ${(m.tags ?? []).map((t) => t.name).join(' ')}`))
        .filter((m) => (m.faceCount ?? 0) > 800 && (m.faceCount ?? 0) <= maxFaces);
      for (const m of cands) {
        try {
          const dl = await api(`https://api.sketchfab.com/v3/models/${m.uid}/download`, true);
          if (!dl.glb?.url || dl.glb.size > MAX_BYTES) continue;
          const buf = Buffer.from(await (await fetch(dl.glb.url)).arrayBuffer());
          const file = `${key}.glb`;
          writeFileSync(join(outDir, file), buf);
          // glTF regarde vers +Z, les véhicules du jeu vers -Z : demi-tour par défaut.
          manifests[dir][key] = { file, name: m.name, faces: m.faceCount, ...(dir === 'vehicles' ? { rotY: Math.PI } : {}) };
          credits.push(`| ${dir}/${key} | [${m.name}](${m.viewerUrl}) par ${m.user?.displayName ?? '?'} | ${m.license?.label ?? license} |`);
          console.log(`${key} : ${m.name} (${m.license?.label ?? license}, ${m.faceCount} faces, ${(buf.length / 1048576).toFixed(1)} Mo)`);
          done = true;
          break;
        } catch (e) {
          console.warn(`  ${m.name} : ${e.message}`);
        }
      }
    }
    if (done) break;
  }
  if (!done) console.log(`${key} : rien de convenable (modèle procédural conservé)`);
}
for (const [dir, man] of Object.entries(manifests)) writeFileSync(join(root, 'public', 'models', dir, 'manifest.json'), JSON.stringify(man, null, 2));
if (credits.length) {
  const path = join(root, 'docs', 'CREDITS-models.md');
  const head = existsSync(path) ? readFileSync(path, 'utf8') : '# Crédits — véhicules et arbres (Sketchfab)\n\nLicences CC0 ou CC-BY 4.0 (attribution obligatoire pour CC-BY).\n\n| Élément du jeu | Modèle | Licence |\n|---|---|---|\n';
  writeFileSync(path, head + credits.join('\n') + '\n');
}
console.log('Terminé.');
