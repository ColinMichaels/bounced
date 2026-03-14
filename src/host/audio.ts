import type { BallState, GameSnapshot } from '../shared/types'

const MASTER_VOLUME = 0.18
const WALL_COOLDOWN_MS = 60
const BARRIER_COOLDOWN_MS = 70
const BONUS_COOLDOWN_MS = 160
const RELAY_COOLDOWN_MS = 220
const GOAL_COOLDOWN_MS = 320

export class HostAudioEngine {
  private context: AudioContext | null = null
  private masterGain: GainNode | null = null
  private noiseBuffer: AudioBuffer | null = null
  private previousSnapshot: GameSnapshot | null = null
  private lastWallAt = 0
  private lastBarrierAt = 0
  private lastBonusAt = 0
  private lastRelayAt = 0
  private lastGoalAt = 0

  unlock(): void {
    const context = this.ensureContext()
    if (context.state === 'suspended') {
      void context.resume()
    }
  }

  pause(): void {
    if (!this.context || this.context.state !== 'running') {
      return
    }

    void this.context.suspend()
  }

  resume(): void {
    if (!this.context || this.context.state !== 'suspended') {
      return
    }

    void this.context.resume()
  }

  dispose(): void {
    this.previousSnapshot = null

    if (!this.context) {
      return
    }

    void this.context.close()
    this.context = null
    this.masterGain = null
    this.noiseBuffer = null
  }

  handleSnapshot(snapshot: GameSnapshot): void {
    const previousSnapshot = this.previousSnapshot
    this.previousSnapshot = snapshot

    if (!previousSnapshot || !this.isReady()) {
      return
    }

    this.handleWallBounce(previousSnapshot.ball, snapshot.ball)
    this.handleBarrierBreak(previousSnapshot, snapshot)
    this.handleBonusCollect(previousSnapshot, snapshot)
    this.handleRouteCompletion(previousSnapshot, snapshot)
  }

  private handleWallBounce(previousBall: BallState | null, nextBall: BallState | null): void {
    if (!previousBall || !nextBall || previousBall.id !== nextBall.id) {
      return
    }

    const bouncedX = previousBall.vx !== 0 && nextBall.vx !== 0 && Math.sign(previousBall.vx) !== Math.sign(nextBall.vx)
    const bouncedY = previousBall.vy !== 0 && nextBall.vy !== 0 && Math.sign(previousBall.vy) !== Math.sign(nextBall.vy)
    if (!bouncedX && !bouncedY) {
      return
    }

    const now = performance.now()
    if (now - this.lastWallAt < WALL_COOLDOWN_MS) {
      return
    }

    this.lastWallAt = now
    this.playWallHit(bouncedX && bouncedY ? 1 : 0.84)
  }

  private handleBarrierBreak(previousSnapshot: GameSnapshot, nextSnapshot: GameSnapshot): void {
    const barrierBroken = previousSnapshot.obstacles.some((previousObstacle) => {
      const nextObstacle = nextSnapshot.obstacles.find((obstacle) => obstacle.id === previousObstacle.id)
      return !!nextObstacle && nextObstacle.hitPoints < previousObstacle.hitPoints
    })
    if (!barrierBroken) {
      return
    }

    const now = performance.now()
    if (now - this.lastBarrierAt < BARRIER_COOLDOWN_MS) {
      return
    }

    this.lastBarrierAt = now
    this.playBarrierBreak()
  }

  private handleBonusCollect(previousSnapshot: GameSnapshot, nextSnapshot: GameSnapshot): void {
    if (nextSnapshot.bonusCollectionCount <= previousSnapshot.bonusCollectionCount) {
      return
    }

    const now = performance.now()
    if (now - this.lastBonusAt < BONUS_COOLDOWN_MS) {
      return
    }

    this.lastBonusAt = now
    this.playBonusCollect()
  }

  private handleRouteCompletion(previousSnapshot: GameSnapshot, nextSnapshot: GameSnapshot): void {
    const now = performance.now()

    if (nextSnapshot.completedLevels.length > previousSnapshot.completedLevels.length) {
      if (now - this.lastGoalAt >= GOAL_COOLDOWN_MS) {
        this.lastGoalAt = now
        this.playGoalClear()
      }
      return
    }

    if (nextSnapshot.completedBridgeWindowIds.length > previousSnapshot.completedBridgeWindowIds.length) {
      if (now - this.lastRelayAt >= RELAY_COOLDOWN_MS) {
        this.lastRelayAt = now
        this.playRelayCollect()
      }
    }
  }

