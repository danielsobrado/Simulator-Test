import { SHAPE_PRESETS } from './ShapePresets.js';
import { SHAPE_ROOF_FAMILIES } from './ShapeVolume.js';
import { shapeGateMarkup } from './ShapeGateControls.js';
import { adaptShapeHeight, shapeFieldEditable } from './ShapeEditConstraints.js';
import { shapeFeatureMarkup } from './ShapeFeatureControls.js';
import { shapeDetailMarkup } from './ShapeDetailControls.js';

const range = (field, label, min, max, step) =>
  `<label>${label}<input type="range" data-shape-field="${field}" min="${min}" max="${max}" step="${step}"/><output data-shape-output="${field}"></output></label>`;
const select = (field, label, values) =>
  `<label>${label}<select data-shape-field="${field}">${values.map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label>`;

export function workshopShapeMarkup() {
  return `<section class="workshop-shape-editor" data-role="shape-editor" hidden>
    <label>Starting design<select data-shape-action="preset">${SHAPE_PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join('')}</select></label>
    <label>Selected shape<select data-shape-action="select"></select></label>
    <div class="workshop-shape-actions">
      <button type="button" data-shape-action="add-volume">+ Building</button>
      <button type="button" data-shape-action="add-wall">+ Wall</button>
      <button type="button" data-shape-action="add-path">+ Path</button>
      <button type="button" data-shape-action="remove">Remove</button>
      <button type="button" data-shape-action="undo">Undo</button>
      <button type="button" data-shape-action="redo">Redo</button>
    </div>
    <div class="workshop-shape-fields" data-shape-section="common">
      ${range('x', 'Position X', -16, 16, 0.1)}${range('z', 'Position Z', -16, 16, 0.1)}
      ${range('rotation', 'Rotation', -180, 180, 1)}${range('elevation', 'Elevation', 0, 8, 0.1)}
      ${range('age', 'Weathering', 0, 1, 0.05)}
    </div>
    <div class="workshop-shape-fields" data-shape-section="wall">
      ${range('height', 'Wall height', 1, 14, 0.1)}${range('thickness', 'Wall thickness', 0.15, 1, 0.05)}
      ${select('surface', 'Wall surface', [
        ['plaster', 'Warm plaster'],
        ['masonry', 'Chunky masonry'],
        ['planks', 'Timber planks'],
      ])}
      ${select('stonework', 'Stonework', [['fieldstone', 'Warm chunky stone'], ['ashlar', 'Grey ashlar, dark joints']])}
    </div>
    <div class="workshop-shape-fields" data-shape-section="volume">
      ${select('facade', 'Facade', [
        ['plain', 'Simple plaster or stone'],
        ['timber', 'Half-timber framing'],
      ])}
      <label class="workshop-check"><input type="checkbox" data-shape-field="shutters"/>Window shutters</label>
      <label class="workshop-check"><input type="checkbox" data-shape-field="craft"/>Chimney &amp; planted window boxes</label>
      <label class="workshop-check"><input type="checkbox" data-shape-field="chimney"/>Chimney</label>
      <label class="workshop-check"><input type="checkbox" data-shape-field="windowBoxes"/>Planted window boxes</label>
      ${range('ivyDensity', 'Ivy density', 0, 1, 0.05)}
      ${select('interior', 'Interior finish', [['auto', 'Automatic'], ['none', 'No interior finish'], ['paving', 'Paving'], ['bench', 'Paving and wall bench']])}
      ${range('levels', 'Floors', 1, 6, 1)}
      ${select('footprint', 'Footprint', [
        ['rounded', 'Rounded rectangle'],
        ['oval', 'Oval'],
        ['custom', 'Custom outline'],
      ])}
      ${range('width', 'Width', 2, 16, 0.1)}${range('depth', 'Depth', 2, 12, 0.1)}
      ${range('radius', 'Corner radius', 0, 3, 0.05)}${range('taper', 'Top width', 0.65, 1.2, 0.01)}
      ${select(
        'roof-family',
        'Roof shape',
        SHAPE_ROOF_FAMILIES.map((f) => [
          f,
          {
            hip: 'Hipped pavilion',
            gable: 'Swept gable',
            bell: 'Bell roof',
            cone: 'Cone',
            spire: 'Slender spire',
            flat: 'Flat terrace',
          }[f],
        ]),
      )}
      ${range('roof-rise', 'Roof height', 0.2, 8, 0.1)}${range('roof-overhang', 'Roof overhang', 0.05, 1.5, 0.05)}
      ${select('roof-axis', 'Ridge direction', [['width', 'Along width'], ['depth', 'Along depth']])}
      ${range('roof-sweep', 'Roof sweep', 0, 1, 0.05)}${range('roof-sag', 'Ridge sag', 0, 0.5, 0.02)}
      <label class="workshop-check"><input type="checkbox" data-shape-field="supports"/>Automatic supports</label>
    </div>
    <div class="workshop-shape-fields" data-shape-section="curve">
      ${range('length', 'Length', 2, 16, 0.1)}${range('bend', 'Curve bend', -10, 10, 0.1)}
    </div>
    <div class="workshop-shape-fields" data-shape-section="fortification">
      ${select('base-style', 'Wall footing', [['none', 'Plain'], ['batter', 'Battered (flared)'], ['plinth', 'Stepped plinth']])}
      ${range('base-height', 'Footing height', 0.2, 6, 0.1)}${range('base-out', 'Footing spread', 0, 2, 0.05)}
      ${range('stage-at', 'Setback height', 0.3, 24, 0.1)}${range('stage-out', 'Setback amount', -1, 1, 0.02)}
      ${select('crown-style', 'Crown', [['none', 'No crown'], ['parapet', 'Flush battlement'], ['corbelled', 'Projecting corbelled crown']])}
      ${range('crown-projection', 'Crown projection', 0.1, 1.5, 0.05)}${range('crown-height', 'Parapet height', 0.2, 3, 0.05)}
      ${range('crown-corbelSpacing', 'Corbel spacing', 0.35, 3, 0.05)}${range('crown-corbelDrop', 'Corbel height', 0.3, 2.5, 0.05)}
      ${select('crown-arcade', 'Corbel arcade', [['round', 'Round arches'], ['pointed', 'Pointed arches'], ['none', 'Flat lintels']])}
      ${select('crown-machicolation', 'Machicolations', [['decorative', 'Decorative (closed floor)'], ['open', 'Open murder holes'], ['none', 'Blind arcade']])}
      ${select('crown-merlons', 'Battlements', [['square', 'Square merlons'], ['pierced', 'Pierced merlons'], ['stepped', 'Stepped merlons'], ['none', 'Plain parapet']])}
      ${range('crown-merlonWidth', 'Merlon width', 0.3, 3, 0.05)}${range('crown-merlonGap', 'Embrasure width', 0.2, 3, 0.05)}
      ${range('crown-merlonHeight', 'Merlon height', 0.3, 2.5, 0.05)}${range('crown-ruin', 'Ruined battlements', 0, 1, 0.05)}
      ${select('crown-sides', 'Battlement sides', [['outer', 'Outer face'], ['both', 'Both faces']])}
    </div>
    <div class="workshop-shape-fields" data-shape-section="traversal">
      ${range('path-width', 'Path width', 0.6, 4, 0.1)}${range('rise', 'End height difference', 0, 6, 0.1)}
      ${select('mode', 'Path treatment', [
        ['auto', 'Automatic'],
        ['walkway', 'Walkway'],
        ['ramp', 'Ramp'],
        ['stairs', 'Stairs'],
        ['bridge', 'Arched bridge'],
      ])}
      ${select('support', 'Supports', [
        ['piers', 'Stone piers'],
        ['arch', 'Arch with end piers'],
        ['none', 'No supports'],
      ])}
      <label class="workshop-check"><input type="checkbox" data-shape-field="railing"/>Railings</label>
    </div>
    <div data-shape-section="openings">
      <label>Opening<select data-shape-action="opening"></select></label>
      <div class="workshop-shape-actions"><button type="button" data-shape-action="add-door">+ Door</button><button type="button" data-shape-action="add-window">+ Window</button><button type="button" data-shape-action="add-arch">+ Arch</button><button type="button" data-shape-action="add-slit">+ Arrow slit</button><button type="button" data-shape-action="remove-opening">Remove opening</button></div>
      <div class="workshop-shape-fields" data-shape-section="opening-fields">
        ${select('opening-profile', 'Opening shape', [
          ['arched', 'Round arch'],
          ['square', 'Square lintel'],
          ['pointed', 'Pointed (Gothic) arch'],
        ])}
        ${range('opening-at', 'Along wall', 0, 0.99, 0.01)}${range('opening-bottom', 'Opening bottom', 0, 5, 0.05)}
        ${range('opening-width', 'Opening width', 0.1, 3, 0.05)}${range('opening-height', 'Opening height', 0.3, 4, 0.05)}
        ${select('opening-shutterPose', 'Shutter pose', [['auto', 'Natural variation'], ['open', 'Open'], ['ajar', 'Ajar'], ['closed', 'Closed']])}
      </div>
    </div>
    ${shapeFeatureMarkup()}
    ${shapeDetailMarkup()}
    <div class="workshop-shape-fields" data-shape-section="style">${['floor', 'trim', 'supports', 'railing'].map((field) => select(`style-${field}`, `${field[0].toUpperCase()}${field.slice(1)} material`, [['auto', 'Inherit from connected shape'], ['stone', 'Stone'], ['timber', 'Timber']])).join('')}</div>
    ${shapeGateMarkup()}
    <p class="workshop-shape-hint">Click a shape to select it. Pull its gold handles to move, resize, round corners, or lift the roof. Escape cancels a drag.</p>
  </section>`;
}

