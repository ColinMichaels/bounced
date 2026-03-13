import { WINDOW_GRID_COLUMNS, WINDOW_HEIGHT, WINDOW_POOL_GAP, WINDOW_WIDTH } from '../shared/constants'

export interface PopupHandle {
  id: string
  slot: number
  title: string
  ref: Window | null
}

export class WindowManager {
  private readonly handles = new Map<string, PopupHandle>()

  constructor(private readonly hostWindow: Window) {}

  ensureWindowPool(count: number): PopupHandle[] {
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

    for (let slot = 0; slot < count; slot += 1) {
      const id = `play-window-${slot + 1}`
      const title = `Window ${slot + 1}`
      const existing = this.handles.get(id)

      if (existing?.ref && !existing.ref.closed) {
        handles.push(existing)
        continue
      }

      const { left, top } = this.getLayoutPosition(slot)
      const url = new URL('/client.html', this.hostWindow.location.href)
      url.searchParams.set('id', id)
      url.searchParams.set('slot', String(slot))
      url.searchParams.set('title', title)

      const features = [
        `width=${WINDOW_WIDTH}`,
        `height=${WINDOW_HEIGHT}`,
        `left=${left}`,
        `top=${top}`,
        'popup=yes',
      ].join(',')

      const ref = this.hostWindow.open(url.toString(), id, features)
      const handle: PopupHandle = { id, slot, title, ref }
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

  private getLayoutPosition(slot: number): { left: number; top: number } {
    const column = slot % WINDOW_GRID_COLUMNS
    const row = Math.floor(slot / WINDOW_GRID_COLUMNS)
    const left = this.hostWindow.screenX + 40 + (column * (WINDOW_WIDTH + WINDOW_POOL_GAP))
    const top = this.hostWindow.screenY + 90 + (row * (WINDOW_HEIGHT + WINDOW_POOL_GAP))

    return { left, top }
  }
}
