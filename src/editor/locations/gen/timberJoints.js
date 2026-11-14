import * as THREE from 'three/webgpu';
import {
  createTimberBeam,
  createTimberBoard,
  createTimberWedge,
  hashPosition,
  placeCachedPart,
} from './timberGeometry.js';

const P = (x, y, z) => ({ x, y, z });
const add = (a, b, s = 1) => P(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s);
const UP = P(0, 1, 0);

function unitBoxWithTimberUv() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const pos = g.attributes.position;
  const count = pos.count;
  const masks = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    masks[i * 4 + 0] = 0.2;
    masks[i * 4 + 1] = 0.3;
    masks[i * 4 + 2] = 0.45;
    masks[i * 4 + 3] = 1.0;
  }
  g.setAttribute('woodMask', new THREE.BufferAttribute(masks, 4));
  return g;
}

function unitPegGeometry() {
  // Chamfered 6-sided wooden trunnel along local Z (length 1, radius 0.5).
  const g = new THREE.CylinderGeometry(0.46, 0.5, 1, 6, 1);
  g.rotateX(Math.PI * 0.5);
  const count = g.attributes.position.count;
  const masks = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    masks[i * 4 + 0] = 0.55;
    masks[i * 4 + 1] = 0.25;
    masks[i * 4 + 2] = 0.5;
    masks[i * 4 + 3] = 1.0;
  }
  g.setAttribute('woodMask', new THREE.BufferAttribute(masks, 4));
  return g;
}

function unitIronBlock() {
  return new THREE.BoxGeometry(1, 1, 1);
}

function unitBoltHead() {
  // Raised square-headed forged bolt head along local Z.
  const g = new THREE.CylinderGeometry(0.46, 0.54, 1, 4, 1);
  g.rotateX(Math.PI * 0.5);
  g.rotateZ(Math.PI * 0.25);
  return g;
}

/** Places a wooden trunnel peg protruding slightly from both sides or one face. */
function placePeg(b, cache, at, axisRight, axisUp, axisForward, diameter, length, tint) {
  b.prop('timber', placeCachedPart(
    cache,
    'trunnel-peg',
    unitPegGeometry,
    at,
    axisRight,
    axisUp,
    axisForward,
    diameter,
    diameter,
    length,
  ), tint);
}

/** Places a forged iron bolt head + washer plate on a joint or strap. */
function placeIronBolt(b, cache, at, axisRight, axisUp, axisForward, boltSize, ironTint = 0x5c616b) {
  b.prop('iron', placeCachedPart(
    cache,
    'iron-washer',
    unitIronBlock,
    at,
    axisRight,
    axisUp,
    axisForward,
    boltSize * 2.1,
    boltSize * 2.1,
    boltSize * 0.32,
  ), ironTint);
  b.prop('iron', placeCachedPart(
    cache,
    'iron-bolt',
    unitBoltHead,
    add(at, axisForward, boltSize * 0.35),
    axisRight,
    axisUp,
    axisForward,
    boltSize * 1.15,
    boltSize * 1.15,
    boltSize * 0.72,
  ), 0x6f7580);
}

/**
 * Builds a ground-bearing timber sill block (or mudsill) under a post foot.
 */
export function buildSillFooting(b, {
  foot,
  spanDir,
  tunnelDir,
  width,
  height,
  depth,
  damp = 0.65,
  wear = 0.45,
  tint = 0x654c36,
  seed = 1,
}) {
  const halfDepth = depth * 0.5;
  const centerY = foot.y + height * 0.5;
  const a = P(foot.x - tunnelDir.x * halfDepth, centerY, foot.z - tunnelDir.z * halfDepth);
  const c = P(foot.x + tunnelDir.x * halfDepth, centerY, foot.z + tunnelDir.z * halfDepth);
  b.prop('timber', createTimberBeam(a, c, width, height, {
    sideHint: spanDir,
    bevelRatio: 0.16,
    irregular: 0.28,
    bow: 0.002,
    taper: 0.03,
    chipChance: 0.45,
    splitChance: 0.15,
    longitudinalStep: 0.45,
    maxSteps: 3,
    dampStart: damp,
    dampEnd: damp,
    wear,
    seed,
  }), tint);
}

/**
 * Builds the structural connection where a post meets the cap beam (`housed`,
 * `notched`, `bolster`, or `collared`).
 */
