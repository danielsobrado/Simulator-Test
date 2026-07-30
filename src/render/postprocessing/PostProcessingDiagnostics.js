export class PostProcessingDiagnostics {
  constructor() {
    this.graphBuilds = 0;
    this.framesRendered = 0;
    this.lastTopologySignature = '';
  }

  graphBuilt(signature) {
    this.graphBuilds += 1;
    this.lastTopologySignature = signature;
  }

  frameRendered() {
    this.framesRendered += 1;
  }

  snapshot() {
    return Object.freeze({
      graphBuilds: this.graphBuilds,
      framesRendered: this.framesRendered,
      lastTopologySignature: this.lastTopologySignature,
    });
  }
}
