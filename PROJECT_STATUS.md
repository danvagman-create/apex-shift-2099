# APEX SHIFT 2099 — Project Status

_Last updated: 2026-11-07. This file records verified implementation state only._

**Overall:** the game is playable end to end in the browser. Title → menu → setup → race → results works for all three modes, on all three circuits, with all six cars.
All content is procedural (code-generated geometry, textures, sound and music).

## ✅ Completed (implemented and exercised)

### Engine & architecture
- Vite + TypeScript (strict) + Three.js r182 project with pinned dependencies (`npm audit`: 0 vulnerabilities).
- Modular source tree (core / graphics / vehicles / track / race / camera / audio / scenes / ui).
- Render context with four quality presets: **Low / Medium / High / Ultra**. Presets control pixel ratio, render scale, shadows and shadow resolution, bloom resolution, blur taps, AA (none / FXAA / SMAA), particle and scenery density, headlight spotlights, showroom mirror floor, and Ultra-only real-time cube reflections on the player car. Presets switch live from Settings.
- Post FX chain: UnrealBloom → custom SpeedFX shader (radial motion blur that keeps the screen center sharp, chromatic aberration, speed/nitro vignette, grain, fade/flash) → ACES output → AA.
- Fixed 120 Hz physics substeps, frame-time clamping, tab-hidden auto-pause.
- Performance overlay (F3 or Settings): FPS, frame time, draw calls, triangles, geometries, textures, JS heap.
- Persistent save with versioned migration and `localStorage` fallback to memory storage.

### Vehicles (6)
- VORTEX GT-R, SPECTRE X9, RAPTOR HX, NOVA ION, TITAN MK-IV, PHANTOM ZERO. Each has distinct physics (mass, power, grip, steering, braking, hover profile, nitro, transform time), styling and engine audio profile.
- **Procedural lofted bodies:** fender humps, hood valley, greenhouse with glass zones, carved wheel arches, carbon underbody and tail panel, LED headlight and taillight strips following the body surface (five headlight and four taillight styles), accent character lines, side intakes, mirrors, splitter, diffuser, shark fins, six wing types with active aero (airbrake), nozzles.
- Wheels: lathe tires with tread texture, five rim designs with spokes, glowing rim ring, brake discs, accent calipers. They spin, steer, and compress with body pitch and roll.
- Cockpit interior (seats, dash, screen, yoke) on the player car and the showroom car.
- PBR paint: metallic (flake normal), gloss, pearl (iridescence), matte and chrome finishes, all with clearcoat.
- LOD for opponent cars (body LOD + low-detail wheels). Static parts are merged per material, which cut draw calls by about 40% in testing.

### Road / hover transformation
- Animated transformation: suspension extends → wheels fold 90° flat → wheels tuck under → thruster glow and plume cones ignite. Side fins slide out, hover LEDs light, underglow intensifies, and the body lifts to hover height with bobbing.
- **Road mode:** strongest acceleration, grip, braking; drift (tap brake + steer) charges nitro; weight-transfer visuals.
- **Hover mode:** higher top speed, lower drag, weaker grip and braking, slower yaw response. Rides hover lanes (+speed, nitro recharge) and hover-only shortcuts.
- Thrust is reduced during transformation; a road-mode car on a hover-only path falls and respawns.

### Physics
- Track-relative vehicle model: power taper to spec top speed, braking/reverse, drag, engine braking, grip-limited yaw and lateral slip, drift state, banked frames, crest launch detection (jumps), airborne ballistic flight, landing impacts.
- Wall collisions with restitution, scraping and heading alignment; car-to-car capsule collisions with mass-weighted impulses; slipstream drafting; nitro with tank, recharge sources and speed bonus.
- Shortcut path switching through automatically opened wall gaps; respawn at the last safe point after falling.

