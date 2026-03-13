import { MAX_DELTA_MS, SHOT_COOLDOWN_MS, SHOT_HIT_PADDING_PX, WINDOW_STALE_MS } from '../shared/constants'
import { clamp, findContainingWindow, getConnectedWindows, pointInCircle, rectFromWindow, sortWindowsBySlot } from '../shared/geometry'
import type { GameChannel } from '../network/channel'
import { getDifficultyForLevel, MAX_LEVEL } from './difficulty'
import { advanceBall, createBall, retuneBall, stabilizeBall } from './physics'
import type {
  BallState,
  CatchAttemptPayload,
  DifficultyLevel,
  GamePhase,
  GameSnapshot,
  ObstacleState,
  PlayerProgressState,
  RouteWindowState,
  ScoreNodeState,
  TargetState,
  WindowBoundsPayload,
  WindowState,
} from '../shared/types'

type SnapshotListener = (snapshot: GameSnapshot) => void

interface GoalAnchor {
  u: number
  v: number
}

interface ObstacleAnchor {
  id: string
  kind: 'barrier'
  u: number
  v: number
  width: number
  height: number
  hitPoints: number
}

const OBSTACLE_TEMPLATES: ObstacleAnchor[] = [
  { id: 'gate-v-left', kind: 'barrier', u: 0.34, v: 0.5, width: 0.17, height: 0.54, hitPoints: 1 },
  { id: 'gate-v-right', kind: 'barrier', u: 0.66, v: 0.5, width: 0.17, height: 0.54, hitPoints: 1 },
  { id: 'gate-h-top', kind: 'barrier', u: 0.5, v: 0.34, width: 0.56, height: 0.17, hitPoints: 1 },
  { id: 'gate-h-bottom', kind: 'barrier', u: 0.5, v: 0.66, width: 0.56, height: 0.17, hitPoints: 1 },
  { id: 'pillar-center', kind: 'barrier', u: 0.5, v: 0.5, width: 0.22, height: 0.22, hitPoints: 1 },
  { id: 'pillar-upper', kind: 'barrier', u: 0.5, v: 0.28, width: 0.2, height: 0.2, hitPoints: 1 },
  { id: 'pillar-lower', kind: 'barrier', u: 0.5, v: 0.72, width: 0.2, height: 0.2, hitPoints: 1 },
]
const SCORE_NODE_VALUE = 1

export class GameEngine {
  private readonly windows = new Map<string, WindowState>()
  private readonly listeners = new Set<SnapshotListener>()
  private readonly channel: GameChannel

  private balls: BallState[] = []
  private targetAnchors: GoalAnchor[] = []
  private scoreNodeAnchors = new Map<string, GoalAnchor>()
  private obstacleAnchors = new Map<string, ObstacleAnchor[]>()
  private obstacleHitPoints = new Map<string, number>()
  private claimedScoreNodeWindowIds = new Set<string>()
  private expiredScoreNodeWindowIds = new Set<string>()
  private enteredScoreNodeWindowIds = new Set<string>()
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
  private lastShotAt = 0

  constructor(channel: GameChannel) {
    this.channel = channel
  }

  restoreProgress(state: PlayerProgressState | null): void {
    if (!state) {
      return
    }

    const maxUnlockedLevel = clamp(state.maxUnlockedLevel, 1, MAX_LEVEL)

    this.score = Math.max(0, state.score)
    this.streak = 0
    this.bestStreak = Math.max(0, state.bestStreak)
    this.maxUnlockedLevel = maxUnlockedLevel
    this.currentLevel = clamp(state.selectedLevel, 1, maxUnlockedLevel)
    this.completedLevels.clear()

    for (const level of state.completedLevels) {
      if (level >= 1 && level <= MAX_LEVEL) {
        this.completedLevels.add(level)
      }
    }

    this.score = Math.max(this.score, this.completedLevels.size)

    this.phase = 'idle'
    this.tick = 0
    this.balls = []
    this.resetRouteState()
    this.note = this.getIdleNote()
  }

