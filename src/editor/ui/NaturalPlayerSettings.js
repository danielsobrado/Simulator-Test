import './NaturalPlayerSettings.css';
import {
  getAudioState,
  setAudioEnabled,
  setMasterVolume,
} from '../audio/index.js';
import { NATURAL_EDITOR_UI_CONFIG } from './NaturalEditorUiConfig.generated.js';

function readStoredBoolean(key) {
  try {
    const value = globalThis.localStorage?.getItem(key);
    if (value === 'true') return true;
    if (value === 'false') return false;
  } catch {
    // Browser storage is optional.
  }
  return null;
}

function writeStoredBoolean(key, value) {
  try {
    globalThis.localStorage?.setItem(key, String(Boolean(value)));
  } catch {
    // Browser storage is optional.
  }
}

function prefersReducedMotion() {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function applyReducedMotion(enabled) {
  document.documentElement.classList.toggle(
    NATURAL_EDITOR_UI_CONFIG.playerSettings.reducedMotionClass,
    enabled,
  );
}

function settingsMarkup({ audioEnabled, masterVolume, reducedMotion }) {
  const volumePercent = Math.round(masterVolume * 100);
  return `
    <section class="natural-player-settings" aria-label="Player settings">
      <div class="natural-player-settings__head">
        <div>
          <strong>Comfort</strong>
          <span>Sound, motion and interaction essentials.</span>
        </div>
      </div>
      <label class="natural-player-setting natural-player-setting--toggle">
        <span>
          <strong>Sound</strong>
          <small>World and interface audio</small>
        </span>
        <input type="checkbox" data-natural-setting="sound" ${audioEnabled ? 'checked' : ''} />
      </label>
      <label class="natural-player-setting natural-player-setting--range">
        <span>
          <strong>Volume</strong>
          <small><output data-natural-volume-output>${volumePercent}%</output></small>
        </span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value="${masterVolume}"
          data-natural-setting="volume"
          aria-label="Master volume"
        />
      </label>
      <label class="natural-player-setting natural-player-setting--toggle">
        <span>
          <strong>Reduce motion</strong>
          <small>Minimize interface movement and transitions</small>
        </span>
        <input type="checkbox" data-natural-setting="reduced-motion" ${reducedMotion ? 'checked' : ''} />
      </label>
      <div class="natural-controls-hint" aria-label="Essential controls">
        <span><kbd>Drag</kbd> manipulate</span>
        <span><kbd>R</kbd> rotate</span>
        <span><kbd>Ctrl Z</kbd> undo</span>
        <span><kbd>Esc</kbd> cancel</span>
      </div>
    </section>
  `;
}

class NaturalPlayerSettings {
  constructor(root) {
    this.root = root;
    this.settingsPanel = root.querySelector('[data-panel="settings"]');
    const audio = getAudioState();
    const storedMotion = readStoredBoolean(NATURAL_EDITOR_UI_CONFIG.storage.reducedMotionKey);
    this.reducedMotion = storedMotion ?? prefersReducedMotion();
    applyReducedMotion(this.reducedMotion);

    this.host = document.createElement('div');
    this.host.innerHTML = settingsMarkup({
      audioEnabled: audio.enabled,
      masterVolume: audio.masterVolume,
      reducedMotion: this.reducedMotion,
    }).trim();
    this.host = this.host.firstElementChild;

    const intro = this.settingsPanel.querySelector('.natural-settings-intro');
    intro?.after(this.host);
    if (!intro) this.settingsPanel.prepend(this.host);

    this.volume = this.host.querySelector('[data-natural-setting="volume"]');
    this.volumeOutput = this.host.querySelector('[data-natural-volume-output]');
    this.sound = this.host.querySelector('[data-natural-setting="sound"]');
    this.motion = this.host.querySelector('[data-natural-setting="reduced-motion"]');
    this.bind();
  }

  bind() {
    this.sound.addEventListener('change', () => {
      setAudioEnabled(this.sound.checked);
      this.volume.disabled = !this.sound.checked;
    });
    this.volume.addEventListener('input', () => {
      const value = Number(this.volume.value);
      if (setMasterVolume(value)) this.volumeOutput.value = `${Math.round(value * 100)}%`;
    });
    this.motion.addEventListener('change', () => {
      this.reducedMotion = this.motion.checked;
      applyReducedMotion(this.reducedMotion);
      writeStoredBoolean(
        NATURAL_EDITOR_UI_CONFIG.storage.reducedMotionKey,
        this.reducedMotion,
      );
    });
    this.volume.disabled = !this.sound.checked;
  }
}

function installWhenReady() {
  const root = document.querySelector('#app');
  const settings = root?.querySelector('[data-panel="settings"]');
  if (!settings || !settings.querySelector('.natural-settings-intro')) return false;
  if (settings.querySelector('.natural-player-settings')) return true;
  new NaturalPlayerSettings(root);
  return true;
}

if (!installWhenReady()) {
  const observer = new MutationObserver(() => {
    if (installWhenReady()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
