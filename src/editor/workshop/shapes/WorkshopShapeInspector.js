import { createShapeWallSurface } from './ShapeWallSurface.js';
import { shapeShutterLeafFits } from './ShapeShutterBuilder.js';

const CONTEXTS = [['building', 'Shape'], ['roof', 'Roof'], ['opening', 'Openings'], ['feature', 'Features'], ['details', 'Dressing'], ['all', 'Advanced']];
const SECTION_CONTEXT = { common: 'building', wall: 'building', curve: 'building', traversal: 'building', fortification: 'building',
  openings: 'opening', features: 'feature', details: 'details', style: 'details' };
const unit = field => field === 'rotation' ? '°' : ['at', 'opening-at', 'age', 'ivyDensity', 'taper', 'crown-ruin'].includes(field)
  ? 'ratio' : field === 'levels' ? 'floors' : 'm';

/** Context affects presentation only; authored edits still go through the semantic session. */
export class WorkshopShapeInspector {
  constructor(editor) {
    this.editor = editor; this.context = 'building';
    const root = editor.root;
    const nav = document.createElement('div'); nav.className = 'workshop-inspector-tabs'; nav.setAttribute('role', 'tablist'); nav.setAttribute('aria-label', 'Construction properties');
    for (const [context, label] of CONTEXTS) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.inspectorContext = context;
      button.textContent = label; button.setAttribute('role', 'tab'); nav.append(button);
    }
    root.querySelector('.workshop-shape-fields').before(nav);
    for (const [section, context] of Object.entries(SECTION_CONTEXT)) {
      const node = root.querySelector(`[data-shape-section="${section}"]`); if (node) node.dataset.inspectorScope = context;
    }
    for (const label of root.querySelectorAll('[data-shape-section="volume"] > label')) {
      const field = label.querySelector('[data-shape-field]')?.dataset.shapeField;
      label.dataset.inspectorScope = field?.startsWith('roof-') ? 'roof' : ['craft', 'chimney', 'windowBoxes', 'interior', 'ivyDensity'].includes(field) ? 'details' : 'building';
    }
    for (const range of root.querySelectorAll('input[type="range"]')) {
      const number = document.createElement('input'); number.type = 'number'; number.className = 'workshop-exact-value';
      for (const key of ['min', 'max', 'step']) number[key] = range[key];
      number.dataset.numericStep = range.step; number.step = 'any';
      const field = range.dataset.shapeField ?? range.dataset.featureField;
      number.dataset[range.dataset.shapeField ? 'shapeNumber' : 'featureNumber'] = field;
      const label = range.closest('label').firstChild.textContent.trim();
      number.setAttribute('aria-label', `${label} (${unit(field)})`);
      const suffix = document.createElement('span'); suffix.className = 'workshop-unit'; suffix.textContent = unit(field);
      range.after(number, suffix);
      const output = range.parentElement.querySelector('output'); if (output) output.classList.add('workshop-sr-only');
    }
    this.note = document.createElement('p'); this.note.className = 'workshop-shape-hint'; this.note.dataset.role = 'inspector-explanation'; this.note.setAttribute('aria-live', 'polite'); root.append(this.note);
    this.click = event => { const context = event.target.closest('[data-inspector-context]')?.dataset.inspectorContext;
      if (context) { event.stopPropagation(); this.show(context); } };
    this.key = event => {
      if (event.key === 'Escape' && editor.session.transaction) {
        event.preventDefault(); event.stopPropagation(); editor.session.cancel();
        if (event.target.type === 'number') { event.target.value = ''; event.target.blur(); }
        editor.changed();
        return;
      }
      const number = event.target;
      if (number.type !== 'number' || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const baseStep = Number(number.dataset.numericStep || 1), step = baseStep * (event.shiftKey && baseStep < 1 ? 0.1 : 1), delta = event.key === 'ArrowUp' ? step : -step;
      number.value = String(Math.round(Math.min(Number(number.max), Math.max(Number(number.min), Number(number.value) + delta)) * 1e6) / 1e6);
      number.dispatchEvent(new Event('input', { bubbles: true })); number.dispatchEvent(new Event('change', { bubbles: true }));
    };
    root.addEventListener('click', this.click); root.addEventListener('keydown', this.key);
  }
  show(context) {
    this.context = context; this.sync();
  }
  sync() {
    const { editor } = this, root = editor.root;
    for (const button of root.querySelectorAll('[data-inspector-context]')) button.setAttribute('aria-selected', String(button.dataset.inspectorContext === this.context));
    for (const scope of root.querySelectorAll('[data-inspector-scope]')) scope.dataset.inspectorVisible = String(this.context === 'all' || scope.dataset.inspectorScope === this.context);
    root.querySelector('[data-shape-field="craft"]').closest('label').hidden = this.context !== 'all';
    const p = editor.primitive, plan = editor.resolvedPlans.get(p?.id), opening = plan?.openings?.find(o => o.id === editor.openingId);
    let text = '';
    if (this.context === 'opening' && p?.shutters && opening?.role === 'window') {
      const surface = createShapeWallSurface(plan);
      if ([-1, 1].some(side => !shapeShutterLeafFits(plan, surface, opening, side))) text = 'The wall return or a nearby opening limits these shutters. Ajar and closed poses fit here.';
    } else if (this.context === 'details' && plan) {
      const detail = plan.decorations?.find(d => d.id === editor.detailId);
      const style = plan.resolvedStyle;
      text = detail ? `${detail.role.replaceAll('-', ' ')} · ${detail.provenance?.source === 'promoted' ? 'Your placement' : 'Automatic placement'}. Hide or reset this detail below.` : '';
      if (style) text += ` Floor: ${style.values.floor}${style.sources.floor !== p.id ? ' (inherited)' : ' (local)'}.`;
    }
    this.note.textContent = text; this.note.hidden = !text;
  }
  dispose() { this.editor.root.removeEventListener('click', this.click); this.editor.root.removeEventListener('keydown', this.key); }
}