export function buildPostHeaderJoint(b, cache, {
  style,
  postTop,
  postWidth,
  postDepth,
  capHeight,
  capWidth,
  inwardDir,
  tunnelDir,
  upDir = UP,
  hasHardware = true,
  config,
  tint,
  hardwareTint = 0x5c616b,
  damp = 0.22,
  wear = 0.45,
  seed = 1,
}) {
  const jCfg = config.joints;
  const dCfg = config.beamDimensions;

  if (style === 'bolster') {
    // Saddle bolster block seated between post top and cap beam underside, extending inward & outward.
    const bolLen = dCfg.bolsterLength * (postWidth / dCfg.postWidth);
    const bolH = dCfg.bolsterHeight * (capHeight / dCfg.capHeight);
    const bolW = Math.max(capWidth + 0.02, dCfg.bolsterWidth);
    const bolCenter = add(postTop, upDir, -bolH * 0.5);
    const bA = add(bolCenter, inwardDir, -bolLen * 0.36);
    const bB = add(bolCenter, inwardDir, bolLen * 0.64);
    b.prop('timber', createTimberBeam(bA, bB, bolW, bolH, {
      sideHint: tunnelDir,
      bevelRatio: 0.15,
      irregular: 0.2,
      bow: 0.002,
      taper: 0.04,
      chipChance: 0.4,
      splitChance: 0.1,
      longitudinalStep: 0.45,
      maxSteps: 3,
      dampStart: damp,
      dampEnd: damp,
      wear,
      seed: seed + 11,
    }), tint);

    // Dual trunnel pegs pinning the bolster to cap and post.
    for (const offset of [-bolLen * 0.14, bolLen * 0.22]) {
      const pAt = add(add(bolCenter, inwardDir, offset), tunnelDir, bolW * 0.5 + 0.008);
      placePeg(b, cache, pAt, inwardDir, upDir, tunnelDir, jCfg.pegSize, bolW + 0.032, tint);
    }
    return { capOffsetY: bolH };
  }

  if (style === 'housed') {
    // Wooden cheek cleats / scabs nailed across both front & back of the post-to-cap joint.
    const cleatLen = postWidth * 1.9;
    const cleatW = Math.max(postWidth * 0.92, 0.15);
    const cleatT = 0.036;
    const seamY = add(postTop, upDir, capHeight * 0.12);
    for (const faceSign of [-1, 1]) {
      const faceCenter = add(seamY, tunnelDir, faceSign * (Math.max(postDepth, capWidth) * 0.5 + cleatT * 0.45));
      const cA = add(faceCenter, upDir, -cleatLen * 0.52);
      const cB = add(faceCenter, upDir, cleatLen * 0.48);
      b.prop('timber', createTimberBoard(cA, cB, inwardDir, cleatW, cleatT, {
        irregular: 0.16,
        damp,
        wear,
        seed: seed + 23 + faceSign * 7,
      }), tint);
    }
    // Protruding trunnels through both cleats, post head, and cap.
    for (const dy of [-cleatLen * 0.26, cleatLen * 0.2]) {
      const pAt = add(seamY, upDir, dy);
      placePeg(b, cache, pAt, inwardDir, upDir, tunnelDir, jCfg.pegSize, Math.max(postDepth, capWidth) + cleatT * 2.2, tint);
    }
    return { capOffsetY: 0 };
  }

  if (style === 'notched') {
    // Joggle / shoulder collar block nested directly under the cap soffit on the inner post face.
    const collarH = Math.min(0.11, capHeight * 0.5);
    const collarLen = postWidth * 1.45;
    const collarW = postDepth + 0.025;
    const collarCenter = add(add(postTop, upDir, -collarH * 0.5), inwardDir, postWidth * 0.14);
    b.prop('timber', createTimberBeam(
      add(collarCenter, inwardDir, -collarLen * 0.48),
      add(collarCenter, inwardDir, collarLen * 0.52),
      collarW,
      collarH,
      {
        sideHint: tunnelDir,
        bevelRatio: 0.15,
        irregular: 0.22,
        bow: 0.001,
        maxSteps: 3,
        dampStart: damp,
        dampEnd: damp,
        wear,
        seed: seed + 37,
      },
    ), tint);
    placePeg(
      b, cache,
      add(postTop, upDir, capHeight * 0.35),
      inwardDir, upDir, tunnelDir,
      jCfg.pegSize * 1.05, capWidth + 0.036, tint,
    );
    return { capOffsetY: 0 };
  }

  // 'collared': Forged iron L-straps wrapping the post-to-cap corner with bolts & washers.
  if (hasHardware) {
    const legLen = Math.min(0.38, postWidth * 1.9);
    const strapW = jCfg.strapWidth;
    const strapT = jCfg.strapThickness;
    const corner = add(postTop, inwardDir, postWidth * 0.5 + strapT * 0.5);
    for (const faceSign of [-1, 1]) {
      const fOff = faceSign * (Math.max(postDepth, capWidth) * 0.5 + strapT * 0.5);
      // Vertical leg down post face
      b.prop('iron', placeCachedPart(
        cache, 'iron-strap', unitIronBlock,
        add(add(postTop, upDir, -legLen * 0.32), tunnelDir, fOff),
        inwardDir, upDir, tunnelDir,
        strapW, legLen * 0.9, strapT,
      ), hardwareTint);
      // Horizontal leg along cap face
      b.prop('iron', placeCachedPart(
        cache, 'iron-strap', unitIronBlock,
        add(add(add(postTop, upDir, capHeight * 0.45), inwardDir, legLen * 0.25), tunnelDir, fOff),
        inwardDir, upDir, tunnelDir,
        legLen * 0.85, strapW, strapT,
      ), hardwareTint);
      // Bolts on front/back legs
      const bDir = P(tunnelDir.x * faceSign, tunnelDir.y * faceSign, tunnelDir.z * faceSign);
      placeIronBolt(b, cache, add(add(postTop, upDir, -legLen * 0.55), tunnelDir, fOff + faceSign * strapT * 0.5), inwardDir, upDir, bDir, jCfg.boltSize, hardwareTint);
      placeIronBolt(b, cache, add(add(add(postTop, upDir, capHeight * 0.45), inwardDir, legLen * 0.48), tunnelDir, fOff + faceSign * strapT * 0.5), inwardDir, upDir, bDir, jCfg.boltSize, hardwareTint);
    }
    // Inner corner L-bracket tie
    b.prop('iron', placeCachedPart(
      cache, 'iron-strap', unitIronBlock,
      add(corner, upDir, -legLen * 0.28),
      tunnelDir, upDir, inwardDir,
      strapW * 1.1, legLen * 0.65, strapT,
    ), hardwareTint);
  } else {
    placePeg(b, cache, add(postTop, upDir, capHeight * 0.35), inwardDir, upDir, tunnelDir, jCfg.pegSize, capWidth + 0.03, tint);
  }
  return { capOffsetY: 0 };
}

