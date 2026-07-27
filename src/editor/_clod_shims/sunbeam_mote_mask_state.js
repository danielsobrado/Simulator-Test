
export function evaluateSunbeamMoteAirborneState(biome) {
  if (!biome || biome.enabled === false) {
    return { amount: 0, coldBlend: 0, localMist: 0 };
  }
  const pollen = Number(biome.pollenAmount) || 0;
  const frost = Number(biome.frostAmount) || 0;
  const mist = Number(biome.morningMist) || 0;
  return {
    amount: Math.min(1, Math.max(0, pollen * 0.55 + mist * 0.35 + 0.15)),
    coldBlend: Math.min(1, Math.max(0, frost)),
    localMist: Math.min(1, Math.max(0, mist)),
  };
}
