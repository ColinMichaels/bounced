import '../styles/app.css'

import { BOUNDS_HEARTBEAT_MS } from '../shared/constants'
import { createGameChannelName, openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, WindowBoundsPayload } from '../shared/types'
import { BallRenderer } from './renderer'

const search = new URLSearchParams(window.location.search)
const sessionId = search.get('session') ?? 'default'
const channelName = search.get('channel') ?? createGameChannelName(sessionId)
const windowId = search.get('id') ?? `play-window-${Math.random().toString(36).slice(2, 8)}`
const slot = Number(search.get('slot') ?? '0')
const title = search.get('title') ?? `Room ${slot + 1}`
const roomLabel = String(slot + 1).padStart(2, '0')

const titleElement = must<HTMLElement>('window-title')
const statusElement = must<HTMLElement>('client-status')
const clientApp = must<HTMLElement>('client-app')
const clientHeader = must<HTMLElement>('client-header')
const canvas = must<HTMLCanvasElement>('game-canvas')
const canvasFrame = must<HTMLElement>('canvas-frame')

titleElement.textContent = roomLabel
document.title = title

const renderer = new BallRenderer(canvas)
const channel = openGameChannel(channelName, handleMessage)
const resizeObserver = new ResizeObserver(() => {
  reportBounds()
})

let snapshot: GameSnapshot | null = null
let bounds: WindowBoundsPayload | null = null
let lockedLayoutKey: string | null = null
let pendingLayoutKey: string | null = null

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

window.addEventListener('pointerdown', requestClusterRecall, { capture: true })
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

window.requestAnimationFrame(draw)

function draw(): void {
  renderer.draw(snapshot, bounds)
  window.requestAnimationFrame(draw)
}

function handleMessage(message: GameMessage): void {
  if (message.type !== 'snapshot') {
    return
  }

  snapshot = message.payload
  syncCanvasLock(snapshot)
  statusElement.textContent = getStatusText(snapshot, bounds)
}

function reportBounds(): void {
  bounds = measureWindow()
  channel.post({
    type: 'window_bounds',
    payload: bounds,
  })
}

function requestClusterRecall(): void {
  channel.post({
    type: 'focus_windows',
    payload: {
      preferredId: windowId,
    },
  })
}

function syncCanvasLock(snapshot: GameSnapshot): void {
  const nextLayoutKey = `${snapshot.selectedLevel}:${snapshot.requiredWindowCount}`
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
      const width = Math.round(canvasFrame.clientWidth)
      const height = Math.round(canvasFrame.clientHeight)

      if (width <= 0 || height <= 0) {
        pendingLayoutKey = null
        return
      }

      applyLockedRoomSize(width, height)
      lockedLayoutKey = nextLayoutKey
      pendingLayoutKey = null
      reportBounds()
    })
  })
}

function releaseLockedRoomSize(): void {
  document.documentElement.style.minWidth = ''
  document.documentElement.style.minHeight = ''
  document.body.style.minWidth = ''
  document.body.style.minHeight = ''
  clientApp.style.minWidth = ''
  clientApp.style.minHeight = ''
  clientApp.style.width = ''
  clientApp.style.height = ''
  canvasFrame.style.minWidth = ''
  canvasFrame.style.minHeight = ''
  canvasFrame.style.width = ''
  canvasFrame.style.height = ''
  canvas.style.minWidth = ''
  canvas.style.minHeight = ''
}

function applyLockedRoomSize(width: number, height: number): void {
  const appGap = parseFloat(window.getComputedStyle(clientApp).rowGap || '0')
  const shellStyles = window.getComputedStyle(document.body)
  const shellPaddingX = parseFloat(shellStyles.paddingLeft || '0') + parseFloat(shellStyles.paddingRight || '0')
  const shellPaddingY = parseFloat(shellStyles.paddingTop || '0') + parseFloat(shellStyles.paddingBottom || '0')
  const headerHeight = Math.ceil(clientHeader.getBoundingClientRect().height)
  const appWidth = Math.max(width, Math.ceil(clientHeader.scrollWidth))
  const appHeight = headerHeight + Math.ceil(appGap) + height
  const shellWidth = appWidth + Math.ceil(shellPaddingX)
  const shellHeight = appHeight + Math.ceil(shellPaddingY)

  document.documentElement.style.minWidth = `${shellWidth}px`
  document.documentElement.style.minHeight = `${shellHeight}px`
  document.body.style.minWidth = `${shellWidth}px`
  document.body.style.minHeight = `${shellHeight}px`
  clientApp.style.minWidth = `${appWidth}px`
  clientApp.style.minHeight = `${appHeight}px`
  clientApp.style.width = `${appWidth}px`
  clientApp.style.height = `${appHeight}px`
  canvasFrame.style.minWidth = `${width}px`
  canvasFrame.style.minHeight = `${height}px`
  canvasFrame.style.width = `${width}px`
  canvasFrame.style.height = `${height}px`
  canvas.style.minWidth = `${width}px`
  canvas.style.minHeight = `${height}px`
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
}

function measureWindow(): WindowBoundsPayload {
  const canvasRect = canvas.getBoundingClientRect()
  const frameInset = Math.max(0, (window.outerWidth - window.innerWidth) / 2)
  const verticalChrome = Math.max(0, window.outerHeight - window.innerHeight)
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

  if (routeWindow.role === 'start') {
    return snapshot.activeTarget?.kind === 'bridge'
      ? `START -> ${snapshot.activeTarget.label}`
      : 'START -> GOAL'
  }

  if (routeWindow.role === 'bridge') {
    const relayLabel = `RELAY ${routeWindow.order + 1}`

    if (routeWindow.status === 'active') {
      return `${relayLabel} LIVE`
    }

    if (routeWindow.status === 'cleared') {
      return `${relayLabel} CLEAR`
    }

    return `${relayLabel} LOCKED`
  }

  if (snapshot.goalWindowId === bounds.id) {
    return routeWindow.status === 'active' ? 'GOAL LIVE' : 'GOAL LOCKED'
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
