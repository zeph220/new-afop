# VEYRA — Document de design

> Univers 100 % original. Aucune reprise de noms, silhouettes, palettes signatures, scénario ou structure
> de missions d'œuvres existantes (en particulier *Avatar* et *Avatar: Frontiers of Pandora*).
> Ce qu'on reprend du genre : des idées générales (monde ouvert, montures, vol, véhicules, choix de camp, sauvegarde).

## 1. Intention

Un jeu d'exploration en monde ouvert jouable dans un navigateur de bureau, sans installation.
Le joueur choisit un camp et vit la même crise écologique sous deux angles : celui d'un peuple
autochtone qui grimpe, se cache et s'allie aux créatures, ou celui d'une équipe d'extraction
industrielle qui s'appuie sur la technologie et les véhicules.

Piliers :
1. **Le monde est le personnage principal** : jungle à étages, plateaux suspendus, brume vivante, nuits bioluminescentes.
2. **Deux façons de bouger, deux façons de voir** : les camps ne diffèrent pas que par la couleur, ils traversent le monde autrement.
3. **Continuité** : aucune coupure de chargement visible, de la marche au vol.

## 2. Le monde : Veyra

### 2.1 Astronomie
- **Veyra** est une lune forestière en rotation synchrone autour d'**Orun**, une géante gazeuse aux bandes
  **cuivre, rose poussière et ivoire**, entourée d'un anneau très fin et pâle. Orun reste toujours au même
  endroit du ciel (au sud-ouest, haut sur l'horizon) : c'est un repère de navigation naturel.
- L'étoile du système, **Kaïr**, est petite et blanc-doré. Un cycle jour/nuit complet dure **24 minutes** de jeu
  (réglable dans le code). La nuit, la lumière réfléchie par Orun baigne le monde d'une **teinte rosée** : les nuits ne
  sont jamais noires, et la flore s'allume.
- Gravité : **0,78 g** (7,6 m/s²). Les sauts sont légèrement plus amples que sur Terre.

### 2.2 Géographie (continent de 8 × 8 km, centré sur l'origine)
| Région | Position | Caractère |
|---|---|---|
| **Bassin d'Ilun** | centre | Jungle basse et dense, collines douces, réseau de **rivières de brume** (chenaux d'eau où la brume s'accumule). |
| **Tables de Sorr** | nord | **Plateaux suspendus** : tables rocheuses de 120 à 200 m de haut (type tépuis), falaises verticales stratifiées, sommets couverts de prairies. *Pas d'îles flottantes* : choix volontaire pour rester distinct. |
| **Faille d'Ambre** | est | Long canyon aux parois veinées d'**orvène** ambrée. Site d'extraction Halden **Forage Kessel**. |
| **Forêt des Colonniers** | ouest | Arbres géants (Colonniers) de 30 à 60 m. Village sylmar **Vehra-Tal**, bâti sur les ombrelles. |
| **Marais de Vesh** | sud | Terres basses inondées, eau stagnante, brume épaisse au lever du jour. |
| **Mer de Brume** | pourtour | Le continent se termine en à-pic sur un abîme de brume. Limite du monde jouable. |

### 2.3 Atmosphère et météo
- **Brume** : brouillard de hauteur (plus dense au fond des vallées), animé par un bruit qui dérive avec le vent.
- **Météo** (cycle automatique) : *clair* → *brume* → *orage* (pluie, éclairs, vent fort, ciel couvert) → *clair*.
- **Bioluminescence** : deux familles de couleurs, **violet** (lamelles, coupes-de-brume, nœuds des Arqués) et
  **ambre** (bulbes des fougères-lanternes, filaments des Colonniers). L'intensité suit la nuit et la météo.

### 2.4 Flore (designs originaux, géométrie procédurale)
| Nom | Taille | Silhouette | Lumière |
|---|---|---|---|
| **Colonnier** | 30–60 m | Tronc droit à côtes **torsadées en spirale**, couronné de 2–3 **ombrelles** (disques plats étagés, du plus large au plus petit). Les ombrelles sont **praticables**. | Filaments ambrés pendant sous les ombrelles |
| **Arqué** | 8–15 m | Tronc **courbé en arc**, grappes de feuilles tombantes en cônes. | Nœuds violets aux articulations |
| **Fougère-lanterne** | 1–2 m | Rosette de frondes arquées autour d'un **bulbe**. | Bulbe ambre |
| **Lamelle** | 0,4–0,8 m | Touffes de lames fines et raides. | Pointes violettes |
| **Coupe-de-brume** | 0,3–1,2 m | Champignon en **coupe évasée** sur pied fin. | Violet laiteux |
| **Blocs** | 1–6 m | Rochers erratiques arrondis. | — |

### 2.5 L'orvène
Cristal ambré enfoui dans la croûte de Veyra. Ses veines **régulent la chaleur de marée** de la lune :
elles absorbent l'énergie d'Orun et la restituent lentement. C'est ce qui stabilise la brume et le rythme
de floraison. Pour les Halden, c'est une batterie naturelle d'une densité inégalée. Extraire l'orvène
dérègle le cycle de la brume (orages hors saison, floraisons nocturnes en plein jour, migrations erratiques).
*Il n'existe ni conscience planétaire ni réseau neuronal global* : la crise est physique et écologique.

## 3. Les camps

### 3.1 Les Sylmar (camp A — peuple autochtone)
- **Apparence** : grande taille (≈ 2,5 m), membres longs, **peau écorcée** aux teintes **mousse et cuivre**,
  **crête de cheveux fibreux** (frondes raides plantées du front à la nuque), yeux ambrés légèrement lumineux.
  Vêtements de **fibres tressées** (écharpe croisée, pagne à franges, bracelets). *Ni peau bleue, ni queue.*
- **Lien aux créatures** : pas de connexion « physique » ou neuronale. Le lien se construit par la **confiance** :
  offrandes, imitation de l'**appel en trois temps**, harnais tressé posé seulement quand la bête l'accepte.
- **Style de jeu** : discrétion, arc et lance, grimpe, lecture du monde.

| Capacité (itération 1) | Détail |
|---|---|
| Course rapide | 8,5 m/s, endurance partagée avec la grimpe |
| Saut ample | 6,8 m/s d'impulsion |
| **Escalade** | Avancer face à une pente raide (> 42°) ou un tronc de Colonnier ⇒ le personnage grimpe. Consomme l'endurance. Saut (Espace) pour se décrocher. Au sommet d'un tronc : accès aux ombrelles. |
| Accroupi silencieux | Ctrl/C : déplacement lent, pas inaudibles (utile pour la discrétion à l'itération 3) |
| **Écho de sève** (F) | Onde qui fait s'illuminer la flore autour du joueur (révèle le relief la nuit). Recharge 6 s. |
| Vision nocturne | Exposition légèrement relevée la nuit (les Sylmar voient mieux dans la pénombre) |

### 3.2 Le Consortium Halden (camp B — colons industriels)
- **Apparence** : humains (≈ 1,85 m) en **combinaisons ocre** renforcées de **plaques gris acier**, casque à visière
  orange, sac dorsal modulaire. Matériel lourd, peint, numéroté, rafistolé.
- **Style de jeu** : technologie, véhicules, drones, armes à distance.

| Capacité (itération 1) | Détail |
|---|---|
| Course | 6,8 m/s, pas d'endurance |
| **Propulseur dorsal** | Maintenir Espace en l'air : poussée verticale + contrôle horizontal. Carburant 100 %, recharge au sol. |
| Lampe frontale | L : projecteur pour la nuit |
| **Scan géologique** (F) | Onde de scan qui dessine les **courbes de niveau** sur le terrain et affiche altitude/distance du repère le plus proche. Recharge 6 s. |
| HUD technique | Altitude, coordonnées, cap numérique |

## 4. Contrôles

| Action | Clavier / souris | Manette |
|---|---|---|
| Se déplacer | ZQSD (AZERTY) / WASD (QWERTY) — détection par position physique | Stick gauche |
| Caméra | Souris (verrouillage du pointeur au clic) | Stick droit |
| Courir | Maj | Gâchette gauche / clic stick gauche |
| Sauter / propulseur | Espace | A |
| S'accroupir | Ctrl ou C | B |
| Capacité de camp | F | X |
| Lampe (Halden) | L | Y |
| Interagir / monter / descendre (itération 2) | E | RB |
| Appeler sa monture (itération 2) | R | — |
| Couper / relancer le moteur du gyrocoptère (itération 2) | V | — |
| Zoom caméra | Molette | — |
| Aide des commandes | H | — |
| Pause | Échap | Start |

## 5. Créatures

### 5.1 Apprivoisement (commun aux trois montures)
Jauge de **confiance** 0–100, aucun lien physique ni neuronal.
1. **Offrande** : approcher accroupi (debout à moins de 12 m, la bête fuit), poser l'offrande propre à l'espèce (E), reculer. +40.
2. **Appel en trois temps** : trois appels (F) ; la bête répond à chacun, le joueur reprend son tempo (fenêtre ± 0,25 s). +20 par réussite, −20 par erreur ; deux erreurs = fuite, retour 2 min plus tard.
3. **Harnais tressé** : à 100, E maintenu 2 s. Refus si le joueur a blessé un congénère dans les 5 dernières minutes.

Une monture apprivoisée vient à l'appel (touche R). Monté : Espace = saut ou battement, Maj = sprint, Ctrl = ralentir ou se coucher, E = descendre.

### 5.2 Skarel — planeur des Tables
| | |
|---|---|
| **Silhouette** | Corps plat et fuselé de 5,2 m, tête courte et ronde à deux paires d'yeux, sans bec. **Trois paires d'ailes étagées**, décroissantes d'avant en arrière : 8,5 m, 6 m et 3,5 m d'envergure. Vue de dessus, un losange en escalier ; de profil, trois voiles décalées en hauteur, la paire avant la plus haute. Membranes tendues sur 4 baguettes. Pas de queue-gouvernail : un ruban caudal souple de 2 m. Crête lumineuse du front à mi-dos (1,1 m). |
| **Palette** | Corps `#3F4A3C`, ventre `#C9B89B`, membrane `#E9D7C6` (opacité 0,45), nervures `#8A5A3B`, crête émissive `#B884FF` qui vire à `#FFB347` en vol rapide. |
| **Sauvage** | Colonies sur les rebords des Tables de Sorr. Décolle en se laissant tomber des falaises, chasse les filandres au crépuscule, se chauffe ailes ouvertes au soleil de Kaïr. |
| **Apprivoisement** | Offrande : bulbe de fougère-lanterne au bord d'une falaise. Appel lent (≈ 1,2 s entre les temps). Harnais en sangle croisée entre ailes avant et médianes. Crépuscule ou nuit seulement. |
| **Jeu** | Plané 14–32 m/s selon la pente, piqué jusqu'à 45 m/s (ailes arrière repliées), décrochage sous 11 m/s. **Battement** (Espace) : +6 m/s vertical, 3 charges, 1 charge / 8 s. Les **colonnes thermiques** au-dessus des veines d'orvène rechargent et font monter ; l'extraction les raréfie. Décollage : 15 m de dénivelé ou les 3 charges. F monté : la crête éclaire à 20 m. Caméra reculée et champ +10° au-delà de 30 m/s. |
| **Construction** | Corps `LatheGeometry` aplati ; ailes `ShapeGeometry` (Bézier), `MeshPhysicalMaterial` transmission 0,6, `DoubleSide` ; baguettes `CylinderGeometry` ; crête : 12 `ConeGeometry` émissifs ; ruban : `PlaneGeometry` ondulé en vertex shader. Battements déphasés de 0 / 0,35 / 0,7 rad (vague d'avant en arrière). ≈ 1 200 triangles. |

### 5.3 Tormaq — porteur des marais
| | |
|---|---|
| **Silhouette** | Quadrupède trapu, 5,5 m de long, 2,4 m au garrot, 3 m de large. **Dos plat** : carapace de 3,5 × 2,4 m où poussent mousse et lamelles. Pattes en colonnes courtes (0,9 m), pieds larges ; tête basse en pelle (0,9 m) qui filtre la vase. |
| **Palette** | Carapace `#6B5A44`, mousse `#5E7A3A`, peau `#8C705A`, ventre `#B39A7C`, yeux `#E3A33B`, pores ambrés des flancs `#FFB347` (nuit). |
| **Sauvage** | Hardes de 4–8 menées par une matriarche, le long des chenaux de brume où ils broutent les coupes-de-brume. Paisibles ; chargent si l'on approche un petit debout et à découvert. |
| **Apprivoisement** | Offrande : brassée de coupes-de-brume. Appel grave et régulier (≈ 0,8 s). Harnais : filet tressé posé sur le dos, seulement si la matriarche tolère le joueur. |
| **Jeu** | Marche 3 m/s, trot 5,5 m/s, **charge** 9 m/s pendant 4 s (renverse blocs ≤ 2 m et barricades). Endurance 100, charge = 40. Gué jusqu'à 1,8 m d'eau, pente max 30°, virage 45°/s. Le dos porte 1 passager et 4 caisses. Forte inertie, caméra basse, secousse à chaque pas. |
| **Construction** | Corps `RoundedBoxGeometry` (addon) 3,5 × 1,2 × 2,4 ; pattes `CylinderGeometry` ; tête `SphereGeometry` écrasée + `BoxGeometry` ; mousse en couleurs de sommets (bruit) ; lamelles du dos : réutiliser l'`InstancedMesh` de la flore. |

### 5.4 Vexil — coureur des lamelles
| | |
|---|---|
| **Silhouette** | Bipède digitigrade, 2,8 m à la tête. Corps compact en goutte (1,4 m), long cou en S, tête étroite à museau corné, pas de bras ; pattes de 1,6 m à trois doigts ; queue courte en éventail. **Plumage en lamelles** rigides de 0,3 à 0,5 m qui cliquettent à la course. Couché dans un champ de lamelles, il disparaît presque. |
| **Palette** | Lamelles cuivre `#B5733A` dégradé vers l'ivoire `#EDE3CE` aux pointes, pointes émissives `#9B6BFF` la nuit, pattes `#4A3B30`, yeux `#F2B640`. |
| **Sauvage** | Petits groupes dans les clairières du Bassin d'Ilun et des Colonniers. Très farouche, fuit en zigzag au moindre bruit, attiré par les objets brillants. |
| **Apprivoisement** | Offrande : grappe de feuilles d'Arqué. Appel vif (≈ 0,5 s). Harnais : bride tressée au cou et étriers en boucle. |
| **Jeu** | Trot 9 m/s, sprint 16 m/s (endurance 10 s, recharge 6 s), saut 9 m/s (bond de 12 m, franchit les rivières de brume), virage 180°/s. **Crécelle** (F) : effraie la petite faune et révèle les fausses-coupes à 25 m. Ctrl : se couche, discrétion maximale. |
| **Construction** | Corps `SphereGeometry` en ellipsoïde, cou `TubeGeometry` sur `CatmullRomCurve3`, pattes à deux segments (IK simple) ; lamelles en `InstancedMesh` (`BoxGeometry` 0,02 × 0,4 × 0,06, ≈ 250 instances placées par `MeshSurfaceSampler`), frémissement en vertex shader. |

### 5.5 Faune sauvage (non chevauchable)
| Créature | Rôle | Description | Jeu | Construction |
|---|---|---|---|---|
| **Filandre** | Ambiance | Ruban volant de 1,5 m, ivoire `#EDE3CE` à reflets rosés, en bancs de 20 à 60 au-dessus des rivières de brume au crépuscule. | Baromètre vivant : vol bas = orage dans 2 min. Proie des Skarels. | `PlaneGeometry` segmentée ondulée en shader, `InstancedMesh`, boids simplifiés. |
| **Fausse-coupe** | Embuscade | Animal enfoui de 2,5 m dont seule émerge une collerette imitant un bouquet de coupes-de-brume ; violet `#A97CE8`, mais pulsation lente et décalée (indice lisible). Marais de Vesh, Bassin d'Ilun. | Surgit sous 3 m : fouet de deux tentacules, 15 dégâts, ralentissement 3 s. L'Écho de sève et le scan la révèlent. | Mesh de coupe-de-brume réutilisé + `CylinderGeometry` segmentées animées. |
| **Rôdeur d'ambre** | Adversaire | Prédateur plat de 3 m à quatre membres écartés, collé aux parois de la Faille d'Ambre ; peau `#5A4636` striée `#D9893A`, fossettes thermiques. | Attiré par la chaleur des cellules d'orvène : bondit sur les véhicules. Fuit la lumière vive ; les Sylmar le détournent avec des pierres chauffées. | `BoxGeometry` aplatie + 4 `CylinderGeometry`, orientation alignée sur la normale du terrain. |

## 6. Véhicules Halden

### 6.1 Règles communes
- **Énergie** : toutes les machines tournent aux **cellules d'orvène**. L'ironie est assumée : plus on roule, plus il
  faut extraire. Jauge 0–100 %, recharge ≈ 8 %/s aux bornes du Forage Kessel, du Poste Ilun et du Relais Vesh-3.
  Une jauge vide laisse 5 % de réserve à 40 % de puissance. Les cellules chaudes attirent les Rôdeurs d'ambre.
- **Dégâts** : points de structure (PS). Choc : dégâts = max(0, impulsion − seuil) × k. Au-dessus de 50 % : normal ;
  25–50 % : fumée, vitesse max −25 % ; sous 25 % : étincelles, commandes qui dérivent ; 0 : hors service, joueur
  éjecté, véhicule rapatrié au dépôt en 60 s. La réparation s'ajoute à la **dette du contrat**.
- **Palette** : ocre `#C8862E`, gris acier `#6E757B`, graphite `#232427`, pochoirs ivoire `#EDE6D8` (« HALDEN »,
  matricule), bandes de danger orange `#F06A1F` et noir, rouille `#7A4A2A` sur les arêtes (couleurs de sommets).
- **Contrôles communs** : E monter/descendre, ZQSD/WASD conduire, Maj boost, L phares, F scan géologique.
- **Physique (Rapier)** : gravité 7,6 m/s² ; un corps rigide par véhicule, colliders en boîtes composées ; terrain
  en `HeightField` Rapier construit sur la heightmap analytique, par tuiles de 128 m autour du joueur.

| | Gyrocoptère « Rotor » | Marcheur de transport | Chenillé d'extraction | Hydroglisseur |
|---|---|---|---|---|
| Rôle | Vol, reconnaissance, sauvetage | Fret en terrain accidenté | Forage, terrain lourd | Rivières de brume, marais |
| L × l × h | 7,5 × 2,2 × 3 m, rotor Ø 9 m | 7 × 4,5 × 6 m | 12 × 5 × 4,5 m, foreuse 4 m | 6 × 2,8 × 2,4 m, hélice Ø 2,2 m |
| Masse | 1,1 t | 9 t | 38 t | 0,9 t |
| Vitesse croisière / max | 28 / 42 m/s, montée 6 m/s | 4,5 / 6,5 m/s | 4 / 8 m/s | 12 / 18 m/s sur l'eau, 6 sur la vase |
| Autonomie à 100 % | 6 min | 12 min | 15 min (foreuse ×3) | 9 min |
| PS / seuil de choc | 100 / 6 m/s | 250 / 4 m/s | 400 / 3 m/s | 120 / 7 m/s |
| Places | 2 | 1 + 6 caisses | 2 | 3 |

### 6.2 Gyrocoptère « Rotor »
- **Contrôles** : Espace / Ctrl = pas collectif, Z/S tangage, Q/D roulis avec lacet coordonné, Maj surpuissance
  (+30 % pendant 5 s). Stabilisation automatique à plat sans entrée. Coupure moteur (touche V) :
  autorotation silencieuse à 7 m/s de descente, pour les filatures.
- **Sensation** : léger et nerveux, secoué par les rafales (le vent météo s'applique en force), vibration de caméra
  liée au régime, effet de sol sous 4 m (+15 % de portance).
- **Modélisation** : cage de cockpit en `CylinderGeometry` fins, poutre de queue `BoxGeometry`, rotor bipale remplacé
  à haut régime par un disque flou (`CircleGeometry` translucide), patins `TubeGeometry`.
- **Physique** : corps dynamique ; portance = collectif × k sur l'axe haut local ; traînée quadratique ; amortissement
  angulaire 2,5 ; couple de rappel vers la verticale.

### 6.3 Marcheur de transport
- **Forme** : plateforme plate sur **quatre jambes à deux segments**, cabine-bulle sous l'avant de la plateforme.
  Ni bras, ni arme, ni silhouette humaine : un engin de fret, pas un exosquelette.
- **Contrôles** : Z/S avancer/reculer, Q/D pivoter sur place (25°/s), Espace enjamber (plateforme +1 m pendant 3 s).
- **Sensation** : roulis doux, tangage à chaque pas, jamais rapide mais rarement bloqué (pente 38°, obstacles 1,8 m).
- **Modélisation** : plateforme `BoxGeometry`, segments `CylinderGeometry`, rotules `SphereGeometry`, pieds en disques ;
  démarche en diagonale (pattes opposées en phase).
- **Physique** : corps **cinématique**. Chaque pied interroge la heightmap (IK à deux os) ; hauteur et inclinaison de
  la plateforme = plan moyen des quatre pieds. Stable et peu coûteux ; le collider sert aux autres objets.

### 6.4 Chenillé d'extraction
- **Contrôles** : direction différentielle (Q/D freinent une chenille), Espace frein, F maintenu = foreuse (creuse
  blocs et parois marquées orvène), Maj = couple maximal en pente.
- **Sensation** : inertie énorme (3 s pour atteindre sa vitesse), écrase la petite végétation (instances masquées),
  caméra haute, grondement grave.
- **Modélisation** : caisse `BoxGeometry`, chenilles en boîtes arrondies à texture de patins défilante (UV selon la
  vitesse de chaque côté), 6 galets par côté, foreuse `ConeGeometry` + spirale `TubeGeometry`.
- **Physique** : corps dynamique, `DynamicRayCastVehicleController` de Rapier avec **6 roues virtuelles par côté**
  (suspension par rayon, forte friction latérale). La chenille n'existe pas physiquement : seule l'animation suit les
  roues. Centre de masse abaissé contre le basculement.

### 6.5 Hydroglisseur
- **Contrôles** : Z/S poussée de l'hélice, Q/D gouvernes d'air (efficaces seulement en mouvement), Espace déjauger
  (saut de 1,5 m, 1 charge / 5 s).
- **Sensation** : glissant, dérive en virage, rebonds sur le clapot ; continue sur la berge jusqu'à 10 m puis s'échoue.
- **Modélisation** : coque plate `ExtrudeGeometry` (profil trapézoïdal), cage `TorusGeometry` à rayons, hélice tripale,
  sièges `BoxGeometry`.
- **Physique** : corps dynamique ; **flottabilité** sur 4 points de coque (force = profondeur immergée × ρ × g × aire,
  plus amortissement) ; niveau d'eau = plan local de la rivière (même fonction que le rendu) ; forte friction latérale
  (effet de quille) ; poussée appliquée au point de l'hélice.

## 7. Technique

### 7.1 Pile
- **Vite + TypeScript + Three.js** (WebGL2 ; WebGPU envisagé en option plus tard).
- **Rapier** (`@dimforge/rapier3d-compat`) : introduit à l'itération 2 pour les véhicules. À pied, le personnage
  utilise un contrôleur cinématique qui interroge directement la heightmap analytique (même triangulation que
  le maillage affiché), ce qui est plus précis et moins coûteux.
- **Supabase** (itération 3) pour les comptes et la sauvegarde ; `localStorage` en secours (déjà actif).

### 7.2 Terrain
- Fonction de hauteur **analytique et déterministe** (bruit simplex graine fixe, domain warping, crêtes, plateaux
  en terrasses, rivières par isolignes de bruit, falaise périphérique).
- **Quadtree LOD** (type CDLOD) : feuilles de 128 m à 2 m de résolution, nœuds jusqu'à 8 km. Chaque nœud = grille
  64 × 64. **Géomorphing** dans le vertex shader (transition continue vers le niveau parent) + **jupes** sur les
  bords : ni fissure ni saut visible.
- Génération dans un **Web Worker** ; l'ensemble de nœuds affiché n'est remplacé que lorsque le nouvel ensemble est
  entièrement prêt (pas de trou pendant le streaming).
- Matériau : `MeshStandardMaterial` étendu (mélange mousse / humus / roche / limon selon pente, altitude et bruit ;
  roche en projection triplanaire ; teinte sous-marine ; veines d'orvène luisantes dans la Faille d'Ambre).

### 7.3 Végétation
- Couches indépendantes (cellules de 64 à 512 m selon l'espèce) en `InstancedMesh`, placement déterministe par
  hachage (identique dans le worker et le thread principal pour les collisions).
- Vent et émission bioluminescente dans le shader ; deux niveaux de détail pour les Colonniers.

### 7.4 Textures
- Itération 1 : textures PBR **1K procédurales** (albédo + rugosité, normale + hauteur) générées dans un worker,
  regroupées en `DataArrayTexture`, sans téléchargement.
- Itération 3 : pipeline **KTX2 / Basis Universal** (1K / 2K / 4K) à partir de sources CC0 (Poly Haven, ambientCG),
  chargement progressif selon la distance et la mémoire. Aucun fichier > 25 Mo (`npm run check:size`).

### 7.5 Rendu
- Ciel procédural (diffusion simplifiée, Orun avec bandes et phase, anneau, étoiles, nuages), brouillard de hauteur
  global (remplace les chunks de brouillard de Three.js), eau animée (Fresnel, spéculaire), ombres du soleil centrées
  sur le joueur, bloom pour la bioluminescence.
- Préréglages de qualité **auto / élevée / moyenne / basse** ; en *auto*, la résolution s'adapte pour viser 50+ fps.

### 7.6 Budget de performance (PC moyen, 1080p)
- 45+ fps minimum. Cibles : < 250 draw calls, < 1,5 M triangles, < 8 ms CPU par image.
