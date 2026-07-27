# Inventory System Implementation Plan

**Status:** Planned  
**Target branch:** `main`  
**Date:** 2026-07-27  
**Scope:** Player inventory, equipment, weapon sets, currency, persistence, input routing, UI, tests, and future gameplay integration.

## Goal

Pressing `I` must open a medieval RPG inventory overlay similar in structure to the supplied reference:

- Weapon set I on the left.
- Character armour and accessory slots in the centre.
- Weapon set II on the right.
- Currency below the equipment section.
- A general inventory grid below.
- Dark recessed slots inside a carved stone or metal frame.

The reference is a visual and structural guide. The runtime UI must be assembled from reusable DOM and texture components rather than one fixed background image.

## Non-goals for the first milestone

The first version should not include:

- Diablo-style variable-size item packing.
- Item rotation inside the bag grid.
- Per-slot Three.js item rendering.
- A complete combat-stat system.
- Crafting, loot containers, vendors, or dropped-item world entities.
- Networked inventory authority.
- A full character-paper-doll renderer.

Use fixed one-slot inventory entries first. Spatial packing would add collision, rotation, auto-placement, partial-grid dragging, and many failure cases without improving the first playable inventory milestone enough to justify the complexity.

---

## Current code constraints

The current application already has a full-screen world map opened with `M`.

Relevant files:

```text
src/main.js
src/editor/map/WorldMapController.js
src/editor/map/WorldMapUi.js
src/editor/map/worldMap.css
src/editor/player/PlayerController.js
src/editor/TerrainAwareEditorController.js
src/editor/WorldDocument.js
src/config/loadEditorConfig.js
```

Important observations:

1. `WorldMapController` owns global `keydown` and `keyup` listeners.
2. `PlayerController` stops propagation for nearly every non-Escape key while walking.
3. The current map listener depends on registration order so `M` is received before player input consumes it.
4. The map releases pointer lock while open and restores it when closed.
5. The world document already supports optional systems such as campaign data, constructions, procedural assets, and visual settings.
6. Project configuration is YAML-driven and loaded with `js-yaml`.

Adding another independent global listener for `I` would work temporarily, but would deepen the input-order dependency. Inventory should therefore begin with a shared gameplay overlay coordinator.

---

# Architecture

## 1. Shared gameplay overlay coordinator

Create:

```text
src/editor/ui/GameplayOverlayController.js
src/editor/ui/gameplayOverlayConstants.js
```

The coordinator is the single authority for large gameplay overlays.

Initial supported overlays:

```text
null
inventory
world-map
```

Future overlays can register later:

```text
dialogue
crafting
character
spellbook
container
vendor
```

### Responsibilities

- Listen for `KeyI`, `KeyM`, and `Escape`.
- Ignore repeated keydown events.
- Ignore shortcuts while typing in:
  - `input`
  - `textarea`
  - `select`
  - content-editable elements
- Ensure only one large gameplay overlay is active.
- Release pointer lock when an overlay opens.
- Clear held movement and jump input when an overlay opens.
- Restore pointer lock when the overlay closes, when appropriate.
- Block player movement, mouse look, terrain editing, construction placement, and other world interactions while an overlay is active.
- Notify registered overlay controllers when active state changes.
- Provide one state subscription API for UI and gameplay systems.
- Own shortcut precedence rather than relying on listener registration order.

### Suggested state

```js
{
  activeOverlay: null,
  previousOverlay: null,
  restorePointerLock: false
}
```

### Suggested public API

```js
registerOverlay(id, handlers)
open(id)
close(id)
toggle(id)
closeActive()
isOpen(id)
isWorldInputBlocked()
subscribe(listener)
dispose()
```

### Behaviour rules

- Pressing `I` while closed opens inventory.
- Pressing `I` while inventory is open closes it.
- Pressing `I` while the world map is open closes the map and opens inventory.
- Pressing `M` while inventory is open closes inventory and opens the map.
- `Escape` first cancels local overlay interactions such as dragging; otherwise it closes the active overlay.
- Opening any overlay clears held gameplay input immediately.
- Closing an overlay should not change the current player or editor mode.

