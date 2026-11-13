# Instanced underground, mountain and ice locations — master plan

Status: PROPOSED — architecture and configuration design, not an implemented runtime feature
Date: 2026-11-13
Repository: danielsobrado/drusniel-world-builder (main)
Companion configuration: config/instanced-locations.yaml

## 1. Product decision

Mines, Umbra'kor Drow cavern cities, Stonehold Dwarven mountain cities, and Frostgard glacial constructions are **unique instanced locations** entered from the persistent Azgaar surface world through explicit **loading-screen transitions**.

This intentionally supersedes the earlier proposal for seamless streaming of all underground spaces in one continuous scene. The surface provides discoverable entrances, regional context and simulation links, but the destination is a distinct scene with its own geometry, asset and texture residency, TSL shader profiles, lighting, atmosphere, audio, navigation and collision. Exiting triggers the same safe transition back to the correct surface anchor. A loading screen is required even for cached destinations; avoid artificial minimum delays.

These locations must NOT be indistinguishable copies of one template. Each has an immutable site ID, generated or authored individual topology, selected unique landmarks, a cultural design grammar, site-specific content overrides and persistent world history. Shared engine services and reusable low-level geometry/material functions are encouraged; visible content is deliberately differentiated.

All choices are data-driven. Add a fifth family (crypt, magical academy, underwater ruin, other realm) by declaring its archetype, content pack, profiles, site/entrance records and generator registration. No realm-name branches should be added to the scene lifecycle.

**Scope of this commit:** document architecture and check in a proposed YAML design catalog. No scene transition runtime, asset files, shader implementations, startup registration or tests are claimed to exist yet. The catalog is explicitly marked proposal-only and must not be loaded by the game until implemented and validated.

## 2. Verified starting point in main

- Azgaar is authoritative for map location and its standard 0–12 biome IDs, with custom biomes 32–254. Culture, polity, ancestry, geology and architecture remain separate.
- config/cultures.yaml, config/visual-identity.yaml and config/asset-registry.yaml already describe culture, visual identity and logical assets. SceneRecipeResolver and PlaceIdentityResolver resolve regional settlement character.
- SettlementPlanner, TownLayout, TownStreamer and TownDressing already generate and stream settlements; Stonehold currently receives a decorative mountain shell assembled from mountain_vault, mountain_cliff and mountain_gate in TownDressing. It is not a navigable instanced mountain interior.
- GpuVoxelWorld and GpuVoxelChunk are a WebGPU marching-cubes prototype with their own density field; they are not an authoritative collision/navigation solution for underground cities.
- The project has town doors, interior light pooling and a provider-based collision runtime.
- IceMaterial, GlacierIceShading, snow and frozen-water materials are reusable starting points. The project's performance guidance prohibits compiling viewportDepthTexture or viewportOpaqueMipTexture into materials casually, because even one such material creates whole-frame copy/mip overhead.
- Asset startup currently keeps nonessential variants off the blocking path. Dedicated location assets must remain unloaded during surface startup.

Important lore mapping: published Stonehold / Vondari aligns to Ironpeak in the imported map only as a **working, unconfirmed crosswalk**. Preserve both loreRealmKey and source Azgaar state identity. Umbra'kor is the Drow dominion; Frostgard uses Norths architecture and Jotunn communities where culturally appropriate. Underground ice settlements are a proposed special location type, not a claim that every Frostgard town is built inside a glacier.

Existing source guides:
- docs/asset-bible/00-lore-and-map-crosswalk.md
- docs/asset-bible/areas/underground-cavern.md
- docs/asset-bible/areas/ruins-rift.md
- docs/asset-bible/regions/umbrakor.md
- docs/asset-bible/regions/stonehold.md
- docs/asset-bible/regions/frostgard.md
- docs/asset-bible/04-runtime-integration.md
- docs/towns.md
- docs/stonehold-art-pass-2026-11-04.md
- docs/perf-qa.md
- docs/gltf-asset-optimization-decision.md

## 3. World and scene separation

### 3.1 Three layers

