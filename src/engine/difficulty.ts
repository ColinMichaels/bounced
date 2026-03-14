import { WINDOW_POOL_GAP } from '../shared/constants'
import type { AmbientBonusKind, DifficultyLevel, MedalThresholds, MedalTier } from '../shared/types'

export interface LevelObstacleProfile {
  relayCount: number
  goalCount: number
}

export interface LevelLayoutProfile {
  gap: number
  jitter: number
  shapes: Array<{ width: number; height: number }>
}

export interface LevelSideBlockProfile {
  blockedRoomCount: number
  maxEdgesPerRoom: number
}

export interface LevelBonusProfile {
  ambientCount: number
  kinds: AmbientBonusKind[]
  scoreValue: number
  timeValueMs: number
}

const MIN_ACTIVE_WINDOWS = 3
const MAX_ACTIVE_WINDOWS = 8
const WINDOW_GROWTH_INTERVAL = 6
const MIN_RADIUS = 9
const MAX_SPEED = 820
const SHAPE_FAMILIES: Array<Array<{ width: number; height: number }>> = [
  [
    { width: 470, height: 330 },
    { width: 410, height: 380 },
    { width: 360, height: 430 },
  ],
  [
    { width: 500, height: 300 },
    { width: 420, height: 360 },
    { width: 320, height: 440 },
  ],
  [
    { width: 430, height: 320 },
    { width: 340, height: 410 },
    { width: 280, height: 470 },
  ],
  [
    { width: 520, height: 270 },
    { width: 380, height: 350 },
    { width: 310, height: 390 },
  ],
]

export const MAX_LEVEL = 100
export const DIFFICULTY_LEVELS: DifficultyLevel[] = Array.from(
  { length: MAX_LEVEL },
  (_, index) => createDifficultyLevel(index + 1),
)
export const MAX_WINDOW_POOL = MAX_ACTIVE_WINDOWS
const MEDAL_ORDER: MedalTier[] = ['none', 'bronze', 'silver', 'gold']
const MEDAL_SCORE_BONUS: Record<MedalTier, number> = {
  none: 0,
  bronze: 0,
  silver: 1,
  gold: 2,
}

export function getDifficultyForLevel(level: number): DifficultyLevel {
  const clampedLevel = clampLevel(level)
  return DIFFICULTY_LEVELS[clampedLevel - 1]
}

export function getObstacleProfileForLevel(level: number): LevelObstacleProfile {
  const difficulty = getDifficultyForLevel(level)
  return createObstacleProfile(difficulty.level, difficulty.activeWindows)
}

export function getLayoutProfileForLevel(level: number): LevelLayoutProfile {
  const difficulty = getDifficultyForLevel(level)
  const family = SHAPE_FAMILIES[getSeededIndex(difficulty.level, SHAPE_FAMILIES.length, 17)]
  const windowPressure = difficulty.activeWindows - MIN_ACTIVE_WINDOWS
  const shrink = clamp(
    1 - (windowPressure * 0.08) - Math.min(0.22, (difficulty.level - 1) / 180),
    0.5,
    1,
  )
  const widthBias = 0.94 + (seededUnit(difficulty.level, 31) * 0.16)
  const heightBias = 0.94 + (seededUnit(difficulty.level, 53) * 0.16)

  return {
    gap: Math.max(
      WINDOW_POOL_GAP + 12,
      Math.round(WINDOW_POOL_GAP + 68 - (windowPressure * 8) - Math.min(44, (difficulty.level - 1) * 0.9)),
    ),
    jitter: Math.max(14, Math.round(28 - (windowPressure * 2) - Math.min(8, (difficulty.level - 1) / 25))),
    shapes: family.map((shape, index) => {
      const variation = 0.94 + (seededUnit(difficulty.level, 71 + index) * 0.14)

      return {
        width: Math.round(shape.width * shrink * widthBias * variation),
        height: Math.round(shape.height * shrink * heightBias * (1.02 + ((variation - 1) * 0.35))),
      }
    }),
  }
}

export function getSideBlockProfileForLevel(level: number): LevelSideBlockProfile {
  const difficulty = getDifficultyForLevel(level)
  const candidateRooms = Math.max(0, difficulty.activeWindows - 1)

  if (level < 10 || candidateRooms === 0) {
    return {
      blockedRoomCount: 0,
      maxEdgesPerRoom: 0,
    }
  }

  return {
    blockedRoomCount: clampInt(
      1 + Math.floor((level - 10) / 15) + Math.floor((difficulty.activeWindows - MIN_ACTIVE_WINDOWS) / 2),
      0,
      candidateRooms,
    ),
    maxEdgesPerRoom: level >= 28 ? 2 : 1,
  }
}

