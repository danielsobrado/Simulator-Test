# Workshop AAA / SOTA implementation plan

## Purpose

This document is the implementation roadmap for taking the procedural object workshop from the current radial-menu prototype to a production-quality, AAA-feeling, state-of-the-art browser editor.

The target is not a more animated version of the current UI. The target is a different interaction architecture:

```text
Input
  -> semantic intent
  -> transactional preview state
  -> immediate visual response
  -> deferred/final commit
  -> one history operation
```

The workshop must feel direct, predictable and low-latency even when the final procedural object is expensive to rebuild.

This plan is intentionally staged. Every stage must leave the workshop usable and independently testable. Do not implement all stages in one large refactor.

No GitHub Actions are required or planned. All QA added by this plan must run through local Node/Playwright/package scripts already used by the repository.

---

## 1. Current baseline

The current implementation already has several useful foundations:

- `ProceduralWorkshopUi` owns the workshop overlay, form, preview renderer, component controller and material controller.
- The preview uses `THREE.WebGPURenderer`.
- `ProceduralWorkshopComponentController` owns semantic component selection and editing.
- `ProceduralWorkshopMaterialController` owns semantic material-region editing.
- `WorkshopRadialMenus` provides persistent side arcs and bottom category controls.
- `WorkshopRadialMenuMath` contains pure carousel/wheel helpers and has unit tests.
- `config/workshop-radial-menus.yaml` owns radial menu content and interaction tuning.
- Wheel/trackpad input already accumulates deltas instead of responding to every raw wheel event.
- Touch/pen already uses pointer capture and drag-to-step behavior.
- Expensive selections are already deferred briefly before committing.
- Material lanes disable themselves until a semantic material area exists.
- The current categories are `Structure`, `Surfaces`, `Roof`, `Textures`, `Colors`, and `Details`.

The main architectural limitations to remove are:

1. Radial controls still drive existing HTML form elements and dispatch DOM events.
2. Previewing and committing are not first-class separate concepts.
3. The radial system is still fundamentally discrete rather than an analog, spring-driven carousel.
4. Context is mostly category-based rather than based on the semantic component under edit.
5. The radial enhancement is attached through DOM discovery/observation rather than being an explicit workshop subsystem.
6. Large future asset libraries would create too many DOM controls if every item receives its own button.
7. Direct manipulation and radial editing are not yet one coherent interaction system.
8. We do not yet measure input-to-visual latency, preview latency or interaction-frame drops.

---

## 2. Product principles

These rules are mandatory for the implementation.

### 2.1 Direct manipulation first

If an edit can naturally be performed on the object itself, direct manipulation is the primary interaction. Radial controls are the fast preset/fine-tune path.

Examples:

- Drag roof ridge -> roof height.
- Drag roof edge -> overhang.
- Drag component boundary -> width/height/depth.
- Radial selector -> exact preset or stepped value.

### 2.2 Navigation must never imply commit

Scrolling, dragging, hovering and previewing are exploration. They must not create final history entries or expensive final regeneration on every intermediate value.

### 2.3 One gesture, one commit, one undo entry

A wheel sequence, touch drag, marking-menu gesture or pointer scrub is one logical edit.

### 2.4 Visual feedback must precede expensive work

The selector and preview must respond immediately. Expensive generation follows when the user settles.

### 2.5 The center object is the hero

UI must support the model, not cover it. Inactive lanes should be visually quiet.

### 2.6 Radials are fast paths, not asset databases

Radials are for favorites, recent choices, contextual recommendations and small controlled option sets. Large libraries require a virtualized drawer/browser.

### 2.7 Every input device maps to semantic actions

Mouse, keyboard, touch, pen and gamepad should map to the same actions rather than having unrelated control paths.

### 2.8 Configuration owns tuning

Interaction thresholds, spring constants, timing, preview delays and budgets must live in YAML-backed validated configuration. Do not scatter tuning constants across controllers.

### 2.9 Keep modules small and single-purpose

Do not turn `ProceduralWorkshopUi` or `WorkshopRadialMenus` into new god objects. New responsibilities get dedicated modules.

---

## 3. Target architecture

The final structure should converge toward the following dependency graph.

```text
ProceduralWorkshopUi
|
+-- WorkshopStateStore
|   +-- authoritative editable state
|   +-- committed state
|   +-- preview transaction overlay
|
+-- WorkshopCommandBus
|   +-- semantic commands
|   +-- command validation
|   +-- history grouping
|
+-- WorkshopPreviewScheduler
|   +-- Tier A immediate preview
|   +-- Tier B proxy generation
|   +-- Tier C final generation
|
+-- WorkshopInputRouter
|   +-- mouse
|   +-- keyboard
|   +-- touch/pen
|   +-- gamepad
|
+-- WorkshopContextResolver
|   +-- selected semantic component
|   +-- selected material region
|   +-- available contextual actions
|
+-- WorkshopRadialController
|   +-- carousel state
|   +-- slot virtualization
|   +-- marking-menu mode
|   +-- favorites/recent
|
+-- WorkshopDirectManipulationController
|   +-- handles
|   +-- scrubbing
|   +-- measurements
|
+-- WorkshopMaterialController
|
+-- WorkshopComponentController
|
+-- WorkshopThumbnailService
    +-- thumbnail cache
    +-- atlas
    +-- prewarm
```

The authoritative state flow must become:

```text
UI/Input -> command -> WorkshopStateStore -> preview scheduler -> renderer
                                      |
                                      +-> final recipe serialization
```

No core workshop UI should need to use `field.value = ...` followed by synthetic DOM events to edit workshop state once the migration is complete.

---

## 4. Target module layout

This is the intended direction, not a requirement to create every file immediately.