  getProgressState(): PlayerProgressState {
    return {
      version: 1,
      score: this.score,
      bestStreak: this.bestStreak,
      selectedLevel: this.currentLevel,
      maxUnlockedLevel: this.maxUnlockedLevel,
      completedLevels: [...this.completedLevels].sort((left, right) => left - right),
    }
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
    const obstacles = this.getObstacles(activeWindows)
    const activeTarget = this.getActiveTargetState(activeWindows, difficulty, obstacles)
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
      activeTarget,
      activeScoreNode: this.getActiveScoreNodeState(activeWindows, difficulty, obstacles, activeTarget),
      obstacles,
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

  endGame(prefix = 'Session ended.'): void {
    this.balls = []
    this.resetRouteState()
    this.phase = 'idle'
    this.streak = 0
    this.tick = 0
    this.note = this.getIdleNote(prefix)
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

    this.initializeRouteTargets(activeWindows, difficulty)
    this.balls = this.createBallSet(activeWindows, difficulty, this.getObstacles(activeWindows))
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

  handleCatchAttempt(payload?: CatchAttemptPayload): void {
    if (!isCatchAttemptPayload(payload) || this.phase !== 'running') {
      return
    }

    const now = Date.now()
    if (now - this.lastShotAt < SHOT_COOLDOWN_MS) {
      return
    }

    const difficulty = getDifficultyForLevel(this.currentLevel)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows)
    const obstacles = this.getObstacles(activeWindows)
    const clickedWindow = activeWindows.find((windowState) => windowState.id === payload.id)
    if (!clickedWindow) {
      return
    }

    this.lastShotAt = now

    const obstacle = obstacles
      .filter((entry) => entry.windowId === clickedWindow.id && !entry.destroyed)
      .find((entry) => this.shotHitsObstacle(payload, entry))

    if (obstacle) {
      const nextHitPoints = Math.max(0, obstacle.hitPoints - 1)
      this.obstacleHitPoints.set(obstacle.id, nextHitPoints)

      const remainingRoomBarriers = this.getObstacles(activeWindows)
        .filter((entry) => entry.windowId === clickedWindow.id && !entry.destroyed)
        .length

      this.note = remainingRoomBarriers > 0
        ? `${clickedWindow.title} barrier hit. ${remainingRoomBarriers} barrier${remainingRoomBarriers === 1 ? '' : 's'} still active.`
        : `${clickedWindow.title} cleared. Objective path opened.`

      this.emitSnapshot()
      return
    }

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
      this.initializeRouteTargets(activeWindows, difficulty)
    }

    const obstacles = this.getObstacles(activeWindows)
    const activeTarget = this.getActiveTargetState(activeWindows, difficulty, obstacles)
    if (this.phase !== 'running') {
      this.phase = 'running'
      this.note = this.getRoundIntro(activeWindows)
    }

    if (this.balls.length === 0) {
      this.balls = this.createBallSet(activeWindows, difficulty, obstacles)
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
      const motionObstacles = obstacles.filter((obstacle) =>
        motionWindows.some((windowState) => windowState.id === obstacle.windowId),
      )
      const tunedBall = retuneBall(ball, difficulty)
      const stabilizedBall = stabilizeBall({
        ...tunedBall,
        ownerWindowId: seedWindow.id,
      }, motionWindows, motionObstacles)
      const advancedBall = advanceBall(stabilizedBall, motionWindows, motionObstacles, deltaMs)

      return {
        ...advancedBall,
        ownerWindowId: findContainingWindow(motionWindows, advancedBall.x, advancedBall.y)?.id ?? seedWindow.id,
      }
    })
    this.tick += 1

    const activeScoreNode = this.getActiveScoreNodeState(activeWindows, difficulty, obstacles, activeTarget)
    this.resolveScoreNodeState(activeWindows, activeScoreNode)

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
      this.score += 1
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

  private createBallSet(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
  ): BallState[] {
    const startWindow = activeWindows[0]
    const startObstacles = startWindow
      ? obstacles.filter((obstacle) => obstacle.windowId === startWindow.id)
      : []

    return startWindow ? [createBall([startWindow], difficulty, startObstacles)] : []
  }

