import './workshopRadialMenus.css';
import { loadWorkshopRadialMenuConfig } from './WorkshopRadialMenuConfig.js';

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

function escapeAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function wrapIndex(index, length) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function arcSlot(index, count) {
  const center = (count - 1) / 2;
  const denominator = Math.max(1, center);
  const normalized = (index - center) / denominator;
  return Object.freeze({
    y: 50 + normalized * 42,
    depth: 16 + (1 - normalized * normalized) * 72,
    scale: 0.82 + (1 - Math.abs(normalized)) * 0.18,
    opacity: 0.62 + (1 - Math.abs(normalized)) * 0.38,
  });
}

function eventFor(name) {
  return new Event(name, { bubbles: true });
}

function firstElement(value) {
  if (!value) return null;
  if (typeof RadioNodeList !== 'undefined' && value instanceof RadioNodeList) return value[0] ?? null;
  return value;
}

class WorkshopRadialMenus {
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
    this.lastWheelAt = new Map();
    this.pointerStarts = new Map();
    this.suppressClickUntil = 0;
    this.host = document.createElement('div');
    this.host.className = 'workshop-radial-menus';
    this.host.dataset.role = 'workshop-radial-menus';
    this.preview.append(this.host);
    this.overlay.classList.add('has-workshop-radial-menus');

    this.onClick = (event) => this.handleClick(event);
    this.onWheel = (event) => this.handleWheel(event);
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.onPointerDown = (event) => this.handlePointerDown(event);
    this.onPointerUp = (event) => this.handlePointerUp(event);
    this.onFormChange = () => this.render();
    this.host.addEventListener('click', this.onClick);
    this.host.addEventListener('wheel', this.onWheel, { passive: false });
    this.host.addEventListener('keydown', this.onKeyDown);
    this.host.addEventListener('pointerdown', this.onPointerDown);
    this.host.addEventListener('pointerup', this.onPointerUp);
    this.form.addEventListener('change', this.onFormChange);
    this.form.addEventListener('input', this.onFormChange);

