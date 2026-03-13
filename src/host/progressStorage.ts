import { MAX_LEVEL } from '../engine/difficulty'
import type { PlayerProgressState } from '../shared/types'

const STORAGE_KEY = 'bounced.player-progress'
const STORAGE_VERSION = 1

export class ProgressStorage {
  private lastSavedPayload = ''

  constructor(private readonly storage: Storage) {}

  load(): PlayerProgressState | null {
    try {
      const raw = this.storage.getItem(STORAGE_KEY)
      if (!raw) {
        return null
      }

      const state = normalizeProgressState(JSON.parse(raw))
      if (!state) {
        return null
      }

      this.lastSavedPayload = JSON.stringify(state)
      return state
    } catch {
      return null
    }
  }

  save(state: PlayerProgressState): void {
    const normalized = normalizeProgressState(state)
    if (!normalized) {
      return
    }

    const payload = JSON.stringify(normalized)
    if (payload === this.lastSavedPayload) {
      return
    }

    try {
      this.storage.setItem(STORAGE_KEY, payload)
      this.lastSavedPayload = payload
    } catch {
      // Ignore storage failures and keep the session running.
    }
  }
}

function normalizeProgressState(source: unknown): PlayerProgressState | null {
  if (!source || typeof source !== 'object') {
    return null
  }

  const candidate = source as Partial<PlayerProgressState> & Record<string, unknown>
  const completedLevels = Array.isArray(candidate.completedLevels)
    ? [...new Set(candidate.completedLevels
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= MAX_LEVEL))]
        .sort((left, right) => left - right)
    : []
  const highestCompletedLevel = completedLevels[completedLevels.length - 1] ?? 0
  const unlockedFromCompleted = highestCompletedLevel >= MAX_LEVEL
    ? MAX_LEVEL
    : Math.min(MAX_LEVEL, highestCompletedLevel + 1)
  const maxUnlockedLevel = clampInt(candidate.maxUnlockedLevel, Math.max(1, unlockedFromCompleted), MAX_LEVEL)
  const scoreFloor = completedLevels.length

  return {
    version: STORAGE_VERSION,
    score: Math.max(scoreFloor, clampInt(candidate.score, 0, Number.MAX_SAFE_INTEGER)),
    bestStreak: clampInt(candidate.bestStreak, 0, Number.MAX_SAFE_INTEGER),
    selectedLevel: clampInt(candidate.selectedLevel, 1, maxUnlockedLevel),
    maxUnlockedLevel,
    completedLevels,
  }
}

function clampInt(value: unknown, min: number, max: number): number {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return min
  }

  return Math.min(max, Math.max(min, Math.round(numeric)))
}