export function shapeFieldValue(p, field, opening) {
  if (['chimney', 'windowBoxes'].includes(field)) return p.craft && p[field];
  if (field.startsWith('style-')) return p.style[field.slice(6)] ?? 'auto';
  if (field.startsWith('base-') || field.startsWith('crown-')) return p[field.split('-')[0]]?.[field.split('-')[1]];
  // Undefined on walls and paths, which have no setbacks; volumes show stage 0 or its would-be defaults.
  if (field.startsWith('stage-')) return p.stages && (field === 'stage-at' ? p.stages[0]?.at ?? p.height * 0.6 : p.stages[0]?.out ?? 0);
  const fields = {
    x: p.position[0],
    z: p.position[1],
    width: p.footprint?.width,
    depth: p.footprint?.depth,
    radius: p.footprint?.cornerRadius,
    footprint: p.footprint?.family,
    'path-width': p.width,
    'roof-family': p.roof?.family,
    'roof-rise': p.roof?.rise,
    'roof-overhang': p.roof?.overhang,
    'roof-sweep': p.roof?.sweep,
    'roof-sag': p.roof?.sag,
    supports: !p.suppressed?.some((key) => key.startsWith(`support:${p.id}:`)),
  };
  if (field.startsWith('opening-')) return opening?.[field.slice(8)];
  return fields[field] ?? p[field];
}