1. **Canonical world simulation:** Stores worldId, siteId, entranceId, source Azgaar location, lore realm, ownership, resources, factions, population, economy and persistent site deltas. Runs independently of whether the player is inside the scene.
2. **Site definition:** Holds archetype, deterministic seed, chamber/level graph, authored hero landmarks, portals, entry and exit anchors, gameplay metadata and content-pack references. Derive generated geometry from this representation.
3. **Active 3D scene:** A short-lived, isolated renderer-facing instance: its own root group, environment, light pool, mesh buffers, collision provider, navigation, VFX, weather/air preset, soundscape and material/shader assets. The active scene can share engine and renderer services but should not accidentally retain the surface scene's GPU residency.

Never treat render chunks as settlement economic regions. Never persist floating-origin render coordinates in site state. Rendering LOD or whether a room is loaded must not determine simulated existence, collision ownership or travel permissions.

### 3.2 Site and portal data

- Site ID is stable and unique within a world; examples in documentation are schematic, not assumed to exist on Eldara.
- Every entrance belongs to one surface anchor or another instanced location; it points to a precise destination spawn/portal and has a reciprocal return route or a deliberately documented one-way rule.
- A location may have many entrances (mine entrances, concealed Drow passages, glacier crevasses), multiple interior levels and exits at different surface coordinates.
- A travel record includes sourceSceneId, sourceEntranceId, destinationSiteId, destinationSpawnId and a durable return anchor. Store this before transitioning.
- Entrance geometry on the surface needs appropriate regional architecture and a sealed/covered mouth; because travel is instanced, a loading-screen gate replaces the need for seamless actual terrain excavation into the destination. A convincing threshold and camera framing still matter.
- Travel is triggered by explicit player interaction at an eligible portal, not by merely crossing a camera-distance boundary. Support deliberate cinematic/campaign travel triggers as additional explicit portal types.
- World map displays site discovery without pretending Azgaar has native subterranean volumetric cell IDs.

### 3.3 Uniqueness contract

Each instanced site composes:
- archetype grammar (mine, Drow city, Dwarven hold, glacier);
- geology/resource/temperature and physical constraints;
- cultural branch and era/history;
- persistent site-specific seed derived from world ID + source entity + site ID;
- site landmark manifest including at least one distinctive hero landmark;
- layout choices and entrances deliberately different from neighbors;
- site-specific asset/material/shader/atmosphere overrides;
- simulation state (active, abandoned, besieged, thawing, exhausted).

A new site must be independently navigable, have a distinct skyline/primary silhouette, and pass deterministic layout-fingerprint checks. A seed alone does not guarantee meaningful visual uniqueness; art reviews must reject visually duplicated layouts. Exceptional capitals and lore locations should include authored layout constraints, not only noise.

## 4. Mandatory loading-screen transition

### 4.1 State machine

IDLE -> REQUESTED -> FROZEN -> LOADING_SCREEN_PRESENTED -> LOADING -> READY_TO_SWAP -> ACTIVE.
Failure/cancel goes to RESTORING -> previous scene ACTIVE, with a visible retry/error state. Exiting repeats the sequence in reverse, restoring the correct source anchor.

1. Validate interaction, faction access, destination ID, return anchor and scene availability.
2. Freeze player movement/input safely and serialize a return snapshot and pending travel intent; keep canonical world time/simulation coherent.
3. Present the destination-specific loading screen and yield an actual browser paint before heavy synchronous work. Screen shows title, region, optional location artwork, lore-relevant tips and real progress status.
4. Resolve site definition, download/decode asset bundles and textures, compile/prepare relevant TSL shader variants, generate necessary scene meshes, register collision/nav, place player at validated spawn and initialize interior atmosphere/audio.
5. Wait for collision readiness, spawn occupancy clearance, primary visible mesh preparation and renderer readiness. Optional distant scenery can stream after activation.
6. Swap active scene, camera, controls, collision source, local audio/VFX and scene-specific UI bindings atomically. Resume gameplay, close loading screen, retire old scene residency according to memory policy.
7. On exit, use the stored exact source portal/return position; never guess from current camera or select a random surface burg.
8. If load, validation, shader compile or asset decode fails: report which stage failed, clean partial resources and restore the previous playable scene without duplicating or losing world state.

