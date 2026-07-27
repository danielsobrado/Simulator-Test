# Inventory UI — art asset prompt sheet

Generation prompts for the inventory overlay's textures and item icons.

The UI in `src/editor/inventory/` is already complete and usable without any of these
files: `inventory.css` layers every texture over a gradient that reads correctly on its
own, and missing item icons fall back to a category glyph drawn in the slot well. So these
assets are an upgrade, not a dependency — generate them in any order, drop them in, and the
panel improves incrementally.

Target look: carved green-grey granite with bronze-and-gold filigree, matching the
project's existing dark-green chrome (`--surface-0` `#0e1310` through `--surface-3`
`#253128`) and its gold accent `--accent` `#d9bd66`.

---

## 1. House style

**Prepend this preamble verbatim to every prompt in sections 2 and 3.** Consistency across
the set matters far more than any single image being beautiful — a bag of icons lit from
different angles looks broken no matter how good each one is.

> Dark fantasy game UI asset in the style of an illustrated medieval inventory screen.
> Rendered as a single object on a fully transparent background. Muted, desaturated palette
> built around green-grey granite (#1c261f to #3c4d42) with bronze and antique-gold accents
> (#d9bd66). Lit by one soft light from the upper left, with a gentle ambient fill and no
> rim light. Painterly but readable at small sizes: clear silhouette, restrained detail,
> soft contact shadow baked into the object itself. No glow, no bloom, no magical effects.

**Negative prompt (use on every generation):**

> text, letters, numbers, watermark, signature, logo, UI frame, border, background scenery,
> drop shadow on the background, multiple objects, collage, grid layout, photorealism,
> lens flare, neon, saturated colours, cel-shaded outline, white background

**Surface textures override part of the preamble.** `stone-tile.webp` and
`filigree-border.webp` are full-bleed repeating surfaces, not objects. For those two, drop
the "single object on a fully transparent background", "lit by one soft light from the
upper left" and "soft contact shadow" clauses — they must be opaque, edge-to-edge and
evenly lit, or the tile will show a lighting gradient at every repeat. Their entries below
are written out in full so there is nothing to reconcile.

**Judge a tile tiled, never full-frame** — learned the hard way on `stone-tile.webp`.
Two candidates were generated. The better-looking image, full-frame, had handsome diagonal
granite veining. Repeated 4×4 it read as houndstooth wallpaper, because those veins are
large-scale structure and large-scale structure is exactly what the eye latches onto as a
repeat. The plainer, almost featureless candidate — which looked like flat noise on its
own — was the correct choice.

**Veins are not the problem; *large, few, parallel* veins are.** The shipped tile is dark
green marble covered in dozens of fine hairline veins running in mixed directions, and it
tiles cleanly. The prompt clause that does the work is "dozens of them, spread evenly
across the entire frame, running in many different directions with no single dominant
direction, and no one vein thicker or darker than the others".

**Two screening numbers, and the one that actually predicts.**

- *Seam ratio* — edge delta divided by interior delta, printed by
  `prepare-inventory-art.mjs --report`. This is the reliable one. The wallpaper candidate
  scored 1.44; both good candidates were near 1.15.
- *Low-frequency structure* — downscale to 16×16 and take the standard deviation. Useful
  but **treat it as advisory only**: it scored the wallpaper candidate 1.51 and the plain
  one 0.70, but it also scored the good marble at 1.02, which would have wrongly rejected
  it. Bright thin veins inflate it without creating any visible repeat.

When the two disagree, render a 4×4 tiling and look at it. That has never been ambiguous.

**Consistency rules**

- Generate each section as **one batch in one conversation**, reusing the same seed where
  the tool allows it. Switching sessions mid-set is the most common cause of drift.
- Ask for **1024×1024** and downscale in post. Generating at the final size loses detail.
- If a result has a light or off-white background instead of alpha, re-roll rather than
  keying it out — keyed edges fringe badly against the dark slot wells.
- Judge every icon at **56 px**, the actual slot size. Anything that turns to mush there
  needs a simpler silhouette, not more detail.

---

## 2. Panel textures

Destination: `public/assets/ui/inventory/` (served verbatim at `/assets/ui/inventory/…`).

| File | Final size | Notes |
|---|---|---|
| `stone-tile.webp` | 512 × 512 | **Must tile seamlessly.** Done. Sits *under* a translucent gradient veil, at 512 not 256 because downscaling further averages the speckle away. |
| `stone-edge.webp` | 96 × 96 | Nine-slice frame edge, 24 px slice inset. |
| `stone-corner.webp` | 96 × 96 | Matching corner boss. |
| `slot-well.webp` | 128 × 128 | Recessed square well interior. |
| `selected-frame.webp` | 128 × 128 | Gold frame overlay for the selected slot. |
| `gold-coin.webp` | 64 × 64 | Coin beside the gold total. |
| `filigree-border.webp` | 128 × 512 | Vertical ornamental strip, tiles along Y. |
| `set-tab.webp` | 96 × 64 | Weapon-set tab plate (I / II). |

### stone-tile.webp — shipped
Self-contained — do **not** prepend the preamble (see the override note in section 1).
This is the exact prompt that produced the shipped tile.

> A seamless tileable texture of dark green-grey marble, for a dark fantasy medieval game
> UI. Photographed perfectly flat-on from directly above, filling the entire frame edge to
> edge, with completely flat even lighting, no directional shadow, no vignette and no
> highlight.
>
> The surface is dense fine-grained stone crossed by MANY thin hairline mineral veins —
> dozens of them, spread evenly across the entire frame, running in many different
> directions with no single dominant direction, and no one vein thicker or darker than the
> others. The veins are subtle and low contrast, only slightly lighter than the surrounding
> stone, like fine capillary cracks rather than dramatic marble banding.
>
> No large sweeping vein, no focal point, no empty patches and no clustering — vein density
> must be uniform across the whole frame so that no region stands out from any other. Muted
> desaturated colour in the range #1c261f to #3c4d42, low overall contrast. The pattern must
> tile perfectly with no visible seam at any edge.
>
> Square image, 1024x1024 or larger.

Negative prompt: the standard list from section 1, plus `vignette, gradient, shadow,
highlight, border, object, centred subject, large veins, dramatic marble, bold banding,
parallel diagonal streaks, focal point, single crack, high contrast, polished sheen`.

Processed with:

```bash
node scripts/prepare-inventory-art.mjs "tmp/art-in/<generated>.png" \
  --out public/assets/ui/inventory/stone-tile.webp \
  --size 512 --crop 1248 --seamless --quality 80 --report
```

### stone-edge.webp
> …preamble… A short straight section of carved green-grey stone moulding, viewed
> face-on, with a chamfered bevel along its length and a thin inlaid antique-bronze fillet
> running through the centre. Uniform along its length so it can be repeated end to end.

### stone-corner.webp
> …preamble… A carved green-grey stone corner boss for a rectangular frame, viewed
> face-on, with a small bronze rosette at the mitre where two chamfered mouldings meet.
> Matching the profile of a straight moulding of the same style.

### slot-well.webp
> …preamble… A square recess carved into green-grey stone, viewed straight down. Deeply
> shadowed interior with a soft occlusion gradient in the upper-left corner, worn smooth
> stone at the bottom, and a thin chamfered lip around the opening. The recess is empty.

### selected-frame.webp
> …preamble… A square open frame of antique gold, viewed face-on, with small pointed
> corner cleats and a thin bevelled inner edge. Hollow centre, fully transparent, so it can
> be overlaid on top of an inventory slot. Restrained and matte, not shiny.

### gold-coin.webp
> …preamble… A single worn medieval gold coin viewed straight on, slightly irregular in
> shape, with a faint indistinct struck relief in the centre that reads as a pattern rather
> than any symbol or lettering. Warm antique gold, matte with soft highlights.

### filigree-border.webp
> …preamble… A tall vertical strip of ornate carved scrollwork in green-grey stone with
> antique-bronze inlay, viewed face-on. Dense symmetrical foliate scrolls in the style of
> a medieval manuscript border. The pattern repeats seamlessly top to bottom.

### set-tab.webp
> …preamble… A small rectangular plaque of green-grey stone with a rounded top and a thin
> bronze rim, viewed face-on, as a tab that would sit above a panel. Blank face with no
> markings.

---

## 3. Item icons

Destination: `public/assets/items/`. Final size **256 × 256**, transparent, filenames exactly
as listed — `config/items.yaml` already points at these paths.

All items are rendered at a **consistent three-quarter top-down angle**, roughly 30° from
vertical, laid as if on a table, filling about 85% of the frame. Append this to the preamble
for every icon in this section:

> Viewed from a three-quarter top-down angle as if lying on a table, centred, filling most
> of the frame, with a short soft contact shadow directly beneath the object.

### Weapons

**iron-sword.webp** — common, melee, metal
> …preamble… A plain one-handed medieval arming sword. Straight double-edged iron blade with
> a slightly clouded, unpolished finish, simple straight crossguard, leather-wrapped grip,
> plain iron wheel pommel. Serviceable and well used, not decorated.

**steel-greatsword.webp** — uncommon, melee, metal, two-handed
> …preamble… A large two-handed steel greatsword. Long broad blade with a shallow fuller and
> a bright polished finish, long ricasso, wide slightly downswept crossguard with a small
> bronze langet, long leather-bound two-hand grip, heavy faceted pommel. Clearly a superior
> weapon to a common sword.

**wooden-shield.webp** — common, shield, wood
> …preamble… A round medieval wooden shield of vertical oak planks with a weathered iron
> rim, radiating iron reinforcement straps, and a domed iron boss at the centre. Scuffed and
> battle-worn, unpainted.

### Armour

**leather-armour.webp** — common, armour, leather
> …preamble… A sleeveless hardened brown leather cuirass laid flat. Layered overlapping
> panels, visible stitching, brass buckles and straps at the sides. Worn and creased.

**leather-cap.webp** — common
> …preamble… A simple brown leather skullcap helmet with a stitched centre seam, a narrow
> reinforcing band around the brow, and a short chin strap.

**leather-gloves.webp** — common
> …preamble… A pair of brown leather gloves laid side by side, slightly overlapping, with
> stitched knuckle panels and short buckled cuffs.

**leather-leggings.webp** — common
> …preamble… A pair of brown leather leg guards laid flat side by side, with stitched
> vertical panels and buckled straps at the thigh and calf.

**leather-boots.webp** — common
> …preamble… A pair of scuffed brown leather ankle boots standing side by side, with turned
> soles, cross-lacing at the front, and a folded cuff.

### Accessories

**copper-ring.webp** — common, jewellery, metal
> …preamble… A plain copper finger ring with a slightly tarnished, warm reddish-brown patina
> and a simple band. Unadorned, no gemstone.

**wool-cloak.webp** — common, cloth
> …preamble… A heavy dark-green wool cloak, folded into a neat rectangular bundle with the
> hood visible on top, fastened by a small round bronze clasp. Coarse woven texture.

**pendant.webp** — common, jewellery
> …preamble… A simple bronze pendant on a fine chain, arranged with the chain coiled loosely
> beneath the pendant. Round flat disc with a faint indistinct engraved pattern, no gemstone.

### Consumables and tools

**healing-potion.webp** — common, potion, healing
> …preamble… A small round glass vial of deep red liquid, stoppered with a cork sealed in
> wax and bound with a scrap of twine. Thick slightly green-tinted glass. The liquid is dark
> and does not glow.

**torch.webp** — common, light, tool
> …preamble… An unlit wooden torch: a rough branch handle wrapped at one end with oil-soaked
> rags and bound with twine. Charred at the tip. No flame.

**rope.webp** — common, tool
> …preamble… A coil of thick brown hemp rope, neatly wound into a flat spiral loop and tied
> off with a short lashing. Frayed at the visible end.

**bread.webp** — common, food
> …preamble… A small round rustic loaf of dark peasant bread with a scored cross on the top
> crust, a rough floured surface, and a dense crumb visible at a torn edge.

---

## 4. Post-processing

Use `scripts/prepare-inventory-art.mjs`. It crops (which is how generator watermarks are
removed — losslessly, rather than by inpainting), optionally makes a texture genuinely
seamless, flattens contrast, resizes and writes WebP, and reports seam statistics so
"seamless" is measured rather than claimed.

```bash
# Surface texture: crop away the watermark corner, force a true wrap, keep the grain.
node scripts/prepare-inventory-art.mjs "tmp/art-in/<generated>.png" \
  --out public/assets/ui/inventory/stone-tile.webp \
  --size 512 --crop 1248 --seamless --quality 78 --report

# Item icon: preserve transparency, no seamless pass.
node scripts/prepare-inventory-art.mjs "tmp/art-in/<generated>.png" \
  --out public/assets/items/iron-sword.webp \
  --size 256 --alpha --quality 90 --report
```

Rules:
- **Drop generated images into `tmp/art-in/`** (gitignored) and let the script write the
  destination. Never hand-edit files under `public/assets/`.
- **`--alpha` for every item icon.** Without it the transparent background is flattened to
  black and the icon becomes a black square in the slot well.
- **Never `--seamless` on anything with structure** — mouldings, frames, icons. The pass
  cross-blends the image with half-offset copies of itself, which is invisible on
  stochastic grain and destroys deliberate shapes.
- Seam is healthy when the reported edge deltas are close to the interior delta.
  `stone-tile.webp` finished at 6.9 / 6.5 against an interior of 4.2.
- Keep textures under ~40 KB and icons under ~20 KB. Grain survives quality 70–78; icons
  with clean edges want 88+.

After the panel textures land, uncomment the `border-image` block in
`src/editor/inventory/inventory.css` (it is commented out because a failed `border-image`
load degrades to an ugly 12 px solid border).

---

## 5. Checklist

Item icons — `public/assets/items/`:

| Item key | File | Done |
|---|---|:--:|
| `iron_sword` | `iron-sword.webp` | ☐ |
| `steel_greatsword` | `steel-greatsword.webp` | ☐ |
| `wooden_shield` | `wooden-shield.webp` | ☐ |
| `leather_armour` | `leather-armour.webp` | ☐ |
| `leather_cap` | `leather-cap.webp` | ☐ |
| `leather_gloves` | `leather-gloves.webp` | ☐ |
| `leather_leggings` | `leather-leggings.webp` | ☐ |
| `leather_boots` | `leather-boots.webp` | ☐ |
| `copper_ring` | `copper-ring.webp` | ☐ |
| `wool_cloak` | `wool-cloak.webp` | ☐ |
| `pendant` | `pendant.webp` | ☐ |
| `healing_potion` | `healing-potion.webp` | ☐ |
| `torch` | `torch.webp` | ☐ |
| `rope` | `rope.webp` | ☐ |
| `bread` | `bread.webp` | ☐ |

Panel textures — `public/assets/ui/inventory/`:

| File | Done |
|---|:--:|
| `stone-tile.webp` | ☑ 512², 29.7 KB — veined marble |
| `stone-edge.webp` | ☐ |
| `stone-corner.webp` | ☐ |
| `slot-well.webp` | ☐ |
| `selected-frame.webp` | ☐ |
| `gold-coin.webp` | ☐ |
| `filigree-border.webp` | ☐ |
| `set-tab.webp` | ☐ |

When adding a **new** item to `config/items.yaml`, write its icon prompt into section 3 at
the same time. An item whose art never gets authored silently falls back to a category
glyph, which is easy to miss in review.
