# Spell VFX (grimoire)

The grimoire spells — Fireball, Lightning Bolt, Thunderwave, Cone of Cold, Ice
Storm, Magic Missile, Shatter, Meteor Swarm, Acid Splash, Blight, Cure Wounds,
Fog Cloud, Stinking Cloud, Wall of Fire, Moonbeam, Sunbeam — are drawn by a
fully procedural stack in `src/editor/vfx`. Nothing is baked: every sprite
comes from one 512² atlas (64 px tiles) rasterised at startup in ~80 ms.

They live on the spell dock's **Evocation** and **Mysteries** pages next to the
original **Elements** page. `[` / `]` switch pages; `1`–`8` cast the slot on
the page shown.

## Layout

| Folder | Role |
|--------|------|
| `atlas/` | Tile painters (puffs, fire flipbook, flames, shapes, solids, decals) and eight colour ramps in row 7. `ParticleAtlasLayout.js` is the tile map; the atlas is full, so a new tile has to replace one (smoke went from 12 variants to 9 for `STARBURST`, `FOG_BANK` and `CRYSTAL`). |
| `particles/` | `ParticleType` records and registry, the CPU simulator (struct-of-arrays, sub-emitters, terrain collision, turbulence) and the depth-sorted buffer writer. |
| `render/` | The single instanced particle material, the draped decal layer, the light pool, the world light (`SpellWorldLight.js`) and camera shake. |
| `effects/` | `EffectDirector` (timelines: `at`, `during`, `every`, `stream`, `burst`, `press`), emitter shapes, projectiles, lightning paths, grass presses. |
| `types/` | All particle types, one file per family (explosion, fire, frost, acid, storm, arcane, life, lunar, cloud). |
| `recipes/` | One cue sheet per spell. `fireballExplosion` is the reference explosion; Wall of Fire and Meteor Swarm have files of their own. |
| `audio/` | Procedural Web Audio cues routed through the game's audio bus. |

The dock and targeting live in `src/editor/spells/grimoire` (catalog, caster,
glyphs); `spell_runtime.js` owns the `VfxSystem`.

## Rules that keep it fast

- **One draw call for every particle.** The particle material is premultiplied
  (One, OneMinusSrcAlpha): `additive` → 0 alpha adds light, cooling toward 0
  occludes, so fire turns into smoke inside one sorted draw. Five vec4 instance
  streams plus position and uv — seven of WebGPU's eight vertex buffers.
- **No real scene lights by default.** One point light, even at intensity 0,
  put every lit material on the punctual-light path: −2–6 % FPS and twice the
  hitches on `qa:perf chunk-cross`. Effect lights are virtual: they light smoke
  and decals through uniforms, and each paints a tinted light pool just above
  grass height. `createVfxSystem({ sceneLights: 1 })` brings one real light back
  if a scene needs it. Never hide/show lights per cast — it recompiles the world.
- **No shadow-casting point lights** — the terrain is at the 16-sampler cap.
  The explosion's smoke column fakes its sun shadow with a soft decal.
- **No `viewport*Texture` nodes** — no soft particles, no heat haze. Smoke fades
  against the terrain heightfield on the CPU instead.
- Idle cost is two hidden meshes and ~0.03 ms of CPU. Meteor Swarm peaks at
  ~6.5 k particles and ~3.5 ms of simulation.

## The world reacts

A spell lights and marks the ground it hits, without scene lights or decals
hidden under the grass:

- **World light.** Each frame the light pool hands its brightest light to two
  uniforms (`spellWorldLight`) that the terrain, meadow blades (per vertex) and
  far cards add as emission: quadratic falloff, wrapped Lambert. Radiance eases
  toward a ceiling (`RADIANCE_CEILING`), so Meteor Swarm warms the meadow rather
  than bleaching it. With nothing lit the range is 0 and the shaders skip the
  term behind a uniform branch.
- **Spell map.** `MeadowGrassField.spellGround` is a second interaction map, 64 m
  round the player at 4 texels a metre, so a blast 30 m away still reaches the
  grass. R is the spells' press, G how strongly the grass is marked and B the
  mark's kind (`GRASS_MARK`: scorch, singe, wither, frost, acid, moon, bloom,
  sickly). Blades fold under max(body, spell) and turn their pigment toward the
  mark's colour, ragged per blade. While the map is empty its `active` uniform
  is 0 and the blades read nothing.
- **Marks fade on their own.** Each kind loses one step every few frames
  (moonlight within seconds, frost ~20 s, burnt and withered grass ~40 s), so
  `markGrass` stamps while a mark spreads and then only refreshes it every
  0.25 s; `holdFlat` refreshes every 0.1 s. Restamping every frame cost ~0.2 ms
  of CPU per spell. Recipes pass mark names; `main.js` maps them to kinds.

