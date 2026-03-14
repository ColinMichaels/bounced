import type { CatchAttemptPayload, GameSnapshot, RunUpgradeId, WindowBoundsPayload } from './types'

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
      type: 'window_focus'
      payload: {
        id: string
      }
    }
  | {
      type: 'summary_action'
      payload: {
        action: 'next' | 'replay' | 'lobby'
      }
    }
  | {
      type: 'purchase_upgrade'
      payload: {
        id: RunUpgradeId
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