### Tracks (3)
- **Neon Tokyo** (3.97 km): rain, wet reflective road, procedural-window city blocks, instanced neon signs, holographic billboards, street lamps with light pools, covered expressway tunnel with buildings above, elevated canal loop on pillars, hover rail across the canal, flying traffic.
- **Redline Canyon** (6.32 km, 2 laps default): heightfield canyon with strata coloring, rock tunnel, suspension bridge over the abyss, ramp jump, 900 m downhill, hairpin, hover jump across a gorge, boulders, beacon pylons, arch gates.
- **Skyline 2099** (5.61 km): floating highway 600 m up, shader cloud sea, billboard clouds, glass and white arcology towers with rings and spires, anti-grav pylons, banked climbing spiral, two hover-only void rails, distant traffic lanes, airships.
- All tracks: auto-closed layouts with no self-intersections, automatic banking, glowing edges, curbs, lane-dash geometry, themed barriers, start/finish gantry, ten checkpoints, eight-car grid, hover lanes, minimap.

### AI (up to 7 opponents)
- Multi-resolution minimum-curvature racing line with per-car road and hover speed profiles.
- Pure-pursuit steering with speed control from braking-aware profiles.
- Overtaking (side selection by available room), side-by-side avoidance, following and blocking/defending, collision recovery (reverse when stuck, respawn when facing the wrong way).
- Road/hover choice by predicted time saved versus transform cost; shortcut decisions with an abort if not in hover; hover-lane use.
- Nitro strategies per personality.
- Five personalities (Aggressive, Technical, Defensive, Speed Specialist, Adaptive) and four difficulties (Easy / Normal / Hard / Apex) with skill, mistake rate, reaction and rubber-band scaling.
- Random believable mistakes: late braking, early lift, running wide, wobble.

### Camera & speed sensation
- Chase, far chase, hood and cockpit cameras (C), plus look-back (Q).
- Lag-free follow at any speed, with yaw lag that swings the camera out in corners.
- Speed-dependent FOV (62° → ~95° with nitro), distance pull on acceleration, lateral-g roll, trauma shake (impacts, landings, nitro) and speed rumble.
- Camera-attached motion streaks, radial blur and chromatic aberration scale with speed. Wind audio rises with speed squared.
- Cinematic orbit intro during the countdown and finish orbit.

### HUD & race flow
- SVG speedometer with RPM arc, gear (H in hover), segmented nitro gauge, ROAD/HOVER/SHIFTING chip with progress bar.
- Position with gaps to the cars ahead and behind, lap counter, race/lap/best timers, standings tower, minimap with shortcut overlay, proximity arrows, 3D name tags.
- Banners: countdown, final lap, records, wrong way, slipstream, hover lane, airborne, drift score, shortcut alerts.
- Countdown with sounds; pause menu (resume / restart / settings / quit); results screen with times, best laps, credits, top speed and records.

### Menus, garage, modes & progression
- Cinematic showroom: mirror floor, turntable with hex glow, area and spot lights, light shafts, dust, multi-shot camera choreography.
- Title, main menu (PLAY / CHAMPIONSHIP / GARAGE / SETTINGS / HOW TO PLAY), animated transitions, keyboard and gamepad navigation, UI sounds.
- **Garage:** six cars, buy/unlock, active-car selection, 24 paint swatches × 5 finishes, accent/LED/rim colors, four upgrade trees × 3 levels, stat bars compared against the active car, live hover-mode preview, drag to rotate and scroll to zoom. All persisted.
- **Quick Race:** track, car, 1–7 opponents, difficulty, 1–5 laps.
- **Time Trial:** recorded holographic ghost of your best lap, live delta to the ghost, checkpoint splits, gold/silver/bronze medals.
- **Championship:** Rookie, Pro and Apex cups with fixed rival fields, 25-18-15-12-10-8-6-4 points, cup prizes, cup unlocks (top 3) and car unlocks (win).
- Credits economy, stats (races, wins, podiums, distance, top speed).
- Settings: graphics preset, motion blur, camera shake, dynamic FOV, default camera, minimap, FPS, units (km/h or mph), master/music/effects volume, progress reset.

### Audio (all synthesized with Web Audio)
- Per-car layered engine voice: three detuned oscillators through waveshaper and filter, intake noise, turbine/electric whine, virtual gearbox with shift pops. Combustion and electric profiles.
- Hover hum layer; the two nearest opponents get pooled, panned, distance-attenuated voices.
- Wind, tire scrub, drift squeal, nitro roar, rain ambience, impacts, scrapes, landings, transform servo sequence, nitro ignition, countdown, lap and record chimes, finish fanfare, respawn.
- Generated darksynth music (menu, race with final-lap intensity, results) on a lookahead step sequencer with convolution reverb.

