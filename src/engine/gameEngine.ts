import { MAX_DELTA_MS, SHOT_COOLDOWN_MS, SHOT_HIT_PADDING_PX, WINDOW_STALE_MS } from '../shared/constants'
import { clamp, findContainingWindow, getConnectedWindows, pointInCircle, pointInRect, rectFromWindow, sortWindowsBySlot } from '../shared/geometry'
import type { GameChannel } from '../network/channel'
import {
  compareMedalTiers,
  getBonusProfileForLevel,
  getDifficultyForLevel,
  getMedalScoreBonus,
  getMedalTierForTime,
  getObstacleProfileForLevel,
  getSideBlockProfileForLevel,
  MAX_LEVEL,
} from './difficulty'
import { advanceBall, createBall, retuneBall, stabilizeBall } from './physics'
import type {
  AmbientBonusKind,
  AmbientBonusState,
  BallState,
  CatchAttemptPayload,
  DifficultyLevel,
  GamePhase,
  GameSnapshot,
  LevelSummaryState,
  MedalTier,
  ObstacleState,
  PlayerProgressState,
  RunUpgradeId,
  RunUpgradeLevels,
  RouteWindowState,
  ScoreNodeState,
  TargetState,
  WindowEdge,
  WindowBoundsPayload,
  WindowState,
} from '../shared/types'
import { createRunUpgradeLevels, getRunUpgradeCost, getRunUpgradeDefinition } from '../shared/upgrades'

type SnapshotListener = (snapshot: GameSnapshot) => void

interface GoalAnchor {
  u: number
  v: number
}

interface AmbientBonusAnchor extends GoalAnchor {
  id: string
  windowId: string
  kind: AmbientBonusKind
  scoreValue: number
  chargeValue: number
  timeValueMs: number
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
  { id: 'corner-top-left', kind: 'barrier', u: 0.22, v: 0.22, width: 0.16, height: 0.16, hitPoints: 1 },
  { id: 'corner-top-right', kind: 'barrier', u: 0.78, v: 0.22, width: 0.16, height: 0.16, hitPoints: 1 },
  { id: 'corner-bottom-left', kind: 'barrier', u: 0.22, v: 0.78, width: 0.16, height: 0.16, hitPoints: 1 },
  { id: 'corner-bottom-right', kind: 'barrier', u: 0.78, v: 0.78, width: 0.16, height: 0.16, hitPoints: 1 },
  { id: 'lane-left', kind: 'barrier', u: 0.2, v: 0.5, width: 0.12, height: 0.28, hitPoints: 1 },
  { id: 'lane-right', kind: 'barrier', u: 0.8, v: 0.5, width: 0.12, height: 0.28, hitPoints: 1 },
]
const SCORE_NODE_VALUE = 1
const SCORE_NODE_CHARGE_VALUE = 1
const SCORE_NODE_CREDIT_VALUE = 1
const BRIDGE_PULSE_DURATION_MS = 6_000
const TIME_BRAKE_DURATION_MS = 4_500
const TIME_BRAKE_SPEED_SCALE = 0.48
const EMPTY_BLOCKED_EDGES = new Map<string, WindowEdge[]>()
const SIDE_BLOCK_PATTERNS: WindowEdge[][] = [
  ['left'],
  ['right'],
  ['up'],
  ['down'],
  ['left', 'up'],
  ['right', 'up'],
  ['left', 'down'],
  ['right', 'down'],
  ['left', 'right'],
  ['up', 'down'],
]

type PauseReason = 'focus'

export class GameEngine {
  private readonly windows = new Map<string, WindowState>()
  private readonly listeners = new Set<SnapshotListener>()
  private readonly channel: GameChannel

  private balls: BallState[] = []
  private targetAnchors: GoalAnchor[] = []
  private scoreNodeAnchors = new Map<string, GoalAnchor>()
  private ambientBonusAnchors: AmbientBonusAnchor[] = []
  private obstacleAnchors = new Map<string, ObstacleAnchor[]>()
  private obstacleHitPoints = new Map<string, number>()
  private blockedEdges = new Map<string, WindowEdge[]>()
  private claimedScoreNodeWindowIds = new Set<string>()
  private expiredScoreNodeWindowIds = new Set<string>()
  private enteredScoreNodeWindowIds = new Set<string>()
  private claimedAmbientBonusIds = new Set<string>()
  private currentRouteStep = 0
  private score = 0
  private streak = 0
  private bestStreak = 0
  private bonusCollectionCount = 0
  private utilityCharges = 0
  private upgradeCredits = 0
  private runUpgradeLevels: RunUpgradeLevels = createRunUpgradeLevels()
  private currentLevelScoreGain = 0
  private currentLevelChargeGain = 0
  private currentLevelCreditGain = 0
  private bridgePulseEndsAt = 0
  private pausedBridgePulseRemainingMs = 0
  private timeBrakeEndsAt = 0
  private pausedTimeBrakeRemainingMs = 0
  private currentLevelStartedAt: number | null = null
  private currentLevelElapsedMs = 0
  private bestLevelTimesMs = new Map<number, number>()
  private bestLevelMedals = new Map<number, MedalTier>()
  private tick = 0
  private currentLevel = 1
  private maxUnlockedLevel = 1
  private readonly completedLevels = new Set<number>()
  private levelSummary: LevelSummaryState | null = null
  private frontWindowId: string | null = null
  private readonly windowFocusOrder = new Map<string, number>()
  private focusOrderTick = 0
  private phase: GamePhase = 'idle'
  private pauseReason: PauseReason | null = null
  private pausedPhase: Exclude<GamePhase, 'idle' | 'paused'> | null = null
  private pausedNote: string | null = null
  private pendingLevelLoadoutGrant = false
  private note = 'Idle. Arm the field to begin at level 1.'
  private lastStepAt = 0
  private lastShotAt = 0

  constructor(channel: GameChannel) {
    this.channel = channel
  }

  setFrontWindowId(windowId: string | null): void {
    if (!windowId) {
      this.frontWindowId = null
      return
    }

    this.promoteWindowFocus(windowId)
  }

  setWindowFocusStack(windowIds: string[]): void {
    for (const windowId of windowIds) {
      this.promoteWindowFocus(windowId)
    }
  }

  private promoteWindowFocus(windowId: string): void {
    this.focusOrderTick += 1
    this.windowFocusOrder.set(windowId, this.focusOrderTick)
    this.frontWindowId = windowId
  }

