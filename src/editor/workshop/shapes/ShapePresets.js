import { SHAPE_CASTLE_PRESETS } from './config/ShapeCastleConfig.generated.js';

const opening = (id, at, role = 'window', bottom = 1) => ({
  id,
  at,
  role,
  bottom,
  width: role === 'door' ? 1.1 : 0.8,
  height: role === 'door' ? 2.1 : 1.2,
});
const volume = (id, label, extra = {}) => ({
  id,
  label,
  kind: 'curved-volume',
  position: [0, 0],
  height: 3.5,
  shutters: true,
  footprint: { family: 'rounded', width: 7, depth: 5, cornerRadius: 0.8 },
  roof: { family: 'gable', rise: 2.5, overhang: 0.45, sweep: 0.5, sag: 0.12 },
  openings: [
    opening('door', 0.64, 'door', 0),
    opening('window-front', 0.49),
    opening('window-side', 0.28),
  ],
  ...extra,
});
const wall = (id, label, extra = {}) => ({
  id,
  label,
  kind: 'curved-wall',
  length: 9,
  bend: 4,
  height: 2.1,
  surface: 'masonry',
  ...extra,
});
const traversal = (id, label, extra = {}) => ({
  id,
  label,
  kind: 'traversal',
  length: 5,
  width: 1.8,
  elevation: 0,
  rise: 1.5,
  mode: 'auto',
  ...extra,
});

