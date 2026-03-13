import { TRANSITION_HINT_LOOKAHEAD_MS } from '../shared/constants'
import { circleIntersectsRect, clamp, pointInWindowUnion, rectFromObstacle, rectFromWindow, sample } from '../shared/geometry'
import type { BallState, DifficultyLevel, ObstacleState, Rect, TransitionDirection, TransitionHint, WindowState } from '../shared/types'

const MAX_SUBSTEP_DISTANCE = 6
const BALL_FIT_SAMPLE_ANGLES = [
  0,
  Math.PI * 0.25,
  Math.PI * 0.5,
  Math.PI * 0.75,
  Math.PI,
  Math.PI * 1.25,
  Math.PI * 1.5,
  Math.PI * 1.75,
]

export function advanceBall(
  ball: BallState,
  windows: WindowState[],
  obstacles: ObstacleState[],
  deltaMs: number,
): BallState {
  if (windows.length === 0) {
    return ball
  }

  const distance = Math.hypot(ball.vx, ball.vy) * (deltaMs / 1000)
  const stepCount = Math.max(1, Math.ceil(distance / MAX_SUBSTEP_DISTANCE))
  const stepSeconds = (deltaMs / 1000) / stepCount

  let nextBall = { ...ball }

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex += 1) {
    nextBall = advanceBallStep(nextBall, windows, obstacles, stepSeconds)
  }

  return nextBall
}

export function retuneBall(ball: BallState, difficulty: DifficultyLevel): BallState {
  const speed = Math.hypot(ball.vx, ball.vy) || 1
  const scale = difficulty.speed / speed

  return {
    ...ball,
    radius: difficulty.radius,
    vx: ball.vx * scale,
    vy: ball.vy * scale,
  }
}

export function createBall(
  windows: WindowState[],
  difficulty: DifficultyLevel,
  obstacles: ObstacleState[] = [],
): BallState {
  const spawnWindow = sample(windows)
  const spawnRect = rectFromWindow(spawnWindow)
  const margin = difficulty.radius + 22
  const minX = spawnRect.left + margin
  const maxX = spawnRect.right - margin
  const minY = spawnRect.top + margin
  const maxY = spawnRect.bottom - margin

  const angle = randomReadableAngle()
  let x = clamp(randomBetween(minX, maxX), minX, maxX)
  let y = clamp(randomBetween(minY, maxY), minY, maxY)

  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (ballFitsInPlayfield(x, y, difficulty.radius, windows, obstacles)) {
      break
    }

    x = clamp(randomBetween(minX, maxX), minX, maxX)
    y = clamp(randomBetween(minY, maxY), minY, maxY)
  }

  return {
    id: `ball-${Math.random().toString(36).slice(2, 10)}`,
    x,
    y,
    vx: Math.cos(angle) * difficulty.speed,
    vy: Math.sin(angle) * difficulty.speed,
    radius: difficulty.radius,
    hue: Math.floor(randomBetween(18, 48)),
    ownerWindowId: spawnWindow.id,
  }
}

export function stabilizeBall(ball: BallState, windows: WindowState[], obstacles: ObstacleState[]): BallState {
  if (windows.length === 0) {
    return ball
  }

  if (ballFitsInPlayfield(ball.x, ball.y, ball.radius, windows, obstacles)) {
    return ball
  }

  const ownerWindow = windows.find((windowState) => windowState.id === ball.ownerWindowId) ?? windows[0]
  const rect = rectFromWindow(ownerWindow)
  const margin = ball.radius + 1
  let x = clamp(ball.x, rect.left + margin, rect.right - margin)
  let y = clamp(ball.y, rect.top + margin, rect.bottom - margin)

  if (ballFitsInPlayfield(x, y, ball.radius, windows, obstacles)) {
    return {
      ...ball,
      x,
      y,
      ownerWindowId: ownerWindow.id,
    }
  }

  for (let attempt = 0; attempt < 28; attempt += 1) {
    x = clamp(randomBetween(rect.left + margin, rect.right - margin), rect.left + margin, rect.right - margin)
    y = clamp(randomBetween(rect.top + margin, rect.bottom - margin), rect.top + margin, rect.bottom - margin)

    if (ballFitsInPlayfield(x, y, ball.radius, [ownerWindow], obstaclesForWindow(ownerWindow.id, obstacles))) {
      return {
        ...ball,
        x,
        y,
        ownerWindowId: ownerWindow.id,
      }
    }
  }

  return {
    ...ball,
    x,
    y,
    ownerWindowId: ownerWindow.id,
  }
}

