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
*À venir.*

## Itération 3 — Comptes, contenu et finition
*À venir.*
