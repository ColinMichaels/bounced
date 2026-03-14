import '../styles/app.css'

import { BOUNDS_HEARTBEAT_MS } from '../shared/constants'
import { createGameChannelName, openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, WindowBoundsPayload } from '../shared/types'
import { BallRenderer } from './renderer'

interface LayoutHint {
  contentWidth: number
  contentHeight: number
}

interface LockedRoomSize {
  shellWidth: number
  shellHeight: number
  appWidth: number
  appHeight: number
  canvasWidth: number
  canvasHeight: number
}

interface ChromeInsets {
  width: number
  height: number
}

const search = new URLSearchParams(window.location.search)
const sessionId = search.get('session') ?? 'default'
const channelName = search.get('channel') ?? createGameChannelName(sessionId)
const windowId = search.get('id') ?? `play-window-${Math.random().toString(36).slice(2, 8)}`
const slot = Number(search.get('slot') ?? '0')
const title = search.get('title') ?? `Room ${slot + 1}`
const roomLabel = String(slot + 1).padStart(2, '0')
const initialTargetContentWidth = Number(search.get('targetWidth') ?? '0')
const initialTargetContentHeight = Number(search.get('targetHeight') ?? '0')

const titleElement = must<HTMLElement>('window-title')
const statusElement = must<HTMLElement>('client-status')
const clientApp = must<HTMLElement>('client-app')
const canvas = must<HTMLCanvasElement>('game-canvas')
const canvasFrame = must<HTMLElement>('canvas-frame')
const DRAW_FRAME_INTERVAL_MS = 1000 / 30
const WINDOW_SIZE_SYNC_MAX_ATTEMPTS = 6
const VIEWPORT_SETTLE_TOLERANCE_PX = 14

titleElement.textContent = roomLabel
document.title = title

const renderer = new BallRenderer(canvas)
const channel = openGameChannel(channelName, handleMessage)
const resizeObserver = new ResizeObserver(() => {
  reportBounds()
})

let snapshot: GameSnapshot | null = null
let bounds: WindowBoundsPayload | null = null
let layoutHint: LayoutHint | null = initialTargetContentWidth > 0 && initialTargetContentHeight > 0
  ? {
      contentWidth: Math.round(initialTargetContentWidth),
      contentHeight: Math.round(initialTargetContentHeight),
    }
  : null
let chromeInsets: ChromeInsets | null = null
let lockedLayoutKey: string | null = null
let pendingLayoutKey: string | null = null
let drawFrameId = 0
let lastDrawAt = 0

channel.post({
  type: 'register_window',
  payload: {
    id: windowId,
    slot,
    title,
  },
})
channel.post({
  type: 'request_sync',
  payload: {
    id: windowId,
  },
})

reportBounds()
window.requestAnimationFrame(reportBounds)
const heartbeat = window.setInterval(reportBounds, BOUNDS_HEARTBEAT_MS)

window.addEventListener('pointerdown', handlePointerDown, { capture: true })
window.addEventListener('resize', reportBounds)
window.addEventListener('focus', reportBounds)
document.addEventListener('visibilitychange', reportBounds)
canvas.addEventListener('click', handleCanvasClick)
resizeObserver.observe(canvasFrame)

window.addEventListener('beforeunload', () => {
  window.clearInterval(heartbeat)
  resizeObserver.disconnect()
  channel.post({
    type: 'unregister_window',
    payload: {
      id: windowId,
    },
  })
  channel.close()
})

function handleMessage(message: GameMessage): void {
  if (message.type === 'layout_hint') {
    if (message.payload.id !== windowId) {
      return
    }

    layoutHint = {
      contentWidth: Math.round(message.payload.contentWidth),
      contentHeight: Math.round(message.payload.contentHeight),
    }

    if (snapshot) {
      syncCanvasLock(snapshot)
    }

    return
  }

  if (message.type === 'snapshot') {
    snapshot = message.payload
    syncCanvasLock(snapshot)
    statusElement.textContent = getStatusText(snapshot, bounds)
    scheduleDraw()
  }
}

function reportBounds(): void {
  bounds = measureWindow()
  channel.post({
    type: 'window_bounds',
    payload: bounds,
  })
  scheduleDraw()
}

function requestClusterRecall(): void {
  channel.post({
    type: 'focus_windows',
    payload: {
      preferredId: windowId,
    },
  })
}

function handlePointerDown(): void {
  requestClusterRecall()
}

function scheduleDraw(): void {
  if (drawFrameId !== 0) {
    return
  }

  drawFrameId = window.requestAnimationFrame(draw)
}