### Required refactor

Refactor `WorldMapController` so it no longer owns global keyboard listeners. It should expose open, close, toggle, and local interaction behaviour while the shared coordinator handles shortcut routing.

This refactor must preserve:

- `M` behaviour.
- `Escape` behaviour.
- Pointer-lock release and restoration.
- Teleport behaviour.
- Empty-state behaviour when no Azgaar map is available.

---

## 2. Player input blocking

Update:

```text
src/editor/player/PlayerController.js
```

Add an explicit UI-blocked state instead of depending only on pointer-lock loss.

Suggested API:

```js
setUiBlocked(blocked)
```

When blocked:

- Clear all held movement keys.
- Clear queued jump input.
- Reject new movement keys.
- Reject mouse-look updates.
- Reject pointer-lock requests initiated by normal canvas clicks.
- Preserve the player's current position, yaw, pitch, and enabled mode.

The performance QA harness must remain able to drive the player independently. The implementation must clearly define whether harness input bypasses the UI block. Recommended behaviour: the harness bypasses normal pointer-lock requirements but still respects an explicit QA-owned override.

---

## 3. Item catalogue

Create:

```text
config/items.yaml
src/editor/inventory/ItemCatalog.js
src/editor/inventory/itemCatalogSchema.js
src/editor/inventory/inventoryConstants.js
```

Item definitions belong in YAML, not UI code.

### Example schema

```yaml
items:
  iron_sword:
    label: Iron Sword
    category: weapon
    icon: /assets/items/iron-sword.webp
    stackLimit: 1
    equipmentSlots:
      - mainHand
    weaponType: sword
    hands: 1
    value: 45
    weight: 3.2
    rarity: common
    tags:
      - melee
      - metal

  wooden_shield:
    label: Wooden Shield
    category: armour
    icon: /assets/items/wooden-shield.webp
    stackLimit: 1
    equipmentSlots:
      - offHand
    value: 22
    weight: 4.1
    rarity: common
    tags:
      - shield
      - wood

  healing_potion:
    label: Healing Potion
    category: consumable
    icon: /assets/items/healing-potion.webp
    stackLimit: 10
    action: consume_healing_potion
    value: 20
    weight: 0.2
    rarity: common
    tags:
      - potion
      - healing
```

### Required validation

Reject invalid definitions at startup:

- Duplicate item keys.
- Missing labels.
- Missing or invalid category.
- Missing icon path when required.
- `stackLimit < 1`.
- Invalid rarity.
- Unknown equipment slot.
- Invalid `hands` value.
- Two-handed item assigned to an off-hand-only slot.
- Consumable without a registered action key, once action registration exists.
- Negative weight or value.

### Item catalogue responsibilities

- Resolve definitions by key.
- Expose immutable definitions.
- Validate loaded save entries against known item keys.
- Resolve icon, label, rarity, stack limit, equipment compatibility, and display data.
- Keep gameplay effects outside the UI layer.

---

## 4. Inventory state authority

Create:

```text
src/editor/inventory/InventoryStore.js
src/editor/inventory/InventoryEntry.js
src/editor/inventory/InventoryValidation.js
```

`InventoryStore` is the only authority for:

- Bag contents.
- Equipment.
- Weapon sets.
- Active weapon set.
- Currency.

UI code must never mutate arrays or equipment objects directly.

### Suggested state

```text
InventoryState
├── version
├── capacity
├── bagSlots[]
├── equipment
│   ├── armour
│   │   ├── head
│   │   ├── chest
│   │   ├── hands
│   │   ├── legs
│   │   └── feet
│   ├── accessories
│   │   ├── neck
│   │   ├── ring1
│   │   ├── ring2
│   │   └── cloak
│   └── weaponSets
│       ├── set1
│       │   ├── mainHand
│       │   └── offHand
│       └── set2
│           ├── mainHand
│           └── offHand
├── activeWeaponSet
└── currency
    └── gold
```

