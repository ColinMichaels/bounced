import '../styles/app.css'

import { GameEngine } from '../engine/gameEngine'
import { DIFFICULTY_LEVELS, getDifficultyForLevel, MAX_LEVEL } from '../engine/difficulty'
import { createGameChannelName, openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot } from '../shared/types'
import { ProgressStorage } from './progressStorage'
import { WindowManager } from './windowManager'

const startButton = must<HTMLButtonElement>('start-button')
const respawnButton = must<HTMLButtonElement>('respawn-button')
const stopButton = must<HTMLButtonElement>('stop-button')
const warning = must<HTMLParagraphElement>('host-warning')
const statusText = must<HTMLParagraphElement>('status-text')
const detailNote = must<HTMLParagraphElement>('detail-note')
const levelSelect = must<HTMLDivElement>('level-select')
const scoreValue = must<HTMLElement>('score-value')
const streakValue = must<HTMLElement>('streak-value')
const bestStreakValue = must<HTMLElement>('best-streak-value')
const levelValue = must<HTMLElement>('level-value')
const windowCountValue = must<HTMLElement>('window-count-value')
const windowList = must<HTMLUListElement>('window-list')
const hostShell = document.body

const sessionId = createSessionId()
const channelName = createGameChannelName(sessionId)
const channel = openGameChannel(channelName, handleMessage)
const engine = new GameEngine(channel)
const progressStorage = new ProgressStorage(window.localStorage)
const windowManager = new WindowManager(window, channelName, sessionId)
const ticker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' })
const MAX_LEVEL_WINDOWS = Math.max(...DIFFICULTY_LEVELS.map((level) => level.activeWindows))
const MAX_LEVEL_RELAYS = Math.max(...DIFFICULTY_LEVELS.map((level) => Math.max(1, level.activeWindows - 2)))
const MIN_LEVEL_SPEED = Math.min(...DIFFICULTY_LEVELS.map((level) => level.speed))
const MAX_LEVEL_SPEED = Math.max(...DIFFICULTY_LEVELS.map((level) => level.speed))

let hasStarted = false
let readinessWarning = ''
let followWindows = true
let lastFocusedOwnerId: string | null = null
let lastFollowAt = 0
let desiredWindowCount = 0
let lastLayoutKey = ''
let awaitingFreshBoundsSince = 0
let hostHasFocus = document.visibilityState === 'visible' && document.hasFocus()

engine.restoreProgress(progressStorage.load())
engine.subscribe(renderSnapshot)

window.addEventListener('focus', () => {
  hostHasFocus = true
  syncDeckPresentation()
})

window.addEventListener('blur', () => {
  hostHasFocus = false
  syncDeckPresentation()
})

document.addEventListener('visibilitychange', () => {
  hostHasFocus = document.visibilityState === 'visible' && document.hasFocus()
  syncDeckPresentation()
})

levelSelect.addEventListener('click', (event) => {
  const target = event.target instanceof HTMLElement
    ? event.target.closest<HTMLButtonElement>('button[data-level]')
    : null

  if (!target || target.disabled) {
    return
  }

  const level = Number(target.dataset.level)
  if (Number.isFinite(level)) {
    engine.selectLevel(level)
  }
})

ticker.onmessage = (event: MessageEvent<{ type: 'tick'; now: number }>) => {
  if (event.data?.type !== 'tick') {
    return
  }

  const closedWindowId = getClosedGameWindowId()
  if (closedWindowId) {
    abortSessionDueToClosedWindow(closedWindowId)
    return
  }

  if (awaitingFreshBoundsSince > 0) {
    const snapshot = engine.getSnapshot()
    if (!hasFreshWindowBounds(snapshot, awaitingFreshBoundsSince)) {
      renderWarnings()
      return
    }

    awaitingFreshBoundsSince = 0
  }

  engine.step(event.data.now)
}

