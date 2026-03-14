# Architecture

## Overview

Bounced is a same-origin multi-window game. One host window owns the authoritative game state, while popup rooms render local views of that state and report their live desktop geometry back to the host.

The runtime is fully client-side:

- no backend
- no database
- no framework runtime
- no shared server clock

## High-Level Runtime

```text
Host Control Deck
  |- GameEngine
  |- WindowManager
  |- Worker ticker
  |- BroadcastChannel transport
  |
  +--> Popup Room 1
  +--> Popup Room 2
  +--> Popup Room 3
  ...

Each popup room:
  |- reports canvas bounds
  |- renders the latest snapshot
  |- can request cluster recall
  |- forwards click input for room shooting
```

## Main Modules

### Host

Files:

- [src/host/main.ts](/Users/colin/Projects/bouced/src/host/main.ts)
- [src/host/windowManager.ts](/Users/colin/Projects/bouced/src/host/windowManager.ts)
- [src/host/ticker.worker.ts](/Users/colin/Projects/bouced/src/host/ticker.worker.ts)
- [src/host/audio.ts](/Users/colin/Projects/bouced/src/host/audio.ts)

Responsibilities:

- create and relayout popup rooms for the selected level
- keep the engine ticking even while popup rooms are focused
- render host-side progression and status UI
- own synthesized run audio feedback
- recall/focus the popup cluster
- guard live level switches with a confirmation dialog
- wait for fresh room bounds after layout changes

### Engine

Files:

- [src/engine/gameEngine.ts](/Users/colin/Projects/bouced/src/engine/gameEngine.ts)
- [src/engine/physics.ts](/Users/colin/Projects/bouced/src/engine/physics.ts)
- [src/engine/difficulty.ts](/Users/colin/Projects/bouced/src/engine/difficulty.ts)

Responsibilities:

- maintain authoritative room registry
- own level selection, unlocks, score, streak, and campaign progression
- track current attempt time, saved per-level best times, and best earned medals
- manage run-local bridge-pulse charges and active utility state
- spawn and update the signal ball
- derive room-local obstacle geometry
- derive route state: start room, relay rooms, goal room
- evaluate relay hits and goal completion

### Client Rooms

Files:

- [src/client/main.ts](/Users/colin/Projects/bouced/src/client/main.ts)
- [src/client/renderer.ts](/Users/colin/Projects/bouced/src/client/renderer.ts)

Responsibilities:

- measure playable canvas geometry in screen coordinates
- publish bounds over `BroadcastChannel`
- publish faster motion-driven bounds updates while a room is being dragged
- render the room-local slice of the shared simulation
- display compact room number and route status
- forward click input as room shots
- render barriers, route targets, bonus pickups, and side locks
- render focused-room xray overlays for overlapped hidden structure
- reflect active utility states like bridge-pulse lock suppression

### Shared Protocol

Files:

- [src/network/channel.ts](/Users/colin/Projects/bouced/src/network/channel.ts)
- [src/shared/messages.ts](/Users/colin/Projects/bouced/src/shared/messages.ts)
- [src/shared/types.ts](/Users/colin/Projects/bouced/src/shared/types.ts)
- [src/shared/geometry.ts](/Users/colin/Projects/bouced/src/shared/geometry.ts)
- [src/shared/constants.ts](/Users/colin/Projects/bouced/src/shared/constants.ts)

Responsibilities:

- declare the message contract between host and popup rooms
- define snapshots, room bounds, and route state
- provide geometry helpers for window overlap/containment/connectivity

## Authoritative Data Flow

### 1. Room bootstrap

When the host arms a level:

- `WindowManager` opens or relayouts the required popup rooms
- each popup room registers with the channel
- each popup room reports its live canvas bounds

### 2. Bounds ingestion

Each room sends:

- popup window outer geometry
- playable canvas geometry
- visibility state

The host stores these as `WindowState` records and waits until all required active rooms have reported fresh bounds before resuming simulation.