  private clearWindowFocusState(): void {
    this.frontWindowId = null
    this.windowFocusOrder.clear()
    this.focusOrderTick = 0
  }

  private syncFrontWindowFromFocusOrder(): void {
    let nextFrontWindowId: string | null = null
    let nextFrontRank = -1

    for (const [windowId, rank] of this.windowFocusOrder) {
      if (rank > nextFrontRank) {
        nextFrontWindowId = windowId
        nextFrontRank = rank
      }
    }

    this.frontWindowId = nextFrontWindowId
  }

  private clearActiveUtilities(): void {
    this.bridgePulseEndsAt = 0
    this.pausedBridgePulseRemainingMs = 0
    this.timeBrakeEndsAt = 0
    this.pausedTimeBrakeRemainingMs = 0
  }

  private pauseActiveUtilities(now: number): void {
    this.pausedBridgePulseRemainingMs = this.getBridgePulseRemainingMs(now)
    this.bridgePulseEndsAt = 0
    this.pausedTimeBrakeRemainingMs = this.getTimeBrakeRemainingMs(now)
    this.timeBrakeEndsAt = 0
  }

  private resumeActiveUtilities(now: number): void {
    if (this.pausedBridgePulseRemainingMs > 0) {
      this.bridgePulseEndsAt = now + this.pausedBridgePulseRemainingMs
      this.pausedBridgePulseRemainingMs = 0
    }

    if (this.pausedTimeBrakeRemainingMs > 0) {
      this.timeBrakeEndsAt = now + this.pausedTimeBrakeRemainingMs
      this.pausedTimeBrakeRemainingMs = 0
    }
  }

  private resetRunUpgradeState(): void {
    this.upgradeCredits = 0
    this.runUpgradeLevels = createRunUpgradeLevels()
    this.pendingLevelLoadoutGrant = false
  }

  private resetLevelRewardTracking(): void {
    this.currentLevelScoreGain = 0
    this.currentLevelChargeGain = 0
    this.currentLevelCreditGain = 0
  }

  private queueLevelLoadoutGrant(): void {
    this.pendingLevelLoadoutGrant = true
    this.resetLevelRewardTracking()
  }

  private grantPendingLevelLoadout(): void {
    if (!this.pendingLevelLoadoutGrant) {
      return
    }

    const reserveChargeCount = this.getRunUpgradeLevel('reserve_cells')
    if (reserveChargeCount > 0) {
      this.utilityCharges += reserveChargeCount
    }

    this.pendingLevelLoadoutGrant = false
  }

  private getRunUpgradeLevel(id: RunUpgradeId): number {
    return this.runUpgradeLevels[id] ?? 0
  }

  private addScoreReward(amount: number): void {
    if (amount <= 0) {
      return
    }

    this.score += amount
    this.currentLevelScoreGain += amount
  }

  private addUtilityChargeReward(amount: number): void {
    if (amount <= 0) {
      return
    }

    this.utilityCharges += amount
    this.currentLevelChargeGain += amount
  }

  private addUpgradeCreditReward(amount: number): void {
    if (amount <= 0) {
      return
    }

    this.upgradeCredits += amount
    this.currentLevelCreditGain += amount
  }

  private getRouteTargetRadius(difficulty: DifficultyLevel, isGoal: boolean): number {
    const baseRadius = isGoal
      ? Math.max(18, difficulty.radius * 1.8)
      : Math.max(16, difficulty.radius * 1.45)

    return baseRadius + (this.getRunUpgradeLevel('signal_lens') * 4)
  }

  private getUtilityDurationScale(): number {
    return 1 + (this.getRunUpgradeLevel('pulse_coil') * 0.25)
  }

  debugForceLevelComplete(now: number): boolean {
    const difficulty = getDifficultyForLevel(this.currentLevel)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows)
    const goalWindow = activeWindows[activeWindows.length - 1]
    if (!goalWindow) {
      return false
    }

    const goalRect = rectFromWindow(goalWindow)
    const target: TargetState = {
      kind: 'goal',
      label: 'GOAL',
      windowId: goalWindow.id,
      x: goalRect.left + (goalRect.width / 2),
      y: goalRect.top + (goalRect.height / 2),
      radius: this.getRouteTargetRadius(difficulty, true),
    }