export function getTransitionHint(
  ball: BallState | null,
  windows: WindowState[],
  lookaheadMs = TRANSITION_HINT_LOOKAHEAD_MS,
): TransitionHint | null {
  if (!ball?.ownerWindowId) {
    return null
  }

  const sourceWindow = windows.find((windowState) => windowState.id === ball.ownerWindowId)
  if (!sourceWindow) {
    return null
  }

  const sourceRect = rectFromWindow(sourceWindow)
  const exit = findExitCandidate(ball, sourceRect)
  if (!exit) {
    return null
  }

  const exitMs = exit.timeSeconds * 1000
  if (exitMs > lookaheadMs) {
    return null
  }

  const target = findNextWindowAlongRay(ball, windows, sourceWindow.id, exit.timeSeconds)

  return {
    sourceWindowId: sourceWindow.id,
    targetWindowId: target?.id ?? null,
    direction: exit.direction,
    intensity: clamp(1 - (exitMs / lookaheadMs), 0, 1),
    exitX: exit.x,
    exitY: exit.y,
    entryX: target?.entryX ?? null,
    entryY: target?.entryY ?? null,
  }
}

interface ExitCandidate {
  direction: TransitionDirection
  timeSeconds: number
  x: number
  y: number
}

function findExitCandidate(ball: BallState, rect: Rect): ExitCandidate | null {
  const candidates: ExitCandidate[] = []

  if (ball.vx > 0) {
    const timeSeconds = (rect.right - ball.radius - ball.x) / ball.vx
    if (Number.isFinite(timeSeconds) && timeSeconds >= 0) {
      candidates.push({
        direction: 'right',
        timeSeconds,
        x: rect.right,
        y: clamp(ball.y + (ball.vy * timeSeconds), rect.top + ball.radius, rect.bottom - ball.radius),
      })
    }
  }

  if (ball.vx < 0) {
    const timeSeconds = (rect.left + ball.radius - ball.x) / ball.vx
    if (Number.isFinite(timeSeconds) && timeSeconds >= 0) {
      candidates.push({
        direction: 'left',
        timeSeconds,
        x: rect.left,
        y: clamp(ball.y + (ball.vy * timeSeconds), rect.top + ball.radius, rect.bottom - ball.radius),
      })
    }
  }

  if (ball.vy > 0) {
    const timeSeconds = (rect.bottom - ball.radius - ball.y) / ball.vy
    if (Number.isFinite(timeSeconds) && timeSeconds >= 0) {
      candidates.push({
        direction: 'down',
        timeSeconds,
        x: clamp(ball.x + (ball.vx * timeSeconds), rect.left + ball.radius, rect.right - ball.radius),
        y: rect.bottom,
      })
    }
  }

  if (ball.vy < 0) {
    const timeSeconds = (rect.top + ball.radius - ball.y) / ball.vy
    if (Number.isFinite(timeSeconds) && timeSeconds >= 0) {
      candidates.push({
        direction: 'up',
        timeSeconds,
        x: clamp(ball.x + (ball.vx * timeSeconds), rect.left + ball.radius, rect.right - ball.radius),
        y: rect.top,
      })
    }
  }

  if (candidates.length === 0) {
    return null
  }

  return candidates.reduce((soonest, candidate) =>
    candidate.timeSeconds < soonest.timeSeconds ? candidate : soonest,
  )
}

function findNextWindowAlongRay(
  ball: BallState,
  windows: WindowState[],
  sourceWindowId: string,
  exitTimeSeconds: number,
): { id: string; entryX: number; entryY: number } | null {
  let nextWindow: { id: string; entryTimeSeconds: number; entryX: number; entryY: number } | null = null

  for (const windowState of windows) {
    if (windowState.id === sourceWindowId) {
      continue
    }

    const rect = rectFromWindow(windowState)
    const entryTimeSeconds = getRayRectEntryTime(ball.x, ball.y, ball.vx, ball.vy, rect)
    if (entryTimeSeconds === null || entryTimeSeconds <= exitTimeSeconds + 0.001) {
      continue
    }

    if (!nextWindow || entryTimeSeconds < nextWindow.entryTimeSeconds) {
      nextWindow = {
        id: windowState.id,
        entryTimeSeconds,
        entryX: clamp(ball.x + (ball.vx * entryTimeSeconds), rect.left, rect.right),
        entryY: clamp(ball.y + (ball.vy * entryTimeSeconds), rect.top, rect.bottom),
      }
    }
  }

  return nextWindow
}