### Inventory entry

```js
{
  itemKey: 'iron_sword',
  quantity: 1,
  instanceId: 'item-123',
  metadata: {
    durability: 78
  }
}
```

Rules:

- `metadata` is optional.
- Stackable items normally do not need unique instance metadata.
- Non-stackable equipment should have a stable `instanceId`.
- Entries with incompatible metadata must not merge.
- All state returned to consumers should be cloned or immutable.

### Required store operations

```text
addItem
removeItem
moveItem
swapItems
mergeStacks
splitStack
equipItem
unequipItem
switchWeaponSet
useItem
dropItem
setGold
addGold
removeGold
toDocument
replaceDocument
subscribe
```

### Transaction rules

Every operation must be atomic.

Examples:

- Unequipping into a full bag fails without changing equipment.
- Equipping a two-handed weapon must resolve the off-hand item before committing.
- Stack splitting must not lose or duplicate quantity.
- Adding more than available capacity must return a clear result showing accepted and rejected quantities.
- Invalid operations return structured failures or throw domain-specific errors consistently.

Recommended result shape:

```js
{
  ok: false,
  code: 'inventory_full',
  message: 'Inventory is full.'
}
```

### Default capacity

Start with 40 bag slots. Keep capacity in configuration rather than hardcoding it in rendering code.

---

## 5. Inventory controller

Create:

```text
src/editor/inventory/InventoryController.js
```

The controller manages interaction state, not item authority.

### Responsibilities

- Register inventory with `GameplayOverlayController`.
- Open and close inventory.
- Track selected slot.
- Track hovered slot.
- Track drag source and drag preview.
- Cancel drag safely.
- Route click, double-click, right-click, keyboard, and touch interactions to the store.
- Manage action-menu and tooltip state.
- Switch weapon sets.
- Publish a compact view state to `InventoryUi`.

### Suggested controller state

```js
{
  isOpen: false,
  selectedLocation: null,
  hoveredLocation: null,
  drag: null,
  contextMenu: null,
  tooltip: null
}
```

### Location model

Use structured slot locations rather than string parsing throughout the code.

Examples:

```js
{ kind: 'bag', index: 12 }
{ kind: 'equipment', slot: 'head' }
{ kind: 'weapon', set: 1, slot: 'mainHand' }
```

Provide one canonical serializer only when a DOM key is needed.

---

## 6. Inventory UI

Create:

```text
src/editor/inventory/InventoryUi.js
src/editor/inventory/inventory.css
```

Import `inventory.css` from `src/main.js` beside the existing player and world-map UI styles.

### Layout

```text
┌─────────────────────────────────────────────────────────┐
│ Inventory                                           [X] │
├──────────────┬────────────────────┬─────────────────────┤
│ Weapon Set I │ Character armour   │ Weapon Set II       │
│              │ and accessories    │                     │
│ Main hand    │ Head               │ Main hand           │
│ Off hand     │ Chest              │ Off hand            │
│              │ Hands / Legs       │                     │
│              │ Boots / Jewellery  │                     │
├──────────────┴────────────────────┴─────────────────────┤
│                         Gold                            │
├─────────────────────────────────────────────────────────┤
│ Bag grid                                                │
│ □ □ □ □ □ □ □ □                                        │
│ □ □ □ □ □ □ □ □                                        │
│ □ □ □ □ □ □ □ □                                        │
│ □ □ □ □ □ □ □ □                                        │
│ □ □ □ □ □ □ □ □                                        │
├─────────────────────────────────────────────────────────┤
│ Item details and actions                                │
└─────────────────────────────────────────────────────────┘
```

### Visual direction

- Dark translucent full-screen backdrop.
- Centred carved-stone or aged-metal panel.
- Dark recessed slot wells.
- Bronze or dull-gold trim.
- Mild rough texture variation.
- Small icon shadows.
- Rarity colour limited to a thin border, corner mark, or small badge.
- No heavy glow.
- No animated background noise.
- Preserve the project's existing gold accent so the inventory still belongs to the same interface family.