Loading screens are required on both enter and exit even if bundles are cached. Do not set a fake progress percentage or impose unnecessary minimum visible duration. Show measured stage status/bytes where possible and indeterminate progress otherwise. At least one painted loading frame before substantial work is essential; avoid black flashes and input leaks.

### 4.2 Scene resource ownership

- Create one active location scope with lifecycle methods prepare, activate, suspend, dispose; do not let a generator directly mutate global scene singletons.
- Retain the world-simulation service and small immutable manifests across transitions. Release heavy inactive terrain, foliage, character/scene GPU resources and per-location buffers where safe.
- A bounded LRU cache of recently used bundles is optional, governed by GPU and CPU memory budgets, not by time alone.
- Asset, texture and shader failures are isolated to the destination and surfaced to the user; unknown keys fail validation and never silently fall back to the wrong culture.
- Dedicated shader profiles are selected by data, but share the renderer and reusable TSL nodes to avoid duplicating the whole renderer.
- Never add dedicated underground GLBs to the global startup Promise.all. Bundle readiness is destination-scoped.
- Screen composition can use pre-existing UI CSS, images or a gradient fallback. Background image keys in the proposal YAML are logical future references, not bundled files.

### 4.3 Progress, cancellation and re-entry

Track phases independently: manifest, content download, decode, geometry generation, material/shader preparation, navigation/collision, activation. Protect against double requests, rapid E presses, back navigation, stale async completions and renderer/device errors with transition IDs and cancellation. Disposal must be idempotent. Resume to previous scene if destination fails; persist only an authorized completed travel intent, not a halfway camera pose.

### 4.4 UI and save/load

- Loading screen must be clearly themed per site; no reusable generic cave image for every realm.
- Preserve title, geography, discovery status and contextual tips; avoid revealing undiscovered secrets.
- At save time store active site, spawn/position, return portal chain and persistent deltas. At boot, restore the active instance via the same loader, with a deterministic fallback to a safe surface anchor.
- Provide accessibility options for motion/fade and screen-reader status; do not require a timed animation to complete before loading.
- A map may show an instanced location as a named point/entrance without implying its complete interior is part of Azgaar terrain.

## 5. Shared procedural representation

### 5.1 Authoritative graph

UndergroundSite, Chamber, Passage, Portal, Level, Excavation, ResourceDeposit, SiteState. Chambers have their own bounds and level elevation, adjacent portals, connectivity, navigation regions, atmosphere zones and asset pools. Passages have actual widths, slopes, support requirements and traversal methods. Graphs are generated and validated before visual mesh generation.

Generate a connected mandatory route from every valid entrance to a principal destination, plus optional loops, branches and secrets. Reserve space for structures before scattering props. Guarantee reachable stairs/lifts, headroom, clearance, stable platforms, railings and dead-end intent. Validate multi-level overlaps and interpenetration. Support sealed chambers without creating inaccessible mandatory quest rooms.

### 5.2 Geometry strategy

**Hybrid**, not a global voxel world:
- swept spline cross-sections for mine tunnels, rock passages, rails, conduits and drainage;
- chunked CPU-derived SDF or implicit surfaces for irregular chambers, intersections, cave ceilings and thick ice;
- authored optimized modular GLBs for houses, gates, bridges, piers, vaults, machinery and landmark silhouettes;
- instanced rubble, supports, mineral clusters, mushrooms, icicles, furniture and clutter;
- worker-generated mesh/collider data where practical; optional WebGPU visual compute must not be the sole authoritative geometry source.

Dedicated instances avoid demanding arbitrary seamless subtraction from the whole surface heightfield; the surface portal remains an explicit scene transition. Within each interior, geometry must genuinely have floors, ceilings, overhangs and levels.

Use deterministic generation from seed and site definition, and persist only mutations/deltas rather than massive generated mesh snapshots. Separate physics/nav geometry from visual LOD.

### 5.3 Materials and art kits

