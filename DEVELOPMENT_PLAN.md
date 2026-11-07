# APEX SHIFT 2099 — Development Plan

The roadmap is organized into integrated milestones. Each one leaves the game in a runnable, testable state.
Status markers: ✅ done · 🟡 partially done · ⬜ not started.
[PROJECT_STATUS.md](PROJECT_STATUS.md) has the detailed, verified state of each feature.

## Technical foundation (decided)

- **Rendering:** Three.js r182 (WebGL2) with a custom post-processing chain: UnrealBloom, a combined SpeedFX shader (radial blur, chromatic aberration, vignette, grain, fades), ACES tone mapping, and FXAA/SMAA.
- **Language/build:** TypeScript 5.9 (strict) and Vite 7. Tests use Vitest 5; the end-to-end smoke test uses Playwright.
- **Physics:** a custom track-relative vehicle model instead of a general rigid-body engine. Tracks are spline ribbons, so cars are simulated against analytic track frames. This makes wall collisions, lap logic, AI navigation and hover behavior exact, cheap and deterministic. Substeps run at 120 Hz.
- **Assets:** 100% procedural (geometry, textures, environment maps, audio, music). Fonts are OFL via `@fontsource`.
- **Persistence:** `localStorage` with a versioned, migrating save format.

## Milestones

### M0 — Project foundation ✅
Repository scaffold, pinned toolchain, strict TS config, folder architecture, CI workflow, Pages deploy workflow.

### M1 — Cinematic main menu ✅
Showroom scene (reflective floor, turntable, area lights, light shafts, dust), camera choreography, title/menu UI with transitions, keyboard/gamepad navigation, UI sounds.

### M2 — First car & road physics ✅
Lofted procedural body generator, PBR clearcoat paint, LED head and tail lights, wheels, wing, cockpit. Road physics: power curve, braking, grip-limited yaw, weight transfer visuals, drifting, wall and car collisions, crest jumps.

### M3 — Hover mode & transformation ✅
Animated wheel-fold transformation into hover thrusters, side fins, underglow, active aero. Hover physics with different grip, speed and braking. Hover lanes and hover-only shortcuts.

### M4 — Playable track ✅
Turtle layout language with automatic loop closing, arc-length sampling, banking, elevation, jumps, tunnels, bridges, branch paths with automatic wall openings, checkpoints, lap logic, start grid.

### M5 — Camera & speed effects ✅
Chase, far, hood and cockpit cameras; speed-dependent FOV and distance; trauma shake; motion streaks; radial blur; chromatic aberration; nitro tint; wind audio.

### M6 — AI opponents ✅ (tuning ongoing)
Minimum-curvature racing line, per-car speed profiles, pure-pursuit steering, overtaking, defending, collision avoidance, time-based road/hover choice, shortcut decisions, nitro strategies, mistakes, recovery, rubber-banding. Five personalities and four difficulties.

### M7 — HUD & race management ✅
Speedometer, nitro, mode, position, laps, timers, standings, minimap, proximity arrows, name tags, countdown, banners, pause, results.

### M8 — Garage & audio ✅
Garage UI (6 cars, paint/finish/accent/LED/rims, 4 upgrade trees, purchase/unlock, live hover preview). Synthesized engine voices per car, hover hum, tires/drift, nitro, impacts, transformation, UI sounds, generated music.

### M9 — Content expansion ✅
Six cars and three circuits with dedicated scenery (Neon Tokyo, Redline Canyon, Skyline 2099).

### M10 — Game modes ✅
Quick Race, Time Trial (ghost and medals), Championship (3 cups, points, unlocks), persistent progression.

### M11 — Optimization & QA 🟡
**Done:** quality presets, instancing, LOD for opponent cars, merged static car meshes, shadow camera following the player, resource disposal, perf overlay, unit tests, AI simulation tests, Playwright smoke test.

**Remaining:** profile on real Windows GPUs (only software rendering was available during development), GPU timing per preset, frustum/distance culling of scenery chunks, texture streaming.

### M12 — Polish & content depth ⬜ (next)
- Authored high-detail car models (glTF) to replace or augment the procedural bodies. The loader path is not yet implemented.
- Per-object velocity motion blur; screen-space reflections on wet roads (Ultra).
- Reverse and night/day track variants; weather variations (Canyon sandstorm, Skyline rain).
- Replay system and photo mode UI (the ghost recorder already captures transforms).
- AI drifting, team tactics, richer collision damage and visual damage.
- Touch controls, remappable keys, controller vibration.
- Localization, accessibility options (colorblind HUD, reduced motion preset).
- Online leaderboards for time trials (requires a backend).
