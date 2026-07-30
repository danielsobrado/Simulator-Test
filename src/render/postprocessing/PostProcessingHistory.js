/**
 * Temporal history ownership boundary.
 *
 * TAA and SSR do not own render targets yet. Keeping their reset state here
 * gives future temporal nodes one API and makes invalidation observable now.
 */
export class PostProcessingHistory {
  constructor() {
    this.taaColourValid = false;
    this.taaDepthValid = false;
    this.ssrValid = false;
    this.jitterIndex = 0;
    this.previousViewProjection = null;
    this.lastResetReason = null;
    this.resetCount = 0;
  }

  clearHistory(reason) {
    this.taaColourValid = false;
    this.taaDepthValid = false;
    this.ssrValid = false;
    this.jitterIndex = 0;
    this.previousViewProjection = null;
    this.lastResetReason = reason;
    this.resetCount += 1;
  }

  invalidate(reason) {
    this.clearHistory(reason);
  }
}
