import { pointInRect, rectFromWindow } from '../shared/geometry'
import type { BallState, GameSnapshot, WindowBoundsPayload } from '../shared/types'

interface TrailPoint {
  x: number
  y: number
  life: number
}

export class BallRenderer {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly trail = new Map<string, TrailPoint[]>()

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

    this.context.clearRect(0, 0, width, height)
    this.drawBackdrop(width, height)

    if (!snapshot || !bounds) {
      this.drawMessage(width, height, 'Waiting for synchronization...')
      return
    }

    const isActive = snapshot.activeWindowIds.includes(bounds.id)
    if (!isActive) {
      this.drawStandby(width, height)
      return
    }

    if (snapshot.balls.length === 0) {
      this.drawGoal(snapshot, bounds)
      this.drawMessage(width, height, snapshot.phase === 'waiting' ? 'Waiting for field...' : 'Respawning...')
      return
    }

    const windowRect = rectFromWindow(bounds)
    this.drawGoal(snapshot, bounds)
    const visibleBalls = snapshot.balls.filter((ball) => pointInRect(ball.x, ball.y, windowRect))
    if (visibleBalls.length === 0) {
      this.decayTrails()
      return
    }

    for (const ball of visibleBalls) {
      const localX = ball.x - bounds.contentX
      const localY = ball.y - bounds.contentY

      this.pushTrail(ball.id, localX, localY)
      this.drawTrail(ball.id)
      this.drawBall(localX, localY, ball.radius, ball.hue)
    }

    this.decayTrails()
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

  private drawBackdrop(width: number, height: number): void {
    const gradient = this.context.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#08111a')
    gradient.addColorStop(1, '#03070d')
    this.context.fillStyle = gradient
    this.context.fillRect(0, 0, width, height)

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

  private drawStandby(width: number, height: number): void {
    this.drawMessage(width, height, 'Stand by. This window activates at higher difficulty.')
  }

  private drawMessage(width: number, height: number, message: string): void {
    this.context.fillStyle = 'rgba(221, 239, 255, 0.82)'
    this.context.font = '600 16px "SF Mono", "IBM Plex Mono", monospace'
    this.context.textAlign = 'center'
    this.context.fillText(message, width / 2, height / 2)
  }

  private pushTrail(ballId: string, x: number, y: number): void {
    const trail = this.trail.get(ballId) ?? []
    trail.unshift({ x, y, life: 1 })
    trail.length = Math.min(trail.length, 12)
    this.trail.set(ballId, trail)
  }

  private decayTrails(): void {
    for (const [ballId, trail] of this.trail) {
      for (const point of trail) {
        point.life -= 0.1
      }

      const nextTrail = trail.filter((point) => point.life > 0)
      if (nextTrail.length === 0) {
        this.trail.delete(ballId)
      } else {
        this.trail.set(ballId, nextTrail)
      }
    }
  }

  private drawTrail(ballId: string): void {
    const trail = this.trail.get(ballId)
    if (!trail) {
      return
    }

    trail.forEach((point, index) => {
      this.context.beginPath()
      this.context.fillStyle = `rgba(147, 247, 255, ${point.life * 0.16})`
      this.context.arc(point.x, point.y, Math.max(4, 12 - index), 0, Math.PI * 2)
      this.context.fill()
    })
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

  private drawGoal(snapshot: GameSnapshot, bounds: WindowBoundsPayload): void {
    if (!snapshot.goal || snapshot.goal.windowId !== bounds.id) {
      return
    }

    const x = snapshot.goal.x - bounds.contentX
    const y = snapshot.goal.y - bounds.contentY
    const radius = snapshot.goal.radius

    this.context.beginPath()
    this.context.strokeStyle = 'rgba(255, 214, 122, 0.92)'
    this.context.lineWidth = 2
    this.context.arc(x, y, radius + 10, 0, Math.PI * 2)
    this.context.stroke()

    this.context.beginPath()
    this.context.strokeStyle = 'rgba(255, 214, 122, 0.46)'
    this.context.lineWidth = 6
    this.context.arc(x, y, radius, 0, Math.PI * 2)
    this.context.stroke()

    this.context.beginPath()
    this.context.fillStyle = 'rgba(255, 214, 122, 0.18)'
    this.context.arc(x, y, radius - 6, 0, Math.PI * 2)
    this.context.fill()

    this.context.fillStyle = 'rgba(255, 238, 202, 0.88)'
    this.context.font = '600 11px "SF Mono", "IBM Plex Mono", monospace'
    this.context.textAlign = 'center'
    this.context.fillText('GOAL', x, y + 4)
  }
}