    this.materialObserver = new MutationObserver(() => {
      this.suppressLegacyPalette();
      if (this.activeMode()?.materialMode) {
        this.ensureMaterialMode(true);
        this.render();
      }
    });
    this.materialObserver.observe(this.materialUi, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });

    this.activateMode(this.modeId, { initial: true });
  }

  activeMode() {
    return this.config.modes.find(({ id }) => id === this.modeId) ?? this.config.modes[0];
  }

  activateMode(modeId, { initial = false } = {}) {
    const next = this.config.modes.find(({ id }) => id === modeId);
    if (!next) return;
    const previous = this.activeMode();
    this.modeId = next.id;
    if (next.materialMode) {
      this.ensureMaterialMode(true);
      if (!initial) this.setStatus('Material radial mode · select an area on the model, then choose a texture or color.');
    } else if (previous?.materialMode) {
      this.ensureMaterialMode(false);
    }
    this.render();
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
    if (palette && !palette.hidden) palette.hidden = true;
  }

  fieldElement(field) {
    return firstElement(this.form.elements.namedItem(field));
  }

  materialField(field) {
    return this.materialUi.querySelector(`[data-material-field="${CSS.escape(field)}"]`);
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
    if (lane.source === 'toggles') {
      return lane.items.map((item) => ({
        ...item,
        checked: this.fieldElement(item.value)?.checked === true,
      }));
    }
    return lane.items;
  }

  visibleItems(lane, items) {
    if (items.length <= this.config.visibleSlots) {
      return items.map((item, index) => ({ item, slot: arcSlot(index, items.length) }));
    }
    const selected = this.selectedValue(lane, items);
    const selectedIndex = Math.max(0, items.findIndex(({ value }) => value.toLowerCase() === selected.toLowerCase()));
    const half = Math.floor(this.config.visibleSlots / 2);
    return Array.from({ length: this.config.visibleSlots }, (_, slotIndex) => {
      const itemIndex = wrapIndex(selectedIndex + slotIndex - half, items.length);
      return { item: items[itemIndex], slot: arcSlot(slotIndex, this.config.visibleSlots) };
    });
  }

  renderLane(lane, laneIndex) {
    const items = this.resolveItems(lane);
    if (items.length === 0) return '';
    const selected = this.selectedValue(lane, items).toLowerCase();
    const buttons = this.visibleItems(lane, items).map(({ item, slot }) => {
      const isActive = item.value.toLowerCase() === selected || item.checked === true;
      const swatch = item.color || (lane.source === 'colorField' ? item.value : '');
      const content = swatch
        ? `<span class="workshop-radial-menus__swatch" style="--radial-item-color:${escapeAttribute(swatch)}"></span>`
        : `<span class="workshop-radial-menus__glyph">${escapeAttribute(item.glyph || item.label.slice(0, 1))}</span>`;
      return `<button type="button" class="workshop-radial-menus__item${isActive ? ' is-active' : ''}"`
        + ` data-radial-lane="${escapeAttribute(lane.id)}" data-radial-item="${escapeAttribute(item.value)}"`
        + ` aria-label="${escapeAttribute(item.label)}" title="${escapeAttribute(item.label)}"`
        + ` aria-pressed="${isActive ? 'true' : 'false'}"`
        + ` style="--radial-y:${slot.y}%;--radial-depth:${slot.depth}px;--radial-scale:${slot.scale};--radial-opacity:${slot.opacity}">`
        + `${content}</button>`;
    }).join('');
    return `<div class="workshop-radial-menus__lane" data-radial-lane-host="${escapeAttribute(lane.id)}"`
      + ` data-side="${lane.side}" style="--radial-lane:${laneIndex}" role="group"`
      + ` aria-label="${escapeAttribute(lane.label)}">`
      + `<span class="workshop-radial-menus__lane-label">${escapeAttribute(lane.label)}</span>${buttons}</div>`;
  }

  render() {
    const mode = this.activeMode();
    if (!mode) return;
    const laneCount = { left: 0, right: 0 };
    const lanes = mode.lanes.map((lane) => {
      const index = laneCount[lane.side];
      laneCount[lane.side] += 1;
      return this.renderLane(lane, index);
    }).join('');
    const modes = this.config.modes.map((entry) => (
      `<button type="button" class="workshop-radial-menus__mode${entry.id === mode.id ? ' is-active' : ''}"`
      + ` data-radial-mode="${escapeAttribute(entry.id)}" aria-label="${escapeAttribute(entry.label)}"`
      + ` title="${escapeAttribute(entry.label)}" aria-pressed="${entry.id === mode.id ? 'true' : 'false'}">`
      + `<span aria-hidden="true">${escapeAttribute(entry.glyph || entry.label.slice(0, 1))}</span></button>`
    )).join('');
    this.host.innerHTML = `<div class="workshop-radial-menus__lanes">${lanes}</div>`
      + `<div class="workshop-radial-menus__mode-title">${escapeAttribute(mode.label)}</div>`
      + `<div class="workshop-radial-menus__modes" role="toolbar" aria-label="Workbench radial menu categories">${modes}</div>`;
    this.suppressLegacyPalette();
  }

  laneById(laneId) {
    return this.activeMode()?.lanes.find(({ id }) => id === laneId) ?? null;
  }

  applyLaneItem(lane, value) {
    if (!lane) return;
    if (lane.field) {
      const field = this.fieldElement(lane.field);
      if (!field) return;
      field.value = value;
      field.dispatchEvent(eventFor(lane.event));
      if (lane.event === 'input') field.dispatchEvent(eventFor('change'));
      this.render();
      return;
    }
    if (lane.source === 'materialPresets') {
      const select = this.materialUi.querySelector(SELECTORS.materialPreset);
      if (!select || select.options.length === 0) {
        this.setStatus('Select a material area on the model before choosing a texture.', true);
        return;
      }
      select.value = value;
      select.dispatchEvent(eventFor('change'));
      this.render();
      return;
    }
    if (lane.source === 'colorField') {
      const field = this.materialField(lane.target);
      if (!field) return;
      if (!this.materialUi.querySelector(SELECTORS.materialPreset)?.options.length) {
        this.setStatus('Select a material area on the model before choosing a color.', true);
        return;
      }
      field.value = value;
      field.dispatchEvent(eventFor('change'));
      this.render();
      return;
    }
    if (lane.source === 'materialMaps') {
      const button = this.materialUi.querySelector(
        `[data-material-action="load-map"][data-source-kind="${CSS.escape(value)}"]`,
      );
      if (!button || !this.materialUi.querySelector(SELECTORS.materialPreset)?.options.length) {
        this.setStatus('Select a material area on the model before loading a PBR map.', true);
        return;
      }
      button.click();
      return;
    }
    if (lane.source === 'toggles') {
      const field = this.fieldElement(value);
      if (!field) return;
      field.checked = !field.checked;
      field.dispatchEvent(eventFor('change'));
      this.render();
    }
  }

  stepLane(lane, delta) {
    const items = this.resolveItems(lane);
    if (items.length < 2) return;
    const selected = this.selectedValue(lane, items).toLowerCase();
    const current = Math.max(0, items.findIndex(({ value }) => value.toLowerCase() === selected));
    this.applyLaneItem(lane, items[wrapIndex(current + delta, items.length)].value);
  }

  handleClick(event) {
    if (performance.now() < this.suppressClickUntil) return;
    const modeButton = event.target.closest('[data-radial-mode]');
    if (modeButton) {
      this.activateMode(modeButton.dataset.radialMode);
      return;
    }
    const item = event.target.closest('[data-radial-item]');
    if (!item) return;
    this.applyLaneItem(this.laneById(item.dataset.radialLane), item.dataset.radialItem);
  }

  handleWheel(event) {
    const host = event.target.closest('[data-radial-lane-host]');
    if (!host) return;
    const lane = this.laneById(host.dataset.radialLaneHost);
    if (!lane) return;
    event.preventDefault();
    const now = performance.now();
    const last = this.lastWheelAt.get(lane.id) ?? 0;
    if (now - last < this.config.wheelCooldownMs) return;
    const direction = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
    if (Math.abs(direction) < 1) return;
    this.lastWheelAt.set(lane.id, now);
    this.stepLane(lane, direction > 0 ? 1 : -1);
  }

  handleKeyDown(event) {
    const item = event.target.closest('[data-radial-item]');
    if (!item || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const lane = this.laneById(item.dataset.radialLane);
    if (!lane) return;
    this.stepLane(lane, event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1);
  }

  handlePointerDown(event) {
    const host = event.target.closest('[data-radial-lane-host]');
    if (!host || event.pointerType === 'mouse') return;
    this.pointerStarts.set(event.pointerId, {
      laneId: host.dataset.radialLaneHost,
      y: event.clientY,
    });
  }

  handlePointerUp(event) {
    const start = this.pointerStarts.get(event.pointerId);
    this.pointerStarts.delete(event.pointerId);
    if (!start || event.pointerType === 'mouse') return;
    const distance = event.clientY - start.y;
    if (Math.abs(distance) < this.config.swipeThresholdPx) return;
    const lane = this.laneById(start.laneId);
    if (!lane) return;
    this.suppressClickUntil = performance.now() + 220;
    this.stepLane(lane, distance > 0 ? -1 : 1);
  }
}

const config = loadWorkshopRadialMenuConfig();
let enhanced = false;
const enhance = () => {
  if (enhanced) return true;
  const overlay = document.querySelector(SELECTORS.overlay);
  if (!overlay || overlay.querySelector('[data-role="workshop-radial-menus"]')) return false;
  new WorkshopRadialMenus(overlay, config);
  enhanced = true;
  return true;
};

if (!enhance()) {
  const observer = new MutationObserver(() => {
    if (enhance()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