### Proposed UI assets

```text
public/assets/ui/inventory/
├── stone-tile.webp
├── stone-edge.webp
├── stone-corner.webp
├── slot-well.webp
├── selected-frame.webp
└── gold-coin.webp
```

The panel should use nine-slice-like composition in CSS where practical. Do not create one large fixed-resolution screenshot as the whole UI.

### Responsive behaviour

Desktop:

- Equipment above the bag grid.
- 8-column bag grid.
- Tooltip near the pointer while remaining inside the viewport.

Narrow viewport and touch:

- Panel can occupy most of the viewport.
- Equipment sections may stack or become tabs.
- Bag grid reduces column count while preserving minimum touch target size.
- Selected-item actions remain visible without hover.
- Scrolling must occur inside the panel, never on the world viewport.

### Accessibility

- Use semantic buttons for slots.
- Every slot needs an accessible label.
- Use `aria-pressed` or equivalent for selection where appropriate.
- Keyboard focus must remain trapped inside the open overlay.
- Closing returns focus to a meaningful viewport control.
- Respect `prefers-reduced-motion`.
- Do not communicate rarity only through colour.

---

# Interaction design

## Desktop mouse

- Drag an item between compatible slots.
- Drop on another occupied bag slot to swap or merge.
- Drop on a compatible equipment slot to equip.
- Double-click equipment to unequip.
- Double-click consumables to use, once item actions exist.
- Right-click opens an action menu.
- Hover shows a tooltip.
- Mouse wheel over inventory never zooms or changes the world.

## Touch

- Tap to select.
- Tap a destination to move.
- Show explicit actions:
  - Equip
  - Unequip
  - Use
  - Split
  - Drop
- Long-press may open the action menu later, but must not be the only way to perform essential actions.

## Keyboard

- `I`: open or close inventory.
- `Escape`: cancel drag, close a local menu, or close inventory.
- Arrow keys: move slot focus.
- `Enter`: select or activate the focused slot.
- `1` and `2`: switch weapon sets while inventory is open.
- Do not use `Delete` as an immediate drop action.
- Dropping an item requires an explicit confirmation path.

## Drag safety

- Dragging is visual state only until a valid drop commits.
- Closing inventory during a drag cancels it.
- Losing browser focus cancels it.
- Dropping outside the panel returns the item to its source unless an explicit world-drop mode is later implemented.
- Invalid destinations show a clear visual rejection without mutating the store.

---

# Rendering and performance

## Required strategy

- Use DOM and CSS for the inventory layout.
- Use transparent WebP item icons.
- Keep persistent slot DOM nodes.
- Update only affected slots after a store change.
- Preload or asynchronously decode common icons.
- Render nothing inventory-specific in the animation loop while closed.

## Do not

- Rebuild the full overlay every frame.
- Create one Three.js renderer per slot.
- Render dozens of GLB models in the grid.
- Decode all assets synchronously when `I` is pressed.
- Subscribe every slot directly to the store.
- Add per-frame inventory polling.

## Optional later enhancement

A single shared 3D preview viewport may be added for the selected item. It should:

- Use one renderer or one existing renderer integration.
- Render only the selected item.
- Pause when inventory is closed.
- Fall back to the 2D icon.
- Never block opening the inventory.

## Performance acceptance

- Closed inventory has no measurable frame-time effect.
- Opening does not trigger a visible hitch.
- Opening does not compile new world render pipelines.
- Slot updates are proportional to changed slots, not total slots.
- No new per-frame allocations from the inventory while closed.
- No gameplay input leaks through the overlay.

---

# Persistence

## Document shape

Extend the existing world document with optional player state:

```js
{
  playerState: {
    inventory: inventoryStore.toDocument()
  }
}
```

Suggested inventory document:

```js
{
  version: 1,
  capacity: 40,
  bagSlots: [],
  equipment: {},
  activeWeaponSet: 1,
  currency: {
    gold: 0
  }
}
```

## Versioning decision

Do not increase the entire infinite-world document version only for this optional field.

