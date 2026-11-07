import type { TrackDef } from './Track';

/**
 * Layout commands: straights (len) and arcs (turn deg, + = left, radius m).
 * `closeWith` names two straights whose lengths are solved so each loop closes exactly.
 */

export const NEON_TOKYO: TrackDef = {
  id: 'neon-tokyo',
  name: 'NEON TOKYO',
  subtitle: 'SHINJUKU MEGA-DISTRICT // NIGHT // RAIN',
  description:
    'Rain-slick boulevards under a canopy of holographic signage. Covered expressway tunnels, a raised canal loop and a hover rail across the water for the brave.',
  theme: 'tokyo',
  laps: 3,
  baseHeight: 0.4,
  defaultWidth: 22,
  wallHeight: 1.1,
  bankK: 9,
  maxBank: 0.12,
  closeWith: [1, 19],
  timeTrialTargets: [66, 70, 76],
  mapRotation: 0,
  cmds: [
    { len: 260, width: 24, tags: ['clear'] }, // 0 start straight
    { len: 300 }, // 1 (auto)
    { turn: -95, radius: 70, width: 20, tags: ['danger'] }, // 2 hard right
    { len: 170 }, // 3
    { turn: 38, radius: 115 }, // 4 esses
    { turn: -38, radius: 115 }, // 5
    { len: 200, width: 18, tags: ['tunnel'] }, // 6 covered expressway
    { turn: -80, radius: 150, tags: ['tunnel'] }, // 7
    { len: 240, tags: ['tunnel'], hoverLane: 0 }, // 8
    { turn: 60, radius: 90, width: 20 }, // 9 canal detour start (shortcut leaves right)
    { len: 130, rise: 9, tags: ['elevated'] }, // 10
    { turn: -120, radius: 100, tags: ['elevated'] }, // 11
    { len: 130, rise: -9, tags: ['elevated'] }, // 12
    { turn: 60, radius: 90 }, // 13 detour end
    { len: 160, width: 22, hoverLane: -1 }, // 14
    { turn: 22, radius: 110 }, // 15 chicane
    { turn: -22, radius: 110 }, // 16
    { len: 80 }, // 17
    { turn: -90, radius: 62, tags: ['danger'] }, // 18
    { len: 260 }, // 19 (auto)
    { turn: -50, radius: 190 }, // 20
    { len: 220, width: 24 }, // 21
    { turn: -45, radius: 140 }, // 22
    { len: 200 }, // 23 run to the line
  ],
  branches: [
    { id: 'canal-rail', fromCmd: 9, toCmd: 13, side: 1, width: 11, hoverOnly: true, rise: 7 },
  ],
};

export const REDLINE_CANYON: TrackDef = {
  id: 'redline-canyon',
  name: 'REDLINE CANYON',
  subtitle: 'MOJAVE SECTOR 7 // SUNSET // DUST',
  description:
    'Flat-out desert blasts between towering red rock walls. A carved rock tunnel, a mag-lev bridge over the abyss, a ramp jump and a brutal downhill hairpin.',
  theme: 'canyon',
  laps: 2,
  baseHeight: 30,
  defaultWidth: 21,
  wallHeight: 1.0,
  bankK: 12,
  maxBank: 0.14,
  closeWith: [20, 22],
  timeTrialTargets: [96, 102, 110],
  mapRotation: 0,
  cmds: [
    { len: 450, width: 22, tags: ['clear'] }, // 0 start straight
    { len: 350, rise: -8 }, // 1
    { turn: 60, radius: 280, rise: -6 }, // 2 fast left sweeper
    { len: 380, jump: 3.6, width: 20 }, // 3 ramp jump
    { turn: -35, radius: 240 }, // 4
    { len: 220, rise: 14, tags: ['tunnel'], width: 18 }, // 5 rock tunnel
    { turn: 95, radius: 170, rise: 6, tags: ['tunnel'] }, // 6
    { len: 260, width: 20, tags: ['bridge', 'chasm'] }, // 7 mag-lev bridge over the abyss
    { turn: 60, radius: 320, hoverLane: 1 }, // 8
    { len: 900, rise: -20, width: 22, hoverLane: 0 }, // 9 the long downhill
    { turn: -15, radius: 600 }, // 10
    { turn: 15, radius: 600 }, // 11
    { len: 400 }, // 12
    { turn: 90, radius: 60, width: 19, tags: ['danger'] }, // 13 the hairpin
    { len: 250, rise: 6 }, // 14
    { turn: -60, radius: 150 }, // 15 chasm detour start (shortcut leaves left)
    { len: 150, tags: ['chasm'] }, // 16
    { turn: 120, radius: 110, tags: ['chasm'] }, // 17
    { len: 150, tags: ['chasm'] }, // 18
    { turn: -60, radius: 150 }, // 19 detour end
    { len: 200 }, // 20 (auto)
    { turn: 90, radius: 200, rise: 8 }, // 21
    { len: 300, width: 22 }, // 22 (auto)
  ],
  branches: [
    { id: 'abyss-jump', fromCmd: 15, toCmd: 19, side: -1, width: 11, hoverOnly: true, rise: 10 },
  ],
};

