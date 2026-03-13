import '../styles/app.css'

import { BOUNDS_HEARTBEAT_MS } from '../shared/constants'
import { openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, WindowBoundsPayload } from '../shared/types'
import { BallRenderer } from './renderer'

const search = new URLSearchParams(window.location.search)
const windowId = search.get('id') ?? `play-window-${Math.random().toString(36).slice(2, 8)}`
const slot = Number(search.get('slot') ?? '0')
const title = search.get('title') ?? `Window ${slot + 1}`

const titleElement = must<HTMLElement>('window-title')
const labelElement = must<HTMLElement>('window-label')
const scoreElement = must<HTMLElement>('client-score')
const levelElement = must<HTMLElement>('client-level')
const statusElement = must<HTMLElement>('client-status')
const canvas = must<HTMLCanvasElement>('game-canvas')

titleElement.textContent = title
labelElement.textContent = `Window ${slot + 1}`

const renderer = new BallRenderer(canvas)
const channel = openGameChannel(handleMessage)

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
const heartbeat = window.setInterval(reportBounds, BOUNDS_HEARTBEAT_MS)

window.addEventListener('pointerdown', requestClusterRecall, { capture: true })
window.addEventListener('resize', reportBounds)
window.addEventListener('focus', reportBounds)
document.addEventListener('visibilitychange', reportBounds)
canvas.addEventListener('click', handleCanvasClick)

window.addEventListener('beforeunload', () => {
  window.clearInterval(heartbeat)
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
  scoreElement.textContent = `Score ${snapshot.score}`
  levelElement.textContent = `Level ${snapshot.difficulty.level}`

  if (bounds) {
    statusElement.textContent = getStatusText(snapshot, bounds)
  } else {
    statusElement.textContent = snapshot.note
  }
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

function getStatusText(snapshot: GameSnapshot, bounds: WindowBoundsPayload): string {
  const isActive = snapshot.activeWindowIds.includes(bounds.id)
  if (!isActive) {
    return 'Stand by for a later difficulty tier.'
  }

  if (snapshot.goalWindowId === bounds.id) {
    return 'Goal window. Route the signal into the target.'
  }

  return snapshot.note
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing client element: ${id}`)
  }

  return element as T
}
