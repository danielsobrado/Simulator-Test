import { rod, stoneBox } from '../gen/propKit.js';
import { lantern } from './kits.js';

const P = (x, y, z) => ({ x, y, z });
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const DEFAULT_MINE_LIGHTING_SECTIONS = {
  adit: {
    daylightTint: '#b8d4f4',
    daylightIntensity: 5.8,
    daylightRange: 21.0,
    thresholdTint: '#8faed4',
    thresholdIntensity: 2.45,
    thresholdRange: 19.5,
  },
  haulage: {
    tint: '#ffbe7a',
    warmAltTint: '#ffc88a',
    intensity: 4.9,
    range: 15.0,
    spacingFrames: 3,
    unlitRate: 0.14,
    flickerAmount: 0.085,
  },
  hub: {
    tint: '#ffc07c',
    shaftAbyssTint: '#6c859c',
    shaftAbyssIntensity: 2.1,
    hoistIntensity: 6.4,
    hoistRange: 19.5,
  },
  stope: {
    tint: '#ffc482',
    workTint: '#ffb870',
    primaryIntensity: 6.2,
    primaryRange: 17.5,
    flickerAmount: 0.105,
  },
  abandoned: {
    tint: '#eb9e56',
    dimTint: '#df8d46',
    intensity: 3.4,
    range: 13.5,
    flickerAmount: 0.21,
  },
  flooded: {
    tint: '#ffba72',
    pierIntensity: 4.8,
    pierRange: 16.0,
    farIntensity: 4.2,
    farRange: 16.5,
  },
};

export function resolveMineLightingSections(params = {}) {
  const src = params.lightingSections ?? {};
  return {
    adit: { ...DEFAULT_MINE_LIGHTING_SECTIONS.adit, ...(src.adit ?? {}) },
    haulage: { ...DEFAULT_MINE_LIGHTING_SECTIONS.haulage, ...(src.haulage ?? {}) },
    hub: { ...DEFAULT_MINE_LIGHTING_SECTIONS.hub, ...(src.hub ?? {}) },
    stope: { ...DEFAULT_MINE_LIGHTING_SECTIONS.stope, ...(src.stope ?? {}) },
    abandoned: { ...DEFAULT_MINE_LIGHTING_SECTIONS.abandoned, ...(src.abandoned ?? {}) },
    flooded: { ...DEFAULT_MINE_LIGHTING_SECTIONS.flooded, ...(src.flooded ?? {}) },
  };
}

