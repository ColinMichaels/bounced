import { pointInRect, rectFromWindow } from '../shared/geometry'
import type { BallState, GameSnapshot, ObstacleState, RouteWindowState, WindowBoundsPayload } from '../shared/types'

interface TrailPoint {
  x: number
  y: number
  life: number
}

interface ImpactFlash {
  x: number
  y: number
  life: number
  hue: number
  radius: number
  variant: 'impact' | 'completion'
}

const TRAIL_MAX_POINTS = 22
const TRAIL_DECAY_PER_FRAME = 0.055
const TRAIL_MIN_STEP = 1.5
const TRAIL_LINE_WIDTH = 5
const TRAIL_GLOW_WIDTH = 12
const TRAIL_MAX_OPACITY = 0.34
const IMPACT_DECAY_PER_FRAME = 0.08
const IMPACT_RING_GROWTH = 16
const IMPACT_MAX_FLASHES = 8
const COMPLETION_RING_GROWTH = 24

export class BallRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly trail = new Map<string, TrailPoint[]>()
  private readonly previousBalls = new Map<string, BallState>()
  private impactFlashes: ImpactFlash[] = []
  private lastSnapshot: GameSnapshot | null = null

  constructor(canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Canvas 2D context is unavailable.')
    }

    this.canvas = canvas
    this.context = context
  }

  draw(snapshot: GameSnapshot | null, bounds: WindowBoundsPayload | null): void {
    this.resize()
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    const routeWindow = snapshot && bounds
      ? snapshot.routeWindows.find((windowState) => windowState.id === bounds.id) ?? null
      : null

    this.context.clearRect(0, 0, width, height)
    this.drawBackdrop(width, height, routeWindow)

    if (snapshot && snapshot !== this.lastSnapshot) {
      this.handleSnapshotTransition(this.lastSnapshot, snapshot, bounds)
      this.lastSnapshot = snapshot
    }

    if (!snapshot || !bounds) {
      this.decayEffects()
      return
    }

    const isActive = snapshot.activeWindowIds.includes(bounds.id)
    if (!isActive) {
      this.drawImpactFlashes()
      this.decayEffects()
      this.syncPreviousBalls(snapshot.balls)
      return
    }

    this.drawImpactFlashes()
    const obstacles = snapshot.obstacles.filter((obstacle) => obstacle.windowId === bounds.id && !obstacle.destroyed)
    this.drawObstacles(obstacles, bounds)

    if (snapshot.balls.length === 0) {
      this.drawTarget(snapshot, bounds)
      this.drawScoreNode(snapshot, bounds)
      this.decayEffects()
      this.syncPreviousBalls(snapshot.balls)
      return
    }

    const windowRect = rectFromWindow(bounds)
    this.drawTarget(snapshot, bounds)
    this.drawScoreNode(snapshot, bounds)
    const visibleBalls = snapshot.balls.filter((ball) => pointInRect(ball.x, ball.y, windowRect))
    if (visibleBalls.length === 0) {
      this.decayEffects()
      this.syncPreviousBalls(snapshot.balls)
      return
    }

    for (const ball of visibleBalls) {
      const localX = ball.x - bounds.contentX
      const localY = ball.y - bounds.contentY
      const previousBall = this.previousBalls.get(ball.id)

      this.pushTrail(ball.id, localX, localY)
      this.maybeSpawnImpact(previousBall, ball, localX, localY)
      this.drawTrail(ball.id)
      this.drawBall(localX, localY, ball.radius, ball.hue)
    }

    this.decayEffects()
    this.syncPreviousBalls(snapshot.balls)
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1
    const width = Math.floor(this.canvas.clientWidth * dpr)
    const height = Math.floor(this.canvas.clientHeight * dpr)

    if (this.canvas.width === width && this.canvas.height === height) {
      return
    }

    this.canvas.width = width
    this.canvas.height = height
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private drawBackdrop(width: number, height: number, routeWindow: RouteWindowState | null): void {
    const gradient = this.context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#08111a')
    gradient.addColorStop(1, '#03070d')
    this.context.fillStyle = gradient
    this.context.fillRect(0, 0, width, height)

    const tint = this.getRouteTint(routeWindow)
    if (tint) {
      this.context.fillStyle = tint
      this.context.fillRect(0, 0, width, height)
    }

    this.context.strokeStyle = 'rgba(147, 247, 255, 0.08)'
    this.context.lineWidth = 1

    for (let x = 0; x < width; x += 36) {
      this.context.beginPath()
      this.context.moveTo(x, 0)
      this.context.lineTo(x, height)
      this.context.stroke()
    }

    for (let y = 0; y < height; y += 36) {
      this.context.beginPath()
      this.context.moveTo(0, y)
      this.context.lineTo(width, y)
      this.context.stroke()
    }
  }

  private pushTrail(ballId: string, x: number, y: number): void {
    const trail = this.trail.get(ballId) ?? []
    const head = trail[0]

    if (head) {
      const distance = Math.hypot(x - head.x, y - head.y)
      if (distance < TRAIL_MIN_STEP) {
        return
      }
    }

    trail.unshift({ x, y, life: 1 })
    trail.length = Math.min(trail.length, TRAIL_MAX_POINTS)
    this.trail.set(ballId, trail)
  }

  private decayEffects(): void {
    for (const [ballId, trail] of this.trail) {
      for (const point of trail) {
        point.life -= TRAIL_DECAY_PER_FRAME
      }

      const nextTrail = trail.filter((point) => point.life > 0)
      if (nextTrail.length === 0) {
        this.trail.delete(ballId)
      } else {
        this.trail.set(ballId, nextTrail)
      }
    }

    this.impactFlashes = this.impactFlashes
      .map((flash) => ({
        ...flash,
        life: flash.life - IMPACT_DECAY_PER_FRAME,
      }))
      .filter((flash) => flash.life > 0)
  }

  private drawTrail(ballId: string): void {
    const trail = this.trail.get(ballId)
    if (!trail || trail.length < 2) {
      return
    }

    this.context.save()
    this.context.lineCap = 'round'
    this.context.lineJoin = 'round'

    for (let index = 0; index < trail.length - 1; index += 1) {
      const point = trail[index]
      const nextPoint = trail[index + 1]
      const life = Math.min(point.life, nextPoint.life)
      const alpha = life * TRAIL_MAX_OPACITY

      this.context.beginPath()
      this.context.lineWidth = Math.max(2, TRAIL_GLOW_WIDTH - (index * 0.45))
      this.context.strokeStyle = `rgba(110, 243, 255, ${alpha * 0.42})`
      this.context.shadowBlur = 14
      this.context.shadowColor = 'rgba(108, 239, 255, 0.36)'
      this.context.moveTo(point.x, point.y)
      this.context.lineTo(nextPoint.x, nextPoint.y)
      this.context.stroke()

      this.context.beginPath()
      this.context.lineWidth = Math.max(1.5, TRAIL_LINE_WIDTH - (index * 0.22))
      this.context.strokeStyle = `rgba(219, 251, 255, ${alpha})`
      this.context.shadowBlur = 0
      this.context.moveTo(point.x, point.y)
      this.context.lineTo(nextPoint.x, nextPoint.y)
      this.context.stroke()
    }

    this.context.restore()
  }

  private drawObstacles(obstacles: ObstacleState[], bounds: WindowBoundsPayload): void {
    if (obstacles.length === 0) {
      return
    }

    this.context.save()

    for (const obstacle of obstacles) {
      const localX = obstacle.x - bounds.contentX
      const localY = obstacle.y - bounds.contentY
      const stripeOffset = (obstacle.width + obstacle.height) % 14

      this.context.fillStyle = 'rgba(12, 22, 34, 0.9)'
      this.context.strokeStyle = 'rgba(108, 239, 255, 0.22)'
      this.context.lineWidth = 1.5
      this.context.shadowBlur = 10
      this.context.shadowColor = 'rgba(108, 239, 255, 0.12)'
      this.context.beginPath()
      this.context.roundRect(localX, localY, obstacle.width, obstacle.height, 10)
      this.context.fill()
      this.context.stroke()

      this.context.shadowBlur = 0
      this.context.save()
      this.context.beginPath()
      this.context.roundRect(localX, localY, obstacle.width, obstacle.height, 10)
      this.context.clip()
      this.context.strokeStyle = 'rgba(147, 247, 255, 0.14)'
      this.context.lineWidth = 2

      for (let stripeX = localX - obstacle.height + stripeOffset; stripeX < localX + obstacle.width + obstacle.height; stripeX += 12) {
        this.context.beginPath()
        this.context.moveTo(stripeX, localY + obstacle.height)
        this.context.lineTo(stripeX + obstacle.height, localY)
        this.context.stroke()
      }

      this.context.restore()

      this.context.fillStyle = 'rgba(216, 248, 255, 0.12)'
      this.context.beginPath()
      this.context.roundRect(localX + 4, localY + 4, Math.max(0, obstacle.width - 8), Math.max(0, obstacle.height * 0.18), 6)
      this.context.fill()
    }

    this.context.restore()
  }

  private maybeSpawnImpact(previousBall: BallState | undefined, ball: BallState, x: number, y: number): void {
    if (!previousBall) {
      return
    }

    const bouncedX = previousBall.vx !== 0 && ball.vx !== 0 && Math.sign(previousBall.vx) !== Math.sign(ball.vx)
    const bouncedY = previousBall.vy !== 0 && ball.vy !== 0 && Math.sign(previousBall.vy) !== Math.sign(ball.vy)

    if (!bouncedX && !bouncedY) {
      return
    }

    const offset = ball.radius + 6
    const impactX = bouncedX
      ? x + (ball.vx > 0 ? -offset : offset)
      : x
    const impactY = bouncedY
      ? y + (ball.vy > 0 ? -offset : offset)
      : y

    this.impactFlashes.unshift({
      x: impactX,
      y: impactY,
      life: 1,
      hue: ball.hue,
      radius: ball.radius + (bouncedX && bouncedY ? 7 : 3),
      variant: 'impact',
    })
    this.impactFlashes.length = Math.min(this.impactFlashes.length, IMPACT_MAX_FLASHES)
  }

  private handleSnapshotTransition(
    previousSnapshot: GameSnapshot | null,
    nextSnapshot: GameSnapshot,
    bounds: WindowBoundsPayload | null,
  ): void {
    if (!previousSnapshot || !bounds) {
      return
    }

    this.handleObstacleTransition(previousSnapshot, nextSnapshot, bounds)
    this.handleScoreNodeTransition(previousSnapshot, nextSnapshot, bounds)

    if (previousSnapshot.phase !== 'running' || nextSnapshot.phase === 'idle') {
      return
    }

    const previousTarget = previousSnapshot.activeTarget
    if (!previousTarget || previousTarget.windowId !== bounds.id) {
      return
    }

    const relayCompleted = nextSnapshot.completedBridgeWindowIds.length > previousSnapshot.completedBridgeWindowIds.length
    const levelCompleted = nextSnapshot.completedLevels.length > previousSnapshot.completedLevels.length

    if (!relayCompleted && !levelCompleted) {
      return
    }

    this.spawnCompletionFlash(
      previousTarget.x - bounds.contentX,
      previousTarget.y - bounds.contentY,
      previousTarget.radius,
      previousTarget.kind === 'goal',
    )
  }

  private spawnCompletionFlash(x: number, y: number, radius: number, isGoal: boolean): void {
    this.impactFlashes.unshift({
      x,
      y,
      life: 1,
      hue: isGoal ? 42 : 188,
      radius: radius + (isGoal ? 10 : 6),
      variant: 'completion',
    })
    this.impactFlashes.length = Math.min(this.impactFlashes.length, IMPACT_MAX_FLASHES)
  }

  private spawnScoreFlash(x: number, y: number, radius: number): void {
    this.impactFlashes.unshift({
      x,
      y,
      life: 1,
      hue: 118,
      radius: radius + 8,
      variant: 'completion',
    })
    this.impactFlashes.length = Math.min(this.impactFlashes.length, IMPACT_MAX_FLASHES)
  }

  private handleObstacleTransition(
    previousSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    bounds: WindowBoundsPayload,
  ): void {
    const previousObstacles = previousSnapshot.obstacles.filter((obstacle) => obstacle.windowId === bounds.id)
    if (previousObstacles.length === 0) {
      return
    }

    for (const previousObstacle of previousObstacles) {
      const nextObstacle = nextSnapshot.obstacles.find((obstacle) => obstacle.id === previousObstacle.id)
      if (!nextObstacle || nextObstacle.hitPoints >= previousObstacle.hitPoints) {
        continue
      }

      const centerX = previousObstacle.x - bounds.contentX + (previousObstacle.width / 2)
      const centerY = previousObstacle.y - bounds.contentY + (previousObstacle.height / 2)
      const radius = Math.max(previousObstacle.width, previousObstacle.height) * 0.32

      this.impactFlashes.unshift({
        x: centerX,
        y: centerY,
        life: 1,
        hue: nextObstacle.destroyed ? 182 : 24,
        radius,
        variant: nextObstacle.destroyed ? 'completion' : 'impact',
      })
    }

    this.impactFlashes.length = Math.min(this.impactFlashes.length, IMPACT_MAX_FLASHES)
  }

  private handleScoreNodeTransition(
    previousSnapshot: GameSnapshot,
    nextSnapshot: GameSnapshot,
    bounds: WindowBoundsPayload,
  ): void {
    const previousScoreNode = previousSnapshot.activeScoreNode
    if (!previousScoreNode || previousScoreNode.windowId !== bounds.id) {
      return
    }

    const nextScoreNode = nextSnapshot.activeScoreNode
    const collectedHere = nextSnapshot.score > previousSnapshot.score
      && (!nextScoreNode || nextScoreNode.windowId !== bounds.id)

    if (!collectedHere) {
      return
    }

    this.spawnScoreFlash(
      previousScoreNode.x - bounds.contentX,
      previousScoreNode.y - bounds.contentY,
      previousScoreNode.radius,
    )
  }

  private drawImpactFlashes(): void {
    if (this.impactFlashes.length === 0) {
      return
    }

    this.context.save()

    for (const flash of this.impactFlashes) {
      const isCompletion = flash.variant === 'completion'
      const ringRadius = flash.radius + ((1 - flash.life) * (isCompletion ? COMPLETION_RING_GROWTH : IMPACT_RING_GROWTH))
      const coreAlpha = flash.life * (isCompletion ? 0.42 : 0.28)
      const ringAlpha = flash.life * (isCompletion ? 0.8 : 0.62)

      this.context.beginPath()
      this.context.fillStyle = isCompletion
        ? `hsla(${flash.hue}, 100%, 78%, ${coreAlpha})`
        : `rgba(221, 252, 255, ${coreAlpha})`
      this.context.shadowBlur = isCompletion ? 24 : 18
      this.context.shadowColor = `hsla(${flash.hue}, 100%, 72%, ${isCompletion ? 0.58 : 0.45})`
      this.context.arc(flash.x, flash.y, Math.max(2, flash.radius * (isCompletion ? (0.45 + (flash.life * 0.7)) : flash.life)), 0, Math.PI * 2)
      this.context.fill()

      this.context.beginPath()
      this.context.lineWidth = Math.max(1.5, flash.life * (isCompletion ? 5.5 : 4))
      this.context.strokeStyle = `hsla(${flash.hue}, 100%, 72%, ${ringAlpha})`
      this.context.shadowBlur = isCompletion ? 14 : 10
      this.context.shadowColor = `hsla(${flash.hue}, 100%, 72%, ${isCompletion ? 0.42 : 0.32})`
      this.context.arc(flash.x, flash.y, ringRadius, 0, Math.PI * 2)
      this.context.stroke()

      if (isCompletion) {
        this.context.beginPath()
        this.context.lineWidth = Math.max(1, flash.life * 2.5)
        this.context.strokeStyle = `hsla(${flash.hue}, 100%, 84%, ${flash.life * 0.52})`
        this.context.shadowBlur = 0
        this.context.arc(flash.x, flash.y, ringRadius * 0.68, 0, Math.PI * 2)
        this.context.stroke()
      }
    }

    this.context.restore()
  }

  private syncPreviousBalls(balls: BallState[]): void {
    const next = new Map<string, BallState>()

    for (const ball of balls) {
      next.set(ball.id, { ...ball })
    }

    this.previousBalls.clear()
    for (const [ballId, ball] of next) {
      this.previousBalls.set(ballId, ball)
    }
  }

  private drawBall(x: number, y: number, radius: number, hue: number): void {
    const gradient = this.context.createRadialGradient(
      x - (radius * 0.3),
      y - (radius * 0.3),
      radius * 0.15,
      x,
      y,
      radius,
    )

    gradient.addColorStop(0, 'rgba(255, 255, 255, 0.98)')
    gradient.addColorStop(1, `hsla(${hue}, 100%, 66%, 1)`)

    this.context.beginPath()
    this.context.fillStyle = gradient
    this.context.arc(x, y, radius, 0, Math.PI * 2)
    this.context.fill()

    this.context.beginPath()
    this.context.lineWidth = 3
    this.context.strokeStyle = 'rgba(147, 247, 255, 0.5)'
    this.context.arc(x, y, radius + 6, 0, Math.PI * 2)
    this.context.stroke()
  }

  private drawTarget(snapshot: GameSnapshot, bounds: WindowBoundsPayload): void {
    if (!snapshot.activeTarget || snapshot.activeTarget.windowId !== bounds.id) {
      return
    }

    const x = snapshot.activeTarget.x - bounds.contentX
    const y = snapshot.activeTarget.y - bounds.contentY
    const radius = snapshot.activeTarget.radius
    const isGoal = snapshot.activeTarget.kind === 'goal'

    this.context.save()

    this.context.beginPath()
    this.context.strokeStyle = isGoal ? 'rgba(255, 214, 122, 0.92)' : 'rgba(108, 239, 255, 0.92)'
    this.context.lineWidth = 2
    this.context.arc(x, y, radius + 10, 0, Math.PI * 2)
    this.context.stroke()

    this.context.beginPath()
    this.context.strokeStyle = isGoal ? 'rgba(255, 214, 122, 0.46)' : 'rgba(108, 239, 255, 0.42)'
    this.context.lineWidth = 6
    this.context.arc(x, y, radius, 0, Math.PI * 2)
    this.context.stroke()

    this.context.beginPath()
    this.context.fillStyle = isGoal ? 'rgba(255, 214, 122, 0.18)' : 'rgba(108, 239, 255, 0.16)'
    this.context.arc(x, y, radius - 6, 0, Math.PI * 2)
    this.context.fill()

    this.context.fillStyle = isGoal ? 'rgba(255, 238, 202, 0.88)' : 'rgba(224, 252, 255, 0.9)'
    this.context.font = '600 11px "SF Mono", "IBM Plex Mono", monospace'
    this.context.textAlign = 'center'
    this.context.fillText(snapshot.activeTarget.label, x, y + 4)
    this.context.restore()
  }

  private drawScoreNode(snapshot: GameSnapshot, bounds: WindowBoundsPayload): void {
    if (!snapshot.activeScoreNode || snapshot.activeScoreNode.windowId !== bounds.id) {
      return
    }

    const x = snapshot.activeScoreNode.x - bounds.contentX
    const y = snapshot.activeScoreNode.y - bounds.contentY
    const radius = snapshot.activeScoreNode.radius
    const pulse = 0.72 + (((Math.sin(Date.now() / 240) + 1) * 0.5) * 0.28)

    this.context.save()
    this.context.translate(x, y)

    this.context.beginPath()
    this.context.fillStyle = `rgba(118, 255, 176, ${0.12 * pulse})`
    this.context.shadowBlur = 18
    this.context.shadowColor = 'rgba(118, 255, 176, 0.32)'
    this.context.arc(0, 0, radius + 10, 0, Math.PI * 2)
    this.context.fill()

    this.context.shadowBlur = 0
    this.context.beginPath()
    this.context.moveTo(0, -radius - 6)
    this.context.lineTo(radius + 6, 0)
    this.context.lineTo(0, radius + 6)
    this.context.lineTo(-radius - 6, 0)
    this.context.closePath()
    this.context.fillStyle = 'rgba(118, 255, 176, 0.16)'
    this.context.strokeStyle = 'rgba(168, 255, 206, 0.92)'
    this.context.lineWidth = 2
    this.context.fill()
    this.context.stroke()

    this.context.beginPath()
    this.context.moveTo(0, -radius + 2)
    this.context.lineTo(radius - 2, 0)
    this.context.lineTo(0, radius - 2)
    this.context.lineTo(-radius + 2, 0)
    this.context.closePath()
    this.context.fillStyle = 'rgba(12, 30, 22, 0.88)'
    this.context.fill()

    this.context.fillStyle = 'rgba(220, 255, 233, 0.96)'
    this.context.font = '700 11px "SF Mono", "IBM Plex Mono", monospace'
    this.context.textAlign = 'center'
    this.context.fillText(snapshot.activeScoreNode.label, 0, 4)

    this.context.restore()
  }

  private getRouteTint(routeWindow: RouteWindowState | null): string | null {
    if (!routeWindow) {
      return null
    }

    if (routeWindow.role === 'start') {
      return 'rgba(77, 207, 255, 0.08)'
    }

    if (routeWindow.role === 'goal') {
      return routeWindow.status === 'active'
        ? 'rgba(255, 201, 116, 0.12)'
        : 'rgba(255, 201, 116, 0.05)'
    }

    if (routeWindow.status === 'active') {
      return 'rgba(98, 239, 255, 0.1)'
    }

    if (routeWindow.status === 'cleared') {
      return 'rgba(121, 255, 191, 0.08)'
    }

    return 'rgba(115, 150, 176, 0.07)'
  }
}
