# How To Play

This guide is for players, not contributors.

If you want the short version:

1. Start the game and allow popups.
2. Move the room windows until the ball has a real path from `START` to the active `RELAY`.
3. Clear barriers if they are in the way.
4. Route the ball through each relay in order.
5. Send it into the `GOAL`.
6. Do it fast enough to earn medals.

## The Basic Idea

`Bounced` is a puzzle game played across multiple browser windows.

The ball is always moving. Your job is to move the room windows so the ball can travel through them in the right order. A level is not about clicking the ball. It is about building a live route for it while it bounces around.

Think of each level like this:

- one room is the start
- one or more rooms are relays
- the last room is the goal
- you are rearranging the level while the ball is already in motion

## Starting A Run

From the control deck:

- click `Start Game`
- allow popups if your browser asks
- the game opens the rooms needed for the selected level

If the room windows get buried behind other windows:

- click `Resume Game` on the control deck
- or click inside any room to recall the group

If you close one of the active room windows during a run, the session ends immediately.

## What The Room Labels Mean

Each room header shows a room number and a status.

The important statuses are:

- `START`: the ball begins here
- `RELAY N LIVE`: this is the current room you need to clear next
- `RELAY N LOCKED`: this relay exists, but it is not active yet
- `RELAY N CLEAR`: this relay is already finished
- `GOAL LIVE`: the final target is active
- `GOAL LOCKED`: the goal exists, but you have not cleared all relays yet
- `BARRIER` count: there are still obstacle blocks in that room
- `SIDE LOCK` count: some edges of that room will not allow entry
- `BONUS LIVE` or `BONUS xN`: there is at least one bonus pickup in that room
- `PULSE`: `Bridge Pulse` is active and side locks are temporarily suppressed

## How Rooms Connect

The ball does not travel through empty desktop space just because two windows look nearby.

The ball can only move from one room into another when:

- the two rooms are touching on an open side
- or the rooms overlap

If rooms are disconnected, the ball stays trapped in the connected shape it is currently inside and bounces around there.

That means moving windows is the main action in the game.

## Blocked Sides

Some rooms have blocked edges.

You can see them as bright dashed rails on the edge of the room. If a side is blocked:

- the ball cannot cross through that side into another room
- even if two windows are touching or overlapping there

This is one of the biggest difficulty jumps in later levels. It forces you to care about which side connects, not just whether rooms are close enough.

## Barriers

Relay and goal rooms can contain barriers.

Barriers are physical obstacles inside the room:

- the ball bounces off them
- they can block a route to the relay target or goal target
- you can destroy them by clicking on them

Clicking in a room is a shot. If your click lands on a barrier, it takes damage. Most barriers are simple one-hit clears.

You do not always have to destroy every barrier. If the ball already has a clean route, you can ignore them.

## Relay Targets And Goal Targets

The level progression is always ordered.

You must route the ball through:

1. the current active relay
2. the next relay
3. the next relay after that
4. the final goal

You cannot skip ahead. If the ball reaches the goal before the relays are cleared, nothing happens.

## Bonuses

There are two bonus styles in the current game.

### Relay Bonus

When you clear the barriers in the current active relay room, a relay bonus node can appear there.

If the ball touches it:

- you gain bonus score
- you gain a `Bridge Pulse` charge

If the ball leaves that relay room before touching the bonus:

- the bonus is lost for that room

### Ambient Bonuses

Later levels can also spawn extra bonuses in non-start rooms.

These can give:

- score
- a `Bridge Pulse` charge
- a small time reduction

Ambient bonuses do not replace relay progression. They are optional pickups along the way.

## Bridge Pulse

`Bridge Pulse` is your first helper ability.

When you have at least one charge, you can activate it from the control deck.

While it is active:

- blocked room sides are temporarily suppressed
- the ball can cross edges that would normally reject entry

This is best used when:

- one blocked side is the only thing stopping a route
- the ball is already close to the room boundary you need
- you want to salvage a run instead of rebuilding the whole layout

## The Timer And Medals

Every level is also a time trial.

The control deck tracks:

- your current run time
- your best time for that level
- your best medal for that level

Levels have generated `bronze`, `silver`, and `gold` targets.

Finishing faster helps in two ways:

- you improve your record
- better medals can award extra score and extra pulse charges

## Xray Overlap View

If you drag one active room on top of another active room, the focused top room can ghost-render some of the hidden structure below it.

Right now the xray view shows:

- hidden barriers
- hidden blocked sides

This does not change gameplay. It is only a visual aid to help you understand what is underneath.

## Pause And Resume

If you click back onto the control deck during a live run:

- the game pauses
- the timer pauses
- active audio pauses

Click `Resume Game` or click back into a room to continue.

## Changing Levels

You can replay unlocked lower levels whenever you want.

If you select another level while a run is active, the game asks for confirmation before ending the current session.

## A Good First-Round Approach

If you are learning the game, this is the easiest way to think about a level:

1. Find the start room.
2. Find the current live relay.
3. Ignore everything else for a second and build one clean connection from start to that relay.
4. Watch how the ball bounces inside that shape.
5. If barriers are blocking the line, shoot them.
6. Once the relay clears, repeat for the next room.

Do not try to solve the entire level at once when you are new. Solve one live step at a time.

## Common Mistakes

- Touching the wrong side of a locked room and expecting the ball to cross anyway.
- Overfocusing on bonuses and missing the live relay.
- Clearing barriers that are not actually in the path.
- Making one huge messy overlap instead of a readable route.
- Forgetting that the goal does nothing until all relays are complete.
- Closing a room window during a run.

## If A Level Feels Chaotic

Reset your thinking to this:

- Where is the ball right now?
- Which room is live right now?
- Which edge is actually open?
- Do I need to move windows, shoot barriers, or spend a pulse charge?

That is the real loop of the game.
