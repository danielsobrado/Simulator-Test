import * as THREE from 'three/webgpu';
import {
  Break,
  Fn,
  If,
  Loop,
  clamp,
  exp2,
  float,
  int,
  max,
  min,
  mix,
  normalize,
  reflect,
  round,
  rtt,
  screenUV,
  smoothstep,
  texture,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { REFLECTION_CLASSES } from '../PostProcessingMaterialData.js';
import { SSR_BACKGROUND_DEPTH_METERS } from './HierarchicalDepthNode.js';

export const SSR_FRESNEL_F0 = Object.freeze({
  [REFLECTION_CLASSES.WATER]: 0.020,
  [REFLECTION_CLASSES.ICE]: 0.045,
  [REFLECTION_CLASSES.WET_STONE]: 0.040,
  [REFLECTION_CLASSES.POLISHED_STONE]: 0.060,
  [REFLECTION_CLASSES.MAGICAL_MIRROR]: 0.100,
});

export function ssrFresnelF0Reference(reflectionClass) {
  return SSR_FRESNEL_F0[Math.round(Number(reflectionClass))] ?? 0;
}

export const ssrF0Reference = ssrFresnelF0Reference;

export function ssrThicknessAcceptReference(rayDepthMeters, sceneDepthMeters, thicknessMeters) {
  const separation = Number(rayDepthMeters) - Number(sceneDepthMeters);
  return separation >= 0 && separation <= Number(thicknessMeters);
}

export const ssrThicknessAcceptedReference = ssrThicknessAcceptReference;

export function ssrEligibilityReference(options, roughness, cutoff, depth, normalFacesReflection) {
  const value = typeof options === 'object'
    ? options
    : {
      reflectionClass: options,
      roughness,
      roughnessCutoff: cutoff,
      linearDepthMeters: depth,
      normalFacesReflection,
    };
  const linearDepth = value.linearDepthMeters ?? value.depthMeters ?? value.depth;
  const hasGeometry = value.depthIsBackground == null
    ? Number.isFinite(linearDepth)
      && linearDepth > 0
      && linearDepth < (value.backgroundDepthMeters ?? SSR_BACKGROUND_DEPTH_METERS)
    : value.depthIsBackground === false;
  return Number(value.reflectionClass) !== REFLECTION_CLASSES.NONE
    && Number(value.roughness) <= Number(value.roughnessCutoff)
    && hasGeometry
    && value.normalFacesReflection !== false
    && value.validReflectionDirection !== false;
}

export const ssrIsEligibleReference = ssrEligibilityReference;

function createHdrTarget(node) {
  const target = rtt(node, 1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
  });
  target.renderTarget.texture.generateMipmaps = false;
  return target;
}

function bindWriteTarget(rttNode, target) {
  rttNode.renderTarget = target;
  rttNode.value = target.texture;
  rttNode.textureNeedsUpdate = true;
}

function uvCoverage(uvNode) {
  return uvNode.x.greaterThanEqual(0)
    .and(uvNode.x.lessThanEqual(1))
    .and(uvNode.y.greaterThanEqual(0))
    .and(uvNode.y.lessThanEqual(1));
}

function projectViewPosition(viewPosition, projectionMatrix) {
  const clip = projectionMatrix.mul(vec4(viewPosition, 1));
  const ndc = clip.xy.div(max(clip.w.abs(), 1e-6));
  return vec2(ndc.x.mul(0.5).add(0.5), float(0.5).sub(ndc.y.mul(0.5)));
}

function reconstructViewPosition(uvNode, rawDepth, projectionMatrixInverse) {
  const clip = vec4(
    uvNode.x.mul(2).sub(1),
    float(1).sub(uvNode.y.mul(2)),
    rawDepth,
    1,
  );
  const view = projectionMatrixInverse.mul(clip);
  return view.xyz.div(max(view.w.abs(), 1e-6));
}

