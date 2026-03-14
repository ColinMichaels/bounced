# Playtest Checklist

This checklist is for the browser and OS behaviors that are still risky even with smoke coverage.

## Hidden Objective Rule

Goal:

- confirm that relays and goals do not score when they are covered by any room above them in the current focus stack

Checks:

1. Start a level with at least one relay room and overlap another room directly on top of that live relay.
2. Keep the covering room focused and let the ball touch the hidden relay position.
3. Confirm the relay does **not** clear.
4. Bring the relay room back to the front and repeat.
5. Confirm the relay clears normally once visible.
6. Repeat the same flow for the final goal.

Extra focus checks:

- drag the covering room by its native title bar, not just inside the canvas
- click into the covered room to bring it to the front
- stack more than two rooms and confirm any room still above the target can block scoring, even if a different room is top-most

## Popup Spawn And Recall

Goal:

- confirm the room cluster opens correctly and can be recalled without desync

Checks:

1. Start the game and confirm the expected number of room popups open.
2. Click back to the control deck and confirm the run pauses.
3. Click `Resume Game` and confirm the cluster comes back forward.
4. Click inside any room and confirm the cluster recall still works.

## Summary Window Flow

Goal:

- confirm the summary popup stays usable and transitions cleanly

Checks:

1. Clear a level and confirm the summary popup opens.
2. Confirm the primary buttons are visible without needing a tall popup window.
3. Click `Start Next Level` and confirm the next run opens correctly.
4. Clear again and click `Replay Level`.
5. Confirm the cleared level reopens, not the next one.
6. Clear again and click `Return To Lobby`.
7. Confirm the summary closes, the room cluster closes, and the control deck returns to normal.

## Close-A-Room Abort

Goal:

- confirm closing an active room still hard-aborts the run

Checks:

1. Start a live run.
2. Close any active room window.
3. Confirm the remaining room windows close immediately.
4. Confirm the host returns to idle and shows the abort message.

## Cross-Platform Notes

The main things to compare across macOS and Windows Chrome:

- popup sizing consistency after several level reshapes
- whether native title-bar dragging updates front-most room state reliably
- whether popup focus / recall ordering behaves the same
- whether summary popups are treated consistently by the browser popup blocker
