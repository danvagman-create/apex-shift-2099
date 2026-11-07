# APEX SHIFT 2099

A futuristic browser racing game built **without a game engine**, using Three.js, TypeScript and Vite.
Six transforming hypercars switch between **ROAD** and **HOVER** modes on three themed circuits against up to seven AI rivals.

> Everything you see and hear (cars, tracks, cities, textures, engine sounds, music) is generated procedurally at runtime from code in this repository. There are no third-party models, images or audio files, so there are no asset licensing concerns. The only bundled third-party assets are the Orbitron and Rajdhani fonts (SIL Open Font License, via `@fontsource`).

## Quick start

Requirements: **Node.js 22.12+** (or 24+) and a modern desktop browser with WebGL2. **Chrome or Edge on Windows** is the primary target.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 in Chrome or Edge, then click or press Enter on the title screen. Audio starts after that first click because browsers block autoplay.

### Production build

```bash
npm run build
```

```bash
npm run preview
```

`npm run build` type-checks and outputs a fully static site to `dist/`. `npm run preview` serves it at http://localhost:4173. The build uses relative paths (`base: './'`), so `dist/` works from any sub-folder or static host.

## Controls

| Action | Keyboard | Gamepad (standard mapping) |
| --- | --- | --- |
| Accelerate | W / ↑ | RT (or A) |
| Brake / reverse | S / ↓ | LT (or X) |
| Steer | A D / ← → | Left stick |
| Nitro | Space | B / RB |
| Transform ROAD ⇄ HOVER | Shift | LB / right-stick click |
| Change camera | C | Y |
| Look back | Q | Left-stick click |
| Restart race | R | – |
| Pause | Esc / P | Start |
| Performance overlay | F3 | – |

**Drifting:** tap brake while steering hard at speed. Drifts refill nitro.

**Hover mode:** higher top speed, rides glowing hover lanes (which also recharge nitro) and can use hover-only void shortcuts. The trade-off is weaker grip and braking. Enter a shortcut in road mode and you will fall.

## Game modes

- **Quick Race:** pick a circuit, car, 1–7 opponents, difficulty (Easy / Normal / Hard / Apex) and 1–5 laps.
- **Time Trial:** solo laps against the clock, with a holographic ghost of your best lap and live split delta. Personal records and medals are saved.
- **Championship:** three cups (Rookie → Pro → Apex Legends) of three rounds each, with F1-style points, cup prizes, and cup and car unlocks.
- **Garage:** six cars with paint (5 finishes), accent, LED and rim colors, and four upgrade trees, all saved in `localStorage`. A live 3D preview lets you rotate, zoom, and toggle hover transformation.

## Tests

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run build && npm run smoke
```

- `npm test` runs Vitest unit tests plus a full headless AI race simulation on every track.
- `npm run smoke` runs an end-to-end Playwright test of the built game: menus, garage, race start, driving, nitro, transformation, pause and quit. It needs Playwright with Chromium installed (`npx playwright install chromium`). Screenshots go to `screenshots/smoke/`.

Developer helpers:

- `npm run track-report` writes layout stats and SVG previews of each circuit to `screenshots/`.
- `?quality=low|medium|high|ultra` overrides the graphics preset for one session.
- `?race=redline-canyon&at=2000&hover=1` jumps straight into a race at a track position.
- `?photo=vortex&yaw=0.7&pitch=0.15&dist=7&hover=1` renders a single car in the showroom.

## Deploying to a public URL

GitHub does **not** serve a playable site automatically. Pick one option:

### Option A: GitHub Pages (workflow included)

1. Merge this work into `main`.
2. On GitHub go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
3. The workflow `.github/workflows/deploy-pages.yml` builds and publishes on every push to `main`. You can also run it manually from the **Actions** tab.
4. The game is then live at `https://<your-user>.github.io/<repo-name>/`.

### Option B: any static host

Run `npm run build` and upload the contents of `dist/` to Netlify (drag and drop), Vercel, Cloudflare Pages, itch.io (zip the folder and choose "HTML" project type), or any web server. No server-side code is needed.

## Project structure

```
src/
  main.ts                 entry (WebGL check, photo mode, game boot)
  core/                   Game state machine & screens, RenderContext (renderer + post FX),
                          Input (keyboard/gamepad), SaveManager, Settings presets, PerfMonitor
  graphics/               Sky shader, PMREM environments, procedural textures, particles,
                          speed lines, rain, SpeedFX shader (radial blur/CA/vignette)
  vehicles/               VehicleSpecs (6 cars), Upgrades, VehiclePhysics (road/hover/nitro/drift),
                          CarModelBuilder (lofted procedural bodies), CarModel (rig + transformation)
  track/                  TrackLayout (turtle + auto-close), Track (sampling, projection, branches),
                          RacingLine (min-curvature line + speed profiles), TrackMeshBuilder,
                          scenery/ (Neon Tokyo, Redline Canyon, Skyline 2099)
  race/                   RaceSession (laps, positions, slipstream, respawn), AIDriver (personalities),
                          Championship, Ghost, RaceConfig
  camera/CameraRig.ts     chase / far / hood / cockpit, dynamic FOV, shake, cinematic shots
  audio/                  AudioEngine (synth engine voices, SFX, loops), MusicSystem (sequencer)
  scenes/                 ShowroomScene (menu + garage), RaceScene (race orchestration)
  ui/HUD.ts               racing HUD, minimap, indicators
tests/                    Vitest suites (track math, physics, save/championship/ghost, AI simulation)
scripts/                  smoke test, screenshot and analysis tools
```

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for what is done, what is partial and known issues, and [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the roadmap.
