# Ball Hunt

Multi-window browser game experiment built with `BroadcastChannel`, TypeScript, Vite, and plain canvas rendering.

The current game is a routing puzzle:

- one host window acts as the authoritative engine
- popup rooms render slices of the shared playfield
- the signal ball only crosses into rooms that physically connect or overlap
- each level requires `start -> ordered relays -> goal`
- later levels add more rooms, tighter layouts, faster motion, and smaller ball size

## Current Status

This is a playable prototype with:

- 8 unlockable levels
- randomized non-touching popup layouts per level
- authoritative host-side simulation
- popup recall/focus controls
- route-based progression through relay rooms
- compact popup UI and host control deck

Planned next systems are documented in [docs/ROADMAP.md](/Users/colin/Projects/bouced/docs/ROADMAP.md).

## Run

```bash
npm install
npm run dev
```

Open the host page, then:

1. Click `Arm Field`.
2. Allow popups for the site.
3. Move rooms so the ball can bridge from the start room through each relay room in order.
4. Route the ball into the final goal target.
5. Use `Recall Windows` on the control deck if the popup cluster falls behind other windows.

Useful commands:

```bash
npm run check
npm run build
npm run build:pages
npm run preview:pages
```

## How The Game Works

Each level uses a subset of popup rooms based on difficulty. The first active room is the start room, the middle rooms are ordered relays, and the final room is the goal. A level only clears when the ball reaches each relay target in order and then reaches the goal target.

The ball is simulated in desktop coordinates, but it is constrained by the live geometry of connected popup rooms. Moving rooms changes the reachable shape of the playfield without changing the ball's velocity. If rooms are disconnected, the ball bounces inside its current connected component.

## Controls

- `Arm Field`: open or relayout the popup rooms for the selected level and start the simulation
- `Recall Windows`: bring the popup cluster back to the front, prioritizing the room that currently owns the ball
- `Reseed Target`: respawn the route targets and signal ball for the current level
- `End Session`: close spawned game windows and reset campaign progress
- Click any popup room: recall the cluster to the front
- Drag popup rooms: change connectivity and routing

## GitHub Pages

Manual Pages-oriented commands:

```bash
npm run build:pages
npm run preview:pages
npm run deploy
```

Notes:

- `build:pages` builds with the repo base path `/bounced/`
- `preview:pages` is the quickest way to test the Pages build locally
- `deploy` publishes the built `dist/` folder to the `gh-pages` branch using the `gh-pages` package
- the included workflow also auto-publishes on pushes to `main` or `master`
- in GitHub repo settings, Pages should serve from the `gh-pages` branch root if you want the branch-based deploy flow to go live

## Project Docs

- [docs/ARCHITECTURE.md](/Users/colin/Projects/bouced/docs/ARCHITECTURE.md): runtime model, major modules, data flow, and engine behavior
- [docs/ROADMAP.md](/Users/colin/Projects/bouced/docs/ROADMAP.md): planned features, TODOs, and open design questions
- [docs/INITIAL_PROMPT.md](/Users/colin/Projects/bouced/docs/INITIAL_PROMPT.md): original kickoff prompt
- [docs/GAMEPLAY_FINDINGS.md](/Users/colin/Projects/bouced/docs/GAMEPLAY_FINDINGS.md): early design notes and prototype findings

## Code Layout

- `index.html`: host control deck shell
- `client.html`: popup room shell
- `src/host`: host UI, popup management, and worker ticker
- `src/engine`: authoritative simulation, difficulty, and ball physics
- `src/client`: popup renderer, bounds reporter, and room UI
- `src/network`: BroadcastChannel wrapper
- `src/shared`: shared types, constants, geometry, and message protocol
- `src/styles`: host and popup styling

## Constraints

- No backend. Everything runs client-side on one origin.
- Popups must be allowed by the browser.
- The host remains the source of truth for simulation and progression.
- Current gameplay is route-to-goal only. Click shooting and obstacles are not implemented yet.

## Why The Physics Are Custom

The current physics are intentionally lightweight and custom. The main problem is not generic rigid-body simulation; it is mapping ball movement onto live browser window topology. That means custom room connectivity and collision rules are more valuable right now than integrating a full physics package.
