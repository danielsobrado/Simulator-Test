# Phase 5 — Radial palette, right-click, materials, albedo import

Status: **planned**. Depends on Phase 2 (materials need stones to sit on).

## Goal

Right-click a wall and get the workshop's circular palette, but for
constructions: material presets on the outer ring, wall-top actions on the inner
ring, and an inspector behind "More…" that can import an albedo image. This is
the "like in the bench a circular area" request, plus the reference game's
"paintbrush/colour tool" that also carries the Flat Top action.

## The right-click conflict

`EditorCamera.js:20` binds `RIGHT = THREE.MOUSE.ROTATE`, `LEFT = null`,
`MIDDLE = PAN`. **Right-drag is the only orbit control**, so rebinding it costs a
real capability. `contextmenu` is already `preventDefault`ed on the canvas
(`EditorController.js:90`, and `PlayerController.js:52` for walk mode).

**Use tap-versus-drag discrimination on the right button, gated to the
construction tool.** This mirrors `POINTER_SELECT_DISTANCE = 6` in
`ProceduralWorkshopMaterialController.js:11`, which is how the workshop already
distinguishes a palette-opening click from a camera drag.

```js
// onPointerDown — currently early-returns on event.button !== 0
if (event.button === 2 && this.tool === 'construction') {
  this.rightPointerStart = { x: event.clientX, y: event.clientY, time: event.timeStamp };
  // Do NOT preventDefault: MapControls still needs the event to begin its orbit.
}

// onPointerUp
if (event.button === 2 && this.rightPointerStart) {
  const travel = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  const elapsed = event.timeStamp - start.time;
  if (travel <= 6 && elapsed <= 400) this.openConstructionPalette(event);
  this.rightPointerStart = null;
}
```

A tap leaks under 6 px of orbit rotation. **Do not compensate in v1.** It is
imperceptible, and snapshotting and restoring `controls.target` /
`camera.quaternion` adds state that desynchronises with OrbitControls' damping —
a worse bug than the one it fixes.

## Extracting the radial palette

The workshop's palette is good and already solves petal layout, hover preview,
keyboard navigation and layered Escape. Extract it rather than reimplement.

### `src/editor/ui/RadialPalette.js`

`src/editor/ui/` already holds `LoadingOverlay` / `LoadingTracker` /
`loadingSources`, so it is the general editor-UI folder and the right home.

```js
new RadialPalette({ host, modifier, onSelect, onHover, onAction, onClose })

palette.open({
  clientX, clientY,
  rings: [{ radius, items: [{ id, label, color, glyph }] }],
  center: { action, glyph, label },   // the workshop's '↺'
  footer: { action, label },          // the workshop's 'More…'
});
palette.close();
palette.isOpen;
palette.focusStep(delta);   // arrow-key navigation between petals
palette.dispose();
```

Multi-ring is the one capability the workshop version lacks, and it is why the
signature takes `rings` rather than a flat item list — the construction palette
needs material presets *and* top actions at once.

### `src/editor/ui/radialPalette.css`

Carries the geometry currently in
`ProceduralWorkshopComponentController.css:206-281`: the 220 px disc,
`border-radius: 50%`, the radial-gradient donut, `--material-angle` and
`--material-color`, and the petal transform. Generalise the transform to take a
per-ring radius:

```css
.radial-palette__petal {
  transform:
    rotate(var(--angle))
    translateY(calc(-1 * var(--ring-radius)))
    rotate(calc(-1 * var(--angle)));
}
```

Petal angles stay `-90 + index * (360 / count)` per ring.

### Non-regression procedure for the workshop

The workshop palette working exactly as before is the acceptance criterion that
matters most here. Do it in this order:

1. Land `RadialPalette` + `radialPalette.css` with a `.radial-palette` base class
   and a caller-supplied modifier class.
2. Delete the palette **geometry** block from
   `ProceduralWorkshopComponentController.css`; re-add only its colours under
   `.radial-palette--workshop`.
3. Rewrite `openPalette` (`:270-294`), `closePalette`, and the `rootClick` /
   `palettePointerOver` branches as thin adapters. `previewPreset` (`:301`),
   `clearMaterialPreview` (`:315`), `commit` (`:322`), the local undo/redo
   (`:532-538`) and the layered Escape (`:550-555`) stay exactly as they are —
   the last becomes three `EscapeStack` registrations at priorities
   `palette` / `inspector` / `playerPaused`.
4. Add `tests/RadialPalette.test.js` before touching the workshop, so the
   extraction is covered on the way in.

## Construction palette contents

`src/editor/construction/ui/ConstructionPaletteController.js` (+ css).

- **Outer ring** — material favourites from `BUILTIN_WORKSHOP_MATERIAL_PRESETS`
  (`ProceduralWorkshopMaterialConfig.js:17`), filtered to families
  `walls` / `stone` / `roof`: `granite-masonry`, `limestone-masonry`,
  `sandstone-masonry`, `ochre-plaster`, `lime-plaster`, `slate-roof`.
- **Inner ring** (4 petals) — *Flat top* · *Crenellate* · *Ruin* · *Reset
  profile*. This is where the reference game puts Flat Top, and it is the reason
  `RadialPalette` takes rings.
- **Centre `↺`** — reset the material to the style's default.
- **`More…`** — a compact inspector: height, thickness, masonry style
  (the four `ConstructionStyleCatalog` keys), raise/lower radius, and
  **Import albedo…**.

Hover previews the material before committing, reusing the workshop's
preview/commit split so an abandoned hover leaves no history entry.

## Material storage — the part with a trap in it

### Records hold preset ids only

