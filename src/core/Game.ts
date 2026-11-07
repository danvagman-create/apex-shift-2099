import { RenderContext } from './RenderContext';
import { Input } from './Input';
import { SaveManager, type CarCustomization } from './SaveManager';
import { CAMERA_MODES, QUALITY_PRESETS, type QualityPreset } from './Settings';
import { clamp, formatTime, ordinal } from './utils';
import { AudioEngine } from '../audio/AudioEngine';
import { MusicSystem } from '../audio/MusicSystem';
import { ShowroomScene } from '../scenes/ShowroomScene';
import { RaceScene, type RaceResults } from '../scenes/RaceScene';
import { TRACKS, getTrackDef } from '../track/TrackDefinitions';
import { Track } from '../track/Track';
import { VEHICLES, getVehicle, ratePhysics, PAINT_SWATCHES, LIGHT_SWATCHES, PAINT_FINISHES, type StatRatings } from '../vehicles/VehicleSpecs';
import { applyUpgrades, UPGRADE_INFO, UPGRADE_KINDS, upgradeCost, MAX_UPGRADE_LEVEL } from '../vehicles/Upgrades';
import { DIFFICULTIES, DIFFICULTY_SETTINGS, type Difficulty } from '../race/AIDriver';
import { creditsForPosition, type RaceConfig, type RaceMode } from '../race/RaceConfig';
import { CUPS, getCup, startCup, applyRaceResult, isCupComplete, finishCup } from '../race/Championship';
import { PerfMonitor } from './PerfMonitor';

type GameState = 'title' | 'menu' | 'setup' | 'championship' | 'garage' | 'settings' | 'howto' | 'loading' | 'race' | 'paused' | 'results';

const TIPS = [
  'Tap BRAKE while steering hard at speed to initiate a drift — drifting refills NITRO.',
  'HOVER mode is faster on straights and can ride hover lanes and void shortcuts, but grips less in corners.',
  'Shift back to ROAD mode before tight corners: tires brake harder and turn sharper.',
  'Follow closely behind a rival to catch their SLIPSTREAM for extra top speed.',
  'Hover-only shortcuts have no road surface. Enter them in ROAD mode and you will fall.',
  'Glowing chevron lanes recharge NITRO and boost hover-mode cars.',
  'Press C to cycle cameras: chase, far chase, hood and cockpit.',
  'Upgrades in the GARAGE carry over to every race. Win championships to unlock new cars.',
];

const LABELS: Record<keyof StatRatings, string> = { speed: 'TOP SPEED', accel: 'ACCEL', handling: 'HANDLING', braking: 'BRAKING', hover: 'HOVER', nitro: 'NITRO' };

export class Game {
  readonly ctx: RenderContext;
  readonly input = new Input();
  readonly save = SaveManager.createBrowser();
  readonly audio = new AudioEngine();
  readonly music: MusicSystem;
  private showroom: ShowroomScene;
  private race: RaceScene | null = null;
  private ui: HTMLElement;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  state: GameState = 'title';
  private last = performance.now();
  private nav: HTMLElement[] = [];
  private navIndex = 0;
  private backAction: (() => void) | null = null;
  private setupCar: string;
  private garageCar: string;
  private garageHover = false;
  private lastConfig: RaceConfig | null = null;
  private perf: PerfMonitor;
  private thumbs = new Map<string, HTMLCanvasElement>();
  private settingsReturn: (() => void) | null = null;

