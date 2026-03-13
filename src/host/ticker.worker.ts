const TICK_MS = 16

setInterval(() => {
  self.postMessage({
    type: 'tick',
    now: Date.now(),
  })
}, TICK_MS)