export const SHAPE_PRESETS = Object.freeze(
  [
    // Fortification designs are data (config/castle-presets.yml) over the same shape capabilities.
    ...SHAPE_CASTLE_PRESETS.map((preset) => ({ id: preset.id, label: preset.label, create: () => structuredClone(preset.primitives) })),
    {
      id: 'rounded-cottage',
      label: 'Rounded cottage',
      create: () => [volume('cottage', 'Rounded cottage')],
    },
    {
      id: 'bell-turret',
      label: 'Bell-roof turret',
      create: () => [
        volume('turret', 'Bell-roof turret', {
          footprint: { family: 'oval', width: 4.8, depth: 4.8 },
          height: 6.5,
          taper: 0.9,
          surface: 'masonry',
          shutters: false,
          roof: { family: 'bell', rise: 3.9, overhang: 0.6, sweep: 0.85 },
          openings: [
            opening('door', 0.18, 'door', 0),
            opening('high-window', 0.42, 'window', 3.4),
            opening('side-window', 0.75, 'window', 3.4),
          ],
        }),
      ],
    },
    {
      id: 'courtyard-pavilion',
      label: 'Oval garden pavilion',
      create: () => [
        volume('pavilion', 'Garden pavilion', {
          footprint: { family: 'oval', width: 7, depth: 5 },
          height: 3.1,
          shutters: false,
          // The rectangular hip solver lifts an oval eave; a bell roof follows its outline.
          roof: { family: 'bell', rise: 2.3, overhang: 0.6, sweep: 0.55 },
          openings: [0.2, 0.45, 0.7].map((at, i) => ({
            ...opening(`arch-${i}`, at, 'arch', 0),
            width: 2,
            height: 2.5,
          })),
        }),
      ],
    },
    {
      id: 'cottage-turret',
      label: 'Cottage with a turret',
      create: () => [
        volume('cottage', 'Rounded cottage'),
        volume('turret', 'Attached turret', {
          position: [-3, 0.3],
          footprint: { family: 'oval', width: 3.8, depth: 3.8 },
          height: 6,
          taper: 0.92,
          surface: 'masonry',
          shutters: false,
          roof: { family: 'bell', rise: 3.1, overhang: 0.5, sweep: 0.8 },
          openings: [opening('turret-window', 0.47, 'window', 3.8)],
        }),
      ],
    },
    {
      id: 'terraced-cottage',
      label: 'Terraced cottage',
      create: () => [
        volume('cottage', 'Raised cottage', { elevation: 1.6 }),
        traversal('terrace', 'Front terrace', {
          position: [0, 3.4],
          length: 6.8,
          width: 1.8,
          elevation: 1.6,
          rise: 0,
          mode: 'walkway',
          railing: false,
        }),
        traversal('steps', 'Garden steps', {
          position: [2.8, 6.3],
          rotation: -90,
          length: 4.6,
          width: 1.5,
          elevation: 0,
          rise: 1.6,
        }),
      ],
    },
    {
      id: 'garden-bridge',
      label: 'Arched garden bridge',
      create: () => [
        traversal('bridge', 'Garden bridge', {
          length: 8,
          width: 2,
          // Both ends land on the garden; the arch alone carries the span.
          elevation: 0.12,
          rise: 0,
          mode: 'bridge',
          support: 'arch',
        }),
      ],
    },
    {
      id: 'curved-courtyard',
      label: 'Curved courtyard walls',
      create: () => [
        wall('wall-left', 'Curved garden wall', {
          position: [-1, 0],
          length: 10,
          bend: 5,
        }),
        wall('wall-right', 'Low courtyard wall', {
          position: [3, 4.2],
          rotation: 65,
          length: 6,
          bend: 2.5,
          height: 1.4,
        }),
      ],
    },
    {
      id: 'timber-cottage',
      label: 'Half-timber cottage',
      create: () => [
        volume('cottage', 'Half-timber cottage', {
          facade: 'timber',
          height: 4.4,
          levels: 2,
          footprint: {
            family: 'rounded',
            width: 7,
            depth: 5,
            cornerRadius: 0.35,
          },
          openings: [
            opening('door', 0.64, 'door', 0),
            opening('window-front', 0.49),
            opening('window-upper', 0.5, 'window', 2.6),
            opening('window-side', 0.28, 'window', 2.6),
          ],
        }),
      ],
    },
    {
      id: 'garden-gateway',
      label: 'Garden wall with a path gate',
      create: () => [
        wall('garden-wall', 'Curved garden wall', {
          length: 10,
          bend: 3,
          height: 3.2,
        }),
        traversal('garden-path', 'Garden path', {
          position: [0, 1.5],
          rotation: 90,
          length: 7,
          width: 1.6,
          rise: 0,
          mode: 'walkway',
          railing: false,
          support: 'none',
        }),
      ],
    },
    {
      id: 'timber-pavilion',
      label: 'Timber pavilion and ramp',
      create: () => [
        volume('pavilion', 'Timber pavilion', {
          surface: 'planks',
          height: 3.2,
          elevation: 0.5,
          roof: { family: 'hip', rise: 2.1, overhang: 0.55, sweep: 0.7 },
        }),
        traversal('ramp', 'Garden ramp', {
          position: [-0.5, 5],
          length: 5,
          rotation: -90,
          rise: 0.5,
          mode: 'auto',
          width: 1.4,
        }),
      ],
    },
    {
      id: 'dormer-cottage', label: 'Cottage with roof dormers',
      create: () => [volume('cottage', 'Dormer cottage', { features: [
        { id: 'dormer-front', kind: 'dormer', at: 0.56, width: 1.7, depth: 1.6 },
        { id: 'dormer-back', kind: 'dormer', at: 0.13, width: 1.7, depth: 1.6 },
      ] })],
    },
    {
      id: 'bay-porch-cottage', label: 'Cottage with a bay and porch',
      create: () => [volume('cottage', 'Bay and porch cottage', { facade: 'timber', features: [
        { id: 'bay-front', kind: 'bay', at: 0.49, width: 2.2, depth: 1.1, bottom: 0, height: 2.6 },
        { id: 'porch-door', kind: 'porch', at: 0.64, width: 2.4, depth: 1.7, height: 2.5 },
      ] })],
    },
    {
      id: 'jettied-townhouse', label: 'Projecting timber townhouse',
      create: () => [volume('cottage', 'Jettied townhouse', { facade: 'timber', height: 5.5, levels: 2,
        footprint: { family: 'rounded', width: 5.8, depth: 4.6, cornerRadius: 0.25 },
        openings: [opening('door', 0.64, 'door', 0), opening('upper-front', 0.5, 'window', 3.4), opening('upper-side', 0.28, 'window', 3.4)],
        features: [{ id: 'upper-floor', kind: 'jetty', depth: 0.45 }],
      })],
    },
    {
      id: 'buttressed-chapel', label: 'Buttressed stone chapel',
      create: () => [volume('chapel', 'Garden chapel', { surface: 'masonry', shutters: false, height: 4.6,
        footprint: { family: 'rounded', width: 8, depth: 5.3, cornerRadius: 0.3 },
        roof: { family: 'gable', rise: 3.8, overhang: 0.32, sweep: 0.2, sag: 0.05 },
        features: [0.07, 0.2, 0.53, 0.68].map((at, i) => ({ id: `buttress-${i}`, kind: 'buttress', at, width: 0.6, depth: 0.9, height: 3.8 })),
      })],
    },
    {
      id: 'balcony-manor', label: 'Timber manor with a balcony',
      create: () => [volume('manor', 'Balcony manor', { facade: 'timber', height: 5.8, levels: 2,
        footprint: { family: 'rounded', width: 7.6, depth: 5.4, cornerRadius: 0.4 },
        openings: [opening('door', 0.64, 'door', 0), { ...opening('balcony-door', 0.5, 'door', 2.9), width: 1.25 },
          { ...opening('upper-side', 0.28, 'window', 3.4), shutterPose: 'ajar' }, opening('front-window', 0.49)],
        features: [{ id: 'front-balcony', kind: 'balcony', at: 0.5, width: 3.7, depth: 1.15, bottom: 2.9, height: 1.05 },
          { id: 'porch', kind: 'porch', at: 0.64, width: 2.2, depth: 1.5, height: 2.4 }],
      })],
    },
    {
      id: 'balcony-tower', label: 'Round tower with a curved balcony',
      create: () => [volume('tower', 'Balcony tower', { surface: 'masonry', height: 6.2, levels: 2, taper: 0.93,
        footprint: { family: 'oval', width: 5.3, depth: 5.3 },
        roof: { family: 'bell', rise: 3.4, overhang: 0.55, sweep: 0.75 },
        openings: [opening('door', 0.18, 'door', 0), opening('balcony-door', 0.18, 'door', 3.1),
          { ...opening('high-window', 0.45, 'window', 3.9), shutterPose: 'closed' }],
        features: [{ id: 'curved-balcony', kind: 'balcony', at: 0.18, width: 4.2, depth: 1.05, bottom: 3.1, height: 1.1 }],
      })],
    },
  ].map((preset) => Object.freeze(preset)),
);

export function createShapePreset(id) {
  const preset = SHAPE_PRESETS.find((item) => item.id === id);
  if (!preset) throw new Error(`Unknown shape preset: ${id}.`);
  return { version: 1, primitives: preset.create() };
}

export function createShapePrimitive(kind, id) {
  const factory = { 'curved-volume': volume, 'curved-wall': wall, traversal }[kind];
  if (!factory) throw new Error(`Unknown shape kind: ${kind}.`);
  return factory(
    id,
    kind === 'curved-volume' ? 'New cottage' : kind === 'curved-wall' ? 'New wall' : 'New path',
    { position: [4, 0] },
  );
}
