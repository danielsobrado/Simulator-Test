# Look bible

The target is **painterly naturalism**: real shapes and scanned detail, with
colour that comes from controlled per-biome ramps, and bold light, haze and
weather. Chosen on 2026-11-11; the reasons and the work that follows from it are
in [the coherence and polish plan](plans/coherence-polish-plan-2026-11-11.md).

A frame reads as one image when every layer obeys the same few rules. These are
the rules. The numbers are measured by `npm run qa:look`
(`scripts/lib/look-metrics.mjs`) on a capture downscaled to 480×270, as HSV
saturation and hue of a region's mean colour.

## Rules

1. **Hue comes from the biome's ramp.** A scan gives shape, cutout and relief.
   Its hue is graded onto the ramp (`gradeUnderstory`, the canopy grade, rock
   tint), so assets from different sources sit in one wood.
2. **Bare soil is a soil colour.** Every land tile has a `soil` in
   `config/biome-looks.yaml`. Without one, bare ground shows the Azgaar map
   colour, which is a cartographic colour, not a ground colour.
3. **Earth is one family per biome.** Soil, litter, duff and path tread lean to
   the tile's soil, so the ground under a tree and the track beside it match.
4. **One haze per view.** Everything distant fades to the scene fog colour:
   terrain, trees, impostors, far terrain and water. A look's `fogColor` stays
   close to its `lowColor`, the sky's horizon band.
5. **Props take the tint of the biome they stand in**, not of the biome their
   asset was first listed for.
6. **The grade follows the look.** Hour and weather move saturation, contrast
   and the lift and gain split along with exposure. Noon is the reference.
7. **Light has a key.** Sunlit and shaded ground are clearly apart, and crowns
   shade what is under them.

## Numbers

Draft targets, taken from the 2026-11-10 baseline. Confirm them on the first
capture of a changed tree before turning them into gates.

| Measure | Target | Baseline |
| --- | --- | --- |
| Vegetated ground at clear noon, `ground.sat` | 0.30–0.55 | 0.16–0.68 |
| Temperate grass, `ground.hue` | 65°–95° | 47°–112° |
| Lit to shade under sun, `groundContrast` | at least 70 | 50–86 |
| Sky zenith, `sky.sat` | 0.35–0.50 | 0.23–0.50 |
| Horizon band on open ground, `horizon.sat` | at least 0.15 | 0.05–0.19 |
| Dark bare earth from the air, `mudShare` | half the baseline | not measured |

## What this rules out

- Tuning one biome's colours in isolation. Change the ramp or the soil, then
  look at its neighbours in the same capture run.
- A second haze colour for one layer, however good it looks alone.
- Photographic albedo used as it comes. Normalise its luminance and let the
  ramp or tint set the hue.
