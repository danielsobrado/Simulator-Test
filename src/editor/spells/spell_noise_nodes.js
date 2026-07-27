import { float, floor, fract, mix, sin, vec3 } from "three/tsl";
function createSpellNoiseNodes(params) {
  const { hashSeed, fbmFreqMul, fbmOffset, octaves = 5 } = params;
  const hash = (n) => fract(sin(n).mul(hashSeed));
  const noise = (x) => {
    const p = floor(x);
    const f0 = fract(x);
    const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
    const n = p.x.add(p.y.mul(157)).add(p.z.mul(113));
    return mix(
      mix(
        mix(hash(n.add(0)), hash(n.add(1)), f.x),
        mix(hash(n.add(157)), hash(n.add(158)), f.x),
        f.y
      ),
      mix(
        mix(hash(n.add(113)), hash(n.add(114)), f.x),
        mix(hash(n.add(270)), hash(n.add(271)), f.x),
        f.y
      ),
      f.z
    );
  };
  const fbm = (p0) => {
    let p = p0;
    let value = float(0);
    let amp = 0.5;
    for (let i = 0; i < octaves; i++) {
      value = value.add(noise(p).mul(amp));
      p = p.mul(fbmFreqMul).add(vec3(fbmOffset[0], fbmOffset[1], fbmOffset[2]));
      amp *= 0.5;
    }
    return value;
  };
  return { noise, fbm };
}
export {
  createSpellNoiseNodes
};
