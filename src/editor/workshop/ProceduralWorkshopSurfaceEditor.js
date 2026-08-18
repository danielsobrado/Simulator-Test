import './ProceduralWorkshopSurfaceEditor.css';
import {
  createSurfaceTextureSourceId,
  getSurfaceTextureDefaults,
  serializeSurfaceTextures,
  WORKSHOP_SURFACE_TEXTURE_SLOTS,
} from './ProceduralWorkshopTextureConfig.js';
import { prepareWorkshopAlbedo } from './ProceduralWorkshopTextureUpload.js';

function tabsMarkup() {
  return WORKSHOP_SURFACE_TEXTURE_SLOTS.map(({ key, label }, index) => `
    <button
      type="button"
      class="${index === 0 ? 'is-active' : ''}"
      data-surface-action="select"
      data-surface-slot="${key}"
      role="tab"
    >${label}</button>
  `).join('');
}

function emptyState() {
  return { sources: {}, slots: {} };
}

export class ProceduralWorkshopSurfaceEditor {
  constructor({ root, onChange, onStatus }) {
    this.root = root;
    this.onChange = onChange;
    this.onStatus = onStatus;
    this.activeSlot = WORKSHOP_SURFACE_TEXTURE_SLOTS[0].key;
    this.state = emptyState();
    this.importRevisionBySlot = new Map();
    this.importingSlots = new Set();

    root.innerHTML = `
      <fieldset class="workshop-surface-editor">
        <legend>
          Imported albedo by area
          <span>optional</span>
        </legend>
        <div class="workshop-surface-tabs" role="tablist" aria-label="Material areas">
          ${tabsMarkup()}
        </div>
        <div class="workshop-surface-source">
          <div class="workshop-surface-swatch" data-role="surface-swatch" aria-hidden="true">
            <span>Procedural</span>
          </div>
          <div class="workshop-surface-source__details">
            <strong data-role="surface-title">Walls</strong>
            <span data-role="surface-file">Procedural material</span>
            <div class="workshop-surface-source__actions">
              <button type="button" class="action-button" data-surface-action="load">Load image</button>
              <button type="button" class="action-button" data-surface-action="clear" disabled>Use procedural</button>
            </div>
          </div>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            data-role="surface-file-input"
            hidden
          />
        </div>
        <div class="workshop-surface-options" data-role="surface-options">
          <label>Mapping
            <select data-surface-setting="mapping" disabled>
              <option value="repeat">Repeat tile</option>
              <option value="mirror">Mirror tile</option>
              <option value="clamp">Single image</option>
            </select>
          </label>
          <label>Rotation
            <select data-surface-setting="rotation" disabled>
              <option value="0">0°</option>
              <option value="90">90°</option>
              <option value="180">180°</option>
              <option value="270">270°</option>
            </select>
          </label>
          <span class="workshop-range workshop-range--wide">
            <label>
              Texture repeat
              <output data-role="surface-repeat-output">2.00×</output>
            </label>
            <input
              type="range"
              min="0.25"
              max="8"
              step="0.25"
              value="2"
              data-surface-setting="repeat"
              disabled
            />
          </span>
          <label class="workshop-surface-tint">Tint
            <input type="color" value="#ffffff" data-surface-setting="tint" disabled />
          </label>
        </div>
        <div class="workshop-surface-copy">
          <select data-role="surface-copy-target" aria-label="Copy texture to another area"></select>
          <button type="button" class="action-button" data-surface-action="copy" disabled>
            Copy texture + settings
          </button>
        </div>
        <p class="workshop-surface-help">
          Local PNG, JPEG, and WebP images are centre-cropped, processed to at most 512 × 512,
          saved with the baked object, and reused when several areas share the same source.
        </p>
      </fieldset>
    `;

    this.fileInput = root.querySelector('[data-role="surface-file-input"]');
    this.swatch = root.querySelector('[data-role="surface-swatch"]');
    this.title = root.querySelector('[data-role="surface-title"]');
    this.fileName = root.querySelector('[data-role="surface-file"]');
    this.loadButton = root.querySelector('[data-surface-action="load"]');
    this.clearButton = root.querySelector('[data-surface-action="clear"]');
    this.copyButton = root.querySelector('[data-surface-action="copy"]');
    this.copyTarget = root.querySelector('[data-role="surface-copy-target"]');
    this.repeatOutput = root.querySelector('[data-role="surface-repeat-output"]');
    this.bind();
    this.render();
  }