### Tooling & delivery
- CI workflow (typecheck, tests, build) and a GitHub Pages deploy workflow.
- Playwright smoke test; dev URL shortcuts; screenshot, montage, track-report and AI-diagnostic scripts.

## 🟡 Partially implemented / limitations
- **Car models are procedural.** They are distinct and detailed for generated geometry, but they do not match hand-authored AAA assets. No licensed glTF car models are integrated, and a glTF import path is not built yet. This is the clearest place where higher-quality assets are still needed.
- **Motion blur is screen-space radial blur**, not per-object velocity blur.
- **Wet-road reflections** come from a static PMREM environment map plus glossy materials. There are no screen-space or planar reflections on track.
- **Hover-only shortcuts** are the only alternate routes; there are no road-legal alternate routes.
- **Gamepad** follows the standard mapping in code but has not been tested with a physical controller.
- **AI** does not drift. Pack racing on lap 1 produces frequent light contact.
- **Neon signs** use Japanese glyphs that rely on system CJK fonts. Windows has them; systems without CJK fonts show placeholder boxes for those signs.
- **Remaining AI** are given projected (marked `DNF*`) times 25 s after the player finishes.
- No touch controls, so phones and tablets cannot be played without a keyboard or controller.

## 🐞 Known bugs / rough edges
- Canyon "abyss" under the main bridge is partly hidden because the canyon walls sit close to the bridge.
- In Skyline the far horizon can look hazy at High/Ultra, because bloom is tuned conservatively to avoid wash-out.
- AI lap times still vary by about 10–15 s across the field on Canyon and Skyline from a standing start (first-lap traffic). The best AI on each track is competitive.
- The first visit to each track takes a few seconds to load while it is generated (tracks, racing lines, terrain and environment maps are built at load time).

## 🧪 Testing results (this environment)
- `npm run typecheck`: passes.
- `npm test`: **38/38 passing** across four suites.
  - `track.test.ts`: closure, frame orthonormality, projection round trip, branch connectivity, racing line bounds, grid slots on all three tracks.
  - `physics.test.ts`: acceleration, top speed, hover > road top speed, nitro, braking distance, walls, transform timing, car collisions, upgrades.
  - `save.test.ts`: persistence, purchases, migration, records, a full championship flow, ghost encode/replay.
  - `sim.test.ts`: headless race of seven AI on each track. Every car finishes, with **0 respawns** and shortcuts used.
- **GitHub Actions CI** (typecheck + tests + build on Ubuntu, Node 22): **green** on this branch.
- `npm run build`: passes. Output is about 1.1 MB JS (≈370 KB gzipped) plus fonts.
- **Playwright smoke test** (`npm run build && npm run smoke`, production bundle served by `vite preview`, Low preset, software WebGL): **PASSED**. Also run against the dev server: title → menu → garage → setup → race load → countdown → driving → nitro → hover transform → pause → quit all ran without console errors. Screenshots were reviewed for all menus and all three tracks, including the Tokyo tunnel, Canyon bridge and Skyline hover rail.
- **Performance:** _not measured on real GPU hardware._ Only SwiftShader software rendering was available here, at a few FPS. Renderer stats at Medium with eight cars: ~540–650 draw calls across all passes (shadow + main + post) and ~0.7–0.9 M triangles. Real-hardware FPS for each preset still needs to be measured on a Windows gaming PC.
- Audio runs without errors, but could not be listened to in this headless environment.

## ▶️ Next development priorities
1. Measure FPS per preset on Windows Chrome/Edge with a discrete GPU, then tune presets. Candidate optimizations if needed: scenery distance culling, merged instancing per chunk, shadow distance.
2. Play-test tuning on real hardware: steering feel, drift entry, hover handling, nitro balance, AI difficulty curve.
3. Add a glTF car-model pipeline so authored assets can replace the procedural bodies per car.
4. Velocity-based motion blur and screen-space reflections for the Ultra preset.
5. Touch controls and key remapping; test with a physical controller.
6. Replay / photo mode built on the ghost recorder; reverse track variants.