function reflectionF0Node(reflectionClass) {
  let result = float(0);
  for (const [reflectionClassId, f0] of Object.entries(SSR_FRESNEL_F0)) {
    result = reflectionClass
      .equal(Number(reflectionClassId))
      .select(float(f0), result);
  }
  return result;
}

function sampleDepthLevel(depthPyramid, mip, uvNode) {
  let sampled = depthPyramid.levels[0].sample(uvNode).r;
  for (let level = 1; level < depthPyramid.levels.length; level += 1) {
    sampled = mip.equal(level).select(
      depthPyramid.levels[level].sample(uvNode).r,
      sampled,
    );
  }
  return sampled;
}

function buildTrace({
  sourceNode,
  rawDepthNode,
  normalNode,
  materialNode,
  depthPyramid,
  projectionMatrix,
  projectionMatrixInverse,
  maxSteps,
  binarySteps,
  maxDistanceMeters,
  thicknessMeters,
  roughnessCutoff,
  intensity,
  edgeFade,
}) {
  return Fn(() => {
    const uvNode = screenUV;
    const material = materialNode.sample(uvNode);
    const roughness = material.r;
    const reflectionClass = int(round(material.b.mul(255)));
    const rawDepth = rawDepthNode.sample(uvNode).r;
    const linearDepth = depthPyramid.levels[0].sample(uvNode).r;
    const normal = normalize(unpackRGBToNormal(normalNode.sample(uvNode).rgb));
    const viewPosition = reconstructViewPosition(
      uvNode,
      rawDepth,
      projectionMatrixInverse,
    );
    const incident = normalize(viewPosition);
    const reflectionDirection = normalize(reflect(incident, normal));
    const normalFacesCamera = normal.dot(incident.negate()).greaterThan(1e-4);
    const validDirection = reflectionDirection.z.lessThan(0.25);
    const eligible = reflectionClass.notEqual(REFLECTION_CLASSES.NONE)
      .and(roughness.lessThanEqual(roughnessCutoff))
      .and(rawDepth.lessThan(0.9999))
      .and(linearDepth.lessThan(SSR_BACKGROUND_DEPTH_METERS))
      .and(normalFacesCamera)
      .and(validDirection);

    const hit = float(0).toVar();
    const hitUv = uvNode.toVar();
    const rayDistance = max(thicknessMeters.mul(2), float(0.05)).toVar();
    const previousDistance = float(0).toVar();
    const mip = int(Math.min(5, depthPyramid.levels.length - 1)).toVar();
    const active = eligible.toVar();
    const baseStep = maxDistanceMeters.div(max(float(maxSteps), 1));

    Loop(64, ({ i }) => {
      If(active.not().or(i.greaterThanEqual(maxSteps)), () => {
        Break();
      });
      previousDistance.assign(rayDistance);
      rayDistance.addAssign(baseStep.mul(exp2(float(mip))));
      const candidate = viewPosition.add(reflectionDirection.mul(rayDistance));
      const candidateUv = projectViewPosition(candidate, projectionMatrix);
      If(uvCoverage(candidateUv).not().or(rayDistance.greaterThan(maxDistanceMeters)), () => {
        active.assign(false);
        Break();
      });

      const sceneDepth = sampleDepthLevel(depthPyramid, mip, candidateUv);
      const rayDepth = candidate.z.negate();
      const crossed = rayDepth.greaterThanEqual(sceneDepth);
      If(crossed, () => {
        If(mip.greaterThan(0), () => {
          rayDistance.assign(previousDistance);
          mip.subAssign(1);
        }).Else(() => {
          If(rayDepth.sub(sceneDepth).lessThanEqual(thicknessMeters), () => {
            hit.assign(1);
            hitUv.assign(candidateUv);
            Break();
          });
        });
      }).Else(() => {
        mip.assign(min(mip.add(1), depthPyramid.levels.length - 1));
      });
    });

    const lowDistance = previousDistance.toVar();
    const highDistance = rayDistance.toVar();
    Loop(8, ({ i }) => {
      If(hit.lessThan(0.5).or(i.greaterThanEqual(binarySteps)), () => {
        Break();
      });
      const middle = lowDistance.add(highDistance).mul(0.5);
      const candidate = viewPosition.add(reflectionDirection.mul(middle));
      const candidateUv = projectViewPosition(candidate, projectionMatrix);
      const sceneDepth = depthPyramid.levels[0].sample(candidateUv).r;
      If(candidate.z.negate().greaterThanEqual(sceneDepth), () => {
        highDistance.assign(middle);
        hitUv.assign(candidateUv);
      }).Else(() => {
        lowDistance.assign(middle);
      });
    });

    const edgeDistance = min(
      min(hitUv.x, float(1).sub(hitUv.x)),
      min(hitUv.y, float(1).sub(hitUv.y)),
    );
    const safeEdgeFade = max(edgeFade, 1e-5);
    const edgeWeight = edgeFade.lessThanEqual(1e-5).select(
      float(1),
      smoothstep(0, safeEdgeFade, edgeDistance),
    );
    const safeRoughnessCutoff = max(roughnessCutoff, 1e-4);
    const roughnessWeight = float(1).sub(smoothstep(
      safeRoughnessCutoff.mul(0.5),
      safeRoughnessCutoff,
      roughness,
    ));
    const facing = clamp(normal.dot(incident.negate()), 0, 1);
    const f0 = reflectionF0Node(reflectionClass);
    const fresnel = f0.add(float(1).sub(f0).mul(float(1).sub(facing).pow(5)));
    const weight = hit
      .mul(edgeWeight)
      .mul(roughnessWeight)
      .mul(fresnel)
      .mul(intensity);
    const reflectedColour = sourceNode.sample(hitUv).rgb.max(vec3(0));
    return vec4(reflectedColour.mul(weight), weight);
  })();
}

