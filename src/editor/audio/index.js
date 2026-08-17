import { AudioBus, audioBus } from "./audio_bus.js";
const emitAudio = (eventId, options) => {
  audioBus.emitAudio(eventId, options);
};
const setAudioEnabled = (enabled) => {
  audioBus.setAudioEnabled(enabled);
};
const setMasterVolume = (volume) => audioBus.setMasterVolume(volume);
const getAudioState = () => {
  return audioBus.getAudioState();
};
export {
  AudioBus,
  audioBus,
  emitAudio,
  getAudioState,
  setAudioEnabled,
  setMasterVolume
};
