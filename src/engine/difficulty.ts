import type { DifficultyLevel } from '../shared/types'

export const DIFFICULTY_LEVELS: DifficultyLevel[] = [
  { level: 1, requiredScore: 0, activeWindows: 2, speed: 230, radius: 22 },
  { level: 2, requiredScore: 1, activeWindows: 2, speed: 260, radius: 21 },
  { level: 3, requiredScore: 2, activeWindows: 3, speed: 295, radius: 19 },
  { level: 4, requiredScore: 3, activeWindows: 3, speed: 330, radius: 17 },
  { level: 5, requiredScore: 4, activeWindows: 4, speed: 365, radius: 15 },
  { level: 6, requiredScore: 5, activeWindows: 4, speed: 400, radius: 14 },
  { level: 7, requiredScore: 6, activeWindows: 5, speed: 440, radius: 13 },
  { level: 8, requiredScore: 7, activeWindows: 6, speed: 485, radius: 12 },
]

export const MAX_WINDOW_POOL = Math.max(...DIFFICULTY_LEVELS.map((level) => level.activeWindows))
export const MAX_LEVEL = Math.max(...DIFFICULTY_LEVELS.map((level) => level.level))

export function getDifficultyForLevel(level: number): DifficultyLevel {
  return DIFFICULTY_LEVELS.find((entry) => entry.level === level) ?? DIFFICULTY_LEVELS[0]
}