function buildTemporalResolve({
  traceNode,
  velocityNode,
  materialNode,
  currentDepthNode,
  historyColourNode,
  historyDepthNode,
  historyValid,
  temporalFeedback,
}) {
  return Fn(() => {
    const current = traceNode.sample(screenUV);
    const velocity = velocityNode.sample(screenUV).rg;
    const previousUv = screenUV.sub(vec2(velocity.x.mul(0.5), velocity.y.mul(-0.5)));
    const history = historyColourNode.sample(previousUv);
    const currentDepth = currentDepthNode.sample(screenUV).r;
    const previousDepth = historyDepthNode.sample(previousUv).r;
    const depthThreshold = max(0.05, currentDepth.mul(0.02));
    const depthAccepted = currentDepth
      .sub(previousDepth)
      .abs()
      .lessThanEqual(depthThreshold);
    const reactive = materialNode.sample(screenUV).g;
    const accepted = uvCoverage(previousUv)
      .and(depthAccepted)
      .select(float(1).sub(clamp(reactive, 0, 1)), float(0))
      .mul(historyValid);
    const feedback = temporalFeedback.mul(accepted);
    return mix(current, history, feedback);
  })();
}

export class SelectiveSsrNode {
  constructor({
    sourceNode,
    inputs,
    depthPyramid,
    history,
    settings,
  }) {
    this.settings = settings;
    this.history = history;
    this.depthPyramid = depthPyramid;
    this.resolutionScale = settings.resolutionScale;
    this.disposed = false;

    this.projectionMatrix = uniform(new THREE.Matrix4());
    this.projectionMatrixInverse = uniform(new THREE.Matrix4());
    this.maxSteps = uniform(settings.maxSteps, 'int');
    this.binarySteps = uniform(settings.binarySteps, 'int');
    this.maxDistanceMeters = uniform(settings.maxDistanceMeters);
    this.thicknessMeters = uniform(settings.thicknessMeters);
    this.roughnessCutoff = uniform(settings.roughnessCutoff);
    this.intensity = uniform(settings.intensity);
    this.edgeFade = uniform(settings.edgeFade);
    this.temporalFeedback = uniform(settings.temporalFeedback);
    this.historyValid = uniform(0);

    history.ensureSsrResources(1, 1);
    this.historyColourTexture = texture(history.ssrReadColourTarget.texture);
    this.historyDepthTexture = texture(history.ssrReadDepthTarget.texture);

    this.traceNode = createHdrTarget(buildTrace({
      sourceNode,
      rawDepthNode: inputs.depth,
      normalNode: inputs.normal,
      materialNode: inputs.material,
      depthPyramid,
      projectionMatrix: this.projectionMatrix,
      projectionMatrixInverse: this.projectionMatrixInverse,
      maxSteps: this.maxSteps,
      binarySteps: this.binarySteps,
      maxDistanceMeters: this.maxDistanceMeters,
      thicknessMeters: this.thicknessMeters,
      roughnessCutoff: this.roughnessCutoff,
      intensity: this.intensity,
      edgeFade: this.edgeFade,
    }));

    const currentDepth = depthPyramid.levels[0];
    this.depthWriteNode = rtt(vec4(currentDepth.sample(screenUV).r), 1, 1, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });
    this.depthWriteNode.renderTarget.dispose();
    bindWriteTarget(this.depthWriteNode, history.ssrWriteDepthTarget);

