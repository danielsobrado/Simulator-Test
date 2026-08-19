import {
  abs,
  cameraViewMatrix,
  faceDirection,
  max,
  oneMinus,
  positionView,
  transformDirection,
  vec3,
} from 'three/tsl';

function decodeUpperHemisphereOctNormal(encoded) {
  const x = encoded.r;
  const z = encoded.g;
  const y = max(0, oneMinus(abs(x).add(abs(z))));
  return vec3(x, y, z).normalize();
}

export function createTerrainSurfaceNormal({ encodedNormal, detailHeight, detailStrength }) {
  const worldNormal = decodeUpperHemisphereOctNormal(encodedNormal);
  const surfaceNormal = transformDirection(worldNormal, cameraViewMatrix);
  const sigmaX = positionView.dFdx().normalize();
  const sigmaY = positionView.dFdy().normalize();
  const r1 = sigmaY.cross(surfaceNormal);
  const r2 = surfaceNormal.cross(sigmaX);
  const determinant = sigmaX.dot(r1).mul(faceDirection);
  const gradient = determinant.sign().mul(
    detailHeight.dFdx().mul(r1)
      .add(detailHeight.dFdy().mul(r2))
      .mul(detailStrength),
  );
  return abs(determinant).mul(surfaceNormal).sub(gradient).normalize();
}
