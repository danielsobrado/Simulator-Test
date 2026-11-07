import { createRandom, mixSeed } from '../../ProceduralRandom.js';
import { buildChimney } from '../HouseDetails.js';
import { buildDormer } from '../HouseDormer.js';
import { buildRoof } from '../HouseRoof.js';
import { joists, storeyRoot } from '../HouseStoreys.js';
import { clamp, design, OpeningNumbering, roofRise, sideLength } from '../HouseDesign.js';

const SIDES = Object.freeze(['front', 'back', 'left', 'right']);

/**
 * The building's grammar, rolled from the seed: storey count and heights,
 * wall materials, jetties, framing, roof form, an optional front wing, dormers
 * and a chimney. Dimensions still come from the recipe; only the choices are
 * random, so a settlement can ask for "a 9 × 6 m, two-storey house" and get a
 * different one per seed.
 */
function rollGrammar(recipe) {
  const random = createRandom(mixSeed(recipe.seed, 0x6e11));
  const pick = (items) => items[Math.floor(random() * items.length) % items.length];
  const chance = (probability) => random() < probability;
  const width = clamp(recipe.width, 5, 16);
  const depth = clamp(recipe.depth, 4, 10);
  const eave = clamp(recipe.height, 3, 11);
  const storeys = eave < 4.6 ? 1 : eave < 7.2 ? 2 : 3;
  const ridgeAlongX = width >= depth ? !chance(0.2) : chance(0.2);
  // A front wing's cross roof needs the main ridge to run along the front.
  const wing = ridgeAlongX && width >= 7 && chance(0.35) ? pick(['left', 'right']) : null;
  const hipped = chance(0.3);
  return {
    width,
    depth,
    eave,
    storeys,
    groundWall: chance(0.72) ? 'stone' : pick(['plaster', 'boards']),
    upperWall: chance(0.85) ? 'plaster' : 'boards',
    groundHeight: storeys === 1 ? eave : clamp(eave / storeys * (0.9 + random() * 0.3), 2.3, 3.6),
    // A front wing and a front jetty would collide, so a winged house jetties at the back only.
    jetties: Array.from({ length: storeys - 1 }, () => pick([0, 0.2, 0.35])),
    frontJetty: !wing,
    braces: Array.from({ length: storeys }, () => pick(['none', 'diagonal', 'cross'])),
    spacing: Array.from({ length: storeys }, () => 1.2 + random() * 1.0),
    shutters: chance(0.5),
    flowers: chance(0.5),
    ridgeAlongX,
    hip: hipped ? 0.4 + random() * 0.5 : 0,
    sweep: chance(0.6) ? random() * 0.55 : 0,
    sag: chance(0.3) ? random() * 0.3 : undefined,
    pitchScale: 0.9 + random() * 0.35,
    wing,
    wingWidth: clamp(width * (0.3 + random() * 0.12), 2.6, 4.5),
    wingDepth: clamp(depth * (0.4 + random() * 0.2), 2, 4),
    dormers: hipped ? pick([0, 1]) : pick([0, 1, 2]),
    chimney: pick(['gable', 'ridge', 'none']),
    doorAt: (random() - 0.5) * 0.5,
    windowSpacing: 2 + random() * 1.2,
    windowWidth: 0.7 + random() * 0.3,
    archedGround: chance(0.4),
    random,
  };
}

