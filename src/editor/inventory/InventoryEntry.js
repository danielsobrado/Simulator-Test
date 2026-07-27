function cloneMetadata(metadata) {
  if (metadata == null) return undefined;
  return structuredClone(metadata);
}

function metadataEqual(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function createInstanceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Normalize a bag/equipment entry. Non-stackable equipment gets a stable instanceId.
 */
export function createInventoryEntry({
  itemKey,
  quantity = 1,
  instanceId = null,
  metadata = undefined,
  stackLimit = 1,
} = {}) {
  if (typeof itemKey !== 'string' || itemKey.length === 0) {
    throw new Error('Inventory entry requires a non-empty itemKey.');
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error('Inventory entry quantity must be an integer >= 1.');
  }
  if (!Number.isInteger(stackLimit) || stackLimit < 1) {
    throw new Error('Inventory entry stackLimit must be an integer >= 1.');
  }
  if (quantity > stackLimit) {
    throw new Error(`Inventory entry quantity ${quantity} exceeds stackLimit ${stackLimit}.`);
  }

  const needsInstance = stackLimit === 1 || instanceId != null || metadata != null;
  const entry = {
    itemKey,
    quantity,
  };
  if (needsInstance) {
    entry.instanceId = instanceId ?? createInstanceId();
  }
  if (metadata !== undefined) {
    entry.metadata = cloneMetadata(metadata);
  }
  return Object.freeze(entry);
}

export function cloneInventoryEntry(entry) {
  if (entry == null) return null;
  return createInventoryEntry({
    itemKey: entry.itemKey,
    quantity: entry.quantity,
    instanceId: entry.instanceId ?? null,
    metadata: entry.metadata,
    stackLimit: Number.MAX_SAFE_INTEGER,
  });
}

export function canMergeEntries(left, right) {
  if (!left || !right) return false;
  if (left.itemKey !== right.itemKey) return false;
  return metadataEqual(left.metadata, right.metadata);
}

export function entriesEqual(left, right) {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return left.itemKey === right.itemKey
    && left.quantity === right.quantity
    && left.instanceId === right.instanceId
    && metadataEqual(left.metadata, right.metadata);
}