A current version-6 document without `playerState` should load with a valid empty inventory or configured starting inventory, depending on the load context.

The inventory subsystem needs its own version field so later migrations can be isolated from terrain format changes.

## Load transaction

The load path must:

1. Capture the current inventory snapshot.
2. Validate the incoming inventory document.
3. Load the incoming inventory.
4. Load the remaining world systems.
5. Restore the previous inventory if any later subsystem fails.
6. Clear undo and redo history only after the complete document succeeds.

## World reset semantics

`Clear World` must preserve player inventory.

It should continue to clear:

- Terrain overrides.
- Objects.
- Constructions.
- Voxel stamps.
- Campaign metadata.

Inventory is player state, not world terrain state.

Add a separate explicit flow later for:

```text
Reset Player
New Game
Delete Character
```

## Azgaar import semantics

Importing a new Azgaar world must not silently delete inventory.

The import path should preserve player inventory unless the user starts a new game or explicitly requests a player reset.

---

# Starting inventory

Use configuration rather than constructor hardcoding.

Create:

```text
config/player-starting-loadout.yaml
```

Example:

```yaml
capacity: 40
currency:
  gold: 25
items:
  - itemKey: iron_sword
    quantity: 1
  - itemKey: wooden_shield
    quantity: 1
  - itemKey: leather_armour
    quantity: 1
  - itemKey: healing_potion
    quantity: 3
  - itemKey: torch
    quantity: 5
  - itemKey: rope
    quantity: 1
  - itemKey: bread
    quantity: 2
```

For development screenshots and QA, support a development-only query option such as:

```text
?inventoryDemo=1
```

Production load rules must distinguish:

- New player creation.
- Loading an existing player inventory.
- Loading an older save with no inventory field.
- Importing a different world while preserving the player.

---

# Future gameplay integration

Implement only after the inventory UI and persistence are stable.

## World pickups

- World pickup calls `inventoryStore.addItem`.
- A partial pickup leaves the rejected quantity in the world.
- Pickup entity is removed only after the accepted quantity is confirmed.

## Loot containers

- Use the same inventory-entry model.
- Transfer operations must be atomic across player and container stores.
- Add a transaction coordinator rather than performing two unrelated mutations.

## Equipment visuals

- Active weapon set controls the visible held item.
- Armour slots can later drive character model attachments or material variants.
- UI must not directly manipulate player meshes.

## Item use

- Item definitions reference action keys.
- A gameplay action registry resolves the key.
- Inventory decrements only after the action confirms success.
- Failed actions preserve the item quantity.

## Crafting

- Recipes consume item keys and quantities.
- Crafting checks output capacity before consuming ingredients.
- Crafting transactions must not lose items if output placement fails.

## Dropping

- Dropping creates a world pickup through a gameplay service.
- Inventory removes the entry only after the world pickup is successfully created.
- Do not create world entities directly from `InventoryUi`.

---

# Testing plan

The repository already uses Node tests, production asset validation, build verification, and Playwright tooling. Inventory must follow the same model.

## Unit tests: item catalogue

- Loads valid YAML.
- Rejects duplicate keys.
- Rejects invalid equipment slots.
- Rejects invalid stack limits.
- Rejects invalid rarity values.
- Rejects negative values and weights.
- Returns immutable definitions.

## Unit tests: inventory store

- Adds a non-stackable item.
- Adds and merges stackable items.
- Rejects incompatible metadata merges.
- Reports partial additions when capacity is reached.
- Removes exact quantities.
- Prevents negative quantities.
- Splits stacks correctly.
- Swaps bag entries.
- Equips compatible items.
- Rejects incompatible equipment.
- Handles two-handed weapons.
- Rolls back failed unequip operations.
- Switches active weapon sets.
- Prevents negative gold.
- Serialises and restores exactly.
- Rejects unknown item keys during document load.
- Emits one coherent change notification per transaction.

## Unit tests: overlay coordinator

