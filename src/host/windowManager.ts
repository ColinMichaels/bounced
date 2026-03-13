import { WINDOW_POOL_GAP } from '../shared/constants'

interface PopupLayout {
  left: number
  top: number
  width: number
  height: number
}

export interface PopupHandle {
  id: string
  slot: number
  title: string
  ref: Window | null
  layout: PopupLayout | null
}

interface LayoutBounds {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

interface LayoutOptions {
  relayout?: boolean
}

const LEVEL_WINDOW_SHAPES: Record<number, Array<{ width: number; height: number }>> = {
  1: [
    { width: 470, height: 330 },
    { width: 410, height: 380 },
    { width: 360, height: 430 },
  ],
  2: [
    { width: 430, height: 300 },
    { width: 360, height: 360 },
    { width: 320, height: 410 },
  ],
  3: [
    { width: 390, height: 280 },
    { width: 340, height: 330 },
    { width: 300, height: 380 },
  ],
  4: [
    { width: 360, height: 250 },
    { width: 300, height: 320 },
    { width: 270, height: 360 },
  ],
  5: [
    { width: 330, height: 230 },
    { width: 290, height: 290 },
    { width: 250, height: 340 },
  ],
  6: [
    { width: 310, height: 220 },
    { width: 270, height: 270 },
    { width: 240, height: 320 },
  ],
  7: [
    { width: 290, height: 210 },
    { width: 250, height: 255 },
    { width: 220, height: 300 },
  ],
  8: [
    { width: 270, height: 200 },
    { width: 230, height: 240 },
    { width: 210, height: 280 },
  ],
}

const SCREEN_MARGIN = 28
const GAP_BY_LEVEL: Record<number, number> = {
  1: WINDOW_POOL_GAP + 64,
  2: WINDOW_POOL_GAP + 48,
  3: WINDOW_POOL_GAP + 40,
  4: WINDOW_POOL_GAP + 32,
  5: WINDOW_POOL_GAP + 28,
  6: WINDOW_POOL_GAP + 24,
  7: WINDOW_POOL_GAP + 22,
  8: WINDOW_POOL_GAP + 20,
}
const RELAYOUT_SCALES = [1, 0.94, 0.88, 0.82]

export class WindowManager {
  private readonly handles = new Map<string, PopupHandle>()

  constructor(
    private readonly hostWindow: Window,
    private readonly channelName: string,
    private readonly sessionId: string,
  ) {}

  ensureWindowPool(count: number, level: number, options: LayoutOptions = {}): PopupHandle[] {
    const handles: PopupHandle[] = []
    const retiredIds: string[] = []

    for (const handle of this.handles.values()) {
      if (handle.slot >= count) {
        handle.ref?.close()
        retiredIds.push(handle.id)
      }
    }

    for (const id of retiredIds) {
      this.handles.delete(id)
    }

    const relayout = options.relayout ?? false
    const layouts = count > 0 && (relayout || this.hasMissingWindow(count))
      ? this.createRandomLayouts(count, level)
      : []
    const fallbackLayouts = layouts.length === 0 && count > 0
      ? this.createFallbackLayouts(count, level)
      : []

    for (let slot = 0; slot < count; slot += 1) {
      const id = `play-window-${slot + 1}`
      const title = `Room ${slot + 1}`
      const existing = this.handles.get(id)
      const layout = layouts[slot] ?? existing?.layout ?? fallbackLayouts[slot]

      if (existing?.ref && !existing.ref.closed) {
        if (relayout && layout) {
          this.applyLayout(existing.ref, layout)
          existing.layout = layout
        }

        handles.push(existing)
        continue
      }

      const url = new URL('./client.html', this.hostWindow.location.href)
      url.searchParams.set('channel', this.channelName)
      url.searchParams.set('session', this.sessionId)
      url.searchParams.set('id', id)
      url.searchParams.set('slot', String(slot))
      url.searchParams.set('title', title)

      const features = [
        `width=${Math.round(layout.width)}`,
        `height=${Math.round(layout.height)}`,
        `left=${Math.round(layout.left)}`,
        `top=${Math.round(layout.top)}`,
        'popup=yes',
        'resizable=yes',
        'scrollbars=no',
        'toolbar=no',
        'location=no',
        'menubar=no',
        'status=no',
      ].join(',')

      const ref = this.hostWindow.open(url.toString(), id, features)
      if (ref) {
        this.applyLayout(ref, layout)
      }

      const handle: PopupHandle = {
        id,
        slot,
        title,
        ref,
        layout,
      }
      this.handles.set(id, handle)
      handles.push(handle)
    }

    return handles
  }

  getOpenCount(): number {
    let total = 0

    for (const handle of this.handles.values()) {
      if (handle.ref && !handle.ref.closed) {
        total += 1
      }
    }

    return total
  }

  focusWindow(id: string): boolean {
    const handle = this.handles.get(id)
    if (!handle?.ref || handle.ref.closed) {
      return false
    }

    handle.ref.focus()
    return true
  }

