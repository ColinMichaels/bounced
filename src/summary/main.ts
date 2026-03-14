import '../styles/app.css'

import { createGameChannelName, openGameChannel } from '../network/channel'
import type { GameMessage } from '../shared/messages'
import type { GameSnapshot, MedalTier } from '../shared/types'

const search = new URLSearchParams(window.location.search)
const sessionId = search.get('session') ?? 'default'
const channelName = search.get('channel') ?? createGameChannelName(sessionId)

const eyebrowElement = must<HTMLElement>('summary-eyebrow')
const titleElement = must<HTMLElement>('summary-title')
const subtitleElement = must<HTMLElement>('summary-subtitle')
const medalElement = must<HTMLElement>('summary-medal')
const routeElement = must<HTMLElement>('summary-route')
const clearTimeElement = must<HTMLElement>('summary-clear-time')
const bestTimeElement = must<HTMLElement>('summary-best-time')
const scoreDeltaElement = must<HTMLElement>('summary-score-delta')
const pulseDeltaElement = must<HTMLElement>('summary-pulse-delta')
const goalWindowElement = must<HTMLElement>('summary-goal-window')
const recordNoteElement = must<HTMLElement>('summary-record-note')
const progressNoteElement = must<HTMLElement>('summary-progress-note')
const previewTitleElement = must<HTMLElement>('summary-preview-title')
const previewSubtitleElement = must<HTMLElement>('summary-preview-subtitle')
const nextWindowsElement = must<HTMLElement>('summary-next-windows')
const nextRelaysElement = must<HTMLElement>('summary-next-relays')
const nextSpeedElement = must<HTMLElement>('summary-next-speed')
const nextGoldElement = must<HTMLElement>('summary-next-gold')
const statusElement = must<HTMLElement>('summary-status')
const nextButton = must<HTMLButtonElement>('summary-next-button')
const replayButton = must<HTMLButtonElement>('summary-replay-button')
const lobbyButton = must<HTMLButtonElement>('summary-lobby-button')

const channel = openGameChannel(channelName, handleMessage)
let latestSnapshot: GameSnapshot | null = null

nextButton.addEventListener('click', () => {
  if (!latestSnapshot?.levelSummary || latestSnapshot.levelSummary.nextLevel === null) {
    return
  }

  setBusyState(`Arming level ${latestSnapshot.levelSummary.nextLevel}...`)
  channel.post({
    type: 'summary_action',
    payload: {
      action: 'next',
    },
  })
})

replayButton.addEventListener('click', () => {
  const clearedLevel = latestSnapshot?.levelSummary?.clearedLevel
  if (!clearedLevel) {
    return
  }

  setBusyState(`Replaying level ${clearedLevel}...`)
  channel.post({
    type: 'summary_action',
    payload: {
      action: 'replay',
    },
  })
})

lobbyButton.addEventListener('click', () => {
  setBusyState('Returning to the control deck lobby...')
  channel.post({
    type: 'summary_action',
    payload: {
      action: 'lobby',
    },
  })
})

window.addEventListener('beforeunload', () => {
  channel.close()
})

channel.post({
  type: 'request_sync',
  payload: {
    id: 'summary-window',
  },
})

function handleMessage(message: GameMessage): void {
  if (message.type !== 'snapshot') {
    return
  }

  latestSnapshot = message.payload
  renderSnapshot(message.payload)
}