startButton.addEventListener('click', () => {
  if (hasStarted && windowManager.getOpenCount() > 0) {
    recallGameWindows()
    return
  }

  const snapshot = engine.getSnapshot()
  const initialLevel = snapshot.selectedLevel
  const initialWindowCount = getDifficultyForLevel(initialLevel).activeWindows
  desiredWindowCount = initialWindowCount
  lastLayoutKey = `${initialLevel}:${initialWindowCount}`
  windowManager.ensureWindowPool(initialWindowCount, initialLevel, { relayout: true })
  const openCount = windowManager.getOpenCount()

  if (openCount < initialWindowCount) {
    hasStarted = false
    readinessWarning = 'Browser blocked the play windows. Allow popups for this site, then press start again.'
    renderWarnings()
    renderSnapshot(engine.getSnapshot())
    return
  }

  readinessWarning = ''

  hasStarted = true
  followWindows = true
  lastFocusedOwnerId = null
  lastFollowAt = 0
  awaitingFreshBoundsSince = Date.now()
  syncDeckPresentation()
  windowManager.recallAll()
  renderWarnings()
  engine.start(Date.now())
})

respawnButton.addEventListener('click', () => {
  engine.respawnBall()
})

stopButton.addEventListener('click', () => {
  hasStarted = false
  desiredWindowCount = 0
  readinessWarning = ''
  lastFocusedOwnerId = null
  lastFollowAt = 0
  lastLayoutKey = ''
  awaitingFreshBoundsSince = 0
  windowManager.closeAll()
  engine.endGame()
  syncDeckPresentation()
})

window.addEventListener('beforeunload', () => {
  channel.close()
  windowManager.closeAll()
  ticker.terminate()
})

function handleMessage(message: GameMessage): void {
  switch (message.type) {
    case 'window_bounds':
      if (!hasStarted) {
        break
      }

      engine.upsertWindow(message.payload)
      break
    case 'unregister_window':
      engine.unregisterWindow(message.payload.id)

      if (hasStarted) {
        const closedWindowId = getClosedGameWindowId()
        if (closedWindowId) {
          abortSessionDueToClosedWindow(closedWindowId)
        }
      }

      break
    case 'catch_attempt':
      engine.handleCatchAttempt(message.payload)
      break
    case 'request_sync':
      renderSnapshot(engine.getSnapshot())
      channel.post({ type: 'snapshot', payload: engine.getSnapshot() })
      break
    case 'focus_windows':
      followWindows = true
      windowManager.recallAll(message.payload.preferredId)
      break
    case 'register_window':
    case 'snapshot':
      break
  }
}