/**
 * Builds a miter-seated diagonal knee brace connecting the post inner face
 * cleanly to the cap underside (or bolster soffit), with optional heel cleat & peg.
 */
export function buildKneeBrace(b, cache, {
  postInnerTop,
  capSoffitY,
  inwardDir,
  tunnelDir,
  upDir = UP,
  drop,
  reach,
  braceWidth,
  braceDepth,
  hasCleat = false,
  hasHardware = false,
  config,
  tint,
  hardwareTint = 0x5c616b,
  damp = 0.2,
  wear = 0.48,
  seed = 1,
}) {
  // Anchor start on post inner face, end on cap soffit; inset slightly so chamfered bevels never leave a hairline gap.
  const seatInset = 0.015;
  const startNode = add(add(postInnerTop, upDir, -drop), inwardDir, -seatInset);
  const endNode = P(
    postInnerTop.x + inwardDir.x * reach,
    capSoffitY + seatInset,
    postInnerTop.z + inwardDir.z * reach,
  );

  // Miter cut normals: start sits flush against post inner face (-inwardDir), end sits flush against cap soffit (+upDir).
  const startCutNormal = P(-inwardDir.x, -inwardDir.y, -inwardDir.z);
  const endCutNormal = P(upDir.x, upDir.y, upDir.z);

  b.prop('timber', createTimberBeam(startNode, endNode, braceWidth, braceDepth, {
    sideHint: tunnelDir,
    bevelRatio: 0.14,
    irregular: config.geometry.edgeIrregularity * 0.85,
    bow: 0.003,
    taper: 0.03,
    chipChance: 0.4,
    splitChance: 0.12,
    longitudinalStep: 0.45,
    maxSteps: 4,
    dampStart: damp,
    dampEnd: damp * 0.7,
    wear,
    startCutNormal,
    endCutNormal,
    seed,
  }), tint);

  // Optional heel cleat directly beneath the brace foot on the post inner face.
  if (hasCleat) {
    const cleatH = Math.min(0.15, braceDepth * 1.15);
    const cleatD = Math.min(0.08, braceDepth * 0.65);
    const cleatAt = add(add(postInnerTop, upDir, -drop - cleatH * 0.52), inwardDir, cleatD * 0.42);
    b.prop('timber', createTimberBeam(
      add(cleatAt, upDir, -cleatH * 0.5),
      add(cleatAt, upDir, cleatH * 0.5),
      braceWidth * 1.06,
      cleatD,
      {
        sideHint: tunnelDir,
        bevelRatio: 0.14,
        irregular: 0.2,
        bow: 0,
        maxSteps: 3,
        dampStart: damp,
        dampEnd: damp,
        wear,
        seed: seed + 19,
      },
    ), tint);
  }

  // Fastening pin or iron bolt near brace heel/head.
  const jCfg = config.joints;
  if (hasHardware) {
    const boltFace = add(add(startNode, inwardDir, braceDepth * 0.45), upDir, braceDepth * 0.45);
    placeIronBolt(
      b, cache,
      add(boltFace, tunnelDir, braceWidth * 0.5 + 0.005),
      inwardDir, upDir, tunnelDir,
      jCfg.boltSize * 0.88,
      hardwareTint,
    );
  } else {
    const pegAt = add(add(endNode, inwardDir, -braceDepth * 0.4), upDir, -braceDepth * 0.4);
    placePeg(b, cache, pegAt, inwardDir, upDir, tunnelDir, jCfg.pegSize * 0.86, braceWidth + 0.026, tint);
  }
}

