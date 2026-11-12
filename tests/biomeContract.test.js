import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

// The checklist of docs/adding-a-biome.md, enforced: a biome row that lacks a
// piece fails here with the name of the piece, instead of shipping half dressed.
const read = (path) => load(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const surface = read('editor.config.yaml').stylizedSurface;
const looks = read('config/biome-looks.yaml').biomeLooks.byTileId;
const meadow = surface.grass.meadow;

/**
 * Pieces a biome goes without on purpose. Adding a biome should not add a line
 * here; a line needs the reason the piece does not apply.
 */
const WAIVED = {
  4: { palette: 'grassland is the base meadow palette', groundDetail: 'grassland is the default floor' },
  10: { soil: 'tundra ground is the snow carpet and the thaw substrate' },
  11: { bushes: 'nothing grows on the ice' },
};

const variantsOn = (list, id) => (list ?? []).filter((variant) => variant.tileIds?.includes(id)).length;
const grows = (id) => (meadow.growth.byTileId?.[id]?.density ?? 0) > 0;

for (const [key, look] of Object.entries(looks)) {
  const id = Number(key);
  const waived = WAIVED[id] ?? {};
  const need = (piece, ok, where) => {
    if (piece in waived) return;
    assert.ok(ok, `Biome ${id} (${look.name ?? 'unnamed'}) lacks ${piece}: ${where}`);
  };

  test(`biome ${id} is fully dressed`, () => {
    need('name', typeof look.name === 'string', 'config/biome-looks.yaml `name`');
    need('rock', !!look.rock, 'config/biome-looks.yaml `rock` (tint, tone, moss)');
    need('floor', surface.groundDetails.tileIds.includes(id) && variantsOn(surface.assets.groundDetailVariants, id) > 0,
      'groundDetails.tileIds and at least one assets.groundDetailVariants entry');
    need('bushes', surface.bushes.tileIds.includes(id) && variantsOn(surface.assets.bushVariants, id) > 0,
      'bushes.tileIds and at least one assets.bushVariants entry');
    need('groundDetail', !!meadow.groundDetail.byTileId?.[id], 'grass.meadow.groundDetail.byTileId (litter, moss, soil, floor scans)');
    if (grows(id)) {
      need('soil', !!look.soil, 'config/biome-looks.yaml `soil`; without it bare ground shows the map colour');
      need('canopy', !!look.canopy, 'config/biome-looks.yaml `canopy`');
      need('palette', !!meadow.palette.byTileId?.[id], 'grass.meadow.palette.byTileId (base, tip)');
      need('grass', surface.grass.tileIds.includes(id), 'grass.tileIds');
    }
    if (surface.trees.tileIds.includes(id)) {
      need('trees', variantsOn(surface.assets.treeVariants, id) >= 2, 'two or more assets.treeVariants entries, so a wood is not one tree repeated');
    }
  });
}

test('every streamed variant names its biomes, so it is withheld from worlds without them', () => {
  for (const list of ['bushVariants', 'groundDetailVariants', 'tropicalKitVariants']) {
    surface.assets[list].forEach((variant, index) => {
      assert.ok(variant.tileIds?.length > 0, `assets.${list}[${index}] (${variant.scene ?? variant.id}) has no tileIds`);
    });
  }
});

test('a waiver names a biome that exists', () => {
  for (const id of Object.keys(WAIVED)) assert.ok(looks[id], `WAIVED lists biome ${id}, which has no look row`);
});
