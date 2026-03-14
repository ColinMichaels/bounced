# Bounced

> A multi-window routing game played across real browser rooms.

Live demo: [colinmichaels.github.io/bounced](https://colinmichaels.github.io/bounced/)

## Field Manual

`Bounced` turns your desktop into the puzzle.

One control deck opens a cluster of floating game rooms. A live signal ball moves through those rooms in real time, but only if you physically connect the rooms in a valid way. Your job is to shape the route, clear obstacles, use utilities wisely, and send the ball from `START` through every `RELAY` and into the final `GOAL`.

It is part action puzzle, part spatial routing game, part window choreography.

## Mission Brief

Every level follows the same core pattern:

- one room is the `START`
- one or more rooms are ordered `RELAY` rooms
- the final room is the `GOAL`

The level only clears when the ball touches:

1. the active relay
2. the next relay after that
3. every remaining relay in order
4. the final goal

You cannot skip ahead.

You also cannot score what you cannot see. If a relay or goal is covered by another front-most room, the ball touching that hidden target will not count until the target room is visible again.

## First Run

1. Click `Start Game`.
2. Allow popups when the browser asks.
3. Watch where the ball begins.
4. Move the rooms until the ball has a real path to the live relay.
5. Shoot barriers only when they are actually in the way.
6. Clear every relay in order.
7. Send the ball into the final goal.

If the room windows get buried, use `Resume Game` on the control deck or click inside any active room.

## How The Rooms Work

The game is not using fake room logic. The room windows themselves are the playfield.

The ball can only cross into another room when:

- the rooms touch on a usable side
- or the rooms overlap

If two rooms are not connected, the ball stays trapped in the connected shape it is already inside and bounces there.

This means moving windows is the main skill in the game.

## What Can Stop You

### Barriers

Relay and goal rooms can contain barriers.

Barriers:

- block the ball physically
- can hide route targets or bonus paths
- can be destroyed by clicking on them

You do not have to clear every barrier. You only need to clear the ones that ruin the path you want.

### Side Locks

Later levels introduce blocked room edges.

If a room edge is locked:

- the ball cannot cross through that side
- even if two rooms are touching or overlapping there

This is where room placement becomes more deliberate. A room can look connected and still reject the ball if you are using the wrong side.

## Bonus Systems

### Relay Bonus

When you clear the current active relay room, it can spawn a temporary relay bonus.

If the ball touches it:

- you get bonus score
- you get a `Bridge Pulse` charge

If the ball leaves that relay room first, the bonus is gone.

### Ambient Bonuses

Later levels can also place extra bonuses in non-start rooms.

These can reward:

- score
- a `Bridge Pulse` charge
- a small time reduction

These are optional. They help, but the route objective always comes first.

## Bridge Pulse

`Bridge Pulse` is a run utility earned from strong play.

When you spend one charge:

- blocked sides are temporarily suppressed
- the ball can cross edges that would normally reject it

Best use:

- when one blocked edge is the only thing stopping immediate progress

Worst use:

- spending it before you have a real route ready

## Medals And Time

Every level is also a time trial.

You can earn:

- `Bronze`
- `Silver`
- `Gold`

The control deck tracks your current timer, best time, and best medal for the selected level. Better clears can award extra score and more pulse charges.

If you just want to survive a level, build safe routes.

If you want gold times, build short clean routes and skip low-value distractions.

## Overlap Xray

When one active room overlaps another, the focused top room can ghost-render some hidden structure from the room below.

Right now the xray view shows:

- hidden barriers
- hidden side locks

This is visual only. It does not change physics, scoring, or input. It is there to help you read the space better when rooms stack.

That means xray helps you inspect hidden structure, but it does not let you clear hidden relays or goals through a covered room.

## Control Deck Commands

- `Start Game`: opens or relayouts the required rooms and starts the run
- `Resume Game`: recalls the room cluster and resumes play if the control deck paused the session
- `Bridge Pulse`: spends one pulse charge
- `Reseed Target`: respawns the route target and ball for the current level
- `End Session`: closes the active room set and ends the run

Important rules:

- clicking inside a room is how you shoot barriers
- clicking anywhere in a room also recalls the room cluster
- focusing the control deck pauses the game
- closing any active room during a run aborts the session
- selecting another level during a live run opens a confirmation dialog first

## Current Build

The current playable build includes:

- 100 generated unlockable levels
- 3 to 8 active rooms depending on level
- randomized disconnected room layouts
- ordered `start -> relay -> goal` progression
- barrier obstacles
- blocked room sides
- relay bonuses and ambient bonuses
- best-time and medal tracking
- persistent local progress
- `Bridge Pulse` utility charges
- host-side synthesized audio
- focused-room xray rendering for overlap readability

## Player Guides

- [docs/HOW_TO_PLAY.md](/Users/colin/Projects/bouced/docs/HOW_TO_PLAY.md)
- [docs/STRATEGY_GUIDE.md](/Users/colin/Projects/bouced/docs/STRATEGY_GUIDE.md)

## Developer

### Run Locally

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run check
npm run build
npm run build:pages
npm run preview:pages
```

### GitHub Pages

Manual Pages-oriented commands:

```bash
npm run build:pages
npm run preview:pages
npm run deploy
```

Notes:

- `build:pages` uses the repo base path `/bounced/`
- `preview:pages` is the quickest Pages smoke test locally
- `deploy` publishes `dist/` to the `gh-pages` branch
- the workflow also auto-publishes on pushes to `main` or `master`

### Docs

- [docs/ARCHITECTURE.md](/Users/colin/Projects/bouced/docs/ARCHITECTURE.md)
- [docs/ROADMAP.md](/Users/colin/Projects/bouced/docs/ROADMAP.md)
- [docs/INITIAL_PROMPT.md](/Users/colin/Projects/bouced/docs/INITIAL_PROMPT.md)
- [docs/GAMEPLAY_FINDINGS.md](/Users/colin/Projects/bouced/docs/GAMEPLAY_FINDINGS.md)

### Code Layout

- `index.html`: host control deck shell
- `client.html`: popup room shell
- `src/host`: host UI, popup management, audio, and worker ticker
- `src/engine`: authoritative simulation, difficulty, and ball physics
- `src/client`: popup renderer, bounds reporter, and room UI
- `src/network`: `BroadcastChannel` wrapper
- `src/shared`: shared types, constants, geometry, and message protocol
- `src/styles`: host and popup styling

### Constraints

- Everything runs client-side on one origin
- popups must be allowed by the browser
- the host remains the source of truth for simulation and progression
- browser chrome on popup windows cannot be fully hidden
- active room count is currently capped at 8 pending browser ergonomics testing

### Why The Physics Are Custom

The hard problem here is not generic rigid-body simulation. It is mapping the ball onto live browser window topology.

That is why the project uses custom room connectivity and collision logic instead of a full physics package.
