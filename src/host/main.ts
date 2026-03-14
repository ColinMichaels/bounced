import '../styles/app.css'

import { GameEngine } from '../engine/gameEngine'
import {
  DIFFICULTY_LEVELS,
  getDifficultyForLevel,
  getMedalThresholdMs,
  getNextMedalTier,
  MAX_LEVEL,
} from '../engine/difficulty'
import { createGameChannelName, openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, MedalTier } from '../shared/types'
import { HostAudioEngine } from './audio'
import { ProgressStorage } from './progressStorage'
import { WindowManager } from './windowManager'

const startButton = must<HTMLButtonElement>('start-button')
const utilityButton = must<HTMLButtonElement>('utility-button')
const respawnButton = must<HTMLButtonElement>('respawn-button')
const stopButton = must<HTMLButtonElement>('stop-button')
const popupWarning = must<HTMLParagraphElement>('popup-warning')
const warning = must<HTMLParagraphElement>('host-warning')
const statusText = must<HTMLParagraphElement>('status-text')
const detailNote = must<HTMLParagraphElement>('detail-note')
const levelSelect = must<HTMLDivElement>('level-select')
const levelChangeDialog = must<HTMLDialogElement>('level-change-dialog')
const levelChangeMessage = must<HTMLParagraphElement>('level-change-message')
const confirmLevelChangeButton = must<HTMLButtonElement>('confirm-level-change-button')
const cancelLevelChangeButton = must<HTMLButtonElement>('cancel-level-change-button')
const scoreValue = must<HTMLElement>('score-value')
const streakValue = must<HTMLElement>('streak-value')
const bestStreakValue = must<HTMLElement>('best-streak-value')
const timerHudValue = must<HTMLElement>('timer-hud-value')
const timerValue = must<HTMLElement>('timer-value')
const bestTimeValue = must<HTMLElement>('best-time-value')
const medalValue = must<HTMLElement>('medal-value')
const targetTimeValue = must<HTMLElement>('target-time-value')
const utilityChargeValue = must<HTMLElement>('utility-charge-value')
const utilityStateValue = must<HTMLElement>('utility-state-value')
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
const audio = new HostAudioEngine()
const MAX_LEVEL_WINDOWS = Math.max(...DIFFICULTY_LEVELS.map((level) => level.activeWindows))
const MAX_LEVEL_RELAYS = Math.max(...DIFFICULTY_LEVELS.map((level) => Math.max(1, level.activeWindows - 2)))
const MIN_LEVEL_SPEED = Math.min(...DIFFICULTY_LEVELS.map((level) => level.speed))
const MAX_LEVEL_SPEED = Math.max(...DIFFICULTY_LEVELS.map((level) => level.speed))
const HOST_RENDER_INTERVAL_MS = 1000 / 12
const POPUP_ACCESS_STORAGE_KEY = 'bounced-popup-access'

type PopupAccessState = 'unknown' | 'allowed' | 'blocked'

let hasStarted = false
let readinessWarning = ''
let followWindows = true
let lastFocusedOwnerId: string | null = null
let lastFollowAt = 0
let desiredWindowCount = 0
let lastLayoutKey = ''
let awaitingFreshBoundsSince = 0
let hostHasFocus = document.visibilityState === 'visible' && document.hasFocus()
let pausedForDeckFocus = false
let lastLevelSelectKey = ''
let latestSnapshot = engine.getSnapshot()
let renderFrameId = 0
let lastRenderAt = 0
let popupAccessState = loadPopupAccessState()
let pendingLevelSelection: number | null = null
let summaryWindowRef: Window | null = null
let lastSummaryKey = ''

engine.restoreProgress(progressStorage.load())
engine.subscribe(handleEngineSnapshot)
renderPopupWarning()

window.addEventListener('focus', () => {
  updateHostFocusState(true)
})

window.addEventListener('blur', () => {
  updateHostFocusState(false)
})

