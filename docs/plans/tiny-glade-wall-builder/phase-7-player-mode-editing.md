# Phase 7 — Player-mode editing after ESC

Status: **landed 2026-07-28**. Depends on Phase 1 only.

## What shipped, where it differs from this plan

1. **`PlayerController` already had the guard shape.** Every input handler
   checks `uiBlocked` for the gameplay overlay, so pausing is a second flag
   alongside it rather than a new mechanism — `setPaused` gates the same
   handlers plus the physics step, and `setEnabled` stays true so the pose
   survives.
2. **`setMode` resumes rather than respawning.** Re-entering player mode while
   paused would otherwise walk back into spawn selection.
3. **`playerEditingProvider`** is how `selectTool` learns it is paused, keeping
   `EditorController` free of a direct dependency on the view-mode controller.

Escape ordering is verified as a unit: with a palette open, a gesture active, a
selection present and the player paused, four presses back out one level each —
palette, gesture, selection, then paused-editing — and never resume walking.

## Goal

Walk around in player mode, press ESC to stop, and edit the wall in front of you
from the first-person camera. The original request, verbatim: *"edit it in player
mode after pressing ESC that is stopped"*.

## Why this is cheap now

Phase 1 already did the hard part. `EditorController` used to hardcode
`this.editorCamera.camera` in eight picker calls; it now routes them through
`activeCamera`, wired in `main.js` to `() => viewModeController.camera`. Every
picker already took a camera argument, and `terrainView.pickWorld` /
`pickCell` / `constructionView.pickConstruction` / `pickHandle` all use
`raycaster.setFromCamera`, which is projection-agnostic. Nothing else in the
picking path needs to change.

Phase 1 also shipped `EscapeStack`, which is what makes the mode transition
expressible at all.

## No third top-level mode

Add a `paused` flag to `ViewModeController` rather than a third entry in
`PLAYER_MODES`. Keeping `PLAYER_MODES` as `['edit', 'player']` means `ViewModeUi`,
the `playerMode.css` selectors, the perf QA harness and every `setMode` caller
keep working untouched. Expose it as `root.dataset.playerPaused` for CSS.

|  | walking | paused-editing |
| --- | --- | --- |
| pointer lock | held | released |
| WASD / mouse-look | active | inert |
| physics step | runs | **frozen** |
| `onCanvasPointer` / `onKeyDown` | swallow | pass through |
| camera | player perspective | player perspective, **unchanged** |
| tools | none | **construction only** |
| UI | player HUD | compact edit HUD + radial palette |

**Freezing the physics step matters.** If gravity and ground-following keep
running while paused, the camera drifts or settles as you edit and the view will
not hold still. Freeze it, and keep `setEnabled` true throughout so the player's
pose is preserved for when they resume.

## Changes

### `src/editor/player/PlayerController.js`

```js
setInputEnabled(enabled) { this.inputEnabled = enabled; }
```

Checked by `onCanvasPointer` (`:208-217`), `onKeyDown` (`:227-242`), `onKeyUp`
(`:244-255`), the mouse-move handler, and `update`. Those first three are
registered **capture-phase** and call `stopImmediatePropagation()`, which is
exactly why the editor currently cannot see input in walk mode — gating them is
the whole unlock.

`onKeyDown` already deliberately lets `Escape` through (`:227-242`); with
`EscapeStack` owning Escape on the capture phase at a higher priority, that
special case can go.

Release pointer lock on pause; the existing left-click `requestPointerLock`
(`:214-216`) re-acquires it on resume.

### `src/editor/player/ViewModeController.js`

`pause()`, `resume()`, a `paused` getter, and the flag in `getState()`. Register
two `EscapeStack` handlers (priorities below).

### `src/editor/player/ViewModeUi.js` and `playerMode.css`

**Do not re-enable the full sidebar.** It is laid out for the orthographic
editor and reads badly over a first-person view. `playerMode.css:80-88` currently
does:

