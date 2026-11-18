// Vérifie qu'aucun fichier publié ne dépasse 25 Mo (limite de Cloudflare Pages / bonnes pratiques GitHub Pages).
// Usage : npm run check:size [dossiers…]   (par défaut : dist et public)
import { readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const LIMIT = 25 * 1024 * 1024;
const roots = process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'public'];
let count = 0;
let total = 0;
const offenders = [];
let largest = { file: '', size: 0 };

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else {
      count++;
      total += st.size;
      if (st.size > largest.size) largest = { file: p, size: st.size };
      if (st.size > LIMIT) offenders.push({ file: p, size: st.size });
    }
  }
}

for (const r of roots) if (existsSync(r)) walk(r);
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' Mo';
console.log(`${count} fichiers vérifiés, ${mb(total)} au total. Plus gros : ${relative('.', largest.file) || '—'} (${mb(largest.size)}).`);
if (offenders.length) {
  console.error('Fichiers au-dessus de 25 Mo :');
  for (const o of offenders) console.error(`  ${relative('.', o.file)} : ${mb(o.size)}`);
  process.exit(1);
}
console.log('OK : aucun fichier ne dépasse 25 Mo.');
