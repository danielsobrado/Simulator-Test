# Map library

Add checked-in map documents to this folder and register loadable JSON entries
in `manifest.json`. The Settings panel discovers them at `/maps/manifest.json`.
Azgaar Full JSON is converted through the normal worker-backed import path, so
standard biome IDs remain canonical and large maps receive the same
deterministic meadow, forest, scrub and rocky detail fields as generated worlds.

Local files and CORS-enabled map URLs can be loaded from the same panel. A named
world-look preset keeps URL maps as references. A locally imported map is
recorded by label only in world saves and browser presets — the world document
already carries the converted terrain, and a full Azgaar export is several
megabytes. **Export JSON** is the one action that inlines the source again, so
the exported settings file stands alone on another machine.

Vite serves this whole folder during development. Production builds emit only
`manifest.json` and the files it reaches, so `.map`, PNG and CSV companions may
remain here for authoring without being deployed. Manifest URLs resolve against
`manifest.json` itself, so plain relative filenames are preferred over
root-absolute paths.
