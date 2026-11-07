/** Capture state must be restored even when a shader or device throws. */
export function withReflectionCapture(renderer, scene, hidden, operation, scratch = null) {
  const target = renderer.getRenderTarget();
  const face = renderer.getActiveCubeFace?.() ?? 0;
  const mip = renderer.getActiveMipmapLevel?.() ?? 0;
  const mrt = renderer.getMRT();
  const autoClear = renderer.autoClear;
  const states = scratch?.states ?? [];
  const shadows = scratch?.shadows ?? [];
  states.length = 0;
  shadows.length = 0;
  for (const object of hidden) states.push([object, object.visible]);
  try {
    const freezeShadow = object => {
      const shadow = object.shadow;
      if (!shadow) return;
      shadows.push([shadow, shadow.autoUpdate, shadow.needsUpdate]);
      shadow.autoUpdate = false;
      shadow.needsUpdate = false;
    };
    if (scratch?.shadowOwners) {
      for (const owner of scratch.shadowOwners) freezeShadow(owner);
    } else scene.traverse(freezeShadow);
    for (const [object] of states) object.visible = false;
    renderer.setMRT(null);
    renderer.autoClear = true;
    return operation();
  }
  finally {
    try {
      try { renderer.setRenderTarget(target, face, mip); }
      finally { renderer.setMRT(mrt); }
    } finally {
      renderer.autoClear = autoClear;
      for (const [object, visible] of states) object.visible = visible;
      for (const [shadow, update, dirty] of shadows) { shadow.autoUpdate = update; shadow.needsUpdate = dirty; }
      states.length = 0;
      shadows.length = 0;
    }
  }
}
