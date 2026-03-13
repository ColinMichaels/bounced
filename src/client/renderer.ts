import { pointInRect, rectFromWindow } from '../shared/geometry'
import type { GameSnapshot, RouteWindowState, WindowBoundsPayload } from '../shared/types'

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
    const routeWindow = snapshot && bounds
      ? snapshot.routeWindows.find((windowState) => windowState.id === bounds.id) ?? null
      : null

    this.context.clearRect(0, 0, width, height)
    this.drawBackdrop(width, height, routeWindow)

    if (!snapshot || !bounds) {
      return
    }

    const isActive = snapshot.activeWindowIds.includes(bounds.id)
    if (!isActive) {
      this.decayTrails()
      return
    }

    if (snapshot.balls.length === 0) {
      this.drawTarget(snapshot, bounds)
      this.decayTrails()
      return
    }

    const windowRect = rectFromWindow(bounds)
    this.drawTarget(snapshot, bounds)
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

  private drawTarget(snapshot: GameSnapshot, bounds: WindowBoundsPayload): void {
    if (!snapshot.activeTarget || snapshot.activeTarget.windowId !== bounds.id) {
      return
    }

    const x = snapshot.activeTarget.x - bounds.contentX
    const y = snapshot.activeTarget.y - bounds.contentY
    const radius = snapshot.activeTarget.radius
    const isGoal = snapshot.activeTarget.kind === 'goal'

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
