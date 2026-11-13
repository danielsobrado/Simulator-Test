# City and house biome screenshots — 2026-11-13

The [capture folder](qa/city-house-biomes-2026-11-13/) contains **91 original
1920 × 1080 PNGs**, seven views for each of 13 land biomes. It is ignored by
Git and remains in this checkout.

- [Image gallery](qa/city-house-biomes-2026-11-13/index.html)
- [All-biome contact sheet](qa/city-house-biomes-2026-11-13/contact-sheet-all-biomes.jpg)
- [Individual biome contact sheets](qa/city-house-biomes-2026-11-13/contact-sheets/)
- [Capture notes and AI review brief](qa/city-house-biomes-2026-11-13/README.md)
- [Camera and source manifest](qa/city-house-biomes-2026-11-13/report.json)
- [Image verification](qa/city-house-biomes-2026-11-13/verification.json)
- [Transfer ZIP](../tmp/city-house-biomes-2026-11-13.zip)

Each biome has city aerial and top-down views, close street context, house
front and three-quarter views, and two interior views of the same house.
The six real Eldara scenes are Toteskirk (6), Kilarar (8), Zigbigbig (9),
Kleabsilt (11), Innssadrin (12), and Zaragzad in Stonehold Badlands (32).
The seven other land biomes (1, 2, 3, 4, 5, 7, 10) use explicitly labeled,
temporary review fixtures because Eldara has no runtime settlements there.
Those fixtures share the active editor seed 918273 and one settlement layout;
they do not establish a distinct regional architectural style for each biome.
Marine (0) has no land-city set.

Captures use the default SettlementView renderer, hardware NVIDIA Lovelace
WebGPU, clear-weather settings and a paused noon clock. Runtime source is
frozen at `3d1aeb16d8bfb7a3421dedcbd53ad7c6c6ea9fe3`, with snapshot digest
`fca395c76c68270f98036d7250e10853f82eda4c6b17861440a5b39a494eba74`.
Scenery, building/interior preparation, all 40 tree atlases and static lighting
settled before capture. Verification checks image count, dimensions, nonblank
pixels and SHA-256 hashes. The real-city batch has zero browser errors. The
fixture batch recorded 130 console errors; its retained, truncated sample
reports duplicate collider ownership during natural collision refresh. Every
image reached scenery readiness, but **the fixture run is not clean runtime
QA**. Original logs and the rejected initial fixture metadata attempt remain
in the capture folder.

**Visible limitations:** Zaragzad's close outdoor views are obstructed by
canyon terrain; its aerials and interiors are retained for diagnosis. Some
dense-city street views face neighboring facades. These are review inputs,
not visual acceptance. Four aerials have particularly low contrast under the
authored haze and are listed in verification.json. Snow particles and wetland motes remain.
Indoor cameras use free flight at standing eye height; walking access,
performance, night/weather variants and the opt-in medieval-kit renderer were
not tested. No runtime code, geometry, authored visual settings or saved world was
changed for this handoff.