function draw(now: number): void {
  drawFrameId = 0

  if (now - lastDrawAt < DRAW_FRAME_INTERVAL_MS) {
    scheduleDraw()
    return
  }

  lastDrawAt = now
  renderer.draw(snapshot, bounds)

  if (renderer.shouldAnimate(snapshot, bounds)) {
    scheduleDraw()
  }
}

function syncCanvasLock(snapshot: GameSnapshot): void {
  const nextLayoutKey = getLayoutLockKey(snapshot)
  if (nextLayoutKey === lockedLayoutKey || nextLayoutKey === pendingLayoutKey) {
    return
  }

  pendingLayoutKey = nextLayoutKey
  releaseLockedRoomSize()

  // Reset to fill mode first so a host-triggered relayout can establish the new baseline.
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  reportBounds()

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const roomSize = getTargetRoomSize()
      if (!roomSize) {
        pendingLayoutKey = null
        reportBounds()
        return
      }

      applyLockedRoomSize(roomSize)
      syncOuterWindowSize(roomSize, () => {
        applyLockedRoomSize(getSettledRoomSize(roomSize))
        lockedLayoutKey = nextLayoutKey
        pendingLayoutKey = null
        reportBounds()
      })
    })
  })
}

function releaseLockedRoomSize(): void {
  document.documentElement.style.minWidth = ''
  document.documentElement.style.minHeight = ''
  document.documentElement.style.maxWidth = ''
  document.documentElement.style.maxHeight = ''
  document.documentElement.style.width = ''
  document.documentElement.style.height = ''
  document.body.style.minWidth = ''
  document.body.style.minHeight = ''
  document.body.style.maxWidth = ''
  document.body.style.maxHeight = ''
  document.body.style.width = ''
  document.body.style.height = ''
  clientApp.style.minWidth = ''
  clientApp.style.minHeight = ''
  clientApp.style.maxWidth = ''
  clientApp.style.maxHeight = ''
  clientApp.style.width = ''
  clientApp.style.height = ''
  canvasFrame.style.minWidth = ''
  canvasFrame.style.minHeight = ''
  canvasFrame.style.maxWidth = ''
  canvasFrame.style.maxHeight = ''
  canvasFrame.style.width = ''
  canvasFrame.style.height = ''
  canvas.style.minWidth = ''
  canvas.style.minHeight = ''
  canvas.style.maxWidth = ''
  canvas.style.maxHeight = ''
  canvas.style.width = ''
  canvas.style.height = ''
}

function getLayoutLockKey(snapshot: GameSnapshot): string {
  const hintWidth = layoutHint?.contentWidth ?? Math.round(canvasFrame.clientWidth)
  const hintHeight = layoutHint?.contentHeight ?? Math.round(canvasFrame.clientHeight)

  return `${snapshot.selectedLevel}:${snapshot.requiredWindowCount}:${hintWidth}x${hintHeight}`
}

function getTargetRoomSize(): LockedRoomSize | null {
  const canvasWidth = Math.max(
    120,
    Math.round(layoutHint?.contentWidth ?? canvasFrame.clientWidth ?? canvas.clientWidth),
  )
  const canvasHeight = Math.max(
    96,
    Math.round(layoutHint?.contentHeight ?? canvasFrame.clientHeight ?? canvas.clientHeight),
  )
  const shellStyles = window.getComputedStyle(document.body)
  const shellPaddingX = Math.ceil(
    parseFloat(shellStyles.paddingLeft || '0')
    + parseFloat(shellStyles.paddingRight || '0'),
  )
  const shellPaddingY = Math.ceil(
    parseFloat(shellStyles.paddingTop || '0')
    + parseFloat(shellStyles.paddingBottom || '0'),
  )
  const shellWidth = Math.max(180, canvasWidth + shellPaddingX)
  const shellHeight = Math.max(140, canvasHeight + shellPaddingY)
  const appWidth = canvasWidth
  const appHeight = canvasHeight

  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return null
  }

  return {
    shellWidth,
    shellHeight,
    appWidth,
    appHeight,
    canvasWidth,
    canvasHeight,
  }
}