/**
 * Places blocking cribbing and opposing driven tapered timber wedges between
 * a frame surface (`surfaceCenter`) and probed rock along `outNormal` (`gap` metres).
 */
export function buildRockBlocking(b, {
  surfaceCenter,
  outNormal,
  acrossDir,
  tangentDir,
  gap,
  width,
  depth,
  config,
  tint,
  damp = 0.45,
  wear = 0.4,
  seed = 1,
}) {
  const maxGap = config.joints.blockingMaxGap;
  if (gap < 0.035 || gap > maxGap) return;

  const wedgeH = Math.min(config.joints.wedgeMaxThickness, Math.max(0.038, gap * 0.65));
  const blockingH = gap - wedgeH;
  let cursor = P(surfaceCenter.x, surfaceCenter.y, surfaceCenter.z);

  // Stacked timber cribbing/packing block(s) if gap exceeds wedge thickness.
  if (blockingH >= 0.05) {
    const layers = blockingH > 0.26 ? 2 : 1;
    const layerH = blockingH / layers;
    for (let i = 0; i < layers; i += 1) {
      const layerMid = add(cursor, outNormal, layerH * 0.5);
      const axisDir = i % 2 === 0 ? acrossDir : tangentDir;
      const sideDir = i % 2 === 0 ? tangentDir : acrossDir;
      const spanLen = (i % 2 === 0 ? width : depth) * 1.35;
      const blockW = (i % 2 === 0 ? depth : width) * 0.92;
      b.prop('timber', createTimberBeam(
        add(layerMid, axisDir, -spanLen * 0.5),
        add(layerMid, axisDir, spanLen * 0.5),
        blockW,
        layerH * 0.96,
        {
          sideHint: sideDir,
          bevelRatio: 0.12,
          irregular: 0.28,
          bow: 0.002,
          maxSteps: 3,
          dampStart: damp,
          dampEnd: damp,
          wear,
          seed: seed + i * 29,
        },
      ), tint);
      cursor = add(cursor, outNormal, layerH);
    }
  }

  // Opposing pair of tapered wedges driven tight against the rock.
  const wedgeLen = Math.max(0.24, Math.min(0.4, width * 1.55));
  const wedgeW = Math.min(depth * 0.72, 0.15);
  const wedgeMid = add(cursor, outNormal, wedgeH * 0.55);
  const wA = add(wedgeMid, acrossDir, -wedgeLen * 0.5);
  const wB = add(wedgeMid, acrossDir, wedgeLen * 0.5);
  b.prop('timber', createTimberWedge(wA, wB, wedgeW, wedgeH * 0.85, 0.015, {
    upHint: outNormal,
    damp: damp * 0.85,
    wear,
  }), tint);
}

/**
 * Adds miner repair details onto an existing frame (`repaired` archetype):
 * sister post with fresh wedges, iron mending plate with bolts, or scab splint.
 */