- `I` opens inventory.
- Repeated `I` is ignored.
- `I` closes inventory.
- `M` opens map.
- Inventory and map are mutually exclusive.
- `Escape` closes the active overlay.
- Shortcuts are ignored while typing.
- Opening clears movement input.
- Opening releases pointer lock.
- Closing restores pointer lock when appropriate.
- Closing does not restore pointer lock when it was not previously held.

## Unit tests: inventory controller

- Selects a slot.
- Cancels drag.
- Commits a valid move.
- Rejects an invalid drop.
- Cancels drag on close.
- Switches weapon sets.
- Does not mutate the store directly.

## Save and load tests

- Inventory round trip.
- Older version-6 world document defaults safely.
- Invalid inventory rejects the complete load.
- Failed world load restores the previous inventory.
- Azgaar import preserves inventory.
- `Clear World` preserves inventory.
- New-game reset clears or replaces inventory explicitly.

## Playwright acceptance

Create:

```text
scripts/run-inventory-qa.mjs
```

Add:

```json
{
  "qa:inventory": "node scripts/run-inventory-qa.mjs"
}
```

Acceptance flow:

1. Start the application.
2. Enter Player mode.
3. Acquire pointer lock.
4. Press `I`.
5. Verify inventory becomes visible.
6. Verify pointer lock is released.
7. Hold `W` and verify the player does not move.
8. Move a potion between bag slots.
9. Equip a sword.
10. Switch weapon sets.
11. Close with `I`.
12. Verify pointer lock and movement resume.
13. Save and reload.
14. Verify all bag, equipment, weapon-set, currency, and active-set state.
15. Capture desktop and narrow-viewport screenshots.

## Visual acceptance

- Inventory is centred and readable at supported resolutions.
- Equipment layout is visually distinct from the bag grid.
- Selected, hovered, valid-drop, and invalid-drop states are obvious.
- Text remains readable over the game background.
- No world interaction occurs through the overlay.
- Touch targets are large enough on narrow screens.
- The panel resembles a medieval carved interface without copying the reference as a single image.

---

# Implementation phases

## Phase I0 — Contract and state

- Add item and inventory constants.
- Add `config/items.yaml`.
- Implement catalogue validation.
- Implement `InventoryStore`.
- Add store and catalogue tests.

### Exit criteria

- All store operations are atomic.
- Full state round trip passes.
- No DOM or Three.js dependency exists in the store.

## Phase I1 — Shared overlay input

- Add `GameplayOverlayController`.
- Refactor world map shortcut ownership.
- Add `PlayerController.setUiBlocked`.
- Add overlay and player-input tests.

### Exit criteria

- `M` behaviour remains unchanged.
- No listener registration-order dependency remains.
- Only one large overlay can be active.
- World input is blocked while an overlay is active.

## Phase I2 — Functional inventory UI

- Add `InventoryController`.
- Add `InventoryUi`.
- Add untextured functional slot layout.
- Add selection, move, swap, stack, equip, and unequip.
- Add keyboard and touch-compatible interaction.

### Exit criteria

- `I` opens and closes the inventory.
- Core inventory operations are usable without developer tools.
- Inventory remains responsive at 40 slots.

## Phase I3 — Medieval visual pass

- Add reusable frame and slot textures.
- Add transparent item icons.
- Add tooltips and action menu.
- Add responsive layout.
- Add accessibility pass.

### Exit criteria

- Visual acceptance screenshots pass.
- UI remains readable on desktop and narrow viewport.
- No opening hitch is introduced.

## Phase I4 — Persistence

- Extend `TerrainAwareEditorController.toDocument()`.
- Extend `loadDocument()` with rollback-safe inventory loading.
- Add older-save compatibility.
- Preserve inventory across `Clear World` and Azgaar import.

### Exit criteria

- Save and load round trip passes.
- Failed loads restore prior inventory.
- Existing version-6 worlds remain loadable.

## Phase I5 — QA and hardening

- Add `qa:inventory` Playwright flow.
- Add pointer-lock acceptance.
- Add movement-block acceptance.
- Add desktop and narrow screenshots.
- Add performance checks.