```text
src/editor/workshop/
  ProceduralWorkshopUi.js

  state/
    WorkshopStateStore.js
    WorkshopStateSchema.js
    WorkshopStateSelectors.js

  commands/
    WorkshopCommandBus.js
    WorkshopCommandTypes.js
    WorkshopHistoryGroup.js

  preview/
    WorkshopPreviewScheduler.js
    WorkshopPreviewTransaction.js
    WorkshopImmediatePreview.js
    WorkshopProxyPreview.js
    WorkshopFinalPreview.js

  radial/
    WorkshopRadialController.js
    WorkshopRadialCarousel.js
    WorkshopRadialPhysics.js
    WorkshopRadialSlots.js
    WorkshopMarkingMenu.js
    WorkshopRadialView.js

  input/
    WorkshopInputRouter.js
    WorkshopInputActions.js
    WorkshopPointerInput.js
    WorkshopKeyboardInput.js
    WorkshopGamepadInput.js

  context/
    WorkshopContextResolver.js
    WorkshopActionCatalog.js

  direct/
    WorkshopDirectManipulationController.js
    WorkshopMeasurementOverlay.js

  materials/
    WorkshopMaterialThumbnailService.js
    WorkshopMaterialThumbnailAtlas.js

  telemetry/
    WorkshopInteractionTelemetry.js
    WorkshopPerformanceBudget.js
```

Do not create empty abstractions just to match the tree. Introduce each module only when its stage begins.

---

## 5. Configuration layout

Keep menu content in the existing file:

```text
config/workshop-radial-menus.yaml
```

Add one runtime interaction configuration when Stage 1 begins:

```text
config/workshop-interaction.yaml
```

Suggested structure:

```yaml
version: 1

input:
  wheelStepPx: 42
  maxWheelStepsPerEvent: 2
  swipeStepPx: 30
  markingMenuHoldMs: 180
  markingMenuDeadZonePx: 14
  markingMenuCommitRadiusPx: 44

carousel:
  stiffness: 210
  damping: 28
  maxVelocity: 12
  selectionThreshold: 0.62
  dragVisualRangePx: 10

preview:
  settleDelayMs: 100
  proxyDelayMs: 0
  finalDelayMs: 110
  maxInteractiveGenerationHz: 30

readout:
  hideDelayMs: 850
  measurementHideDelayMs: 650

virtualization:
  visibleSlots: 5
  transitionSlots: 2

performance:
  interactionFrameBudgetMs: 8.33
  uiWorkBudgetMs: 1.5
  warningLongTaskMs: 50
```

The exact values must be tuned from measurements. The values above are starting targets, not immutable requirements.

Add a dedicated validator/load function rather than reading YAML directly in UI controllers.

---

# Stage 0 - Freeze the baseline and add interaction QA

## Goal

Protect current behavior before changing the architecture.

## Implementation steps

1. Extend the existing workshop QA runner with a radial-menu scenario.
2. Add deterministic checks for:
   - workshop opens;
   - all configured categories render;
   - Structure selections update the current recipe;
   - Textures/Colors remain disabled before a material region is selected;
   - selecting a material region enables those controls;
   - wheel navigation wraps correctly;
   - touch/pen drag produces only one committed final value;
   - keyboard navigation moves between modes and options;
   - Escape behavior still works through the existing workshop hierarchy.
3. Add unit tests for any remaining pure radial math behavior.
4. Add a temporary diagnostic helper that can count final preview generations during a gesture.
5. Add a QA assertion that a multi-step wheel burst causes no more than one final commit after settling.
6. Capture screenshots at desktop and narrow viewport sizes.
7. Record current timings manually from the QA harness:
   - menu open;
   - wheel-to-highlight;
   - wheel-to-final preview;
   - material selection to final preview.

## Files

Likely modifications:

```text
scripts/run-workshop-qa.mjs
test/workshop-radial-menu-math.test.js
```

Optional new helper:

```text
src/editor/workshop/telemetry/WorkshopInteractionTelemetry.js
```

## Exit criteria

- Existing workshop QA stays green.
- Radial behavior has deterministic tests.
- We can count expensive preview generations per interaction.
- We have a baseline latency report to compare against later stages.

Do not start the state refactor without this baseline.

---

# Stage 1 - Introduce the authoritative WorkshopStateStore

## Goal

Stop treating the HTML form as the workshop's source of truth.

## State model

The store should keep three concepts distinct:

```text
committedState
previewOverlay
resolvedState = committedState + previewOverlay
```

The committed state must serialize to the existing object recipe without requiring a new persisted schema unless a later feature truly needs one.

## Implementation steps

1. Create `WorkshopStateSchema.js`.
2. Define normalized state fields corresponding to the existing recipe/form:
   - label;
   - archetype;
   - style;
   - topStyle;
   - finish;
   - shape;
   - towerSide;
   - width;
   - depth;
   - height;
   - roofScale;
   - roofOverhang;
   - detail;
   - seed;
   - weathering;
   - irregularity;
   - windows;
   - ivy;
   - remesh;
   - albedo;
   - surfaceTextures;
   - material document;
   - component transforms;
   - opening attachments;
   - opening assemblies.
3. Create `WorkshopStateStore.js` with a deliberately small API:

```js
getCommitted()
getResolved()
subscribe(listener)
setCommitted(next, meta)
setPreview(patch, meta)
clearPreview(meta)
serializeRecipe()
```

4. Keep state immutable at public boundaries.
5. Do not deep-clone on every frame. Normalize only at state boundaries and use structural sharing where practical.
6. Add selectors for frequently read values rather than making every consumer know the complete state shape.
7. Instantiate the state store explicitly inside `ProceduralWorkshopUi`.
8. Seed it from the current default form values.
9. Make `readInput()` serialize from the state store.
10. During migration, keep the HTML form synchronized from store state for compatibility.
11. Form events should write to the state store, not directly schedule generation.
12. Add a reentrancy guard so store-to-form synchronization does not generate a form-to-store loop.

## Temporary compatibility bridge

During this stage only:

```text
Form -> Store
Store -> Form
Radial -> still existing bridge
```

The final design removes Radial -> Form.

## Tests

Add tests for:

- defaults serialize exactly as before;
- changing every scalar field survives round-trip serialization;
- preview overlay does not mutate committed state;
- clearing preview returns resolved state to committed state;
- form synchronization does not recurse;
- persisted recipe output remains stable.

## Exit criteria

- `readInput()` no longer builds authoritative state from `FormData`.
- Existing form UI still works.
- Existing radial UI still works.
- Existing baked recipe shape remains compatible.

---

# Stage 2 - Add semantic commands and grouped history

## Goal

All workshop editing should become semantic operations rather than widget-specific mutations.

## Command model

Create commands such as:

```text
SetArchetype
SetShape
SetRoofScale
SetRoofOverhang
SetWallFinish
SetTrimStyle
SetDetailLevel
ToggleFeature
SetMaterialPreset
SetMaterialColor
SetMaterialTint
SetComponentTransform
SetOpeningAttachment
```

Do not expose generic `set(path, value)` as the main public editing API. Semantic commands make validation, context, history and telemetry much cleaner.

## Implementation steps

1. Create `WorkshopCommandTypes.js`.
2. Create `WorkshopCommandBus.js`.
3. Add command validation before state mutation.
4. Add command metadata:

```js
{
  source: 'radial' | 'form' | 'gizmo' | 'keyboard' | 'direct',
  phase: 'preview' | 'commit',
  gestureId,
  timestamp
}
```

5. Add `WorkshopHistoryGroup.js`.
6. A gesture opens one history group.
7. Preview commands inside a history group never create undo entries.
8. The final commit stores exactly one before/after snapshot or compact semantic delta.
9. Cancellation restores the state before the gesture.
10. Move existing workshop undo behavior toward the same grouping model where feasible without breaking component/material-specific undo immediately.
11. Keep material/component local undo stacks temporarily if consolidating them would make this stage too large.

## Tests

- 20 preview updates + one commit = one history entry.
- Cancelled gesture = zero history entries.
- Re-selecting the same value = zero history entries.
- Undo restores the full pre-gesture value.
- Redo restores the committed post-gesture value.

## Exit criteria

- New editing surfaces can use commands without touching DOM controls.
- Gesture grouping works independently of the radial UI.

---

# Stage 3 - Implement real preview transactions

## Goal

Make exploration cheap and reversible.

## Transaction lifecycle

```text
begin
  -> preview
  -> preview
  -> preview
commit
```

or:

```text
begin
  -> preview
cancel
```

## Implementation steps

1. Create `WorkshopPreviewTransaction.js`.
2. Give each transaction:
   - unique gesture ID;
   - source;
   - affected semantic property/properties;
   - initial committed snapshot;
   - latest preview values;
   - begin/update/commit/cancel timestamps.
3. Prevent two independent transactions from silently editing the same semantic field at once.
4. Define conflict behavior:
   - same source + same field extends transaction;
   - different source on same field commits/cancels the previous transaction explicitly;
   - unrelated fields may coexist only if the preview scheduler supports it safely.
5. Wire wheel bursts to one transaction.
6. Wire touch drag to one transaction.
7. Wire pointer scrubbing to one transaction.
8. Wire marking menus later to the same transaction API.
9. Escape cancels the active transaction before closing larger workshop layers.
10. Mode switching commits or cancels according to interaction semantics; default to commit only when the user has intentionally settled on a valid value.

## Exit criteria

- Intermediate values can be visualized without becoming committed recipe state.
- Cancel always restores the original committed state.
- No duplicate final regeneration occurs after commit.

---

# Stage 4 - Build the three-tier preview scheduler

## Goal

Separate instant visual response from procedural generation cost.

## Tier definitions

### Tier A - immediate visual preview

Budget target: next rendered frame.

Use existing scene objects/materials without procedural regeneration whenever possible.

Examples:

- material color;
- tint;
- roughness;
- material preset if compatible preview material is available;
- simple visibility toggles;
- component transform;
- roof scale transform proxy;
- overhang transform proxy.

### Tier B - interactive procedural proxy

Use when geometry must change during manipulation.

Proxy rules should omit expensive detail:

- lowest useful procedural detail;
- no remesh unless required for correctness;
- no ivy rebuild;
- no expensive procedural texture generation;
- no final AO convergence;
- reduced ornaments/details;
- reuse cached materials.

### Tier C - final preview

Runs once after commit/settle:

- configured final detail;
- remesh;
- semantic material regions;
- all requested details;
- full workshop AO profile;
- final framing update only when required.

## Implementation steps

1. Create `WorkshopPreviewScheduler.js`.
2. Move timer ownership out of `ProceduralWorkshopUi.schedulePreview()`.
3. Give scheduler explicit APIs:

```js
previewImmediate(change)
requestProxy(state, reason)
requestFinal(state, reason)
cancel(reason)
flushFinal()
```

4. Add generation revision IDs so stale async results cannot replace newer previews.
5. Abort/cancel superseded planner jobs where supported.
6. Coalesce multiple changes inside one animation frame.
7. Rate-limit Tier B generation with a configurable maximum generation frequency.
8. Final generation must always supersede pending Tier B work.
9. Cache compatible proxy results where the generator makes this practical.
10. Preserve the existing final preview status text but add explicit internal state:

```text
idle
interactive
proxy-generating
final-generating
```

11. Do not show noisy status messages for every proxy update.

## QA

Measure:

- number of final planner calls during 20 wheel steps;
- number of proxy planner calls;
- interaction-frame JS cost;
- final result equality with a direct final generation of the same committed recipe.

## Exit criteria

- Wheel/touch exploration no longer triggers a final rebuild per step.
- Tier A edits visibly react immediately.
- Tier B remains responsive while structural values move.
- Final output is deterministic and equivalent to committing directly.