- **Water and craters.** Every press also reaches `spells/spellSurfacePress.js`:
  the ripple field near the player takes it as a ring wave (a growing blast as
  a wave racing out, a held disc as a stirring rim), and snow, sand and mud take
  a shallow crater in the footprint field — stamped at most every 0.12 s and
  once per held disc, capped at 4 m. How either reads is the biome's
  (`ripples`, `prints` in [biome looks](biome-looks.md)). The Tides page's
  Tidal Orb and Rain Call are built to show it off.

Measured on 2026-10-12 (headed Chromium, vsync off, Fireballs cast every 1.5 s):
~4 % FPS while a spell is lit (≈0.25 ms: half the world light, half the spell
map), nothing idle — `qa:perf chunk-cross` with and without `?spellWorld=0`
matched within noise.

## Tuning notes

- Smoke must not show its sprites. A puff's fringe keeps the body's normal blend
  (`facing` in the particle material) instead of turning back to the camera, the
  smoke tiles have soft, noise-eroded edges and weak edge normals, and big puffs
  overlap rather than many small ones. Anything that lights a puff's edge
  differently from its middle draws a ring round every puff.
- Smoke thins as it rises (`opacityEnd`) and leans downwind (`windDrift`, the
  simulator's breeze); a column ends as a spreading, fading cap, not a dark ball.
- Flashes have structure: a short `GLOW` core whose rim keeps the ramp's colour
  (heat below 1, modest emissive), a `STARBURST` of rays, and for crystal or
  arcane bursts two `RING_THIN` fringes in different ramps. A large, long,
  heat-1 glow is a white disc. Scaled blasts divide their flash and fireball
  emission by the scale so several side by side do not sum to white.
- Fast spells leave an aftermath: Lightning's ionised channel, crawling arcs,
  burning grass and smoke; Magic Missile's lingering trails and violet wisps;
  Shatter's shards resting and glinting; Thunderwave's dust wall and clippings.
- Fog and Stinking Cloud are banks of `FOG_BANK` lenses kept level (rotation
  near 0), denser at the heart and see-through at the edges, with a thinner
  rolling upper layer and wisps drifting downwind.
- Cure Wounds' closing glow sits just behind the body as the camera sees it
  (`fx.camera`), so the character hides its middle and only a rim shows.

- Puffs are shaded as a medium (`shadeVolume`): normal-driven self-shadowing,
  hemisphere ambient (sky on top, ground beneath), crevice occlusion in dense
  cores, backlit scattering and a small per-puff warm/cool shift. Keep every
  lighting cue keyed to the normal or the whole cloud, never to one sprite's
  own edge — anything that lights a sprite's fringe differently from its middle
  draws a circle round every puff where they overlap.

- Puffs and flames (`billow`, on by default for smoke, fire, flame and cloud
  tiles) boil in the shader: animated noise warps their tile UVs more as they
  age, and late in life they erode into wisps, so smoke changes shape rather
  than scaling a fixed image. Per-particle seed and life fraction ride in the
  E stream; varyings are packed into vec4s because WebGPU allows only 16
  vertex outputs.

- Units are metres and seconds; emission is linear HDR and the bloom threshold
  is ~2. `lighting.emissionScale` scales every sprite's glow at once.
- Grass is ~0.5 m tall. Spells press it through the meadow's spell map
  (`spellGround.pressDisc`, wired as `pressGround`): `blastWave` blows it flat
  outward and lets it spring back, `holdFlat` keeps it down under a scorch,
  puddle, frost or rune for as long as the mark lasts, so ground decals read in
  a meadow too. The map covers 64 m round the player; further out, rings, light
  pools and bubbles sit at 0.35–0.6 m so they clear the grass.
- Lights within ~2 m of the caster wash the screen out: hand lights ramp in
  (`attack` ≥ 0.3 s), and self spells keep their light weak and in front.

## QA

`node --test test/vfx-*.test.js test/meadow-spell-marks.test.js` bakes the
atlas, validates every type, runs every recipe to completion against the
particle budget and checks the mark map. For pictures, `tmp/vfx-driver.mjs`
boots a headed Chromium once and serves casts and screenshots over HTTP
(`/cast?spell=fireball&shots=0.5,1,2&yaw=0.4&dist=20`); `tmp/vfx-batch.sh` turns
runs into contact sheets, and `tmp/spell-gallery-all.sh` rebuilds the 16-spell
gallery (`tmp/spell-gallery/overview.png`) at 13:00, calling `effects.clear()`
between spells so nothing carries over. After a few source edits the page
reload stops streaming (no grass, no trees): restart with
`bash tmp/vfx-restart.sh`, which waits for the meadow, rather than `/reload`.
