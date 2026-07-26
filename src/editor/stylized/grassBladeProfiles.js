/**
 * Blade silhouettes for the streamed grass field.
 *
 * A profile is a normalized blade outline: `halfWidth` in units of the blade's own
 * widest point, and `curve` — the centreline's drift from the base — in units of
 * blade length. Authored profiles are baked from the grass GLBs' texture alpha by
 * `scripts/extract-grass-blade-profiles.mjs`; those assets are alpha cards whose
 * meshes carry no shape at all, so lifting the outline offline is the only way to
 * get the authored silhouette onto a 5-triangle strip at field density.
 *
 * Profiles are resampled to whatever segment budget a band draws, so the near and
 * far blades share one manifest and changing `BLADE_SEGMENTS` needs no re-bake.
 */

export const GENERATED_PROFILE_ID = 'generated';

const GENERATED_SAMPLES = 17;

/**
 * The blade this system replaces: widest at the base, tapering to a point.
 * Retained because a set that names no authored profile has to draw something, and
 * because it is the baseline an authored set is judged against.
 */
export function generatedProfile() {
  const halfWidth = [];
  const curve = [];
  for (let i = 0; i < GENERATED_SAMPLES; i += 1) {
    const t = i / (GENERATED_SAMPLES - 1);
    halfWidth.push((1 - t) ** 1.2);
    curve.push(0);
  }
  return { id: GENERATED_PROFILE_ID, halfWidth, curve, aspect: 1 };
}

function sampleAt(values, t) {
  const last = values.length - 1;
  if (last <= 0) return values[0] ?? 0;
  const position = Math.min(last, Math.max(0, t * last));
  const low = Math.floor(position);
  const high = Math.min(last, low + 1);
  return values[low] + (values[high] - values[low]) * (position - low);
}

/**
 * Resamples a profile onto a band's vertex rows: one value per segment boundary
 * plus the tip. `halfWidth` at the tip index is never used for width — the tip is a
 * single vertex — but its `curve` is, because that is where the tip sits.
 */
export function resampleProfile(profile, segments) {
  const rows = Math.max(1, Math.round(segments)) + 1;
  const halfWidth = new Float64Array(rows);
  const curve = new Float64Array(rows);
  for (let row = 0; row < rows; row += 1) {
    const t = row / (rows - 1);
    halfWidth[row] = sampleAt(profile.halfWidth, t);
    curve[row] = sampleAt(profile.curve, t);
  }
  return { id: profile.id, halfWidth, curve };
}

/**
 * Resolves a configured set name against a baked manifest.
 *
 * An unknown or empty set falls back to the generated taper rather than throwing:
 * the manifest is a build artifact, and a field of blades is a better failure than
 * a blank world if it is stale or missing.
 */
export function resolveProfileSet({ manifest, sets, setId, segments }) {
  const definition = sets?.[setId];
  const byId = new Map((manifest?.profiles ?? []).map((profile) => [profile.id, profile]));
  const chosen = [];
  for (const id of definition?.profiles ?? []) {
    if (id === GENERATED_PROFILE_ID) chosen.push(generatedProfile());
    else if (byId.has(id)) chosen.push(byId.get(id));
  }
  if (chosen.length === 0) chosen.push(generatedProfile());
  return chosen.map((profile) => resampleProfile(profile, segments));
}

/**
 * Lists what a Settings control can offer: every configured set, marked for
 * whether the manifest actually carries the profiles it names. A set whose assets
 * were never baked is still listed — hiding it would make a missing build artifact
 * look like a missing feature.
 */
export function describeProfileSets({ manifest, sets }) {
  const available = new Set((manifest?.profiles ?? []).map((profile) => profile.id));
  return Object.entries(sets ?? {}).map(([id, definition]) => {
    const names = definition?.profiles ?? [];
    const resolved = names.filter((name) => name === GENERATED_PROFILE_ID || available.has(name));
    return {
      id,
      label: definition?.label ?? id,
      requested: names.length,
      resolved: resolved.length,
      complete: resolved.length === names.length,
    };
  });
}
