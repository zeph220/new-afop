// Télécharge des animaux animés depuis Sketchfab (licences CC0 puis CC-BY uniquement) et écrit
// public/models/fauna/manifest.json + docs/CREDITS-fauna.md.
// Clé : SKETCHFAB_TOKEN dans .env.local (jamais affichée). Usage : node scripts/fetch-fauna.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const envPath = join(root, '.env.local');
if (!existsSync(envPath)) {
  console.error('Fichier .env.local introuvable : ajoutez SKETCHFAB_TOKEN=... à la racine du projet.');
  process.exit(1);
}
const token = readFileSync(envPath, 'utf8').match(/^\s*SKETCHFAB_TOKEN\s*=\s*(\S+)/m)?.[1];
if (!token) {
  console.error('SKETCHFAB_TOKEN absent de .env.local.');
  process.exit(1);
}

// Espèce du jeu → recherches (animaux terrestres réels comme base anatomique).
const SPECIES = {
  ruminel: ['deer', 'antelope', 'roe deer'],
  cornard: ['bison', 'buffalo', 'yak'],
  fouisseur: ['rabbit', 'hare', 'marmot'],
  griffal: ['wolf', 'hyena', 'coyote'],
  rodeur: ['panther', 'cougar', 'leopard'],
  echassier: ['heron', 'crane bird', 'stork'],
  nuee: ['sparrow', 'small bird', 'finch'],
  carapace: ['armadillo', 'tortoise', 'pangolin'],
};
const BLOCKED = /avatar|pandora|na'?vi|banshee|ikran|thanator|direhorse|pokemon|disney|marvel|star ?wars|sailor|moon|anime|chibi|girl|boy|human|character|hell|demon|zombie|robot|cartoon|toon|spider|insect/i;
const MAX_BYTES = 24 * 1024 * 1024;
const outDir = join(root, 'public', 'models', 'fauna');
mkdirSync(outDir, { recursive: true });

const api = async (url, auth = false) => {
  const r = await fetch(url, { headers: auth ? { Authorization: `Token ${token}` } : {} });
  if (!r.ok) throw new Error(`${r.status} ${url.replace(/\?.*/, '')}`);
  return r.json();
};

/** Lit le bloc JSON d'un .glb : noms d'animations. */
function glbAnimations(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) return [];
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString('utf8'));
  return (json.animations ?? []).map((a, i) => a.name || `anim_${i}`);
}

function guessClips(names) {
  const pick = (...res) => names.find((n) => res.some((re) => re.test(n)));
  return {
    idle: pick(/idle/i, /stand/i, /breath/i) ?? names[0],
    walk: pick(/walk/i, /trot/i),
    run: pick(/run/i, /gallop/i, /sprint/i),
    attack: pick(/attack/i, /bite/i, /hit/i, /charge/i),
    dead: pick(/death/i, /die/i, /dead/i),
    fly: pick(/fly/i, /flap/i, /glide/i),
    graze: pick(/\beat/i, /graze/i),
  };
  // Une seule animation : elle sert à tout (le jeu la ralentit à l'arrêt).
  if (names.length === 1) return { idle: names[0], walk: names[0], run: names[0] };
}

const manifest = existsSync(join(outDir, 'manifest.json')) ? JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf8')) : {};
const credits = [];

for (const [kind, queries] of Object.entries(SPECIES)) {
  if (manifest[kind] && existsSync(join(outDir, manifest[kind].file))) {
    console.log(`${kind} : déjà présent`);
    continue;
  }
  let done = false;
  for (const license of ['cc0', 'by']) {
    for (const q of queries) {
      if (done) break;
      const res = await api(`https://api.sketchfab.com/v3/search?type=models&q=${encodeURIComponent(q)}&animated=true&downloadable=true&license=${license}&count=24&sort_by=-likeCount`);
      const cands = (res.results ?? [])
        .filter((m) => !BLOCKED.test(`${m.name} ${(m.tags ?? []).map((t) => t.name).join(' ')}`))
        // Le nom du modèle doit désigner l'animal cherché.
        .filter((m) => new RegExp(`\\b${q.split(' ')[0]}`, 'i').test(m.name))
        .filter((m) => (m.faceCount ?? 0) > 1500 && (m.faceCount ?? 0) < 120000)
        .filter((m) => !m.archives?.glb || m.archives.glb.size < MAX_BYTES);
      for (const m of cands) {
        try {
          const dl = await api(`https://api.sketchfab.com/v3/models/${m.uid}/download`, true);
          if (!dl.glb?.url || dl.glb.size > MAX_BYTES) continue;
          const buf = Buffer.from(await (await fetch(dl.glb.url)).arrayBuffer());
          const anims = glbAnimations(buf);
          if (!anims.length) continue;
          const file = `${kind}.glb`;
          writeFileSync(join(outDir, file), buf);
          manifest[kind] = { file, scale: 0, rotY: Math.PI, clips: guessClips(anims) };
          credits.push(`| ${kind} | [${m.name}](${m.viewerUrl}) par ${m.user?.displayName ?? '?'} | ${m.license?.label ?? license} |`);
          console.log(`${kind} : ${m.name} (${m.license?.label ?? license}, ${(buf.length / 1048576).toFixed(1)} Mo, animations : ${anims.join(', ')})`);
          done = true;
          break;
        } catch (e) {
          console.warn(`  ${m.name} : ${e.message}`);
        }
      }
    }
    if (done) break;
  }
  if (!done) console.log(`${kind} : aucun modèle animé libre trouvé (le corps procédural est conservé)`);
}

writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
if (credits.length) {
  const path = join(root, 'docs', 'CREDITS-fauna.md');
  const head = existsSync(path) ? readFileSync(path, 'utf8') : '# Crédits — faune (Sketchfab)\n\nLicences CC0 ou CC-BY 4.0 (attribution ci-dessous, obligatoire pour CC-BY).\n\n| Espèce du jeu | Modèle | Licence |\n|---|---|---|\n';
  writeFileSync(path, head + credits.join('\n') + '\n');
}
console.log('Terminé.');
