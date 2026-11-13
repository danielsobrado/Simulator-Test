import { SHAPE_FEATURES } from './ShapeFeatureSchema.js';

export function shapeFeatureMarkup() {
  const range = (field, label, min, max, step) => `<label>${label}<input type="range" data-feature-field="${field}" min="${min}" max="${max}" step="${step}"/><output data-feature-output="${field}"></output></label>`;
  return `<div data-shape-section="features"><label>Architectural feature<select data-shape-action="feature-select"></select></label>
    <div class="workshop-shape-actions">${SHAPE_FEATURES.map((f) => `<button type="button" data-shape-action="feature-add-${f.kind}">+ ${f.label}</button>`).join('')}<button type="button" data-shape-action="feature-remove">Remove feature</button></div>
    <div class="workshop-shape-fields" data-role="feature-fields">${range('at', 'Along wall', 0, 1, 0.01)}${range('width', 'Feature width', 0.6, 8, 0.1)}${range('depth', 'Projection', 0.25, 4, 0.05)}${range('height', 'Feature height', 0.5, 16, 0.1)}${range('bottom', 'Feature bottom', 0, 24, 0.05)}
      <label>Turret roof<select data-feature-choice="roof">${[['cone', 'Cone'], ['spire', 'Slender spire'], ['bell', 'Bell'], ['flat', 'Open battlemented top']].map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label></div></div>`;
}

export function syncShapeFeatureControls(editor) {
  const p = editor.primitive, section = editor.root.querySelector('[data-shape-section="features"]');
  section.hidden = !p?.features;
  if (!p?.features) return;
  if (!p.features.some((f) => f.id === editor.featureId)) editor.featureId = p.features[0]?.id;
  const select = section.querySelector('[data-shape-action="feature-select"]');
  select.replaceChildren(...p.features.map((f) => {
    const option = document.createElement('option'); option.value = f.id;
    option.textContent = `${SHAPE_FEATURES.find((t) => t.kind === f.kind).label} · ${f.id}`; return option;
  }));
  select.value = editor.featureId ?? '';
  const feature = p.features.find((f) => f.id === editor.featureId);
  section.querySelector('[data-role="feature-fields"]').hidden = !feature;
  section.querySelector('[data-shape-action="feature-remove"]').disabled = !feature;
  section.querySelector('[data-shape-action="feature-add-jetty"]').disabled = p.features.some((f) => f.kind === 'jetty');
  for (const element of section.querySelectorAll('[data-feature-field], [data-feature-number]')) {
    const field = element.dataset.featureField ?? element.dataset.featureNumber;
    if (!(element.type === 'number' && element === document.activeElement)) element.value = String(feature?.[field] ?? element.min);
    section.querySelector(`[data-feature-output="${field}"]`).value = Number(element.value).toFixed(2);
    element.closest('label').hidden = (feature?.kind === 'jetty' && field !== 'depth') ||
      (field === 'bottom' && ['porch', 'dormer', 'buttress'].includes(feature?.kind)) || (field === 'depth' && feature?.kind === 'turret');
  }
  const roof = section.querySelector('[data-feature-choice="roof"]');
  roof.closest('label').hidden = feature?.kind !== 'turret';
  if (feature?.roof) roof.value = feature.roof;
}

export function applyShapeFeatureInput(editor, event, preview) {
  if (event.target.dataset.shapeAction === 'feature-select') {
    if (!preview) { editor.featureId = event.target.value; editor.inspector?.show('feature'); editor.sync(); editor.onSelection?.(editor.selectedId); }
    return true;
  }
  const choice = event.target.dataset.featureChoice, field = event.target.dataset.featureField ?? event.target.dataset.featureNumber ?? choice;
  if (!field) return false;
  const p = editor.primitive;
  editor.session.begin('Reshape architectural feature');
  editor.session.update(p.id, { features: p.features.map((f) => f.id === editor.featureId ? { ...f, [field]: choice ? event.target.value : Number(event.target.value) } : f) });
  if (!preview) editor.session.commit();
  editor.changed(); return true;
}

export function applyShapeFeatureAction(editor, action) {
  const p = editor.primitive;
  if (!action.startsWith('feature-')) return false;
  if (action === 'feature-remove') editor.session.update(p.id, { features: p.features.filter((f) => f.id !== editor.featureId) });
  else if (action.startsWith('feature-add-')) {
    const kind = action.slice(12); let n = 1;
    while (p.features.some((f) => f.id === `${kind}-${n}`)) n++;
    editor.featureId = `${kind}-${n}`;
    const opening = p.openings.find((o) => o.id === editor.openingId);
    editor.session.update(p.id, { features: [...p.features, { id: editor.featureId, kind, at: opening?.at ?? 0.5,
      width: ['porch', 'balcony'].includes(kind) ? 2.6 : 2, depth: kind === 'jetty' ? 0.4 : 1.4, height: kind === 'porch' ? 2.5 : kind === 'balcony' ? 1.05 : 1.8,
      bottom: opening?.bottom ?? 0.9,
      ...(kind === 'turret' ? { width: 2.2, depth: 1.4, height: 4.2, bottom: Math.max(0, p.height - 1.6), roof: 'cone' } : {}) }] });
  }
  return true;
}