function renderSnapshot(snapshot: GameSnapshot): void {
  const registeredCount = snapshot.windows.length
  const goalWindowTitle = snapshot.windows.find((windowState) => windowState.id === snapshot.goalWindowId)?.title ?? 'pending'
  const layoutKey = `${snapshot.selectedLevel}:${snapshot.requiredWindowCount}`
  const liveObstacles = snapshot.obstacles.filter((obstacle) => !obstacle.destroyed)

  progressStorage.save(engine.getProgressState())

  if (hasStarted && snapshot.campaignComplete) {
    hasStarted = false
    desiredWindowCount = 0
    lastFocusedOwnerId = null
    lastFollowAt = 0
    lastLayoutKey = ''
    awaitingFreshBoundsSince = 0
    readinessWarning = 'Campaign complete. Windows cleared. Choose any unlocked level and start the game to replay.'
    windowManager.closeAll()
  }

  if (hasStarted && snapshot.phase !== 'idle' && layoutKey !== lastLayoutKey) {
    lastLayoutKey = layoutKey
    desiredWindowCount = snapshot.requiredWindowCount
    lastFocusedOwnerId = null
    windowManager.ensureWindowPool(desiredWindowCount, snapshot.selectedLevel, { relayout: true })
    windowManager.recallAll()
    awaitingFreshBoundsSince = Date.now()

    if (windowManager.getOpenCount() < desiredWindowCount) {
      readinessWarning = `Only ${windowManager.getOpenCount()} of ${desiredWindowCount} game windows opened.`
    } else if (!readinessWarning.startsWith('Browser blocked')) {
      readinessWarning = ''
    }
  }

  scoreValue.textContent = String(snapshot.score)
  streakValue.textContent = String(snapshot.streak)
  bestStreakValue.textContent = String(snapshot.bestStreak)
  levelValue.textContent = `${snapshot.selectedLevel} / ${MAX_LEVEL}`
  windowCountValue.textContent = `${snapshot.availableWindowCount} / ${snapshot.requiredWindowCount}`
  startButton.textContent = hasStarted && windowManager.getOpenCount() > 0 ? 'Resume Game' : 'Start Game'
  stopButton.textContent = 'End Session'

  statusText.textContent = hasStarted
    ? snapshot.note
    : `${snapshot.note} Allow popups, then start the game to open the signal windows.`
  detailNote.textContent = [
    `Game windows open: ${windowManager.getOpenCount()} / ${snapshot.requiredWindowCount}.`,
    `Registered windows: ${registeredCount}.`,
    `Route: start + ${Math.max(0, snapshot.bridgeWindowIds.length)} relay${snapshot.bridgeWindowIds.length === 1 ? '' : 's'} + goal.`,
    `Barriers: ${liveObstacles.length}.`,
    `Goal window: ${goalWindowTitle}.`,
    `Unlocked levels: 1-${snapshot.maxUnlockedLevel}.`,
    `${snapshot.completedLevels.length} of ${MAX_LEVEL} levels cleared.`,
    'Windows spawn disconnected each level. Build a route and clear relays in order.',
    `${snapshot.balls.length} signal${snapshot.balls.length === 1 ? '' : 's'} live.`,
  ].join(' ')

  const items = snapshot.windows
    .map((windowState) => {
      const isActive = snapshot.activeWindowIds.includes(windowState.id)
      const visibility = windowState.visible ? 'visible' : 'hidden'
      const routeWindow = snapshot.routeWindows.find((routeEntry) => routeEntry.id === windowState.id)
      const marker = isActive ? 'active' : 'inactive'
      const routeLabel = routeWindow
        ? `${routeWindow.role}${routeWindow.role === 'bridge' ? ` ${routeWindow.order + 1}` : ''} • ${routeWindow.status}`
        : 'standby'
      const obstacleCount = liveObstacles.filter((obstacle) => obstacle.windowId === windowState.id).length

      return `
        <li>
          <span>${windowState.title}</span>
          <span class="${marker}">${routeLabel} • ${obstacleCount} barrier${obstacleCount === 1 ? '' : 's'} • ${visibility}</span>
        </li>
      `
    })
    .join('')

  windowList.innerHTML = items || '<li>Waiting for play windows.</li>'
  levelSelect.innerHTML = renderLevelButtons(snapshot)
  syncWindowFollow(snapshot)
  renderWarnings()
  syncDeckPresentation()
}

function renderWarnings(): void {
  const warnings: string[] = []

  if (readinessWarning) {
    warnings.push(readinessWarning)
  }

  if (awaitingFreshBoundsSince > 0 && hasStarted) {
    warnings.push('Syncing live window bounds after layout change.')
  }

  if (!readinessWarning && hasStarted) {
    warnings.push('Use Resume Game or click any game window to recall the cluster. Closing any room ends the current session.')
  }

  warning.hidden = warnings.length === 0
  warning.textContent = warnings.join(' ')
}

function syncWindowFollow(snapshot: GameSnapshot): void {
  if (!followWindows || snapshot.phase !== 'running') {
    return
  }

  const ownerId = snapshot.ball?.ownerWindowId ?? null
  if (!ownerId || ownerId === lastFocusedOwnerId) {
    return
  }

  const now = Date.now()
  if (now - lastFollowAt < 120) {
    return
  }

  windowManager.recallAll(ownerId)

  lastFocusedOwnerId = ownerId
  lastFollowAt = now
}

function recallGameWindows(): void {
  if (!hasStarted) {
    return
  }

  const snapshot = engine.getSnapshot()
  const preferredId = snapshot.ball?.ownerWindowId ?? snapshot.activeWindowIds[0] ?? null

  followWindows = true
  lastFocusedOwnerId = null
  lastFollowAt = 0
  windowManager.recallAll(preferredId)
}

function getClosedGameWindowId(): string | null {
  if (!hasStarted || desiredWindowCount <= 0) {
    return null
  }

  return windowManager.getClosedWindowIds(desiredWindowCount)[0] ?? null
}