export function buildRepairDetails(b, cache, {
  postFoot,
  postTop,
  capStart,
  capEnd,
  postWidth,
  postDepth,
  capWidth,
  capHeight,
  inwardDir,
  tunnelDir,
  upDir = UP,
  repairKind = 'sister-post',
  config,
  repairTint = 0x987854,
  hardwareTint = 0x5c616b,
  seed = 1,
}) {
  const jCfg = config.joints;

  if (repairKind === 'sister-post') {
    // Fresher sister post placed immediately adjacent along the tunnel axis, wedged tight under cap.
    const sideSign = (hashPosition(postFoot.x, postFoot.y, postFoot.z, seed) & 1) ? 1 : -1;
    const offsetAlong = sideSign * (postDepth * 0.98);
    const sisW = postWidth * 0.84;
    const sisD = postDepth * 0.84;
    const sisFoot = add(postFoot, tunnelDir, offsetAlong);
    const sisTop = add(add(postTop, tunnelDir, offsetAlong), upDir, -0.045);

    b.prop('timber', createTimberBeam(sisFoot, sisTop, sisD, sisW, {
      sideHint: inwardDir,
      bevelRatio: 0.13,
      irregular: 0.16,
      bow: 0.003,
      taper: 0.03,
      chipChance: 0.25,
      splitChance: 0.05,
      dampStart: 0.35,
      dampEnd: 0.1,
      wear: 0.22,
      seed: seed + 101,
    }), repairTint);

    // Fresh pale wedge driven between sister post top and cap underside.
    const wedgeBase = add(sisTop, upDir, 0.022);
    b.prop('timber', createTimberWedge(
      add(wedgeBase, inwardDir, -sisW * 0.85),
      add(wedgeBase, inwardDir, sisW * 0.95),
      sisD * 0.9,
      0.055,
      0.014,
      { upHint: upDir, damp: 0.1, wear: 0.2 },
    ), repairTint);

    // Iron clamp strap tying the sister post to the original post mid-height.
    const midY = (postFoot.y + postTop.y) * 0.52;
    const strapAt = P(
      (postFoot.x + sisFoot.x) * 0.5 + inwardDir.x * (postWidth * 0.5 + 0.01),
      midY,
      (postFoot.z + sisFoot.z) * 0.5 + inwardDir.z * (postWidth * 0.5 + 0.01),
    );
    b.prop('iron', placeCachedPart(
      cache, 'iron-strap', unitIronBlock,
      strapAt,
      tunnelDir, upDir, inwardDir,
      postDepth * 1.9, jCfg.strapWidth, jCfg.strapThickness,
    ), hardwareTint);
    placeIronBolt(b, cache, add(add(strapAt, tunnelDir, -postDepth * 0.5), inwardDir, jCfg.strapThickness * 0.5), tunnelDir, upDir, inwardDir, jCfg.boltSize, hardwareTint);
    placeIronBolt(b, cache, add(add(strapAt, tunnelDir, postDepth * 0.5), inwardDir, jCfg.strapThickness * 0.5), tunnelDir, upDir, inwardDir, jCfg.boltSize, hardwareTint);
    return;
  }

  // 'cap-splint': Bolted iron splice plate + wooden scab cleat across mid-span of the cap beam.
  const midCap = P(
    (capStart.x + capEnd.x) * 0.5,
    (capStart.y + capEnd.y) * 0.5,
    (capStart.z + capEnd.z) * 0.5,
  );
  const spanLen = Math.min(0.85, Math.hypot(capEnd.x - capStart.x, capEnd.z - capStart.z) * 0.34);
  for (const faceSign of [-1, 1]) {
    const faceOffset = faceSign * (capWidth * 0.5 + 0.016);
    const cleatCenter = add(midCap, tunnelDir, faceOffset);
    b.prop('timber', createTimberBoard(
      add(cleatCenter, inwardDir, -spanLen * 0.5),
      add(cleatCenter, inwardDir, spanLen * 0.5),
      upDir,
      capHeight * 0.72,
      0.032,
      { irregular: 0.14, damp: 0.15, wear: 0.2, seed: seed + 141 + faceSign },
    ), repairTint);

    const plateOffset = faceSign * (capWidth * 0.5 + 0.036);
    const plateAt = add(midCap, tunnelDir, plateOffset);
    b.prop('iron', placeCachedPart(
      cache, 'iron-plate', unitIronBlock,
      plateAt,
      inwardDir, upDir, tunnelDir,
      spanLen * 0.62, capHeight * 0.42, jCfg.strapThickness,
    ), hardwareTint);

    const bDir = P(tunnelDir.x * faceSign, tunnelDir.y * faceSign, tunnelDir.z * faceSign);
    for (const dx of [-spanLen * 0.2, spanLen * 0.2]) {
      placeIronBolt(b, cache, add(add(plateAt, inwardDir, dx), bDir, jCfg.strapThickness * 0.5), inwardDir, upDir, bDir, jCfg.boltSize, hardwareTint);
    }
  }
}

export { unitBoxWithTimberUv };