    this.temporalNode = createHdrTarget(buildTemporalResolve({
      traceNode: this.traceNode,
      velocityNode: inputs.velocity,
      materialNode: inputs.material,
      currentDepthNode: this.depthWriteNode,
      historyColourNode: this.historyColourTexture,
      historyDepthNode: this.historyDepthTexture,
      historyValid: this.historyValid,
      temporalFeedback: this.temporalFeedback,
    }));
    this.temporalNode.renderTarget.dispose();
    bindWriteTarget(this.temporalNode, history.ssrWriteColourTarget);

    this.compositeNode = createHdrTarget(Fn(() => {
      const source = sourceNode.sample(screenUV);
      const reflection = this.temporalNode.sample(screenUV);
      // SSR is an additive screen-reflection component. In particular, water's
      // authored refraction/absorption remains in the source colour.
      return vec4(source.rgb.add(reflection.rgb), source.a);
    })());
    this.outputNode = this.compositeNode;
  }

  updateUniforms(frameState, settings = this.settings) {
    this.settings = settings;
    this.projectionMatrix.value.copy(frameState.camera.projectionMatrix);
    this.projectionMatrixInverse.value.copy(frameState.camera.projectionMatrixInverse);
    this.maxSteps.value = settings.maxSteps;
    this.binarySteps.value = settings.binarySteps;
    this.maxDistanceMeters.value = settings.maxDistanceMeters;
    this.thicknessMeters.value = settings.thicknessMeters;
    this.roughnessCutoff.value = settings.roughnessCutoff;
    this.intensity.value = settings.intensity;
    this.edgeFade.value = settings.edgeFade;
    this.temporalFeedback.value = settings.temporalFeedback;
    this.historyValid.value = this.history.ssrValid ? 1 : 0;
    this.historyColourTexture.value = this.history.ssrReadColourTarget.texture;
    this.historyDepthTexture.value = this.history.ssrReadDepthTarget.texture;
    bindWriteTarget(this.depthWriteNode, this.history.ssrWriteDepthTarget);
    bindWriteTarget(this.temporalNode, this.history.ssrWriteColourTarget);
  }

  resize(width, height) {
    const scaledWidth = Math.max(1, Math.floor(width * this.resolutionScale));
    const scaledHeight = Math.max(1, Math.floor(height * this.resolutionScale));
    this.history.ensureSsrResources(scaledWidth, scaledHeight);
    this.traceNode.setSize(scaledWidth, scaledHeight);
    this.compositeNode.setSize(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.traceNode._quadMesh?.material?.dispose();
    this.traceNode.renderTarget.dispose();
    this.depthWriteNode._quadMesh?.material?.dispose();
    this.temporalNode._quadMesh?.material?.dispose();
    this.compositeNode._quadMesh?.material?.dispose();
    this.compositeNode.renderTarget.dispose();
  }
}