function detHash(seed, index) {
  const s = Math.sin((seed + 1) * 12.9898 + (index + 1) * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Anchors an iron hook clasp directly to a timber cap beam soffit (`frame.plan`)
 * and hangs a lantern vertically below it without drifting off the beam.
 */
export function hangLanternOnFrame(b, frame, {
  lateralOffset = null,
  hangDrop = 0.12,
  minClearAboveFloor = 1.62,
  ...lanternOptions
} = {}) {
  const { plan } = frame;
  const anchor = lateralOffset !== null
    ? P(
      plan.center.x + plan.right.x * lateralOffset,
      plan.capSoffitY,
      plan.center.z + plan.right.z * lateralOffset,
    )
    : frame.lanternAnchor;

  const floorY = Math.min(plan.floorLeftY, plan.floorRightY);
  const maxDrop = Math.max(0.06, plan.capSoffitY - (floorY + minClearAboveFloor) - 0.46);
  const clampedDrop = clamp(hangDrop, 0.06, Math.max(0.06, Math.min(0.24, maxDrop)));
  const stemTopY = plan.capSoffitY + 0.01;
  const lanternY = stemTopY - 0.26 - clampedDrop;
  const yaw = Math.atan2(-plan.dir.x, -plan.dir.z);

  // Iron strap clasp wrapping the cap soffit cleanly where the hanging rod meets the timber.
  b.prop('iron', stoneBox(0.065, 0.06, plan.capWidth + 0.03, P(anchor.x, plan.capSoffitY + 0.02, anchor.z), {
    yaw,
    bevel: 0.008,
    irregular: 0.08,
  }), 0x42464e);

  const pos = P(anchor.x, lanternY, anchor.z);
  lantern(b, pos, {
    ...lanternOptions,
    hung: clampedDrop,
  });
  return pos;
}

/** Places an empty forged iron clasp + hook on an unlit timber cap to mark dark intervals. */
export function placeUnlitFrameHook(b, frame) {
  const { plan, lanternAnchor } = frame;
  const yaw = Math.atan2(-plan.dir.x, -plan.dir.z);
  b.prop('iron', stoneBox(0.06, 0.055, plan.capWidth + 0.025, P(lanternAnchor.x, plan.capSoffitY + 0.02, lanternAnchor.z), {
    yaw,
    bevel: 0.008,
    irregular: 0.08,
  }), 0x3c4048);
  b.prop('iron', rod(
    P(lanternAnchor.x, plan.capSoffitY + 0.01, lanternAnchor.z),
    P(lanternAnchor.x, plan.capSoffitY - 0.14, lanternAnchor.z),
    0.014,
    0.012,
    6,
  ), 0x42464e);
}

/**
 * Mounts a lantern on an iron wall bracket driven flush into the probed rock wall.
 */
export function mountWallSconceLantern(b, origin, dirX, dirZ, {
  heightAboveFloor = 1.68,
  armLength = 0.28,
  hangDrop = 0.08,
  maxProbe = 4.0,
  ...lanternOptions
} = {}) {
  const step = Math.max(0.08, b.grid.voxel * 0.25);
  const probeY = origin.y + heightAboveFloor;
  let wallDist = null;
  for (let d = 0.4; d <= maxProbe; d += step) {
    if (b.grid.sample(origin.x + dirX * d, probeY, origin.z + dirZ * d) < 0) {
      wallDist = d;
      break;
    }
  }
  if (wallDist === null) wallDist = 1.65;

  const wallX = origin.x + dirX * wallDist;
  const wallZ = origin.z + dirZ * wallDist;
  const tipX = origin.x + dirX * Math.max(0.65, wallDist - armLength);
  const tipZ = origin.z + dirZ * Math.max(0.65, wallDist - armLength);
  const bracketY = probeY + 0.18;
  const yaw = Math.atan2(dirX, dirZ);

  // Iron backplate seated into the rock wall + horizontal arm + angled brace strut.
  b.prop('iron', stoneBox(0.11, 0.34, 0.08, P(wallX + dirX * 0.02, bracketY - 0.12, wallZ + dirZ * 0.02), {
    yaw,
    bevel: 0.01,
    irregular: 0.1,
  }), 0x42464e);
  b.prop('iron', rod(P(wallX + dirX * 0.04, bracketY, wallZ + dirZ * 0.04), P(tipX, bracketY, tipZ), 0.02, 0.017, 6), 0x4a4e56);
  b.prop('iron', rod(P(wallX + dirX * 0.02, bracketY - 0.22, wallZ + dirZ * 0.02), P(tipX, bracketY - 0.01, tipZ), 0.014, 0.014, 6), 0x42464e);

  const pos = P(tipX, bracketY - 0.26 - hangDrop, tipZ);
  lantern(b, pos, {
    ...lanternOptions,
    hung: hangDrop,
  });
  return pos;
}

/**
 * Adds a cohesive cool-daylight-to-twilight-slate gradient from the timber adit door
 * without flat room washes, casting real prop shadows from the threshold timbers.
 */
export function placeAditDaylightTransition(b, drift, sections) {
  const cfg = sections.adit;
  // Crisp cool overcast sky entering through the timbered portal doorway and frame cracks.
  b.light(P(0, drift.height * 0.65, 5.8), cfg.daylightTint, cfg.daylightIntensity, cfg.daylightRange, {
    radius: 2.2,
    flat: false,
    dynamic: false,
    section: 'adit',
  });
  // Soft cool twilight slate bounce decaying smoothly down the outer 15-20m of the adit.
  b.light(P(0, drift.height * 0.48, 0.2), cfg.thresholdTint, cfg.thresholdIntensity, cfg.thresholdRange, {
    radius: 2.8,
    flat: false,
    dynamic: false,
    section: 'adit',
  });
}

/**
 * Places haulage drift lanterns anchored strictly to real timber cap beams with
 * deterministic non-uniform rhythm: twilight mouth kept dark, then organic
 * intervals alternating warm pools and deliberate shadow pockets.
 */
export function placeHaulageLanterns(b, frames, sections, { skipNearZ = [] } = {}) {
  const cfg = sections.haulage;
  const placed = [];
  let lastLitZ = Infinity;

  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i];
    const z = frame.plan.center.z;

    // Keep the outer adit daylight-to-twilight transition free of warm lamps (leave one cold bracket).
    if (z > -6.5) {
      if (i === 2) placeUnlitFrameHook(b, frame);
      continue;
    }

    if (skipNearZ.some((sz) => Math.abs(z - sz) < 3.6)) {
      continue;
    }

    const distSinceLast = lastLitZ - z;
    const h = detHash(b.seed + 19, i);
    const isFirstWarm = placed.length === 0;
    const isFinalApproach = i === frames.length - 1 || i === frames.length - 2;
    const desiredGap = 4.6 + detHash(b.seed + 41, i) * 3.6;

    if (!isFirstWarm && distSinceLast < desiredGap && !(isFinalApproach && distSinceLast > 5.0)) {
      if (h < cfg.unlitRate + 0.14) placeUnlitFrameHook(b, frame);
      continue;
    }

    // Occasional extra dark bay near mid-drift so shadow stretches breathe naturally.
    if (!isFirstWarm && !isFinalApproach && h < cfg.unlitRate && distSinceLast < 8.0) {
      placeUnlitFrameHook(b, frame);
      continue;
    }

    const hangDrop = 0.08 + detHash(b.seed + 53, i) * 0.09;
    const warmAlt = detHash(b.seed + 131, i) > 0.52;
    const intensity = cfg.intensity * (0.88 + detHash(b.seed + 173, i) * 0.24);
    const range = cfg.range * (0.94 + detHash(b.seed + 211, i) * 0.14);

    const pos = hangLanternOnFrame(b, frame, {
      tint: warmAlt ? cfg.warmAltTint : cfg.tint,
      intensity,
      range,
      hangDrop,
      flicker: cfg.flickerAmount * (0.85 + detHash(b.seed + 241, i) * 0.4),
      importance: 1.0,
      section: 'haulage',
    });
    placed.push(pos);
    lastLitZ = z;
  }
  return placed;
}