Common geometric helpers can use the existing rock UVs, stoneJitter, vertex crevice AO, neutral tintable materials and texture array pipeline. Dedicated scene packs own geological palette, authored landmark meshes, trim decals, weathering masks, terrain surfaces, vegetation and ambient particles. Keep physical metres/texel density consistent, use baked AO/normal maps, optimize GLBs with the existing meshopt/KTX2 pipeline and integrate through asset registry IDs.

**Do not** place the same surface town prefab family unchanged inside every environment and rely only on recoloring. A culture changes topology, structure, transport and silhouette.

## 6. Family A — working and abandoned mines

**Role:** Industrial excavation based on actual world resource deposits; may belong to Stonehold or other cultures with their own architecture.

Topology:
- resource-driven seam graph, mine gate, main haulage corridor, side extraction galleries, loading/sorting station, ore lifts, ventilation and drainage;
- variable extraction depth, service shafts, abandoned branches, flooded sections, sealed hazardous levels;
- active/abandoned/exhausted states drive infrastructure wear, lighting, props, occupants and production.

Geometry and content:
- narrow irregular cuts with layered geology; rare large chambers; measurable chisel/tool marks and rock fractures;
- mining supports, timber braces or dressed stone arches, carts, rails, winches, ore buckets, platforms, air dampers, pumping stations, rubble, dusty tools, ore seams;
- iron/copper/silver/gold/gem/rare fantasy mineral veins follow geological rules and resource-specific visual kits;
- active lights use warm lamps and lanterns, dust haze; abandoned zones have low illumination and local wetness.

Simulation:
- reserve volume, ore type, yield, labor, safety, transport, resource depletion and repair state;
- mining affects regional production and trade. A depleted site should not regenerate its ore merely because a player reloads.

Vertical slice: distinctive Stonehold mine entrance, two playable levels, transport line, working extraction area, flooded branch, closed old shaft, real ore resource state and safe load/exit.

## 7. Family B — Umbra'kor Drow cavern cities

**Role:** Rare large inhabited voids with strong house identity and highly vertical districts.

Topology:
- cavern body and natural basalt escarpments first; terraced neighborhoods on cliff contours second; bridge, stair, lift and tunnel connectivity third;
- main house terraces, protected compounds, lower market, fungus farms, river docks, archive/temple district, warden choke points and restrained Rift approaches;
- visible long-depth skyline with distant silhouettes and selective light accents.

Art direction:
- black basalt, polished cuts, arched and cliff-carved housing, narrow but structurally supported bridges, iron-linked walkways, pale wayfinding crystals, confined warm domestic windows;
- no open sky, generic Gothic surface castles, mandatory spider motifs or whole-scene neon purple; pale luminescence must remain restrained;
- fungus agriculture with humid beds, aqueducts, pumps, low growth clusters and working food/logistics rather than random oversized glowing mushrooms.

Simulation:
- house ownership, patrol access, faction restrictions, fungus production, subterranean trade, influence of temples/archives, population and defense.

Vertical slice: a cavern with three residential tiers, central market, two monumental bridges, guarded compound, fungus terraces and one controlled deep passage, all linked by real navigation.

## 8. Family C — Stonehold Dwarven mountain cities

**Role:** Monumental engineered space, carved granite/basalt, forge economy, secure mountain approaches.

Topology:
- real solid mountain context, fortress gate and principal axis; enormous vaults with retained rock pillars; branching residential terraces and industrial aisles; multi-level service and mine access;
- council hall, Forgeheart workshops, smelter towers, ore lifts, halls, viaducts, forges, water cisterns, flues and defensive choke passages;
- a working settlement layout, not a decorative mountain_vault grid roof over the current surface town.

Art direction:
- precise dressed ashlar, stout arches, engineered massive piers, sparse bronze and iron, huge physically supported vaults, visible functional exhaust and cargo logistics;
- bright warm forge pockets versus cold gray granite, soot, dust and ventilation; avoid floating forges, arbitrary gold everywhere and uniform corridors.

Simulation:
- ore and fuel inputs, smelter/forge output, workshop labor, guilds, supplies, councils, mechanical access and trade.