  bind() {
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-surface-action]');
      if (!button) return;
      const action = button.dataset.surfaceAction;
      if (action === 'select') {
        this.activeSlot = button.dataset.surfaceSlot;
        this.render();
      } else if (action === 'load' && !this.importingSlots.has(this.activeSlot)) {
        this.fileInput.click();
      } else if (action === 'clear') {
        this.clearActiveSlot();
      } else if (action === 'copy') {
        this.copyActiveSlot();
      }
    });

    this.fileInput.addEventListener('change', async (event) => {
      event.stopPropagation();
      const [file] = this.fileInput.files ?? [];
      this.fileInput.value = '';
      if (!file) return;
      await this.importFile(file);
    });

    this.root.addEventListener('change', (event) => {
      const setting = event.target.dataset.surfaceSetting;
      if (!setting) return;
      event.stopPropagation();
      this.updateSetting(setting, event.target.value);
    });

    this.root.addEventListener('input', (event) => {
      const setting = event.target.dataset.surfaceSetting;
      if (setting !== 'repeat' && setting !== 'tint') return;
      event.stopPropagation();
      this.updateSetting(setting, event.target.value);
    });
  }

  nextImportRevision(slotKey) {
    const revision = (this.importRevisionBySlot.get(slotKey) ?? 0) + 1;
    this.importRevisionBySlot.set(slotKey, revision);
    return revision;
  }

  cancelPendingImport(slotKey) {
    this.nextImportRevision(slotKey);
    this.importingSlots.delete(slotKey);
  }

  async importFile(file) {
    const slotKey = this.activeSlot;
    const revision = this.nextImportRevision(slotKey);
    this.importingSlots.add(slotKey);
    this.render();
    this.onStatus?.(`Preparing ${file.name} for ${this.slotLabel(slotKey)}…`, false);
    try {
      const source = await prepareWorkshopAlbedo(file);
      if (this.importRevisionBySlot.get(slotKey) !== revision) return;

      let sourceId = createSurfaceTextureSourceId(source.dataUrl);
      let suffix = 2;
      while (
        this.state.sources[sourceId]
        && this.state.sources[sourceId].dataUrl !== source.dataUrl
      ) {
        sourceId = `${createSurfaceTextureSourceId(source.dataUrl)}-${suffix}`;
        suffix += 1;
      }
      this.commit({
        sources: {
          ...this.state.sources,
          [sourceId]: {
            name: source.name,
            dataUrl: source.dataUrl,
          },
        },
        slots: {
          ...this.state.slots,
          [slotKey]: {
            ...getSurfaceTextureDefaults(slotKey),
            ...this.state.slots[slotKey],
            sourceId,
          },
        },
      });
      this.render();
      this.onStatus?.(`${source.name} applied to ${this.slotLabel(slotKey)}.`, false);
      this.onChange?.();
    } catch (error) {
      if (this.importRevisionBySlot.get(slotKey) === revision) {
        this.onStatus?.(error instanceof Error ? error.message : String(error), true);
      }
    } finally {
      if (this.importRevisionBySlot.get(slotKey) === revision) {
        this.importingSlots.delete(slotKey);
        this.render();
      }
    }
  }

  updateSetting(setting, rawValue) {
    const current = this.state.slots[this.activeSlot];
    if (!current) return;
    const value = setting === 'repeat' || setting === 'rotation'
      ? Number(rawValue)
      : rawValue;
    this.commit({
      sources: this.state.sources,
      slots: {
        ...this.state.slots,
        [this.activeSlot]: {
          ...current,
          [setting]: value,
        },
      },
    });
    this.render();
    this.onChange?.();
  }

  clearActiveSlot() {
    this.cancelPendingImport(this.activeSlot);
    if (!this.state.slots[this.activeSlot]) {
      this.render();
      return;
    }
    const slots = { ...this.state.slots };
    delete slots[this.activeSlot];
    this.commit({ sources: this.state.sources, slots });
    this.render();
    this.onStatus?.(`${this.slotLabel()} returned to its procedural material.`, false);
    this.onChange?.();
  }

  copyActiveSlot() {
    const current = this.state.slots[this.activeSlot];
    if (!current) return;
    const target = this.copyTarget.value;
    const targets = target === 'all'
      ? WORKSHOP_SURFACE_TEXTURE_SLOTS.map(({ key }) => key)
      : [target];
    const slots = { ...this.state.slots };
    for (const slotKey of targets) {
      if (slotKey !== this.activeSlot) {
        this.cancelPendingImport(slotKey);
        slots[slotKey] = { ...current };
      }
    }
    this.commit({ sources: this.state.sources, slots });
    this.render();
    this.onStatus?.('The imported albedo and its mapping settings were copied.', false);
    this.onChange?.();
  }

  commit(nextState) {
    this.state = serializeSurfaceTextures(nextState);
  }

  slotLabel(slotKey = this.activeSlot) {
    return WORKSHOP_SURFACE_TEXTURE_SLOTS.find(({ key }) => key === slotKey)?.label
      ?? slotKey;
  }

  renderCopyTargets() {
    const previous = this.copyTarget.value;
    const options = WORKSHOP_SURFACE_TEXTURE_SLOTS
      .filter(({ key }) => key !== this.activeSlot)
      .map(({ key, label }) => `<option value="${key}">${label}</option>`);
    options.push('<option value="all">All other areas</option>');
    this.copyTarget.innerHTML = options.join('');
    if (Array.from(this.copyTarget.options).some(({ value }) => value === previous)) {
      this.copyTarget.value = previous;
    }
  }

  render() {
    const slot = this.state.slots[this.activeSlot] ?? null;
    const source = slot ? this.state.sources[slot.sourceId] : null;
    const defaults = getSurfaceTextureDefaults(this.activeSlot);
    const settings = slot ?? defaults;
    const importing = this.importingSlots.has(this.activeSlot);

    for (const button of this.root.querySelectorAll('[data-surface-action="select"]')) {
      button.classList.toggle('is-active', button.dataset.surfaceSlot === this.activeSlot);
      button.classList.toggle('has-texture', Boolean(this.state.slots[button.dataset.surfaceSlot]));
      button.setAttribute('aria-selected', String(button.dataset.surfaceSlot === this.activeSlot));
    }

    this.title.textContent = this.slotLabel();
    this.fileName.textContent = importing ? 'Preparing imported image…' : source?.name ?? 'Procedural material';
    this.loadButton.textContent = importing ? 'Preparing…' : source ? 'Replace image' : 'Load image';
    this.loadButton.disabled = importing;
    this.swatch.style.backgroundImage = source ? `url("${source.dataUrl}")` : '';
    this.swatch.classList.toggle('has-texture', Boolean(source));
    this.swatch.querySelector('span').textContent = source ? '' : 'Procedural';

    for (const control of this.root.querySelectorAll('[data-surface-setting]')) {
      control.disabled = !slot;
    }
    this.root.querySelector('[data-surface-setting="mapping"]').value = settings.mapping;
    this.root.querySelector('[data-surface-setting="rotation"]').value = String(settings.rotation);
    this.root.querySelector('[data-surface-setting="repeat"]').value = String(settings.repeat);
    this.root.querySelector('[data-surface-setting="tint"]').value = settings.tint;
    const repeatControl = this.root.querySelector('[data-surface-setting="repeat"]');
    repeatControl.disabled = !slot || settings.mapping === 'clamp';
    this.repeatOutput.textContent = settings.mapping === 'clamp'
      ? 'Single image'
      : `${Number(settings.repeat).toFixed(2)}×`;

    this.clearButton.disabled = !slot && !importing;
    this.copyButton.disabled = !slot;
    this.copyTarget.disabled = !slot;
    this.renderCopyTargets();
  }

  toDocument() {
    return serializeSurfaceTextures(this.state);
  }

  dispose() {
    this.root.replaceChildren();
    this.state = emptyState();
    this.importRevisionBySlot.clear();
    this.importingSlots.clear();
  }
}