  recallAll(preferredId: string | null = null): void {
    const openHandles = [...this.handles.values()]
      .filter((handle) => handle.ref && !handle.ref.closed)
      .sort((left, right) => left.slot - right.slot)

    for (const handle of openHandles) {
      if (handle.id === preferredId) {
        continue
      }

      handle.ref?.focus()
    }

    if (preferredId) {
      this.focusWindow(preferredId)
    }
  }

  closeAll(): void {
    for (const handle of this.handles.values()) {
      handle.ref?.close()
    }

    this.handles.clear()
  }

  private hasMissingWindow(count: number): boolean {
    for (let slot = 0; slot < count; slot += 1) {
      const id = `play-window-${slot + 1}`
      const handle = this.handles.get(id)
      if (!handle?.ref || handle.ref.closed) {
        return true
      }
    }

    return false
  }

  private createRandomLayouts(count: number, level: number): PopupLayout[] {
    const bounds = this.getLayoutBounds()

    for (const scale of RELAYOUT_SCALES) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const layouts: PopupLayout[] = []
        let placedAll = true

        for (let slot = 0; slot < count; slot += 1) {
          const size = this.pickWindowSize(level, scale)
          const width = Math.min(size.width, bounds.width - 8)
          const height = Math.min(size.height, bounds.height - 8)
          let placed = false

          for (let candidateAttempt = 0; candidateAttempt < 120; candidateAttempt += 1) {
            const candidate = {
              left: randomBetween(bounds.left, bounds.right - width),
              top: randomBetween(bounds.top, bounds.bottom - height),
              width,
              height,
            }

            if (this.intersectsExisting(candidate, layouts, GAP_BY_LEVEL[level] * scale)) {
              continue
            }

            layouts.push(candidate)
            placed = true
            break
          }

          if (!placed) {
            placedAll = false
            break
          }
        }

        if (placedAll) {
          return layouts
        }
      }
    }

    return this.createFallbackLayouts(count, level)
  }

  private createFallbackLayouts(count: number, level: number): PopupLayout[] {
    const bounds = this.getLayoutBounds()
    const gap = GAP_BY_LEVEL[level] * 0.6
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
    const rows = Math.max(1, Math.ceil(count / columns))
    const cellWidth = Math.max(220, (bounds.width - (gap * (columns - 1))) / columns)
    const cellHeight = Math.max(190, (bounds.height - (gap * (rows - 1))) / rows)
    const layouts: PopupLayout[] = []

    for (let slot = 0; slot < count; slot += 1) {
      const column = slot % columns
      const row = Math.floor(slot / columns)
      const size = this.pickWindowSize(level, 0.78)
      const width = Math.min(size.width, cellWidth - 12)
      const height = Math.min(size.height, cellHeight - 12)
      const maxLeft = bounds.left + (column * (cellWidth + gap)) + Math.max(0, cellWidth - width)
      const maxTop = bounds.top + (row * (cellHeight + gap)) + Math.max(0, cellHeight - height)

      layouts.push({
        left: maxLeft,
        top: maxTop,
        width,
        height,
      })
    }

    return layouts
  }

  private pickWindowSize(level: number, scale: number): { width: number; height: number } {
    const shapes = LEVEL_WINDOW_SHAPES[level] ?? LEVEL_WINDOW_SHAPES[1]
    const shape = shapes[Math.floor(Math.random() * shapes.length)]
    const jitter = level === 1 ? 28 : 22

    return {
      width: Math.round((shape.width + randomBetween(-jitter, jitter)) * scale),
      height: Math.round((shape.height + randomBetween(-jitter, jitter)) * scale),
    }
  }

  private getLayoutBounds(): LayoutBounds {
    const screen = this.hostWindow.screen as Screen & { availLeft?: number; availTop?: number }
    const left = (screen.availLeft ?? 0) + SCREEN_MARGIN
    const top = (screen.availTop ?? 0) + SCREEN_MARGIN
    const right = left + screen.availWidth - (SCREEN_MARGIN * 2)
    const bottom = top + screen.availHeight - (SCREEN_MARGIN * 2)

    return {
      left,
      top,
      right,
      bottom,
      width: right - left,
      height: bottom - top,
    }
  }

  private intersectsExisting(candidate: PopupLayout, existing: PopupLayout[], gap: number): boolean {
    return existing.some((layout) =>
      candidate.left < layout.left + layout.width + gap &&
      candidate.left + candidate.width + gap > layout.left &&
      candidate.top < layout.top + layout.height + gap &&
      candidate.top + candidate.height + gap > layout.top,
    )
  }

  private applyLayout(ref: Window, layout: PopupLayout): void {
    this.applySize(ref, layout)

    try {
      ref.moveTo(Math.round(layout.left), Math.round(layout.top))
    } catch {
      // Ignore blocked move attempts.
    }
  }

  private applySize(ref: Window, layout: PopupLayout): void {
    try {
      ref.resizeTo(Math.round(layout.width), Math.round(layout.height))
    } catch {
      // Ignore blocked resize attempts.
    }
  }
}

function randomBetween(min: number, max: number): number {
  if (max <= min) {
    return min
  }

  return min + (Math.random() * (max - min))
}