---

# Stage 5 - Move radial editing off the DOM form bridge

## Goal

The radial system must issue semantic commands directly.

## Implementation steps

1. Inject `WorkshopCommandBus`, state selectors and context into the radial controller.
2. Replace field-based lane behavior with command descriptors.
3. Evolve YAML lane configuration from:

```yaml
field: roofScale
event: input
```

toward:

```yaml
action: setRoofScale
```

4. Keep compatibility parsing for the old field mapping only while migrating all existing lanes.
5. Route Structure, Surfaces, Roof and Details through semantic commands.
6. Route Textures and Colors through material commands rather than selecting hidden inspector controls.
7. Remove synthetic `input`/`change` events from radial controller logic.
8. Keep the form subscribed to state so it reflects radial changes.
9. Delete the compatibility path only after all radial lanes are command-based.

## Exit criteria

- `WorkshopRadialController` does not access `form.elements` for editing.
- `WorkshopRadialController` does not dispatch synthetic form events.
- Material radial controls do not need to click hidden inspector controls.
- Form, radial and direct manipulation remain synchronized because they read one state store.

---

# Stage 6 - Convert the discrete selector into an analog spring carousel

## Goal

Make the selector feel physical, precise and continuous rather than like a list being stepped.

## Carousel state

Each lane should own:

```js
{
  position,
  targetPosition,
  velocity,
  selectedIndex,
  previewIndex,
  dragging,
  lastInputTime
}
```

`position` is continuous. `selectedIndex` is derived using hysteresis.

## Implementation steps

1. Create `WorkshopRadialPhysics.js` with pure functions.
2. Use a damped spring integrated with delta time.
3. Cap delta time after tab/background stalls.
4. Cap velocity to prevent extreme trackpad flings.
5. Add magnetic detents around each option.
6. Add configurable hysteresis:
   - do not switch at exactly `0.5` between slots;
   - default initial target around `0.62` toward the next slot;
   - tune separately for wheel and touch only if measurement proves necessary.
7. Use continuous position for visual transforms.
8. Use previewIndex for temporary visual/material preview.
9. Commit only after:
   - release;
   - explicit click;
   - or settle timeout.
10. Keep inertia low and damping strong. This is an editor, not a roulette wheel.
11. Use `requestAnimationFrame` only while at least one lane is moving.
12. Stop the animation loop when every lane is at rest.

## Tests

Pure physics tests should cover:

- settles to target;
- never diverges after large `dt`;
- velocity clamp;
- hysteresis stability around boundaries;
- wraparound shortest path;
- deterministic result for a fixed input sequence.

## Exit criteria

- Trackpad motion looks continuous.
- Fast scrolling does not overshoot unpredictably.
- Tiny movement near a boundary does not alternate between two values.
- Resting lanes consume no animation loop work.

---

# Stage 7 - Fixed-slot virtualization

## Goal

Radial performance must be independent of future library size.

## Rule

Never create one DOM button per possible asset/material once a lane may become large.

For a five-slot carousel, create approximately:

```text
5 visible slots
+ 2 transition slots
= 7 reusable DOM items
```

## Implementation steps

1. Create `WorkshopRadialSlots.js`.
2. Represent logical dataset independently from visual slots.
3. Visual slots receive descriptors as the carousel moves.
4. Update:
   - label;
   - icon/swatch/thumbnail reference;
   - logical ID;
   - accessibility text;
   - active/favorite/recent state.
5. Never recreate slot elements during normal scrolling.
6. Pre-allocate slots when a lane is mounted.
7. Rebuild only if slot-count configuration changes.
8. Ensure focused keyboard slot stays semantically correct as descriptors rotate.
9. Add tests using a synthetic dataset with at least 10,000 entries.
10. Assert DOM node count stays constant.

## Exit criteria

- 8 items and 80,000 items use the same number of radial item DOM nodes.
- Scroll cost does not grow linearly with dataset size.

---

# Stage 8 - Add semantic context resolution

## Goal

The radial system should respond to what the user is editing.

## Context types

Initial contexts:

```text
object
wall
roof
window
door
arch
tower
trim
material-region
base/ground
```

Do not infer context from labels if semantic component metadata already provides it.

## Implementation steps

1. Create `WorkshopContextResolver.js`.
2. Resolve context from:
   - selected semantic component;
   - selected material region;
   - active transform/direct-manipulation target;
   - current archetype capabilities.
3. Create `WorkshopActionCatalog.js`.
4. Define semantic actions per context.
5. Example roof context:

```text
shape
height/pitch
overhang
material
ridge/detail
weathering
```

6. Example wall context:

```text
finish
material
trim
openings
thickness
weathering
```

7. Example opening context:

```text
type
width
height
frame
repeat
spacing
```

8. Keep global categories available through the bottom toolbar.
9. When a component is selected, contextual actions should become the first/fastest radial layer.
10. Do not silently remove unavailable actions. Hide them only when they are truly impossible; disable with reason where discovering the capability matters.
11. Add context-specific YAML configuration using action IDs, not controller implementation names.

## Exit criteria

- Clicking a roof produces roof-relevant controls without navigating through unrelated categories.
- Context changes never mutate committed state.
- Context resolution has deterministic tests.

---

# Stage 9 - Build a unified input router

## Goal

All devices invoke the same semantic actions.

## Abstract actions

Start with:

```text
NavigatePrevious
NavigateNext
NavigateFinePrevious
NavigateFineNext
Select
Cancel
OpenRadial
PreviousCategory
NextCategory
OpenMore
Favorite
CompareHold
```

## Implementation steps

1. Create `WorkshopInputActions.js`.
2. Create `WorkshopInputRouter.js`.
3. Define active interaction layers and priority:

```text
active gesture
marking menu
radial menu
component direct manipulation
workshop global
```

