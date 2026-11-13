import { WorkshopShapeSession } from './WorkshopShapeSession.js';
import { createShapePreset, createShapePrimitive } from './ShapePresets.js';
import { workshopShapeMarkup, shapeFieldValue, shapeFieldChanges } from './WorkshopShapeFields.js';
import './workshopShapes.css';
import { syncShapeGateControls, applyShapeGateAction } from './ShapeGateControls.js';
import { shapeFieldLimits, shapeFieldEditable } from './ShapeEditConstraints.js';
import { syncShapeFeatureControls, applyShapeFeatureAction, applyShapeFeatureInput } from './ShapeFeatureControls.js';
import { syncShapeDetailControls, applyShapeDetailAction, applyShapeDetailInput } from './ShapeDetailControls.js';
import { WorkshopShapeInspector } from './WorkshopShapeInspector.js';

export class WorkshopShapeEditor {
  constructor({ form, onChange, onStatus }) {
    this.form = form;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.session = new WorkshopShapeSession();
    this.resolvedPlans = new Map();
    this.selectedId = 'cottage';
    this.openingId = 'door';
    this.active = false;
    form
      .querySelector('[data-workshop-field="variant"]')
      .insertAdjacentHTML('afterend', workshopShapeMarkup());
    this.root = form.querySelector('[data-role="shape-editor"]');
    this.inspector = new WorkshopShapeInspector(this);
    this.listeners = [];
    this.listen('input', (e) => this.input(e, true));
    this.listen('change', (e) => this.input(e, false));
    this.listen('click', (e) => this.action(e));
    this.sync();
  }
  listen(type, listener) {
    this.root.addEventListener(type, listener);
    this.listeners.push([type, listener]);
  }
  get primitive() {
    return this.session.getPrimitive(this.selectedId);
  }
  setActive(active) {
    this.active = active;
    this.root.hidden = !active;
    if (!active) this.session.cancel();
    this.sync();
  }
  select(id) {
    this.selectedId = id;
    this.sync();
    this.onSelection?.(id);
  }
  changed({ frame = false } = {}) {
    this.sync();
    this.onChange?.({ frame });
  }
  input(event, preview) {
    event.stopPropagation();
    if (event.target.type === 'number' && (event.target.value === '' || !event.target.validity.valid)) {
      if (!preview) { this.session.cancel(); event.target.blur(); this.sync(); }
      return;
    }
    try {
      if (applyShapeFeatureInput(this, event, preview) || applyShapeDetailInput(this, event, preview)) return;
    } catch (error) {
      this.session.cancel(); this.sync(); this.onStatus?.(error.message, true); return;
    }
    const action = event.target.dataset.shapeAction;
    if (action) {
      if (preview) return;
      if (action === 'preset') {
        this.inspector.show('building');
        this.session.replace(createShapePreset(event.target.value));
        this.select(this.session.primitives[0].id);
        this.changed({ frame: true });
      }
      if (action === 'select') this.select(event.target.value);
      if (action === 'opening') {
        this.openingId = event.target.value;
        this.inspector.show('opening');
        this.sync();
        this.onSelection?.(this.selectedId);
      }
      if (action === 'gate-select') {
        this.gateKey = event.target.value;
        this.sync();
      }
      return;
    }
    const field = event.target.dataset.shapeField ?? event.target.dataset.shapeNumber,
      p = this.primitive;
    if (!field || !p || event.target.disabled) return;
    try {
      this.session.begin('Reshape construction');
      const value =
        event.target.type === 'checkbox'
          ? event.target.checked
          : ['range', 'number'].includes(event.target.type)
            ? Number(event.target.value)
            : event.target.value;
      this.session.update(p.id, shapeFieldChanges(p, field, value, this.openingId));
      if (!preview) this.session.commit();
      this.changed();
    } catch (error) {
      this.session.cancel();
      this.sync();
      this.onStatus?.(error.message, true);
    }
  }
  action(event) {
    const action = event.target.closest('button[data-shape-action]')?.dataset.shapeAction;
    if (!action) return;
    event.stopPropagation();
    try {
      this.session.commit();
      if (action === 'undo') this.session.undo();
      else if (action === 'redo') this.session.redo();
      else if (applyShapeDetailAction(this, action)) {
        /* Generated output override applied. */
      }
      else if (applyShapeFeatureAction(this, action)) {
        /* Host-local architectural intent applied. */
      }
      else if (applyShapeGateAction(this, action)) {
        /* Semantic gate override applied. */
      } else if (action === 'remove') {
        if (this.session.primitives.length > 1) this.session.remove(this.selectedId);
      } else if (
        action.startsWith('add-') &&
        ['volume', 'wall', 'path'].includes(action.slice(4))
      ) {
        const kind = {
          'add-volume': 'curved-volume',
          'add-wall': 'curved-wall',
          'add-path': 'traversal',
        }[action];
        let n = 1;
        while (this.session.getPrimitive(`shape-${n}`)) n++;
        const p = createShapePrimitive(kind, `shape-${n}`);
        this.session.add(p);
        this.select(p.id);
      } else if (action.startsWith('add-') && this.primitive?.openings) {
        const p = this.primitive,
          role = action.slice(4);
        let n = 1;
        while (p.openings.some((o) => o.id === `opening-${n}`)) n++;
        this.openingId = `opening-${n}`;
        this.session.update(p.id, {
          openings: [
            ...p.openings,
            {
              id: this.openingId,
              role,
              at: 0.6,
              ...(role === 'slit' ? { profile: 'square' } : {}),
              bottom: role === 'slit' ? Math.min(1.2, p.height - 1) : role === 'window' ? Math.min(1, p.height - 0.5) : 0,
              width: role === 'slit' ? 0.14 : 1,
              height: Math.min(role === 'window' ? 1.2 : role === 'slit' ? 1.3 : 2.1, p.height),
            },
          ],
        });
      } else if (action === 'remove-opening') {
        this.session.update(this.selectedId, {
          openings: this.primitive.openings.filter((o) => o.id !== this.openingId),
        });
      }
      this.changed();
    } catch (error) {
      this.onStatus?.(error.message, true);
    }
  }
  sync() {
    const primitives = this.session.primitives;
    if (!primitives.some((p) => p.id === this.selectedId)) this.selectedId = primitives[0]?.id;
    const select = this.root.querySelector('[data-shape-action="select"]');
    select.replaceChildren();
    for (const p of primitives) {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.label;
      select.append(option);
    }
    select.value = this.selectedId;
    const p = this.primitive;
    if (!p) return;
    const volume = p.kind === 'curved-volume',
      traversal = p.kind === 'traversal';
    for (const [section, visible] of Object.entries({
      wall: !traversal,
      volume,
      curve: !volume,
      traversal,
      openings: !traversal,
      fortification: !traversal,
    })) {
      this.root.querySelector(`[data-shape-section="${section}"]`).hidden = !visible;
    }
    const openings = p.openings ?? [];
    if (!openings.some((o) => o.id === this.openingId)) this.openingId = openings[0]?.id;
    const openingSelect = this.root.querySelector('[data-shape-action="opening"]');
    openingSelect.replaceChildren();
    for (const o of openings) {
      const option = document.createElement('option');
      option.value = o.id;
      option.textContent = `${o.role} · ${o.id}`;
      openingSelect.append(option);
    }
    openingSelect.value = this.openingId ?? '';
    this.root.querySelector('[data-shape-section="opening-fields"]').hidden = !this.openingId;
    const opening = openings.find((o) => o.id === this.openingId);
    this.root.querySelector('[data-shape-field="opening-shutterPose"]').closest('label').hidden = opening?.role !== 'window' || !p.shutters;
    for (const element of this.root.querySelectorAll('[data-shape-field], [data-shape-number]')) {
      const field = element.dataset.shapeField ?? element.dataset.shapeNumber,
        value = shapeFieldValue(p, field, opening),
        [group, key] = field.split('-'),
        crown = p.crown?.style;
      // Before the undefined skip: walls have no stages, so their setback labels must still be hidden.
      if (['base', 'crown', 'stage'].includes(group))
        element.closest('label').hidden = group === 'stage' ? !volume : key !== 'style' && (group === 'base'
          ? p.base?.style === 'none'
          : crown === 'none' || (key === 'sides' && volume) ||
            (['projection', 'corbelSpacing', 'corbelDrop', 'arcade', 'machicolation'].includes(key) && crown !== 'corbelled'));
      if (value === undefined) continue;
      if (field === 'radius') {
        element.max = Math.min(p.footprint.width, p.footprint.depth) / 2;
        element.closest('label').hidden = p.footprint.family !== 'rounded';
      }
      const limits = shapeFieldLimits(p, field);
      if (limits && ['range', 'number'].includes(element.type)) [element.min, element.max] = limits.map(String);
      element.disabled = !shapeFieldEditable(p, field);
      if (field === 'footprint') element.querySelector('[value="custom"]').disabled = value !== 'custom';
      if (element.type === 'checkbox') element.checked = value === true;
      else if (!(element.type === 'number' && element === document.activeElement)) element.value = String(value);
      const output = this.root.querySelector(`[data-shape-output="${field}"]`);
      if (output) output.value = Number(value).toFixed(2);
    }
    this.root.querySelector('[data-shape-action="undo"]').disabled = !this.session.history.canUndo;
    this.root.querySelector('[data-shape-action="redo"]').disabled = !this.session.history.canRedo;
    this.root.querySelector('[data-shape-action="remove"]').disabled = primitives.length <= 1;
    this.root.querySelector('[data-shape-action="remove-opening"]').disabled = !this.openingId;
    syncShapeGateControls(this);
    syncShapeFeatureControls(this);
    syncShapeDetailControls(this);
    this.inspector.sync();
  }
  captureRuntimeState() {
    return {
      session: this.session.captureRuntimeState(),
      selectedId: this.selectedId,
      openingId: this.openingId,
      featureId: this.featureId,
      detailId: this.detailId,
      curveEditing: this.curveEditing,
      inspectorContext: this.inspector.context,
    };
  }
  restoreRuntimeState(state) {
    this.session.restoreRuntimeState(state.session);
    this.selectedId = state.selectedId;
    this.openingId = state.openingId;
    this.featureId = state.featureId;
    this.detailId = state.detailId;
    this.curveEditing = state.curveEditing;
    this.inspector.context = state.inspectorContext ?? 'building';
    this.sync();
  }
  dispose() {
    this.session.dispose();
    this.inspector.dispose();
    for (const [type, listener] of this.listeners) this.root.removeEventListener(type, listener);
  }
}
