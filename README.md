# Veyra — Lune d'Orun

Jeu d'exploration 3D en monde ouvert, jouable dans un navigateur de bureau (WebGL2), dans un univers 100 % original.
Choisissez votre camp — les **Sylmar**, peuple autochtone qui grimpe et lit la brume, ou le **Consortium Halden**,
colons industriels équipés de propulseurs — et explorez Veyra, une lune forestière éclairée par la géante gazeuse Orun.

- Bible du monde et design : [docs/DESIGN.md](docs/DESIGN.md)
- Histoire (trois actes par camp) : [docs/STORY.md](docs/STORY.md)
- Avancement : [docs/PROGRESS.md](docs/PROGRESS.md)
- Sources et licences : [docs/CREDITS.md](docs/CREDITS.md)

## Lancer le jeu en local

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Puis ouvrir l'adresse affichée (par défaut http://localhost:5173).

## Commandes utiles

| Commande | Rôle |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Vérification TypeScript + build de production dans `dist/` |
| `npm run preview` | Sert le build de production |
| `npm test` | Tests unitaires (Vitest) |
| `npm run check:size` | Vérifie qu'aucun fichier publié ne dépasse 25 Mo |
| `node scripts/preview-world.ts carte.png` | Carte ombrée du relief (aperçu de la génération) |

## Contrôles

ZQSD (AZERTY) ou WASD (QWERTY) pour se déplacer, souris pour la caméra (cliquer dans la vue pour la capturer),
Maj pour courir, Espace pour sauter (maintenir en l'air : propulseur Halden), Ctrl/C pour s'accroupir ou lâcher prise,
F pour la capacité de camp, L pour la lampe (Halden), H pour l'aide, Échap pour la pause. Manette standard prise en charge.

Montures et véhicules (itération 2) : E pour monter / piloter / descendre, R pour appeler sa monture (Sylmar) ou se
faire livrer un véhicule par drone (Halden), V pour couper le moteur du gyrocoptère. Pour apprivoiser une bête
(Sylmar) : s'approcher accroupi, E pour l'offrande, répondre à ses trois appels en rythme avec F, puis maintenir E.

## Version de bureau (Windows)

`npm run build:exe` produit un exécutable portable dans `release/` (Electron). Ce dossier n'est pas publié en ligne.

## Déploiement gratuit

Le build est un site statique (`dist/`), compatible avec tout hébergeur statique.

**GitHub Pages** (workflow fourni dans `.github/workflows/deploy-pages.yml`) :
1. Créer un dépôt GitHub et y pousser la branche `main`.
2. Dans *Settings → Pages*, choisir la source **GitHub Actions**.
3. Chaque push sur `main` lance les tests, le build, la vérification de taille, puis publie le site.

**Cloudflare Pages** (alternative) :
```bash
npx wrangler login
npm run build
npx wrangler pages deploy dist --project-name veyra
```

## Structure

```
src/
  core/      boucle de jeu, entrées, machine à états, réglages, sauvegarde, pool de workers
  world/     relief, quadtree LOD, végétation, environnement (jour/nuit, météo), repères
  render/    brouillard de hauteur global, matériaux terrain/flore, ciel, eau
  player/    camps, contrôleur de déplacement, modèles procéduraux, caméra
  textures/  génération des textures PBR procédurales
  audio/     ambiance synthétisée (Web Audio API)
  ui/        menus et HUD
tests/       tests Vitest
scripts/     vérification de taille, aperçu du relief
```
