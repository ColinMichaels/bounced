# Ball Hunt Prototype Findings

Source of truth for this note: [INITIAL_PROMPT.md](/Users/colin/Projects/bouced/docs/INITIAL_PROMPT.md). The workspace does not currently contain a `/dos` folder, so this document assumes that prompt is the intended baseline.

## Core Read

The idea is strong because the fantasy is unusual: the ball is not just moving on a page, it is moving across the desktop. That gives the game a physical hide-and-seek quality that normal browser games do not have.

The main design risk is not networking. It is fairness. If the player feels the ball is disappearing arbitrarily between windows, the gimmick will feel annoying instead of playful.

The main technical risk is browser lifecycle behavior. A backgrounded host tab can be throttled or frozen, which matters because this design assumes one authoritative simulation loop.

## Simplest World Model

You do not need a full grid to start.

The simplest useful model is:

- Maintain a list of window rectangles in global desktop coordinates.
- Simulate one ball in a continuous global coordinate space.
- Ask which rectangle currently contains the ball.
- Only that window renders the ball.

This gives you the illusion you want without building a tile system.

Recommended data model:

```ts
type WindowRect = {
  id: string
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  lastSeenAt: number
}

type BallState = {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  ownerWindowId: string | null
}
```

## Better Than A Grid

A plain rectangle world is enough for the MVP, but there is an even better gameplay model for later: portals.

Instead of letting the ball travel through empty desktop space, define transition edges between windows. The ball can travel freely inside a window, then exit through a portal and enter another window at a matched portal point.

Why this is better:

- It guarantees the ball is almost always visible when it matters.
- It makes motion feel intentional instead of random.
- It gives you level design knobs without changing the physics engine.
- It avoids weird dead zones in gaps between windows.

Recommendation:

- MVP: continuous global coordinates with window rectangles.
- V2: keep the same global engine, but constrain inter-window travel through authored portals.

## Host Authority

One authoritative engine is the right call.

For the first prototype, the host window can own:

- simulation clock
- ball physics
- score
- difficulty
- window registry
- spawn rules

Clients should only do:

- render latest snapshot
- report their bounds
- submit catch attempts

Important implementation detail:

- Use `performance.now()` deltas, not frame counts.
- Clamp very large deltas after tab stalls, for example `delta = Math.min(rawDelta, 32)`.
- Include a `tick` or `stateVersion` on every broadcast so stale client messages are easy to ignore.

## Browser Constraints That Matter

These are the constraints most likely to affect the game design.

1. `BroadcastChannel` is same-origin and one-to-many, which fits the concept well.
2. A channel does not deliver its own message back to the sender, so the host should update local state directly instead of waiting for its own broadcast.
3. Background pages are a problem:
   - Chrome documents that `requestAnimationFrame()` is not called for background pages.
   - Chrome also documents background timer throttling.
   - Chrome now freezes some CPU-intensive background tabs in Energy Saver mode.
   - Chrome Memory Saver can discard inactive tabs entirely.
4. Multi-display placement is possible with the Window Management API, but it requires permission and user acceptance.

What this means in practice:

- MVP should assume the host window stays visible.
- Child windows should be treated as disposable renderers that can reconnect.
- Long-term, a `SharedWorker` is a better place for authoritative shared state than a visible host tab if you want stronger resilience.

## Gameplay Findings

The interesting part is not just "click the ball". The interesting part is tracking intention across windows.

What will likely feel good:

- A short dwell near window edges before crossing, so the player can anticipate the next window.
- A visible exit and entry effect, like a streak, squash, flash, or directional arrow.
- A generous hitbox in early levels.
- Short rounds with fast resets.
- Streak-based scoring, because the fantasy is hunting, not just clicking.

What will likely feel bad:

- Ball speeds that outrun human eye tracking.
- Too many windows too early.
- Spawning in a hidden or tiny area with no warning.
- Decoys before the base mechanic is readable.
- Empty time where the ball is technically in desktop space but not visible in any window.

## Difficulty Design

Opening more windows is a good difficulty lever, but it should not be the first or strongest one.

Suggested order of escalation:

1. Increase speed slightly.
2. Reduce edge dwell time.
3. Add one more window.
4. Reduce radius.
5. Add route complexity.
6. Add decoys.

This order teaches the player before it overwhelms them.

Recommended difficulty shape:

- Level 1: 2 windows, large ball, obvious pathing, slow edge transitions.
- Level 2: 3 windows, moderate speed, shorter dwell.
- Level 3: 4 or 5 windows, smaller ball, non-linear routing.
- Level 4: same count, but decoys or fake exit trails.