    this.handleRouteHit(activeWindows, target, difficulty, now)
    return true
  }

  debugAttemptActiveTargetHit(now: number): boolean {
    if (this.phase !== 'running' && !(this.phase === 'paused' && this.pauseReason === 'focus')) {
      return false
    }

    const difficulty = getDifficultyForLevel(this.currentLevel)
    const activeWindows = this.getActiveWindows(difficulty.activeWindows)
    if (activeWindows.length < difficulty.activeWindows) {
      return false
    }

    const obstacles = this.getObstacles(activeWindows)
    const activeTarget = this.getActiveTargetState(activeWindows, difficulty, obstacles)
    if (!activeTarget) {
      return false
    }

    if (!this.isObjectiveVisible(activeTarget, activeWindows)) {
      this.note = this.getOccludedObjectiveNote(activeTarget, activeWindows)
      this.emitSnapshot()
      return false
    }

    this.handleRouteHit(activeWindows, activeTarget, difficulty, now)
    return true
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
    this.bestLevelTimesMs.clear()
    this.bestLevelMedals.clear()

    for (const level of state.completedLevels) {
      if (level >= 1 && level <= MAX_LEVEL) {
        this.completedLevels.add(level)
      }
    }

    for (const [level, timeMs] of Object.entries(state.bestLevelTimesMs)) {
      const numericLevel = Number(level)
      if (Number.isInteger(numericLevel) && numericLevel >= 1 && numericLevel <= MAX_LEVEL && timeMs > 0) {
        this.bestLevelTimesMs.set(numericLevel, timeMs)

        if (!this.bestLevelMedals.has(numericLevel)) {
          const derivedMedal = getMedalTierForTime(getDifficultyForLevel(numericLevel).medalThresholds, timeMs)
          if (derivedMedal !== 'none') {
            this.bestLevelMedals.set(numericLevel, derivedMedal)
          }
        }
      }
    }

    for (const [level, medal] of Object.entries(state.bestLevelMedals)) {
      const numericLevel = Number(level)
      if (
        Number.isInteger(numericLevel)
        && numericLevel >= 1
        && numericLevel <= MAX_LEVEL
        && isMedalTier(medal)
        && medal !== 'none'
      ) {
        const existing = this.bestLevelMedals.get(numericLevel) ?? 'none'
        if (compareMedalTiers(medal, existing) > 0) {
          this.bestLevelMedals.set(numericLevel, medal)
        }
      }
    }

    this.score = Math.max(this.score, this.completedLevels.size)

    this.phase = 'idle'
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.levelSummary = null
    this.tick = 0
    this.balls = []
    this.bonusCollectionCount = 0
    this.utilityCharges = 0
    this.resetRunUpgradeState()
    this.resetLevelRewardTracking()
    this.clearActiveUtilities()
    this.clearWindowFocusState()
    this.resetLevelTimer()
    this.resetRouteState()
    this.note = this.getIdleNote()
  }

  getProgressState(): PlayerProgressState {
    return {
      version: 3,
      score: this.score,
      bestStreak: this.bestStreak,
      selectedLevel: this.currentLevel,
      maxUnlockedLevel: this.maxUnlockedLevel,
      completedLevels: [...this.completedLevels].sort((left, right) => left - right),
      bestLevelTimesMs: Object.fromEntries(
        [...this.bestLevelTimesMs.entries()]
          .sort(([left], [right]) => left - right)
          .map(([level, timeMs]) => [String(level), timeMs]),
      ),
      bestLevelMedals: Object.fromEntries(
        [...this.bestLevelMedals.entries()]
          .sort(([left], [right]) => left - right)
          .map(([level, medal]) => [String(level), medal]),
      ),
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
    const activeScoreNode = this.getActiveScoreNodeState(activeWindows, difficulty, obstacles, activeTarget)
    const ambientBonuses = this.getAmbientBonusStates(activeWindows, difficulty, obstacles)
    const routeWindowIds = activeWindows.map((windowState) => windowState.id)
    const startWindowId = routeWindowIds[0] ?? null
    const bridgeWindowIds = routeWindowIds.slice(1, -1)
    const completedBridgeWindowIds = bridgeWindowIds.slice(0, Math.min(this.currentRouteStep, bridgeWindowIds.length))
    const campaignComplete = this.phase === 'summary' && this.levelSummary?.nextLevel === null

    return {
      tick: this.tick,
      phase: this.phase,
      campaignComplete,
      score: this.score,
      streak: this.streak,
      bestStreak: this.bestStreak,
      levelElapsedMs: this.currentLevelElapsedMs,
      bestLevelTimeMs: this.bestLevelTimesMs.get(this.currentLevel) ?? null,
      bestLevelMedal: this.bestLevelMedals.get(this.currentLevel) ?? 'none',
      utilityCharges: this.utilityCharges,
      upgradeCredits: this.upgradeCredits,
      selectedLevel: this.currentLevel,
      maxUnlockedLevel: this.maxUnlockedLevel,
      completedLevels: [...this.completedLevels].sort((left, right) => left - right),
      runUpgradeLevels: { ...this.runUpgradeLevels },
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
      activeScoreNode,
      ambientBonuses,
      bonusCollectionCount: this.bonusCollectionCount,
      activeUtility: this.getActiveUtilityState(),
      obstacles,
      windows: registeredWindows,
      balls: this.balls,
      ball: this.balls.find((ball) => ball.ownerWindowId) ?? this.balls[0] ?? null,
      transitionHint: null,
      levelSummary: this.levelSummary,
      note: this.note,
    }
  }

  start(now: number): void {
    this.tick = 0
    this.balls = []
    this.bonusCollectionCount = 0
    this.utilityCharges = 0
    this.resetRunUpgradeState()
    this.queueLevelLoadoutGrant()
    this.clearActiveUtilities()
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.levelSummary = null
    this.clearWindowFocusState()
    this.resetLevelTimer()
    this.resetRouteState()
    this.phase = 'waiting'
    this.note = `Level ${this.currentLevel} armed. Connect the windows and route the signal through every relay to the goal.`
    this.lastStepAt = now
    this.emitSnapshot()
  }

  endGame(prefix = 'Session ended.'): void {
    this.balls = []
    this.bonusCollectionCount = 0
    this.utilityCharges = 0
    this.resetRunUpgradeState()
    this.resetLevelRewardTracking()
    this.clearActiveUtilities()
    this.resetLevelTimer()
    this.resetRouteState()
    this.phase = 'idle'
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.levelSummary = null
    this.clearWindowFocusState()
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
    this.bonusCollectionCount = 0
    this.clearActiveUtilities()
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.levelSummary = null
    this.clearWindowFocusState()
    this.resetLevelTimer()
    this.resetRouteState()
    this.pendingLevelLoadoutGrant = false
    this.resetLevelRewardTracking()

    if (this.phase === 'idle') {
      this.note = `Level ${level} queued. Arm the field to begin.`
    } else {
      this.phase = 'waiting'
      this.queueLevelLoadoutGrant()
      this.note = `Level ${level} selected. Route the signal through each relay window in order.`
    }

    this.emitSnapshot()
  }

  activateBridgePulse(now: number): void {
    if (this.phase !== 'running') {
      return
    }

    if (this.utilityCharges <= 0 || this.getActiveUtilityState(now)) {
      return
    }

    this.utilityCharges -= 1
    const durationMs = Math.round(BRIDGE_PULSE_DURATION_MS * this.getUtilityDurationScale())
    this.bridgePulseEndsAt = now + durationMs
    this.note = `Bridge pulse live for ${formatDurationMs(durationMs)}. Side locks suppressed.`
    this.emitSnapshot()
  }

  activateTimeBrake(now: number): void {
    if (this.phase !== 'running') {
      return
    }

    if (this.utilityCharges <= 0 || this.getActiveUtilityState(now)) {
      return
    }

    this.utilityCharges -= 1
    const durationMs = Math.round(TIME_BRAKE_DURATION_MS * this.getUtilityDurationScale())
    this.timeBrakeEndsAt = now + durationMs
    this.note = `Time brake live for ${formatDurationMs(durationMs)}. Signal speed reduced.`
    this.emitSnapshot()
  }

  purchaseUpgrade(id: RunUpgradeId): boolean {
    if (this.phase !== 'summary' && this.phase !== 'waiting') {
      return false
    }

    const currentLevel = this.getRunUpgradeLevel(id)
    const cost = getRunUpgradeCost(id, currentLevel)
    if (cost === null || this.upgradeCredits < cost) {
      return false
    }

    const nextLevel = currentLevel + 1
    const upgrade = getRunUpgradeDefinition(id)

    this.upgradeCredits -= cost
    this.runUpgradeLevels = {
      ...this.runUpgradeLevels,
      [id]: nextLevel,
    }
    this.note = `${upgrade.label} upgraded to ${nextLevel === upgrade.maxLevel ? 'max' : `mk ${nextLevel}`}.`
    this.emitSnapshot()
    return true
  }

  continueFromSummary(): void {
    if (this.phase !== 'summary') {
      return
    }

    this.levelSummary = null
    this.clearActiveUtilities()
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.clearWindowFocusState()
    this.resetLevelTimer()
    this.resetRouteState()
    this.phase = 'waiting'
    this.queueLevelLoadoutGrant()
    this.note = `Level ${this.currentLevel} queued. Route the signal through each relay window in order.`
    this.emitSnapshot()
  }

  pause(now: number): void {
    if (this.phase !== 'running' && this.phase !== 'waiting') {
      return
    }

    this.pauseReason = 'focus'
    this.pausedPhase = this.phase
    this.pausedNote = this.note
    this.pauseActiveUtilities(now)
    this.captureLevelTimer(now)
    this.phase = 'paused'
    this.note = 'Session paused in the control deck. Press Resume Game or click a room to continue.'
    this.emitSnapshot()
  }

  resume(now: number): void {
    if (this.phase !== 'paused' || this.pauseReason !== 'focus') {
      return
    }

    this.phase = this.pausedPhase ?? (this.balls.length > 0 ? 'running' : 'waiting')
    this.pauseReason = null
    this.pausedPhase = null
    this.note = this.pausedNote ?? this.note
    this.pausedNote = null

    this.resumeActiveUtilities(now)

    if (this.phase === 'running') {
      this.resumeLevelTimer(now)
    }

    this.lastStepAt = now
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
    this.clearActiveUtilities()
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.balls = this.createBallSet(activeWindows, difficulty, this.getObstacles(activeWindows))
    this.startLevelTimer(Date.now())
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
    this.windowFocusOrder.delete(id)
    if (this.frontWindowId === id) {
      this.syncFrontWindowFromFocusOrder()
    }
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
    if (this.bridgePulseEndsAt > 0 && now >= this.bridgePulseEndsAt) {
      this.bridgePulseEndsAt = 0
    }
    if (this.timeBrakeEndsAt > 0 && now >= this.timeBrakeEndsAt) {
      this.timeBrakeEndsAt = 0
    }

    if (this.phase === 'idle' || this.phase === 'paused' || this.phase === 'summary') {
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
      this.grantPendingLevelLoadout()
      this.balls = this.createBallSet(activeWindows, difficulty, obstacles)
      this.startLevelTimer(now)
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
      const motionWindows = getConnectedWindows(activeWindows, seedWindow.id, this.getEffectiveBlockedEdges(now))
      const motionObstacles = obstacles.filter((obstacle) =>
        motionWindows.some((windowState) => windowState.id === obstacle.windowId),
      )
      const tunedBall = retuneBall(ball, {
        ...difficulty,
        speed: Math.round(difficulty.speed * this.getActiveSpeedScale(now)),
      })
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
    this.updateLevelTimer(now)

    const activeScoreNode = this.getActiveScoreNodeState(activeWindows, difficulty, obstacles, activeTarget)
    const ambientBonuses = this.getAmbientBonusStates(activeWindows, difficulty, obstacles)
    this.resolveScoreNodeState(activeWindows, activeScoreNode)
    this.resolveAmbientBonusState(activeWindows, ambientBonuses, now)

    if (activeTarget) {
      const routeBall = this.balls.find((ball) =>
        pointInCircle(ball.x, ball.y, activeTarget.x, activeTarget.y, ball.radius + activeTarget.radius),
      )

      if (routeBall) {
        if (!this.isObjectiveVisible(activeTarget, activeWindows)) {
          this.note = this.getOccludedObjectiveNote(activeTarget, activeWindows)
        } else {
        this.handleRouteHit(activeWindows, activeTarget, difficulty, now)
        return
        }
      }
    }

    this.emitSnapshot()
  }

  private handleRouteHit(
    activeWindows: WindowState[],
    activeTarget: TargetState,
    difficulty: DifficultyLevel,
    now: number,
  ): void {
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
    const clearTimeMs = this.getCurrentLevelTime(now)
    const clearPerformance = this.recordLevelPerformance(clearedLevel, clearTimeMs, difficulty)
    const levelClearScoreDelta = wasCompleted ? 0 : 1
    const levelClearCreditDelta = wasCompleted ? 0 : 1

    if (!wasCompleted) {
      this.addScoreReward(levelClearScoreDelta)
    }
    this.addScoreReward(clearPerformance.medalScoreDelta)
    this.addUtilityChargeReward(clearPerformance.utilityChargeDelta)
    this.addUpgradeCreditReward(levelClearCreditDelta + clearPerformance.creditDelta)

    const scoreDelta = this.currentLevelScoreGain
    const utilityChargeDelta = this.currentLevelChargeGain
    const creditDelta = this.currentLevelCreditGain

    this.completedLevels.add(clearedLevel)
    this.streak += 1
    this.bestStreak = Math.max(this.bestStreak, this.streak)
    this.balls = []
    this.clearActiveUtilities()
    this.resetLevelTimer()
    this.resetRouteState()
    this.lastStepAt = now

    const nextLevel = clearedLevel < MAX_LEVEL
      ? Math.min(MAX_LEVEL, clearedLevel + 1)
      : null

    if (nextLevel !== null) {
      this.maxUnlockedLevel = Math.max(this.maxUnlockedLevel, nextLevel)
      this.currentLevel = nextLevel
    } else {
      this.maxUnlockedLevel = MAX_LEVEL
      this.currentLevel = MAX_LEVEL
    }

    this.levelSummary = {
      clearedLevel,
      clearTimeMs,
      currentMedal: clearPerformance.currentMedal,
      bestMedal: clearPerformance.bestMedal,
      isNewMedal: clearPerformance.isNewMedal,
      isBestTime: clearPerformance.isBestTime,
      bestTimeMs: this.bestLevelTimesMs.get(clearedLevel) ?? clearTimeMs,
      scoreDelta,
      utilityChargeDelta,
      creditDelta,
      totalScore: this.score,
      totalCredits: this.upgradeCredits,
      totalStreak: this.streak,
      totalCompletedLevels: this.completedLevels.size,
      relayCount: Math.max(0, difficulty.activeWindows - 2),
      windowCount: difficulty.activeWindows,
      goalWindowTitle: goalWindow?.title ?? null,
      nextLevel,
      nextDifficulty: nextLevel === null ? null : getDifficultyForLevel(nextLevel),
    }

    this.phase = 'summary'
    this.pauseReason = null
    this.pausedPhase = null
    this.pausedNote = null
    this.clearWindowFocusState()
    this.note = nextLevel === null
      ? `Level ${clearedLevel} cleared in ${formatDurationMs(clearTimeMs)}.${this.getMedalNote(clearPerformance)}${clearPerformance.isBestTime ? ' New best time.' : ''}${this.getUtilityRewardNote(utilityChargeDelta)}${this.getCreditRewardNote(creditDelta)} Campaign complete.`
      : `Level ${clearedLevel} cleared in ${formatDurationMs(clearTimeMs)}.${this.getMedalNote(clearPerformance)}${clearPerformance.isBestTime ? ' New best time.' : ''}${this.getUtilityRewardNote(utilityChargeDelta)}${this.getCreditRewardNote(creditDelta)} Level ${nextLevel} ready when you are.`
    this.resetLevelRewardTracking()
    this.emitSnapshot()
  }

  private pruneWindows(now: number): void {
    for (const [id, windowState] of this.windows) {
      if (now - windowState.lastSeenAt > WINDOW_STALE_MS) {
        this.windows.delete(id)
        this.windowFocusOrder.delete(id)
      }
    }

    if (this.frontWindowId && !this.windows.has(this.frontWindowId)) {
      this.syncFrontWindowFromFocusOrder()
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
    const radius = this.getRouteTargetRadius(difficulty, isGoal)
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
    const radius = this.getRouteTargetRadius(difficulty, isGoal)
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

  private getAmbientBonusStates(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
  ): AmbientBonusState[] {
    const radius = Math.max(12, difficulty.radius * 0.9)

    return this.ambientBonusAnchors.flatMap((anchor) => {
      if (this.claimedAmbientBonusIds.has(anchor.id)) {
        return []
      }

      const windowState = activeWindows.find((entry) => entry.id === anchor.windowId)
      if (!windowState) {
        return []
      }

      const rect = rectFromWindow(windowState)
      const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === anchor.windowId && !obstacle.destroyed)
      const margin = radius + 18
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (roomObstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))) {
        return []
      }

      return [{
        id: anchor.id,
        kind: anchor.kind,
        label: this.getAmbientBonusLabel(anchor),
        windowId: anchor.windowId,
        x,
        y,
        radius,
        scoreValue: anchor.scoreValue,
        chargeValue: anchor.chargeValue,
        timeValueMs: anchor.timeValueMs,
      }]
    })
  }

  private initializeRouteTargets(activeWindows: WindowState[], difficulty: DifficultyLevel): void {
    this.currentRouteStep = 0
    this.blockedEdges = this.createBlockedEdges(activeWindows, difficulty)
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

    this.ambientBonusAnchors = this.createAmbientBonusAnchors(activeWindows, difficulty, obstacles)
  }

  private resetRouteState(): void {
    this.currentRouteStep = 0
    this.targetAnchors = []
    this.scoreNodeAnchors.clear()
    this.ambientBonusAnchors = []
    this.obstacleAnchors.clear()
    this.obstacleHitPoints.clear()
    this.blockedEdges.clear()
    this.claimedScoreNodeWindowIds.clear()
    this.expiredScoreNodeWindowIds.clear()
    this.enteredScoreNodeWindowIds.clear()
    this.claimedAmbientBonusIds.clear()
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
    const targetRadius = this.getRouteTargetRadius(difficulty, false)
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

  private createAmbientBonusAnchors(
    activeWindows: WindowState[],
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
  ): AmbientBonusAnchor[] {
    const profile = getBonusProfileForLevel(difficulty.level)
    const candidateWindows = activeWindows.slice(1)
    if (profile.ambientCount <= 0 || candidateWindows.length === 0) {
      return []
    }

    const orderedWindows = rotateByOffset(
      candidateWindows,
      getSeededIndex(difficulty.level, Math.max(1, candidateWindows.length), 307),
    )
    const bonusCount = Math.min(profile.ambientCount, orderedWindows.length)
    const anchors: AmbientBonusAnchor[] = []

    for (let index = 0; index < bonusCount; index += 1) {
      const windowState = orderedWindows[index]
      const routeTargetIndex = activeWindows.findIndex((entry) => entry.id === windowState.id) - 1
      const routeTargetAnchor = this.targetAnchors[routeTargetIndex] ?? null
      const scoreNodeAnchor = this.scoreNodeAnchors.get(windowState.id) ?? null
      const roomObstacles = obstacles.filter((obstacle) => obstacle.windowId === windowState.id && !obstacle.destroyed)
      const kind = profile.kinds[getSeededIndex(
        difficulty.level,
        profile.kinds.length,
        (windowState.slot * 37) + (index * 11) + 401,
      )]
      const anchor = this.createAmbientBonusAnchor(windowState, difficulty, roomObstacles, routeTargetAnchor, scoreNodeAnchor)

      if (!anchor) {
        continue
      }

      anchors.push({
        id: `ambient-${windowState.id}-${kind}-${index}`,
        windowId: windowState.id,
        kind,
        u: anchor.u,
        v: anchor.v,
        scoreValue: kind === 'score' ? profile.scoreValue : 0,
        chargeValue: kind === 'charge' ? 1 : 0,
        timeValueMs: kind === 'time' ? profile.timeValueMs : 0,
      })
    }

    return anchors
  }

  private createAmbientBonusAnchor(
    windowState: WindowState,
    difficulty: DifficultyLevel,
    obstacles: ObstacleState[],
    routeTargetAnchor: GoalAnchor | null,
    scoreNodeAnchor: GoalAnchor | null,
  ): GoalAnchor | null {
    const rect = rectFromWindow(windowState)
    const radius = Math.max(12, difficulty.radius * 0.9)
    const margin = radius + 18
    const forbiddenCircles: Array<{ x: number; y: number; radius: number }> = []

    if (routeTargetAnchor) {
      const routeTargetIndex = this.targetAnchors.findIndex((anchor) => anchor === routeTargetAnchor)
      const isGoal = routeTargetIndex === this.targetAnchors.length - 1
      const targetRadius = this.getRouteTargetRadius(difficulty, isGoal)

      forbiddenCircles.push({
        x: clamp(rect.left + (rect.width * routeTargetAnchor.u), rect.left + targetRadius + 18, rect.right - targetRadius - 18),
        y: clamp(rect.top + (rect.height * routeTargetAnchor.v), rect.top + targetRadius + 18, rect.bottom - targetRadius - 18),
        radius: targetRadius + 10,
      })
    }

    if (scoreNodeAnchor) {
      const scoreNodeRadius = Math.max(12, difficulty.radius * 0.9)
      forbiddenCircles.push({
        x: clamp(rect.left + (rect.width * scoreNodeAnchor.u), rect.left + scoreNodeRadius + 18, rect.right - scoreNodeRadius - 18),
        y: clamp(rect.top + (rect.height * scoreNodeAnchor.v), rect.top + scoreNodeRadius + 18, rect.bottom - scoreNodeRadius - 18),
        radius: scoreNodeRadius + 10,
      })
    }

    for (let attempt = 0; attempt < 32; attempt += 1) {
      const anchor = {
        u: randomBetween(0.18, 0.82),
        v: randomBetween(0.18, 0.82),
      }
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (
        !obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))
        && !forbiddenCircles.some((circle) => this.circleOverlapsTarget(x, y, radius, circle.x, circle.y, circle.radius))
      ) {
        return anchor
      }
    }

    const fallbackAnchors: GoalAnchor[] = [
      { u: 0.15, v: 0.2 },
      { u: 0.85, v: 0.2 },
      { u: 0.15, v: 0.8 },
      { u: 0.85, v: 0.8 },
      { u: 0.18, v: 0.5 },
      { u: 0.82, v: 0.5 },
      { u: 0.5, v: 0.16 },
      { u: 0.5, v: 0.84 },
    ]

    for (const anchor of fallbackAnchors) {
      const x = clamp(rect.left + (rect.width * anchor.u), rect.left + margin, rect.right - margin)
      const y = clamp(rect.top + (rect.height * anchor.v), rect.top + margin, rect.bottom - margin)

      if (
        !obstacles.some((obstacle) => this.targetOverlapsObstacle(x, y, radius, obstacle))
        && !forbiddenCircles.some((circle) => this.circleOverlapsTarget(x, y, radius, circle.x, circle.y, circle.radius))
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
    const obstacleProfile = getObstacleProfileForLevel(difficulty.level)

    activeWindows.forEach((windowState, index) => {
      if (index === 0) {
        anchors.set(windowState.id, [])
        return
      }

      const isGoal = index === activeWindows.length - 1
      const count = isGoal ? obstacleProfile.goalCount : obstacleProfile.relayCount
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

  private createBlockedEdges(activeWindows: WindowState[], difficulty: DifficultyLevel): Map<string, WindowEdge[]> {
    const blockedEdges = new Map<string, WindowEdge[]>()
    const profile = getSideBlockProfileForLevel(difficulty.level)

    for (const windowState of activeWindows) {
      blockedEdges.set(windowState.id, [])
    }

    if (profile.blockedRoomCount <= 0 || profile.maxEdgesPerRoom <= 0) {
      return blockedEdges
    }

    const candidateWindows = activeWindows.slice(1)
    const orderedCandidates = rotateByOffset(
      candidateWindows,
      getSeededIndex(difficulty.level, Math.max(1, candidateWindows.length), 211),
    )
    const availablePatterns = SIDE_BLOCK_PATTERNS.filter((pattern) => pattern.length <= profile.maxEdgesPerRoom)
    const blockedRoomCount = Math.min(profile.blockedRoomCount, orderedCandidates.length)

    for (let index = 0; index < blockedRoomCount; index += 1) {
      const windowState = orderedCandidates[index]
      const pattern = availablePatterns[getSeededIndex(difficulty.level, availablePatterns.length, (windowState.slot * 17) + 13 + index)]

      blockedEdges.set(windowState.id, [...pattern])
    }

    return blockedEdges
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
      this.bonusCollectionCount += 1
      this.addScoreReward(activeScoreNode.value)
      this.addUtilityChargeReward(SCORE_NODE_CHARGE_VALUE)
      this.addUpgradeCreditReward(SCORE_NODE_CREDIT_VALUE)
      this.note = `${roomTitle} bonus secured. +${activeScoreNode.value} score. +${SCORE_NODE_CHARGE_VALUE} utility charge. +${SCORE_NODE_CREDIT_VALUE} signal credit.`
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

  private resolveAmbientBonusState(
    activeWindows: WindowState[],
    ambientBonuses: AmbientBonusState[],
    now: number,
  ): void {
    if (ambientBonuses.length === 0) {
      return
    }

    for (const bonus of ambientBonuses) {
      const collected = this.balls.some((ball) =>
        pointInCircle(ball.x, ball.y, bonus.x, bonus.y, ball.radius + bonus.radius),
      )
      if (!collected) {
        continue
      }

      const roomTitle = activeWindows.find((windowState) => windowState.id === bonus.windowId)?.title ?? 'Current room'
      this.claimedAmbientBonusIds.add(bonus.id)
      this.bonusCollectionCount += 1

      if (bonus.scoreValue > 0) {
        this.addScoreReward(bonus.scoreValue)
      }
      if (bonus.chargeValue > 0) {
        this.addUtilityChargeReward(bonus.chargeValue)
      }
      if (bonus.timeValueMs > 0) {
        this.applyTimeBonus(now, bonus.timeValueMs)
      }
      this.addUpgradeCreditReward(this.getAmbientBonusCreditValue(bonus))

      this.note = `${roomTitle} ${this.getAmbientBonusRewardText(bonus)}`
    }
  }

  private applyTimeBonus(now: number, timeValueMs: number): void {
    if (timeValueMs <= 0) {
      return
    }

    if (this.currentLevelStartedAt !== null) {
      this.currentLevelStartedAt = Math.min(now, this.currentLevelStartedAt + timeValueMs)
      this.currentLevelElapsedMs = Math.max(0, now - this.currentLevelStartedAt)
      return
    }

    this.currentLevelElapsedMs = Math.max(0, this.currentLevelElapsedMs - timeValueMs)
  }

  private getAmbientBonusLabel(anchor: Pick<AmbientBonusAnchor, 'kind' | 'scoreValue' | 'chargeValue' | 'timeValueMs'>): string {
    if (anchor.kind === 'score') {
      return `+${anchor.scoreValue}`
    }

    if (anchor.kind === 'charge') {
      return `P+${anchor.chargeValue}`
    }

    return `-${formatBonusSeconds(anchor.timeValueMs)}S`
  }

  private getAmbientBonusCreditValue(bonus: Pick<AmbientBonusState, 'kind' | 'scoreValue' | 'chargeValue'>): number {
    if (bonus.kind === 'score') {
      return Math.max(1, bonus.scoreValue)
    }

    if (bonus.kind === 'charge') {
      return Math.max(1, bonus.chargeValue)
    }

    return 1
  }

  private getAmbientBonusRewardText(bonus: AmbientBonusState): string {
    if (bonus.kind === 'score') {
      return `score cache secured. +${bonus.scoreValue} score. +${this.getAmbientBonusCreditValue(bonus)} signal credit${this.getAmbientBonusCreditValue(bonus) === 1 ? '' : 's'}.`
    }

    if (bonus.kind === 'charge') {
      return `charge cache secured. +${bonus.chargeValue} utility charge${bonus.chargeValue === 1 ? '' : 's'}. +${this.getAmbientBonusCreditValue(bonus)} signal credit${this.getAmbientBonusCreditValue(bonus) === 1 ? '' : 's'}.`
    }

    return `time cache secured. -${formatDurationMsShort(bonus.timeValueMs)} from the clock. +${this.getAmbientBonusCreditValue(bonus)} signal credit.`
  }

  private startLevelTimer(now: number): void {
    this.currentLevelStartedAt = now
    this.currentLevelElapsedMs = 0
  }

  private captureLevelTimer(now: number): void {
    if (this.currentLevelStartedAt === null) {
      return
    }

    this.currentLevelElapsedMs = Math.max(0, now - this.currentLevelStartedAt)
    this.currentLevelStartedAt = null
  }

  private resumeLevelTimer(now: number): void {
    this.currentLevelStartedAt = now - this.currentLevelElapsedMs
  }

  private updateLevelTimer(now: number): void {
    if (this.currentLevelStartedAt === null) {
      return
    }

    this.currentLevelElapsedMs = Math.max(0, now - this.currentLevelStartedAt)
  }

  private resetLevelTimer(): void {
    this.currentLevelStartedAt = null
    this.currentLevelElapsedMs = 0
  }

  private getCurrentLevelTime(now: number): number {
    if (this.currentLevelStartedAt === null) {
      return this.currentLevelElapsedMs
    }

    this.currentLevelElapsedMs = Math.max(0, now - this.currentLevelStartedAt)
    return this.currentLevelElapsedMs
  }

  private recordBestLevelTime(level: number, timeMs: number): boolean {
    const previousBest = this.bestLevelTimesMs.get(level)
    if (previousBest !== undefined && previousBest <= timeMs) {
      return false
    }

    this.bestLevelTimesMs.set(level, timeMs)
    return true
  }

  private recordLevelPerformance(
    level: number,
    timeMs: number,
    difficulty: DifficultyLevel,
  ): {
    isBestTime: boolean
    currentMedal: MedalTier
    bestMedal: MedalTier
    isNewMedal: boolean
    medalScoreDelta: number
    utilityChargeDelta: number
    creditDelta: number
  } {
    const isBestTime = this.recordBestLevelTime(level, timeMs)
    const currentMedal = getMedalTierForTime(difficulty.medalThresholds, timeMs)
    const previousMedal = this.bestLevelMedals.get(level) ?? 'none'
    const isNewMedal = compareMedalTiers(currentMedal, previousMedal) > 0
    const bestMedal = isNewMedal ? currentMedal : previousMedal
    const medalScoreDelta = Math.max(0, getMedalScoreBonus(bestMedal) - getMedalScoreBonus(previousMedal))

    if (isNewMedal && bestMedal !== 'none') {
      this.bestLevelMedals.set(level, bestMedal)
    }

    return {
      isBestTime,
      currentMedal,
      bestMedal,
      isNewMedal,
      medalScoreDelta,
      utilityChargeDelta: medalScoreDelta,
      creditDelta: medalScoreDelta,
    }
  }

  private getMedalNote(
    performance: {
      currentMedal: MedalTier
      bestMedal: MedalTier
      isNewMedal: boolean
      medalScoreDelta: number
      utilityChargeDelta: number
    },
  ): string {
    if (performance.isNewMedal) {
      const label = capitalizeMedal(performance.bestMedal)
      if (performance.medalScoreDelta > 0) {
        return ` ${label} medal secured. +${performance.medalScoreDelta} score.`
      }

      return ` ${label} medal secured.`
    }

    if (performance.currentMedal === 'none') {
      return performance.bestMedal === 'none'
        ? ' No medal secured.'
        : ` ${capitalizeMedal(performance.bestMedal)} medal record stands.`
    }

    if (compareMedalTiers(performance.bestMedal, performance.currentMedal) > 0) {
      return ` ${capitalizeMedal(performance.currentMedal)} pace clear. ${capitalizeMedal(performance.bestMedal)} medal record stands.`
    }

    return ` ${capitalizeMedal(performance.bestMedal)} medal held.`
  }

  private getUtilityRewardNote(chargeDelta: number): string {
    if (chargeDelta <= 0) {
      return ''
    }

    return ` +${chargeDelta} utility charge${chargeDelta === 1 ? '' : 's'}.`
  }

  private getCreditRewardNote(creditDelta: number): string {
    if (creditDelta <= 0) {
      return ''
    }

    return ` +${creditDelta} signal credit${creditDelta === 1 ? '' : 's'}.`
  }

  private getBridgePulseRemainingMs(now: number): number {
    if (this.phase === 'paused' && this.pauseReason === 'focus') {
      return this.pausedBridgePulseRemainingMs
    }

    return this.bridgePulseEndsAt > now ? this.bridgePulseEndsAt - now : 0
  }

  private getTimeBrakeRemainingMs(now: number): number {
    if (this.phase === 'paused' && this.pauseReason === 'focus') {
      return this.pausedTimeBrakeRemainingMs
    }

    return this.timeBrakeEndsAt > now ? this.timeBrakeEndsAt - now : 0
  }

  private getEffectiveBlockedEdges(now: number): Map<string, WindowEdge[]> {
    return this.isBridgePulseActive(now) ? EMPTY_BLOCKED_EDGES : this.blockedEdges
  }

  private getActiveUtilityState(now = Date.now()): GameSnapshot['activeUtility'] {
    const bridgePulseRemainingMs = this.getBridgePulseRemainingMs(now)
    if (bridgePulseRemainingMs > 0) {
      return {
        kind: 'bridge_pulse',
        label: 'BRIDGE PULSE',
        shortLabel: 'PULSE',
        remainingMs: bridgePulseRemainingMs,
      }
    }

    const timeBrakeRemainingMs = this.getTimeBrakeRemainingMs(now)
    if (timeBrakeRemainingMs > 0) {
      return {
        kind: 'time_brake',
        label: 'TIME BRAKE',
        shortLabel: 'BRAKE',
        remainingMs: timeBrakeRemainingMs,
      }
    }

    return null
  }

  private isBridgePulseActive(now: number): boolean {
    return this.getBridgePulseRemainingMs(now) > 0
  }

  private isTimeBrakeActive(now: number): boolean {
    return this.getTimeBrakeRemainingMs(now) > 0
  }

  private getActiveSpeedScale(now: number): number {
    return this.isTimeBrakeActive(now) ? TIME_BRAKE_SPEED_SCALE : 1
  }

  private getRouteWindowStates(activeWindows: WindowState[]): RouteWindowState[] {
    const bridgeCount = Math.max(0, activeWindows.length - 2)
    const blockedEdgesSuppressed = this.isBridgePulseActive(Date.now())

    return activeWindows.map((windowState, index) => {
      const blockedEdges = [...(this.blockedEdges.get(windowState.id) ?? [])]

      if (index === 0) {
        return {
          id: windowState.id,
          role: 'start',
          order: 0,
          status: 'ready',
          blockedEdges,
          blockedEdgesSuppressed,
        }
      }

      if (index === activeWindows.length - 1) {
        return {
          id: windowState.id,
          role: 'goal',
          order: index,
          status: this.currentRouteStep >= bridgeCount ? 'active' : 'locked',
          blockedEdges,
          blockedEdgesSuppressed,
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
        blockedEdges,
        blockedEdgesSuppressed,
      }
    })
  }

  private getRoundIntro(activeWindows: WindowState[]): string {
    const startWindow = activeWindows[0]
    const firstBridge = activeWindows[1]
    const goalWindow = activeWindows[activeWindows.length - 1]
    const obstacleCount = this.getObstacles(activeWindows).filter((obstacle) => !obstacle.destroyed).length
    const sideLockCount = activeWindows.reduce((count, windowState) => count + (this.blockedEdges.get(windowState.id)?.length ?? 0), 0)
    const hazardSummary = [
      `${obstacleCount} barrier${obstacleCount === 1 ? '' : 's'}`,
      sideLockCount > 0 ? `${sideLockCount} side lock${sideLockCount === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ')

    return firstBridge
      ? `Level ${this.currentLevel} live. ${hazardSummary} online. Start in ${startWindow?.title ?? 'Window 1'}, link ${firstBridge.title} first, then route to ${goalWindow?.title ?? 'the goal'}.`
      : `Level ${this.currentLevel} live. ${hazardSummary} online. Route the signal to ${goalWindow?.title ?? 'the goal'}.`
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

  private isObjectiveVisible(activeTarget: TargetState, activeWindows: WindowState[]): boolean {
    return this.getObjectiveOccluders(activeTarget, activeWindows).length === 0
  }

  private getOccludedObjectiveNote(activeTarget: TargetState, activeWindows: WindowState[]): string {
    const targetWindow = activeWindows.find((windowState) => windowState.id === activeTarget.windowId)
    const [frontWindow] = this.getObjectiveOccluders(activeTarget, activeWindows)

    if (!targetWindow || !frontWindow || frontWindow.id === targetWindow.id) {
      return this.note
    }

    const objectiveLabel = activeTarget.kind === 'goal' ? 'Goal' : activeTarget.label
    return `${objectiveLabel} is masked by ${frontWindow.title}. Bring ${targetWindow.title} to the front to score it.`
  }

  private getObjectiveOccluders(activeTarget: TargetState, activeWindows: WindowState[]): WindowState[] {
    const targetWindow = activeWindows.find((windowState) => windowState.id === activeTarget.windowId)
    if (!targetWindow) {
      return []
    }

    const targetRank = this.getWindowFocusRank(targetWindow.id)

    return activeWindows
      .filter((windowState) =>
        windowState.id !== targetWindow.id
        && this.getWindowFocusRank(windowState.id) > targetRank
        && pointInRect(activeTarget.x, activeTarget.y, rectFromWindow(windowState)),
      )
      .sort((left, right) => this.getWindowFocusRank(right.id) - this.getWindowFocusRank(left.id))
  }

  private getWindowFocusRank(windowId: string): number {
    return this.windowFocusOrder.get(windowId) ?? 0
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

function rotateByOffset<T>(items: T[], offset: number): T[] {
  if (items.length <= 1) {
    return [...items]
  }

  const normalizedOffset = ((offset % items.length) + items.length) % items.length
  return [...items.slice(normalizedOffset), ...items.slice(0, normalizedOffset)]
}

function getSeededIndex(level: number, length: number, salt: number): number {
  if (length <= 0) {
    return 0
  }

  const raw = Math.sin((level * 12.9898) + (salt * 78.233)) * 43758.5453123
  const unit = raw - Math.floor(raw)
  return Math.floor(unit * length) % length
}

function formatDurationMs(durationMs: number): string {
  const totalTenths = Math.max(0, Math.round(durationMs / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  const tenths = totalTenths % 10

  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}

function formatDurationMsShort(durationMs: number): string {
  return `${formatBonusSeconds(durationMs)}s`
}

function formatBonusSeconds(durationMs: number): string {
  return (Math.max(0, durationMs) / 1000).toFixed(1)
}

function capitalizeMedal(tier: MedalTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1)
}

function isMedalTier(value: unknown): value is MedalTier {
  return value === 'none' || value === 'bronze' || value === 'silver' || value === 'gold'
}

function isCatchAttemptPayload(value: CatchAttemptPayload | undefined): value is CatchAttemptPayload {
  return !!value
    && true
    && Number.isFinite(value.worldX)
    && Number.isFinite(value.worldY)
}
