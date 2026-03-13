import { MAX_DELTA_MS, WINDOW_STALE_MS } from '../shared/constants'
import { clamp, findContainingWindow, getConnectedWindows, pointInCircle, rectFromWindow, sortWindowsBySlot } from '../shared/geometry'
import type { GameChannel } from '../network/channel'
import { getDifficultyForLevel, MAX_LEVEL } from './difficulty'
import { advanceBall, createBall, retuneBall, stabilizeBall } from './physics'
import type {
  BallState,
  DifficultyLevel,
  GamePhase,
  GameSnapshot,
  RouteWindowState,
  TargetState,
  WindowBoundsPayload,
  WindowState,
} from '../shared/types'

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
  private targetAnchors: GoalAnchor[] = []
  private currentRouteStep = 0
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
    const routeWindowIds = activeWindows.map((windowState) => windowState.id)
    const startWindowId = routeWindowIds[0] ?? null
    const bridgeWindowIds = routeWindowIds.slice(1, -1)
    const completedBridgeWindowIds = bridgeWindowIds.slice(0, Math.min(this.currentRouteStep, bridgeWindowIds.length))
    const campaignComplete = this.phase === 'paused' && this.completedLevels.size >= MAX_LEVEL

    return {
      tick: this.tick,
      phase: this.phase,
      campaignComplete,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      selectedLevel: this.currentLevel,
      maxUnlockedLevel: this.maxUnlockedLevel,
      completedLevels: [...this.completedLevels].sort((left, right) => left - right),
      difficulty,
      availableWindowCount: playableWindows.length,
      requiredWindowCount: difficulty.activeWindows,
      activeWindowIds: routeWindowIds,
      startWindowId,
      bridgeWindowIds,
      completedBridgeWindowIds,
      goalWindowId: routeWindowIds[routeWindowIds.length - 1] ?? null,
      routeWindows: this.getRouteWindowStates(activeWindows),
      activeTarget: this.getActiveTargetState(activeWindows, difficulty),
      windows: registeredWindows,
      balls: this.balls,
      ball: this.balls.find((ball) => ball.ownerWindowId) ?? this.balls[0] ?? null,
      transitionHint: null,
      note: this.note,
    }
  }

  start(now: number): void {
    this.tick = 0
    this.balls = []
    this.resetRouteState()
    this.phase = 'waiting'
    this.note = `Level ${this.currentLevel} armed. Connect the windows and route the signal through every relay to the goal.`
    this.lastStepAt = now
    this.emitSnapshot()
  }

  endGame(): void {
    this.balls = []
    this.resetRouteState()
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
    this.resetRouteState()

    if (this.phase === 'idle') {
      this.note = `Level ${level} queued. Arm the field to begin.`
    } else {
      this.phase = 'waiting'
      this.note = `Level ${level} selected. Route the signal through each relay window in order.`
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

    this.initializeRouteTargets(activeWindows)
    this.balls = this.createBallSet(activeWindows, difficulty)
    this.phase = 'running'
    this.note = this.getRoundIntro(activeWindows)
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
    // Reserved for the upcoming firing/barrier mechanic. Routing into relays and the goal scores for now.
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

    if (this.targetAnchors.length !== Math.max(0, activeWindows.length - 1)) {
      this.initializeRouteTargets(activeWindows)
    }

    const activeTarget = this.getActiveTargetState(activeWindows, difficulty)
    if (this.phase !== 'running') {
      this.phase = 'running'
      this.note = this.getRoundIntro(activeWindows)
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

    if (activeTarget) {
      const routeBall = this.balls.find((ball) =>
        pointInCircle(ball.x, ball.y, activeTarget.x, activeTarget.y, ball.radius + activeTarget.radius),
      )

      if (routeBall) {
        this.handleRouteHit(activeWindows, activeTarget, now)
        return
      }
    }

    this.emitSnapshot()
  }

  private handleRouteHit(activeWindows: WindowState[], activeTarget: TargetState, now: number): void {
    if (activeTarget.kind === 'bridge') {
      this.currentRouteStep += 1
      this.lastStepAt = now
      this.note = this.getProgressNote(activeWindows)
      this.emitSnapshot()
      return
    }

    const clearedLevel = this.currentLevel
    const goalWindow = activeWindows.find((windowState) => windowState.id === activeTarget.windowId)
    const wasCompleted = this.completedLevels.has(clearedLevel)

    this.completedLevels.add(clearedLevel)
    if (!wasCompleted) {
      this.score = this.completedLevels.size
    }
    this.streak += 1
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.balls = []
    this.resetRouteState()
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
    const startWindow = activeWindows[0]
    return startWindow ? [createBall([startWindow], difficulty)] : []
  }

  private createGoalAnchor(): GoalAnchor {
    return {
      u: randomBetween(0.24, 0.76),
      v: randomBetween(0.22, 0.78),
    }
  }

  private getActiveTargetState(activeWindows: WindowState[], difficulty: DifficultyLevel): TargetState | null {
    if (this.targetAnchors.length === 0 || activeWindows.length < 2) {
      return null
    }

    const targetWindows = activeWindows.slice(1)
    const targetWindow = targetWindows[this.currentRouteStep]
    const anchor = this.targetAnchors[this.currentRouteStep]
    if (!targetWindow || !anchor) {
      return null
    }

    const rect = rectFromWindow(targetWindow)
    const isGoal = this.currentRouteStep >= targetWindows.length - 1
    const radius = isGoal
      ? Math.max(18, difficulty.radius * 1.8)
      : Math.max(16, difficulty.radius * 1.45)
    const margin = radius + 18

    const x = clamp(
      rect.left + (rect.width * anchor.u),
      rect.left + margin,
      rect.right - margin,
    )
    const y = clamp(
      rect.top + (rect.height * anchor.v),
      rect.top + margin,
      rect.bottom - margin,
    )

    return {
      kind: isGoal ? 'goal' : 'bridge',
      label: isGoal ? 'GOAL' : `RELAY ${this.currentRouteStep + 1}`,
      windowId: targetWindow.id,
      x,
      y,
      radius,
    }
  }

  private initializeRouteTargets(activeWindows: WindowState[]): void {
    this.currentRouteStep = 0
    this.targetAnchors = Array.from({ length: Math.max(0, activeWindows.length - 1) }, () => this.createGoalAnchor())
  }

  private resetRouteState(): void {
    this.currentRouteStep = 0
    this.targetAnchors = []
  }

  private getRouteWindowStates(activeWindows: WindowState[]): RouteWindowState[] {
    const bridgeCount = Math.max(0, activeWindows.length - 2)

    return activeWindows.map((windowState, index) => {
      if (index === 0) {
        return {
          id: windowState.id,
          role: 'start',
          order: 0,
          status: 'ready',
        }
      }

      if (index === activeWindows.length - 1) {
        return {
          id: windowState.id,
          role: 'goal',
          order: index,
          status: this.currentRouteStep >= bridgeCount ? 'active' : 'locked',
        }
      }

      const bridgeIndex = index - 1
      let status: RouteWindowState['status'] = 'locked'
      if (bridgeIndex < this.currentRouteStep) {
        status = 'cleared'
      } else if (bridgeIndex === this.currentRouteStep) {
        status = 'active'
      }

      return {
        id: windowState.id,
        role: 'bridge',
        order: bridgeIndex,
        status,
      }
    })
  }

  private getRoundIntro(activeWindows: WindowState[]): string {
    const startWindow = activeWindows[0]
    const firstBridge = activeWindows[1]
    const goalWindow = activeWindows[activeWindows.length - 1]

    return firstBridge
      ? `Level ${this.currentLevel} live. Start in ${startWindow?.title ?? 'Window 1'}, link ${firstBridge.title} first, then route to ${goalWindow?.title ?? 'the goal'}.`
      : `Level ${this.currentLevel} live. Route the signal to ${goalWindow?.title ?? 'the goal'}.`
  }

  private getProgressNote(activeWindows: WindowState[]): string {
    const bridgeCount = Math.max(0, activeWindows.length - 2)
    if (this.currentRouteStep < bridgeCount) {
      const nextBridge = activeWindows[this.currentRouteStep + 1]
      return `Relay ${this.currentRouteStep} linked. Route the signal into ${nextBridge?.title ?? 'the next relay'}.`
    }

    return `All relays linked. Goal is live in ${activeWindows[activeWindows.length - 1]?.title ?? 'the goal window'}.`
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
