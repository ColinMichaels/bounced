import type { RunUpgradeId, RunUpgradeLevels } from './types'

export interface RunUpgradeDefinition {
  id: RunUpgradeId
  label: string
  maxLevel: number
  costs: number[]
  description: string
}

export const RUN_UPGRADES: readonly RunUpgradeDefinition[] = [
  {
    id: 'reserve_cells',
    label: 'Reserve Cells',
    maxLevel: 3,
    costs: [2, 3, 4],
    description: 'Front-load utility charges at the start of every level.',
  },
  {
    id: 'signal_lens',
    label: 'Signal Lens',
    maxLevel: 2,
    costs: [3, 5],
    description: 'Widen relay and goal targets so route execution is more forgiving.',
  },
  {
    id: 'pulse_coil',
    label: 'Pulse Coil',
    maxLevel: 2,
    costs: [4, 6],
    description: 'Extend Bridge Pulse and Time Brake duration once you spend a charge.',
  },
] as const

const RUN_UPGRADE_BY_ID = new Map(RUN_UPGRADES.map((upgrade) => [upgrade.id, upgrade]))

export function createRunUpgradeLevels(): RunUpgradeLevels {
  return {
    reserve_cells: 0,
    signal_lens: 0,
    pulse_coil: 0,
  }
}

export function getRunUpgradeDefinition(id: RunUpgradeId): RunUpgradeDefinition {
  const upgrade = RUN_UPGRADE_BY_ID.get(id)
  if (!upgrade) {
    throw new Error(`Unknown run upgrade: ${id}`)
  }

  return upgrade
}

export function getRunUpgradeCost(id: RunUpgradeId, currentLevel: number): number | null {
  const upgrade = getRunUpgradeDefinition(id)
  return upgrade.costs[currentLevel] ?? null
}

export function formatRunUpgradeLevel(level: number, maxLevel: number): string {
  return `MK ${level} / ${maxLevel}`
}

export function formatRunUpgradeEffect(id: RunUpgradeId, level: number): string {
  switch (id) {
    case 'reserve_cells':
      return level <= 0
        ? 'No level-start utility charge bonus.'
        : `Start each level with +${level} utility charge${level === 1 ? '' : 's'}.`
    case 'signal_lens':
      return level <= 0
        ? 'Standard relay and goal target radius.'
        : `Relay and goal radius +${level * 4}px.`
    case 'pulse_coil':
      return level <= 0
        ? 'Standard Bridge Pulse and Time Brake duration.'
        : `Utility duration +${level * 25}%.`
  }
}