  constructor(viewport: HTMLElement, ui: HTMLElement) {
    this.ui = ui;
    // ?quality=low|medium|high|ultra overrides the saved preset for this session only (testing).
    const qOverride = new URLSearchParams(location.search).get('quality') as QualityPreset | null;
    this.ctx = new RenderContext(viewport, qOverride && QUALITY_PRESETS.includes(qOverride) ? qOverride : this.save.data.settings.quality);
    this.music = new MusicSystem(this.audio);
    this.setupCar = this.save.data.selectedCar;
    this.garageCar = this.save.data.selectedCar;
    this.showroom = new ShowroomScene(this.ctx);
    this.showroom.attachControls(this.ctx.canvas);
    this.showSelectedCar();
    this.ctx.setScene(this.showroom.scene, this.showroom.camera);
    this.ctx.setBloom(0.5, 0.4, 1.0);
    this.ctx.renderer.toneMappingExposure = 0.95;
    this.perf = new PerfMonitor(ui);
    this.perf.visible = this.save.data.settings.showFps;
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') this.perf.visible = !this.perf.visible;
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'race') this.pause();
    });
    this.applyAudioSettings();
    this.showTitle();
  }

  start(): void {
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.frame(dt);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    (window as unknown as { __ready: boolean }).__ready = true;
    (window as unknown as { __game: Game }).__game = this;
  }

  private frame(dt: number): void {
    if (this.state === 'race' && this.race) {
      if (this.input.consume('pause')) this.pause();
      else if (this.input.consume('restart') && this.race.phase !== 'done') this.restartRace();
      this.race.update(dt);
    } else if (this.state === 'paused' || this.state === 'results') {
      this.input.update(dt);
      this.handleMenuNav();
      if (this.state === 'paused' && this.input.consume('pause')) this.resume();
    } else if (this.state !== 'loading') {
      this.input.update(dt);
      if (this.state === 'title') {
        if (this.input.consume('confirm') || this.input.consume('pause')) this.enterMenu();
      } else this.handleMenuNav();
      this.showroom.update(dt);
    }
    this.ctx.render(dt);
    this.perf.tick(dt, this.ctx);
  }

  // ------------------------------------------------------------------ helpers
  private sfx(kind: 'hover' | 'select' | 'back' | 'error' | 'buy' | 'trans'): void {
    if (!this.audio.ready) return;
    if (kind === 'hover') this.audio.uiHover();
    else if (kind === 'select') this.audio.uiSelect();
    else if (kind === 'back') this.audio.uiBack();
    else if (kind === 'error') this.audio.uiError();
    else if (kind === 'buy') this.audio.purchase();
    else this.audio.uiTransition();
  }

  private applyAudioSettings(): void {
    const s = this.save.data.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
  }

  private setScreen(html: string, bind: (root: HTMLElement) => void, back: (() => void) | null): HTMLElement {
    const old = this.screen;
    if (old) {
      old.classList.add('leaving');
      old.classList.remove('visible', 'interactive');
      setTimeout(() => old.remove(), 450);
    }
    const el = document.createElement('div');
    el.className = 'screen interactive';
    el.innerHTML = html;
    this.ui.appendChild(el);
    this.screen = el;
    requestAnimationFrame(() => el.classList.add('visible'));
    bind(el);
    this.backAction = back;
    this.collectNav(el);
    // generic hover / click sounds
    el.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !t.disabled) {
        this.sfx('hover');
        const i = this.nav.indexOf(t as HTMLElement);
        if (i >= 0) this.focusNav(i);
      }
    });
    return el;
  }

  private setOverlay(html: string, bind: (root: HTMLElement) => void, back: (() => void) | null): void {
    this.clearOverlay();
    const el = document.createElement('div');
    el.className = 'overlay interactive';
    el.innerHTML = html;
    this.ui.appendChild(el);
    this.overlay = el;
    bind(el);
    this.backAction = back;
    this.collectNav(el);
    el.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !t.disabled) this.sfx('hover');
    });
  }

  private clearOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private collectNav(root: HTMLElement): void {
    this.nav = Array.from(root.querySelectorAll<HTMLElement>('.nav'));
    this.navIndex = 0;
    this.nav.forEach((n) => n.classList.remove('focus'));
    if (this.nav.length && root.querySelector('.menu-item')) this.focusNav(0);
  }

  private focusNav(i: number): void {
    this.nav.forEach((n) => n.classList.remove('focus'));
    this.navIndex = clamp(i, 0, this.nav.length - 1);
    this.nav[this.navIndex]?.classList.add('focus');
  }

  private handleMenuNav(): void {
    const inp = this.input;
    if (inp.consume('up') && this.nav.length) {
      this.focusNav((this.navIndex - 1 + this.nav.length) % this.nav.length);
      this.sfx('hover');
    }
    if (inp.consume('down') && this.nav.length) {
      this.focusNav((this.navIndex + 1) % this.nav.length);
      this.sfx('hover');
    }
    if (inp.consume('confirm') && this.nav[this.navIndex]) this.nav[this.navIndex].click();
    if ((inp.consume('back') || (this.state !== 'paused' && inp.consume('pause'))) && this.backAction) {
      this.sfx('back');
      this.backAction();
    }
    inp.consume('left');
    inp.consume('right');
  }

  private onClick(root: HTMLElement, handlers: Record<string, (el: HTMLElement) => void>): void {
    root.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
      if (!t || (t as HTMLButtonElement).disabled) return;
      const h = handlers[t.dataset.action!];
      if (h) h(t);
    });
  }

  private lookFor(carId: string) {
    const c = this.save.customization(carId);
    const v = getVehicle(carId);
    return { paint: c.paint, finish: c.finish, accent: c.accent, light: c.light, rim: c.rim, hover: v.colors.hover };
  }

  private showSelectedCar(id = this.save.data.selectedCar, immediate = true): void {
    this.showroom.showCar(id, this.lookFor(id), immediate);
  }

  private creditsHtml(): string {
    return `<span class="credits" data-credits>${this.save.data.credits.toLocaleString()} CR</span>`;
  }

  // ------------------------------------------------------------------ title & main menu
  private showTitle(): void {
    this.state = 'title';
    this.showroom.setMode('menu');
    this.setScreen(
      `<div class="vignette"></div>
       <div class="menu-logo"><div class="logo-word">APEX<br/><span class="shift">SHIFT</span></div><div class="logo-year">2099</div><div class="logo-line"></div></div>
       <div class="press-start">CLICK OR PRESS ENTER</div>
       <div class="version">V${__APP_VERSION__} · PROCEDURAL BUILD</div>`,
      (root) => {
        root.addEventListener('click', () => this.enterMenu());
      },
      null,
    );
  }

  private enterMenu(): void {
    this.audio.init();
    this.applyAudioSettings();
    this.music.play('menu');
    this.sfx('trans');
    this.showMain();
  }

  showMain(): void {
    this.state = 'menu';
    this.showroom.setMode('menu');
    this.showroom.carTransformTarget = 0;
    this.showSelectedCar(this.save.data.selectedCar, false);
    const v = getVehicle(this.save.data.selectedCar);
    const active = this.save.data.activeChampionship;
    const items: [string, string, string][] = [
      ['play', 'PLAY', 'QUICK RACE · TIME TRIAL'],
      ['championship', 'CHAMPIONSHIP', active ? `CONTINUE ${getCup(active.cupId).name}` : 'WORLD TOUR CUPS'],
      ['garage', 'GARAGE', 'CARS · PAINT · UPGRADES'],
      ['settings', 'SETTINGS', 'GRAPHICS · AUDIO · CONTROLS'],
      ['howto', 'HOW TO PLAY', 'CONTROLS & RACECRAFT'],
    ];
    this.setScreen(
      `<div class="vignette"></div>
       <div class="menu-logo"><div class="logo-word">APEX<br/><span class="shift">SHIFT</span></div><div class="logo-year">2099</div><div class="logo-line"></div></div>
       <div class="menu-topbar">${this.creditsHtml()}<span class="muted">RACES ${this.save.data.stats.races} · WINS ${this.save.data.stats.wins}</span></div>
       <nav class="main-menu">${items.map(([a, l, s], i) => `<button class="menu-item nav" style="animation-delay:${0.08 * i}s" data-action="${a}">${l}<small>${s}</small></button>`).join('')}</nav>
       <div class="menu-car-info"><div class="maker">${v.maker}</div><div class="name">${v.name}</div><div class="tag">${v.tagline}</div></div>
       <div class="version">V${__APP_VERSION__} · ↑↓ NAVIGATE · ENTER SELECT</div>`,
      (root) =>
        this.onClick(root, {
          play: () => (this.sfx('select'), this.showSetup('quick')),
          championship: () => (this.sfx('select'), this.showChampionship()),
          garage: () => (this.sfx('select'), this.showGarage()),
          settings: () => (this.sfx('select'), this.showSettings(() => this.showMain())),
          howto: () => (this.sfx('select'), this.showHowTo()),
        }),
      null,
    );
  }

  // ------------------------------------------------------------------ shared widgets
  private statsHtml(carId: string, compareId?: string): string {
    const c = this.save.customization(carId);
    const r = ratePhysics(applyUpgrades(getVehicle(carId).physics, c.upgrades));
    const cmp = compareId && compareId !== carId ? ratePhysics(applyUpgrades(getVehicle(compareId).physics, this.save.customization(compareId).upgrades)) : null;
    return `<div class="stats">${(Object.keys(LABELS) as (keyof StatRatings)[])
      .map((k) => `<span>${LABELS[k]}</span><div class="stat-bar"><i style="transform:scaleX(${r[k] / 10})"></i>${cmp ? `<s style="left:${cmp[k] * 10}%"></s>` : ''}</div><em>${r[k].toFixed(1)}</em>`)
      .join('')}</div>`;
  }

  private trackThumb(trackId: string): HTMLCanvasElement {
    let c = this.thumbs.get(trackId);
    if (!c) {
      c = document.createElement('canvas');
      c.width = c.height = 148;
      const t = new Track(getTrackDef(trackId));
      const ctx = c.getContext('2d')!;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const s of t.main.samples) {
        minX = Math.min(minX, s.pos.x);
        maxX = Math.max(maxX, s.pos.x);
        minZ = Math.min(minZ, s.pos.z);
        maxZ = Math.max(maxZ, s.pos.z);
      }
      const sc = 120 / Math.max(maxX - minX, maxZ - minZ);
      const P = (x: number, z: number): [number, number] => [74 - (x - (minX + maxX) / 2) * sc, 74 - (z - (minZ + maxZ) / 2) * sc];
      const stroke = (pts: [number, number][], col: string, w: number, closed: boolean, dash: number[] = []) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (closed) ctx.closePath();
        ctx.strokeStyle = col;
        ctx.lineWidth = w;
        ctx.setLineDash(dash);
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      const pts = t.main.samples.filter((_, i) => i % 4 === 0).map((s) => P(s.pos.x, s.pos.z));
      stroke(pts, 'rgba(41,232,255,0.35)', 7, true);
      stroke(pts, '#e8f1ff', 2.2, true);
      for (const b of t.branches) stroke(b.samples.filter((_, i) => i % 4 === 0).map((s) => P(s.pos.x, s.pos.z)), '#29e8ff', 2, false, [4, 3]);
      this.thumbs.set(trackId, c);
    }
    const copy = document.createElement('canvas');
    copy.width = copy.height = 148;
    copy.getContext('2d')!.drawImage(c, 0, 0);
    return copy;
  }

  private ownedCars(): string[] {
    return VEHICLES.filter((v) => this.save.isUnlocked(v.id)).map((v) => v.id);
  }

  // ------------------------------------------------------------------ play setup
  private showSetup(mode: RaceMode): void {
    this.state = 'setup';
    this.showroom.setMode('select');
    const qr = this.save.data.quickRace;
    const owned = this.ownedCars();
    if (!owned.includes(this.setupCar)) this.setupCar = this.save.data.selectedCar;
    this.showSelectedCar(this.setupCar, false);
    const tt = mode === 'timetrial';
    const v = getVehicle(this.setupCar);
    const html = `<div class="vignette"></div>
      <div class="top-left-title"><div class="kicker">${tt ? 'BEAT THE CLOCK' : 'SINGLE EVENT'}</div><div class="h-title">${tt ? 'TIME TRIAL' : 'QUICK RACE'}</div></div>
      <div class="side-panel panel">
        <div class="seg"><button class="nav ${!tt ? 'on' : ''}" data-action="mode" data-v="quick">QUICK RACE</button><button class="nav ${tt ? 'on' : ''}" data-action="mode" data-v="timetrial">TIME TRIAL</button></div>
        <div class="field"><label>CIRCUIT</label><div class="track-cards">${TRACKS.map((t) => {
          const rec = this.save.record(t.id);
          return `<button class="track-card nav ${qr.trackId === t.id ? 'on' : ''}" data-action="track" data-v="${t.id}"><span data-thumb="${t.id}"></span><div><div class="tname">${t.name}</div><div class="tsub">${t.subtitle}</div><div class="tdesc">${t.description}</div><div class="trec">BEST LAP ${formatTime(rec.bestLap)}${tt ? ` · GOLD ${formatTime(t.timeTrialTargets[0])}` : ''}</div></div></button>`;
        }).join('')}</div></div>
        <div class="field"><label>VEHICLE</label>
          <div class="car-picker"><button class="btn arrow nav" data-action="prevCar">◀</button><div class="cname"><b data-carname>${v.name}</b><small data-carclass>${v.className}</small></div><button class="btn arrow nav" data-action="nextCar">▶</button></div>
          <div data-stats>${this.statsHtml(this.setupCar)}</div></div>
        ${tt ? '' : `<div class="field"><label>OPPONENTS</label><div class="range-row"><input type="range" min="1" max="7" value="${qr.opponents}" data-input="opp"/><b data-oppv>${qr.opponents}</b></div></div>
        <div class="field"><label>DIFFICULTY</label><div class="seg">${DIFFICULTIES.map((d) => `<button class="nav ${qr.difficulty === d ? 'on' : ''}" data-action="diff" data-v="${d}">${DIFFICULTY_SETTINGS[d].label}</button>`).join('')}</div></div>`}
        <div class="field"><label>LAPS</label><div class="seg">${[1, 2, 3, 4, 5].map((n) => `<button class="nav ${qr.laps === n ? 'on' : ''}" data-action="laps" data-v="${n}">${n}</button>`).join('')}</div></div>
        <div class="actions"><button class="btn nav" data-action="back">BACK</button><button class="btn primary nav" data-action="start">START ${tt ? 'TRIAL' : 'RACE'}</button></div>
      </div>`;
    this.setScreen(
      html,
      (root) => {
        root.querySelectorAll<HTMLElement>('[data-thumb]').forEach((e) => e.replaceWith(this.trackThumb(e.dataset.thumb!)));
        const setOn = (action: string, val: string) => root.querySelectorAll<HTMLElement>(`[data-action="${action}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === val));
        const updateCar = () => {
          const cv = getVehicle(this.setupCar);
          root.querySelector('[data-carname]')!.textContent = cv.name;
          root.querySelector('[data-carclass]')!.textContent = cv.className;
          root.querySelector('[data-stats]')!.innerHTML = this.statsHtml(this.setupCar);
          this.showSelectedCar(this.setupCar, false);
        };
        const cycle = (d: number) => {
          const list = this.ownedCars();
          const i = list.indexOf(this.setupCar);
          this.setupCar = list[(i + d + list.length) % list.length];
          this.sfx('select');
          updateCar();
        };
        root.querySelector<HTMLInputElement>('[data-input="opp"]')?.addEventListener('input', (e) => {
          const n = Number((e.target as HTMLInputElement).value);
          qr.opponents = n;
          root.querySelector('[data-oppv]')!.textContent = String(n);
        });
        this.onClick(root, {
          mode: (b) => (this.sfx('select'), this.showSetup(b.dataset.v as RaceMode)),
          track: (b) => {
            qr.trackId = b.dataset.v!;
            setOn('track', qr.trackId);
            this.sfx('select');
          },
          diff: (b) => {
            qr.difficulty = b.dataset.v!;
            setOn('diff', qr.difficulty);
            this.sfx('select');
          },
          laps: (b) => {
            qr.laps = Number(b.dataset.v);
            setOn('laps', b.dataset.v!);
            this.sfx('select');
          },
          prevCar: () => cycle(-1),
          nextCar: () => cycle(1),
          back: () => (this.sfx('back'), this.showMain()),
          start: () => {
            this.save.data.selectedCar = this.setupCar;
            this.save.save();
            const cfg: RaceConfig = {
              mode,
              trackId: qr.trackId,
              laps: qr.laps,
              opponents: tt ? 0 : qr.opponents,
              difficulty: qr.difficulty as Difficulty,
              playerCar: this.setupCar,
              playerUpgrades: { ...this.save.customization(this.setupCar).upgrades },
              seed: Math.floor(Math.random() * 1e6),
            };
            this.startRace(cfg);
          },
        });
      },
      () => this.showMain(),
    );
  }

  // ------------------------------------------------------------------ championship
  private showChampionship(selected?: string): void {
    this.state = 'championship';
    this.showroom.setMode('select');
    const active = this.save.data.activeChampionship;
    const owned = this.ownedCars();
    if (!owned.includes(this.setupCar)) this.setupCar = this.save.data.selectedCar;
    let sel = selected ?? active?.cupId ?? this.save.data.cupsUnlocked[this.save.data.cupsUnlocked.length - 1] ?? 'rookie';
    const body = () => {
      const cup = getCup(sel);
      const isActive = active && active.cupId === sel;
      let inner = '';
      if (isActive && active) {
        const next = cup.races[active.raceIndex];
        inner = `<div class="field"><label>STANDINGS · ROUND ${active.raceIndex + 1}/${cup.races.length}</label>
          <table class="results"><tr><th>POS</th><th>DRIVER</th><th>CAR</th><th>PTS</th></tr>${active.standings
            .map((s, i) => `<tr class="${s.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${s.name}</td><td class="muted">${getVehicle(s.isPlayer ? this.setupCar : s.carId).name}</td><td>${s.points}</td></tr>`)
            .join('')}</table></div>
          <div class="field"><label>NEXT ROUND</label><div class="tname h-title" style="font-size:18px">${getTrackDef(next.trackId).name} · ${next.laps} LAP${next.laps > 1 ? 'S' : ''}</div></div>`;
      } else {
        inner = `<div class="field"><label>ROUNDS</label>${cup.races.map((r, i) => `<div class="muted">${i + 1}. ${getTrackDef(r.trackId).name} — ${r.laps} LAP${r.laps > 1 ? 'S' : ''}</div>`).join('')}</div>`;
      }
      return inner;
    };
    const v = getVehicle(this.setupCar);
    const html = `<div class="vignette"></div>
      <div class="top-left-title"><div class="kicker">WORLD GRAND PRIX</div><div class="h-title">CHAMPIONSHIP</div></div>
      <div class="side-panel panel">
        <div class="cup-list">${CUPS.map((c) => {
          const unlocked = this.save.data.cupsUnlocked.includes(c.id);
          const best = this.save.data.cupResults[c.id];
          return `<button class="cup nav ${c.id === sel ? 'on' : ''}" data-action="cup" data-v="${c.id}" ${unlocked ? '' : 'disabled'}><b>${c.name}</b>${unlocked ? '' : ' <span class="lock">LOCKED · FINISH TOP 3 IN PREVIOUS CUP</span>'}<small>${c.desc}</small>
            <div class="cup-meta"><span>${DIFFICULTY_SETTINGS[c.difficulty].label}</span><span>${c.opponents + 1} CARS</span><span>◆ ${c.reward.toLocaleString()}</span>${c.unlockCar ? `<span>WIN: ${getVehicle(c.unlockCar).name}</span>` : ''}${best ? `<span>BEST: ${ordinal(best)}</span>` : ''}</div></button>`;
        }).join('')}</div>
        <div data-cupbody>${body()}</div>
        ${active && active.cupId === sel ? '' : `<div class="field"><label>VEHICLE</label><div class="car-picker"><button class="btn arrow nav" data-action="prevCar">◀</button><div class="cname"><b data-carname>${v.name}</b><small data-carclass>${v.className}</small></div><button class="btn arrow nav" data-action="nextCar">▶</button></div></div>`}
        <div class="actions">
          <button class="btn nav" data-action="back">BACK</button>
          ${active && active.cupId === sel ? `<button class="btn danger nav" data-action="abandon">ABANDON</button><button class="btn primary nav" data-action="continue">CONTINUE</button>` : `<button class="btn primary nav" data-action="begin">${active ? 'START (ABANDONS CURRENT)' : 'START CUP'}</button>`}
        </div>
      </div>`;
    this.setScreen(
      html,
      (root) => {
        const cycle = (d: number) => {
          const list = this.ownedCars();
          const i = list.indexOf(this.setupCar);
          this.setupCar = list[(i + d + list.length) % list.length];
          this.sfx('select');
          const cv = getVehicle(this.setupCar);
          root.querySelector('[data-carname]')!.textContent = cv.name;
          root.querySelector('[data-carclass]')!.textContent = cv.className;
          this.showSelectedCar(this.setupCar, false);
        };
        this.onClick(root, {
          cup: (b) => {
            sel = b.dataset.v!;
            this.sfx('select');
            this.showChampionship(sel);
          },
          prevCar: () => cycle(-1),
          nextCar: () => cycle(1),
          back: () => (this.sfx('back'), this.showMain()),
          abandon: () => {
            this.save.data.activeChampionship = null;
            this.save.save();
            this.sfx('back');
            this.showChampionship(sel);
          },
          begin: () => {
            this.save.data.selectedCar = this.setupCar;
            startCup(this.save.data, sel, this.setupCar);
            this.save.save();
            this.startChampionshipRace();
          },
          continue: () => this.startChampionshipRace(),
        });
      },
      () => this.showMain(),
    );
    this.showSelectedCar(this.setupCar, false);
  }

  private startChampionshipRace(): void {
    const prog = this.save.data.activeChampionship;
    if (!prog) return;
    const cup = getCup(prog.cupId);
    const race = cup.races[prog.raceIndex];
    const player = prog.standings.find((s) => s.isPlayer)!;
    const carId = this.save.isUnlocked(player.carId) ? player.carId : this.save.data.selectedCar;
    this.startRace({
      mode: 'championship',
      trackId: race.trackId,
      laps: race.laps,
      opponents: cup.opponents,
      difficulty: cup.difficulty,
      playerCar: carId,
      playerUpgrades: { ...this.save.customization(carId).upgrades },
      cupId: cup.id,
      seed: prog.raceIndex * 101 + 7,
      rivalIds: prog.standings.filter((s) => !s.isPlayer).map((s) => s.id),
    });
  }

  // ------------------------------------------------------------------ garage
  private showGarage(): void {
    this.state = 'garage';
    this.showroom.setMode('garage');
    this.showroom.carTransformTarget = this.garageHover ? 1 : 0;
    this.showSelectedCar(this.garageCar, false);
    const render = () => {
      const id = this.garageCar;
      const v = getVehicle(id);
      const owned = this.save.isUnlocked(id);
      const c = this.save.customization(id);
      const lockedByCup = CUPS.find((cup) => cup.unlockCar === id);
      const list = VEHICLES.map(
        (x) =>
          `<button class="garage-car nav ${x.id === id ? 'on' : ''} ${x.id === this.save.data.selectedCar ? 'active-car' : ''}" data-action="car" data-v="${x.id}"><span>${x.name}</span>${
            this.save.isUnlocked(x.id) ? `<i class="dot" style="color:${this.save.customization(x.id).paint};background:${this.save.customization(x.id).paint}"></i>` : `<em>${x.price.toLocaleString()} CR</em>`
          }</button>`,
      ).join('');
      const ups = UPGRADE_KINDS.map((k) => {
        const lvl = c.upgrades[k];
        const cost = upgradeCost(lvl);
        return `<div class="upgrade"><b>${UPGRADE_INFO[k].label}</b><small>${UPGRADE_INFO[k].desc}</small><div class="pips">${Array.from({ length: MAX_UPGRADE_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
          <button class="btn small nav" data-action="upgrade" data-v="${k}" ${!owned || cost === null || cost > this.save.data.credits ? 'disabled' : ''}>${cost === null ? 'MAXED' : `◆ ${cost.toLocaleString()}`}</button></div>`;
      }).join('');
      return `<div class="vignette"></div>
        <div class="top-left-title"><div class="kicker">${v.maker}</div><div class="h-title">GARAGE</div></div>
        <div class="garage-list">${list}</div>
        <div class="side-panel panel">
          <div style="display:flex;justify-content:space-between;align-items:baseline"><h2>${v.name}</h2>${this.creditsHtml()}</div>
          <div class="kicker">${v.className} · ${v.tagline}</div>
          <div class="muted" style="font-size:15px;line-height:1.35">${v.description}</div>
          ${this.statsHtml(id, this.save.data.selectedCar)}
          ${owned ? `<div class="field"><label>PAINT</label><div class="swatches">${PAINT_SWATCHES.map((s) => `<button class="${c.paint === s ? 'on' : ''}" style="background:${s}" data-action="paint" data-v="${s}" title="${s}"></button>`).join('')}</div>
          <div class="seg">${PAINT_FINISHES.map((f) => `<button class="${c.finish === f ? 'on' : ''}" data-action="finish" data-v="${f}">${f.toUpperCase()}</button>`).join('')}</div></div>
          <div class="field"><label>ACCENT</label><div class="swatches small">${['#111317', '#e8e8ec', '#c9a227', '#ff2d95', '#29e8ff', '#ff6a10', '#a6ff00', '#2f6dff'].map((s) => `<button class="${c.accent === s ? 'on' : ''}" style="background:${s}" data-action="accent" data-v="${s}"></button>`).join('')}</div></div>
          <div class="field"><label>LED LIGHTS</label><div class="swatches small">${LIGHT_SWATCHES.map((s) => `<button class="${c.light === s ? 'on' : ''}" style="background:${s}" data-action="light" data-v="${s}"></button>`).join('')}</div></div>
          <div class="field"><label>RIMS</label><div class="swatches small">${['#2a2d33', '#c9ced6', '#121212', '#c9a227', '#7a1020', '#1a3a8c', '#e8e8ec', '#3c6e47'].map((s) => `<button class="${c.rim === s ? 'on' : ''}" style="background:${s}" data-action="rim" data-v="${s}"></button>`).join('')}</div></div>
          <div class="field"><label>UPGRADES</label><div class="upgrades">${ups}</div></div>`
          : `<div class="field"><label>ACQUIRE</label><div class="muted">${lockedByCup ? `Win the ${lockedByCup.name} to unlock for free — or buy it outright.` : ''}</div></div>`}
          <div class="actions">
            <button class="btn nav" data-action="back">BACK</button>
            <button class="btn nav" data-action="hover">${this.garageHover ? 'ROAD MODE' : 'HOVER MODE'}</button>
            ${owned ? `<button class="btn primary nav" data-action="select" ${this.save.data.selectedCar === id ? 'disabled' : ''}>${this.save.data.selectedCar === id ? 'ACTIVE' : 'SET ACTIVE'}</button>` : `<button class="btn primary nav" data-action="buy" ${this.save.data.credits < v.price ? 'disabled' : ''}>BUY ◆ ${v.price.toLocaleString()}</button>`}
          </div>
        </div>
        <div class="garage-hint">DRAG TO ROTATE · SCROLL TO ZOOM</div>`;
    };
    const update = (c: CarCustomization) => {
      void c;
      this.showroom.setLook(this.lookFor(this.garageCar));
      this.save.save();
    };
    const bindAll = (root: HTMLElement) =>
      this.onClick(root, {
        car: (b) => {
          this.garageCar = b.dataset.v!;
          this.sfx('select');
          this.showSelectedCar(this.garageCar, false);
          this.showGarage();
        },
        paint: (b) => {
          const c = this.save.customization(this.garageCar);
          c.paint = b.dataset.v!;
          update(c);
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        finish: (b) => {
          const c = this.save.customization(this.garageCar);
          c.finish = b.dataset.v as CarCustomization['finish'];
          update(c);
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        accent: (b) => {
          const c = this.save.customization(this.garageCar);
          c.accent = b.dataset.v!;
          update(c);
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        light: (b) => {
          const c = this.save.customization(this.garageCar);
          c.light = b.dataset.v!;
          update(c);
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        rim: (b) => {
          const c = this.save.customization(this.garageCar);
          c.rim = b.dataset.v!;
          update(c);
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        upgrade: (b) => {
          if (this.save.buyUpgrade(this.garageCar, b.dataset.v as (typeof UPGRADE_KINDS)[number])) {
            this.sfx('buy');
            this.rerenderGarage(render, bindAll);
          } else this.sfx('error');
        },
        buy: () => {
          if (this.save.buyCar(this.garageCar)) {
            this.sfx('buy');
            this.rerenderGarage(render, bindAll);
          } else this.sfx('error');
        },
        select: () => {
          this.save.data.selectedCar = this.garageCar;
          this.setupCar = this.garageCar;
          this.save.save();
          this.sfx('select');
          this.rerenderGarage(render, bindAll);
        },
        hover: () => {
          this.garageHover = !this.garageHover;
          this.showroom.carTransformTarget = this.garageHover ? 1 : 0;
          if (this.audio.ready) this.audio.transform(this.garageHover);
          this.rerenderGarage(render, bindAll);
        },
        back: () => {
          this.sfx('back');
          this.garageHover = false;
          this.showMain();
        },
      });
    this.setScreen(render(), bindAll, () => {
      this.garageHover = false;
      this.showMain();
    });
  }

  private rerenderGarage(render: () => string, bind: (root: HTMLElement) => void): void {
    if (!this.screen) return;
    const panel = this.screen.querySelector('.side-panel') as HTMLElement | null;
    const scroll = panel?.scrollTop ?? 0;
    this.screen.innerHTML = render();
    // re-bind on a fresh node to drop old listeners
    const fresh = this.screen.cloneNode(true) as HTMLElement;
    this.screen.replaceWith(fresh);
    this.screen = fresh;
    bind(fresh);
    const p2 = fresh.querySelector('.side-panel') as HTMLElement | null;
    if (p2) {
      p2.style.animation = 'none';
      p2.scrollTop = scroll;
    }
    fresh.querySelectorAll<HTMLElement>('.garage-list').forEach((e) => (e.style.animation = 'none'));
    this.collectNav(fresh);
    fresh.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('button');
      if (t && !t.disabled) this.sfx('hover');
    });
  }

  // ------------------------------------------------------------------ settings
  private showSettings(back: () => void, asOverlay = false): void {
    if (!asOverlay) this.state = 'settings';
    this.settingsReturn = back;
    const s = this.save.data.settings;
    const html = `${asOverlay ? '' : '<div class="vignette"></div><div class="top-left-title"><div class="kicker">SYSTEM</div><div class="h-title">SETTINGS</div></div>'}
      <div class="${asOverlay ? 'modal' : 'side-panel'} panel">
        ${asOverlay ? '<h2>SETTINGS</h2>' : ''}
        <div class="settings-grid">
          <label>GRAPHICS</label><div class="seg">${QUALITY_PRESETS.map((q) => `<button class="nav ${s.quality === q ? 'on' : ''}" data-action="quality" data-v="${q}">${q.toUpperCase()}</button>`).join('')}</div>
          <label>MOTION BLUR</label><div class="range-row"><input type="range" min="0" max="100" value="${Math.round(s.motionBlur * 100)}" data-input="motionBlur"/><b>${Math.round(s.motionBlur * 100)}</b></div>
          <label>CAMERA SHAKE</label><div class="range-row"><input type="range" min="0" max="100" value="${Math.round(s.cameraShake * 100)}" data-input="cameraShake"/><b>${Math.round(s.cameraShake * 100)}</b></div>
          <label>DYNAMIC FOV</label><div class="toggle ${s.dynamicFov ? 'on' : ''}" data-action="toggle" data-v="dynamicFov"></div>
          <label>DEFAULT CAMERA</label><div class="seg">${CAMERA_MODES.map((c) => `<button class="${s.camera === c ? 'on' : ''}" data-action="camera" data-v="${c}">${c.toUpperCase()}</button>`).join('')}</div>
          <label>MINIMAP</label><div class="toggle ${s.minimap ? 'on' : ''}" data-action="toggle" data-v="minimap"></div>
          <label>SHOW FPS (F3)</label><div class="toggle ${s.showFps ? 'on' : ''}" data-action="toggle" data-v="showFps"></div>
          <label>UNITS</label><div class="seg"><button class="${s.units === 'kmh' ? 'on' : ''}" data-action="units" data-v="kmh">KM/H</button><button class="${s.units === 'mph' ? 'on' : ''}" data-action="units" data-v="mph">MPH</button></div>
          <label>MASTER VOLUME</label><div class="range-row"><input type="range" min="0" max="100" value="${Math.round(s.masterVolume * 100)}" data-input="masterVolume"/><b>${Math.round(s.masterVolume * 100)}</b></div>
          <label>MUSIC</label><div class="range-row"><input type="range" min="0" max="100" value="${Math.round(s.musicVolume * 100)}" data-input="musicVolume"/><b>${Math.round(s.musicVolume * 100)}</b></div>
          <label>EFFECTS</label><div class="range-row"><input type="range" min="0" max="100" value="${Math.round(s.sfxVolume * 100)}" data-input="sfxVolume"/><b>${Math.round(s.sfxVolume * 100)}</b></div>
        </div>
        <div class="muted" style="font-size:13px">Graphics changes apply instantly. LOW disables post-processing and shadows; ULTRA adds real-time car reflections and SMAA.</div>
        <div class="actions">${asOverlay ? '' : '<button class="btn danger nav" data-action="reset">RESET PROGRESS</button>'}<button class="btn primary nav" data-action="back">DONE</button></div>
      </div>`;
    const bind = (root: HTMLElement) => {
      root.querySelectorAll<HTMLInputElement>('[data-input]').forEach((inp) =>
        inp.addEventListener('input', () => {
          const k = inp.dataset.input as 'motionBlur' | 'cameraShake' | 'masterVolume' | 'musicVolume' | 'sfxVolume';
          s[k] = Number(inp.value) / 100;
          (inp.nextElementSibling as HTMLElement).textContent = inp.value;
          this.applyAudioSettings();
          this.save.save();
        }),
      );
      this.onClick(root, {
        quality: (b) => {
          s.quality = b.dataset.v as QualityPreset;
          this.save.save();
          this.ctx.applyQuality(s.quality);
          root.querySelectorAll<HTMLElement>('[data-action="quality"]').forEach((x) => x.classList.toggle('on', x.dataset.v === s.quality));
          this.sfx('select');
        },
        toggle: (b) => {
          const k = b.dataset.v as 'dynamicFov' | 'minimap' | 'showFps';
          s[k] = !s[k];
          b.classList.toggle('on', s[k]);
          if (k === 'showFps') this.perf.visible = s.showFps;
          this.save.save();
          this.sfx('select');
        },
        camera: (b) => {
          s.camera = b.dataset.v as typeof s.camera;
          root.querySelectorAll<HTMLElement>('[data-action="camera"]').forEach((x) => x.classList.toggle('on', x.dataset.v === s.camera));
          this.save.save();
          this.sfx('select');
        },
        units: (b) => {
          s.units = b.dataset.v as 'kmh' | 'mph';
          root.querySelectorAll<HTMLElement>('[data-action="units"]').forEach((x) => x.classList.toggle('on', x.dataset.v === s.units));
          this.save.save();
          this.sfx('select');
        },
        reset: (b) => {
          if (b.dataset.confirm !== '1') {
            b.dataset.confirm = '1';
            b.textContent = 'CLICK AGAIN TO CONFIRM';
            return;
          }
          this.save.reset();
          this.applyAudioSettings();
          this.ctx.applyQuality(this.save.data.settings.quality);
          this.setupCar = this.garageCar = this.save.data.selectedCar;
          this.sfx('back');
          this.showMain();
        },
        back: () => {
          this.sfx('back');
          this.settingsReturn?.();
        },
      });
    };
    if (asOverlay) this.setOverlay(html, bind, () => this.settingsReturn?.());
    else this.setScreen(html, bind, () => this.settingsReturn?.());
  }

  // ------------------------------------------------------------------ how to play
  private showHowTo(): void {
    this.state = 'howto';
    this.showroom.setMode('select');
    this.setScreen(
      `<div class="vignette"></div><div class="top-left-title"><div class="kicker">PILOT BRIEFING</div><div class="h-title">HOW TO PLAY</div></div>
       <div class="side-panel panel" style="width:min(760px,60vw)">
        <div class="howto-cols">
          <div><h3>CONTROLS</h3><div class="keys">
            <span><kbd>W</kbd><kbd>↑</kbd></span><span>Accelerate</span>
            <span><kbd>S</kbd><kbd>↓</kbd></span><span>Brake / reverse</span>
            <span><kbd>A</kbd><kbd>D</kbd></span><span>Steer</span>
            <span><kbd>SPACE</kbd></span><span>Nitro</span>
            <span><kbd>SHIFT</kbd></span><span>Transform ROAD ⇄ HOVER</span>
            <span><kbd>C</kbd></span><span>Change camera</span>
            <span><kbd>Q</kbd></span><span>Look back</span>
            <span><kbd>R</kbd></span><span>Restart race</span>
            <span><kbd>ESC</kbd></span><span>Pause</span>
          </div>
          <h3 style="margin-top:18px">GAMEPAD</h3><p>RT accelerate · LT brake · Left stick steer · B / RB nitro · LB transform · Y camera · Start pause</p></div>
          <div><h3>ROAD vs HOVER</h3><ul>
            <li><b>ROAD</b>: strongest acceleration, grip and braking. Drift (tap brake while steering at speed) to charge nitro.</li>
            <li><b>HOVER</b>: higher top speed and lower drag, floats over hover lanes and void shortcuts — but slides wide in corners.</li>
            <li>Transforming takes under a second and cuts thrust while it happens. Time it on straights.</li></ul>
            <h3 style="margin-top:18px">RACECRAFT</h3><ul>
            <li>Nitro refills slowly on its own — faster while drifting or riding glowing hover lanes.</li>
            <li>Stay close behind rivals to slipstream.</li>
            <li>Cyan dashed lines on the minimap are hover-only shortcuts.</li>
            <li>Fall off the circuit and you respawn — at the cost of precious seconds.</li></ul></div>
        </div>
        <div class="actions"><button class="btn primary nav" data-action="back">GOT IT</button></div>
       </div>`,
      (root) => this.onClick(root, { back: () => (this.sfx('back'), this.showMain()) }),
      () => this.showMain(),
    );
  }

  // ------------------------------------------------------------------ race lifecycle
  private async startRace(config: RaceConfig): Promise<void> {
    this.state = 'loading';
    this.lastConfig = config;
    this.sfx('trans');
    this.music.stop();
    this.clearOverlay();
    const def = getTrackDef(config.trackId);
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
    const el = this.setScreen(
      `<div class="loading"><div class="lsub">${config.mode === 'timetrial' ? 'TIME TRIAL' : config.mode === 'championship' ? `CHAMPIONSHIP · ${getCup(config.cupId!).name}` : 'QUICK RACE'}</div>
        <div class="ltrack">${def.name}</div><div class="lsub">${def.subtitle}</div>
        <div class="lbar"><i style="transform:scaleX(0)"></i></div><div class="lstep">INITIALIZING</div><div class="ltip">${tip}</div></div>`,
      () => {},
      null,
    );
    const bar = el.querySelector('.lbar i') as HTMLElement;
    const step = el.querySelector('.lstep') as HTMLElement;
    await new Promise((r) => setTimeout(r, 380));
    this.race?.dispose();
    const race = new RaceScene({ ctx: this.ctx, input: this.input, save: this.save, audio: this.audio, music: this.music, uiRoot: this.ui }, config);
    try {
      await race.build((p, label) => {
        bar.style.transform = `scaleX(${p})`;
        step.textContent = label;
      });
    } catch (e) {
      console.error(e);
      step.textContent = 'FAILED TO BUILD RACE — SEE CONSOLE';
      return;
    }
    this.race = race;
    race.onFinish = (res) => this.onRaceFinished(res);
    el.classList.remove('visible');
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 500);
    this.screen = null;
    this.backAction = null;
    this.nav = [];
    this.input.clearEdges();
    race.start();
    this.state = 'race';
  }

  private pause(): void {
    if (!this.race || this.state !== 'race') return;
    this.state = 'paused';
    this.race.setPaused(true);
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    this.setOverlay(
      `<div class="modal panel"><div class="kicker">${getTrackDef(this.race!.config.trackId).name}</div><h2>PAUSED</h2>
        <div class="btn-col"><button class="btn primary nav" data-action="resume">RESUME</button><button class="btn nav" data-action="restart">RESTART</button><button class="btn nav" data-action="settings">SETTINGS</button><button class="btn danger nav" data-action="quit">QUIT TO MENU</button></div></div>`,
      (root) =>
        this.onClick(root, {
          resume: () => this.resume(),
          restart: () => this.restartRace(),
          settings: () => this.showSettings(() => this.showPauseMenu(), true),
          quit: () => this.quitRace(),
        }),
      () => this.resume(),
    );
    this.focusNav(0);
  }

  private resume(): void {
    if (!this.race) return;
    this.clearOverlay();
    this.race.setPaused(false);
    this.input.clearEdges();
    this.state = 'race';
  }

  private restartRace(): void {
    if (!this.lastConfig) return;
    this.race?.setPaused(false);
    void this.startRace({ ...this.lastConfig, seed: Math.floor(Math.random() * 1e6) });
  }

  private quitRace(): void {
    this.clearOverlay();
    this.race?.dispose();
    this.race = null;
    this.audio.resume();
    this.ctx.setScene(this.showroom.scene, this.showroom.camera);
    this.ctx.setBloom(0.5, 0.4, 1.0);
    this.ctx.renderer.toneMappingExposure = 0.95;
    this.music.play('menu');
    this.showMain();
  }

  private onRaceFinished(res: RaceResults): void {
    const save = this.save.data;
    const cfg = res.config;
    const field = res.rows.length;
    const diffMul = DIFFICULTY_SETTINGS[cfg.difficulty].reward;
    let credits = 0;
    const rewards: string[] = [];
    save.stats.races++;
    if (cfg.mode !== 'timetrial') {
      if (res.playerPosition === 1) save.stats.wins++;
      if (res.playerPosition <= 3) save.stats.podiums++;
      credits = creditsForPosition(res.playerPosition, field, diffMul * (cfg.mode === 'championship' ? 0.6 : 1));
    } else {
      const def = getTrackDef(cfg.trackId);
      const best = res.playerBestLap;
      const [g, s, b] = def.timeTrialTargets;
      const medal = best <= g ? 'GOLD' : best <= s ? 'SILVER' : best <= b ? 'BRONZE' : null;
      credits = 600 + (medal === 'GOLD' ? 3000 : medal === 'SILVER' ? 1600 : medal === 'BRONZE' ? 800 : 0);
      if (medal) rewards.push(`${medal} MEDAL`);
    }
    save.stats.distanceKm += res.distanceKm;
    save.stats.topSpeedKmh = Math.max(save.stats.topSpeedKmh, res.topSpeedKmh);
    if (isFinite(res.playerTime) && res.rows.find((r) => r.isPlayer && !r.estimated)) {
      if (this.save.submitRace(cfg.trackId, res.playerTime, cfg.playerCar)) rewards.push('NEW BEST RACE TIME');
    }
    if (res.newBestLap) rewards.push('NEW TRACK LAP RECORD');
    save.credits += credits;
    // championship standings
    let cupHtml = '';
    let cupDone: ReturnType<typeof finishCup> | null = null;
    let points: Record<string, number> = {};
    if (cfg.mode === 'championship' && save.activeChampionship) {
      const prog = save.activeChampionship;
      points = applyRaceResult(prog, cfg.trackId, res.rows.map((r) => r.id));
      cupHtml = `<div class="field"><label>CHAMPIONSHIP STANDINGS</label><table class="results"><tr><th>POS</th><th>DRIVER</th><th>PTS</th></tr>${prog.standings
        .map((s, i) => `<tr class="${s.isPlayer ? 'me' : ''}"><td class="pos">${i + 1}</td><td>${s.name}</td><td>${s.points}${points[s.id] ? ` <span class="muted">+${points[s.id]}</span>` : ''}</td></tr>`)
        .join('')}</table></div>`;
      if (isCupComplete(prog)) cupDone = finishCup(save, prog);
    }
    this.save.save();
    this.state = 'results';
    this.music.play('results');
    const posBig = cfg.mode === 'timetrial' ? formatTime(res.playerBestLap) : ordinal(res.playerPosition);
    const rows = res.rows
      .map(
        (r) =>
          `<tr class="${r.isPlayer ? 'me' : ''}"><td class="pos">${r.position}</td><td>${r.isPlayer ? 'YOU' : r.name}</td><td class="muted">${getVehicle(r.carId).name}</td><td>${r.estimated ? '<span class="muted">DNF*</span>' : formatTime(r.time)}</td><td>${formatTime(isFinite(r.bestLap) ? r.bestLap : null)}</td>${cfg.mode === 'championship' ? `<td>+${points[r.id] ?? 0}</td>` : ''}</tr>`,
      )
      .join('');
    const cupFinal = cupDone
      ? `<div class="panel" style="padding:16px 18px"><div class="kicker">CUP COMPLETE</div><div class="h-title" style="font-size:22px">${getCup(cfg.cupId!).name}: ${ordinal(cupDone.position)} PLACE</div>
         <div class="muted">Cup prize ◆ ${cupDone.credits.toLocaleString()}${cupDone.unlockedCar ? ` · UNLOCKED ${getVehicle(cupDone.unlockedCar).name}` : ''}${cupDone.unlockedCup ? ` · UNLOCKED ${getCup(cupDone.unlockedCup).name}` : ''}</div></div>`
      : '';
    const nextLabel = cfg.mode === 'championship' && save.activeChampionship ? 'NEXT ROUND' : cfg.mode === 'championship' ? 'CHAMPIONSHIP' : 'CONTINUE';
    this.setOverlay(
      `<div class="modal panel">
        <div style="display:flex;align-items:flex-end;gap:20px"><div class="big-pos">${posBig}</div><div><div class="kicker">${getTrackDef(cfg.trackId).name} · ${cfg.mode === 'timetrial' ? 'BEST LAP' : 'FINISH'}</div><h2>${cfg.mode === 'timetrial' ? 'TIME TRIAL' : res.playerPosition === 1 ? 'VICTORY' : 'RACE COMPLETE'}</h2></div></div>
        ${rewards.length ? `<div class="kicker" style="color:var(--amber)">${rewards.join(' · ')}</div>` : ''}
        <table class="results"><tr><th>POS</th><th>DRIVER</th><th>CAR</th><th>TIME</th><th>BEST LAP</th>${cfg.mode === 'championship' ? '<th>PTS</th>' : ''}</tr>${rows}</table>
        <div class="reward-row"><div class="reward"><span>CREDITS EARNED</span><b class="gold">◆ ${credits.toLocaleString()}</b></div><div class="reward"><span>BEST LAP</span><b class="cyan">${formatTime(isFinite(res.playerBestLap) ? res.playerBestLap : null)}</b></div><div class="reward"><span>TOP SPEED</span><b>${Math.round(res.topSpeedKmh)} KM/H</b></div></div>
        ${cupHtml}${cupFinal}
        ${res.rows.some((r) => r.estimated) ? '<div class="muted" style="font-size:12px">* Projected from pace when the race ended.</div>' : ''}
        <div class="actions"><button class="btn nav" data-action="menu">MAIN MENU</button>${cfg.mode !== 'championship' ? '<button class="btn nav" data-action="restart">RACE AGAIN</button>' : ''}<button class="btn primary nav" data-action="next">${nextLabel}</button></div>
      </div>`,
      (root) =>
        this.onClick(root, {
          menu: () => (this.sfx('back'), this.quitRace()),
          restart: () => this.restartRace(),
          next: () => {
            this.sfx('select');
            if (cfg.mode === 'championship' && save.activeChampionship) {
              this.clearOverlay();
              this.startChampionshipRace();
            } else if (cfg.mode === 'championship') {
              this.quitRace();
              this.showChampionship(cfg.cupId);
            } else {
              this.quitRace();
              this.showSetup(cfg.mode);
            }
          },
        }),
      null,
    );
    this.focusNav(this.nav.length - 1);
  }
}