4. Only the highest eligible layer consumes an action.
5. Mouse mapping:
   - wheel -> navigate;
   - click -> select;
   - RMB/Escape -> cancel;
   - Shift+wheel -> fine/coarse behavior according to the edited property.
6. Keyboard mapping:
   - arrows -> navigate;
   - Enter/Space -> select;
   - Escape -> cancel;
   - PageUp/PageDown -> larger step;
   - category shortcuts only if they do not conflict with current workshop shortcuts.
7. Touch/pen mapping:
   - drag -> navigate;
   - tap -> select;
   - long press -> open marking/radial interaction where useful.
8. Gamepad mapping:
   - right stick -> radial direction/navigation;
   - A -> select;
   - B -> cancel;
   - LB/RB -> category navigation.
9. Detect active input family only for presentation hints, not for business logic.
10. Prevent one physical event from being consumed twice through both router and legacy handlers.

## Exit criteria

- Controllers receive semantic actions rather than raw device events where practical.
- Input priority/cancellation is deterministic.
- Mouse, keyboard and touch pass the same behavioral QA scenario.

---

# Stage 10 - Add expert marking-menu gestures

## Goal

Allow experienced users to execute frequent commands without waiting for the visual menu.

## Interaction

```text
press/hold
  -> move direction
  -> release
  -> action
```

The visual menu appears only after the configured hold threshold if the user has not already made a clear directional gesture.

## Implementation steps

1. Create `WorkshopMarkingMenu.js`.
2. Add dead-zone radius.
3. Add direction sectors.
4. Add minimum commit radius.
5. Add hold timer before full radial rendering.
6. If the pointer exits the dead zone quickly with a clear sector:
   - resolve the action;
   - show minimal confirmation only;
   - commit on release.
7. If movement stays near the origin:
   - render the visual menu after hold delay;
   - continue as normal radial interaction.
8. Cancel if the gesture returns to the dead zone before release.
9. Make direction mapping stable per context so expert muscle memory is possible.
10. Never reorder marking-menu cardinal actions dynamically.
11. Contextual recommendations may fill secondary/non-cardinal positions, but fixed expert positions stay fixed.
12. Add a setting to disable marking mode if needed for accessibility.

## Exit criteria

- Known expert gesture can execute before full menu paint.
- Wrong/uncertain gestures cancel safely.
- Gesture mapping stays stable across sessions.

---

# Stage 11 - Integrate direct manipulation and spatial measurements

## Goal

Make object editing feel like editing the object, not operating a control panel.

## Implementation steps

1. Create `WorkshopDirectManipulationController.js` or extract existing boundary-handle behavior into it gradually.
2. Use the same command bus and preview transactions as radial controls.
3. Add context-specific handles:
   - roof ridge height;
   - roof overhang edge;
   - width/depth/height boundaries;
   - opening width/height;
   - repeat/spacing handles where semantic data supports it.
4. Create `WorkshopMeasurementOverlay.js`.
5. While editing, display only relevant measurements:

```text
8.0 m
1.45x
45 degrees
0.65 m overhang
```

6. Anchor measurements to projected world positions.
7. Avoid constant labels when idle.
8. Fade measurements after commit.
9. Radial and direct manipulation must share one transaction if the user transitions from rough drag to radial fine adjustment without ending the logical edit.
10. Add snapping feedback without forcing snapping.
11. Use transformed semantic geometry for helpers rather than guessed screen positions.

## Exit criteria

- A core structural property can be changed either by direct drag or radial preset and both routes produce identical committed state.
- One undo restores the whole gesture.

---

# Stage 12 - Material thumbnails and scalable asset browsing

## Goal

Replace ambiguous color-only texture controls with useful visual material previews without turning the radial menu into an asset browser.

## Radial behavior

Radial texture lanes should prioritize:

```text
favorites
recent
context-compatible
recommended/default
```

Then expose `More...` to a dedicated browser.

## Implementation steps

1. Create `WorkshopMaterialThumbnailService.js`.
2. Define a stable preview primitive and lighting setup.
3. Thumbnail key should include at least:
   - preset ID;
   - material revision/hash;
   - thumbnail profile version.
4. Generate thumbnails lazily.
5. Cache successful thumbnails.
6. Build `WorkshopMaterialThumbnailAtlas.js` when the number of thumbnails justifies it.
7. Use an atlas rather than one canvas/render target per material.
8. Radial virtual slots reference atlas UVs or cached image URLs.
9. Add `More...` action that opens a virtualized asset drawer.
10. Asset drawer requirements:
   - search;
   - category/family filters;
   - favorites;
   - recent;
   - virtualized grid;
   - keyboard navigation;
   - same preview transaction semantics as radial selection.
11. Do not load all full-resolution material maps simply to show thumbnails.
12. Prewarm neighboring/favorite thumbnails when a material context activates.

## Exit criteria

- Texture choice communicates actual material character, not only base color.
- Large library size does not increase radial DOM size.
- Browser remains fast with a synthetic large catalog.

---

# Stage 13 - Favorites, recent choices and explicit recommendations

## Goal

Make frequent choices fast without creating opaque ranking behavior.

## Implementation steps

1. Keep explicit pinned favorites per category/context.
2. Track recent committed values with bounded history.
3. Compute radial fast-path ordering from transparent groups:

```text
Pinned
Recent
Context default/recommended
Remaining
```

4. Do not silently reorder fixed marking-menu cardinal directions.
5. Show a small semantic indicator for favorites/recent only when needed.
6. Persist preferences separately from world/object recipes.
7. If no preference persistence layer exists yet, use local runtime state first rather than coupling this stage to a large settings project.
8. Add a clear `Favorite` action available from keyboard/gamepad/context controls.

## Exit criteria

- Repeatedly used material/action becomes faster to reach.
- User can understand why an item is near the front.

---

# Stage 14 - Comparison mode

## Goal

Support visual experimentation without forcing users to remember the previous look.

