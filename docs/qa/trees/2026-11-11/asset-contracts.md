# Tree asset checks — 2026-11-11

Both Blender builders were run twice with `--no-render`. All five output GLBs
matched their original SHA-256 hashes on both runs. Each grouped GLB embeds one
leaf image; every named tree has one bark mesh and one foliage mesh.

| Tree | Bark triangles | Foliage triangles | Total | Plan limits |
|---|---:|---:|---:|---|
| spruce-01 | 1,594 | 3,208 | 4,802 | Pass |
| spruce-02 | 1,693 | 3,424 | 5,117 | Pass |
| fir-01 | 1,432 | 2,884 | 4,316 | Pass |
| pine-01 | 898 | 904 | 1,802 | Pass |
| pine-02 | 784 | 754 | 1,538 | Pass |
| snag-01 | 403 | 28 | 431 | Pass |
| emergent-01 | 2,934 | 2,220 | 5,154 | Pass |
| emergent-02 | 2,541 | 1,788 | 4,329 | Pass |
| midstorey-01 | 1,318 | 392 | 1,710 | Pass |
| palm-01 | 152 | 228 | 380 | Pass |
| palm-02 | 136 | 204 | 340 | Pass |

The source cache contains 36 texture maps and four reference previews, totaling
84.7 MiB. Checksum validation passes. A forced cache miss downloaded one alpha
map with its exact pinned MD5; the next fetch downloaded zero files and left the
lock file unchanged.
The bark packer passes its displacement seam checks for all five profiles at
512 px, including the mirrored palm scan.

Builder previews, with the source scans in the lower row:

- [Boreal trees](boreal-contact-sheet.jpg)
- [Rainforest trees and palms](rainforest-contact-sheet.jpg)
- [Bark: procedural / scanned](bark-contact-sheet.jpg)

These are asset previews. Runtime captures and measured performance are
reported separately. The emergent preview crowns are narrow; pine cards show
stray dark flecks. Species appearance remains a visual review decision.
