import { emitAudio } from '../_clod_shims/audio.js';
import { defaultSpellConfig } from './spell_config.js';

const MISS_FLASH_MS = 280;
const SPELL_BUTTONS = Object.freeze([
  { id: 'fire', key: 1, icon: '🔥', method: 'playFire' },
  { id: 'water', key: 2, icon: '💧', method: 'playWater' },
  { id: 'air', key: 3, icon: '💨', method: 'playAir' },
  { id: 'earth', key: 4, icon: '🪨', method: 'playEarth' },
  { id: 'lightning', key: 5, icon: '⚡', method: 'playLightning' },
  { id: 'fireball', key: 6, icon: '☄️', method: 'playFireball' },
]);

function resolveMenuRoot(rootId, suppliedRoot) {
  if (suppliedRoot) return { root: suppliedRoot, owned: false };
  const existing = document.getElementById(rootId);
  if (existing) return { root: existing, owned: false };
  const root = document.createElement('nav');
  root.id = rootId;
  document.body.appendChild(root);
  return { root, owned: true };
}

function stopUiPropagation(event) {
  event.stopPropagation();
}

function createSpellButton({ key, icon, label, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = `${key} ${icon} ${label}`;
  button.title = `${label} spell (${key})`;
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', onClick);
  return button;
}

export function createSpellMenu(deps = {}) {
  const config = deps.config ?? defaultSpellConfig;
  const controller = deps.controller ?? {};
  const { root, owned } = resolveMenuRoot(config.menu.rootId, deps.root);
  const resetTimers = new Map();
  let missFlashTimer = 0;
  let dragOffset = null;

  root.replaceChildren();
  root.setAttribute('aria-label', 'Spell menu');

  const title = document.createElement('span');
  title.className = 'spell-menu-title';
  title.textContent = config.menu.title;

  const slots = document.createElement('div');
  slots.className = 'spell-menu-slots';
  const buttons = new Map();

  const flashMiss = (button) => {
    window.clearTimeout(missFlashTimer);
    button.classList.add('spell-miss');
    missFlashTimer = window.setTimeout(() => {
      button.classList.remove('spell-miss');
      missFlashTimer = 0;
    }, MISS_FLASH_MS);
  };

  const castSpell = (descriptor) => {
    const entry = config[descriptor.id];
    const button = buttons.get(descriptor.id);
    if (!entry || !button) return false;

    window.clearTimeout(resetTimers.get(descriptor.id));
    const play = controller[descriptor.method];
    const fired = typeof play === 'function'
      && play(entry.castDurationMs) !== false;
    if (!fired) {
      button.setAttribute('aria-pressed', 'false');
      flashMiss(button);
      return false;
    }

    button.setAttribute('aria-pressed', 'true');
    emitAudio(`spell.${descriptor.id}.cast`, {
      volume: entry.audio.volume,
      durationMs: entry.castDurationMs,
    });
    resetTimers.set(descriptor.id, window.setTimeout(() => {
      button.setAttribute('aria-pressed', 'false');
      resetTimers.delete(descriptor.id);
    }, entry.castDurationMs));
    return true;
  };

  for (const descriptor of SPELL_BUTTONS) {
    const entry = config[descriptor.id];
    const button = createSpellButton({
      key: descriptor.key,
      icon: descriptor.icon,
      label: entry.label,
      onClick: () => castSpell(descriptor),
    });
    buttons.set(descriptor.id, button);
    slots.append(button);
  }

  root.append(title, slots);
  root.addEventListener('pointerdown', stopUiPropagation);
  root.addEventListener('click', stopUiPropagation);

  const onDragMove = (event) => {
    if (!dragOffset) return;
    const maximumLeft = Math.max(0, window.innerWidth - root.offsetWidth);
    const maximumTop = Math.max(0, window.innerHeight - root.offsetHeight);
    const left = Math.max(0, Math.min(maximumLeft, event.clientX - dragOffset.x));
    const top = Math.max(0, Math.min(maximumTop, event.clientY - dragOffset.y));
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;
  };

  const onDragEnd = () => {
    dragOffset = null;
    root.classList.remove('dragging');
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
  };

  const onDragStart = (event) => {
    if (!(event.target instanceof HTMLElement) || !title.contains(event.target)) return;
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    dragOffset = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    root.style.left = `${rect.left}px`;
    root.style.top = `${rect.top}px`;
    root.style.transform = 'none';
    root.style.bottom = 'auto';
    root.style.right = 'auto';
    root.classList.add('dragging');
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
  };

  title.addEventListener('pointerdown', onDragStart);

  return {
    castFire: () => castSpell(SPELL_BUTTONS[0]),
    castWater: () => castSpell(SPELL_BUTTONS[1]),
    castAir: () => castSpell(SPELL_BUTTONS[2]),
    castEarth: () => castSpell(SPELL_BUTTONS[3]),
    castLightning: () => castSpell(SPELL_BUTTONS[4]),
    castFireball: () => castSpell(SPELL_BUTTONS[5]),
    dispose() {
      for (const timer of resetTimers.values()) window.clearTimeout(timer);
      resetTimers.clear();
      window.clearTimeout(missFlashTimer);
      if (dragOffset) onDragEnd();
      title.removeEventListener('pointerdown', onDragStart);
      root.removeEventListener('pointerdown', stopUiPropagation);
      root.removeEventListener('click', stopUiPropagation);
      if (owned) root.remove();
      else root.replaceChildren();
    },
  };
}
