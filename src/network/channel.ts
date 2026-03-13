import { CHANNEL_NAME } from '../shared/constants'
import type { GameMessage } from '../shared/messages'

export interface GameChannel {
  channel: BroadcastChannel
  post: (message: GameMessage) => void
  close: () => void
}

export function openGameChannel(onMessage: (message: GameMessage) => void): GameChannel {
  const channel = new BroadcastChannel(CHANNEL_NAME)

  channel.onmessage = (event: MessageEvent<GameMessage>) => {
    if (!event.data || typeof event.data.type !== 'string') {
      return
    }

    onMessage(event.data)
  }

  return {
    channel,
    post(message) {
      channel.postMessage(message)
    },
    close() {
      channel.close()
    },
  }
}
