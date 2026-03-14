import { getLayoutProfileForLevel } from '../engine/difficulty'

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

const SCREEN_MARGIN = 28
const RELAYOUT_SCALES = [1, 0.94, 0.88, 0.82]
const ESTIMATED_FRAME_WIDTH = 18
const ESTIMATED_FRAME_HEIGHT = 74

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
      url.searchParams.set('targetWidth', String(Math.round(layout.width)))
      url.searchParams.set('targetHeight', String(Math.round(layout.height)))
      const estimatedOuterLayout = this.toEstimatedOuterSize(layout)

      const features = [
        `width=${Math.round(estimatedOuterLayout.width)}`,
        `height=${Math.round(estimatedOuterLayout.height)}`,
        `left=${Math.round(estimatedOuterLayout.left)}`,
        `top=${Math.round(estimatedOuterLayout.top)}`,
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

  getClosedWindowIds(requiredCount: number): string[] {
    return [...this.handles.values()]
      .filter((handle) => handle.slot < requiredCount && !!handle.ref && handle.ref.closed)
      .map((handle) => handle.id)
  }

  getHandle(id: string): PopupHandle | null {
    return this.handles.get(id) ?? null
  }

  getOpenHandles(): PopupHandle[] {
    return [...this.handles.values()]
      .filter((handle) => handle.ref && !handle.ref.closed)
      .sort((left, right) => left.slot - right.slot)
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
    const profile = getLayoutProfileForLevel(level)

    for (const scale of RELAYOUT_SCALES) {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const layouts: PopupLayout[] = []
        let placedAll = true

        for (let slot = 0; slot < count; slot += 1) {
          const size = this.pickWindowSize(level, scale)
          const width = Math.min(size.width, bounds.width - ESTIMATED_FRAME_WIDTH - 8)
          const height = Math.min(size.height, bounds.height - ESTIMATED_FRAME_HEIGHT - 8)
          let placed = false

          for (let candidateAttempt = 0; candidateAttempt < 120; candidateAttempt += 1) {
            const outerWidth = width + ESTIMATED_FRAME_WIDTH
            const outerHeight = height + ESTIMATED_FRAME_HEIGHT
            const candidate = {
              left: randomBetween(bounds.left, bounds.right - outerWidth),
              top: randomBetween(bounds.top, bounds.bottom - outerHeight),
              width,
              height,
            }

            if (this.intersectsExisting(candidate, layouts, profile.gap * scale)) {
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
    const profile = getLayoutProfileForLevel(level)
    const gap = profile.gap * 0.6
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)))
    const rows = Math.max(1, Math.ceil(count / columns))
    const cellWidth = Math.max(220 + ESTIMATED_FRAME_WIDTH, (bounds.width - (gap * (columns - 1))) / columns)
    const cellHeight = Math.max(190 + ESTIMATED_FRAME_HEIGHT, (bounds.height - (gap * (rows - 1))) / rows)
    const layouts: PopupLayout[] = []

    for (let slot = 0; slot < count; slot += 1) {
      const column = slot % columns
      const row = Math.floor(slot / columns)
      const size = this.pickWindowSize(level, 0.78)
      const width = Math.min(size.width, cellWidth - ESTIMATED_FRAME_WIDTH - 12)
      const height = Math.min(size.height, cellHeight - ESTIMATED_FRAME_HEIGHT - 12)
      const outerWidth = width + ESTIMATED_FRAME_WIDTH
      const outerHeight = height + ESTIMATED_FRAME_HEIGHT
      const maxLeft = bounds.left + (column * (cellWidth + gap)) + Math.max(0, cellWidth - outerWidth)
      const maxTop = bounds.top + (row * (cellHeight + gap)) + Math.max(0, cellHeight - outerHeight)

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
    const profile = getLayoutProfileForLevel(level)
    const shapes = profile.shapes
    const shape = shapes[Math.floor(Math.random() * shapes.length)]
    const jitter = profile.jitter

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
    const outerCandidate = this.toEstimatedOuterSize(candidate)

    return existing.some((layout) => {
      const outerLayout = this.toEstimatedOuterSize(layout)

      return outerCandidate.left < outerLayout.left + outerLayout.width + gap &&
      outerCandidate.left + outerCandidate.width + gap > outerLayout.left &&
      outerCandidate.top < outerLayout.top + outerLayout.height + gap &&
      outerCandidate.top + outerCandidate.height + gap > outerLayout.top
    })
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
    const outerLayout = this.toEstimatedOuterSize(layout)

    try {
      ref.resizeTo(Math.round(outerLayout.width), Math.round(outerLayout.height))
    } catch {
      // Ignore blocked resize attempts.
    }
  }

  private toEstimatedOuterSize(layout: PopupLayout): PopupLayout {
    return {
      left: layout.left,
      top: layout.top,
      width: layout.width + ESTIMATED_FRAME_WIDTH,
      height: layout.height + ESTIMATED_FRAME_HEIGHT,
    }
  }
}

function randomBetween(min: number, max: number): number {
  if (max <= min) {
    return min
  }

  return min + (Math.random() * (max - min))
}
