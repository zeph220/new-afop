// Assemblage du jeu : rendu, monde, joueur, interface, sauvegarde, audio, boucle principale.

import {
  ACESFilmicToneMapping,
  Clock,
  Color,
  Euler,
  Fog,
  Material,
  Mesh,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { Input } from './Input.ts';
import { StateMachine, type GameState } from './StateMachine.ts';
import { WorkerPool } from './WorkerPool.ts';
import { loadSettings, saveSettings, resolveQuality, QUALITY, type QualityParams, type Settings, safeStorage } from './Settings.ts';
import { AutoSaver, LocalSaveBackend, SAVE_VERSION, type SaveData } from './SaveSystem.ts';
import { G, installGlobalShaderHooks } from '../render/Globals.ts';
import { buildArrayTextures, createTerrainMaterial } from '../render/TerrainMaterial.ts';
import { Sky } from '../render/Sky.ts';
import { Water } from '../render/Water.ts';
import { TerrainSystem } from '../world/TerrainSystem.ts';
import { VegetationSystem } from '../world/VegetationSystem.ts';
import { Environment } from '../world/Environment.ts';
import { Landmarks } from '../world/Landmarks.ts';
import { LANDMARKS, WATER_LEVEL, canyonCenterX, edgeDistance, groundHeight, regionName, spawnPoint } from '../world/WorldGen.ts';
import { collidersNear, setColliderShape, type Cylinder } from '../world/VegetationPlacement.ts';
import { TERRAIN_MATERIALS, type MaterialTexture } from '../textures/TextureGen.ts';
import { PlayerController, type PlayerInput, type WorldQuery } from '../player/PlayerController.ts';
import { CharacterModel } from '../player/CharacterModel.ts';
import { CameraRig } from '../player/CameraRig.ts';
import { FACTIONS, type FactionId } from '../player/Factions.ts';
import { AudioEngine } from '../audio/AudioEngine.ts';
import { UI, type HudData, type RideHud } from '../ui/UI.ts';
import { Physics } from '../physics/Physics.ts';
import { VehicleFleet, VEHICLE_ORDER, type DriveInput, type Vehicle } from '../entities/Vehicles.ts';
import { CreatureManager, Creature, type RideInput, type TamingView } from '../entities/Creatures.ts';
import type { CreatureKind, VehicleKind } from '../entities/types.ts';
import { Gameplay, type GameplaySave } from '../gameplay/Gameplay.ts';
import { loadPhotoFlora } from '../world/PhotoFlora.ts';
import { applyVehicleSkins, clearVehicleSkins, updateVehicleSkins } from '../entities/VehicleSkins.ts';

type Riding = { type: 'creature'; c: Creature } | { type: 'vehicle'; v: Vehicle } | null;

export class Game {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly input: Input;
  readonly sm = new StateMachine();
  readonly ui: UI;
  readonly audio = new AudioEngine();
  settings: Settings;
  quality!: QualityParams;
  qualityName = 'moyenne';
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private pool: WorkerPool;
  terrain!: TerrainSystem;
  veg!: VegetationSystem;
  private sky = new Sky();
  private water = new Water();
  env!: Environment;
  private landmarks!: Landmarks;
  private fog = new Fog(0x8899aa, 1, 1000);
  player: PlayerController | null = null;
  private model: CharacterModel | null = null;
  private rig: CameraRig;
  faction: FactionId | null = null;
  private saver: AutoSaver;
  private backend = new LocalSaveBackend(safeStorage());
  private clock = new Clock();
  private playTime = 0;
  private abilityTimer = 0;
  private pulseT = -1;
  private menuAngle = 0;
  private frameMs = 16;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 60;
  private dynScale = 1;
  private dynTimer = 0;
  private hudTimer = 0;
  private introTimer = 0;
  private wantPointerLock = false;
  private focus = new Vector3();
  private worldQuery: WorldQuery;
  private lastRegion = '';
  private camObstacles: Cylinder[] = [];
  // Itération 2 : montures et véhicules
  physics: Physics | null = null;
  fleet: VehicleFleet | null = null;
  creatures: CreatureManager | null = null;
  riding: Riding = null;
  private inventory: Record<string, number> = {};
  gameplay: Gameplay | null = null;
  private tamingView: TamingView | null = null;
  private lastMouseMove = 0;
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    installGlobalShaderHooks();
    this.settings = loadSettings();
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    if (!this.renderer.capabilities.isWebGL2) throw new Error('WebGL2 requis');
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.info.autoReset = false;
    this.camera = new PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 0.3, 16000);
    this.scene.fog = this.fog;
    this.scene.add(this.sky.mesh, this.water.mesh);
    this.input = new Input(canvas);
    this.rig = new CameraRig(this.camera);
    const cores = navigator.hardwareConcurrency || 4;
    this.pool = new WorkerPool(Math.max(2, Math.min(4, cores - 1)));
    this.worldQuery = {
      ground: (x, z, n) => groundHeight(x, z, n),
      colliders: (x, z, r, out) => collidersNear(x, z, r, this.veg?.density ?? 1, out),
      waterLevel: WATER_LEVEL,
      edgeDistance,
    };
    this.ui = new UI(
      uiRoot,
      {
        onNewGame: () => this.sm.go('factionSelect'),
        onContinue: () => void this.continueGame(),
        onPickFaction: (f) => void this.newGame(f),
        onBackToMenu: () => this.sm.go('menu'),
        onResume: () => this.resume(),
        onQuitToMenu: () => void this.quitToMenu(),
        onSettingsChange: (s) => this.applySettings(s),
        onSaveNow: () => void this.saver.saveNow().then((ok) => this.ui.toast(ok ? 'Partie sauvegardée.' : 'Sauvegarde impossible.')),
        onClickToPlay: () => this.lockPointer(),
        onUiSound: () => {
          this.audio.init();
          this.audio.click();
        },
      },
      this.settings,
    );
    this.saver = new AutoSaver(this.backend, () => this.collectSave());
    this.sm.on((to, from) => this.onState(to, from));
    canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.sm.state === 'playing') this.lockPointer();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === canvas;
      if (!locked && this.sm.state === 'playing' && this.wantPointerLock && !this.input.usingPad) this.sm.go('paused');
    });
    window.addEventListener('resize', () => this.resize());
    this.applyQuality();
  }

  // -------------------------------------------------------------------------------------------
  async start(): Promise<void> {
    this.ui.show('loading');
    this.ui.setLoading(0.02, 'Tissage des textures de Veyra…');
    const size = this.quality.textureSize;
    let done = 0;
    const loadLayers = (photo: boolean) =>
      Promise.all(
        TERRAIN_MATERIALS.map((m) =>
          this.pool
            .request<MaterialTexture>(
              photo ? { type: 'photo', material: m, size, baseUrl: new URL('textures/', document.baseURI).href } : { type: 'tex', material: m, size },
            )
            .then((t) => {
              done++;
              const label = photo ? 'Textures photoréalistes' : 'Textures procédurales';
              this.ui.setLoading(0.02 + (done / TERRAIN_MATERIALS.length) * 0.38, `${label} ${done}/${TERRAIN_MATERIALS.length}…`);
              return t;
            }),
        ),
      );
    // Scans photoréalistes ; repli sur les textures procédurales s'ils sont introuvables.
    let layers: MaterialTexture[];
    try {
      layers = await loadLayers(true);
    } catch (err) {
      console.warn('Textures photoréalistes indisponibles, repli procédural :', err);
      done = 0;
      layers = await loadLayers(false);
    }
    const { albedo, normal } = buildArrayTextures(layers, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    const terrainMat = createTerrainMaterial(albedo, normal, this.quality.triplanar);
    this.terrain = new TerrainSystem(this.pool, terrainMat);
    this.terrain.setRangeFactor(this.quality.terrainRange);
    this.veg = new VegetationSystem(this.pool);
    // Plantes et rochers scannés (Poly Haven) : remplacent la géométrie procédurale dès qu'ils sont prêts.
    void loadPhotoFlora(
      new URL('models/flora/', document.baseURI).href,
      (id) => (id === 'fougere' ? new Color(1.0, 0.62, 0.22) : new Color(0.62, 0.32, 1.0)),
      (l) => {
        this.veg.override(l.id, l.geometry, l.materials, l.near);
        // Collisions à la forme réelle du modèle (tronc, canopée, plateformes, rochers).
        if (l.colliders) {
          setColliderShape(l.id, l.colliders);
          this.physics?.resetObstacles();
        }
      },
    );
    this.veg.configure(this.quality.vegDensity, this.quality.vegDistance, this.quality.shadows);
    this.landmarks = new Landmarks();
    this.scene.add(this.terrain.group, this.veg.group, this.landmarks.group);
    this.env = new Environment(this.scene, this.sky, this.water, this.fog);
    this.env.onThunder = (delay, s) => this.audio.thunder(delay, s);
    this.applyShadowSettings();

    const save = await this.backend.load();
    this.ui.setContinueInfo(save ? `${FACTIONS[save.faction].name} · ${formatPlayTime(save.playTime)} · ${regionName(save.position.x, save.position.z)}` : null);

    this.ui.setLoading(0.4, 'Élévation du relief…');
    this.menuCamera(0);
    this.env.update(0.016, this.camera.position, this.camera.position);
    await this.terrain.warmup(this.camera.position, (p) => this.ui.setLoading(0.4 + p * 0.5, `Génération du terrain ${Math.round(p * 100)} %`));
    this.ui.setLoading(0.92, 'Croissance de la forêt…');
    await this.waitVegetation(this.camera.position, 5000);
    this.ui.setLoading(1, 'Prêt.');
    this.sm.go('menu');
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private async waitVegetation(pos: Vector3, timeout: number): Promise<void> {
    const t0 = performance.now();
    this.veg.update(pos);
    while (this.veg.pendingCount > 0 && performance.now() - t0 < timeout) {
      await new Promise((r) => setTimeout(r, 50));
      this.veg.update(pos);
    }
  }

  // -------------------------------------------------------------------------------------------
  private onState(to: GameState, from: GameState): void {
    if (to === 'menu') {
      this.ui.show('menu');
      this.input.exitPointerLock();
      this.wantPointerLock = false;
      if (from === 'boot') this.menuAngle = 0;
    } else if (to === 'factionSelect') {
      this.ui.show('factions');
    } else if (to === 'playing') {
      this.ui.show('hud');
      this.clock.getDelta();
    } else if (to === 'paused') {
      this.ui.show('pause');
      this.wantPointerLock = false;
      this.input.exitPointerLock();
      void this.saver.saveNow();
    }
  }

  private lockPointer(): void {
    this.wantPointerLock = true;
    this.input.requestPointerLock();
  }

  private resume(): void {
    this.sm.go('playing');
    this.lockPointer();
  }

  private async quitToMenu(): Promise<void> {
    await this.saver.saveNow();
    this.despawn();
    const save = await this.backend.load();
    this.ui.setContinueInfo(save ? `${FACTIONS[save.faction].name} · ${formatPlayTime(save.playTime)} · ${regionName(save.position.x, save.position.z)}` : null);
    this.sm.go('menu');
  }

  private async newGame(f: FactionId): Promise<void> {
    this.lockPointer();
    const sp = spawnPoint(f);
    this.env.time = 0.34;
    this.env.setWeather('clair', true);
    this.playTime = 0;
    await this.spawn(f, sp.x, sp.y + 0.1, sp.z, f === 'sylmar' ? -Math.PI / 2 : Math.PI / 2);
    this.ui.toast(f === 'sylmar' ? 'Vehra-Tal, Forêt des Colonniers. La brume ne monte plus à l’heure.' : 'Forage Kessel, rive de la Faille d’Ambre. Prise de poste.');
    void this.saver.saveNow();
  }

  private async continueGame(): Promise<void> {
    const s = await this.backend.load();
    if (!s) return;
    this.lockPointer();
    this.env.time = s.timeOfDay;
    this.env.setWeather(s.weather, true);
    this.playTime = s.playTime;
    await this.spawn(s.faction, s.position.x, s.position.y + 0.2, s.position.z, s.yaw, s);
    this.ui.toast('Partie reprise.');
  }

  private async spawn(f: FactionId, x: number, y: number, z: number, yaw: number, save?: SaveData): Promise<void> {
    this.despawn();
    this.faction = f;
    const def = FACTIONS[f];
    this.ui.setFactionTheme(f);
    this.ui.show('loading');
    this.ui.setLoading(0.1, `Arrivée : ${regionName(x, z)}…`);
    // Gameplay (objets, armes, faune sauvage) : l'inventaire est partagé avec le reste du jeu.
    this.gameplay = new Gameplay(
      f,
      {
        add: (o) => this.scene.add(o),
        remove: (o) => this.scene.remove(o),
        toast: (m) => this.ui.toast(m),
        audio: this.audio,
        hudRoot: this.ui.hudRoot,
        onDeath: () => {
          if (this.riding) this.leaveRide(true);
          const sp = spawnPoint(f);
          this.player?.teleport(sp.x, sp.y + 0.2, sp.z);
          this.ui.toast(f === 'sylmar' ? 'Vous vous réveillez à Vehra-Tal.' : 'Rapatrié au Forage Kessel.');
        },
        onRest: () => {
          this.env.time = 0.27;
        },
        setPointerLock: (on) => (on ? this.input.requestPointerLock() : this.input.exitPointerLock()),
      },
      save?.inventory ?? {},
      save?.gameplay as Partial<GameplaySave> | undefined,
    );
    this.inventory = this.gameplay.inv.items;
    // Faune (les deux camps) ; montures apprivoisées (Sylmar).
    const tamedKinds = (save?.tamed ?? []).filter((k): k is CreatureKind => k === 'skarel' || k === 'tormaq' || k === 'vexil');
    this.creatures = new CreatureManager(
      (c) => this.scene.add(c.model.root),
      (c) => this.scene.remove(c.model.root),
      f === 'sylmar' ? tamedKinds : [],
    );
    this.creatures.events = {
      onCall: (kind, _pan, gain) => this.audio.creatureCall(kind, gain),
      onToast: (m) => this.ui.toast(m),
      onTamed: (kind) => {
        this.ui.toast(`Le ${kind === 'skarel' ? 'Skarel' : kind === 'tormaq' ? 'Tormaq' : 'Vexil'} accepte le harnais tressé. E : monter · R : l’appeler.`);
        void this.saver.saveNow();
      },
    };
    // Véhicules Halden : moteur physique Rapier chargé à la demande.
    if (f === 'halden') {
      this.ui.setLoading(0.12, 'Initialisation de la physique (Rapier)…');
      this.physics ??= await Physics.load(this.pool);
      this.physics.vegDensity = this.veg.density;
      const unlocked = (save?.vehicles?.length ? save.vehicles : VEHICLE_ORDER).filter((k): k is VehicleKind => (VEHICLE_ORDER as string[]).includes(k));
      this.fleet = new VehicleFleet(this.physics, unlocked, save?.vehicleState ?? {});
      for (const v of this.fleet.list) this.scene.add(v.model.root);
      void applyVehicleSkins(this.fleet.list, new URL('models/vehicles/', document.baseURI).href);
      this.fleet.events = {
        onDamage: (v, a) => {
          if (v === this.fleet?.driven) this.audio.clank(a);
        },
        onDisabled: (v) => {
          if (this.riding?.type === 'vehicle' && this.riding.v === v) this.leaveRide(true);
          this.ui.toast(`${v.def.short} hors service : rapatriement au dépôt dans 60 s. La réparation s’ajoute à la dette du contrat.`);
        },
        onOre: (v) => {
          if (v.position.x > 1700) {
            this.inventory.orvene = (this.inventory.orvene ?? 0) + 1;
            this.ui.toast(`Échantillon d’orvène prélevé (${this.inventory.orvene} au total).`);
          } else this.ui.toast('La foreuse ne trouve aucune veine d’orvène ici.');
        },
        onDelivered: (v) => this.ui.toast(`${v.def.short} livré par le drone de fret.`),
        onWalkerStep: () => {
          if (this.fleet?.driven?.kind === 'marcheur') this.audio.walkerStep();
        },
      };
    }
    this.player = new PlayerController(def, this.worldQuery);
    this.player.teleport(x, Math.max(y, groundHeight(x, z)), z);
    this.player.yaw = yaw;
    this.player.events = {
      onStep: (s) => this.audio.step(s, f === 'halden'),
      onLand: (i) => {
        this.audio.land(i);
        if (!this.riding) this.gameplay?.onLand(i);
      },
      onSplash: () => this.audio.splash(),
    };
    this.model = new CharacterModel(def);
    this.scene.add(this.model.root);
    this.rig.yaw = yaw;
    this.rig.pitch = 0.22;
    this.rig.targetDistance = def.cameraDistance;
    this.rig.snap();
    this.env.nightVision = def.nightVision;
    this.abilityTimer = 0;
    this.introTimer = 0;
    const pos = new Vector3(x, y + 2, z);
    await this.terrain.warmup(pos, (p) => this.ui.setLoading(0.1 + p * 0.7, `Génération du terrain ${Math.round(p * 100)} %`));
    await this.waitVegetation(pos, 4000);
    this.sm.go('playing');
  }

  private despawn(): void {
    if (this.riding) this.leaveRide(false);
    this.creatures?.dispose();
    this.creatures = null;
    if (this.fleet) {
      for (const v of this.fleet.list) this.scene.remove(v.model.root);
      this.fleet.dispose();
      clearVehicleSkins();
      this.fleet = null;
    }
    this.audio.stopEngines();
    this.tamingView = null;
    this.gameplay?.dispose();
    this.gameplay = null;
    if (this.model) {
      this.scene.remove(this.model.root);
      this.model.root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as Material).dispose();
        }
      });
    }
    this.model = null;
    this.player = null;
    this.faction = null;
  }

  private collectSave(): SaveData | null {
    const p = this.player;
    if (!p || !this.faction) return null;
    return {
      version: SAVE_VERSION,
      faction: this.faction,
      position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
      yaw: p.yaw,
      timeOfDay: this.env.time,
      weather: this.env.weather,
      playTime: this.playTime,
      savedAt: new Date().toISOString(),
      inventory: { ...this.inventory },
      gameplay: this.gameplay?.save(),
      tamed: this.creatures ? [...this.creatures.tamed.keys()] : [],
      vehicles: this.fleet ? [...this.fleet.vehicles.keys()] : [],
      quests: {},
      vehicleState: this.fleet?.saveState() as Record<string, { energy: number; hp: number }> | undefined,
    };
  }

  // -------------------------------------------------------------------------------------------
  private applyQuality(): void {
    const gl = this.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const rendererName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    this.qualityName = resolveQuality(this.settings.quality, {
      cores: navigator.hardwareConcurrency || 4,
      memoryGB: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
      renderer: rendererName,
    });
    this.quality = QUALITY[this.qualityName as keyof typeof QUALITY];
    this.dynScale = 1;
    this.resize();
  }

  private applyShadowSettings(): void {
    const q = this.quality;
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.env) {
      const s = this.env.sun.shadow;
      s.mapSize.set(q.shadowMap, q.shadowMap);
      s.map?.dispose();
      s.map = null;
      const cam = s.camera;
      const ext = q.shadowMap >= 2048 ? 80 : 60;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 1;
      cam.far = 800;
      cam.updateProjectionMatrix();
      this.env.sun.castShadow = q.shadows;
    }
    this.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.material) (m.material as Material).needsUpdate = true;
    });
  }

  private applySettings(s: Settings): void {
    const qualityChanged = s.quality !== this.settings.quality;
    this.settings = s;
    saveSettings(s);
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.rig.sensitivity = s.sensitivity;
    this.rig.invertY = s.invertY;
    this.audio.setVolume(s.volume);
    if (qualityChanged) {
      const prev = this.quality;
      this.applyQuality();
      const q = this.quality;
      if (this.terrain && q.terrainRange !== prev.terrainRange) this.terrain.setRangeFactor(q.terrainRange);
      if (this.veg) this.veg.configure(q.vegDensity, q.vegDistance, q.shadows);
      if (this.physics) {
        this.physics.vegDensity = q.vegDensity;
        this.physics.resetObstacles();
      }
      this.bloom.enabled = q.bloom;
      this.applyShadowSettings();
      if (q.textureSize !== prev.textureSize) this.ui.toast('La résolution des textures sera appliquée au prochain chargement.');
    }
  }

  private resize(): void {
    const w = innerWidth;
    const h = innerHeight;
    const pr = Math.min(devicePixelRatio || 1, 2) * this.quality.pixelRatio * this.dynScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.composer) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(w / 2, h / 2), 0.45, 0.5, 1.0);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.bloom.enabled = this.quality.bloom;
  }

  // -------------------------------------------------------------------------------------------
  private frame(): void {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.input.poll();
    const st = this.sm.state;
    if (st === 'playing') this.gameplay?.preInput(this.input);

    if (this.input.pressed('pause')) {
      if (st === 'playing') this.sm.go('paused');
      else if (st === 'paused') {
        if (this.ui.isOverlayOpen()) this.ui.closeTopOverlay();
        else this.resume();
      } else if (st === 'menu' || st === 'factionSelect') {
        if (this.ui.isOverlayOpen() || this.ui.current === 'credits') this.ui.closeTopOverlay();
        else if (st === 'factionSelect') this.sm.go('menu');
      }
    }

    if (st === 'playing' && this.player) this.updatePlaying(dt);
    else if (st === 'menu' || st === 'factionSelect') this.menuCamera(dt);
    else if (st === 'paused' && this.player) this.rig.update(0, this.focus, (x, z) => groundHeight(x, z));

    const camPos = this.camera.position;
    if (this.env) {
      this.env.update(st === 'paused' ? 0 : dt, camPos, this.player ? this.focus : camPos);
      this.renderer.toneMappingExposure = this.env.exposure;
      this.terrain.update(camPos);
      this.veg.update(camPos);
      this.landmarks.update(dt, this.env.nightFactor);
      this.audio.update(dt, {
        wind: this.env.windStrength,
        rain: this.env.rainAmount,
        night: this.env.nightFactor,
        altitude: this.player ? this.player.pos.y - groundHeight(this.player.pos.x, this.player.pos.z) : 30,
        jetpack: this.player?.jetpack ?? 0,
        active: st === 'playing',
      });
    }
    this.updatePulse(dt);

    this.renderer.info.reset();
    this.composer.render(dt);
    this.input.endFrame();
    this.measure(dt);
  }

  private menuCamera(dt: number): void {
    // Survol lent au-dessus de la canopée de Vehra-Tal, plateaux de Sorr à l'horizon.
    this.menuAngle += dt * 0.025;
    const lm = LANDMARKS[0];
    const r = 210;
    const a = this.menuAngle + 0.9;
    const x = lm.x + Math.cos(a) * r;
    const z = lm.z + Math.sin(a) * r;
    const y = Math.max(groundHeight(x, z), lm.padHeight) + 78;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(lm.x, lm.padHeight + 22, lm.z);
  }

  private updatePlaying(dt: number): void {
    const p = this.player!;
    const inp = this.input;
    this.playTime += dt;
    this.introTimer += dt;
    this.elapsed += dt;
    if (inp.mouseDX || inp.mouseDY || inp.lookX || inp.lookY) this.lastMouseMove = this.elapsed;
    this.rig.handleInput(inp, dt);
    const [fx, fz] = this.rig.forward();
    const [rx, rz] = this.rig.right();
    const moveX = fx * inp.moveY + rx * inp.moveX;
    const moveZ = fz * inp.moveY + rz * inp.moveX;
    const sylmar = p.f.id === 'sylmar';
    const here = this.playerPos.set(p.pos.x, p.pos.y, p.pos.z);
    const night = this.env.nightFactor;

    // Monter / descendre (E)
    const interactPressed = inp.pressed('interact');
    let interactUsed = false;
    if (interactPressed) {
      if (this.riding) interactUsed = this.tryLeaveRide();
      else {
        const v = this.fleet?.nearest(here);
        if (v) {
          this.enterVehicle(v);
          interactUsed = true;
        } else if (sylmar) {
          const c = this.creatures?.mountable(here);
          if (c) {
            this.mountCreature(c);
            interactUsed = true;
          }
        }
      }
    }
    // Appel de monture / livraison de véhicule (R)
    if (inp.pressed('call')) {
      const msg = sylmar ? this.creatures?.callNext(here, this.rig.yaw) : this.fleet?.callNext(here, this.rig.yaw);
      if (msg) this.ui.toast(msg);
      if (sylmar && this.creatures?.tamed.size) this.audio.creatureCall([...this.creatures.tamed.keys()][0], 0.8, true);
    }

    const ride = this.riding;
    if (ride?.type === 'creature') this.updateCreatureRide(dt, ride.c, moveX, moveZ);
    else if (!ride) {
      const pin: PlayerInput = {
        moveX,
        moveZ,
        fwd: inp.moveY,
        right: inp.moveX,
        sprint: inp.held('sprint'),
        crouch: inp.held('crouch'),
        crouchPressed: inp.pressed('crouch'),
        jumpPressed: inp.pressed('jump'),
        jumpHeld: inp.held('jump'),
      };
      // Sous-pas fixes pour une physique stable.
      const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
      const h = dt / steps;
      for (let i = 0; i < steps; i++) {
        p.update(h, pin);
        pin.jumpPressed = false;
        pin.crouchPressed = false;
      }
    }

    // Véhicules (physique Rapier) et faune
    if (this.fleet) {
      const drive = ride?.type === 'vehicle' ? this.driveInput() : null;
      this.fleet.update(dt, here, drive, this.elapsed, night);
      updateVehicleSkins(dt, this.fleet.list);
      for (const v of this.fleet.list) this.audio.engine(v.kind, v === this.fleet.driven ? v.anim.power : 0, v.forwardSpeed);
    }
    if (this.creatures) {
      this.creatures.update(dt, here, p.crouching, sylmar, ride?.type === 'vehicle', this.elapsed, this.elapsed, night);
    }

    // Le joueur suit sa monture ou son véhicule.
    if (this.riding) {
      const seat = this.riding.type === 'creature' ? this.riding.c.saddle : this.riding.v.seat;
      seat.getWorldPosition(this.playerPos);
      p.pos.x = this.playerPos.x;
      p.pos.y = this.playerPos.y;
      p.pos.z = this.playerPos.z;
    }
    this.model!.update(dt, p);

    // Apprivoisement (F et E), capacité de camp
    const abilityPressed = inp.pressed('ability');
    let abilityUsed = false;
    if (this.creatures && !this.riding) {
      const r = this.creatures.updateTaming(
        dt,
        this.playerPos.set(p.pos.x, p.pos.y, p.pos.z),
        p.crouching,
        sylmar,
        this.env.sunDir.y < 0.18,
        { interactPressed: interactPressed && !interactUsed, interactHeld: inp.held('interact'), abilityPressed },
        this.elapsed,
      );
      this.tamingView = r.view;
      if (r.consumedAbility) {
        abilityUsed = true;
        if (abilityPressed && this.creatures.focus) this.audio.creatureCall(this.creatures.focus.kind, 1, true);
      }
    } else this.tamingView = null;

    // Gameplay : E (fouille, récolte, dépeçage, repos), armes, faune, besoins vitaux.
    if (this.gameplay) {
      if (interactPressed && !interactUsed && !this.riding && !this.tamingView) interactUsed = this.gameplay.interact();
      const movers: { pos: Vector3; speed: number; radius: number }[] = [];
      if (this.fleet) for (const v of this.fleet.list) if (v.awake) movers.push({ pos: v.position, speed: v.velocity.length(), radius: v.model.halfExtents.z });
      if (ride?.type === 'creature' && ride.c.kind === 'tormaq') movers.push({ pos: ride.c.pos, speed: Math.abs(ride.c.speed), radius: 2 });
      this.gameplay.update({
        dt,
        time: this.elapsed,
        input: inp,
        camera: this.camera,
        camYaw: this.rig.yaw,
        baseFov: this.settings.fov,
        player: p,
        sprinting: inp.held('sprint') && (Math.abs(inp.moveX) + Math.abs(inp.moveY) > 0.1),
        inVehicle: ride?.type === 'vehicle',
        mounted: ride?.type === 'creature',
        night,
        vegDensity: this.veg.density,
        movers,
        active: this.input.pointerLocked || this.input.usingPad,
      });
    }

    this.updateRideCamera(dt);

    this.abilityTimer = Math.max(0, this.abilityTimer - dt);
    if (abilityPressed && !abilityUsed && this.abilityTimer <= 0) {
      if (ride?.type === 'vehicle' && ride.v.kind === 'chenille') {
        /* F maintenu : foreuse (géré par le véhicule) */
      } else if (ride?.type === 'creature' && ride.c.kind === 'vexil') this.rattle(ride.c);
      else this.triggerAbility();
    }
    if (inp.pressed('lamp')) {
      if (ride?.type === 'vehicle') {
        ride.v.lights = !ride.v.lights;
        this.ui.toast(ride.v.lights ? 'Phares allumés.' : 'Phares éteints.');
      } else if (this.model?.lamp) {
        this.model.lampOn = !this.model.lampOn;
        this.ui.toast(this.model.lampOn ? 'Lampe frontale allumée.' : 'Lampe frontale éteinte.');
      } else this.ui.toast('Les Sylmar voient dans la pénombre : pas besoin de lampe.');
    }
    if (inp.pressed('help')) this.ui.show(this.ui.current === 'help' ? 'hud' : 'help');

    this.saver.tick(dt);
    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.1;
      this.ui.updateHud(this.hudData());
      const region = regionName(p.pos.x, p.pos.z);
      if (region !== this.lastRegion) {
        if (this.lastRegion) this.ui.toast(region);
        this.lastRegion = region;
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Montures et véhicules

  private driveInput(): DriveInput {
    const inp = this.input;
    return {
      fwd: inp.moveY,
      right: inp.moveX,
      up: inp.held('jump'),
      upPressed: inp.pressed('jump'),
      down: inp.held('crouch'),
      boost: inp.held('sprint'),
      action: inp.held('ability'),
      engineToggle: inp.pressed('engine'),
    };
  }

  private enterVehicle(v: Vehicle): void {
    this.fleet!.enter(v);
    this.riding = { type: 'vehicle', v };
    v.seat.add(this.model!.root);
    this.model!.rideMode = 'seated';
    this.model!.lampOn = false;
    this.rig.targetDistance = v.def.cameraDistance;
    this.ui.toast(v.powerFactor > 0 ? `${v.def.name} : moteur en marche.` : `${v.def.name} : batterie vide, rechargez au dépôt.`);
  }

  private mountCreature(c: Creature): void {
    this.creatures!.mount(c);
    this.riding = { type: 'creature', c };
    c.saddle.add(this.model!.root);
    this.model!.rideMode = 'astride';
    this.rig.targetDistance = c.def.cameraDistance;
    this.audio.creatureCall(c.kind, 0.7);
  }

  /** E pendant la monte : descendre (refusé en plein vol). */
  private tryLeaveRide(): boolean {
    const r = this.riding;
    if (!r) return false;
    if (r.type === 'creature' && r.c.flying && r.c.altitude > 3) {
      this.ui.toast('Posez-vous d’abord : approchez du sol (Ctrl pour freiner).');
      return true;
    }
    this.leaveRide(false);
    return true;
  }

  private leaveRide(ejected: boolean): void {
    const r = this.riding;
    const p = this.player;
    if (!r || !p || !this.model) return;
    let x: number;
    let y: number;
    let z: number;
    if (r.type === 'vehicle') {
      const e = r.v.exitPoint();
      x = e.x;
      y = e.y;
      z = e.z;
      this.fleet?.exit();
    } else {
      const c = r.c;
      this.creatures?.dismount();
      const d = c.def.radius + 1.3;
      x = c.pos.x + Math.cos(c.yaw) * d;
      z = c.pos.z - Math.sin(c.yaw) * d;
      y = groundHeight(x, z);
    }
    this.scene.add(this.model.root);
    this.model.rideMode = 'none';
    p.teleport(x, Math.max(y, groundHeight(x, z)) + 0.1, z);
    if (ejected) p.vel.y = 5;
    this.riding = null;
    this.rig.targetDistance = p.f.cameraDistance;
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  private updateCreatureRide(dt: number, c: Creature, moveX: number, moveZ: number): void {
    const inp = this.input;
    // En vol, Q/D font aussi tourner la caméra (le Skarel suit le cap de la caméra).
    if (c.kind === 'skarel' && c.flying) this.rig.yaw -= inp.moveX * 1.1 * dt;
    const ri: RideInput = {
      moveX,
      moveZ,
      fwd: inp.moveY,
      right: inp.moveX,
      sprint: inp.held('sprint'),
      crouch: inp.held('crouch'),
      jumpPressed: inp.pressed('jump'),
      jumpHeld: inp.held('jump'),
      camYaw: this.rig.yaw,
      camPitch: this.rig.pitch,
    };
    const flaps = c.flapCharges;
    const wasFlying = c.flying;
    const steps = Math.max(1, Math.ceil(dt / (1 / 60)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      c.updateRidden(h, ri);
      ri.jumpPressed = false;
    }
    if (c.flapCharges < flaps || (!wasFlying && c.flying)) this.audio.flap();
    if (c.kind === 'vexil') c.setCrouchPose(ri.crouch);
  }

  /** Crécelle du Vexil : effraie la petite faune et les bêtes sauvages proches. */
  private rattle(c: Creature): void {
    this.abilityTimer = 4;
    this.audio.creatureCall('vexil', 1);
    this.pulseT = 0;
    G.uPulse.value.set(c.pos.x, c.pos.z, 0, 0.6);
    G.uPulseMode.value = 0;
    G.uPulseColor.value.setRGB(0.9, 0.6, 0.3);
    let n = 0;
    for (const o of this.creatures?.creatures ?? []) {
      if (!o.tamed && o.pos.distanceTo(c.pos) < 25) {
        o.startFlee();
        n++;
      }
    }
    this.ui.toast(n ? `Crécelle : ${n} bête${n > 1 ? 's' : ''} détalent.` : 'Crécelle : les lamelles cliquettent.');
  }

  /** Caméra : à pied, sur une monture ou dans un véhicule (poursuite automatique). */
  private updateRideCamera(dt: number): void {
    const p = this.player!;
    const r = this.riding;
    let fov = this.settings.fov;
    let entityYaw = p.yaw;
    let speed = 0;
    if (!r) {
      this.focus.set(p.pos.x, p.pos.y + p.f.eyeHeight * (p.crouching ? 0.7 : 1), p.pos.z);
    } else if (r.type === 'creature') {
      const c = r.c;
      this.focus.set(c.pos.x, c.pos.y + c.model.height * 0.85, c.pos.z);
      this.rig.targetDistance = c.def.cameraDistance + (c.flying ? Math.min(10, c.airSpeed * 0.18) : 0);
      if (c.flying) fov += 10 * Math.min(1, Math.max(0, (c.airSpeed - 30) / 10));
      entityYaw = c.yaw;
      speed = c.flying ? c.airSpeed : Math.abs(c.speed);
      if (speed > 12) this.prefetch(c.pos, c.vel);
    } else {
      const v = r.v;
      this.focus.set(v.position.x, v.position.y + v.def.cameraHeight, v.position.z);
      entityYaw = this.tmpEuler.setFromQuaternion(v.quaternion, 'YXZ').y;
      speed = v.velocity.length();
      if (speed > 12) this.prefetch(v.position, v.velocity);
    }
    // Poursuite : sans action sur la souris, la caméra revient derrière la monture/le véhicule.
    const skarelFlying = r?.type === 'creature' && r.c.flying;
    if (r && !skarelFlying && this.elapsed - this.lastMouseMove > 1.2 && speed > 1.5) {
      let d = entityYaw - this.rig.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.rig.yaw += d * Math.min(1, dt * 1.6);
    }
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3);
      this.camera.updateProjectionMatrix();
    }
    this.camObstacles.length = 0;
    if (!r || r.type === 'creature') this.worldQuery.colliders(this.focus.x, this.focus.z, 14, this.camObstacles);
    this.rig.update(dt, this.focus, (x, z) => groundHeight(x, z), this.camObstacles);
  }

  private prefetchFrame = 0;
  private prefetchPos = new Vector3();
  /** Précharge le terrain là où sera la caméra dans ≈ 3 s. */
  private prefetch(pos: Vector3, vel: Vector3): void {
    if (++this.prefetchFrame % 15 !== 0) return;
    this.prefetchPos.copy(pos).addScaledVector(vel, 3);
    this.prefetchPos.y = Math.max(this.prefetchPos.y, groundHeight(this.prefetchPos.x, this.prefetchPos.z) + 2);
    this.terrain.prefetch(this.prefetchPos);
  }

  private playerPos = new Vector3();
  private tmpEuler = new Euler();

  private rideHud(): RideHud | null {
    const r = this.riding;
    if (!r) return null;
    if (r.type === 'creature') {
      const c = r.c;
      const gauges = [{ label: 'Endurance', value: c.stamina / c.def.staminaMax, kind: 'stamina' as const }];
      let extra = '';
      let hint = '';
      if (c.kind === 'skarel') {
        extra = `Battements ${'●'.repeat(c.flapCharges)}${'○'.repeat(3 - c.flapCharges)}`;
        if (c.flying) {
          extra += ` · Altitude ${Math.max(0, c.altitude).toFixed(0)} m`;
          if (Creature.thermalAt(c.pos.x, c.pos.z, c.pos.y) > 0) extra += ' · Colonne thermique';
          hint = 'Souris : cap et tangage · Q/D : virer · Espace : battement · Maj : piqué · Ctrl : freiner/se poser';
        } else hint = 'Espace : décoller (ou laissez-vous tomber d’une falaise) · E : descendre';
      } else if (c.kind === 'tormaq') hint = 'Maj : charge · Ctrl : marcher · E : descendre';
      else hint = 'Maj : sprint · Espace : bond · Ctrl : se coucher · F : crécelle · E : descendre';
      return { name: c.def.name, speed: c.flying ? c.airSpeed : Math.abs(c.speed), gauges, extra, hint };
    }
    const v = r.v;
    const gauges = [
      { label: 'Énergie', value: v.energy / 100, kind: 'energy' as const },
      { label: 'Structure', value: v.hp / v.def.maxHp, kind: 'hp' as const },
    ];
    const hints: Record<VehicleKind, string> = {
      gyro: 'Espace/Ctrl : monter/descendre · Z/S : avancer/reculer · Q/D : virer · Maj : surpuissance · V : moteur · E : sortir',
      marcheur: 'Z/S : avancer/reculer · Q/D : pivoter · Espace : enjamber · Maj : allure max · E : sortir',
      chenille: 'Z/S : avancer/reculer · Q/D : chenilles · Espace : frein · F maintenu : foreuse · Maj : couple max · E : sortir',
      hydro: 'Z/S : hélice · Q/D : gouvernes · Espace : déjauger · Maj : plein gaz · E : sortir',
    };
    let extra = v.engineOn ? 'Moteur en marche' : 'Moteur coupé (V)';
    if (v.kind === 'gyro') extra += ` · Altitude ${Math.max(0, v.clearance).toFixed(0)} m`;
    if (this.fleet && v.position.distanceTo(this.fleet.depot) < 75) extra += ' · Recharge au dépôt';
    if (v.energy < 5) extra += ' · RÉSERVE';
    return { name: v.def.name, speed: Math.abs(v.forwardSpeed), gauges, extra, hint: hints[v.kind] };
  }

  private triggerAbility(): void {
    const p = this.player!;
    const def = p.f;
    this.abilityTimer = def.abilityCooldown;
    this.pulseT = 0;
    G.uPulse.value.set(p.pos.x, p.pos.z, 0, 1);
    G.uPulseMode.value = def.id === 'sylmar' ? 0 : 1;
    if (def.id === 'sylmar') G.uPulseColor.value.setRGB(0.75, 0.45, 1.0);
    else G.uPulseColor.value.setRGB(1.0, 0.62, 0.2);
    this.audio.pulse(def.id === 'sylmar');
    if (def.id === 'halden') {
      const near = this.nearestPoi();
      const alt = p.pos.y.toFixed(0);
      const east = p.pos.x > 1500 ? ' · signature d’orvène forte' : '';
      this.ui.toast(`Scan : ${near ? `${near.name} à ${formatDist(near.dist)}` : 'aucun repère'} · altitude ${alt} m${east}`);
    }
  }

  private updatePulse(dt: number): void {
    if (this.pulseT < 0) return;
    this.pulseT += dt;
    const t = this.pulseT;
    const radius = Math.min(160, t * 55);
    const intensity = t < 2.2 ? 1 : Math.max(0, 1 - (t - 2.2) / 2.5);
    G.uPulse.value.z = radius;
    G.uPulse.value.w = intensity;
    if (intensity <= 0) {
      this.pulseT = -1;
      G.uPulse.value.w = 0;
    }
  }

  private pois(): { name: string; x: number; z: number }[] {
    const p = this.player!;
    const list = LANDMARKS.filter((l) => l.id !== 'ilun').map((l) => ({ name: l.name, x: l.x, z: l.z }));
    list.push({ name: "Faille d'Ambre", x: canyonCenterX(p.pos.z), z: p.pos.z });
    return list;
  }

  private nearestPoi(): { name: string; dist: number } | null {
    const p = this.player!;
    let best: { name: string; dist: number } | null = null;
    for (const poi of this.pois()) {
      const d = Math.hypot(poi.x - p.pos.x, poi.z - p.pos.z);
      if (d > 40 && (!best || d < best.dist)) best = { name: poi.name, dist: d };
    }
    return best;
  }

  private hudData(): HudData {
    const p = this.player!;
    const g = groundHeight(p.pos.x, p.pos.z);
    const here = this.playerPos.set(p.pos.x, p.pos.y, p.pos.z);
    const extra: { name: string; x: number; z: number }[] = [];
    if (this.creatures) {
      for (const hd of this.creatures.herdsNear(here, 420)) extra.push({ name: hd.name, x: hd.x, z: hd.z });
      for (const [kind, c] of this.creatures.tamed) if (c && c !== this.creatures.ridden) extra.push({ name: `Votre ${kind === 'skarel' ? 'Skarel' : kind === 'tormaq' ? 'Tormaq' : 'Vexil'}`, x: c.pos.x, z: c.pos.z });
    }
    if (this.fleet) for (const v of this.fleet.list) if (v !== this.fleet.driven) extra.push({ name: v.def.short, x: v.position.x, z: v.position.z });
    const pois = [...this.pois(), ...extra]
      .map((poi) => ({ name: poi.name, bearing: Math.atan2(poi.x - p.pos.x, -(poi.z - p.pos.z)), dist: Math.hypot(poi.x - p.pos.x, poi.z - p.pos.z) }))
      .filter((poi) => poi.dist > 30);
    let hint = '';
    if (this.introTimer < 14) hint = 'H : commandes · F : ' + p.f.abilityName + (p.f.id === 'halden' ? ' · R : livraison de véhicule' : ' · R : appeler sa monture');
    if (p.state === 'climb' || p.state === 'trunk') hint = 'Avancer/reculer pour grimper · Espace : sauter · C : lâcher prise';
    else if (p.f.hasJetpack && p.state === 'air' && p.fuel > 5 && this.introTimer < 120) hint = 'Maintenir Espace : propulseur';
    else if (p.state === 'swim') hint = 'Vous nagez · Espace : remonter';
    if (!this.riding) {
      const v = this.fleet?.nearest(here);
      const c = p.f.id === 'sylmar' ? this.creatures?.mountable(here) : null;
      if (v) hint = v.disabledTimer > 0 ? `${v.def.short} hors service` : `E : piloter le ${v.def.short.toLowerCase()}`;
      else if (c) hint = `E : monter sur votre ${c.def.name}`;
    }
    const ride = this.rideHud();
    if (ride) hint = ride.hint;
    if (p.nearWorldEdge) hint = 'La Mer de Brume : impossible d’aller plus loin.';
    const r = this.renderer.info.render;
    const ts = this.terrain.stats;
    return {
      heading: -this.rig.yaw,
      region: regionName(p.pos.x, p.pos.z),
      clock: this.env.clockText,
      weather: this.env.weatherLabel,
      faction: p.f.id,
      stamina: p.f.staminaMax ? p.stamina / p.f.staminaMax : 0,
      fuel: p.f.fuelMax ? p.fuel / p.f.fuelMax : 0,
      abilityReady: 1 - this.abilityTimer / p.f.abilityCooldown,
      abilityName: p.f.abilityName,
      x: p.pos.x,
      y: p.pos.y,
      z: p.pos.z,
      groundClearance: p.pos.y - g,
      pois,
      hint,
      fps: `${this.fps.toFixed(0)} i/s · ${this.frameMs.toFixed(1)} ms · ${this.qualityName} ×${this.dynScale.toFixed(2)}<br>${r.calls} appels · ${(r.triangles / 1000).toFixed(0)}k tri · terrain ${ts.shown} · flore ${this.veg.stats.instances}`,
      pointerLocked: this.input.pointerLocked,
      usingPad: this.input.usingPad,
      ride,
      taming: this.tamingView,
    };
  }

  private measure(dt: number): void {
    this.frameMs = this.frameMs * 0.92 + dt * 1000 * 0.08;
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    // Résolution dynamique : vise 50+ i/s.
    if (this.settings.dynamicResolution && this.sm.state === 'playing') {
      this.dynTimer += dt;
      if (this.dynTimer > 2) {
        this.dynTimer = 0;
        const prev = this.dynScale;
        if (this.frameMs > 21) this.dynScale = Math.max(0.55, this.dynScale - 0.08);
        else if (this.frameMs < 15.5) this.dynScale = Math.min(1, this.dynScale + 0.05);
        if (prev !== this.dynScale) this.resize();
      }
    }
  }

  /** Accès de débogage (console, tests de fumée). */
  debugState(): Record<string, unknown> {
    return {
      state: this.sm.state,
      faction: this.faction,
      pos: this.player ? { ...this.player.pos } : null,
      fps: Math.round(this.fps),
      terrain: this.terrain?.stats,
      veg: this.veg?.stats,
      time: this.env?.clockText,
      riding: this.riding ? (this.riding.type === 'creature' ? this.riding.c.kind : this.riding.v.kind) : null,
      physics: this.physics?.stats ?? null,
      creatures: this.creatures?.creatures.length ?? 0,
    };
  }
}

function formatPlayTime(s: number): string {
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

function formatDist(d: number): string {
  return d >= 1000 ? `${(d / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(d)} m`;
}

