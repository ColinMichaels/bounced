import { CHANNEL_NAME } from '../shared/constants'
import type { GameMessage } from '../shared/messages'

export interface GameChannel {
  channel: BroadcastChannel
  post: (message: GameMessage) => void
  close: () => void
}

export function openGameChannel(
  channelName: string,
  onMessage: (message: GameMessage) => void,
): GameChannel {
  const channel = new BroadcastChannel(channelName)

  channel.onmessage = (event: MessageEvent<unknown>) => {
    if (!isGameMessage(event.data)) {
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

export function createGameChannelName(sessionId: string): string {
  return `${CHANNEL_NAME}:${sessionId}`
}

function isGameMessage(value: unknown): value is GameMessage {
  return (
    !!value
    && typeof value === 'object'
    && 'type' in value
    && typeof value.type === 'string'
  )
}