document.addEventListener('visibilitychange', () => {
  updateHostFocusState(document.visibilityState === 'visible' && document.hasFocus())
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
    requestLevelSelection(level)
  }
})

confirmLevelChangeButton.addEventListener('click', () => {
  const level = pendingLevelSelection
  closeLevelChangeDialog()

  if (level === null) {
    return
  }

  stopActiveSession('Session ended to load a different level.')
  engine.selectLevel(level)
})

cancelLevelChangeButton.addEventListener('click', () => {
  closeLevelChangeDialog()
})

levelChangeDialog.addEventListener('cancel', (event) => {
  event.preventDefault()
  closeLevelChangeDialog()
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
  audio.unlock()
  if (hasStarted && windowManager.getOpenCount() > 0) {
    resumeGameplay()
    return
  }

  const snapshot = engine.getSnapshot()
  if (snapshot.phase === 'summary') {
    engine.continueFromSummary()
    armQueuedSession()
    return
  }

  if (snapshot.phase === 'waiting') {
    armQueuedSession()
    return
  }

  if (!armSession(snapshot.selectedLevel)) {
    return
  }

  engine.start(Date.now())
})

respawnButton.addEventListener('click', () => {
  audio.unlock()
  engine.respawnBall()
})

utilityButton.addEventListener('click', () => {
  audio.unlock()
  engine.activateBridgePulse(Date.now())
})

stopButton.addEventListener('click', () => {
  audio.unlock()
  stopActiveSession()
})

function armSession(level: number): boolean {
  const initialWindowCount = getDifficultyForLevel(level).activeWindows
  desiredWindowCount = initialWindowCount
  lastLayoutKey = `${level}:${initialWindowCount}`
  const handles = windowManager.ensureWindowPool(initialWindowCount, level, { relayout: true })
  sendLayoutHints(handles)
  const openCount = windowManager.getOpenCount()

  if (openCount < initialWindowCount) {
    setPopupAccessState('blocked')
    hasStarted = false
    readinessWarning = 'Browser blocked the play windows. Allow popups for this site, then press start again.'
    renderWarnings()
    renderSnapshot(engine.getSnapshot())
    return false
  }

  closeSummaryWindow()
  setPopupAccessState('allowed')
  readinessWarning = ''
  hasStarted = true
  pausedForDeckFocus = false
  followWindows = true
  lastFocusedOwnerId = null
  lastFollowAt = 0
  awaitingFreshBoundsSince = Date.now()
  syncDeckPresentation()
  windowManager.recallAll()
  const initialFrontHandle = [...handles]
    .filter((handle) => handle.ref && !handle.ref.closed)
    .sort((left, right) => left.slot - right.slot)
    .at(-1)
  engine.setFrontWindowId(initialFrontHandle?.id ?? null)
  renderWarnings()
  return true
}

function armQueuedSession(): void {
  const snapshot = engine.getSnapshot()
  if (!armSession(snapshot.selectedLevel)) {
    return
  }

  renderSnapshot(engine.getSnapshot())
}

window.addEventListener('beforeunload', () => {
  audio.dispose()
  channel.close()
  closeSummaryWindow()
  windowManager.closeAll()
  ticker.terminate()
})

function handleEngineSnapshot(snapshot: GameSnapshot): void {
  if (pausedForDeckFocus && hasStarted && snapshot.phase !== 'idle' && snapshot.phase !== 'paused' && snapshot.phase !== 'summary' && !snapshot.campaignComplete) {
    audio.pause()
    engine.pause(Date.now())
    return
  }

  latestSnapshot = snapshot
  audio.handleSnapshot(snapshot)
  scheduleRender()
}

function scheduleRender(): void {
  if (renderFrameId !== 0) {
    return
  }

  renderFrameId = window.requestAnimationFrame(flushRender)
}

