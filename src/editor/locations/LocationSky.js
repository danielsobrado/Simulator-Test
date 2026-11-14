import * as THREE from 'three/webgpu';
import {
  acos, attribute, clamp, color, dot, exp, float, floor, hash, mix, mx_fractal_noise_float, mx_noise_float, normalize,
  positionLocal, pow, sin, smoothstep, time, vec2, vec3,
} from 'three/tsl';
import { fbm3 } from './gen/noise.js';

/**
 * The sky over an open-air location, from a lighting profile's `sky` entry: a
 * dome drawn behind everything, and far peaks standing in the haze beyond the
 * place itself. The world's own sky belongs to the world scene and its post
 * chain; a location draws straight to the canvas, so it carries this instead.
 */

const PEAK_COLUMNS = 180;
/** Radius and width of the halo ice crystals in the air draw round the sun, radians: the 22 degree halo. */
const HALO_RADIUS = 0.384, HALO_WIDTH = 0.024;
/** How far above or below the sun's own height its sundogs reach, as a share of the dome. */
const SUNDOG_HEIGHT = 0.05;

const unit = (direction) => {
  const length = Math.hypot(...direction);
  return vec3(direction[0] / length, direction[1] / length, direction[2] / length);
};

function skyColor(sky) {
  const toSky = normalize(positionLocal);
  const height = toSky.y;
  let tone = mix(color(sky.horizon), color(sky.zenith), pow(clamp(height, 0, 1), 0.45));

  const toSun = clamp(dot(toSky, unit(sky.sun.direction)), 0, 1);
  tone = tone.add(color(sky.sun.color).mul(
    pow(toSun, 1400).mul(sky.sun.disc).add(pow(toSun, 28).mul(0.4).add(pow(toSun, 5).mul(0.14)).mul(sky.sun.glow)),
  ));

  if (sky.sun.halo > 0) {
    // Diamond dust rings the sun, and flares into sundogs where the ring is level with it.
    const away = acos(clamp(dot(toSky, unit(sky.sun.direction)), -1, 1)).sub(HALO_RADIUS).div(HALO_WIDTH);
    const level = height.sub(sky.sun.direction[1] / Math.hypot(...sky.sun.direction)).div(SUNDOG_HEIGHT);
    const dogs = exp(level.mul(level).negate());
    tone = tone.add(color(sky.sun.color).mul(exp(away.mul(away).negate())).mul(dogs.mul(1.6).add(0.3))
      .mul(smoothstep(0, 0.08, height)).mul(sky.sun.halo));
  }

  // The dome flattened to a plane overhead, so cloud and aurora foreshorten toward the horizon.
  const overhead = toSky.xz.div(height.add(0.22));
  if (sky.clouds > 0) {
    const streak = mx_fractal_noise_float(vec3(overhead.x.mul(0.5), overhead.y.mul(1.7), time.mul(0.004)), 4, 2, 0.55);
    tone = mix(tone, color(sky.cloudColor), smoothstep(0.05, 0.6, streak).mul(smoothstep(0.02, 0.3, height)).mul(sky.clouds));
  }
  if (sky.stars > 0) {
    const cell = floor(toSky.mul(190));
    const star = smoothstep(0.9975, 1, hash(cell.x.add(cell.y.mul(157.3)).add(cell.z.mul(311.7))));
    tone = tone.add(star.mul(smoothstep(0.08, 0.5, height)).mul(sky.stars));
  }
  if (sky.aurora) {
    for (const [offset, phase] of [[0, 0], [0.9, 2.4]]) {
      // A curtain: a wandering ribbon across the northern sky, rayed along its length.
      const line = sin(overhead.x.mul(0.7).add(time.mul(0.03)).add(phase)).mul(0.5)
        .add(mx_noise_float(vec3(overhead.x.mul(0.35), time.mul(0.02), phase)).mul(0.6)).sub(1.1 + offset);
      const across = overhead.y.sub(line);
      const ribbon = exp(across.mul(across).mul(-9));
      const rays = mx_noise_float(vec2(overhead.x.mul(9).add(phase), time.mul(0.12))).mul(0.5).add(0.5);
      const curtain = ribbon.mul(rays.mul(0.75).add(0.25)).mul(smoothstep(0.06, 0.3, height));
      tone = tone.add(mix(color(sky.aurora.color), color(sky.aurora.crown), clamp(across.mul(1.6).add(0.3), 0, 1))
        .mul(curtain).mul(sky.aurora.strength));
    }
  }
  // Below the horizon the dome is the haze the land fades into.
  return mix(tone, color(sky.ground), smoothstep(0.02, -0.06, height));
}