## Initial scope

Start with materials/colors and simple visual parameters. Do not begin with full structural split-screen generation.

## Implementation steps

1. Add `CompareHold` to the input router.
2. On compare begin:
   - preserve committed view A;
   - allow preview view B.
3. On compare release without commit:
   - restore A instantly.
4. On explicit commit:
   - B becomes committed state.
5. For materials/colors, support a temporary A/B surface toggle.
6. Optional later enhancement: screen-space wipe slider for material comparison.
7. Do not duplicate full workshop scenes if a lighter material-state comparison is sufficient.
8. Structural comparison can be added later only after memory/performance measurement.

## Exit criteria

- User can inspect a candidate material/color and return to the original without history pollution or regeneration glitches.

---

# Stage 15 - Visual hierarchy and AAA motion polish

## Goal

Polish only after architecture and latency are correct.

## Visual hierarchy

Idle lane:

```text
arc: low contrast
items: medium-low contrast
labels: hidden
```

Hovered/focused lane:

```text
arc: stronger
items: high clarity
label/readout: visible
```

Active item:

```text
slightly larger
clear gold/selected treatment
subtle depth/shadow response
```

Non-active lanes should dim slightly while the user is actively dragging one lane.

## Implementation steps

1. Move all carousel item motion to transform/opacity-friendly properties.
2. Avoid layout-triggering animation properties during scrolling.
3. Add lane activation transitions.
4. Add mode transition morph:
   - outgoing items collapse along arc;
   - incoming items emerge along arc;
   - interaction remains live throughout.
5. Keep mode transition around a short configurable duration.
6. Add selected semantic component contour/surface tint where technically clean.
7. Use bounding boxes mainly for explicit transform modes, not every selection.
8. Keep bloom/glow minimal.
9. Respect `prefers-reduced-motion` and offer no-motion paths for nonessential transitions.
10. Increase touch targets for coarse pointers without making desktop UI oversized.
11. Adapt interaction layout by viewport class instead of only shrinking CSS:
   - wide desktop: multiple arcs;
   - laptop: fewer simultaneous arcs;
   - tablet: one active arc per side or one active side;
   - phone: bottom/semicircle layout.

## Exit criteria

- Motion never blocks interaction.
- No layout thrash during a continuous carousel gesture.
- Reduced-motion mode remains fully functional.

---

# Stage 16 - Pointer coalescing and low-latency sampling

## Goal

Improve high-refresh stylus/touch/pointer smoothness where browsers support richer pointer samples.

## Implementation steps

1. Feature-detect `getCoalescedEvents()`.
2. For drag velocity/position estimation, consume coalesced samples in timestamp order.
3. Keep committed state based on actual input, never predicted input.
4. If predicted pointer events are used later, use them only to extrapolate visual animation position.
5. Never let predicted samples trigger semantic selection/commit.
6. Fall back cleanly to the ordinary pointer event.
7. Add QA for browsers/environments where coalesced events are absent.

## Exit criteria

- Feature produces no behavioral difference in final committed state.
- High-frequency pointer movement is visually smoother on capable devices.

---

# Stage 17 - WebGPU preview prewarm and hitch control

## Goal

No first-use hitch should be discovered while the user is scrubbing a radial control.

## Implementation steps

1. Identify which material/pipeline changes can cause first-use shader/pipeline compilation.
2. When a context becomes active, prewarm likely candidates:
   - current;
   - previous;
   - next;
   - pinned favorites.
3. Prewarm material preview resources incrementally.
4. Never block workshop opening on the complete material library.
5. Prioritize visible/adjacent radial options.
6. Add a bounded resource cache.
7. Track cache hits/misses in development telemetry.
8. Ensure disposed imported material resources are actually released.
9. Add memory-pressure guardrails before increasing cache size.

## Exit criteria

- Cycling among already-visible radial options has no shader compilation hitch in normal repeated use.
- Cache remains bounded.

---

# Stage 18 - Interaction telemetry and performance budgets

## Goal

Measure perceived latency rather than relying only on FPS.

## Metrics

Track in development/QA builds:

```text
input -> radial visual update
input -> Tier A preview
transaction begin -> first visible preview
settle -> final generation requested
final request -> final preview visible
final generations per gesture
proxy generations per gesture
interaction-frame JS time
long tasks during gesture
radial DOM node count
thumbnail cache hit rate
```

## Implementation steps

1. Finish `WorkshopInteractionTelemetry.js`.
2. Use `performance.now()` and marks/measures around interaction boundaries.
3. Avoid telemetry allocation on every pointer sample in production.
4. Keep detailed tracing development-only where appropriate.
5. Add a compact QA report to `tmp/workshop-qa`.
6. Add performance assertions with generous initial thresholds, tighten after real measurement.
7. Log warnings when a gesture causes:
   - multiple final commits;
   - long main-thread task;
   - DOM node count growth;
   - stale preview result application.

## Target budgets

These are project targets to validate and tune, not claims about external industry standards:

```text
radial selector visual response: next frame
UI JS work during interaction: target p95 <= 1.5 ms
120 Hz interaction frame budget target: 8.33 ms
60 Hz fallback frame budget: 16.67 ms
final preview commits per gesture: exactly 1
long tasks > 50 ms during normal radial navigation: 0
radial item DOM count: constant with catalog size
```

A Tier B procedural proxy may take longer than one frame to generate, but it must never stall the interaction loop while doing so.

## Exit criteria

- QA report makes latency regressions visible.
- We can prove that final generation is not happening repeatedly during exploration.

---

# Stage 19 - Explicit lifecycle integration and compatibility cleanup

## Goal

Remove bootstrap enhancement glue after the new system is stable.

## Implementation steps

1. Instantiate `WorkshopRadialController` directly from `ProceduralWorkshopUi`.
2. Pass dependencies explicitly:
   - state store;
   - command bus;
   - preview scheduler;
   - context resolver;
   - input router;
   - material/component APIs.