function flushRender(now: number): void {
  renderFrameId = 0

  if (now - lastRenderAt < HOST_RENDER_INTERVAL_MS) {
    scheduleRender()
    return
  }

  lastRenderAt = now
  renderSnapshot(latestSnapshot)
}

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
      sendLayoutHint(message.payload.id)
      renderSnapshot(engine.getSnapshot())
      channel.post({ type: 'snapshot', payload: engine.getSnapshot() })
      break
    case 'focus_windows':
      if (pausedForDeckFocus) {
        resumeGameplay(message.payload.preferredId)
        break
      }

      followWindows = true
      engine.setFrontWindowId(message.payload.preferredId)
      windowManager.recallAll(message.payload.preferredId)
      break
    case 'window_focus':
      if (pausedForDeckFocus) {
        resumeGameplay(message.payload.id)
        break
      }

      engine.setFrontWindowId(message.payload.id)
      break
    case 'summary_action':
      handleSummaryAction(message.payload.action)
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
  const progress = engine.getProgressState()

  progressStorage.save(progress)

  if (snapshot.phase === 'summary' && snapshot.levelSummary) {
    hasStarted = false
    pausedForDeckFocus = false
    desiredWindowCount = 0
    followWindows = true
    engine.setFrontWindowId(null)
    lastFocusedOwnerId = null
    lastFollowAt = 0
    lastLayoutKey = ''
    awaitingFreshBoundsSince = 0
    readinessWarning = ''
    audio.pause()
    windowManager.closeAll()
    ensureSummaryWindow(snapshot)
  } else {
    lastSummaryKey = ''
    closeSummaryWindow()
  }

  if (hasStarted && snapshot.phase !== 'idle' && layoutKey !== lastLayoutKey) {
    lastLayoutKey = layoutKey
    desiredWindowCount = snapshot.requiredWindowCount
    lastFocusedOwnerId = null
    const handles = windowManager.ensureWindowPool(desiredWindowCount, snapshot.selectedLevel, { relayout: true })
    sendLayoutHints(handles)
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
  const formattedTimer = formatDurationMs(snapshot.levelElapsedMs)
  timerHudValue.textContent = formattedTimer
  timerValue.textContent = formattedTimer
  bestTimeValue.textContent = snapshot.bestLevelTimeMs === null ? '--:--.-' : formatDurationMs(snapshot.bestLevelTimeMs)
  medalValue.textContent = formatMedalTier(snapshot.bestLevelMedal)
  medalValue.dataset.tier = snapshot.bestLevelMedal
  targetTimeValue.textContent = formatMedalTarget(snapshot.bestLevelMedal, snapshot.difficulty.medalThresholds)
  utilityChargeValue.textContent = String(snapshot.utilityCharges)
  utilityStateValue.textContent = formatUtilityState(snapshot)
  levelValue.textContent = `${snapshot.selectedLevel} / ${MAX_LEVEL}`
  windowCountValue.textContent = `${snapshot.availableWindowCount} / ${snapshot.requiredWindowCount}`
  startButton.textContent = hasStarted && windowManager.getOpenCount() > 0 ? 'Resume Game' : 'Start Game'
  utilityButton.textContent = snapshot.activeUtility ? 'Bridge Pulse Live' : 'Bridge Pulse'
  respawnButton.disabled = !hasStarted || snapshot.phase === 'paused'
  utilityButton.disabled = !hasStarted
    || snapshot.phase !== 'running'
    || snapshot.utilityCharges <= 0
    || snapshot.activeUtility !== null
  stopButton.textContent = 'End Session'

  statusText.textContent = hasStarted
    ? snapshot.note
    : popupAccessState === 'allowed'
      ? snapshot.note
      : `${snapshot.note} Allow popups, then start the game to open the signal windows.`
  detailNote.textContent = [
    `Game windows open: ${windowManager.getOpenCount()} / ${snapshot.requiredWindowCount}.`,
    `Registered windows: ${registeredCount}.`,
    `Route: start + ${Math.max(0, snapshot.bridgeWindowIds.length)} relay${snapshot.bridgeWindowIds.length === 1 ? '' : 's'} + goal.`,
    `Barriers: ${liveObstacles.length}.`,
    `Bonuses live: ${snapshot.ambientBonuses.length + (snapshot.activeScoreNode ? 1 : 0)}.`,
    `Goal window: ${goalWindowTitle}.`,
    `Pulse charges: ${snapshot.utilityCharges}.`,
    snapshot.activeUtility ? `Utility live: ${formatDurationMs(snapshot.activeUtility.remainingMs)} remaining.` : 'Utility ready when a charge is available.',
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
      const blockedEdgeCount = routeWindow?.blockedEdges.length ?? 0

      return `
        <li>
          <span>${windowState.title}</span>
          <span class="${marker}">${routeLabel} • ${obstacleCount} barrier${obstacleCount === 1 ? '' : 's'} • ${blockedEdgeCount} side lock${blockedEdgeCount === 1 ? '' : 's'} • ${visibility}</span>
        </li>
      `
    })
    .join('')

  windowList.innerHTML = items || '<li>Waiting for play windows.</li>'
  const bestTimeSignature = Object.entries(progress.bestLevelTimesMs)
    .map(([level, timeMs]) => `${level}:${timeMs}`)
    .join(',')
  const medalSignature = Object.entries(progress.bestLevelMedals)
    .map(([level, medal]) => `${level}:${medal}`)
    .join(',')
  const levelSelectKey = `${snapshot.selectedLevel}:${snapshot.maxUnlockedLevel}:${snapshot.completedLevels.join(',')}:${bestTimeSignature}:${medalSignature}`
  if (levelSelectKey !== lastLevelSelectKey) {
    levelSelect.innerHTML = renderLevelButtons(snapshot, progress)
    lastLevelSelectKey = levelSelectKey
  }
  syncWindowFollow(snapshot)
  renderWarnings()
  renderPopupWarning()
  syncDeckPresentation()
}