function getRayRectEntryTime(
  originX: number,
  originY: number,
  velocityX: number,
  velocityY: number,
  rect: Rect,
): number | null {
  const xRange = getAxisEntryRange(originX, velocityX, rect.left, rect.right)
  if (!xRange) {
    return null
  }

  const yRange = getAxisEntryRange(originY, velocityY, rect.top, rect.bottom)
  if (!yRange) {
    return null
  }

  const start = Math.max(0, xRange.start, yRange.start)
  const end = Math.min(xRange.end, yRange.end)

  return end >= start ? start : null
}

function getAxisEntryRange(
  origin: number,
  velocity: number,
  min: number,
  max: number,
): { start: number; end: number } | null {
  if (velocity === 0) {
    if (origin < min || origin > max) {
      return null
    }

    return {
      start: 0,
      end: Number.POSITIVE_INFINITY,
    }
  }

  const first = (min - origin) / velocity
  const second = (max - origin) / velocity

  return {
    start: Math.min(first, second),
    end: Math.max(first, second),
  }
}

function advanceBallStep(
  ball: BallState,
  windows: WindowState[],
  obstacles: ObstacleState[],
  stepSeconds: number,
): BallState {
  const deltaX = ball.vx * stepSeconds
  const deltaY = ball.vy * stepSeconds
  const moveX = ball.x + deltaX
  const moveY = ball.y + deltaY

  if (ballFitsInPlayfield(moveX, moveY, ball.radius, windows, obstacles)) {
    return {
      ...ball,
      x: moveX,
      y: moveY,
    }
  }

  const canMoveX = ballFitsInPlayfield(moveX, ball.y, ball.radius, windows, obstacles)
  const canMoveY = ballFitsInPlayfield(ball.x, moveY, ball.radius, windows, obstacles)

  if (canMoveX && !canMoveY) {
    return {
      ...ball,
      x: moveX,
      vy: -ball.vy,
    }
  }

  if (!canMoveX && canMoveY) {
    return {
      ...ball,
      y: moveY,
      vx: -ball.vx,
    }
  }

  return {
    ...ball,
    vx: canMoveX || canMoveY ? -ball.vx : -ball.vx,
    vy: canMoveX || canMoveY ? -ball.vy : -ball.vy,
  }
}

function ballFitsInPlayfield(
  x: number,
  y: number,
  radius: number,
  windows: WindowState[],
  obstacles: ObstacleState[],
): boolean {
  if (!pointInWindowUnion(x, y, windows)) {
    return false
  }

  if (ballIntersectsObstacle(x, y, radius, obstacles)) {
    return false
  }

  return BALL_FIT_SAMPLE_ANGLES.every((angle) => {
    const sampleX = x + (Math.cos(angle) * radius)
    const sampleY = y + (Math.sin(angle) * radius)

    return (
      pointInWindowUnion(sampleX, sampleY, windows)
      && !ballIntersectsObstacle(sampleX, sampleY, 1, obstacles)
    )
  })
}

function ballIntersectsObstacle(x: number, y: number, radius: number, obstacles: ObstacleState[]): boolean {
  return obstacles
    .filter((obstacle) => !obstacle.destroyed)
    .some((obstacle) => circleIntersectsRect(x, y, radius, rectFromObstacle(obstacle)))
}

function obstaclesForWindow(windowId: string, obstacles: ObstacleState[]): ObstacleState[] {
  return obstacles.filter((obstacle) => obstacle.windowId === windowId && !obstacle.destroyed)
}

function randomReadableAngle(): number {
  const baseAngles = [
    Math.PI / 5,
    (2 * Math.PI) / 5,
    (3 * Math.PI) / 5,
    (4 * Math.PI) / 5,
    (6 * Math.PI) / 5,
    (7 * Math.PI) / 5,
    (8 * Math.PI) / 5,
    (9 * Math.PI) / 5,
  ]

  return sample(baseAngles)
}

function randomBetween(min: number, max: number): number {
  return min + (Math.random() * Math.max(1, max - min))
}