Vertical slice: mountain gate into great vaulted avenue; two-tier housing, forge hall, cargo lift, council landmark and an attached working mine. Replace the decorative TownDressing mountain shell only for sites explicitly converted to instanced holds; keep other surface settlements intact.

## 9. Family D — Frostgard ice and glacial sites

**Role:** Special sheltered locations, defense stations, natural glacial caverns, rare frozen ruins and culturally Norths settlements.

Topology:
- naturally fractured glacier or ice-rock cave; connected crevasses, blue tunnels, melt channels, snow-covered entries and sheltered chambers;
- heated timber-and-stone longhall refuges, insulated storage, windbreak gates, ice fishing/service zones where geography allows, military checkpoints or ancient sealed chambers;
- permanent high-heat structures require rock/masonry isolation, drainage and safe separation from ice rather than heating their own load-bearing glacier walls.

Material families:
- dense blue glacial ice, frosted opaque ice, optically clearer fractured ice, layered dirty old ice, snow-covered crust, polished wet/melting sections;
- use existing IceMaterial/GlacierIceShading/frozen water as baseline; dedicate a Frostgard ice shader profile for approximate thickness-based transmission, internal veins, Fresnel response, orientation-driven frost and controlled roughness;
- do not compile viewport scene-color/depth refraction by default. Cheap thickness/volume tint and curated highlights are preferred.

Atmosphere:
- cold blue daylight through real openings, interior amber hearths, frost mist, spindrift near entrances, sparse falling ice dust and strong acoustic isolation.

Simulation:
- winter supply, insulation, food, maintenance, heating, population shelter, accessibility during storms, glacial hazard state and rare ancient ruins.

Vertical slice: one glacier entrance, two tunnels, warm refuge longhall, storehouse, defensive choke point, crevasse crossing and distinctive sealed ice chamber.

## 10. Scene-specific rendering and audio profiles

Each archetype defines data keys for:
- dedicated geometry/architectural asset bundles and heroic site overrides;
- texture sets (PBR albedo, normal, ORM, trim, decals, optional baked lightmaps);
- TSL shader profile built from an allowlisted factory and common material nodes;
- sky policy (none except genuine opening), environment lighting, virtual emissive lights, bounded dynamic light pool, ambient irradiance, tone/exposure policy;
- particle/VFX budget, atmosphere density, fog and visual depth cues;
- footsteps, reverb, ambient loops, industrial cues, creature/settlement beds;
- loading-screen theme with dedicated title, background artwork key, optional lore tips and a non-image fallback.

Actual texture and GLB paths are owned by the existing asset registry/bundle manifest, never by scattered JavaScript literals. Shader profile keys are declarative identifiers, not executable shader source loaded from YAML. Validate the profile factory registration and asset readiness before enabling an instance.

Suggested visual profiles:
- mine: tool-cut fractured rock, warm lamps, dust, wet mineral seams;
- Drow city: dark basalt, sparse pale mineral light, fungal humidity, long-depth haze;
- Dwarven hold: dressed stone, structural edge/crevice AO, furnace heat, smoke zones;
- glacier: thickness-modulated blue ice, frosted roughness, blue/cyan light transport approximation, warm isolated halls.

Large scenes use chamber portal/frustum culling and per-chamber LOD, distant silhouetted geometry, and prefetch neighbors. Only the active scene carries high-detail resident assets. Scene-local ambient effects must not run when inactive.

## 11. Configuration contract

config/instanced-locations.yaml is a proposal-only catalog:
- transitionPolicy configures always-on loading screens, progress stages, failure behavior, return anchors and scene disposal;
- defaultBudgets sets worker/GPU/light/LOD guidance, subject to hardware QA;
- contentPacks declare logical authored assets, dedicated textures, shader profiles and audio/VFX, with an explicit planned/ready lifecycle;
- shaderProfiles, materialPalettes, lightingProfiles, atmosphereProfiles and loadingThemes are named safe data profiles;
- archetypes associate a generator ID with its content packs, display theme, navigation/collision rules and simulation domain;
- sites is empty until authored or world-generated IDs are registered; instances can override archetype defaults without copying the full definition;
- extensionContract states required fields and validation expectations.

