import type { DifficultyLevel } from '../shared/types'

export const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  { level: 1, requiredScore: 0, activeWindows: 2, speed: 240, radius: 22 },
  { level: 2, requiredScore: 3, activeWindows: 3, speed: 310, radius: 18 },
  { level: 3, requiredScore: 7, activeWindows: 4, speed: 390, radius: 15 },
  { level: 4, requiredScore: 12, activeWindows: 5, speed: 470, radius: 12 },
]

export const MAX_WINDOW_POOL = Math.max(...DIFFICULTY_LEVELS.map((level) => level.activeWindows))
export const MAX_LEVEL = Math.max(...DIFFICULTY_LEVELS.map((level) => level.level))

export function getDifficultyForLevel(level: number): DifficultyLevel {
  return DIFFICULTY_LEVELS.find((entry) => entry.level === level) ?? DIFFICULTY_LEVELS[0]
}