```css
[data-view-mode='player'] .sidebar { pointer-events: none; opacity: 0.62; }
[data-view-mode='player'] .statusbar, [data-view-mode='player'] .toast { display: none; }
```

Ship a compact in-viewport HUD (current tool, wall height/thickness, "Show
panels" toggle) plus one override pair:

```css
[data-view-mode='player'][data-player-paused='true'][data-player-panels='true'] .sidebar {
  pointer-events: auto;
  opacity: 1;
}
[data-view-mode='player'][data-player-paused='true'] .statusbar { display: flex; }
```

The statusbar comes back unconditionally while paused — it carries the selection
readout (`Curved wall 1 · revision 4`) that editing depends on.

### `src/editor/EditorController.js`

`selectTool` refuses anything but `'construction'` while paused, with a notice.
Terrain sculpting from a grazing first-person view needs a rethought brush
preview and cell picking; object placement needs an elevated-placement story.
Both are real work and neither is what was asked for.

## Escape ordering

All registered in `EscapeStack` (`ESCAPE_PRIORITY` names the levels):

| Priority | Handler | Action |
| --- | --- | --- |
| `modal` | modal dialog / file prompt | close it |
| `palette` | radial palette open | close the palette |
| `inspector` | construction/workshop inspector open | close the inspector |
| `gesture` | draw / anchor drag / handle drag / cut stroke active | cancel the gesture |
| `selection` | a construction or object is selected | deselect |
| `playerPaused` | paused-editing | **return to Edit/Orbit mode** |
| `playerWalking` | walking | **pause into editing** (release pointer lock) |
| `spawnSelection` | spawn selection pending | cancel the spawn |

Note the deliberate asymmetry between `playerPaused` and `playerWalking`:
**Escape always backs out one level, and clicking the viewport always goes back
in.** The failure mode being designed away is "Escape resumes walking", which
makes Escape a toggle and leaves the user unable to reach the editor without
knowing a second key. Monotonic beats symmetric here.

Phase 1 migrated the four existing Escape owners into the stack, so this phase
only adds registrations — it does not have to untangle listener ordering.

## Also fix while here

`EditorController`'s Escape branch clears the object selection but **not**
`selectedConstructionId`. Under `EscapeStack` the `selection` handler should
clear both, which is what the user expects and what makes the
`selection → playerPaused` ordering feel right.

## Tests — `tests/ViewModeController.test.js`

1. Escape while walking sets `paused` and releases pointer lock.
2. Escape while paused returns to `'edit'` mode, at the player's position.
3. Escape while paused **with a palette open** closes the palette and stays
   paused — priority ordering, the thing most likely to regress.
4. `setInputEnabled(false)` makes the physics step a no-op and stops key capture;
   `true` restores both.
5. Pausing and resuming preserves the player's position and orientation exactly.
6. `selectTool('terrain')` while paused is refused and emits a notice;
   `selectTool('construction')` succeeds.
7. `activeCamera` returns the player camera while in player mode and the orbit
   camera in edit mode.

## In-app verification

- Walk to a wall, press Esc → the mouse is released, the HUD switches, the view
  holds still.
- Right-click the wall → the palette opens, positioned from the **player**
  camera's projection.
- Drag on the terrain → a new wall lands under the first-person cursor, correctly
  placed (this is the `activeCamera` path doing its job).
- Drag an anchor handle → it moves; the handles are picked from the player camera.
- Click the viewport → pointer lock re-acquires and walking resumes.
- Esc from paused → Edit/Orbit mode, camera focused at the player's position.
- Esc while a gesture is mid-drag → the gesture cancels and the mode does **not**
  change.

## Deferred

- **Terrain sculpting in player mode.** Needs a first-person brush preview.
- **Object placement in player mode.** Needs an elevated-placement story.
- **A dedicated first-person build HUD** with tool switching, beyond the compact
  readout. Worth doing once there is more than one tool available while paused.
- **Walking on the wall you just built** — that is Phase 8, and it is what makes
  paused editing genuinely useful for ramparts.
