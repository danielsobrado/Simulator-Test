/**
 * three.js ViewportTextureNode caches one FramebufferTexture/DepthTexture per
 * render target via Texture.clone(), which shares `Source`. The lazy resize
 * check then only reallocates the first clone after a size change; later clones
 * see matching image dimensions and skip GPU reallocation, so
 * CopyTextureToTexture can request a range that misses the live framebuffer.
 *
 * Give each FramebufferTexture / DepthTexture clone its own Source.
 */
import { DepthTexture, FramebufferTexture, Source } from 'three/webgpu';

let patched = false;

function detachClonedSource(texture, template) {
  const width = Math.max(1, template?.image?.width || 1);
  const height = Math.max(1, template?.image?.height || 1);
  const depth = Math.max(1, template?.image?.depth || 1);
  texture.source = new Source({ width, height, depth });
  texture.needsUpdate = true;
}

function patchCopy(Ctor) {
  const originalCopy = Ctor.prototype.copy;
  Ctor.prototype.copy = function copy(source) {
    originalCopy.call(this, source);
    detachClonedSource(this, source);
    return this;
  };
  Ctor.prototype.copy.__viewportSourcePatchOriginal = originalCopy;
}

export function patchViewportFramebufferSources() {
  if (patched) return true;
  patchCopy(FramebufferTexture);
  patchCopy(DepthTexture);
  patched = true;
  return true;
}

export function isViewportFramebufferSourcesPatched() {
  return patched;
}
