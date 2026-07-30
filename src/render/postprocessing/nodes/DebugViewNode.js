import { vec3, vec4 } from 'three/tsl';

function scalarView(value) {
  return vec4(vec3(value), 1);
}

/**
 * Selects a diagnostic presentation node without adding another scene pass.
 * Phase 13 can replace these simple channel views with labelled/ranged tools.
 */
export function createDebugViewNode(scenePass, debugView = 'final') {
  const hdr = scenePass.getTextureNode('output');
  if (debugView === 'final' || debugView === 'hdr-colour') return hdr;
  if (debugView === 'depth') return scalarView(scenePass.getLinearDepthNode());
  if (debugView === 'normal') return scenePass.getTextureNode('normal');
  if (debugView === 'velocity') {
    const velocity = scenePass.getTextureNode('velocity').rg.mul(0.5).add(0.5);
    return vec4(velocity, 0, 1);
  }

  const material = scenePass.getTextureNode('material');
  if (debugView === 'reactive-mask') return scalarView(material.g);
  if (debugView === 'reflection-class') return scalarView(material.b.mul(255).div(5));
  if (debugView === 'material') return material;
  return hdr;
}
