# Roadmap

This document separates current implementation from planned work and design ideas discussed during prototyping.

## Current Build

Implemented now:

- host-authoritative multi-window simulation
- popup room creation, relayout, recall, and teardown
- random disconnected room layouts per level
- custom connectivity-based ball physics
- ordered `start -> relay -> goal` progression
- campaign unlock flow across 8 levels
- compact host and popup UI

Not implemented yet:

- obstacles
- shooting
- score targets after room clearing
- upgrades / abilities
- blocked room sides
- decoys / multiple active balls as a real mode

## Near-Term TODO

### 1. Obstacles and room clearing

Goal:

- place blocker objects inside relay or goal rooms
- force the player to actively clear a route, not only move windows

Planned shape:

- add obstacle arrays to the authoritative snapshot
- associate obstacles with specific rooms
- treat uncleared obstacles as blockers for routing or target access

### 2. Shooting mechanic

Goal:

- turn room click input into a real gameplay action

Current state:

- popup rooms already forward click data to the host
- `catch_attempt` is reserved as the current input channel

Planned shape:

- reinterpret click input as a shot
- raycast or local hit-test against room obstacles
- add cooldown, shot feedback, and destruction effects

### 3. Score / upgrade targets

Goal:

- reward room clearing before the level-end goal

Planned shape:

- after blockers in a room or path are cleared, spawn a score target
- hitting that target awards points, charges, or upgrades
- final goal remains the level-completion condition

## Mid-Term Gameplay Features

### Room-side locks

Goal:

- make specific room edges non-passable

Why:

- adds authored routing constraints
- increases puzzle difficulty without only increasing speed

Likely implementation:

- per-room metadata like `blockedEdges: ('left' | 'right' | 'up' | 'down')[]`
- physics treats blocked edges as walls even if another room touches there

### Upgrades and helper abilities

Ideas already discussed:

- earned abilities from cleared score targets
- temporary assistance for higher levels

Candidate abilities:

- short slow-motion pulse
- temporary route ping
- one-time edge unlock
- obstacle-clearing burst

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

1. Add obstacle data model and rendering.
2. Convert popup clicks into an actual shot action.
3. Add destructible blockers and room-clear states.
4. Spawn score / upgrade targets after blockers are cleared.
5. Add room-side locks.
6. Add first helper ability.
7. Rebalance levels around the new systems.
