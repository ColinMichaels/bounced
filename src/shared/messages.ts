import type { GameSnapshot, WindowBoundsPayload } from './types'

export type GameMessage =
  | {
      type: 'register_window'
      payload: {
        id: string
        slot: number
        title: string
      }
    }
  | {
      type: 'window_bounds'
      payload: WindowBoundsPayload
    }
  | {
      type: 'unregister_window'
      payload: {
        id: string
      }
    }
  | {
      type: 'catch_attempt'
      payload: {
        id: string
        localX: number
        localY: number
        worldX: number
        worldY: number
        tick: number
      }
    }
  | {
      type: 'request_sync'
      payload: {
        id: string
      }
    }
  | {
      type: 'focus_windows'
      payload: {
        preferredId: string | null
      }
    }
  | {
      type: 'snapshot'
      payload: GameSnapshot
    }
