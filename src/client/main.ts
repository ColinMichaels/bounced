import '../styles/app.css'

import { BOUNDS_HEARTBEAT_MS } from '../shared/constants'
import { openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, WindowBoundsPayload } from '../shared/types'
import { BallRenderer } from './renderer'

const search = new URLSearchParams(window.location.search)
const windowId = search.get('id') ?? `play-window-${Math.random().toString(36).slice(2, 8)}`
const slot = Number(search.get('slot') ?? '0')
const title = search.get('title') ?? `Room ${slot + 1}`
const roomLabel = String(slot + 1).padStart(2, '0')

const titleElement = must<HTMLElement>('window-title')
const statusElement = must<HTMLElement>('client-status')
const canvas = must<HTMLCanvasElement>('game-canvas')

titleElement.textContent = roomLabel
document.title = title

const renderer = new BallRenderer(canvas)
const channel = openGameChannel(handleMessage)
const resizeObserver = new ResizeObserver(() => {
  reportBounds()
})

let snapshot: GameSnapshot | null = null
let bounds: WindowBoundsPayload | null = null

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
resizeObserver.observe(canvas)

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
    contentWidth: canvasRect.width,
    contentHeight: canvasRect.height,
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