  private createGoalAnchor(
    windowState: WindowState,
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
    isGoal: boolean,
  ): GoalAnchor {
    const rect = rectFromWindow(windowState)
    const radius = isGoal
      ? Math.max(18, difficulty.radius * 1.8)
      : Math.max(16, difficulty.radius * 1.45)
    const margin = radius + 18

    for (let attempt = 0; attempt < 32; attempt += 1) {
      const anchor = {
        u: randomBetween(0.24, 0.76),
        v: randomBetween(0.22, 0.78),
      }
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (!obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))) {
        return anchor
      }
    }

    const fallbackAnchors: GoalAnchor[] = [
      { u: 0.22, v: 0.22 },
      { u: 0.78, v: 0.22 },
      { u: 0.22, v: 0.78 },
      { u: 0.78, v: 0.78 },
      { u: 0.5, v: 0.2 },
      { u: 0.5, v: 0.8 },
      { u: 0.2, v: 0.5 },
      { u: 0.8, v: 0.5 },
    ]

    for (const anchor of fallbackAnchors) {
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (!obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))) {
        return anchor
      }
    }

    return {
      u: 0.5,
      v: 0.5,
    }
  }

  private getActiveTargetState(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
  ): TargetState | null {
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
    const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === targetWindow.id && !obstacle.destroyed)
    const isGoal = this.currentRouteStep >= targetWindows.length - 1
    const radius = isGoal
      ? Math.max(18, difficulty.radius * 1.8)
      : Math.max(16, difficulty.radius * 1.45)
    const margin = radius + 18

    let x = clamp(
      rect.left + (rect.width * anchor.u),
      rect.left + margin,
      rect.right - margin,
    )
    let y = clamp(
      rect.top + (rect.height * anchor.v),
      rect.top + margin,
      rect.bottom - margin,
    )

    if (roomObstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))) {
      for (let attempt = 0; attempt < 32; attempt += 1) {
        const nextAnchor = this.createGoalAnchor(targetWindow, difficulty, roomObstacles, isGoal)
        x = clamp(
          rect.left + (rect.width * nextAnchor.u),
          rect.left + margin,
          rect.right - margin,
        )
        y = clamp(
          rect.top + (rect.height * nextAnchor.v),
          rect.top + margin,
          rect.bottom - margin,
        )

        if (!roomObstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))) {
          break
        }
      }
    }

    return {
      kind: isGoal ? 'goal' : 'bridge',
      label: isGoal ? 'GOAL' : `RELAY ${this.currentRouteStep + 1}`,
      windowId: targetWindow.id,
      x,
      y,
      radius,
    }
  }

  private getActiveScoreNodeState(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
    activeTarget: TargetState | null,
  ): ScoreNodeState | null {
    if (!activeTarget || activeTarget.kind !== 'bridge') {
      return null
    }

    const scoreWindowId = activeTarget.windowId
    if (this.claimedScoreNodeWindowIds.has(scoreWindowId) || this.expiredScoreNodeWindowIds.has(scoreWindowId)) {
      return null
    }

    const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === scoreWindowId && !obstacle.destroyed)
    if (roomObstacles.length > 0) {
      return null
    }

    const windowState = activeWindows.find((entry) => entry.id === scoreWindowId)
    const anchor = windowState ? this.scoreNodeAnchors.get(scoreWindowId) : null
    if (!windowState || !anchor) {
      return null
    }

    const rect = rectFromWindow(windowState)
    const radius = Math.max(12, difficulty.radius * 0.9)
    const margin = radius + 18

    return {
      kind: 'score',
      label: `+${SCORE_NODE_VALUE}`,
      value: SCORE_NODE_VALUE,
      windowId: scoreWindowId,
      x: clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin),
      y: clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin),
      radius,
    }
  }

  private initializeRouteTargets(activeWindows: WindowState[], difficulty: DifficultyLevel): void {
    this.currentRouteStep = 0
    this.obstacleAnchors = this.createObstacleAnchors(activeWindows, difficulty)
    const obstacles = this.getObstacles(activeWindows)
    const targetWindows = activeWindows.slice(1)

    this.targetAnchors = targetWindows.map((windowState, index) => {
      const isGoal = index === targetWindows.length - 1
      const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === windowState.id && !obstacle.destroyed)
      return this.createGoalAnchor(windowState, difficulty, roomObstacles, isGoal)
    })

    this.scoreNodeAnchors.clear()
    activeWindows.slice(1, -1).forEach((windowState, index) => {
      const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === windowState.id && !obstacle.destroyed)
      const routeTarget = this.targetAnchors[index]
      const scoreNodeAnchor = routeTarget
        ? this.createScoreNodeAnchor(windowState, difficulty, roomObstacles, routeTarget)
        : null

      if (scoreNodeAnchor) {
        this.scoreNodeAnchors.set(windowState.id, scoreNodeAnchor)
      }
    })
  }

  private resetRouteState(): void {
    this.currentRouteStep = 0
    this.targetAnchors = []
    this.scoreNodeAnchors.clear()
    this.obstacleAnchors.clear()
    this.obstacleHitPoints.clear()
    this.claimedScoreNodeWindowIds.clear()
    this.expiredScoreNodeWindowIds.clear()
    this.enteredScoreNodeWindowIds.clear()
    this.lastShotAt = 0
  }

  private createScoreNodeAnchor(
    windowState: WindowState,
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
    routeTargetAnchor: GoalAnchor,
  ): GoalAnchor | null {
    const rect = rectFromWindow(windowState)
    const radius = Math.max(12, difficulty.radius * 0.9)
    const targetRadius = Math.max(16, difficulty.radius * 1.45)
    const margin = radius + 18
    const targetX = clamp(rect.left + (rect.width * routeTargetAnchor.u), rect.left + targetRadius + 18, rect.right - targetRadius - 18)
    const targetY = clamp(rect.top + (rect.height * routeTargetAnchor.v), rect.top + targetRadius + 18, rect.bottom - targetRadius - 18)

    for (let attempt = 0; attempt < 32; attempt += 1) {
      const anchor = {
        u: randomBetween(0.2, 0.8),
        v: randomBetween(0.2, 0.8),
      }
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (
        !obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))
        && !this.circleOverlapsTarget(x, y, radius, targetX, targetY, targetRadius + 10)
      ) {
        return anchor
      }
    }

    const fallbackAnchors: GoalAnchor[] = [
      { u: 0.18, v: 0.18 },
      { u: 0.82, v: 0.18 },
      { u: 0.18, v: 0.82 },
      { u: 0.82, v: 0.82 },
      { u: 0.2, v: 0.5 },
      { u: 0.8, v: 0.5 },
    ]

    for (const anchor of fallbackAnchors) {
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (
        !obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))
        && !this.circleOverlapsTarget(x, y, radius, targetX, targetY, targetRadius + 10)
      ) {
        return anchor
      }
    }

    return null
  }

  private createObstacleAnchors(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
  ): Map<string, ObstacleAnchor[]> {
    const anchors = new Map<string, ObstacleAnchor[]>()

    activeWindows.forEach((windowState, index) => {
      if (index === 0) {
        anchors.set(windowState.id, [])
        return
      }

      const isGoal = index === activeWindows.length - 1
      const count = this.getObstacleCount(difficulty.level, isGoal)
      const offset = (this.currentLevel * 3) + (windowState.slot * 5) + index

      anchors.set(
        windowState.id,
        this.pickObstacleTemplates(count, offset).map((template, templateIndex) => ({
          ...template,
          id: `${windowState.id}-${template.id}-${templateIndex}`,
        })),
      )
    })

    return anchors
  }

  private getObstacleCount(level: number, isGoal: boolean): number {
    if (isGoal) {
      if (level >= 7) {
        return 3
      }

      if (level >= 4) {
        return 2
      }

      return 1
    }

    if (level >= 6) {
      return 2
    }

    return 1
  }

  private pickObstacleTemplates(count: number, offset: number): ObstacleAnchor[] {
    const orderedTemplates = OBSTACLE_TEMPLATES.map((_, index) =>
      OBSTACLE_TEMPLATES[(index + offset) % OBSTACLE_TEMPLATES.length],
    )

    return this.pickTemplateCombination(orderedTemplates, count)
  }

  private pickTemplateCombination(orderedTemplates: ObstacleAnchor[], targetCount: number): ObstacleAnchor[] {
    let best: ObstacleAnchor[] = []

    const search = (index: number, selected: ObstacleAnchor[]): void => {
      if (selected.length > best.length) {
        best = [...selected]
      }

      if (selected.length >= targetCount || index >= orderedTemplates.length) {
        return
      }

      const remaining = orderedTemplates.length - index
      if (selected.length + remaining <= best.length) {
        return
      }

      const candidate = orderedTemplates[index]
      if (!selected.some((template) => this.templatesOverlap(template, candidate))) {
        selected.push(candidate)
        search(index + 1, selected)
        selected.pop()
      }

      search(index + 1, selected)
    }

    search(0, [])
    return best
  }

  private templatesOverlap(left: ObstacleAnchor, right: ObstacleAnchor): boolean {
    return (
      Math.abs(left.u - right.u) < ((left.width + right.width) * 0.55)
      && Math.abs(left.v - right.v) < ((left.height + right.height) * 0.55)
    )
  }

  private getObstacles(activeWindows: WindowState[]): ObstacleState[] {
    return activeWindows.flatMap((windowState) => {
      const anchors = this.obstacleAnchors.get(windowState.id) ?? []
      const rect = rectFromWindow(windowState)
      const minSize = 24

      return anchors.map((anchor) => {
        const width = Math.max(minSize, rect.width * anchor.width)
        const height = Math.max(minSize, rect.height * anchor.height)
        const hitPoints = Math.max(0, this.obstacleHitPoints.get(anchor.id) ?? anchor.hitPoints)
        const x = clamp(
          rect.left + (rect.width * anchor.u) - (width / 2),
          rect.left + 14,
          rect.right - width - 14,
        )
        const y = clamp(
          rect.top + (rect.height * anchor.v) - (height / 2),
          rect.top + 14,
          rect.bottom - height - 14,
        )

        return {
          id: anchor.id,
          windowId: windowState.id,
          kind: anchor.kind,
          x,
          y,
          width,
          height,
          hitPoints,
          maxHitPoints: anchor.hitPoints,
          destroyed: hitPoints <= 0,
        }
      })
    })
  }

  private targetOverlapsObstacle(x: number, y: number, radius: number, obstacle: ObstacleState): boolean {
    return !obstacle.destroyed
      && x + radius >= obstacle.x
      && x - radius <= obstacle.x + obstacle.width
      && y + radius >= obstacle.y
      && y - radius <= obstacle.y + obstacle.height
  }

  private shotHitsObstacle(payload: CatchAttemptPayload, obstacle: ObstacleState): boolean {
    return (
      payload.worldX >= obstacle.x - SHOT_HIT_PADDING_PX
      && payload.worldX <= obstacle.x + obstacle.width + SHOT_HIT_PADDING_PX
      && payload.worldY >= obstacle.y - SHOT_HIT_PADDING_PX
      && payload.worldY <= obstacle.y + obstacle.height + SHOT_HIT_PADDING_PX
    )
  }

  private circleOverlapsTarget(
    x: number,
    y: number,
    radius: number,
    targetX: number,
    targetY: number,
    targetRadius: number,
  ): boolean {
    return Math.hypot(x - targetX, y - targetY) < radius + targetRadius
  }

  private resolveScoreNodeState(activeWindows: WindowState[], activeScoreNode: ScoreNodeState | null): void {
    if (!activeScoreNode) {
      return
    }

    const scoreWindowId = activeScoreNode.windowId
    const scoreWindow = activeWindows.find((windowState) => windowState.id === scoreWindowId)
    const roomTitle = scoreWindow?.title ?? 'Current relay'
    const scoreBall = this.balls.find((ball) =>
      pointInCircle(ball.x, ball.y, activeScoreNode.x, activeScoreNode.y, ball.radius + activeScoreNode.radius),
    )

    if (scoreBall) {
      this.claimedScoreNodeWindowIds.add(scoreWindowId)
      this.enteredScoreNodeWindowIds.delete(scoreWindowId)
      this.score += activeScoreNode.value
      this.note = `${roomTitle} bonus secured. +${activeScoreNode.value} score.`
      return
    }

    const ballInScoreRoom = this.balls.some((ball) => ball.ownerWindowId === scoreWindowId)
    if (ballInScoreRoom) {
      this.enteredScoreNodeWindowIds.add(scoreWindowId)
      return
    }

    if (!this.enteredScoreNodeWindowIds.has(scoreWindowId)) {
      return
    }

    this.enteredScoreNodeWindowIds.delete(scoreWindowId)
    this.expiredScoreNodeWindowIds.add(scoreWindowId)
    this.note = `${roomTitle} bonus lost.`
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
    const obstacleCount = this.getObstacles(activeWindows).filter((obstacle) => !obstacle.destroyed).length

    return firstBridge
      ? `Level ${this.currentLevel} live. ${obstacleCount} barrier${obstacleCount === 1 ? '' : 's'} online. Start in ${startWindow?.title ?? 'Window 1'}, link ${firstBridge.title} first, then route to ${goalWindow?.title ?? 'the goal'}.`
      : `Level ${this.currentLevel} live. ${obstacleCount} barrier${obstacleCount === 1 ? '' : 's'} online. Route the signal to ${goalWindow?.title ?? 'the goal'}.`
  }

  private getProgressNote(activeWindows: WindowState[]): string {
    const bridgeCount = Math.max(0, activeWindows.length - 2)
    if (this.currentRouteStep < bridgeCount) {
      const nextBridge = activeWindows[this.currentRouteStep + 1]
      return `Relay ${this.currentRouteStep} linked. Route the signal around the barriers into ${nextBridge?.title ?? 'the next relay'}.`
    }

    return `All relays linked. Goal is live in ${activeWindows[activeWindows.length - 1]?.title ?? 'the goal window'}.`
  }

  private getIdleNote(prefix?: string): string {
    const allUnlocked = this.completedLevels.size >= MAX_LEVEL
    const base = allUnlocked
      ? `All levels unlocked. Level ${this.currentLevel} is queued for replay.`
      : this.maxUnlockedLevel > 1 || this.completedLevels.size > 0
        ? `Progress restored. Level ${this.currentLevel} is queued.`
        : 'Idle. Arm the field to begin at level 1.'

    return prefix ? `${prefix} ${base}` : base
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

function isCatchAttemptPayload(value: CatchAttemptPayload | undefined): value is CatchAttemptPayload {
  return !!value
    && typeof value.id === 'string'
    && Number.isFinite(value.worldX)
    && Number.isFinite(value.worldY)
}
