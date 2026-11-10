import { frameUniform } from '../../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import {
  attribute, cameraPosition, cameraWorldMatrix, color, cos, dot, float, fract, mix, normalize, positionGeometry,
  positionWorld, sin, smoothstep, texture, time, uv, vec3,
} from 'three/tsl';

import { presetWeight, windFactor } from './ambientEffectsConfig.js';

const TWO_PI = Math.PI * 2;
const MIE_G = 0.65;
const SKY_GAIN = 0.55;
/** Plumes this close thin out, so a summit does not wall off the lens. */
const NEAR_FADE = [8, 40];
const PROMINENCE_DIRECTIONS = 12;
/** Metres around the focus searched for crests, and how far it moves before a rescan. */
const SCAN_HALF_WIDTH = 900;
const RESCAN_DISTANCE = 350;

/**
 * Summit and ridge points that stand clear of their surroundings, highest
 * first and at least `spacing` apart (after grass-test's findCrestAnchors).
 * `sampleHeight(x, z)` is the ground; `bounds` is { minX, maxX, minZ, maxZ }.
 */
export function findCrestAnchors(sampleHeight, bounds, {
  minHeight, step, prominenceRadius, minProminence, spacing, count,
}) {
  const candidates = [];
  for (let z = bounds.minZ + step; z < bounds.maxZ - step; z += step) {
    for (let x = bounds.minX + step; x < bounds.maxX - step; x += step) {
      const height = sampleHeight(x, z);
      if (!(height >= minHeight)) continue;
      let peak = true;
      for (let dz = -1; dz <= 1 && peak; dz += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if ((dx || dz) && sampleHeight(x + dx * step, z + dz * step) > height) { peak = false; break; }
        }
      }
      if (!peak) continue;
      let ring = 0;
      for (let index = 0; index < PROMINENCE_DIRECTIONS; index += 1) {
        const angle = index / PROMINENCE_DIRECTIONS * TWO_PI;
        ring += sampleHeight(x + Math.cos(angle) * prominenceRadius, z + Math.sin(angle) * prominenceRadius);
      }
      const prominence = height - ring / PROMINENCE_DIRECTIONS;
      if (prominence >= minProminence) candidates.push({ x, z, y: height, prominence });
    }
  }
  candidates.sort((a, b) => b.y + b.prominence - (a.y + a.prominence));
  const anchors = [];
  const spacingSquared = spacing * spacing;
  for (const candidate of candidates) {
    if (anchors.length >= count) break;
    if (anchors.some(({ x, z }) => (x - candidate.x) ** 2 + (z - candidate.z) ** 2 < spacingSquared)) continue;
    anchors.push(candidate);
  }
  return anchors;
}

/**
 * Spindrift banners streaming off the crests on the snow wind (after
 * grass-test's RidgePlumes): large soft puffs born at a crest, riding
 * downwind as they grow and fade, each plume breathing with its own gust. One
 * instanced draw.
 *
 * This world streams a planet, so crests are found around the focus above the
 * snow line, rescanned as the focus travels, and stored relative to the scan
 * centre (a render-space uniform places them, exact across origin snaps).
 * An AmbientEffectsSystem extra.
 */
