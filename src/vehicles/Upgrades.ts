import type { VehiclePhysicsSpec } from './VehicleSpecs';

export type UpgradeKind = 'engine' | 'nitro' | 'handling' | 'hover';
export const UPGRADE_KINDS: UpgradeKind[] = ['engine', 'nitro', 'handling', 'hover'];
export const MAX_UPGRADE_LEVEL = 3;
export const UPGRADE_COSTS = [2000, 4500, 9000];

export interface UpgradeLevels {
  engine: number;
  nitro: number;
  handling: number;
  hover: number;
}

export const UPGRADE_INFO: Record<UpgradeKind, { label: string; desc: string }> = {
  engine: { label: 'POWERTRAIN', desc: '+2.5% top speed, +6% acceleration per level' },
  nitro: { label: 'NITRO SYSTEM', desc: '+12% capacity, +8% thrust, +15% recharge per level' },
  handling: { label: 'CHASSIS & AERO', desc: '+5% grip, +4% steering, +5% braking per level' },
  hover: { label: 'GRAV-DRIVE', desc: '+3% hover speed, +7% hover grip, -10% transform time per level' },
};

export function emptyUpgrades(): UpgradeLevels {
  return { engine: 0, nitro: 0, handling: 0, hover: 0 };
}

export function upgradeCost(currentLevel: number): number | null {
  return currentLevel >= MAX_UPGRADE_LEVEL ? null : UPGRADE_COSTS[currentLevel];
}

/** Returns a new physics spec with upgrades applied. */
export function applyUpgrades(base: VehiclePhysicsSpec, up: UpgradeLevels): VehiclePhysicsSpec {
  const e = up.engine;
  const n = up.nitro;
  const h = up.handling;
  const v = up.hover;
  return {
    ...base,
    maxSpeed: base.maxSpeed * (1 + 0.025 * e),
    accel: base.accel * (1 + 0.06 * e),
    hoverAccel: base.hoverAccel * (1 + 0.05 * e),
    nitroCapacity: base.nitroCapacity * (1 + 0.12 * n),
    nitroForce: base.nitroForce * (1 + 0.08 * n),
    nitroRecharge: base.nitroRecharge * (1 + 0.15 * n),
    grip: base.grip * (1 + 0.05 * h),
    steerRate: base.steerRate * (1 + 0.04 * h),
    brake: base.brake * (1 + 0.05 * h),
    hoverMaxSpeed: base.hoverMaxSpeed * (1 + 0.03 * v),
    hoverGrip: base.hoverGrip * (1 + 0.07 * v),
    hoverSteer: base.hoverSteer * (1 + 0.03 * v),
    transformTime: base.transformTime * (1 - 0.1 * v),
  };
}