function requestLevelSelection(level: number): void {
  const snapshot = engine.getSnapshot()
  if (level === snapshot.selectedLevel) {
    return
  }

  if (hasStarted && snapshot.phase !== 'idle') {
    openLevelChangeDialog(level)
    return
  }

  engine.selectLevel(level)
}

function openLevelChangeDialog(level: number): void {
  pendingLevelSelection = level
  levelChangeMessage.textContent = `A session is already live. Stop it and load level ${level}?`

  if (typeof levelChangeDialog.showModal === 'function') {
    if (!levelChangeDialog.open) {
      levelChangeDialog.showModal()
    }
    return
  }

  const confirmed = window.confirm(`Stop the current session and load level ${level}?`)
  if (!confirmed) {
    pendingLevelSelection = null
    return
  }

  stopActiveSession('Session ended to load a different level.')
  engine.selectLevel(level)
}

function closeLevelChangeDialog(): void {
  pendingLevelSelection = null

  if (levelChangeDialog.open) {
    levelChangeDialog.close()
  }
}

function ensureSummaryWindow(snapshot: GameSnapshot): void {
  const summary = snapshot.levelSummary
  if (!summary) {
    return
  }

  const summaryKey = [
    summary.clearedLevel,
    summary.clearTimeMs,
    summary.bestMedal,
    summary.nextLevel ?? 'complete',
  ].join(':')

  if (summaryWindowRef && !summaryWindowRef.closed) {
    if (summaryKey !== lastSummaryKey) {
      summaryWindowRef.focus()
    }
    lastSummaryKey = summaryKey
    return
  }

  const width = 520
  const height = 720
  const left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2))
  const top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2))
  const url = new URL('./summary.html', window.location.href)
  url.searchParams.set('channel', channelName)
  url.searchParams.set('session', sessionId)
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'resizable=no',
    'scrollbars=no',
    'toolbar=no',
    'location=no',
    'menubar=no',
    'status=no',
  ].join(',')

  summaryWindowRef = window.open(url.toString(), 'bounced-level-summary', features)
  if (!summaryWindowRef) {
    readinessWarning = 'Level report popup was blocked. Use the control deck to continue or return to the lobby.'
    renderWarnings()
    return
  }

  summaryWindowRef.focus()
  lastSummaryKey = summaryKey
}

