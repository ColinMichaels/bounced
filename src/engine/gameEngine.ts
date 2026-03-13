import { MAX_DELTA_MS, WINDOW_STALE_MS } from '../shared/constants'
import { clamp, findContainingWindow, getConnectedWindows, pointInCircle, rectFromWindow, sortWindowsBySlot } from '../shared/geometry'
import type { GameChannel } from '../network/channel'
import { getDifficultyForLevel, MAX_LEVEL } from './difficulty'
import { advanceBall, createBall, retuneBall, stabilizeBall } from './physics'
import type { BallState, DifficultyLevel, GamePhase, GameSnapshot, GoalState, WindowBoundsPayload, WindowState } from '../shared/types'

type SnapshotListener = (snapshot: GameSnapshot) => void

interface GoalAnchor {
  u: number
  v: number
}

export class GameEngine {
  private readonly windows = new Map<string, WindowState>()
  private readonly listeners = new Set<SnapshotListener>()
  private readonly channel: GameChannel

  private balls: BallState[] = []
  private goalAnchor: GoalAnchor | null = null
  private score = 0
  private streak = 0
  private bestStreak = 0
  private tick = 0
  private currentLevel = 1
  private maxUnlockedLevel = 1
  private readonly completedLevels = new Set<number>()
  private phase: GamePhase = 'idle'
  private note = 'Idle. Arm the field to begin at level 1.'
  private lastStepAt = 0