### 3. Simulation tick

The host worker ticker sends periodic tick events into the host UI. On each tick:

- stale windows are pruned
- active rooms for the selected level are derived
- ball state is retuned to current difficulty
- the ball advances only within the connected component of its current room
- room-side locks can reject otherwise touching room connections
- relay / goal room barriers are applied as internal collision geometry
- optional relay-room score pickups are derived from the current room state
- ambient non-start-room bonuses are derived from the level bonus profile
- medal pace is evaluated from generated per-level clear-time thresholds
- active bridge-pulse utility can temporarily suppress side locks
- relay / goal collisions are tested
- a new `GameSnapshot` is broadcast

### 4. Client render

Each popup room receives the latest `GameSnapshot` and:

- checks whether it is active for the current level
- maps world coordinates into local canvas coordinates
- renders only balls and targets inside its playable rect
- updates its header status text

## Gameplay Model

### Level shape

Each level defines:

- active room count
- ball speed
- ball radius

The current generator spans 100 levels and scales from 3 to 8 active rooms.

### Route model

Each active level currently follows:

```text
Room 1      -> start
Room 2..N-1 -> ordered relay rooms
Room N      -> goal
```

Rules:

- the ball always spawns in the start room
- relay and goal rooms can contain static barrier objects
- higher levels can assign blocked edges to active rooms
- barriers can be destroyed via room clicks
- bonus pickups and stronger medal clears can award bridge-pulse charges
- ambient room bonuses can award score, charges, or time reductions
- bridge pulse temporarily suppresses room-side locks for the active run
- only one relay target is active at a time
- the goal target stays locked until all relays are completed
- cleared active relay rooms can spawn one optional score pickup
- routing the ball through that pickup grants bonus score
- that pickup is lost if the ball leaves the room first
- each level also defines bronze / silver / gold clear-time thresholds
- improving a saved medal rank grants extra score
- clearing a level unlocks the next level
- players may replay lower unlocked levels

### Physics model

The ball exists in screen-space coordinates. However, movement is not allowed through arbitrary desktop space.

Instead:

- each room contributes a playable rectangle from its canvas bounds
- the engine computes the connected room set that contains the ball
- blocked room edges can prevent adjacency even if two rooms touch or overlap
- the ball can move only inside that connected union
- disconnected edges act like walls
- overlapping or edge-connected rooms allow crossings

This makes room movement an intentional gameplay mechanic.

## Message Types

Current messages:

- `register_window`
- `window_bounds`
- `unregister_window`
- `catch_attempt`
- `request_sync`
- `focus_windows`
- `layout_hint`
- `snapshot`

Notes:

- `catch_attempt` is the room-shot input path used for barrier clearing
- `layout_hint` carries authoritative content-size targets from the host to popup rooms
- `snapshot` is the host's full authoritative state broadcast
- `focus_windows` is used for room-cluster recall behavior

## UI Architecture

### Host deck

The host control deck is both:

- the campaign / status UI
- the background control surface behind the popup rooms

When the session is armed and the host loses focus, the deck dims and picks up a glass-like blur so the room cluster stays visually dominant.

### Popup rooms

Popup rooms stay minimal:

- room number in the header
- compact route status in the header
- playfield-only canvas below
- optional xray overlays when one active room overlaps another

The room chrome is intentionally small so the popup area is mostly playable surface.

## Current Extension Points

The current design leaves room for:

- room-side restrictions on passable edges
- upgrades / cooldown abilities
- richer target and scoring states

## Known Constraints

- Browser popup policy still matters. The host must open rooms from a user gesture.
- Popup focus behavior depends on browser and OS window manager rules.
- Closing a required popup room during a live run aborts the current session.
- Room geometry comes from browser-reported window metrics and canvas bounds, so bounds syncing is important after relayout.
- The engine still lives in the host page rather than a `SharedWorker`, so the host remains the authoritative runtime container.