/** A ridge of far mountains as one strip: snow above, rock below, sinking into the horizon haze. */
function createPeaks(sky) {
  const { radius, height, seed } = sky.peaks;
  const position = new Float32Array((PEAK_COLUMNS + 1) * 6);
  const shade = new Float32Array((PEAK_COLUMNS + 1) * 4);
  const indices = [];
  const ridge = (column) => {
    const angle = column / PEAK_COLUMNS * Math.PI * 2;
    const crest = fbm3(Math.cos(angle) * 2.2 + 9, Math.sin(angle) * 2.2 + 9, 0.5, seed, 4);
    const teeth = 1 - Math.abs(fbm3(Math.cos(angle) * 9 + 3, Math.sin(angle) * 9 + 3, 0.5, seed + 7, 2) * 2 - 1);
    return height * (0.3 + crest * 0.75 + teeth * 0.3);
  };
  const [sunX, , sunZ] = sky.sun.direction;
  for (let column = 0; column <= PEAK_COLUMNS; column += 1) {
    const angle = column / PEAK_COLUMNS * Math.PI * 2;
    const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius, top = ridge(column);
    position.set([x, -height * 0.2, z, x, top, z], column * 6);
    // A slope that falls away from the sun is in shade.
    const fall = (ridge(column + 1) - ridge(column - 1)) * (-Math.sin(angle) * sunX + Math.cos(angle) * sunZ);
    const lit = Math.min(1, Math.max(0, 0.5 + fall / height * 4));
    shade.set([0, lit, 1, lit], column * 4);
    if (column < PEAK_COLUMNS) indices.push(column * 2, column * 2 + 1, column * 2 + 2, column * 2 + 1, column * 2 + 3, column * 2 + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('peak', new THREE.BufferAttribute(shade, 2));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicNodeMaterial({ name: 'location-peaks', side: THREE.DoubleSide, fog: false, depthWrite: false });
  const peak = attribute('peak', 'vec2');
  // Spurs and gullies: without them a ridge is a paper cut-out lit one column at a time.
  const spur = mx_fractal_noise_float(vec3(positionLocal.x.mul(0.012), positionLocal.y.mul(0.02), positionLocal.z.mul(0.012)), 3, 2, 0.5);
  const snow = mix(color(sky.peaks.shade), color(sky.peaks.snow), smoothstep(0.3, 0.7, peak.y.add(spur.mul(0.9))));
  const body = mix(color(sky.peaks.rock), snow, smoothstep(0.15, 0.55, peak.x.add(spur.mul(0.35))));
  material.colorNode = mix(color(sky.ground), body, smoothstep(0, 0.5, peak.x).mul(float(1).sub(sky.peaks.haze)));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * @param {object} sky a resolved `lightingProfiles.*.sky` entry
 * @returns {{ group: THREE.Group, follow(camera: THREE.Camera): void }}
 */
export function createSky(sky) {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicNodeMaterial({ name: 'location-sky', side: THREE.BackSide, fog: false, depthWrite: false });
  material.colorNode = skyColor(sky);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  dome.frustumCulled = false;
  dome.renderOrder = -2;
  group.add(dome);
  if (sky.peaks) group.add(createPeaks(sky));
  return {
    group,
    /** The dome rides with the camera, just inside its far plane; the peaks stay where they stand. */
    follow(camera) {
      dome.position.copy(camera.position);
      dome.scale.setScalar(camera.far * 0.9);
    },
  };
}
