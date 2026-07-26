# World-look settings library

Add checked-in `simcity-dnd-scene-settings` JSON documents to this folder and
register them in `manifest.json`. The Settings panel discovers the manifest at
`/settings/manifest.json`.

A preset can reference a map in `maps/`, configure god rays, choose authored
assets per biome, add custom GLB URLs, and tune deterministic regional
placement. Relative map and GLB URLs resolve against the settings document URL.
Use URL assets for portable presets; `local-asset:` references point to a GLB
stored only in the current browser's IndexedDB. Map and GLB references must
resolve to `http(s):`, `blob:` or `data:` — a document is refused rather than
handing an unfetchable scheme to the loader.

`placement` values are checked on load instead of being clamped, so a typo is
reported rather than silently reverting to the built-in look: `regionSize`
64–100000, `sampleSpacing` 4–10000, `contrast` 0.25–16, `minimumInfluence` 0–1,
`cacheSamples` 256–1000000.

Vite serves this whole folder during development. Production builds emit
`manifest.json`, every settings document it lists, and the `maps/` file each of
those documents references — anything unreferenced stays out of the deploy.
