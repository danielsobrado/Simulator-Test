export async function loadOptionalTreeVariants({
  definitions = [],
  acquire,
  onLoaded = () => {},
  warn = console.warn,
}) {
  if (typeof acquire !== 'function') {
    throw new Error('Optional tree variant loading requires an acquire function.');
  }
  const settled = await Promise.allSettled(definitions.map(async (definition) => ({
    definition,
    scene: await acquire(definition.scene),
  })));
  const variants = [];
  for (let index = 0; index < settled.length; index += 1) {
    const result = settled[index];
    const definition = definitions[index];
    if (result.status === 'fulfilled') {
      onLoaded(definition.scene);
      variants.push(result.value);
      continue;
    }
    warn(`Optional tree variant ${definition.scene} failed to load.`, result.reason);
  }
  return variants;
}
