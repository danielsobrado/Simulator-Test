export const GAMEPLAY_OVERLAY = Object.freeze({
  none: null,
  inventory: 'inventory',
  worldMap: 'world-map',
});

export const GAMEPLAY_OVERLAY_SHORTCUTS = Object.freeze({
  inventory: 'KeyI',
  worldMap: 'KeyM',
});

export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}