3. Dispose it from `ProceduralWorkshopUi.dispose()`.
4. Remove workshop discovery code from bootstrap.
5. Remove MutationObserver logic used only to discover/synchronize our own workshop UI.
6. Remove legacy form-event radial paths.
7. Remove hidden-control clicking for materials.
8. Remove old radial material popup suppression code if the old popup is no longer part of the intended UX.
9. Keep one clear Escape hierarchy through the unified input/layer router.
10. Re-run full workshop QA after every cleanup deletion.

## Exit criteria

The final lifecycle becomes explicit:

```text
new ProceduralWorkshopUi()
  -> creates workshop subsystems
open()
close()
dispose()
```

No core workshop feature depends on observing DOM insertion to discover another workshop subsystem.

---

# Stage 20 - Final production hardening

## Goal

Declare the new interaction system production-ready only after failure paths and lifecycle issues are covered.

## Checklist

### State and history

- [ ] Cancel always restores committed state.
- [ ] One gesture creates at most one undo entry.
- [ ] Redo is deterministic.
- [ ] Form, radial and direct-manipulation views never disagree after settle.
- [ ] Baked recipe uses committed state only.
- [ ] Preview overlay is never serialized accidentally.

### Async preview

- [ ] Stale planner results cannot overwrite newer state.
- [ ] Closing the workshop cancels pending proxy/final work.
- [ ] Reopening starts from clean committed state.
- [ ] Renderer disposal cannot race with pending preview application.

### Input

- [ ] Mouse wheel.
- [ ] High-resolution trackpad.
- [ ] Mouse click.
- [ ] Keyboard only.
- [ ] Touch drag.
- [ ] Pen drag.
- [ ] Gamepad where supported.
- [ ] Pointer cancel/lost capture.
- [ ] Window blur during gesture.
- [ ] Escape at every interaction layer.

### Accessibility

- [ ] Every radial slot has correct accessible label.
- [ ] Roving tab/focus is stable under virtualization.
- [ ] Reduced-motion path works.
- [ ] Disabled controls explain why where needed.
- [ ] Keyboard can reach all operations exposed to mouse.

### Performance

- [ ] No DOM growth during long scrolling.
- [ ] No repeated final generation during one gesture.
- [ ] No texture/shader first-use hitch for prewarmed neighbors.
- [ ] Thumbnail cache is bounded.
- [ ] No leaked render targets/materials on repeated open/close cycles.
- [ ] 120 Hz target remains viable for UI-only interaction on capable hardware.
- [ ] 60 Hz remains stable on the project's normal supported baseline.

### Responsive layouts

- [ ] Wide desktop.
- [ ] Standard laptop.
- [ ] Narrow desktop/tablet.
- [ ] Touch/coarse pointer.
- [ ] No radial controls cover critical component handles.

### Regression

- [ ] Existing procedural archetypes still generate.
- [ ] Component transforms still work.
- [ ] Opening attachments still work.
- [ ] Material overrides still serialize.
- [ ] Imported PBR maps still work.
- [ ] Bake -> Objects still works.

---

## 6. Recommended implementation order

The dependency order should be treated as follows:

```text
0. QA baseline
   |
1. State store
   |
2. Semantic commands/history
   |
3. Preview transactions
   |
4. Three-tier preview scheduler
   |
5. Radial -> commands, remove DOM edit bridge
   |
6. Analog carousel physics
   |
7. Fixed-slot virtualization
   |
8. Semantic contexts
   |
9. Unified input router
   |
10. Marking-menu expert mode
   |
11. Direct manipulation + measurements
   |
12. Material thumbnails + asset browser
   |
13. Favorites/recent
   |
14. Comparison mode
   |
15. Visual/motion polish
   |
16. Coalesced pointer sampling
   |
17. WebGPU prewarm/hitch control
   |
18. Performance telemetry/budgets
   |
19. Lifecycle cleanup
   |
20. Production hardening
```

Some later stages can be developed in parallel once Stage 5 is complete, but do not skip the state/transaction/preview foundation to get to visual polish faster.

---

## 7. Suggested stage-sized commits

Keep commits independently reviewable. Example sequence:

```text
Add workshop state store
Route workshop form through state store
Add semantic workshop command bus
Group workshop command history by gesture
Add workshop preview transactions
Add tiered workshop preview scheduler
Route radial structure controls through commands
Route radial material controls through commands
Add spring radial carousel physics
Virtualize radial carousel slots
Add semantic workshop context resolver
Add unified workshop input router
Add expert marking-menu gestures
Integrate direct manipulation transactions
Add workshop measurement overlays
Add material thumbnail cache
Add virtualized material browser
Add radial favorites and recent choices
Add material comparison mode
Polish radial hierarchy and transitions
Add coalesced pointer sampling
Prewarm adjacent workshop material resources
Add workshop interaction performance telemetry
Integrate radial lifecycle into workshop UI
Remove legacy radial DOM bridge
Harden workshop interaction lifecycle
```

Avoid one giant `Rewrite workshop UI` commit.

---

## 8. APIs to stabilize early

The following interfaces should become stable before later stages depend on them.

### WorkshopStateStore

```js
class WorkshopStateStore {
  getCommitted();
  getResolved();
  subscribe(listener);
  applyCommitted(commandResult, meta);
  applyPreview(commandResult, meta);
  clearPreview(meta);
  serializeRecipe();
}
```

### WorkshopCommandBus

```js
class WorkshopCommandBus {
  beginGesture(meta);
  preview(command, meta);
  commit(command, meta);
  cancelGesture(gestureId);
  undo();
  redo();
}
```

### WorkshopPreviewScheduler

```js
class WorkshopPreviewScheduler {
  applyImmediate(change, state);
  requestProxy(state, meta);
  requestFinal(state, meta);
  cancel(meta);
  flushFinal();
}
```