function closeSummaryWindow(): void {
  if (summaryWindowRef && !summaryWindowRef.closed) {
    summaryWindowRef.close()
  }

  summaryWindowRef = null
  lastSummaryKey = ''
}

function handleSummaryAction(action: 'next' | 'replay' | 'lobby'): void {
  const summary = latestSnapshot.levelSummary
  if (!summary || latestSnapshot.phase !== 'summary') {
    return
  }

  if (action === 'lobby') {
    stopActiveSession('Returned to the control board lobby.')
    return
  }

  if (action === 'replay') {
    engine.selectLevel(summary.clearedLevel)
    armQueuedSession()
    return
  }

  if (summary.nextLevel === null) {
    return
  }

  engine.continueFromSummary()
  armQueuedSession()
}

function stopActiveSession(prefix = 'Session ended.'): void {
  closeLevelChangeDialog()
  closeSummaryWindow()
  hasStarted = false
  pausedForDeckFocus = false
  desiredWindowCount = 0
  readinessWarning = ''
  lastFocusedOwnerId = null
  lastFollowAt = 0
  lastLayoutKey = ''
  awaitingFreshBoundsSince = 0
  engine.setFrontWindowId(null)
  windowManager.closeAll()
  audio.pause()
  engine.endGame(prefix)
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

  if (pausedForDeckFocus) {
    warnings.push('Session paused while the control deck is focused. Press Resume Game or click a room to continue.')
  } else if (latestSnapshot.phase === 'summary') {
    warnings.push('Level report ready. Use the summary window to start the next level, replay, or return to the lobby.')
  } else if (!readinessWarning && hasStarted) {
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
  engine.setFrontWindowId(ownerId)

  lastFocusedOwnerId = ownerId
  lastFollowAt = now
}

function resumeGameplay(preferredId?: string | null): void {
  if (!hasStarted) {
    return
  }

  if (pausedForDeckFocus) {
    pausedForDeckFocus = false
    engine.resume(Date.now())
    audio.resume()
  }

  const snapshot = engine.getSnapshot()
  const nextPreferredId = preferredId ?? snapshot.ball?.ownerWindowId ?? snapshot.activeWindowIds[0] ?? null

  followWindows = true
  lastFocusedOwnerId = null
  lastFollowAt = 0
  engine.setFrontWindowId(nextPreferredId)
  windowManager.recallAll(nextPreferredId)
  syncDeckPresentation()
}

function sendLayoutHints(handles: ReturnType<WindowManager['ensureWindowPool']>): void {
  handles.forEach((handle) => {
    if (!handle.layout) {
      return
    }

    channel.post({
      type: 'layout_hint',
      payload: {
        id: handle.id,
        contentWidth: Math.round(handle.layout.width),
        contentHeight: Math.round(handle.layout.height),
      },
    })
  })
}

function sendLayoutHint(id: string): void {
  const handle = windowManager.getHandle(id)
  if (!handle?.layout) {
    return
  }

  channel.post({
    type: 'layout_hint',
    payload: {
      id: handle.id,
      contentWidth: Math.round(handle.layout.width),
      contentHeight: Math.round(handle.layout.height),
    },
  })
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
  pausedForDeckFocus = false
  desiredWindowCount = 0
  followWindows = true
  readinessWarning = `${closedWindowTitle} was closed during play. Session aborted.`
  lastFocusedOwnerId = null
  lastFollowAt = 0
  lastLayoutKey = ''
  awaitingFreshBoundsSince = 0
  engine.setFrontWindowId(null)
  windowManager.closeAll()
  audio.pause()
  engine.endGame(`${closedWindowTitle} was closed during play.`)
  syncDeckPresentation()
}

function updateHostFocusState(nextHasFocus: boolean): void {
  const previousHasFocus = hostHasFocus
  hostHasFocus = nextHasFocus

  if (
    nextHasFocus
    && !previousHasFocus
    && latestSnapshot.phase === 'summary'
    && summaryWindowRef
    && !summaryWindowRef.closed
  ) {
    stopActiveSession('Returned to the control board lobby.')
    return
  }

  if (hasStarted && nextHasFocus && !previousHasFocus) {
    pauseForControlDeck()
  }

  syncDeckPresentation()
}

function pauseForControlDeck(): void {
  if (!hasStarted || pausedForDeckFocus || latestSnapshot.phase === 'idle' || latestSnapshot.campaignComplete) {
    return
  }

  pausedForDeckFocus = true
  audio.pause()
  engine.pause(Date.now())
  renderWarnings()
}

function renderPopupWarning(): void {
  popupWarning.hidden = popupAccessState === 'allowed'
}

function setPopupAccessState(nextState: PopupAccessState): void {
  popupAccessState = nextState

  if (nextState === 'unknown') {
    window.localStorage.removeItem(POPUP_ACCESS_STORAGE_KEY)
  } else {
    window.localStorage.setItem(POPUP_ACCESS_STORAGE_KEY, nextState)
  }

  renderPopupWarning()
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing host element: ${id}`)
  }

  return element as T
}

function renderLevelButtons(snapshot: GameSnapshot, progress: ReturnType<GameEngine['getProgressState']>): string {
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
    const bestTime = progress.bestLevelTimesMs[String(level)]
    const bestMedal = progress.bestLevelMedals[String(level)] ?? 'none'
    const medalBadge = bestMedal === 'none'
      ? ''
      : `<span class="level-chip__medal level-chip__medal--${bestMedal}">${formatMedalTier(bestMedal)}</span>`
    const metaItems = [
      `<span class="level-chip__meta-item">Gold ${formatDurationMs(difficulty.medalThresholds.goldMs)}</span>`,
      bestTime ? `<span class="level-chip__meta-item">Best ${formatDurationMs(bestTime)}</span>` : '',
    ].filter(Boolean).join('')

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
            ${medalBadge}
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
        <span class="level-chip__meta">${metaItems}</span>
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

function formatDurationMs(durationMs: number): string {
  const totalTenths = Math.max(0, Math.round(durationMs / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  const tenths = totalTenths % 10

  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}

function formatMedalTier(tier: MedalTier): string {
  return tier === 'none' ? 'NONE' : tier.toUpperCase()
}

function formatMedalTarget(
  currentMedal: MedalTier,
  thresholds: GameSnapshot['difficulty']['medalThresholds'],
): string {
  const nextTier = getNextMedalTier(currentMedal)
  if (!nextTier) {
    return `GOLD ${formatDurationMs(thresholds.goldMs)}`
  }

  return `${formatMedalTier(nextTier)} ${formatDurationMs(getMedalThresholdMs(thresholds, nextTier))}`
}

function formatUtilityState(snapshot: GameSnapshot): string {
  if (snapshot.activeUtility) {
    return `${snapshot.activeUtility.label} ${formatDurationMs(snapshot.activeUtility.remainingMs)}`
  }

  if (snapshot.phase !== 'running') {
    return 'OFFLINE'
  }

  return snapshot.utilityCharges > 0 ? 'READY' : 'NO CHARGE'
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
  const summaryActive = latestSnapshot.phase === 'summary' && !!summaryWindowRef && !summaryWindowRef.closed
  hostShell.dataset.sessionState = hasStarted || summaryActive ? 'armed' : 'idle'
  hostShell.dataset.deckFocus = hasStarted
    ? (!hostHasFocus && !pausedForDeckFocus ? 'background' : 'foreground')
    : summaryActive
      ? 'background'
      : 'foreground'
}

function loadPopupAccessState(): PopupAccessState {
  const storedValue = window.localStorage.getItem(POPUP_ACCESS_STORAGE_KEY)
  return storedValue === 'allowed' || storedValue === 'blocked' ? storedValue : 'unknown'
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
