import { exp, float, fract, max, mix, oneMinus, sin, smoothstep, vec2 } from 'three/tsl';
import { SEA_SWELL_COMPONENTS } from '../water/SeaSwell.js';
import { periodicFbm2 } from './PeriodicNoiseNodes.js';

/** Depth-following surf on an arbitrary coast; all pattern origins are bounded. */
export function createSeaFoamNoise(patterns, localXZ, time) {
  const point=patterns.latticePoint('surfLace',localXZ)
    .add(vec2(time.mul(0.021).mod(512),time.mul(-0.013).mod(512)));
  // Independent, bounded phases warp the lattice without creating chunk seams.
  // The old sea-normal height channel repeated the same crest stamp every 5 m.
  const warp=vec2(
    sin(patterns.wavePhase('surfLaceWarpX',localXZ).add(time.mul(0.031).mod(Math.PI*2))),
    sin(patterns.wavePhase('surfLaceWarpZ',localXZ).sub(time.mul(0.023).mod(Math.PI*2))),
  ).mul(0.85);
  const warped = point.add(warp);
  return periodicFbm2(warped).mul(.7)
    .add(periodicFbm2(warped.mul(4).add(vec2(19.3, 7.1))).mul(.3)).toVar('seaFoamField');
}

export function createSeaSurfNodes({ swell, waterDepth, localXZ, patterns, time, settings }) {
  if (!settings.enabled || !patterns) return null;
  const wave = SEA_SWELL_COMPONENTS[0];
  const along = patterns.wavePhase('surfAlong', localXZ);
  const group = patterns.wavePhase('surfGroup', localXZ)
    .add(time.mul(wave.angularSpeed * settings.setGroup).mod(Math.PI * 2));
  const set = oneMinus(sin(group.add(sin(along).mul(1.6))).mul(0.5).add(0.5).mul(settings.setDepth));
  // Increasing depth advances phase; positive time sends each crest ashore.
  const phase = float(wave.phase).add(time.mul(wave.angularSpeed).mod(Math.PI * 2))
    .add(sin(along).mul(settings.phaseWarp)).add(waterDepth.mul(settings.depthPhaseScale));
  const s = sin(phase);
  const near = s.add(s.mul(s).sub(0.5).mul(0.45)).div(1.225).mul(set);
  const offshore = smoothstep(settings.fadeStart, settings.fadeEnd, waterDepth);
  const lace = createSeaFoamNoise(patterns,localXZ,time);
  const age = fract(phase.sub(Math.PI / 2).div(Math.PI * 2));
  const zone = smoothstep(settings.breakDepthStart, settings.breakDepthFull, waterDepth)
    .mul(oneMinus(smoothstep(settings.breakDepthFade, settings.breakDepthEnd, waterDepth)))
    .mul(smoothstep(1 - settings.setDepth * 0.6 - 0.001, 1 - settings.setDepth * 0.1, set))
    .mul(oneMinus(offshore));
  const roll = smoothstep(0.92, 0.985, age).mul(smoothstep(0.5, 0.8, lace));
  const trail = exp(age.mul(-settings.trail))
    .mul(smoothstep(age.mul(0.5).add(0.45), age.mul(0.5).add(0.7), lace));
  // Over a gently shelving bed the depth term crowds crests closer than a
  // pixel; drawn there they aliased into white fingerprint whorls.
  const resolved = oneMinus(smoothstep(0.35, 1.1, phase.fwidth()));
  return {
    foamNoise: lace,
    height: mix(near, swell.height, offshore),
    offshore,
    foam: max(roll, trail).mul(zone).mul(resolved).mul(float(settings.strength)),
  };
}