The key insight is that more surface area should create search tension, but the player still needs enough continuity to mentally follow the ball.

## Placement Strategy

If the host opens the play windows, you should prefer a deterministic layout over arbitrary manual placement.

Recommended first layout:

- non-overlapping windows
- fixed gap between them
- simple row or 2x2 cluster
- host opens them from a single user gesture

Why:

- easier containment math
- fewer overlap ambiguities
- more readable motion
- simpler debugging

After the MVP, you can experiment with:

- irregular clusters
- windows on multiple displays
- window reshuffles between rounds

Optional enhancement:

- If `window.getScreenDetails()` is available and permission is granted, use it to place windows intentionally across displays.
- If not, fall back to basic `window.open(...left=...,top=...)` placement.

## Scoring Ideas

A plain score counter works, but the mechanic wants more texture.

Promising rules:

- `+1` for any valid catch
- streak multiplier after 3 consecutive catches
- bonus for catching within a short time after entry
- small penalty for misses only on higher levels

Avoid:

- harsh miss penalties in early levels
- long game-over states
- requiring pixel-perfect clicks when the ball is moving quickly

## Feedback Systems Worth Adding Early

These will likely improve feel more than extra features:

- edge pulse showing where the ball is about to leave
- directional audio cue
- faint trail from last 150 to 300 ms of movement
- radar ping button on cooldown
- score pop animation on catch

If you only add one thing, add transition anticipation at the edge. That is what makes the hunt feel fair.

## Recommended Build Order

1. Fixed host plus 2 child windows.
2. Register bounds over `BroadcastChannel`.
3. Simulate one ball in global coordinates.
4. Render the ball only in the containing window.
5. Add authoritative catch detection.
6. Add score and respawn.
7. Add deterministic window layouts for difficulty tiers.
8. Add edge transition effects.
9. Test backgrounding and reconnection behavior.
10. Only then add decoys and route tricks.

## Experiments To Run

These are the best early experiments because each answers a real design question.

### Experiment 1: Fairness

Question:
Can players track the ball across 2 windows without hints?

Success signal:
Players catch it consistently and describe it as chaseable, not random.

### Experiment 2: Background host

Question:
What happens when the authoritative host loses focus?

Success signal:
You can quantify whether simulation drift, throttling, or freezing breaks the game badly enough to require a worker-based engine.

### Experiment 3: Search surface

Question:
When does adding windows stop being fun and start being visual overload?

Success signal:
You find the practical range for casual play, likely around 3 to 5 active windows before stronger hinting is needed.

### Experiment 4: Portal routing

Question:
Is routed inter-window travel more satisfying than free movement in a large rectangle?

Success signal:
Players can predict motion better without feeling the game became scripted.

## Technical Notes For Future Me

- `BroadcastChannel` is a good transport, not a full state authority mechanism.
- Keep all canonical state in one place.
- Treat client windows as views with input.
- Re-register windows frequently enough to survive move and resize events.
- Record both intended placement and actual reported bounds.
- Support negative coordinates because multi-screen layouts are not guaranteed to start at `0,0`.
- Design for reconnects. A child window can close, freeze, or come back.

## Strongest Improvement Ideas

- Move the engine to a `SharedWorker` after the MVP if host throttling becomes visible.
- Use authored portals instead of free-space travel for more readable gameplay.
- Add transition cues before adding decoys.
- Add optional Window Management API support for deliberate multi-display layouts.
- Add a radar mechanic so search difficulty does not turn into frustration.
- Add wake lock as an opt-in for longer sessions on supported devices.

## External Notes

These official docs are directly relevant to the prototype:

- Chrome: BroadcastChannel overview and same-origin pub/sub behavior  
  https://developer.chrome.com/blog/broadcastchannel
- Chrome: background tabs do not run `requestAnimationFrame()` and timers are throttled  
  https://developer.chrome.com/blog/background_tabs
- Chrome: Window Management API for enumerating screens and placing windows with permission  
  https://developer.chrome.com/docs/capabilities/web-apis/window-management
- Chrome: Screen Wake Lock API for keeping the display awake  
  https://developer.chrome.com/docs/capabilities/web-apis/wake-lock
- Chrome: Memory Saver can discard inactive tabs  
  https://developer.chrome.com/blog/memory-and-energy-saver-mode
- Chrome: Energy Saver can freeze CPU-intensive background tabs  
  https://developer.chrome.com/blog/freezing-on-energy-saver
