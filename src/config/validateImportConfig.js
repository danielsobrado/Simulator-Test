const MAX_MACRO_ATLAS_CELLS = 4_000_000;

export function validateImportConfig(config) {
  const importConfig = config?.import;
  if (!importConfig || typeof importConfig !== 'object' || Array.isArray(importConfig)) {
    throw new Error('Invalid editor configuration: import must be an object.');
  }

  const longEdge = importConfig.azgaarAtlasLongEdge;
  if (!Number.isInteger(longEdge) || longEdge < 1 || longEdge > MAX_MACRO_ATLAS_CELLS) {
    throw new Error(
      `Invalid editor configuration: import.azgaarAtlasLongEdge must be an integer within 1–${MAX_MACRO_ATLAS_CELLS}.`,
    );
  }

  return importConfig;
}