function applyLockedRoomSize(roomSize: LockedRoomSize): void {
  document.documentElement.style.minWidth = `${roomSize.shellWidth}px`
  document.documentElement.style.minHeight = `${roomSize.shellHeight}px`
  document.documentElement.style.maxWidth = `${roomSize.shellWidth}px`
  document.documentElement.style.maxHeight = `${roomSize.shellHeight}px`
  document.documentElement.style.width = `${roomSize.shellWidth}px`
  document.documentElement.style.height = `${roomSize.shellHeight}px`
  document.body.style.minWidth = `${roomSize.shellWidth}px`
  document.body.style.minHeight = `${roomSize.shellHeight}px`
  document.body.style.maxWidth = `${roomSize.shellWidth}px`
  document.body.style.maxHeight = `${roomSize.shellHeight}px`
  document.body.style.width = `${roomSize.shellWidth}px`
  document.body.style.height = `${roomSize.shellHeight}px`
  clientApp.style.minWidth = `${roomSize.appWidth}px`
  clientApp.style.minHeight = `${roomSize.appHeight}px`
  clientApp.style.maxWidth = `${roomSize.appWidth}px`
  clientApp.style.maxHeight = `${roomSize.appHeight}px`
  clientApp.style.width = `${roomSize.appWidth}px`
  clientApp.style.height = `${roomSize.appHeight}px`
  canvasFrame.style.minWidth = `${roomSize.canvasWidth}px`
  canvasFrame.style.minHeight = `${roomSize.canvasHeight}px`
  canvasFrame.style.maxWidth = `${roomSize.canvasWidth}px`
  canvasFrame.style.maxHeight = `${roomSize.canvasHeight}px`
  canvasFrame.style.width = `${roomSize.canvasWidth}px`
  canvasFrame.style.height = `${roomSize.canvasHeight}px`
  canvas.style.minWidth = `${roomSize.canvasWidth}px`
  canvas.style.minHeight = `${roomSize.canvasHeight}px`
  canvas.style.maxWidth = `${roomSize.canvasWidth}px`
  canvas.style.maxHeight = `${roomSize.canvasHeight}px`
  canvas.style.width = `${roomSize.canvasWidth}px`
  canvas.style.height = `${roomSize.canvasHeight}px`
}

function getSettledRoomSize(roomSize: LockedRoomSize): LockedRoomSize {
  const shellStyles = window.getComputedStyle(document.body)
  const shellPaddingX = Math.ceil(
    parseFloat(shellStyles.paddingLeft || '0')
    + parseFloat(shellStyles.paddingRight || '0'),
  )
  const shellPaddingY = Math.ceil(
    parseFloat(shellStyles.paddingTop || '0')
    + parseFloat(shellStyles.paddingBottom || '0'),
  )
  const viewportWidth = Math.round(window.innerWidth)
  const viewportHeight = Math.round(window.innerHeight)
  const shellWidth = Math.abs(viewportWidth - roomSize.shellWidth) <= VIEWPORT_SETTLE_TOLERANCE_PX
    ? viewportWidth
    : roomSize.shellWidth
  const shellHeight = Math.abs(viewportHeight - roomSize.shellHeight) <= VIEWPORT_SETTLE_TOLERANCE_PX
    ? viewportHeight
    : roomSize.shellHeight
  const appWidth = Math.max(120, shellWidth - shellPaddingX)
  const appHeight = Math.max(96, shellHeight - shellPaddingY)

  return {
    shellWidth,
    shellHeight,
    appWidth,
    appHeight,
    canvasWidth: appWidth,
    canvasHeight: appHeight,
  }
}

function syncOuterWindowSize(
  roomSize: LockedRoomSize,
  onSettled: () => void,
  attempt = 0,
): void {
  const targetChromeInsets = measureChromeInsets()
  const targetOuterWidth = roomSize.shellWidth + targetChromeInsets.width
  const targetOuterHeight = roomSize.shellHeight + targetChromeInsets.height
  const widthSettled = Math.abs(window.outerWidth - targetOuterWidth) <= 1
  const heightSettled = Math.abs(window.outerHeight - targetOuterHeight) <= 1

  if (widthSettled && heightSettled) {
    onSettled()
    return
  }

  try {
    window.resizeTo(targetOuterWidth, targetOuterHeight)
  } catch {
    // Ignore blocked resize attempts.
  }

  if (attempt >= WINDOW_SIZE_SYNC_MAX_ATTEMPTS) {
    onSettled()
    return
  }

  window.requestAnimationFrame(() => {
    syncOuterWindowSize(roomSize, onSettled, attempt + 1)
  })
}

function measureWindow(): WindowBoundsPayload {
  const canvasRect = canvas.getBoundingClientRect()
  const currentChromeInsets = measureChromeInsets()
  const frameInset = currentChromeInsets.width / 2
  const verticalChrome = currentChromeInsets.height
  const contentOriginX = window.screenX + frameInset
  const contentOriginY = window.screenY + Math.max(0, verticalChrome - frameInset)

  return {
    id: windowId,
    slot,
    title,
    x: window.screenX,
    y: window.screenY,
    width: window.outerWidth,
    height: window.outerHeight,
    contentX: contentOriginX + canvasRect.left,
    contentY: contentOriginY + canvasRect.top,
    contentWidth: pendingLayoutKey ? 0 : canvasRect.width,
    contentHeight: pendingLayoutKey ? 0 : canvasRect.height,
    visible: !document.hidden,
  }
}