function abortSessionDueToClosedWindow(windowId: string): void {
  const snapshot = engine.getSnapshot()
  const closedWindowTitle = snapshot.windows.find((windowState) => windowState.id === windowId)?.title
    ?? `Room ${windowId.replace('play-window-', '')}`

  hasStarted = false
  desiredWindowCount = 0
  followWindows = true
  readinessWarning = `${closedWindowTitle} was closed during play. Session aborted.`
  lastFocusedOwnerId = null
  lastFollowAt = 0
  lastLayoutKey = ''
  awaitingFreshBoundsSince = 0
  windowManager.closeAll()
  engine.endGame(`${closedWindowTitle} was closed during play.`)
  syncDeckPresentation()
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing host element: ${id}`)
  }

  return element as T
}

function renderLevelButtons(snapshot: GameSnapshot): string {
  const completed = new Set(snapshot.completedLevels)

  return Array.from({ length: MAX_LEVEL }, (_, index) => {
    const level = index + 1
    const difficulty = getDifficultyForLevel(level)
    const relayCount = Math.max(1, difficulty.activeWindows - 2)
    const isLocked = level > snapshot.maxUnlockedLevel
    const isCurrent = level === snapshot.selectedLevel
    const isCompleted = completed.has(level)
    const classes = [
      'level-chip',
      isCurrent ? 'is-current' : '',
      isCompleted ? 'is-completed' : '',
      isLocked ? 'is-locked' : '',
    ].filter(Boolean).join(' ')
    const state = isLocked
      ? 'locked'
      : isCurrent
        ? 'current'
        : isCompleted
          ? 'cleared'
          : 'open'
    const windowsFill = getMetricFill(difficulty.activeWindows, 1, MAX_LEVEL_WINDOWS)
    const relayFill = getMetricFill(relayCount, 1, MAX_LEVEL_RELAYS)
    const speedFill = getMetricFill(difficulty.speed, MIN_LEVEL_SPEED, MAX_LEVEL_SPEED)

    return `
      <button class="${classes}" data-level="${level}" ${isLocked ? 'disabled' : ''}>
        <span class="level-chip__head">
          <strong>Level ${level}</strong>
          <span class="level-chip__state">
            ${isLocked ? `
              <svg class="level-chip__lock" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/>
              </svg>
            ` : ''}
            ${isLocked ? '' : `<em>${state}</em>`}
          </span>
        </span>
        <span class="level-chip__graph">
          <span class="level-chip__metric">
            <span class="level-chip__label">Windows</span>
            <span class="level-chip__track">
              <span class="level-chip__fill level-chip__fill--windows" style="width: ${windowsFill}%"></span>
            </span>
            <span class="level-chip__value">${difficulty.activeWindows}</span>
          </span>
          <span class="level-chip__metric">
            <span class="level-chip__label">Relays</span>
            <span class="level-chip__track">
              <span class="level-chip__fill level-chip__fill--relays" style="width: ${relayFill}%"></span>
            </span>
            <span class="level-chip__value">${relayCount}</span>
          </span>
          <span class="level-chip__metric">
            <span class="level-chip__label">Speed</span>
            <span class="level-chip__track">
              <span class="level-chip__fill level-chip__fill--speed" style="width: ${speedFill}%"></span>
            </span>
            <span class="level-chip__value">${difficulty.speed}</span>
          </span>
        </span>
      </button>
    `
  }).join('')
}

function getMetricFill(value: number, min: number, max: number): number {
  if (max <= min) {
    return 100
  }

  const normalized = (value - min) / (max - min)
  return Math.round((0.18 + (normalized * 0.82)) * 100)
}

function hasFreshWindowBounds(snapshot: GameSnapshot, since: number): boolean {
  const requiredCount = snapshot.requiredWindowCount
  const playableWindows = snapshot.windows
    .filter((windowState) =>
      windowState.slot < requiredCount
      && windowState.contentWidth > 0
      && windowState.contentHeight > 0,
    )
    .sort((left, right) => left.slot - right.slot)

  if (playableWindows.length < requiredCount) {
    return false
  }

  return playableWindows
    .slice(0, requiredCount)
    .every((windowState) => windowState.lastSeenAt >= since)
}

function syncDeckPresentation(): void {
  hostShell.dataset.sessionState = hasStarted ? 'armed' : 'idle'
  hostShell.dataset.deckFocus = hasStarted && !hostHasFocus ? 'background' : 'foreground'
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
