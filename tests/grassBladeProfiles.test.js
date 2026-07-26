import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERATED_PROFILE_ID,
  describeProfileSets,
  generatedProfile,
  resampleProfile,
  resolveProfileSet,
} from '../src/editor/stylized/grassBladeProfiles.js';

const AUTHORED = {
  id: 'stylized-01',
  // Narrow base, plateau low, fine tip — the shape the alpha cards actually carry,
  // and the opposite of the generated taper.
  halfWidth: [0.2, 0.8, 1, 0.9, 0.1],
  curve: [0, -0.01, -0.03, -0.06, -0.1],
  aspect: 0.066,
};
const MANIFEST = { profiles: [AUTHORED] };
const SETS = {
  generated: { label: 'Baseline', profiles: [GENERATED_PROFILE_ID] },
  authored: { label: 'Authored', profiles: ['stylized-01'] },
  mixed: { label: 'Mixed', profiles: ['stylized-01', GENERATED_PROFILE_ID] },
  unbaked: { label: 'Unbaked', profiles: ['stylized-01', 'never-extracted'] },
};

test('resampling lands one row per segment boundary plus the tip', () => {
  for (const segments of [1, 3, 5]) {
    const resampled = resampleProfile(AUTHORED, segments);
    assert.equal(resampled.halfWidth.length, segments + 1);
    assert.equal(resampled.curve.length, segments + 1);
    // The ends are the authored ends, not an interpolation toward them: a blade
    // whose base crept inward would leave a gap over the ground.
    assert.equal(resampled.halfWidth[0], AUTHORED.halfWidth[0]);
    assert.equal(resampled.curve[0], AUTHORED.curve[0]);
    assert.equal(resampled.curve[segments], AUTHORED.curve.at(-1));
  }
});

test('the authored outline survives the near band it is drawn at', () => {
  // Three segments is the whole near-band budget, so if the profile's defining
  // feature — wider above the base than at it — does not survive resampling, the
  // authored silhouette never reaches the screen.
  const resampled = resampleProfile(AUTHORED, 3);
  assert.ok(
    resampled.halfWidth[1] > resampled.halfWidth[0],
    'blade must still widen above its base at near-band resolution',
  );
  assert.ok(resampled.curve[3] < resampled.curve[0], 'the arc must survive too');
});

test('the generated taper is widest at the base', () => {
  const generated = resampleProfile(generatedProfile(), 3);
  assert.equal(generated.halfWidth[0], 1);
  for (let i = 1; i < generated.halfWidth.length; i += 1) {
    assert.ok(generated.halfWidth[i] < generated.halfWidth[i - 1]);
  }
  assert.deepEqual([...generated.curve], [0, 0, 0, 0]);
});

test('a set resolves to every profile it names, in order', () => {
  const resolved = resolveProfileSet({
    manifest: MANIFEST, sets: SETS, setId: 'mixed', segments: 3,
  });
  assert.deepEqual(resolved.map((profile) => profile.id), ['stylized-01', GENERATED_PROFILE_ID]);
});

test('a set naming nothing bakeable still draws grass', () => {
  // The manifest is a build artifact. A stale or missing one has to degrade to a
  // duller field, not an empty world.
  for (const [manifest, setId] of [[null, 'authored'], [MANIFEST, 'missing-set'], [{ profiles: [] }, 'authored']]) {
    const resolved = resolveProfileSet({ manifest, sets: SETS, setId, segments: 3 });
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].id, GENERATED_PROFILE_ID);
  }
});

test('a partly baked set is offered but reported as incomplete', () => {
  // Hiding it would make an un-run extraction script look like a missing feature.
  const described = describeProfileSets({ manifest: MANIFEST, sets: SETS });
  const unbaked = described.find((set) => set.id === 'unbaked');
  assert.deepEqual(
    { requested: unbaked.requested, resolved: unbaked.resolved, complete: unbaked.complete },
    { requested: 2, resolved: 1, complete: false },
  );
  assert.equal(described.find((set) => set.id === 'authored').complete, true);
  // `generated` is not in the manifest and must not be counted as missing.
  assert.equal(described.find((set) => set.id === 'generated').complete, true);
});
