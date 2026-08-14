export function recoverFromBackForwardCache(event, locationValue = globalThis.location) {
  if (!event?.persisted || typeof locationValue?.reload !== 'function') return false;
  locationValue.reload();
  return true;
}

export function installBfcacheRecovery({
  target = globalThis,
  locationValue = globalThis.location,
} = {}) {
  if (typeof target?.addEventListener !== 'function') return () => {};
  const onPageShow = (event) => recoverFromBackForwardCache(event, locationValue);
  target.addEventListener('pageshow', onPageShow);
  return () => target.removeEventListener?.('pageshow', onPageShow);
}
