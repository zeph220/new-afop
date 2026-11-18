# Crédits et licences

Règle : **aucun asset sans licence claire**. Aucun fichier, capture, texture, modèle, son ou code issu d'un jeu
commercial n'est utilisé, ni comme source ni comme référence.

## Code tiers (dépendances npm)

| Paquet | Usage | Licence |
|---|---|---|
| [three](https://github.com/mrdoob/three.js) | Moteur de rendu WebGL2 (+ modules `examples/jsm` : EffectComposer, UnrealBloomPass, OutputPass, BufferGeometryUtils) | MIT |
| [vite](https://github.com/vitejs/vite) | Outil de build (dev) | MIT |
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
| Mousse, humus, roche, limon (albédo, rugosité, normale, hauteur — 1K) | **Générées procéduralement** à l'exécution (`src/textures/`) | Original (projet) |

## Modèles 3D

| Élément | Source | Licence |
|---|---|---|
| Personnages Sylmar et Halden | Géométrie procédurale (`src/player/CharacterModel.ts`) | Original (projet) |
| Flore (Colonnier, Arqué, Fougère-lanterne, Lamelle, Coupe-de-brume, blocs) | Géométrie procédurale (`src/world/VegetationGeometry.ts`) | Original (projet) |

## Sons

| Élément | Source | Licence |
|---|---|---|
| Vent, insectes, pluie, tonnerre, pas, propulseur | **Synthétisés** en temps réel via Web Audio API (`src/audio/`) | Original (projet) |

## Prévu (itération 3)

Sources CC0 autorisées pour les textures UHD : [Poly Haven](https://polyhaven.com/license) (CC0),
[ambientCG](https://docs.ambientcg.com/license/) (CC0). Chaque fichier ajouté sera listé ici avec son URL d'origine.
