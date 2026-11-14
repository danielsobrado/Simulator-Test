# Frostgard ice environments

Three linked instanced locations built on one set of systems. Everything
tunable is in `config/instanced-locations.yaml`; nothing below needs a shader
edit to adjust.

| Site id | What it is | Generator |
| --- | --- | --- |
| `showcase-frostgard-glacier` | Glacier front under open sky: ice cliff, seracs, ice arch, frozen pool, moraine | `generators/GlacierFrontGenerator.js` |
| `showcase-frostgard-refuge` | Natural ice cave: tube, squeeze, crevassed hall, refuge on bedrock, sealed vault | `generators/GlacierGenerator.js` |
| `showcase-frostgard-hold` | Norths hold at dusk: palisade yard, great hall cut into a bluff, ice store | `generators/FrostgardHoldGenerator.js` |

## Opening them

- `F8` in the running app opens the location menu.
- `?location=<site id>` in the URL enters one directly; `&locationQuality=low|medium|high` picks a tier.
- The sites are linked (`links` on each site): the glacier front's cave leads to
  the ice cave and its staked trail to the hold, and both lead back. Only the
  glacier front's own exit returns to the surface.
- `node scripts/capture-locations.mjs front,glacier,frosthold` (dev server on
  5174) writes screenshots to `docs/screenshots/locations/`.

## What is shared

**Ice** — `materials/GlacierIceMaterial.js` composes three parts in
`materials/ice/`: `IceStrata` (the glacier's layers), `IceInterior` (cracks and
bubbles on the refracted view ray) and `IceCover` (frost, weathered crust,
snow). `iceProfiles` holds a preset per family — deep blue, white bubbly, clear
polished, fractured, dirty, frost-covered, snow-covered, plus the weathered
exterior glacier and calved blocks. A generator's `classify` writes vertex masks
that push part of a wall toward another family, so one cave shows several.

The ice is opaque: no `viewport*Texture` node is compiled into it. Depth comes
from the light bake (which runs every light through the ice volume with
per-channel absorption), the baked thickness behind each vertex, and the
parallax of the interior layers.

**Volume and light** — `gen/DensityGrid.js` now has open volumes (`open = true`
on a generator) for places under the sky, and `striate()` for ledges along the
ice layers. `gen/LightBake.js` takes parallel light, so a lighting profile's
`sky` entry is both the dome that is drawn (`LocationSky.js`) and the sun and
skylight that are baked. It also bakes, per vertex, whether the sky can see the
surface; snow and weathering use that, which is why there is none under a roof.

**Weather and air** — `atmosphereProfiles` particles marked `outdoor` fade while
the walker is under a roof. `emitters` are shed from points a generator marks
with `b.emit(kind, at)`: hearth smoke, embers, icicle drips, snow sifting off a
cliff lip. `breath` is the walker's own, in puffs (`LocationEmitters.js`). Under
an open sky loose snow snakes across the surface down the profile's `wind`, and
the sky draws the 22 degree halo and sundogs round the sun (`sky.sun.halo`).
`b.sunShaft(through, width, strength)` stands a shaft of that sun in an opening.

**Trails** — a generator's `classify` writes `surfMask2.w` from the lines people
walk (`gen/plan.js`, `onTrail`); snow there is packed, greyer and rutted.

**Building** — `generators/frostgardKit.js` (log walls, pitched roofs, longhall,
storehouse, palisade, watch gate, beacon, gable front) and
`generators/frostgardDressing.js` (hall interior, hearth, sled, racks).
`generators/glacierKit.js` hangs icicles from the roof the volume actually has,
fuses frozen falls into it and scatters fallen ice and boulders.
Timber, masonry and roofs take snow through a `snow` entry on their
`materialProfiles`.

## Adding another ice site

Add a site under `sites` with an existing archetype and a new `seed`, or a new
archetype whose `params` reshape one of the generators. A new layout is a new
generator module registered in `generators/index.js`; it gets the ice, the bake,
the sky and the kits for free.

## Not done

- Props cast baked shadows from lamps but not from the sun or sky; only the volume shadows those.
- Breath is drawn for the first-person walker only; nobody else in a location breathes yet.
- Sites are showcase-only: none is anchored to an Azgaar entrance yet.
- Textures and provenance: `public/assets/textures/locations/manifest.json` and
  `THIRD_PARTY_NOTICES.md`.