function renderSnapshot(snapshot: GameSnapshot): void {
  const summary = snapshot.levelSummary
  if (snapshot.phase !== 'summary' || !summary) {
    statusElement.textContent = 'Summary closed. Returning to the control deck...'
    setButtonsDisabled(true)
    window.setTimeout(() => {
      try {
        window.close()
      } catch {
        // Ignore blocked close attempts.
      }
    }, 120)
    return
  }

  const isCampaignComplete = summary.nextLevel === null
  document.title = isCampaignComplete
    ? 'Bounced Campaign Complete'
    : `Bounced Level ${summary.clearedLevel} Report`

  eyebrowElement.textContent = isCampaignComplete ? 'CAMPAIGN REPORT' : 'LEVEL REPORT'
  titleElement.textContent = isCampaignComplete ? 'Campaign Complete' : `Level ${summary.clearedLevel} Complete`
  subtitleElement.textContent = isCampaignComplete
    ? 'All levels are unlocked. Replay this stage or return to the control board.'
    : `Level ${summary.nextLevel} is queued. Review the run, then launch the next signal field or replay this stage.`

  medalElement.textContent = formatMedal(summary.currentMedal)
  medalElement.dataset.tier = summary.currentMedal
  routeElement.textContent = `${summary.windowCount} rooms / ${summary.relayCount} relays`
  clearTimeElement.textContent = formatDurationMs(summary.clearTimeMs)
  bestTimeElement.textContent = formatDurationMs(summary.bestTimeMs)
  scoreDeltaElement.textContent = formatSigned(summary.scoreDelta)
  pulseDeltaElement.textContent = formatSigned(summary.utilityChargeDelta)
  goalWindowElement.textContent = summary.goalWindowTitle ?? 'Goal room pending'
  recordNoteElement.textContent = getRecordNote(summary)
  progressNoteElement.textContent = `${summary.totalCompletedLevels} / 100 cleared • score ${summary.totalScore} • streak ${summary.totalStreak}`

  if (summary.nextDifficulty) {
    previewTitleElement.textContent = `Level ${summary.nextDifficulty.level}`
    previewSubtitleElement.textContent = 'Next run profile'
    nextWindowsElement.textContent = String(summary.nextDifficulty.activeWindows)
    nextRelaysElement.textContent = String(Math.max(0, summary.nextDifficulty.activeWindows - 2))
    nextSpeedElement.textContent = String(summary.nextDifficulty.speed)
    nextGoldElement.textContent = formatDurationMs(summary.nextDifficulty.medalThresholds.goldMs)
  } else {
    previewTitleElement.textContent = 'Field Complete'
    previewSubtitleElement.textContent = 'No higher level remains in this campaign.'
    nextWindowsElement.textContent = '--'
    nextRelaysElement.textContent = '--'
    nextSpeedElement.textContent = '--'
    nextGoldElement.textContent = '--:--.-'
  }

  nextButton.disabled = isCampaignComplete
  nextButton.textContent = isCampaignComplete ? 'Campaign Clear' : `Start Level ${summary.nextLevel}`
  replayButton.textContent = `Replay Level ${summary.clearedLevel}`
  setButtonsDisabled(false, isCampaignComplete)
  statusElement.textContent = isCampaignComplete
    ? 'Campaign complete. Choose a replay or return to the lobby.'
    : 'Choose the next move.'
}

function setBusyState(message: string): void {
  statusElement.textContent = message
  setButtonsDisabled(true)
}

function setButtonsDisabled(disabled: boolean, disableNextOnly = false): void {
  nextButton.disabled = disabled || disableNextOnly
  replayButton.disabled = disabled
  lobbyButton.disabled = disabled
}

function getRecordNote(summary: NonNullable<GameSnapshot['levelSummary']>): string {
  if (summary.isBestTime && summary.isNewMedal) {
    return `New ${formatMedal(summary.bestMedal)} medal and best time.`
  }

  if (summary.isBestTime) {
    return 'New best time.'
  }

  if (summary.isNewMedal) {
    return `${formatMedal(summary.bestMedal)} medal upgraded.`
  }

  if (summary.currentMedal === 'none') {
    return summary.bestMedal === 'none'
      ? 'No medal on this clear.'
      : `${formatMedal(summary.bestMedal)} medal record held.`
  }

  return `${formatMedal(summary.bestMedal)} medal record held.`
}

function formatDurationMs(durationMs: number): string {
  const totalTenths = Math.max(0, Math.round(durationMs / 100))
  const minutes = Math.floor(totalTenths / 600)
  const seconds = Math.floor((totalTenths % 600) / 10)
  const tenths = totalTenths % 10

  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}

function formatSigned(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`
}

function formatMedal(tier: MedalTier): string {
  return tier === 'none' ? 'NONE' : tier.toUpperCase()
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)

  if (!element) {
    throw new Error(`Missing summary element: ${id}`)
  }

  return element as T
}