### Exit criteria

- Unit tests pass.
- Inventory QA passes.
- `npm run build` passes.
- Existing world-map and player controls remain green.

## Phase I6 — Gameplay integration

Implement separately after I0-I5 are stable:

- World pickups.
- Loot containers.
- Item actions.
- Equipment visuals.
- Crafting.
- Dropped world items.

Each feature should have its own transaction and acceptance tests.

---

# Proposed file changes

```text
config/items.yaml
config/player-starting-loadout.yaml

src/config/loadEditorConfig.js
src/config/validateEditorConfig.js

src/editor/ui/GameplayOverlayController.js
src/editor/ui/gameplayOverlayConstants.js

src/editor/player/PlayerController.js

src/editor/map/WorldMapController.js
src/editor/map/WorldMapUi.js

src/editor/inventory/InventoryEntry.js
src/editor/inventory/InventoryValidation.js
src/editor/inventory/ItemCatalog.js
src/editor/inventory/InventoryStore.js
src/editor/inventory/InventoryController.js
src/editor/inventory/InventoryUi.js
src/editor/inventory/inventoryConstants.js
src/editor/inventory/itemCatalogSchema.js
src/editor/inventory/inventory.css

src/editor/TerrainAwareEditorController.js
src/editor/WorldDocument.js
src/main.js

public/assets/ui/inventory/stone-tile.webp
public/assets/ui/inventory/stone-edge.webp
public/assets/ui/inventory/stone-corner.webp
public/assets/ui/inventory/slot-well.webp
public/assets/ui/inventory/selected-frame.webp
public/assets/ui/inventory/gold-coin.webp
public/assets/items/*.webp

scripts/run-inventory-qa.mjs
```

Test files should follow the repository's existing test naming and placement conventions rather than creating a new test layout only for inventory.

---

# Risks and mitigations

## Input listener ordering

**Risk:** `PlayerController` consumes keys before overlays receive them.  
**Mitigation:** centralise shortcut ownership in `GameplayOverlayController`.

## Partial inventory mutations

**Risk:** equipment or stack operations lose items when a later validation fails.  
**Mitigation:** calculate and validate the complete next state before committing once.

## Save corruption

**Risk:** inventory loads successfully but another world subsystem fails.  
**Mitigation:** include inventory in the existing rollback transaction.

## UI hitch on first open

**Risk:** synchronous icon decoding or DOM construction stalls a frame.  
**Mitigation:** create persistent UI nodes during boot and decode common icons asynchronously.

## Over-engineering the first milestone

**Risk:** spatial packing, full combat effects, and world drops delay the basic screen.  
**Mitigation:** fixed slots and UI-independent store first; gameplay integrations are later phases.

## Touch interaction conflict

**Risk:** drag-only design is unusable on mobile.  
**Mitigation:** support tap-select and tap-destination from the first UI phase.

## World reset semantics

**Risk:** `Clear World` unexpectedly destroys player items.  
**Mitigation:** keep player inventory outside world-clear operations and provide an explicit player reset later.

---

# Final acceptance checklist

- [ ] `I` opens inventory from Player mode.
- [ ] `I` closes inventory.
- [ ] `Escape` cancels local interactions and closes inventory.
- [ ] `M` and `I` never leave two overlays open.
- [ ] Opening clears movement and jump input.
- [ ] Player cannot move or look while inventory is open.
- [ ] Pointer lock is restored correctly after closing.
- [ ] Inventory supports move, swap, stack, split, equip, unequip, and weapon-set switching.
- [ ] Invalid operations are atomic and do not lose items.
- [ ] Inventory persists in saves.
- [ ] Existing version-6 saves remain compatible.
- [ ] `Clear World` preserves player inventory.
- [ ] Azgaar import preserves player inventory.
- [ ] UI works with mouse, keyboard, and touch.
- [ ] Overlay is responsive on desktop and narrow viewport.
- [ ] Closed inventory has no measurable runtime cost.
- [ ] Inventory QA and existing map/player tests pass.
- [ ] Production build passes.
