import './workshopRadialMenus.css';
import { escapeAttribute } from '../ui/markup.js';
import { loadWorkshopRadialMenuConfig } from './WorkshopRadialMenuConfig.js';
import {
  arcSlot,
  circularOffset,
  consumeSteppedDelta,
  wheelDeltaPixels,
  wrapIndex,
} from './WorkshopRadialMenuMath.js';

export { arcSlot, wrapIndex } from './WorkshopRadialMenuMath.js';

const SELECTORS = Object.freeze({
  overlay: '[data-role="workshop-overlay"]',
  preview: '.workshop-preview',
  form: '[data-role="workshop-form"]',
  status: '[data-role="workshop-status"]',
  materialUi: '[data-role="workshop-material-ui"]',
  materialButton: '[data-workshop-action="material"]',
  materialPreset: '[data-material-field="presetId"]',
  legacyMaterialPalette: '.radial-palette--workshop',
});

const MATERIAL_AREA_SOURCES = new Set(['materialPresets', 'materialMaps', 'colorField']);
const ACTION_SOURCES = new Set(['materialMaps', 'toggles']);
const TOUCH_POINTER_TYPES = new Set(['touch', 'pen']);
const CLICK_SUPPRESSION_MS = 260;
const DRAG_CLICK_DISTANCE_PX = 6;
const DRAG_VISUAL_RANGE_PX = 8;

function eventFor(name) {
  return new Event(name, { bubbles: true });
}

function firstElement(value) {
  if (!value) return null;
  if (typeof RadioNodeList !== 'undefined' && value instanceof RadioNodeList) return value[0] ?? null;
  return value;
}

function itemsSignature(items) {
  return items.map(({ value, label, glyph, color }) => (
    `${value}\u0000${label}\u0000${glyph}\u0000${color}`
  )).join('\u0001');
}

function itemSwatch(lane, item) {
  return item.color || (lane.source === 'colorField' ? item.value : '');
}

function isElement(value) {
  return typeof Element !== 'undefined' && value instanceof Element;
}