export const SKYLINE_2099: TrackDef = {
  id: 'skyline-2099',
  name: 'SKYLINE 2099',
  subtitle: 'AEROPOLIS // 600M ABOVE THE CLOUDS // GOLDEN HOUR',
  description:
    'Suspended mag-highways strung between arcology towers above a sea of cloud. Steep banked spirals and two anti-grav shortcuts across the void.',
  theme: 'skyline',
  laps: 3,
  baseHeight: 600,
  defaultWidth: 22,
  wallHeight: 1.0,
  bankK: 16,
  maxBank: 0.2,
  closeWith: [22, 24],
  timeTrialTargets: [84, 90, 98],
  mapRotation: 0,
  cmds: [
    { len: 440, width: 24, tags: ['clear'] }, // 0 start straight
    { len: 150 }, // 1
    { turn: -70, radius: 200, rise: 10, bankScale: 1.3 }, // 2
    { len: 250, hoverLane: 1 }, // 3
    { turn: 45, radius: 160 }, // 4 detour A start (shortcut right)
    { len: 120 }, // 5
    { turn: -90, radius: 140 }, // 6
    { len: 120 }, // 7
    { turn: 45, radius: 160 }, // 8 detour A end
    { turn: -100, radius: 120, rise: -20, bankScale: 1.5 }, // 9 descending banked turn
    { len: 600, hoverLane: 0 }, // 10
    { turn: 12, radius: 500 }, // 11
    { turn: -12, radius: 500 }, // 12
    { len: 700 }, // 13
    { turn: -100, radius: 92, rise: 16, bankScale: 1.6, tags: ['spiral'] }, // 14 climbing banked spiral
    { len: 300 }, // 15
    { turn: 50, radius: 180 }, // 16 detour B start (shortcut right)
    { len: 160 }, // 17
    { turn: -100, radius: 140 }, // 18
    { len: 160 }, // 19
    { turn: 50, radius: 180 }, // 20 detour B end
    { turn: -60, radius: 220, rise: -6 }, // 21
    { len: 150 }, // 22 (auto)
    { turn: -30, radius: 260 }, // 23
    { len: 200, width: 24 }, // 24 (auto)
  ],
  branches: [
    { id: 'void-rail-a', fromCmd: 4, toCmd: 8, side: 1, width: 11, hoverOnly: true, rise: -4 },
    { id: 'void-rail-b', fromCmd: 16, toCmd: 20, side: 1, width: 11, hoverOnly: true, rise: 6 },
  ],
};

export const TRACKS: TrackDef[] = [NEON_TOKYO, REDLINE_CANYON, SKYLINE_2099];

export function getTrackDef(id: string): TrackDef {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}