Phase 1 already enforced this: `style.materials` is validated with `requireId`,
so a data URL cannot enter a record. That matters because `ConstructionStore`
`structuredClone`s on every `get()` and `list()` (`ConstructionStore.js:3-5`) — a
700 KB data URL in a record would be deep-cloned on every read.

### `src/editor/construction/ConstructionMaterialStore.js`

A thin wrapper over `normalizeWorkshopMaterialDocument` /
`serializeWorkshopMaterialDocument`, persisted under a new world key:

```js
constructions: this.constructionStore.toDocument(),
constructionMaterials: this.constructionMaterialStore.toDocument(),   // NEW
```

in `TerrainAwareEditorController.toDocument()` / `loadDocument()`, with the same
rollback discipline the `constructions` key already has (`:247`, `:267-269`).

> **The non-obvious integration detail.** `normalizeWorkshopMaterialDocument`
> garbage-collects any preset not referenced by that document's own
> `materialDefaults` / `materialAreaOverrides` / `materialFavorites`
> (`ProceduralWorkshopMaterialConfig.js:236-243`), then drops the sources those
> presets used. A construction record referencing a custom preset would therefore
> **lose it on the next normalize** — the record is not part of the material
> document, so the GC cannot see the reference.
>
> Fix: on serialize, project every record's `style.materials.*` into
> `materialAreaOverrides` under region id `` `${recordId}:${family}` `` (which
> matches `VALID_REGION_ID`). The GC then keeps exactly what is in use. Run
> `ConstructionMaterialStore.gc(records)` on save and after every record delete.

This inherits for free: the 48-preset and 16-source caps, the 800 KB per-source
and 2.4 MB total data-URL caps, format validation through
`parseWorkshopImageDimensions`, and canonical sorted serialization.

### Albedo import

Reuse `prepareWorkshopAlbedo` (`ProceduralWorkshopTextureUpload.js`) unchanged
and store the result in `constructionMaterials.materialLibrary.sources`. Worst
case the save grows by 2.4 MB of base64 on top of the workshop's own 2.4 MB.
Acceptable, but surface the remaining budget the way the workshop's
`refreshBudget` does, so a user hitting the cap understands why.

### Applying a preset

Extend `createConstructionMaterials(record, materialDocument)` from Phase 2 to
resolve `style.materials[family]` through the document and apply it, mirroring
`applyPreset` (`ProceduralWorkshopComponentParts.js:134`): clone the material,
set `color = baseColor × tint`, roughness, metalness, `normalScale`, `bumpScale`,
and wire albedo/normal/orm/height maps via the extracted
`ProceduralWorkshopPresetTextures`.

**Keep `vertexColors: true`.** An imported albedo does not replace the baked
crevice occlusion; `applyUnitShading`'s `neutral` flag already handles the
interaction, writing occlusion only and preserving the imported image's hue
(`ProceduralWorkshopMaterials.js:285`). Dropping vertex colours to "let the
texture show" throws away every joint line.

## Commands

| Command | `dirtySegmentIds` | `materialOnly` |
| --- | --- | --- |
| `set_material` | `[]` | **`true`** |
| `set_style` | `[]` (all) | `false` |
| `set_dimensions` | `[]` (all) | `false` |

`materialOnly: true` is the win here: Phase 1's `upsertRecord` already
short-circuits on it and swaps `mesh.material` with **zero geometry work**.
Painting a 200 m wall must not re-pack a single stone.

Material *library* edits (importing an albedo, editing a preset) get their own
bounded undo inside `ConstructionMaterialStore`, mirroring the workshop's
80-entry local history. They are not world-history events — undoing a wall move
should not un-import an image. `set_material` **is** a world-history event.

## Tests

**`tests/RadialPalette.test.js`** — assert on generated markup, no renderer:

1. Petal count equals item count, per ring.
2. Angles are `-90 + i * (360 / n)`; `--ring-radius` matches the ring's radius.
3. The centre and footer buttons exist when configured and are absent when not.
4. A synthesized petal click calls `onSelect` with that item's id.
5. `focusStep` wraps at both ends.
6. `dispose` removes the host element and detaches listeners.

**`tests/ConstructionMaterialStore.test.js`**

1. A preset referenced **only** by a record survives normalize — this is the GC
   trap; the test should fail if `gc(records)` is removed.
2. A preset referenced by nothing is collected, and its sources with it.
3. Source caps reject an oversized data URL with a clear message.
4. Exact round-trip through `toDocument` / `loadDocument`.
5. `set_material` returns `materialOnly: true` and empty `dirtySegmentIds`.

## In-app verification

- Right-click a wall → palette opens under the cursor and **the camera does not
  visibly move**.
- Right-**drag** still orbits, with no palette.
- Hovering a petal previews the material; clicking commits; Escape closes the
  palette without committing (and a second Escape deselects, per `EscapeStack`).
- Inner ring: Flat top / Crenellate / Ruin each change the wall immediately.
- Import a PNG albedo → applies, survives save and reload, and the joint lines
  are still visible (vertex colours preserved).
- **Open the Workshop and confirm its palette is unchanged** — petal layout,
  colours, hover preview, keyboard navigation, undo/redo, layered Escape. This is
  the regression that matters.

## Deferred

- **Per-module / per-span material painting.** A large UI surface that multiplies
  save weight for marginal value on a wall. The `${recordId}:${moduleId}:${family}`
  region-id convention leaves the door open.
- **Editing preset parameters from the construction inspector** (roughness,
  tint, repeat). The workshop's full inspector already does this; constructions
  get preset selection plus albedo import, and "More…" can link to the workshop
  for authoring.
- **Right-click orbit compensation.**
- **A shared favourites list between workshop and constructions.** They have
  different useful defaults; sharing invites one surface's edits to surprise the
  other.