  private playWallHit(intensity: number): void {
    this.playTone(760, 280, 0.08, 'triangle', 0.04 * intensity)
    this.playTone(1100, 740, 0.05, 'sine', 0.016 * intensity, 0.01)
  }

  private playBarrierBreak(): void {
    this.playNoise(0.1, 0.06, 520)
    this.playTone(220, 86, 0.12, 'square', 0.035)
  }

  private playBonusCollect(): void {
    this.playTone(540, 880, 0.14, 'triangle', 0.034)
    this.playTone(760, 1240, 0.14, 'sine', 0.026, 0.05)
  }

  private playRelayCollect(): void {
    this.playTone(320, 640, 0.16, 'triangle', 0.036)
    this.playTone(520, 920, 0.18, 'sine', 0.03, 0.05)
  }

  private playGoalClear(): void {
    this.playTone(220, 330, 0.42, 'triangle', 0.03)
    this.playTone(330, 494, 0.42, 'sine', 0.026, 0.03)
    this.playTone(440, 660, 0.46, 'triangle', 0.022, 0.06)
  }

  private playTone(
    startFrequency: number,
    endFrequency: number,
    durationSeconds: number,
    type: OscillatorType,
    peakGain: number,
    offsetSeconds = 0,
  ): void {
    const context = this.context
    const masterGain = this.masterGain
    if (!context || !masterGain || context.state !== 'running') {
      return
    }

    const startedAt = context.currentTime + offsetSeconds
    const oscillator = context.createOscillator()
    const gain = context.createGain()

    oscillator.type = type
    oscillator.frequency.setValueAtTime(startFrequency, startedAt)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(24, endFrequency), startedAt + durationSeconds)

    gain.gain.setValueAtTime(0.0001, startedAt)
    gain.gain.linearRampToValueAtTime(peakGain, startedAt + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + durationSeconds)

    oscillator.connect(gain)
    gain.connect(masterGain)
    oscillator.start(startedAt)
    oscillator.stop(startedAt + durationSeconds + 0.03)
  }

  private playNoise(durationSeconds: number, peakGain: number, highpassFrequency: number): void {
    const context = this.context
    const masterGain = this.masterGain
    if (!context || !masterGain || context.state !== 'running') {
      return
    }

    const buffer = this.getNoiseBuffer(context)
    const source = context.createBufferSource()
    const filter = context.createBiquadFilter()
    const gain = context.createGain()
    const startedAt = context.currentTime

    source.buffer = buffer
    filter.type = 'highpass'
    filter.frequency.setValueAtTime(highpassFrequency, startedAt)

    gain.gain.setValueAtTime(0.0001, startedAt)
    gain.gain.linearRampToValueAtTime(peakGain, startedAt + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, startedAt + durationSeconds)

    source.connect(filter)
    filter.connect(gain)
    gain.connect(masterGain)
    source.start(startedAt)
    source.stop(startedAt + durationSeconds + 0.02)
  }

  private getNoiseBuffer(context: AudioContext): AudioBuffer {
    if (this.noiseBuffer) {
      return this.noiseBuffer
    }

    const frameCount = Math.floor(context.sampleRate * 0.25)
    const buffer = context.createBuffer(1, frameCount, context.sampleRate)
    const channel = buffer.getChannelData(0)

    for (let index = 0; index < frameCount; index += 1) {
      channel[index] = (Math.random() * 2) - 1
    }

    this.noiseBuffer = buffer
    return buffer
  }

  private ensureContext(): AudioContext {
    if (this.context && this.masterGain) {
      return this.context
    }

    const context = new AudioContext()
    const masterGain = context.createGain()
    masterGain.gain.value = MASTER_VOLUME
    masterGain.connect(context.destination)

    this.context = context
    this.masterGain = masterGain
    return context
  }

  private isReady(): boolean {
    return !!this.context && !!this.masterGain && this.context.state === 'running'
  }
}