function storeyStack(grammar, footprint, idPrefix, labelPrefix) {
  const result = [];
  let box = footprint;
  let y0 = 0;
  const upperHeight = grammar.storeys > 1 ? (grammar.eave - grammar.groundHeight) / (grammar.storeys - 1) : 0;
  for (let index = 0; index < grammar.storeys; index += 1) {
    const ground = index === 0;
    const y1 = ground ? grammar.groundHeight : y0 + upperHeight;
    if (!ground) {
      const jetty = grammar.jetties[index - 1];
      box = { ...box, z0: box.z0 - jetty, z1: box.z1 + (grammar.frontJetty ? jetty : 0) };
    }
    const wall = ground ? grammar.groundWall : grammar.upperWall;
    result.push({
      id: index === 0 ? idPrefix : `${idPrefix}-${index === 1 ? 'upper' : 'top'}`,
      label: `${labelPrefix}${['ground floor', 'first floor', 'second floor'][index]}`,
      wall,
      ground,
      box: { ...box, y0: ground ? 0 : y0 + 0.11, y1 },
      roofed: index === grammar.storeys - 1,
      ...(ground ? {} : { plate: { overhang: 0.07, offset: -0.11 } }),
      frame: { spacing: grammar.spacing[index], braces: grammar.braces[index], rails: upperHeight > 2.8 ? [y0 + upperHeight * 0.38] : [] },
      openings: { shutters: grammar.shutters, flowers: grammar.flowers },
    });
    y0 = y1;
  }
  return result;
}

/** Door centre within the widest clear stretch of the front, nudged by the seed. */
function doorPosition(grammar, half, avoid) {
  const clear = [[-half + 1.0, half - 1.0]];
  for (const [a, b] of avoid) {
    const next = [];
    for (const [start, end] of clear) {
      if (b <= start || a >= end) next.push([start, end]);
      else {
        if (a > start) next.push([start, a]);
        if (b < end) next.push([b, end]);
      }
    }
    clear.splice(0, clear.length, ...next);
  }
  const [start, end] = clear.sort((left, right) => (right[1] - right[0]) - (left[1] - left[0]))[0] ?? [0, 0];
  return (start + end) / 2 + grammar.doorAt * Math.max(0, end - start - 1.0);
}

function addOpenings(numbering, grammar, storeys, { avoid = [], skip = [] } = {}) {
  storeys.forEach((storey, index) => {
    const height = storey.box.y1 - storey.box.y0;
    const windowHeight = Math.min(1.1, height * 0.42);
    const bottom = index === 0 ? Math.min(0.95, height * 0.35) : height * 0.3;
    for (const side of SIDES) {
      if (skip.includes(side)) continue;
      if (index === 0 && side === 'front') {
        const doorX = doorPosition(grammar, sideLength(storey, side) / 2, avoid);
        numbering.door(storey, side, { centerX: doorX, width: 1.0, height: Math.min(2.1, height - 0.2), arch: grammar.archedGround && storey.wall === 'stone' });
        numbering.row(storey, side, { spacing: grammar.windowSpacing, bottom, width: grammar.windowWidth, height: windowHeight, arch: grammar.archedGround, avoid: [...avoid, [doorX - 0.9, doorX + 0.9]] });
        continue;
      }
      numbering.row(storey, side, {
        spacing: grammar.windowSpacing * (side === 'left' || side === 'right' ? 1.2 : 1),
        bottom,
        width: grammar.windowWidth,
        height: windowHeight,
        arch: index === 0 && grammar.archedGround && storey.wall === 'stone',
        avoid: side === 'front' ? avoid : [],
      });
    }
  });
}

