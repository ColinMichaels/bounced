# Multi-Window Ball Hunt Game
BroadcastChannel Browser Game Specification

Author: Colin Michaels
Purpose: Codex / AI implementation kickoff

------------------------------------------------------------

1. OVERVIEW

This project is a browser-based experimental game where a player must locate and click a moving ball that travels between multiple browser windows.

The illusion is that the ball moves across the desktop between windows.

The game uses the BroadcastChannel API to synchronize multiple browser windows without requiring a backend server.

The BroadcastChannel API allows communication between browser tabs, windows, iframes, or workers that share the same origin, allowing messages to be exchanged without maintaining direct references between windows.

One window acts as the HOST GAME ENGINE.

All other windows act as CLIENT RENDERERS.

Players gain points by clicking the ball before it escapes to another window.

Difficulty increases by:

- opening more windows
- increasing ball speed
- shrinking the ball
- introducing decoy balls

The entire game runs client-side.

------------------------------------------------------------

2. GOALS

Primary goals

- demonstrate multi-window gameplay
- use BroadcastChannel for synchronization
- run entirely client-side
- require no backend
- run as a static web app

Secondary goals

- smooth animation
- deterministic state
- modular architecture
- expandable gameplay

------------------------------------------------------------

3. CORE CONCEPT

The ball exists in a GLOBAL DESKTOP COORDINATE SPACE.

Each window reports its screen position and size.

The host engine calculates:

- ball position
- which window contains the ball
- score
- difficulty

Each client renders the portion of the world visible inside its window.

------------------------------------------------------------

4. SYSTEM ARCHITECTURE

Host Window
Game Engine
Physics
Score Manager
Window Registry

BroadcastChannel

Client Windows
Canvas Renderer
Input Handler
Window State Reporter

------------------------------------------------------------

5. TECHNOLOGY STACK

Language
TypeScript

Rendering
HTML Canvas

Communication
BroadcastChannel API

Build Tool
Vite

Frameworks
None required

------------------------------------------------------------

6. BROADCAST CHANNEL

All windows connect to the same channel.

Example:

const channel = new BroadcastChannel("ball_hunt_game")

Any window connected to the same channel can send and receive messages.

------------------------------------------------------------

7. WINDOW REGISTRATION

Each window must register itself with the host.

Window registration structure:

type WindowRegistration = {
id: string
x: number
y: number
width: number
height: number
}

Window position data should be read from:

window.screenX
window.screenY
window.outerWidth
window.outerHeight

Clients periodically broadcast their bounds.

------------------------------------------------------------

8. GLOBAL COORDINATE SYSTEM

The host maintains a virtual desktop coordinate system.

Origin:

0,0

Positive X moves right
Positive Y moves down

Ball state:

type BallState = {
x: number
y: number
radius: number
vx: number
vy: number
}

------------------------------------------------------------

9. BALL PHYSICS

The host runs the physics simulation.

Movement:

x += vx * delta
y += vy * delta

Bounce logic:

if ball.x < 0 or ball.x > desktopWidth
vx = -vx

if ball.y < 0 or ball.y > desktopHeight
vy = -vy

------------------------------------------------------------

10. WINDOW CONTAINMENT CHECK

Host determines which window should display the ball.

Pseudo logic:

for each window

if ball.x >= window.x
and ball.x <= window.x + window.width
and ball.y >= window.y
and ball.y <= window.y + window.height

     window renders ball

Only one window should render the ball.

------------------------------------------------------------

11. RENDERING

Each window runs its own animation loop.

When the ball lies inside a window:

localX = ball.x - window.x
localY = ball.y - window.y

Canvas render example:

ctx.beginPath()
ctx.arc(localX, localY, ball.radius, 0, Math.PI * 2)
ctx.fill()

------------------------------------------------------------

12. CATCH DETECTION

When a player clicks inside a window:

channel.postMessage({
type: "catch_attempt",
windowId,
localX,
localY
})

The host converts to global coordinates:

globalX = window.x + localX
globalY = window.y + localY

If the click intersects the ball:

distance(click, ball) < radius

Then:

score++
increaseDifficulty()
respawnBall()

------------------------------------------------------------

13. DIFFICULTY SYSTEM

Difficulty increases gradually.

Example scaling:

Level 1
2 windows
slow ball
large radius

Level 2
3 windows
medium speed
medium radius

Level 3
5 windows
fast ball
small radius

Level 4
8 windows
very fast ball
tiny radius

Optional difficulty mechanics

decoy balls
teleport ball
window shuffle
shrinking ball radius

------------------------------------------------------------

14. MESSAGE PROTOCOL

All BroadcastChannel messages must follow this structure.

type GameMessage =
| { type: "register_window", id }
| { type: "window_bounds", id, x, y, width, height }
| { type: "ball_state", ball }
| { type: "catch_attempt", id, localX, localY }
| { type: "score_update", score }
| { type: "game_start", difficulty }
| { type: "game_over", score }

------------------------------------------------------------

15. FRAME RATE

Host simulation runs at:

60 FPS

Each frame:

update physics
broadcast ball state

Clients render using requestAnimationFrame.

------------------------------------------------------------

16. WINDOW LAUNCHER

The host window should open client windows.

Example:

window.open("/client.html", "_blank", "width=400,height=400")

Popup creation must occur from a user interaction to avoid browser popup blocking.

------------------------------------------------------------

17. PROJECT STRUCTURE

/src
/engine
gameEngine.ts
physics.ts
score.ts

/network
broadcast.ts
messages.ts

/client
renderer.ts
input.ts
windowState.ts

/host
windowManager.ts
difficulty.ts

main.ts

/public
host.html
client.html

------------------------------------------------------------

18. MVP MILESTONES

Phase 1
BroadcastChannel communication
host window
two client windows
ball moving between windows

Phase 2
click detection
score system
ball respawn

Phase 3
difficulty scaling
window spawning

Phase 4
UI polish
animations
sound effects

------------------------------------------------------------

19. FUTURE FEATURES

multiplayer race mode
power-ups
window shaking effects
ghost trails
leaderboard
cooperative catching

------------------------------------------------------------

20. SUCCESS CRITERIA

Prototype is successful if:

- ball visually moves between windows
- click detection works
- score increments correctly
- gameplay feels responsive
- no backend is required

------------------------------------------------------------

21. AI IMPLEMENTATION RULES

AI agents generating code must follow these rules:

1. use TypeScript
2. modular architecture
3. avoid heavy frameworks
4. use Canvas rendering
5. keep game logic deterministic
6. document message types
7. prefer small composable modules
8. maintain host authority over state

------------------------------------------------------------

END OF SPEC
