import { defaultAudioConfig } from "./audio_config.js";
import { ProceduralAudio } from "./procedural_audio.js";
import { AudioThrottle } from "./audio_throttle.js";

function normalizedVolume(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}

class AudioBus {
  synthManager = new ProceduralAudio();
  throttle = new AudioThrottle();
  config = defaultAudioConfig;
  constructor() {
    this.loadPersistence();
    this.setupLazyInit();
  }
  loadPersistence() {
    if (typeof localStorage === "undefined") return;
    try {
      const savedEnabled = localStorage.getItem("drusniel_audio_enabled");
      if (savedEnabled !== null) {
        this.synthManager.setEnabled(savedEnabled === "true");
      } else {
        this.synthManager.setEnabled(this.config.global.enabled);
      }
      const savedVol = localStorage.getItem("drusniel_audio_master_volume");
      this.synthManager.setMasterVolume(
        savedVol === null
          ? this.config.global.master_volume
          : normalizedVolume(savedVol, this.config.global.master_volume)
      );
    } catch {
    }
  }
  savePersistence() {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem("drusniel_audio_enabled", String(this.synthManager.isEnabled()));
      localStorage.setItem("drusniel_audio_master_volume", String(this.synthManager.getMasterVolume()));
    } catch {
    }
  }
  setupLazyInit() {
    if (typeof window === "undefined") return;
    const initOnGesture = () => {
      this.init();
      removeListeners();
    };
    const removeListeners = () => {
      window.removeEventListener("pointerdown", initOnGesture, { capture: true });
      window.removeEventListener("keydown", initOnGesture, { capture: true });
      window.removeEventListener("click", initOnGesture, { capture: true });
    };
    window.addEventListener("pointerdown", initOnGesture, { capture: true, passive: true });
    window.addEventListener("keydown", initOnGesture, { capture: true, passive: true });
    window.addEventListener("click", initOnGesture, { capture: true, passive: true });
  }
  init(ctx) {
    this.synthManager.init(ctx);
  }
  emitAudio(eventId, options) {
    if (!this.synthManager.isInitialized()) {
      this.init();
    }
    if (!this.synthManager.isEnabled()) return;
    const eventCfg = this.config.events[eventId];
    if (!eventCfg) {
      console.warn(`[audio] Unknown event ID: ${eventId}`);
      return;
    }
    if (!eventCfg.enabled) return;
    const force = options?.force ?? false;
    if (this.throttle.isThrottled(eventId, eventCfg, force)) {
      return;
    }
    let categoryScale = 1;
    if (eventId.startsWith("ui.")) {
      categoryScale = this.config.global.ui_volume;
    } else if (eventId.startsWith("project.") || eventId.startsWith("camera.") || eventId.startsWith("texture.") || eventId.startsWith("material.") || eventId.startsWith("terrain.") || eventId.startsWith("spell.")) {
      categoryScale = this.config.global.world_volume;
    } else if (eventId.startsWith("clod.")) {
      categoryScale = this.config.global.debug_volume;
    }
    const eventVol = options?.volume !== void 0 ? options.volume : eventCfg.volume;
    const finalVolume = Math.min(1, Math.max(0, eventVol * categoryScale));
    this.synthManager.playSynth(
      eventCfg.synth,
      eventCfg,
      finalVolume,
      options?.pitch,
      options?.variant,
      options?.durationMs
    );
  }
  setAudioEnabled(enabled) {
    this.synthManager.setEnabled(enabled);
    this.savePersistence();
  }
  setMasterVolume(volume) {
    const normalized = normalizedVolume(volume, null);
    if (normalized === null) return false;
    this.synthManager.setMasterVolume(normalized);
    this.savePersistence();
    return true;
  }
  getAudioState() {
    return {
      enabled: this.synthManager.isEnabled(),
      masterVolume: this.synthManager.getMasterVolume(),
      initialized: this.synthManager.isInitialized()
    };
  }
  // Helper for tests to inject mock configs/states
  getConfig() {
    return this.config;
  }
}
const audioBus = new AudioBus();
export {
  AudioBus,
  audioBus
};