/** A seeded village or town house: every reroll is a different building. */
export function generatedHouseDesign(recipe) {
  const grammar = rollGrammar(recipe);
  const { width, depth, eave } = grammar;
  const main = { x0: -width / 2, x1: width / 2, z0: -depth / 2, z1: depth / 2 };
  const storeys = storeyStack(grammar, main, 'structure-main', '');
  const numbering = new OpeningNumbering(recipe);

  let wing = null;
  let wingStoreys = [];
  if (grammar.wing) {
    const x0 = grammar.wing === 'left' ? main.x0 : main.x1 - grammar.wingWidth;
    wing = { x0, x1: x0 + grammar.wingWidth, z0: main.z1, z1: main.z1 + grammar.wingDepth };
    wingStoreys = storeyStack({ ...grammar, jetties: grammar.jetties.map(() => 0) }, wing, 'structure-wing', 'Wing ')
      .map((storey) => ({ ...storey, skip: ['back'] }));
  }
  const wingBand = wing ? [[wing.x0 - 0.2, wing.x1 + 0.2]] : [];
  addOpenings(numbering, grammar, storeys, { avoid: wingBand });
  if (wing) addOpenings(numbering, { ...grammar, doorAt: 0 }, wingStoreys, { skip: ['back'] });

  const top = storeys.at(-1);
  return design({
    storeys: [...storeys, ...wingStoreys],
    openings: numbering.openings,
    build(kit, { facades }) {
      storeys.slice(0, -1).forEach((storey, index) => {
        if (!grammar.jetties[index]) return;
        kit.within(storeyRoot(storey), () => {
          const stacked = facades.get(storey.id);
          joists(kit, stacked.back, storey.box.y1 - 0.14, { out: grammar.jetties[index] + 0.1 });
          if (grammar.frontJetty) joists(kit, stacked.front, storey.box.y1 - 0.14, { out: grammar.jetties[index] + 0.1 });
        });
      });
      kit.within(storeyRoot(top), () => {
        const roofBox = { x0: top.box.x0, x1: top.box.x1, z0: top.box.z0, z1: top.box.z1 };
        const acrossHalf = grammar.ridgeAlongX ? (roofBox.z1 - roofBox.z0) / 2 : (roofBox.x1 - roofBox.x0) / 2;
        const roof = buildRoof(kit, {
          ...roofBox,
          axis: grammar.ridgeAlongX ? 'x' : 'z',
          wallTop: eave,
          rise: roofRise(recipe, acrossHalf, { pitchScale: grammar.pitchScale }),
          overhang: recipe.roofOverhang,
          sweep: grammar.sweep,
          sag: grammar.sag,
          hip: grammar.hip,
        }, { gableFrame: top.wall === 'plaster' });
        if (grammar.ridgeAlongX) {
          const reach = (roofBox.x1 - roofBox.x0) / 2 - 1.2;
          const positions = grammar.dormers === 2 ? [-reach * 0.5, reach * 0.5] : grammar.dormers === 1 ? [0] : [];
          for (const at of positions) {
            if (wing && at + roof.center[0] > wing.x0 - 0.8 && at + roof.center[0] < wing.x1 + 0.8) continue;
            buildDormer(kit, roof, { at, side: 1, width: 0.9, height: 0.8 });
          }
        }
        if (grammar.chimney === 'ridge') {
          buildChimney(kit, { x: (roofBox.x1 - roofBox.x0) * 0.2, z: 0, width: 0.7, depth: 0.7, y0: eave - 0.4, y1: eave + roof.rise + 0.7, pots: 2 });
        } else if (grammar.chimney === 'gable') {
          const x = grammar.ridgeAlongX ? main.x1 + 0.4 : 0;
          const z = grammar.ridgeAlongX ? 0 : main.z0 - 0.4;
          buildChimney(kit, { x, z, width: 0.8, depth: 0.8, y0: -0.2, y1: eave + roof.rise * 0.9 + 0.6, pots: 2 });
        }
      });
      if (!wing) return;
      kit.within(storeyRoot(wingStoreys.at(-1)), () => {
        // Cross gable: the wing's ridge runs out from the main roof, into which it dies.
        buildRoof(kit, {
          x0: wing.x0,
          x1: wing.x1,
          z0: wing.z0 - depth * 0.3,
          z1: wing.z1,
          axis: 'z',
          wallTop: eave,
          rise: roofRise(recipe, grammar.wingWidth / 2, { pitchScale: grammar.pitchScale }) * 0.92,
          overhang: recipe.roofOverhang,
          sweep: grammar.sweep,
        }, { gableEnds: { start: null, end: 'plaster' }, gableFrame: true });
      });
    },
  });
}