export class WorkshopRadialMenus {
  constructor(overlay, config) {
    this.overlay = overlay;
    this.config = config;
    this.preview = overlay.querySelector(SELECTORS.preview);
    this.form = overlay.querySelector(SELECTORS.form);
    this.status = overlay.querySelector(SELECTORS.status);
    this.materialUi = overlay.querySelector(SELECTORS.materialUi);
    if (!this.preview || !this.form || !this.materialUi) {
      throw new Error('Workshop radial menus could not find the workbench controls.');
    }

    this.modeId = config.defaultMode;
    this.laneViews = new Map();
    this.wheelResiduals = new Map();
    this.lastWheelAt = new Map();
    this.pointerGestures = new Map();
    this.suppressClickUntil = 0;
    this.syncFrame = 0;
    this.readoutTimer = 0;
    this.watchedFormFields = new Set();
    for (const mode of config.modes) {
      for (const lane of mode.lanes) {
        if (lane.field) this.watchedFormFields.add(lane.field);
        if (lane.source === 'toggles') {
          lane.items.forEach(({ value }) => this.watchedFormFields.add(value));
        }
      }
    }

    this.host = document.createElement('div');
    this.host.className = 'workshop-radial-menus';
    this.host.dataset.role = 'workshop-radial-menus';
    this.host.innerHTML = `
      <div class="workshop-radial-menus__lanes" data-role="radial-lanes"></div>
      <div class="workshop-radial-menus__readout" data-role="radial-readout" hidden>
        <strong></strong><span></span>
      </div>
      <div class="workshop-radial-menus__mode-title" data-role="radial-mode-title"></div>
      <div class="workshop-radial-menus__modes" data-role="radial-modes"
        role="toolbar" aria-label="Workbench radial menu categories"></div>
    `;
    this.preview.append(this.host);
    this.overlay.classList.add('has-workshop-radial-menus');
    this.lanesHost = this.host.querySelector('[data-role="radial-lanes"]');
    this.modesHost = this.host.querySelector('[data-role="radial-modes"]');
    this.modeTitle = this.host.querySelector('[data-role="radial-mode-title"]');
    this.readout = this.host.querySelector('[data-role="radial-readout"]');
    this.readoutLane = this.readout.querySelector('strong');
    this.readoutItem = this.readout.querySelector('span');

    this.onClick = (event) => this.handleClick(event);
    this.onWheel = (event) => this.handleWheel(event);
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerMove = (event) => this.handlePointerMove(event);
    this.onPointerUp = (event) => this.finishPointerGesture(event);
    this.onPointerCancel = (event) => this.finishPointerGesture(event, { cancelled: true });
    this.onPointerOver = (event) => this.handlePointerOver(event);
    this.onPointerOut = (event) => this.handlePointerOut(event);
    this.onFocusIn = (event) => this.handleFocusIn(event);
    this.onFocusOut = (event) => this.handleFocusOut(event);
    this.onFormMutation = (event) => this.handleFormMutation(event);
    this.onMaterialChange = () => this.scheduleSync();

    this.host.addEventListener('click', this.onClick);
    this.host.addEventListener('wheel', this.onWheel, { passive: false });
    this.host.addEventListener('keydown', this.onKeyDown);
    this.host.addEventListener('pointerdown', this.onPointerDown);
    this.host.addEventListener('pointermove', this.onPointerMove);
    this.host.addEventListener('pointerup', this.onPointerUp);
    this.host.addEventListener('pointercancel', this.onPointerCancel);
    this.host.addEventListener('pointerover', this.onPointerOver);
    this.host.addEventListener('pointerout', this.onPointerOut);
    this.host.addEventListener('focusin', this.onFocusIn);
    this.host.addEventListener('focusout', this.onFocusOut);
    this.form.addEventListener('change', this.onFormMutation);
    this.form.addEventListener('input', this.onFormMutation);
    this.materialUi.addEventListener('change', this.onMaterialChange);

    this.materialObserver = new MutationObserver(() => {
      this.suppressLegacyPalette();
      if (this.activeMode()?.materialMode) this.ensureMaterialMode(true);
      this.scheduleSync();
    });
    this.materialObserver.observe(this.materialUi, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });

    this.renderModeButtons();
    this.activateMode(this.modeId, { initial: true });
  }

  activeMode() {
    return this.config.modes.find(({ id }) => id === this.modeId) ?? this.config.modes[0];
  }

  renderModeButtons() {
    this.modesHost.innerHTML = this.config.modes.map((mode) => (
      `<button type="button" class="workshop-radial-menus__mode"`
      + ` data-radial-mode="${escapeAttribute(mode.id)}"`
      + ` aria-label="${escapeAttribute(mode.label)}" title="${escapeAttribute(mode.label)}"`
      + ` aria-pressed="false"><span aria-hidden="true">${escapeAttribute(
        mode.glyph || mode.label.slice(0, 1),
      )}</span></button>`
    )).join('');
  }

  syncModeButtons() {
    const mode = this.activeMode();
    for (const button of this.modesHost.querySelectorAll('[data-radial-mode]')) {
      const active = button.dataset.radialMode === mode?.id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    this.modeTitle.textContent = mode?.label ?? '';
  }

  activateMode(modeId, { initial = false } = {}) {
    const next = this.config.modes.find(({ id }) => id === modeId);
    if (!next) return;
    const previous = this.activeMode();
    this.modeId = next.id;
    this.wheelResiduals.clear();
    this.hideReadout();

    if (next.materialMode) {
      this.ensureMaterialMode(true);
      if (!initial) {
        this.setStatus('Material editing · select an area on the model, then use the radial controls.');
      }
    } else if (previous?.materialMode) {
      this.ensureMaterialMode(false);
    }

    this.syncModeButtons();
    this.renderActiveLanes();
    this.suppressLegacyPalette();
  }

  ensureMaterialMode(active) {
    const button = this.overlay.querySelector(SELECTORS.materialButton);
    if (!button) return;
    const current = button.classList.contains('is-active');
    if (current !== active) button.click();
  }

  setStatus(message, isError = false) {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.classList.toggle('is-error', isError);
  }

  suppressLegacyPalette() {
    const palette = this.materialUi.querySelector(SELECTORS.legacyMaterialPalette);
    if (!palette || palette.hidden) return;
    const hadFocus = palette.contains(document.activeElement);
    palette.hidden = true;
    if (hadFocus) {
      this.modesHost.querySelector(`[data-radial-mode="${CSS.escape(this.modeId)}"]`)
        ?.focus({ preventScroll: true });
    }
  }

  fieldElement(field) {
    return firstElement(this.form.elements.namedItem(field));
  }

  materialField(field) {
    return this.materialUi.querySelector(`[data-material-field="${CSS.escape(field)}"]`);
  }

  materialAreaReady() {
    return (this.materialUi.querySelector(SELECTORS.materialPreset)?.options.length ?? 0) > 0;
  }

  laneEnabled(lane) {
    return !MATERIAL_AREA_SOURCES.has(lane.source) || this.materialAreaReady();
  }

  selectedValue(lane, items) {
    if (lane.field) return String(this.fieldElement(lane.field)?.value ?? items[0]?.value ?? '');
    if (lane.source === 'materialPresets') {
      return String(this.materialUi.querySelector(SELECTORS.materialPreset)?.value ?? items[0]?.value ?? '');
    }
    if (lane.source === 'colorField') {
      return String(this.materialField(lane.target)?.value ?? items[0]?.value ?? '').toLowerCase();
    }
    return '';
  }

  resolveItems(lane) {
    if (lane.source === 'materialPresets') {
      const select = this.materialUi.querySelector(SELECTORS.materialPreset);
      const dynamic = [...(select?.options ?? [])].map((option) => ({
        value: option.value,
        label: option.textContent?.trim() || option.value,
        glyph: '',
        color: this.config.materialPresetColors[option.value] ?? '',
      }));
      const source = dynamic.length > 0 ? dynamic : lane.fallbackItems;
      return source.map((item) => ({
        ...item,
        color: item.color || this.config.materialPresetColors[item.value] || '',
      }));
    }
    return lane.items;
  }

  renderActiveLanes() {
    this.lanesHost.replaceChildren();
    this.laneViews.clear();
    const counts = { left: 0, right: 0 };
    for (const lane of this.activeMode()?.lanes ?? []) {
      const element = document.createElement('div');
      element.className = 'workshop-radial-menus__lane';
      element.dataset.radialLaneHost = lane.id;
      element.dataset.side = lane.side;
      element.style.setProperty('--radial-lane-offset', `${counts[lane.side] * 30}px`);
      element.style.setProperty('--radial-lane-offset-mobile', `${counts[lane.side] * 24}px`);
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', lane.label);
      counts[lane.side] += 1;

      const label = document.createElement('span');
      label.className = 'workshop-radial-menus__lane-label';
      label.textContent = lane.label;
      element.append(label);
      this.lanesHost.append(element);

      const view = {
        lane,
        element,
        label,
        buttons: new Map(),
        items: [],
        signature: '',
      };
      this.laneViews.set(lane.id, view);
      this.syncLane(view, { rebuild: true });
    }
  }

  rebuildLaneButtons(view, items) {
    for (const button of view.buttons.values()) button.remove();
    view.buttons.clear();
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'workshop-radial-menus__item is-outside';
      button.dataset.radialLane = view.lane.id;
      button.dataset.radialItem = item.value;
      button.setAttribute('aria-label', item.label);
      button.title = item.label;

      const swatch = itemSwatch(view.lane, item);
      const content = document.createElement('span');
      if (swatch) {
        content.className = 'workshop-radial-menus__swatch';
        content.style.setProperty('--radial-item-color', swatch);
      } else {
        content.className = 'workshop-radial-menus__glyph';
        content.textContent = item.glyph || item.label.slice(0, 1);
      }
      button.append(content);
      view.element.append(button);
      view.buttons.set(item.value, button);
    }
    view.items = items;
    view.signature = itemsSignature(items);
  }

  syncLane(view, { rebuild = false } = {}) {
    const { lane } = view;
    const items = this.resolveItems(lane);
    const signature = itemsSignature(items);
    if (rebuild || signature !== view.signature) this.rebuildLaneButtons(view, items);
    if (items.length === 0) return;

    const enabled = this.laneEnabled(lane);
    const selected = this.selectedValue(lane, items).toLowerCase();
    const selectedIndex = items.findIndex(({ value }) => value.toLowerCase() === selected);
    const centerIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const half = Math.floor(this.config.visibleSlots / 2);
    const sequence = !ACTION_SOURCES.has(lane.source);
    view.element.classList.toggle('is-disabled', !enabled);
    view.label.textContent = enabled ? lane.label : `${lane.label} · select area`;

    items.forEach((item, index) => {
      const button = view.buttons.get(item.value);
      if (!button) return;
      const offset = items.length <= this.config.visibleSlots
        ? index - (items.length - 1) / 2
        : circularOffset(index, centerIndex, items.length);
      const visible = items.length <= this.config.visibleSlots || Math.abs(offset) <= half;
      const slotIndex = items.length <= this.config.visibleSlots
        ? index
        : Math.round(offset + half);
      const edgeSlot = offset < 0 ? 0 : this.config.visibleSlots - 1;
      const slot = arcSlot(
        visible ? slotIndex : edgeSlot,
        items.length <= this.config.visibleSlots ? items.length : this.config.visibleSlots,
      );
      const active = enabled && (lane.source === 'toggles'
        ? this.fieldElement(item.value)?.checked === true
        : lane.source !== 'materialMaps' && item.value.toLowerCase() === selected);

      button.style.setProperty('--radial-y', `${slot.y}%`);
      button.style.setProperty('--radial-depth', `${slot.depth}px`);
      button.style.setProperty('--radial-scale', String(slot.scale));
      button.style.setProperty('--radial-opacity', String(slot.opacity));
      button.classList.toggle('is-outside', !visible);
      button.classList.toggle('is-active', active);
      button.disabled = !enabled;
      button.setAttribute('aria-hidden', visible ? 'false' : 'true');
      if (lane.source === 'materialMaps') {
        button.removeAttribute('aria-pressed');
      } else {
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      }
      if (!visible || !enabled) button.tabIndex = -1;
      else if (!sequence) button.tabIndex = 0;
      else button.tabIndex = active || (selectedIndex < 0 && index === centerIndex) ? 0 : -1;
    });
  }

  scheduleSync() {
    if (this.syncFrame !== 0) return;
    this.syncFrame = requestAnimationFrame(() => {
      this.syncFrame = 0;
      for (const view of this.laneViews.values()) this.syncLane(view);
      this.suppressLegacyPalette();
    });
  }

  laneById(laneId) {
    return this.activeMode()?.lanes.find(({ id }) => id === laneId) ?? null;
  }

  itemByValue(lane, value) {
    return this.resolveItems(lane).find((item) => item.value === value) ?? null;
  }

  showReadout(lane, item, { timed = false } = {}) {
    if (!lane || !item) return;
    window.clearTimeout(this.readoutTimer);
    this.readoutLane.textContent = lane.label;
    this.readoutItem.textContent = item.label;
    this.readout.hidden = false;
    if (timed) {
      this.readoutTimer = window.setTimeout(() => this.hideReadout(), this.config.readoutMs);
    }
  }

  hideReadout() {
    window.clearTimeout(this.readoutTimer);
    this.readoutTimer = 0;
    this.readout.hidden = true;
  }

  focusItem(laneId, value) {
    requestAnimationFrame(() => {
      this.laneViews.get(laneId)?.buttons.get(value)?.focus({ preventScroll: true });
    });
  }

  finishSelection(lane, value, focus) {
    this.scheduleSync();
    const item = this.itemByValue(lane, value);
    if (item) this.showReadout(lane, item, { timed: true });
    if (focus) this.focusItem(lane.id, value);
    return true;
  }

  applyLaneItem(lane, value, { focus = false } = {}) {
    if (!lane) return false;
    if (!this.laneEnabled(lane)) {
      this.setStatus('Select a material area on the model first.');
      return false;
    }

    if (lane.field) {
      const field = this.fieldElement(lane.field);
      if (!field) return false;
      if (String(field.value) !== String(value)) {
        field.value = value;
        field.dispatchEvent(eventFor(lane.event));
      }
      return this.finishSelection(lane, value, focus);
    }
    if (lane.source === 'materialPresets') {
      const select = this.materialUi.querySelector(SELECTORS.materialPreset);
      if (!select || select.options.length === 0) return false;
      if (select.value !== value) {
        select.value = value;
        select.dispatchEvent(eventFor('change'));
      }
      return this.finishSelection(lane, value, focus);
    }
    if (lane.source === 'colorField') {
      const field = this.materialField(lane.target);
      if (!field) return false;
      if (field.value.toLowerCase() !== value.toLowerCase()) {
        field.value = value;
        field.dispatchEvent(eventFor('change'));
      }
      return this.finishSelection(lane, value, focus);
    }
    if (lane.source === 'materialMaps') {
      const button = this.materialUi.querySelector(
        `[data-material-action="load-map"][data-source-kind="${CSS.escape(value)}"]`,
      );
      if (!button) return false;
      button.click();
      return this.finishSelection(lane, value, focus);
    }
    if (lane.source === 'toggles') {
      const field = this.fieldElement(value);
      if (!field) return false;
      field.checked = !field.checked;
      field.dispatchEvent(eventFor('change'));
      return this.finishSelection(lane, value, focus);
    }
    return false;
  }

  stepLane(lane, delta, { focus = false } = {}) {
    if (!lane || ACTION_SOURCES.has(lane.source) || !this.laneEnabled(lane)) return;
    const items = this.resolveItems(lane);
    if (items.length < 2 || !Number.isFinite(delta) || delta === 0) return;
    const selected = this.selectedValue(lane, items).toLowerCase();
    const selectedIndex = items.findIndex(({ value }) => value.toLowerCase() === selected);
    const direction = Math.sign(delta);
    const current = selectedIndex >= 0 ? selectedIndex : direction > 0 ? -1 : 0;
    const nextIndex = wrapIndex(current + Math.trunc(delta), items.length);
    this.applyLaneItem(lane, items[nextIndex].value, { focus });
  }

  handleFormMutation(event) {
    if (!this.watchedFormFields.has(event.target?.name)) return;
    this.scheduleSync();
  }

  handleClick(event) {
    if (performance.now() < this.suppressClickUntil) {
      event.preventDefault();
      return;
    }
    const modeButton = event.target.closest('[data-radial-mode]');
    if (modeButton) {
      this.activateMode(modeButton.dataset.radialMode);
      return;
    }
    const item = event.target.closest('[data-radial-item]');
    if (!item || item.disabled) return;
    const lane = this.laneById(item.dataset.radialLane);
    this.applyLaneItem(lane, item.dataset.radialItem, { focus: true });
  }

  handleWheel(event) {
    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    const lane = this.laneById(item.dataset.radialLane);
    if (!lane || ACTION_SOURCES.has(lane.source) || !this.laneEnabled(lane)) return;
    event.preventDefault();

    const delta = wheelDeltaPixels(event, this.preview.clientHeight);
    if (Math.abs(delta) < 0.01) return;
    const now = performance.now();
    const previous = this.wheelResiduals.get(lane.id) ?? 0;
    const last = this.lastWheelAt.get(lane.id) ?? 0;
    if (this.config.wheelCooldownMs > 0 && now - last < this.config.wheelCooldownMs) {
      const combined = previous + delta;
      const limit = this.config.wheelStepPx * 0.95;
      this.wheelResiduals.set(lane.id, Math.sign(combined) * Math.min(Math.abs(combined), limit));
      return;
    }

    const { steps, remainder } = consumeSteppedDelta(
      previous,
      delta,
      this.config.wheelStepPx,
      this.config.wheelMaxStepsPerEvent,
    );
    this.wheelResiduals.set(lane.id, remainder);
    if (steps === 0) return;
    this.lastWheelAt.set(lane.id, now);
    this.stepLane(lane, steps);
  }

  focusAdjacentAction(item, delta) {
    const view = this.laneViews.get(item.dataset.radialLane);
    if (!view) return;
    const buttons = [...view.buttons.values()].filter((button) => (
      !button.disabled && !button.classList.contains('is-outside')
    ));
    const current = Math.max(0, buttons.indexOf(item));
    buttons[wrapIndex(current + delta, buttons.length)]?.focus({ preventScroll: true });
  }

  handleKeyDown(event) {
    const modeButton = event.target.closest('[data-radial-mode]');
    if (modeButton && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const current = this.config.modes.findIndex(({ id }) => id === modeButton.dataset.radialMode);
      const next = this.config.modes[wrapIndex(
        current + (event.key === 'ArrowLeft' ? -1 : 1),
        this.config.modes.length,
      )];
      this.activateMode(next.id);
      this.modesHost.querySelector(`[data-radial-mode="${CSS.escape(next.id)}"]`)
        ?.focus({ preventScroll: true });
      return;
    }

    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    const lane = this.laneById(item.dataset.radialLane);
    if (!lane) return;
    const previousKey = event.key === 'ArrowUp' || event.key === 'ArrowLeft';
    const nextKey = event.key === 'ArrowDown' || event.key === 'ArrowRight';
    if (!previousKey && !nextKey && !['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
    event.preventDefault();

    if (ACTION_SOURCES.has(lane.source)) {
      if (previousKey) this.focusAdjacentAction(item, -1);
      else if (nextKey) this.focusAdjacentAction(item, 1);
      else {
        const view = this.laneViews.get(lane.id);
        const buttons = [...(view?.buttons.values() ?? [])].filter((button) => (
          !button.disabled && !button.classList.contains('is-outside')
        ));
        (event.key === 'Home' ? buttons[0] : buttons.at(-1))?.focus({ preventScroll: true });
      }
      return;
    }

    if (event.key === 'Home' || event.key === 'End') {
      const items = this.resolveItems(lane);
      const target = event.key === 'Home' ? items[0] : items.at(-1);
      if (target) this.applyLaneItem(lane, target.value, { focus: true });
      return;
    }
    const multiplier = event.key === 'PageUp' || event.key === 'PageDown'
      ? this.config.visibleSlots
      : 1;
    const direction = previousKey || event.key === 'PageUp' ? -1 : 1;
    this.stepLane(lane, direction * multiplier, { focus: true });
  }

  handlePointerDown(event) {
    if (!TOUCH_POINTER_TYPES.has(event.pointerType)) return;
    const item = event.target.closest('[data-radial-item]');
    if (!item || item.disabled) return;
    const lane = this.laneById(item.dataset.radialLane);
    if (!lane || ACTION_SOURCES.has(lane.source)) return;
    item.setPointerCapture?.(event.pointerId);
    this.pointerGestures.set(event.pointerId, {
      laneId: lane.id,
      target: item,
      lastY: event.clientY,
      totalDistance: 0,
      remainder: 0,
    });
    this.laneViews.get(lane.id)?.element.classList.add('is-dragging');
  }

  handlePointerMove(event) {
    const gesture = this.pointerGestures.get(event.pointerId);
    if (!gesture) return;
    event.preventDefault();
    const lane = this.laneById(gesture.laneId);
    if (!lane) return;
    const movement = event.clientY - gesture.lastY;
    gesture.lastY = event.clientY;
    gesture.totalDistance += Math.abs(movement);
    const { steps, remainder } = consumeSteppedDelta(
      gesture.remainder,
      -movement,
      this.config.swipeThresholdPx,
      this.config.wheelMaxStepsPerEvent,
    );
    gesture.remainder = remainder;
    const laneElement = this.laneViews.get(lane.id)?.element;
    const dragShift = -remainder / this.config.swipeThresholdPx * DRAG_VISUAL_RANGE_PX;
    laneElement?.style.setProperty('--radial-drag-shift', `${dragShift}px`);
    if (steps !== 0) this.stepLane(lane, steps);
  }

  finishPointerGesture(event, { cancelled = false } = {}) {
    const gesture = this.pointerGestures.get(event.pointerId);
    this.pointerGestures.delete(event.pointerId);
    if (!gesture) return;
    const laneElement = this.laneViews.get(gesture.laneId)?.element;
    laneElement?.classList.remove('is-dragging');
    laneElement?.style.removeProperty('--radial-drag-shift');
    if (!cancelled && gesture.totalDistance > DRAG_CLICK_DISTANCE_PX) {
      this.suppressClickUntil = performance.now() + CLICK_SUPPRESSION_MS;
    }
    if (gesture.target?.hasPointerCapture?.(event.pointerId)) {
      gesture.target.releasePointerCapture(event.pointerId);
    }
  }

  handlePointerOver(event) {
    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    const lane = this.laneById(item.dataset.radialLane);
    const descriptor = lane ? this.itemByValue(lane, item.dataset.radialItem) : null;
    if (lane && descriptor) this.showReadout(lane, descriptor);
  }

  handlePointerOut(event) {
    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    const relatedItem = isElement(event.relatedTarget)
      ? event.relatedTarget.closest('[data-radial-item]')
      : null;
    if (!relatedItem) this.hideReadout();
  }

  handleFocusIn(event) {
    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    const lane = this.laneById(item.dataset.radialLane);
    const descriptor = lane ? this.itemByValue(lane, item.dataset.radialItem) : null;
    if (lane && descriptor) this.showReadout(lane, descriptor);
  }

  handleFocusOut(event) {
    const relatedItem = isElement(event.relatedTarget)
      ? event.relatedTarget.closest('[data-radial-item]')
      : null;
    if (!relatedItem) this.hideReadout();
  }

  dispose() {
    cancelAnimationFrame(this.syncFrame);
    window.clearTimeout(this.readoutTimer);
    this.materialObserver.disconnect();
    this.host.removeEventListener('click', this.onClick);
    this.host.removeEventListener('wheel', this.onWheel);
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.host.removeEventListener('pointerdown', this.onPointerDown);
    this.host.removeEventListener('pointermove', this.onPointerMove);
    this.host.removeEventListener('pointerup', this.onPointerUp);
    this.host.removeEventListener('pointercancel', this.onPointerCancel);
    this.host.removeEventListener('pointerover', this.onPointerOver);
    this.host.removeEventListener('pointerout', this.onPointerOut);
    this.host.removeEventListener('focusin', this.onFocusIn);
    this.host.removeEventListener('focusout', this.onFocusOut);
    this.form.removeEventListener('change', this.onFormMutation);
    this.form.removeEventListener('input', this.onFormMutation);
    this.materialUi.removeEventListener('change', this.onMaterialChange);
    this.overlay.classList.remove('has-workshop-radial-menus');
    this.host.remove();
  }
}

const config = loadWorkshopRadialMenuConfig();
let instance = null;

function enhance() {
  if (instance?.overlay?.isConnected) return true;
  instance?.dispose();
  instance = null;
  const overlay = document.querySelector(SELECTORS.overlay);
  if (!overlay || overlay.querySelector('[data-role="workshop-radial-menus"]')) return false;
  instance = new WorkshopRadialMenus(overlay, config);
  return true;
}

if (!enhance()) {
  const app = document.querySelector('#app');
  if (app) {
    const observer = new MutationObserver(() => {
      if (enhance()) observer.disconnect();
    });
    observer.observe(app, { childList: true });
  } else {
    window.addEventListener('DOMContentLoaded', enhance, { once: true });
  }
}
