# Ball Hunt

Multi-window browser game experiment using `BroadcastChannel` for same-origin synchronization.

## Run

```bash
npm install
npm run dev
```

Open the host page, press `Open Windows & Start`, and allow popups. The host opens the full window pool on that first user gesture so later difficulty increases can activate more windows without fighting popup blockers.

## Structure

- `index.html`: host control deck
- `client.html`: popup play window
- `src/engine`: authoritative simulation and difficulty logic
- `src/host`: popup management and host UI
- `src/client`: popup renderer and input forwarding
- `src/shared`: shared types, geometry, constants, and message protocol

## Notes

- The host is authoritative and should stay visible during play.
- Windows report their screen bounds periodically so the host can map the ball into each popup.
- Difficulty increases by activating more of the pre-opened windows, increasing speed, and shrinking the ball.
