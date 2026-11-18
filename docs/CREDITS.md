# Crédits et licences

Règle : **aucun asset sans licence claire**. Aucun fichier, capture, texture, modèle, son ou code issu d'un jeu
commercial n'est utilisé, ni comme source ni comme référence.

## Code tiers (dépendances npm)

| Paquet | Usage | Licence |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | Moteur de rendu WebGL2 (+ modules `examples/jsm` : EffectComposer, UnrealBloomPass, OutputPass, BufferGeometryUtils) | MIT |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier) | Moteur physique des véhicules (WebAssembly), chargé à la demande | Apache-2.0 |
| [vite](https://github.com/vitejs/vite) | Outil de build (dev) | MIT |
| [electron](https://github.com/electron/electron) / [electron-builder](https://github.com/electron-userland/electron-builder) | Version de bureau Windows portable (dev, `npm run build:exe`) | MIT |
| [typescript](https://github.com/microsoft/TypeScript) | Langage (dev) | Apache-2.0 |
| [vitest](https://github.com/vitest-dev/vitest) | Tests unitaires (dev) | MIT |
| [@types/three](https://github.com/three-types/three-ts-types) | Types TypeScript (dev) | MIT |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped) | Types Node pour les scripts (dev) | MIT |

## Algorithmes

| Élément | Source | Licence / statut |
|---|---|---|
| Bruit simplex 2D/3D | Implémentation originale d'après l'algorithme publié par Ken Perlin et décrit par Stefan Gustavson (« Simplex noise demystified », 2005) | Algorithme publié ; code écrit pour ce projet |
| Bruit de gradient périodique (textures raccordables) | Code écrit pour ce projet | — |
| Brouillard de hauteur analytique | Formule d'intégration exponentielle classique | — |

## Textures

| Fichier / matériau | Source | Licence |
|---|---|---|
| `public/textures/{1k,2k,4k}/mousse_*.jpg` (diffuse, normale GL, rugosité, déplacement) | [Poly Haven — *Forest Ground 04*](https://polyhaven.com/a/forest_ground_04) | CC0 |
| `public/textures/{1k,2k,4k}/humus_*.jpg` | [Poly Haven — *Brown Mud Leaves 01*](https://polyhaven.com/a/brown_mud_leaves_01) | CC0 |
| `public/textures/{1k,2k,4k}/roche_*.jpg` | [Poly Haven — *Rock Face*](https://polyhaven.com/a/rock_face) | CC0 |
| `public/textures/{1k,2k,4k}/limon_*.jpg` | [Poly Haven — *Mud Forest*](https://polyhaven.com/a/mud_forest) | CC0 |
| `public/textures/{1k,2k,4k}/feuilles_*.jpg` | [Poly Haven — *Forest Leaves 02*](https://polyhaven.com/a/forest_leaves_02) | CC0 |
| Versions 2K et 1K | Réduites à partir des fichiers 4K d'origine (JPEG qualité 90) | CC0 |
| Repli si les scans sont introuvables : mousse, humus, roche, limon | **Générées procéduralement** à l'exécution (`src/textures/TextureGen.ts`) | Original (projet) |

Les scans Poly Haven sont téléchargés depuis `dl.polyhaven.org` (fichiers JPG 4K d'origine, non modifiés dans `4k/`).
Licence CC0 : <https://polyhaven.com/license>.

## Modèles 3D

| Élément | Source | Licence |
|---|---|---|
| Personnages Sylmar et Halden | Géométrie procédurale (`src/player/CharacterModel.ts`) | Original (projet) |
| Flore (Colonnier, Arqué, Fougère-lanterne, Lamelle, Coupe-de-brume, blocs) | Géométrie procédurale (`src/world/VegetationGeometry.ts`) | Original (projet) |
| Montures (Skarel, Tormaq, Vexil) | Géométrie procédurale (`src/entities/models/creatures.ts`) | Original (projet) |
| Véhicules Halden (gyrocoptère, marcheur, chenillé, hydroglisseur) | Géométrie procédurale (`src/entities/models/vehicles.ts`) | Original (projet) |
| Fougère (`public/models/flora/fern_02/`) | [Poly Haven — *Fern 02*](https://polyhaven.com/a/fern_02) | CC0 |
| Plante à larges feuilles (`calathea_orbifolia_01/`) | [Poly Haven — *Calathea Orbifolia 01*](https://polyhaven.com/a/calathea_orbifolia_01) | CC0 |
| Plante à spathe (`anthurium_botany_01/`) | [Poly Haven — *Anthurium Botany 01*](https://polyhaven.com/a/anthurium_botany_01) | CC0 |
| Rocher (`boulder_01/`) | [Poly Haven — *Boulder 01*](https://polyhaven.com/a/boulder_01) | CC0 |
| Faune sauvage (8 espèces), caisses, établis, feux, projectiles | Géométrie procédurale (`src/gameplay/`) | Original (projet) |
| Véhicules et arbres glTF (`public/models/vehicles/`, `public/models/trees/`) | Sketchfab via `npm run fetch:models` : CC-BY, crédits dans `docs/CREDITS-models.md` | voir ce fichier |
| Faune glTF optionnelle (`public/models/fauna/`) | Sketchfab via `npm run fetch:fauna` : CC0 ou CC-BY, crédits dans `docs/CREDITS-fauna.md` | voir ce fichier |

## Sons

| Élément | Source | Licence |
|---|---|---|
| Vent, insectes, pluie, tonnerre, pas, propulseur, moteurs, cris des montures, battements d'ailes | **Synthétisés** en temps réel via Web Audio API (`src/audio/`) | Original (projet) |

## Prévu (itération 3)

Sources CC0 autorisées pour les textures UHD : [Poly Haven](https://polyhaven.com/license) (CC0),
[ambientCG](https://docs.ambientcg.com/license/) (CC0). Chaque fichier ajouté sera listé ici avec son URL d'origine.
