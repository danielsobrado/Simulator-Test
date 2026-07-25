const POLICY_BY_KIND = Object.freeze({
  structure: Object.freeze({
    handle: 'volume',
    label: 'Massing volume',
    defaultSpace: 'world',
    translateAxes: 'xyz',
    rotateAxes: 'xyz',
    scaleAxes: 'xyz',
    translationSnap: 0.1,
    rotationSnapDegrees: 15,
    scaleSnap: 0.05,
    inference: 'garden-and-parent',
  }),
  roof: Object.freeze({
    handle: 'ridge',
    label: 'Roof envelope',
    defaultSpace: 'parent',
    translateAxes: 'xyz',
    rotateAxes: 'xyz',
    scaleAxes: 'xyz',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'parent',
  }),
  door: Object.freeze({
    handle: 'facade-opening',
    label: 'Door opening',
    defaultSpace: 'parent',
    translateAxes: 'xy',
    rotateAxes: 'z',
    scaleAxes: 'xy',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'facade',
    adaptivePlacement: true,
  }),
  window: Object.freeze({
    handle: 'facade-opening',
    label: 'Window opening',
    defaultSpace: 'parent',
    translateAxes: 'xy',
    rotateAxes: 'z',
    scaleAxes: 'xy',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'facade',
    adaptivePlacement: true,
  }),
  opening: Object.freeze({
    handle: 'facade-opening',
    label: 'Structural opening',
    defaultSpace: 'parent',
    translateAxes: 'xy',
    rotateAxes: '',
    scaleAxes: 'xy',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'bay',
    adaptivePlacement: true,
  }),
  woodwork: Object.freeze({
    handle: 'attached-detail',
    label: 'Attached woodwork',
    defaultSpace: 'parent',
    translateAxes: 'xyz',
    rotateAxes: 'xyz',
    scaleAxes: 'xyz',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'parent',
  }),
  metalwork: Object.freeze({
    handle: 'attached-detail',
    label: 'Attached metalwork',
    defaultSpace: 'parent',
    translateAxes: 'xyz',
    rotateAxes: 'xyz',
    scaleAxes: 'xyz',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'parent',
  }),
  foliage: Object.freeze({
    handle: 'surface-detail',
    label: 'Surface decoration',
    defaultSpace: 'parent',
    translateAxes: 'xyz',
    rotateAxes: 'xyz',
    scaleAxes: 'xyz',
    translationSnap: 0.05,
    rotationSnapDegrees: 5,
    scaleSnap: 0.025,
    inference: 'surface',
  }),
});

const FALLBACK_POLICY = POLICY_BY_KIND.structure;

export function getWorkshopComponentEditPolicy(component) {
  const base = POLICY_BY_KIND[component?.kind] ?? FALLBACK_POLICY;
  if (component?.transformPolicy !== 'opening2d') return base;
  return Object.freeze({
    ...POLICY_BY_KIND.opening,
    label: 'Regenerated structural opening',
  });
}

export function axesForWorkshopMode(policy, mode) {
  if (mode === 'rotate') return policy.rotateAxes;
  if (mode === 'scale') return policy.scaleAxes;
  return policy.translateAxes;
}

export function supportsWorkshopTransformMode(policy, mode) {
  return axesForWorkshopMode(policy, mode).length > 0;
}

export function describeWorkshopEditPolicy(policy) {
  const actions = [];
  if (policy.translateAxes) actions.push(`move ${policy.translateAxes.toUpperCase()}`);
  if (policy.rotateAxes) actions.push(`rotate ${policy.rotateAxes.toUpperCase()}`);
  if (policy.scaleAxes) actions.push(`scale ${policy.scaleAxes.toUpperCase()}`);
  return `${policy.label} · ${actions.join(' · ')}`;
}