export class RidgePlumes {
  constructor({ settings, light, sun, puffTexture, getHeight, getSnowLine }) {
    this.name = 'plumes';
    this.settings = settings;
    this.getHeight = getHeight;
    this.getSnowLine = getSnowLine;
    this.intensity = frameUniform(0);
    this.current = 0;
    this.scanCenter = null;
    this.anchorCount = 0;
    this.origin = frameUniform(new THREE.Vector3());
    this.windAxis = frameUniform(new THREE.Vector3(1, 0, 0));
    const total = settings.anchors * settings.puffs;
    this.anchorData = new Float32Array(total * 4);
    const puffIndex = new Float32Array(total);
    for (let index = 0; index < total; index += 1) puffIndex[index] = (index % settings.puffs) / settings.puffs;
    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.anchorAttribute = new THREE.InstancedBufferAttribute(this.anchorData, 4);
    this.geometry.setAttribute('plumeAnchor', this.anchorAttribute);
    this.geometry.setAttribute('plumePuff', new THREE.InstancedBufferAttribute(puffIndex, 1));
    this.material = this.createMaterial(light, sun, puffTexture);
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, total);
    this.mesh.name = 'ambient-ridge-plumes';
    const identity = new THREE.Matrix4();
    for (let index = 0; index < total; index += 1) this.mesh.setMatrixAt(index, identity);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
  }

  createMaterial(light, sun, puffTexture) {
    const s = this.settings;
    const anchor = attribute('plumeAnchor', 'vec4');
    const seed = anchor.w;
    const puff = attribute('plumePuff', 'float');
    const age = fract(time.div(s.lifetime).add(puff).add(seed.mul(7.13)));
    const along = this.windAxis;
    const across = vec3(this.windAxis.z.negate(), 0, this.windAxis.x);
    // Each puff leaves on a slightly different heading, so a plume fans out.
    const spread = fract(puff.mul(3.7).add(seed.mul(11.3))).sub(0.5);
    const travel = age.mul(s.length);
    const center = anchor.xyz.add(this.origin)
      .add(along.mul(travel))
      .add(across.mul(spread.mul(travel).mul(0.35).add(sin(time.mul(0.4).add(seed.mul(TWO_PI))).mul(age).mul(4))))
      .add(vec3(0, age.mul(s.rise).add(age.mul(age).mul(-s.rise * 0.4)), 0));
    const size = mix(float(s.size[0]), float(s.size[1]), age.sqrt());
    const spin = seed.mul(TWO_PI).add(age.mul(spread).mul(1.6));
    const corner = positionGeometry.xy;
    const turnedX = corner.x.mul(cos(spin)).sub(corner.y.mul(sin(spin)));
    const turnedY = corner.x.mul(sin(spin)).add(corner.y.mul(cos(spin)));
    const right = cameraWorldMatrix.element(0).xyz;
    const up = cameraWorldMatrix.element(1).xyz;

    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
    });
    material.name = 'ambient-ridge-plumes';
    material.positionNode = center.add(right.mul(turnedX.mul(size))).add(up.mul(turnedY.mul(size)));

    const sample = texture(puffTexture, uv());
    const variant = fract(seed.mul(5.1).add(puff.mul(2.3))).mul(4).floor();
    const density = variant.lessThan(1).select(sample.r, variant.lessThan(2).select(sample.g,
      variant.lessThan(3).select(sample.b, sample.a)));
    const life = smoothstep(0, 0.12, age).mul(smoothstep(0.45, 1, age).oneMinus());
    const gust = sin(time.mul(TWO_PI / 13).add(seed.mul(TWO_PI))).mul(0.5).add(0.5);
    const near = smoothstep(NEAR_FADE[0], NEAR_FADE[1], cameraPosition.distance(positionWorld));
    material.opacityNode = density.mul(life).mul(gust.mul(0.6).add(0.4)).mul(near).mul(s.opacity).mul(this.intensity);

    const mu = dot(normalize(positionWorld.sub(cameraPosition)), sun);
    const g2 = MIE_G * MIE_G;
    const phase = mu.mul(mu).add(1).mul((3 / (8 * Math.PI)) * (1 - g2) / (2 + g2))
      .div(mu.mul(-2 * MIE_G).add(1 + g2).pow(1.5));
    material.colorNode = color('#eef4fb').mul(light.sun.mul(phase.mul(2.2).add(0.8)).add(light.sky.mul(SKY_GAIN)))
      .mul(s.brightness);
    return material;
  }

  /** Find the crests around a canonical point and upload them relative to it. */
  rescan(centerX, centerZ) {
    const s = this.settings;
    const anchors = findCrestAnchors(this.getHeight, {
      minX: centerX - SCAN_HALF_WIDTH,
      maxX: centerX + SCAN_HALF_WIDTH,
      minZ: centerZ - SCAN_HALF_WIDTH,
      maxZ: centerZ + SCAN_HALF_WIDTH,
    }, {
      minHeight: this.getSnowLine(),
      step: s.step,
      prominenceRadius: s.prominenceRadius,
      minProminence: s.minProminence,
      spacing: s.spacing,
      count: s.anchors,
    });
    anchors.forEach((anchor, plume) => {
      const seed = ((plume * 0.618034) % 1 + 1) % 1;
      for (let puff = 0; puff < s.puffs; puff += 1) {
        this.anchorData.set([anchor.x - centerX, anchor.y, anchor.z - centerZ, seed], (plume * s.puffs + puff) * 4);
      }
    });
    this.anchorAttribute.needsUpdate = true;
    this.anchorCount = anchors.length;
    this.mesh.count = anchors.length * s.puffs;
    this.scanCenter = { x: centerX, z: centerZ };
  }

  update(delta, state) {
    const s = this.settings;
    const { focus, origin, weights, presetName, windiness, axis, step } = state;
    const x = focus.x + origin.x;
    const z = focus.z + origin.z;
    const inSnowCountry = (weights?.snow ?? 0) > 0.05;
    if (inSnowCountry && (!this.scanCenter
        || Math.hypot(x - this.scanCenter.x, z - this.scanCenter.z) > RESCAN_DISTANCE)) {
      this.rescan(x, z);
    }
    const target = inSnowCountry && this.anchorCount > 0
      ? Math.min(1, s.strength * presetWeight(s, presetName) * windFactor(windiness, s.windResponse))
      : 0;
    const next = step ? step(this.current, target) : target;
    this.current = next < 0.004 ? 0 : next;
    this.intensity.value = this.current;
    this.mesh.visible = this.current > 0 && this.mesh.count > 0;
    if (!this.scanCenter) return;
    this.origin.value.set(this.scanCenter.x - origin.x, 0, this.scanCenter.z - origin.z);
    if (axis) this.windAxis.value.set(axis.x, 0, axis.z);
  }

  getState() {
    return { intensity: Number(this.current.toFixed(3)), anchors: this.anchorCount };
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