export function getBonusProfileForLevel(level: number): LevelBonusProfile {
  const difficulty = getDifficultyForLevel(level)
  const candidateRooms = Math.max(0, difficulty.activeWindows - 1)
  const ambientCount = level < 4
    ? 0
    : clampInt(
      1 + Math.floor((level - 4) / 14) + Math.floor((difficulty.activeWindows - MIN_ACTIVE_WINDOWS) / 2),
      1,
      Math.max(1, Math.min(4, candidateRooms)),
    )

  const kinds: AmbientBonusKind[] = ['score']
  if (level >= 10) {
    kinds.push('charge')
  }
  if (level >= 18) {
    kinds.push('time')
  }

  return {
    ambientCount: candidateRooms === 0 ? 0 : Math.min(ambientCount, candidateRooms),
    kinds,
    scoreValue: level >= 30 ? 2 : 1,
    timeValueMs: clampInt(1_100 + ((difficulty.activeWindows - MIN_ACTIVE_WINDOWS) * 220) + ((level - 1) * 18), 1_100, 2_800),
  }
}

export function getMedalTierForTime(thresholds: MedalThresholds, timeMs: number): MedalTier {
  if (timeMs <= thresholds.goldMs) {
    return 'gold'
  }

  if (timeMs <= thresholds.silverMs) {
    return 'silver'
  }

  if (timeMs <= thresholds.bronzeMs) {
    return 'bronze'
  }

  return 'none'
}

export function compareMedalTiers(left: MedalTier, right: MedalTier): number {
  return MEDAL_ORDER.indexOf(left) - MEDAL_ORDER.indexOf(right)
}

export function getMedalScoreBonus(tier: MedalTier): number {
  return MEDAL_SCORE_BONUS[tier]
}

export function getNextMedalTier(tier: MedalTier): Exclude<MedalTier, 'none'> | null {
  switch (tier) {
    case 'none':
      return 'bronze'
    case 'bronze':
      return 'silver'
    case 'silver':
      return 'gold'
    default:
      return null
  }
}

export function getMedalThresholdMs(thresholds: MedalThresholds, tier: Exclude<MedalTier, 'none'>): number {
  switch (tier) {
    case 'bronze':
      return thresholds.bronzeMs
    case 'silver':
      return thresholds.silverMs
    case 'gold':
      return thresholds.goldMs
  }
}

function createDifficultyLevel(level: number): DifficultyLevel {
  const activeWindows = Math.min(
    MAX_ACTIVE_WINDOWS,
    MIN_ACTIVE_WINDOWS + Math.floor((level - 1) / WINDOW_GROWTH_INTERVAL),
  )
  const speed = Math.min(
    MAX_SPEED,
    Math.round(
      220
      + (Math.log2(level) * 55)
      + ((level - 1) * 2.4)
      + ((activeWindows - MIN_ACTIVE_WINDOWS) * 24),
    ),
  )
  const radius = Math.max(
    MIN_RADIUS,
    Math.round(
      22
      - (Math.log2(level) * 1.8)
      - ((activeWindows - MIN_ACTIVE_WINDOWS) * 0.85)
      - Math.min(5, (level - 1) / 18),
    ),
  )

  return {
    level,
    requiredScore: level - 1,
    activeWindows,
    speed,
    radius,
    medalThresholds: createMedalThresholds(level, activeWindows, speed, radius),
  }
}

function createObstacleProfile(level: number, activeWindows: number): LevelObstacleProfile {
  const relayCount = clampInt(
    1 + Math.floor((activeWindows - MIN_ACTIVE_WINDOWS) / 3) + Math.floor((level - 1) / 24),
    1,
    4,
  )
  const goalCount = clampInt(relayCount + (level >= 8 ? 1 : 0), 1, 5)

  return {
    relayCount,
    goalCount,
  }
}

function createMedalThresholds(
  level: number,
  activeWindows: number,
  speed: number,
  radius: number,
): MedalThresholds {
  const relayWindows = Math.max(1, activeWindows - 2)
  const obstacleProfile = createObstacleProfile(level, activeWindows)
  const totalObstacles = (relayWindows * obstacleProfile.relayCount) + obstacleProfile.goalCount
  const traversalSeconds = 6.5 + (activeWindows * 1.7) + (relayWindows * 2.3)
  const obstacleSeconds = totalObstacles * 1.55
  const controlSeconds = Math.max(0, speed - 220) / 150 + Math.max(0, 20 - radius) * 0.9
  const silverMs = Math.round((traversalSeconds + obstacleSeconds + controlSeconds) * 1000)
  const goldMs = Math.max(8_000, Math.round(silverMs * 0.82))
  const bronzeMs = Math.max(silverMs + 2_000, Math.round(silverMs * 1.22))

  return {
    bronzeMs,
    silverMs,
    goldMs,
  }
}

function clampLevel(level: number): number {
  return clampInt(level, 1, MAX_LEVEL)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.round(clamp(value, min, max))
}

function seededUnit(level: number, salt: number): number {
  const raw = Math.sin((level * 12.9898) + (salt * 78.233)) * 43758.5453123
  return raw - Math.floor(raw)
}

function getSeededIndex(level: number, length: number, salt: number): number {
  return Math.floor(seededUnit(level, salt) * length) % length
}
