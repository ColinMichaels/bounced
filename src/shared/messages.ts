import type { CatchAttemptPayload, GameSnapshot, WindowBoundsPayload } from './types'

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
      payload: CatchAttemptPayload
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
      type: 'layout_hint'
      payload: {
        id: string
        contentWidth: number
        contentHeight: number
      }
    }
  | {
      type: 'snapshot'
      payload: GameSnapshot
    }