Do not interpret proposal-only content keys as existing runtime assets. An implementation must register each generator, shader factory and ready bundle, validate all references, and fail fast on unresolved mandatory dependencies. Asset registry keys and file paths must never be invented or silently resolved as substitutes.

Example site declaration when actual map coordinates/entrances are approved:

    sites:
      some_verified_site_id:
        archetype: dwarven_mountain_hold
        source:
          worldId: some_loaded_world_id
          azgaarEntityId: some_real_burg_id
          loreRealmKey: stonehold
        siteSeed: 12345
        entrances:
          - id: real_gate_id
            sourceAnchorId: real_surface_anchor_id
            destinationSpawnId: inner_gate
        overrides:
          uniqueLandmarkIds:
            - some_registered_unique_landmark
          additionalContentPacks: []
          loadingTheme: stonehold_forge

The values above are a FORMAT EXAMPLE only, not actual site data.

### Adding a new location family

1. Author the physical and cultural brief; assign a stable archetype ID and a registered topology generator.
2. Prepare a dedicated asset/content pack, PBR material palette, safe TSL shader factory profile, atmosphere/lighting/audio and loading theme.
3. Register all actually produced optimized assets and textures with stable logical IDs and readiness/validation checks.
4. Declare the archetype in YAML; no changes in the generic scene-transition state machine.
5. Add authored or validated generated site manifests with stable IDs, world anchors, unique landmark/layout rules and safe reciprocal portals.
6. Run schema, asset parity, deterministic generation, collision/nav, transition, save/reload, WebGPU/WebGL and hardware performance tests.

Adding an archetype is declarative once its generator and shader factories exist. YAML alone cannot magically create an entirely new geometry algorithm or compiled shader; those remain explicit registered plugins behind stable interfaces. Refuse unknown profiles instead of unsafe dynamic code evaluation.

## 12. Technical integration points

Proposed small modules (future work, not created in this plan):
- src/editor/locations/LocationCatalog.js — validate and normalize config references.
- src/editor/locations/LocationResolver.js — map site IDs, entrances and destinations.
- src/editor/locations/SceneTransitionController.js — transactional state machine.
- src/editor/locations/LocationSceneScope.js — scene residency and cleanup.
- src/editor/locations/LocationLoadingScreen.js — themed UI and real progress.
- src/editor/locations/LocationAssetResidency.js — dedicated bundle lifecycle.
- src/editor/underground/UndergroundGraphGenerator.js — deterministic topology and validity.
- src/editor/underground/UndergroundChunkMesher.js — local rock/ice mesh generation.
- src/editor/underground/UndergroundPortalVisibility.js — chamber culling.
- src/editor/underground/generators/MineGenerator.js, CavernCityGenerator.js, MountainHoldGenerator.js, GlacierGenerator.js — distinct grammars behind one interface.
- src/editor/collision/providers/UndergroundCollisionProvider.js — authoritative floors, walls, roofs and doors.
- src/editor/underground/navigation/UndergroundNavigationGraph.js — hierarchical chamber/district/local pathing.
- src/editor/locations/profiles/ — registered TSL/material/lighting factories.

Adapt existing integration without replacing it:
- PlaceIdentityResolver and SceneRecipeResolver: identify eligible entrances and lore/economy.
- SettlementProfile, SettlementPlanner and TownDressing: surface entrance manifests and avoidance of duplicate Stonehold shells.
- TownKitAssets/TownKitMaterial and existing stone/ice systems: reuse compatible modules and nodes, dedicated profiles.
- CollisionRuntime: register location-scoped collision provider, removing previous scene provider only after destination is ready.
- TownInteriorAtmosphere: reuse bounded light-pool concepts with stable light count; no per-corridor recompilation.
- world simulation and persistence: attach site state and entry/exit links independently of render residency.

Preserve current player movement contracts, floating-origin handling, worker scheduling, asset optimizer, world seed determinism and no GitHub Actions. Work on main according to repository guidance.

## 13. Performance, testing and acceptance

