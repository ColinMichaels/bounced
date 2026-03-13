import '../styles/app.css'

import { GameEngine } from '../engine/gameEngine'
import { getDifficultyForLevel, MAX_LEVEL } from '../engine/difficulty'
import { openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot } from '../shared/types'
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

const channel = openGameChannel(handleMessage)
const engine = new GameEngine(channel)
const windowManager = new WindowManager(window)
const ticker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' })

let hasStarted = false
let readinessWarning = ''
let followWindows = true
let lastFocusedOwnerId: string | null = null
let lastFollowAt = 0
let desiredWindowCount = 0

engine.subscribe(renderSnapshot)

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

  engine.step(event.data.now)
}

startButton.addEventListener('click', () => {
  const initialWindowCount = getDifficultyForLevel(1).activeWindows
  desiredWindowCount = initialWindowCount
  windowManager.ensureWindowPool(initialWindowCount)
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
  windowManager.closeAll()
  engine.endGame()
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

  if (hasStarted && snapshot.phase !== 'idle' && snapshot.requiredWindowCount !== desiredWindowCount) {
    desiredWindowCount = snapshot.requiredWindowCount
    windowManager.ensureWindowPool(desiredWindowCount)

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
  stopButton.textContent = 'End Session'

  statusText.textContent = hasStarted
    ? snapshot.note
    : 'Idle. Arm the field to open the signal windows.'
  detailNote.textContent = [
    `Game windows open: ${windowManager.getOpenCount()} / ${snapshot.requiredWindowCount}.`,
    `Registered windows: ${registeredCount}.`,
    `Goal window: ${goalWindowTitle}.`,
    `Unlocked levels: 1-${snapshot.maxUnlockedLevel}.`,
    `${snapshot.balls.length} signal${snapshot.balls.length === 1 ? '' : 's'} live.`,
  ].join(' ')

  const items = snapshot.windows
    .map((windowState) => {
      const isActive = snapshot.activeWindowIds.includes(windowState.id)
      const visibility = windowState.visible ? 'visible' : 'hidden'
      const marker = isActive ? 'active' : 'inactive'

      return `
        <li>
          <span>${windowState.title}</span>
          <span class="${marker}">${isActive ? 'active' : 'standby'} • ${visibility}</span>
        </li>
      `
    })
    .join('')

  windowList.innerHTML = items || '<li>Waiting for play windows.</li>'
  levelSelect.innerHTML = renderLevelButtons(snapshot)
  syncWindowFollow(snapshot)
  renderWarnings()
}

function renderWarnings(): void {
  const warnings: string[] = []

  if (readinessWarning) {
    warnings.push(readinessWarning)
  }

  if (!readinessWarning && hasStarted) {
    warnings.push('Click any game window to recall the full cluster. Route the lead signal into the target in the last active window.')
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

    return `
      <button class="${classes}" data-level="${level}" ${isLocked ? 'disabled' : ''}>
        <span>Level ${level}</span>
        <span>${state}</span>
      </button>
    `
  }).join('')
}
