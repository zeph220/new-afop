# Avancement

## Itération 1 — Fondations jouables : monde, personnage, camps

**Statut : implémentée et testée localement — en attente de mise en ligne et de validation par le porteur du projet.**

### Résumé (5 lignes)
1. Monde de 8 × 8 km généré procéduralement (plateaux, faille, marais, rivières, falaise périphérique), streamé par quadtree LOD avec géomorphing.
2. Ciel original (géante Orun à bandes et anneau, étoiles, nuages), cycle jour/nuit de 24 min, météo clair/brume/orage avec pluie et éclairs, brume de hauteur.
3. Flore instanciée bioluminescente (6 espèces originales) avec vent ; textures PBR 1K procédurales ; eau animée.
4. Deux camps jouables aux mécaniques distinctes (escalade + Écho de sève / propulseur + scan + lampe), personnages procéduraux animés.
5. Menus, réglages graphiques (auto/élevée/moyenne/basse + résolution dynamique), HUD, aide, audio synthétisé, sauvegarde locale automatique, 24 tests verts.

### Fait
| Domaine | Détail |
|---|---|
| Projet | Vite 8 + TypeScript 7 + Three.js r187, build statique, workers de génération (pool de 2 à 4) |
| Boucle & états | Chargement → menu → choix du camp → jeu ⇄ pause ; sous-pas physiques à 60 Hz |
| Entrées | Clavier par position physique (ZQSD en AZERTY = WASD en QWERTY), souris avec verrouillage du pointeur, manette standard |
| Terrain | Fonction de hauteur analytique (`src/world/WorldGen.ts`), quadtree 8 niveaux (feuilles 64 m à 2 m de résolution), géomorphing + jupes, remplacement atomique de l'ensemble affiché (aucun trou, y compris lors d'un changement de qualité) |
| Rendu | Brouillard de hauteur global (remplace celui de Three.js), ciel procédural, eau (Fresnel, spéculaire, plancton), ombres du soleil centrées sur le joueur, bloom, tonemapping ACES, exposition jour/nuit |
| Flore | Colonnier (2 niveaux de détail, ombrelles praticables), Arqué, Fougère-lanterne, Lamelle, Coupe-de-brume, blocs ; placement déterministe partagé rendu/collisions |
| Textures | Mousse, humus, roche, limon : albédo + rugosité, normale + hauteur, 1024² raccordables, générées dans les workers ; mélange par pente/altitude/bruit, roche triplanaire de près |
| Personnages | Sylmar (2,5 m, peau écorcée, crête de fibres, arc et lance) et technicien·ne Halden (combinaison ocre, plaques acier, visière, propulseur) ; animation procédurale (marche, course, saut, accroupi, escalade, nage, propulseur) |
| Mécaniques | Marche/course/saut/accroupi/nage pour tous ; Sylmar : escalade des falaises et des troncs, rétablissement sur les ombrelles, endurance, Écho de sève, vision nocturne ; Halden : propulseur à carburant, scan géologique (courbes de niveau + relevé), lampe frontale, HUD technique |
| Repères | Village de Vehra-Tal (huttes tressées, foyer, lanternes, Colonniers géants) et station Forage Kessel (tour de forage, conteneurs, mâts d'éclairage, aire de fret, pipeline), fusionnés par matériau |
| Interface | Menu, choix du camp (fiches), HUD (boussole avec repères, région, heure/météo, jauge, capacité, aides contextuelles), pause, réglages persistants, commandes, crédits |
| Audio | 100 % synthétisé : vent, pluie, tonnerre, faune de jour et de nuit (dont « l'appel en trois temps »), pas, éclaboussures, propulseur, sons d'interface |
| Sauvegarde | `localStorage` (position, camp, heure, météo, temps de jeu ; champs inventaire/montures/véhicules/quêtes réservés), toutes les 60 s, à la pause et à la fermeture ; interface `SaveBackend` prête pour Supabase |
| Qualité | 24 tests Vitest (bruit, relief, maillage, placement, textures, contrôleur, états, réglages, sauvegarde) ; `npm run check:size` (plus gros fichier : 0,7 Mo) |
| Déploiement | Workflow GitHub Pages (`.github/workflows/deploy-pages.yml`) et commande Cloudflare Pages documentés dans le README |
| Docs | `DESIGN.md` (dont créatures et véhicules), `STORY.md` (trois actes par camp), `CREDITS.md`, ce fichier |

### Critères d'acceptation
| Critère | État | Preuve / remarque |
|---|---|---|
| Traversée du monde à pied sans coupure visible | ✅ localement | Course simulée de 40 s : 0 image sans terrain ; jupes + géomorphing ; l'ancien terrain reste affiché tant que le nouveau n'est pas prêt. À confirmer en jeu réel, à la souris. |
| 45+ fps sur un PC moyen | ✅ mesuré (GTX 1050 Ti, 1080p) | Qualité *élevée* : 21,8 ms (≈ 46 i/s) dans le pire cas (village, forêt la plus dense), 17,3 ms (≈ 58 i/s) à Kessel ; qualité *moyenne* : 15,3 ms (≈ 65 i/s). En *auto* (défaut), la résolution dynamique vise 50 i/s. Mesures faites par rendus forcés, panneau du navigateur masqué : à confirmer en jeu réel. |
| Les deux camps se jouent différemment | ✅ | Tests unitaires : un Halden est bloqué par une falaise qu'un Sylmar escalade ; seul le Halden a un propulseur ; escalade de tronc jusqu'à l'ombrelle. |
| Site en ligne | ⏳ | Nécessite un compte (GitHub ou Cloudflare) : voir le README. |

### Ce qui reste / limites connues
- **Mise en ligne** : en attente du choix d'hébergeur et d'un compte.
- Changer la *densité* de végétation (qualité) régénère la flore : elle disparaît une fraction de seconde. La taille des textures n'est appliquée qu'au rechargement.
- Personnages en primitives (lisibles mais simples) ; pas encore de squelette ni de visage détaillé.
- Pas encore d'adversaires, de quêtes ni de carte (itération 3), ni de montures et de véhicules (itération 2).
- WebGPU non implémenté (WebGL2 uniquement). Rapier pas encore intégré (prévu pour les véhicules).
- Le paquet JS fait 703 Ko (187 Ko compressé) : découpage possible plus tard.

### Prochaine étape : itération 2 (mobilité)
1. Intégrer Rapier (`@dimforge/rapier3d-compat`) : colliders *heightfield* par tuiles autour des véhicules.
2. Montures terrestres Tormaq et Vexil (apprivoisement par la confiance, monter/descendre, déplacement adapté au relief).
3. Skarel : décollage, vol plané, battements, endurance ; préchargement du terrain dans la direction du vol.
4. Véhicules Halden : gyrocoptère, marcheur, chenillé, hydroglisseur (énergie, dégâts simples).

## Itération 2 — Mobilité

**Statut : implémentée, 34 tests verts, vérifiée dans le navigateur — à valider en jeu réel ; non commitée (git
indisponible sur la machine au moment du travail) ; non déployée (connexion Cloudflare à faire).**

### Résumé
1. **Rapier 0.21** intégré, chargé à la demande pour les Halden (module séparé de 4,1 Mo) : tuiles HeightField de 128 m
   générées dans les workers autour des corps actifs, troncs/rochers/structures en cylindres fixes, pas fixe de 60 Hz.
2. **Véhicules Halden** (`src/entities/Vehicles.ts`) : gyrocoptère (portance, assiette pilotée, autorotation, effet de
   sol), marcheur cinématique à 4 pattes (démarche en diagonale, IK, pente max 38°, enjambement), chenillé (contrôleur à
   rayons, 12 roues virtuelles, direction différentielle, foreuse → échantillons d'orvène), hydroglisseur (flottabilité
   sur 4 points, hélice, gouvernes, quille, déjaugeage). Énergie, dégâts de choc, hors service + rapatriement, recharge
   au dépôt de Kessel, **livraison par drone (R)**.
3. **Montures Sylmar** (`src/entities/Creatures.ts`) : hardes sauvages par habitat (Skarel sur les Tables, Tormaq près
   de l'eau, Vexil dans les clairières), fuite, **apprivoisement** (offrande accroupi, trois appels en rythme, harnais),
   appel (R), monte. Tormaq lent et puissant (charge), Vexil rapide (sprint 16 m/s, bond, crécelle), Skarel planeur
   (modèle d'énergie, battements, piqué, décrochage, colonnes thermiques, atterrissage).
4. **Flux sans pop-in en vol** : préchargement du terrain à la position prédite (≈ 3 s), flore qui « pousse » sur les
   derniers 20 % de sa distance d'affichage, créatures lointaines masquées.
5. HUD de monte/pilotage, panneau d'apprivoisement avec indicateur de rythme, sons synthétisés (moteurs, cris, ailes,
   chocs), sauvegarde des montures, véhicules, énergie/structure et orvène.

### Critères d'acceptation
| Critère | État |
|---|---|
| Montures et véhicules utilisables et distincts | ✅ tests (vitesses, vol, apprivoisement, physique des 4 véhicules sur le vrai terrain de Kessel) + gyrocoptère piloté dans le navigateur |
| Vol d'un bout à l'autre du monde sans pop-in gênant | 🟡 mécanismes en place (préchargement, fondu de la flore) ; traversée complète à confirmer en jeu réel |

### Reste / limites
- Commit à faire (git introuvable dans le PATH de PowerShell) et mise en ligne Cloudflare (`npx wrangler login`, puis `npm run deploy`).
- Modèles des véhicules volontairement simples (écrits rapidement) ; modèles des créatures plus détaillés.
- Le chenillé n'écrase pas encore la petite végétation ; pas de faune hostile (itération 3).

### Retouches demandées (11/11/2026)
- Chenillé garé 10 m plus loin de l'aire de fret de Kessel (≈ 52 m).
- Les véhicules restent où on les a laissés : position et orientation sauvegardées (retour au dépôt seulement s'ils
  sont hors service, tombés sous le terrain, ou pour les anciennes sauvegardes).
- Terrain photoréaliste : scans Poly Haven CC0 (sol forestier, boue et feuilles, paroi rocheuse, boue) en 4K
  (qualité élevée), 2K (moyenne), 1K (basse), chargés dans les workers ; repli procédural si absents ; échelles
  réelles (≈ 3 m par répétition) et anti-répétition au loin. Version bureau servie par un protocole `app://`.
- La flore, les personnages et les véhicules restent en géométrie procédurale stylisée.

### Extension gameplay (11/11/2026)
- **Vent** global (`src/world/Wind.ts`) : cap qui tourne, rafales, force selon la météo ; agit sur la flore, la pluie,
  le vol du Skarel, le gyrocoptère, les flèches, l'odorat de la faune ; indicateur dans le HUD.
- **Objets et fabrication** (`src/gameplay/Items.ts`) : 26 objets, 15 recettes (dont établi et feu), améliorations
  d'armes et d'armure ; inventaire (Tab/I), soin rapide et pose de feu de camp (G).
- **Armes** : Sylmar — arc (tension, gravité, vent ; flèches simples ou à résine), lance, couteau ; Halden — pulseur
  sismique (cellules), lance-fusées (lumière, fait fuir les prédateurs), clé de forage. Clic gauche, clic droit pour
  viser, X pour changer.
- **Faune aléatoire** (`src/gameplay/Fauna.ts`) : 8 espèces (proies en troupeau, territorial, meute de prédateurs,
  rôdeur solitaire, échassier, nuées d'oiseaux, fouisseur, carapace), apparition par habitat renouvelée toutes les
  5 min, perception (accroupi, course, nuit, odeur portée par le vent), dégâts, dépouille à dépecer.
- **Santé et satiété**, dégâts de chute, évanouissement → retour au camp ; repos et sommeil près d'un feu.
- **Monde interactif** : paniers de Vehra-Tal, caisses de Kessel, caches aléatoires, plantes et minerais à récolter,
  troncs et rochers à exploiter, établis, feux.
- **Photoréalisme** : sol en 5 matériaux scannés (dont litière de feuilles) découpés au mètre ; fougères, plantes et
  rochers scannés (Poly Haven) affichés près du joueur, version légère au loin.
- Limites : arbres (Colonniers, Arqués), personnages, bâtiments et véhicules restent procéduraux — les arbres scannés
  CC0 disponibles pèsent 58 à 900 Mo chacun (inutilisables en temps réel). Animaux glTF : `npm run fetch:fauna` une fois
  la clé Sketchfab placée dans `.env.local`.

## Itération 3 — Comptes, contenu et finition
*À venir.*