export function shapeFieldChanges(p, field, value, openingId) {
  if (['chimney', 'windowBoxes'].includes(field)) return { craft: true, ...(p.craft ? {} : { chimney: false, windowBoxes: false }), [field]: value };
  if (field.startsWith('style-')) {
    const style = { ...p.style }, key = field.slice(6);
    if (value === 'auto') delete style[key]; else style[key] = value;
    return { style };
  }
  if (!shapeFieldEditable(p, field)) throw new Error('This custom outline does not support that resize.');
  if (field === 'height') return adaptShapeHeight(p, value);
  if (field === 'x' || field === 'z')
    return {
      position: p.position.map((v, i) => (i === (field === 'x' ? 0 : 1) ? value : v)),
    };
  if (field === 'supports')
    return {
      suppressed: value
        ? p.suppressed.filter((key) => !key.startsWith(`support:${p.id}:`))
        : [...p.suppressed, ...[0, 1, 2, 3].map((i) => `support:${p.id}:corner-${i}`)],
    };
  if (['width', 'depth', 'radius', 'footprint'].includes(field)) {
    const f = {
      ...p.footprint,
      [{
        width: 'width',
        depth: 'depth',
        radius: 'cornerRadius',
        footprint: 'family',
      }[field]]: value,
    };
    f.cornerRadius = Math.min(f.cornerRadius, Math.min(f.width, f.depth) / 2);
    return { footprint: f, thickness: Math.min(p.thickness, Math.min(f.width, f.depth) / 5) };
  }
  if (field.startsWith('roof-'))
    return {
      roof: {
        ...p.roof,
        [field.slice(5) === 'family' ? 'family' : field.slice(5)]: value,
      },
    };
  if (field.startsWith('base-') || field.startsWith('crown-')) {
    const [group, key] = field.split('-');
    return { [group]: { ...p[group], [key]: value } };
  }
  if (field.startsWith('stage-')) {
    const stages = [...p.stages];
    // A zero setback is no setback: drop stage 0 rather than keep an empty profile break.
    if (field === 'stage-out' && Math.abs(value) < 1e-6) stages.shift();
    else stages[0] = { at: p.height * 0.6, out: 0, ...stages[0], [field.slice(6)]: value };
    return { stages };
  }
  if (field.startsWith('opening-'))
    return {
      openings: p.openings.map((o) => (o.id === openingId ? { ...o, [field.slice(8)]: value } : o)),
    };
  return { [field === 'path-width' ? 'width' : field]: value };
}