function measureChromeInsets(): ChromeInsets {
  const currentInsets = {
    width: Math.max(0, Math.round(window.outerWidth - window.innerWidth)),
    height: Math.max(0, Math.round(window.outerHeight - window.innerHeight)),
  }

  if (!chromeInsets) {
    chromeInsets = currentInsets
    return chromeInsets
  }

  chromeInsets = {
    width: chromeInsets.width > 0 ? chromeInsets.width : currentInsets.width,
    height: chromeInsets.height > 0 ? chromeInsets.height : currentInsets.height,
  }

  return chromeInsets
}

function handleCanvasClick(event: MouseEvent): void {
  if (!bounds) {
    return
  }

  const rect = canvas.getBoundingClientRect()
  const localX = event.clientX - rect.left
  const localY = event.clientY - rect.top

  channel.post({
    type: 'catch_attempt',
    payload: {
      id: windowId,
      localX,
      localY,
      worldX: bounds.contentX + localX,
      worldY: bounds.contentY + localY,
      tick: snapshot?.tick ?? 0,
    },
  })
}

function getStatusText(snapshot: GameSnapshot, bounds: WindowBoundsPayload | null): string {
  if (!bounds) {
    return getPhaseLabel(snapshot)
  }

  const isActive = snapshot.activeWindowIds.includes(bounds.id)
  if (!isActive) {
    return 'STANDBY'
  }

  const routeWindow = snapshot.routeWindows.find((windowState) => windowState.id === bounds.id)
  if (!routeWindow) {
    return getPhaseLabel(snapshot)
  }

  const liveObstacleCount = snapshot.obstacles.filter((obstacle) => obstacle.windowId === bounds.id && !obstacle.destroyed).length
  const roomBonusCount = snapshot.ambientBonuses.filter((bonus) => bonus.windowId === bounds.id).length
    + (snapshot.activeScoreNode?.windowId === bounds.id ? 1 : 0)
  const sideLockCount = routeWindow.blockedEdges.length
  const utilitySuffix = snapshot.activeUtility ? ' · PULSE' : ''
  const barrierSuffix = liveObstacleCount > 0
    ? ` · ${liveObstacleCount} BARRIER${liveObstacleCount === 1 ? '' : 'S'}`
    : ''
  const sideLockSuffix = sideLockCount > 0
    ? ` · ${sideLockCount} SIDE LOCK${sideLockCount === 1 ? '' : 'S'}${routeWindow.blockedEdgesSuppressed ? ' OPEN' : ''}`
    : ''
  const scoreSuffix = roomBonusCount <= 0
    ? ''
    : roomBonusCount === 1
      ? ' · BONUS LIVE'
      : ` · BONUS x${roomBonusCount}`

  if (routeWindow.role === 'start') {
    return snapshot.activeTarget?.kind === 'bridge'
      ? `START -> ${snapshot.activeTarget.label}${sideLockSuffix}${utilitySuffix}`
      : `START -> GOAL${sideLockSuffix}${utilitySuffix}`
  }

  if (routeWindow.role === 'bridge') {
    const relayLabel = `RELAY ${routeWindow.order + 1}`

    if (routeWindow.status === 'active') {
      return `${relayLabel} LIVE${barrierSuffix}${sideLockSuffix}${scoreSuffix}${utilitySuffix}`
    }

    if (routeWindow.status === 'cleared') {
      return `${relayLabel} CLEAR${sideLockSuffix}${utilitySuffix}`
    }

    return `${relayLabel} LOCKED${sideLockSuffix}${utilitySuffix}`
  }

  if (snapshot.goalWindowId === bounds.id) {
    return routeWindow.status === 'active'
      ? `GOAL LIVE${barrierSuffix}${sideLockSuffix}${utilitySuffix}`
      : `GOAL LOCKED${sideLockSuffix}${utilitySuffix}`
  }

  return getPhaseLabel(snapshot)
}

function getPhaseLabel(snapshot: GameSnapshot): string {
  if (snapshot.phase === 'idle') {
    return 'OFFLINE'
  }

  if (snapshot.phase === 'waiting') {
    return 'SYNC'
  }

  if (snapshot.phase === 'paused') {
    return 'PAUSED'
  }

  return 'LIVE'
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing client element: ${id}`)
  }

  return element as T
}