### WorkshopInputRouter

```js
class WorkshopInputRouter {
  pushLayer(layer);
  removeLayer(layer);
  handle(action, payload);
  setInputFamily(family);
}
```

### WorkshopContextResolver

```js
class WorkshopContextResolver {
  resolve(selectionState, workshopState);
  actionsFor(context);
}
```

Avoid exposing renderer internals through these APIs.

---

## 9. Preview property classification

Every editable property should be explicitly classified so the scheduler knows its cheapest safe preview path.

Initial classification:

### Tier A candidates

```text
material preset where existing mesh/material can be swapped
base color
tint
roughness
metalness
normal strength
height strength
material weathering
simple component transform
visibility toggles when geometry already exists
```

### Tier B candidates

```text
roof scale
roof overhang
width
depth
height
opening dimensions/repetition
shape variations with topology changes
```

### Tier C only unless optimized later

```text
archetype switch
major semantic topology change
remesh finalization
procedural ivy final generation
full expensive procedural surface regeneration
```

This classification should live in code/config owned by the preview subsystem, not be inferred from UI element type.

---

## 10. Failure handling rules

### Preview failure

If a Tier B proxy fails:

1. keep the last valid preview visible;
2. keep radial interaction usable;
3. show a compact error once;
4. allow user to cancel back to committed state;
5. do not corrupt committed recipe.

### Final generation failure

If Tier C fails:

1. committed state must remain known;
2. preserve the last valid visual preview if safe;
3. mark final preview as failed;
4. allow retry;
5. do not bake invalid/stale geometry.

### Material import failure

1. imported source is not committed;
2. previous material remains active;
3. transaction ends safely;
4. temporary resources are disposed.

### Input interruption

On `pointercancel`, lost capture, window blur or workshop close:

- cancel or explicitly finalize according to the active interaction contract;
- never leave a transaction orphaned;
- clear transient readouts/drag state.

---

## 11. Memory and allocation rules

During continuous radial input:

- do not rebuild lane DOM;
- do not serialize the whole recipe each frame;
- do not clone the complete material document each pointer sample;
- do not allocate arrays proportional to the complete asset catalog;
- do not create/dispose preview materials every frame;
- do not create timers per raw pointer sample;
- do not leave `requestAnimationFrame` loops running while idle.

Prefer:

- fixed reusable slots;
- structural sharing;
- frame-coalesced state writes;
- bounded caches;
- pooled/reused preview materials where safe;
- one settle timer/transaction per active lane.

---

## 12. Definition of AAA-ready for this workshop

The workshop should not be called AAA-ready because it looks polished. It is ready when all of these are true:

1. Manipulation feels immediate even when final generation is expensive.
2. Scrolling through options does not rebuild the final object continuously.
3. Input behavior is consistent across mouse, keyboard and touch.
4. Cancel is completely trustworthy.
5. One gesture is one undo entry.
6. Contextual controls appear where the user is working.
7. Large catalogs do not change radial DOM complexity.
8. The interface teaches beginners but supports expert muscle memory.
9. Direct manipulation and radial controls edit the same state through the same command system.
10. First-use materials do not hitch after expected prewarming.
11. Visual hierarchy keeps the object more important than the controls.
12. Latency and generation counts are measured in QA instead of judged only by FPS.
13. Repeated workshop open/close/edit cycles do not leak GPU or DOM resources.
14. The final persisted/baked recipe is never contaminated by transient preview state.

---

## 13. Definition of SOTA for this project

After AAA readiness, the system reaches the intended SOTA target when the following advanced pieces are also complete:

- analog spring carousel with hysteresis;
- fixed-slot virtualization;
- semantic/contextual radial action sets;
- expert marking-menu gestures;
- direct manipulation with shared transactions;
- spatial measurements;
- visual material thumbnails and a GPU-friendly atlas/cache;
- favorites/recent fast path plus virtualized deep browser;
- comparison mode;
- coalesced pointer sampling where available;
- proactive WebGPU resource/pipeline prewarm;
- input-to-visual latency telemetry and enforced interaction budgets;
- adaptive desktop/tablet/mobile radial layouts;
- explicit workshop lifecycle with no DOM-discovery compatibility glue.

At that point the radial system is no longer an ornamental menu. It becomes the high-speed interaction layer for the procedural editor.

---

## 14. First implementation milestone

The first meaningful milestone is **not** the analog animation. It is completion of Stages 0-5.

That milestone delivers:

```text
QA baseline
+ authoritative state store
+ semantic commands
+ grouped history
+ preview transactions
+ Tier A/B/C scheduler
+ radial controls no longer driving the form
```

Only after this milestone should substantial effort be spent on carousel physics, marking menus and visual polish.

If we skip this foundation, every later feature will duplicate state synchronization, cancellation and preview logic and the workshop will become harder to maintain despite looking better.

---

## 15. Final implementation milestone

The final milestone should prove the complete interaction loop with one representative complex workflow:

1. Open workshop.
2. Select a roof semantic component.
3. Contextual roof controls appear.
4. Scroll roof materials through the analog carousel.
5. Material visually previews immediately with no final procedural regeneration per step.
6. Stop scrolling; one final material commit occurs.
7. Drag roof-height handle using a Tier B proxy.
8. Spatial height readout follows the manipulation.
9. Release; one Tier C regeneration occurs.
10. Hold compare and preview an alternate material.
11. Release compare; original material returns.
12. Use marking-menu gesture to switch to Surfaces.
13. Select a wall material from favorites/recent.
14. Undo once; the last gesture is completely reverted.
15. Redo once; it is restored exactly.
16. Bake the object.
17. Close and reopen the workshop.
18. No stale preview transaction remains and no GPU/DOM resources leaked.

The QA harness should eventually automate as much of this path as practical, with manual feel testing remaining for trackpad inertia, touch ergonomics and visual polish.
