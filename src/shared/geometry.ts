import { WINDOW_GRID_COLUMNS } from './constants'
import type { ObstacleState, Rect, WindowBoundsPayload, WindowEdge, WindowState } from './types'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function rectFromWindow(windowState: WindowBoundsPayload | WindowState): Rect {
  return {
    left: windowState.contentX,
    top: windowState.contentY,
    right: windowState.contentX + windowState.contentWidth,
    bottom: windowState.contentY + windowState.contentHeight,
    width: windowState.contentWidth,
    height: windowState.contentHeight,
  }
}

export function rectFromObstacle(obstacle: ObstacleState): Rect {
  return {
    left: obstacle.x,
    top: obstacle.y,
    right: obstacle.x + obstacle.width,
    bottom: obstacle.y + obstacle.height,
    width: obstacle.width,
    height: obstacle.height,
  }
}

export function overlapLength(minA: number, maxA: number, minB: number, maxB: number): number {
  return Math.min(maxA, maxB) - Math.max(minA, minB)
}

export function combineRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) {
    return null
  }

  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))

  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  }
}

export function pointInRect(x: number, y: number, rect: Rect): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
}

export function pointInObstacle(x: number, y: number, obstacles: ObstacleState[]): boolean {
  return obstacles
    .filter((obstacle) => !obstacle.destroyed)
    .some((obstacle) => pointInRect(x, y, rectFromObstacle(obstacle)))
}

export function pointInWindowUnion<T extends WindowBoundsPayload | WindowState>(
  x: number,
  y: number,
  windows: T[],
): boolean {
  return findContainingWindow(windows, x, y) !== null
}

export function rectsConnect(
  left: Rect,
  right: Rect,
  leftBlockedEdges: WindowEdge[] = [],
  rightBlockedEdges: WindowEdge[] = [],
  epsilon = 0.5,
): boolean {
  const connections = getRectConnectionEdges(left, right, epsilon)
  if (connections.length === 0) {
    return false
  }

  const hasBlockedConnection = connections.some((connection) =>
    leftBlockedEdges.includes(connection.left) || rightBlockedEdges.includes(connection.right),
  )

  return !hasBlockedConnection
}

export function getRectConnectionEdges(
  left: Rect,
  right: Rect,
  epsilon = 0.5,
): Array<{ left: WindowEdge; right: WindowEdge }> {
  const horizontalOverlap = overlapLength(left.left, left.right, right.left, right.right)
  const verticalOverlap = overlapLength(left.top, left.bottom, right.top, right.bottom)
  const connections: Array<{ left: WindowEdge; right: WindowEdge }> = []

  if (horizontalOverlap > 0 && verticalOverlap > 0) {
    if (right.left < left.left - epsilon) {
      connections.push({ left: 'left', right: 'right' })
    }
    if (right.right > left.right + epsilon) {
      connections.push({ left: 'right', right: 'left' })
    }
    if (right.top < left.top - epsilon) {
      connections.push({ left: 'up', right: 'down' })
    }
    if (right.bottom > left.bottom + epsilon) {
      connections.push({ left: 'down', right: 'up' })
    }

    if (connections.length > 0) {
      return connections
    }
  }

  if (horizontalOverlap > 0 && Math.abs(left.bottom - right.top) <= epsilon) {
    connections.push({
      left: 'down',
      right: 'up',
    })
  }

  if (horizontalOverlap > 0 && Math.abs(right.bottom - left.top) <= epsilon) {
    connections.push({
      left: 'up',
      right: 'down',
    })
  }

  if (verticalOverlap > 0 && Math.abs(left.right - right.left) <= epsilon) {
    connections.push({
      left: 'right',
      right: 'left',
    })
  }

  if (verticalOverlap > 0 && Math.abs(right.right - left.left) <= epsilon) {
    connections.push({
      left: 'left',
      right: 'right',
    })
  }

  return connections
}

export function getConnectedWindows<T extends WindowBoundsPayload | WindowState>(
  windows: T[],
  seedId: string,
  blockedEdgesByWindowId: Map<string, WindowEdge[]> = new Map(),
): T[] {
  const seed = windows.find((windowState) => windowState.id === seedId)
  if (!seed) {
    return []
  }

  const connected: T[] = []
  const queue: T[] = [seed]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.id)) {
      continue
    }

    visited.add(current.id)
    connected.push(current)

    const currentRect = rectFromWindow(current)
    for (const candidate of windows) {
      if (visited.has(candidate.id)) {
        continue
      }

      if (
        rectsConnect(
          currentRect,
          rectFromWindow(candidate),
          blockedEdgesByWindowId.get(current.id) ?? [],
          blockedEdgesByWindowId.get(candidate.id) ?? [],
        )
      ) {
        queue.push(candidate)
      }
    }
  }

  return sortWindowsBySlot(connected)
}

export function pointInCircle(
  pointX: number,
  pointY: number,
  centerX: number,
  centerY: number,
  radius: number,
): boolean {
  const dx = pointX - centerX
  const dy = pointY - centerY
  return (dx * dx) + (dy * dy) <= radius * radius
}

export function circleIntersectsRect(centerX: number, centerY: number, radius: number, rect: Rect): boolean {
  const closestX = clamp(centerX, rect.left, rect.right)
  const closestY = clamp(centerY, rect.top, rect.bottom)
  const dx = centerX - closestX
  const dy = centerY - closestY

  return (dx * dx) + (dy * dy) <= radius * radius
}

export function sortWindowsBySlot<T extends WindowBoundsPayload | WindowState>(windows: T[]): T[] {
  return [...windows].sort((left, right) => left.slot - right.slot)
}

export function buildWorldRects<T extends WindowBoundsPayload | WindowState>(windows: T[]): Map<string, Rect> {
  const rects = new Map<string, Rect>()
  if (windows.length === 0) {
    return rects
  }

  const cellWidth = Math.max(1, Math.min(...windows.map((windowState) => windowState.contentWidth)))
  const cellHeight = Math.max(1, Math.min(...windows.map((windowState) => windowState.contentHeight)))

  for (const windowState of windows) {
    const column = windowState.slot % WINDOW_GRID_COLUMNS
    const row = Math.floor(windowState.slot / WINDOW_GRID_COLUMNS)
    const left = column * cellWidth
    const top = row * cellHeight

    rects.set(windowState.id, {
      left,
      top,
      right: left + cellWidth,
      bottom: top + cellHeight,
      width: cellWidth,
      height: cellHeight,
    })
  }

  return rects
}

export function findContainingWindow<T extends WindowBoundsPayload | WindowState>(
  windows: T[],
  x: number,
  y: number,
): T | null {
  return windows.find((windowState) => pointInRect(x, y, rectFromWindow(windowState))) ?? null
}

export function findContainingWorldWindow<T extends WindowBoundsPayload | WindowState>(
  windows: T[],
  worldRects: Map<string, Rect>,
  x: number,
  y: number,
): T | null {
  return windows.find((windowState) => {
    const rect = worldRects.get(windowState.id)
    return rect ? pointInRect(x, y, rect) : false
  }) ?? null
}

export function sample<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}