Targets below are **proposed acceptance criteria**, not measured results:
- 60 FPS or better on the chosen reference hardware/settings, with defined quality tiers.
- No newly introduced >33.3 ms synchronous scene-generation hitch while playing. Heavy tasks occur behind a loading screen and/or workers; first playable frame must be ready before transition.
- No startup load of location-only authored GLBs, shaders or textures.
- Bounded location GPU/CPU residency with cleanup and leak tests over repeated enter/exit cycles.
- Active collision and navigation available before gameplay input returns.
- Dedicated themes and asset sets observable in screenshots; architectural grammar not merely a texture tint.
- Functional WebGPU path; either a tested WebGL fallback for each generator/material or explicitly disabled feature with user-facing explanation.
- Save/load inside a site, round-trip exit anchor, failed-load rollback, disabled entrance, competing transitions, shader compile failure, lost GPU device and rapid re-entry all tested.
- Deterministic hashes of site graph and geometry across workers/runs; portal reciprocity; no trapped spawn and no duplicated resource extraction.
- QA captures for distant and close views, hero skyline, entrance, indoor lighting and asset collision, plus memory/draw/GPU counters.

Tests to add:
- test/locations/config-schema.test.js
- test/locations/site-id-and-portal.test.js
- test/locations/transition-state-machine.test.js
- test/locations/load-failure-rollback.test.js
- test/locations/scene-residency.test.js
- test/underground/generation-determinism.test.js
- test/underground/connectivity-and-nav.test.js
- test/underground/collision-and-height.test.js
- test/underground/site-persistence.test.js

Add deterministic hardware QA scripts for repeated enter/exit, chamber crossing, rapid camera turn, GPU residency reclamation and material compile. Use docs/perf-qa.md conventions, same seed/hardware/warmup, headed hardware WebGPU and controlled A/B comparisons. Do not claim measured speedups without evidence.

## 14. Delivery sequence

P0: Location catalog schema and validator; site+entrance ID model; explicit enter/exit scene transition and real themed loading screen; rollback, return anchors and persistence.

P1: One playable three-room mine instance, distinct packs, shader/lighting profile, multi-level collision/nav, deterministic generation and surface round trip. No runtime global voxel-world dependency.

P2: Production mine system: ore seam geology, extraction, transport, abandoned sections, multi-entrance sites and simulation integration.

P3: Stonehold mountain hold: monumental vault grammar, forge economy, stone infrastructure, mine linkage and replacement of the decorative city-shell only at opted-in sites.

P4: Umbra'kor cavern metropolis: vertical district topology, multiple levels, bridges, cliff housing, bioluminescent agriculture, house borders and portal visibility.

P5: Frostgard glacier: thickness-aware ice profiles, sheltered Norths hall geometry, thermal separation, frozen hazards, natural caves and ancient locations.

P6: Large-scale optimization, authored hero landmark pass, adaptive quality tiers, persistent world consequences and optional local excavation/destruction in bounded sites.

**First architecture proof:** From the Azgaar surface, interact with one named Stonehold gate -> themed Stonehold loading screen -> activate a uniquely composed mountain-hall/mining instance with dedicated textures/shaders -> interact with its exit -> themed return screen -> resume at the exact original gate with all simulation state intact. This validates the actual requested product experience before scaling content.

## 15. Explicit TODO and non-goals

- TODO: Implement runtime catalog parser, schema validation and reference resolution. Current YAML must remain inactive until this exists.
- TODO: Implement transactional scene load/unload state machine, UI, transitions, failure rollback and save/load.
- TODO: Register real asset packs, optimized textures, authored landmarks and TSL shader profile factories; remove placeholder-only keys before enabling sites.
- TODO: Implement four topology generators and physically reliable multi-level collision/navigation.
- TODO: Create actual site manifests from verified Azgaar/world data; do not invent sites or state IDs.
- TODO: Resolve Stonehold/Ironpeak lore-map mapping with the world owner.
- TODO: Run visual, determinism, collision, memory and hardware benchmark acceptance suites.

Not in this proposal: seamless cave rendering across the entire overworld, full real-time global illumination, global volumetric voxel simulation, unrestricted player excavation across every world tile, creating placeholder GLBs, changing Azgaar biome IDs, or changing the existing main-world settlement visual pipeline at startup.