  constructor(channel: GameChannel) {
    this.channel = channel
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())

    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): GameSnapshot {
    const registeredWindows = this.getRegisteredWindows()
    const difficulty = getDifficultyForLevel(this.currentLevel)
    const playableWindows = this.getPlayableWindows(registeredWindows)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows, playableWindows)
    const goal = this.getGoalState(activeWindows, difficulty)

    return {
      tick: this.tick,
      phase: this.phase,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      selectedLevel: this.currentLevel,
      maxUnlockedLevel: this.maxUnlockedLevel,
      completedLevels: [...this.completedLevels].sort((left, right) => left - right),
      difficulty,
      availableWindowCount: playableWindows.length,
      requiredWindowCount: difficulty.activeWindows,
      activeWindowIds: activeWindows.map((windowState) => windowState.id),
      goalWindowId: goal?.windowId ?? activeWindows[activeWindows.length - 1]?.id ?? null,
      goal,
      windows: registeredWindows,
      balls: this.balls,
      ball: this.balls.find((ball) => ball.ownerWindowId) ?? this.balls[0] ?? null,
      transitionHint: null,
      note: this.note,
    }
  }

  start(now: number): void {
    this.score = 0
    this.streak = 0
    this.bestStreak = 0
    this.tick = 0
    this.currentLevel = 1
    this.maxUnlockedLevel = 1
    this.completedLevels.clear()
    this.balls = []
    this.goalAnchor = null
    this.phase = 'waiting'
    this.note = 'Level 1 armed. Connect the windows and route the signal into the goal target.'
    this.lastStepAt = now
    this.emitSnapshot()
  }

  endGame(): void {
    this.balls = []
    this.goalAnchor = null
    this.phase = 'idle'
    this.score = 0
    this.streak = 0
    this.tick = 0
    this.currentLevel = 1
    this.maxUnlockedLevel = 1
    this.completedLevels.clear()
    this.note = 'Field offline.'
    this.windows.clear()
    this.emitSnapshot()
  }

  selectLevel(level: number): void {
    if (level < 1 || level > this.maxUnlockedLevel || level > MAX_LEVEL || level === this.currentLevel) {
      return
    }

    this.currentLevel = level
    this.balls = []
    this.goalAnchor = null

    if (this.phase === 'idle') {
      this.note = `Level ${level} queued. Arm the field to begin.`
    } else {
      this.phase = 'waiting'
      this.note = `Level ${level} selected. Route the signal into the goal target in the last active window.`
    }

    this.emitSnapshot()
  }

  respawnBall(): void {
    if (this.phase === 'idle') {
      return
    }

    const difficulty = getDifficultyForLevel(this.currentLevel)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows)
    if (activeWindows.length < difficulty.activeWindows) {
      this.phase = 'waiting'
      this.note = `Waiting for ${difficulty.activeWindows} open windows.`
      this.emitSnapshot()
      return
    }

    this.goalAnchor = this.createGoalAnchor()
    this.balls = this.createBallSet(activeWindows, difficulty)
    this.phase = 'running'
    this.note = `Level ${this.currentLevel} reseeded. Guide the signal into ${activeWindows[activeWindows.length - 1]?.title ?? 'the goal window'}.`
    this.emitSnapshot()
  }

  upsertWindow(bounds: WindowBoundsPayload): void {
    this.windows.set(bounds.id, {
      ...bounds,
      lastSeenAt: Date.now(),
    })
  }

  unregisterWindow(id: string): void {
    this.windows.delete(id)
    this.balls = this.balls.filter((ball) => ball.ownerWindowId !== id)
    this.emitSnapshot()
  }

  handleCatchAttempt(_payload?: unknown): void {
    // Scoring now comes from routing the signal into the goal target.
  }

  step(now: number): void {
    this.pruneWindows(now)

    if (this.phase === 'idle' || this.phase === 'paused') {
      return
    }

    const difficulty = getDifficultyForLevel(this.currentLevel)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows)
    if (activeWindows.length < difficulty.activeWindows) {
      this.phase = 'waiting'
      this.note = `Waiting for ${difficulty.activeWindows} open windows.`
      this.emitSnapshot()
      return
    }

    if (!this.goalAnchor) {
      this.goalAnchor = this.createGoalAnchor()
    }

    const goal = this.getGoalState(activeWindows, difficulty)
    if (this.phase !== 'running') {
      this.phase = 'running'
      this.note = `Level ${this.currentLevel} live. Route the signal into ${activeWindows[activeWindows.length - 1]?.title ?? 'the goal window'}.`
    }

    if (this.balls.length === 0) {
      this.balls = this.createBallSet(activeWindows, difficulty)
      this.lastStepAt = now
      this.emitSnapshot()
      return
    }

    const deltaMs = Math.min(MAX_DELTA_MS, Math.max(0, now - this.lastStepAt))
    this.lastStepAt = now
    this.balls = this.balls.map((ball) => {
      const seedWindow = findContainingWindow(activeWindows, ball.x, ball.y)
        ?? activeWindows.find((windowState) => windowState.id === ball.ownerWindowId)
        ?? activeWindows[0]
      const motionWindows = getConnectedWindows(activeWindows, seedWindow.id)
      const tunedBall = retuneBall(ball, difficulty)
      const stabilizedBall = stabilizeBall({
        ...tunedBall,
        ownerWindowId: seedWindow.id,
      }, motionWindows)
      const advancedBall = advanceBall(stabilizedBall, motionWindows, deltaMs)

      return {
        ...advancedBall,
        ownerWindowId: findContainingWindow(motionWindows, advancedBall.x, advancedBall.y)?.id ?? seedWindow.id,
      }
    })
    this.tick += 1

    if (goal) {
      const scoringBall = this.balls.find((ball) =>
        pointInCircle(ball.x, ball.y, goal.x, goal.y, ball.radius + goal.radius),
      )

      if (scoringBall) {
        this.handleGoalHit(activeWindows, goal, now)
        return
      }
    }

    this.emitSnapshot()
  }

  private handleGoalHit(activeWindows: WindowState[], goal: GoalState, now: number): void {
    const clearedLevel = this.currentLevel
    const goalWindow = activeWindows.find((windowState) => windowState.id === goal.windowId)

    this.completedLevels.add(clearedLevel)
    this.score += 1
    this.streak += 1
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.balls = []
    this.goalAnchor = null
    this.lastStepAt = now

    if (clearedLevel < MAX_LEVEL) {
      this.maxUnlockedLevel = Math.max(this.maxUnlockedLevel, clearedLevel + 1)
      this.currentLevel = Math.min(MAX_LEVEL, clearedLevel + 1)
      this.phase = 'waiting'
      this.note = `Level ${clearedLevel} cleared in ${goalWindow?.title ?? 'the goal window'}. Advancing to level ${this.currentLevel}.`
      this.emitSnapshot()
      return
    }

    this.maxUnlockedLevel = MAX_LEVEL
    this.phase = 'paused'
    this.note = `Level ${clearedLevel} cleared in ${goalWindow?.title ?? 'the goal window'}. All levels unlocked. Select a level to replay.`
    this.emitSnapshot()
  }

  private pruneWindows(now: number): void {
    for (const [id, windowState] of this.windows) {
      if (now - windowState.lastSeenAt > WINDOW_STALE_MS) {
        this.windows.delete(id)
      }
    }
  }

  private getRegisteredWindows(): WindowState[] {
    return sortWindowsBySlot([...this.windows.values()])
  }

  private getPlayableWindows(source = this.getRegisteredWindows()): WindowState[] {
    return source.filter((windowState) => windowState.contentWidth > 0 && windowState.contentHeight > 0)
  }

  private getActiveWindows(requiredCount: number, source = this.getPlayableWindows()): WindowState[] {
    return source
      .filter((windowState) => windowState.slot < requiredCount)
      .sort((left, right) => left.slot - right.slot)
  }

  private createBallSet(activeWindows: WindowState[], difficulty: DifficultyLevel): BallState[] {
    return [createBall(activeWindows, difficulty)]
  }

  private createGoalAnchor(): GoalAnchor {
    return {
      u: randomBetween(0.24, 0.76),
      v: randomBetween(0.22, 0.78),
    }
  }

  private getGoalState(activeWindows: WindowState[], difficulty: DifficultyLevel): GoalState | null {
    if (!this.goalAnchor || activeWindows.length === 0) {
      return null
    }

    const goalWindow = activeWindows[activeWindows.length - 1]
    const rect = rectFromWindow(goalWindow)
    const radius = Math.max(18, difficulty.radius * 1.8)
    const margin = radius + 18

    const x = clamp(
      rect.left + (rect.width * this.goalAnchor.u),
      rect.left + margin,
      rect.right - margin,
    )
    const y = clamp(
      rect.top + (rect.height * this.goalAnchor.v),
      rect.top + margin,
      rect.bottom - margin,
    )

    return {
      windowId: goalWindow.id,
      x,
      y,
      radius,
    }
  }

  private emitSnapshot(): void {
    const snapshot = this.getSnapshot()
    this.channel.post({ type: 'snapshot', payload: snapshot })

    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }
}

function randomBetween(min: number, max: number): number {
  return min + (Math.random() * (max - min))
}
