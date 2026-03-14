# Roadmap

This document separates current implementation from planned work and design ideas discussed during prototyping.

## Current Build

Implemented now:

- host-authoritative multi-window simulation
- popup room creation, relayout, recall, and teardown
- random disconnected room layouts per level
- custom connectivity-based ball physics
- ordered `start -> relay -> goal` progression
- static barrier obstacles in relay / goal rooms
- generated blocked room-side locks
- click-to-shoot barrier clearing
- relay-room score nodes
- ambient room bonuses for score, charges, and time reduction
- campaign unlock flow across 100 generated levels
- generated clear-time medals with persistent best ranks
- bridge-pulse helper utility with spendable run charges
- host-side synthesized audio feedback
- focused-room xray overlays for overlapped hidden structure
- guarded level-switch confirmation during active runs
- compact host and popup UI

Not implemented yet:

- a second helper ability beyond bridge pulse
- deeper spendable upgrade economy
- decoys / multiple active balls as a real mode

## Immediate Follow-Up TODOs

- Playtest the new "hidden objectives do not score" rule across Chrome window-focus edge cases, especially title-bar dragging, overlap stacks, and macOS vs Windows popup behavior.
- Add browser-level smoke coverage for the highest-risk flows: popup spawn/recall, summary-window next/replay/lobby actions, and close-a-room abort behavior.
- Keep trimming the summary report if it regrows; the current rule is that primary actions must stay visible without depending on a tall popup window.

## Near-Term TODO

### 1. Second helper utility

Goal:

- add a second utility that solves a different problem than bridge pulse

Current state:

- bridge pulse is the only spendable active utility
- bonuses and medal gains can already feed utility charges

Next shape:

- add one new tactical button with a different problem-space
- examples: short slow-time, quick route ping, or obstacle burst
- keep it run-local and charge-based like bridge pulse

### 2. Upgrade and reward economy

Goal:

- make bonus pickups, medals, and utilities feel like a connected reward system

Current state:

- ambient bonuses can award score, time, or bridge-pulse charges
- medal improvements already award score and extra charges

Planned shape:

- add more spendable run resources or unlock-style perks
- make reward choices matter more than raw score gain
- decide whether some rewards should be player-choice based instead of fixed

### 3. Xray and overlap readability

Goal:

- extend the new overlap-xray system without cluttering the rooms

Current state:

- focused rooms can ghost-render hidden barriers and side locks from overlapped rooms
- the effect is structural only and does not change gameplay state

Planned shape:

- decide whether relay / goal markers should also ghost-render
- tune contrast and responsiveness without bringing back render lag
- keep xray visuals restricted to the focused top room unless a better z-order heuristic appears

### 4. Time medals and run pacing

Goal:

- make level timer performance matter beyond simple bragging rights

Current state:

- each generated level now includes bronze / silver / gold time targets
- best times and best earned medals persist locally
- improving a medal rank grants extra score

Planned shape:

- add medal-based run modifiers or unlockable perks
- layer streak / timer bonuses into upgrades instead of only raw score
- surface medal goals more clearly inside the run, not just on the host deck

## Mid-Term Gameplay Features

### Upgrades and helper abilities

Ideas already discussed:

- earned abilities from cleared score targets
- temporary assistance for higher levels

Candidate abilities:

- short slow-motion pulse
- temporary route ping
- obstacle-clearing burst

Current state:

- first helper utility is now `bridge pulse`
- bonus pickups and stronger medal clears can award charges
- spending a charge temporarily suppresses room-side locks

### Stronger level design

Current levels are parameterized mostly by:

- room count
- room size
- room spacing
- speed
- radius

Later levels can become more authored:

- specific room-size themes
- edge-lock combinations
- denser obstacle patterns
- trick routes with false easy connections

## Technical Roadmap

### Keep custom physics for now

Recommendation:

- stay with custom physics until gameplay needs clearly exceed current rules

Reason:

- the hard problem is room-topology logic, not generic rigid-body simulation
- a full physics package would add integration overhead before it solves the important design constraints

When to reconsider:

- irregular obstacle shapes
- multi-ball combat interactions
- force-based gameplay
- more advanced collision systems

### Snapshot growth

As gameplay systems expand, the snapshot will likely need:

- obstacle state
- projectile state
- upgrade / cooldown state
- score-target state
- room-side restriction metadata

That should remain host-authoritative.

### Longer-term engine hosting

Potential future upgrade:

- move the authoritative simulation out of the host page and into a `SharedWorker`

Why:

- stronger resilience if the host page loses focus or is deprioritized
- cleaner separation between UI and simulation

Not needed yet:

- the current worker ticker plus host page model is sufficient for the prototype stage

## UX / Visual Roadmap

### Wanted

- obstacle destruction feedback
- stronger shot feedback
- route completion feedback
- subtle host-background polish when the room cluster is active

### Deprioritized on purpose

- heavy 3D backgrounds
- WebGL scene work
- overdesigned popup chrome
- noisy effects that compete with tracking the ball

The visual rule should stay simple: the popup rooms are the game, the control deck is support.

## Open Design Questions

These still need real playtesting rather than speculation:

- How many active rooms still feel readable before hint systems need to grow?
- Should obstacles block ball motion directly, target access, or both?
- Should upgrades be persistent for the full run or per-level only?
- Should room-side locks appear early as a tutorialized mechanic or only later?
- Should score targets be mandatory or optional bonuses?

## Recommended Build Order

1. Add a second helper ability with a different problem-space than bridge pulse.
2. Turn more score and medal rewards into spendable run resources.
3. Rebalance generated levels around utilities, side locks, and obstacles together.
4. Decide whether late levels need stronger hinting or alternate modes.
5. Explore decoy / multi-ball challenge variants.
