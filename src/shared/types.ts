export type GamePhase = 'idle' | 'waiting' | 'running' | 'paused'

export interface WindowBoundsPayload {
  id: string
  slot: number
  title: string
  x: number
  y: number
  width: number
  height: number
  contentX: number
  contentY: number
  contentWidth: number
  contentHeight: number
  visible: boolean
}

export interface WindowState extends WindowBoundsPayload {
  lastSeenAt: number
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface BallState {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  hue: number
  ownerWindowId: string | null
}

export interface GoalState {
  windowId: string
  x: number
  y: number
  radius: number
}

export type RouteWindowRole = 'start' | 'bridge' | 'goal'
export type RouteWindowStatus = 'ready' | 'active' | 'cleared' | 'locked'

export interface RouteWindowState {
  id: string
  role: RouteWindowRole
  order: number
  status: RouteWindowStatus
}

export interface TargetState extends GoalState {
  kind: 'bridge' | 'goal'
  label: string
}

export type TransitionDirection = 'left' | 'right' | 'up' | 'down'

export interface TransitionHint {
  sourceWindowId: string
  targetWindowId: string | null
  direction: TransitionDirection
  intensity: number
  exitX: number
  exitY: number
  entryX: number | null
  entryY: number | null
}

export interface DifficultyLevel {
  level: number
  requiredScore: number
  activeWindows: number
  speed: number
  radius: number
}

export interface PlayerProgressState {
  version: 1
  score: number
  bestStreak: number
  selectedLevel: number
  maxUnlockedLevel: number
  completedLevels: number[]
}

export interface GameSnapshot {
  tick: number
  phase: GamePhase
  campaignComplete: boolean
  score: number
  streak: number
  bestStreak: number
  selectedLevel: number
  maxUnlockedLevel: number
  completedLevels: number[]
  difficulty: DifficultyLevel
  availableWindowCount: number
  requiredWindowCount: number
  activeWindowIds: string[]
  startWindowId: string | null
  bridgeWindowIds: string[]
  completedBridgeWindowIds: string[]
  goalWindowId: string | null
  routeWindows: RouteWindowState[]
  activeTarget: TargetState | null
  windows: WindowState[]
  balls: BallState[]
  ball: BallState | null
  transitionHint: TransitionHint | null
  note: string
}
