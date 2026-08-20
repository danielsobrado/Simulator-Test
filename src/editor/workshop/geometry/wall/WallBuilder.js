function point3(point2, y) {
  return [point2[0], y, point2[1]];
}

function faceNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...normal) || 1;
  return normal.map((value) => value / length);
}

function pushQuad(target, a, b, c, d, region, uvs) {
  if (!region?.id || !region?.family) throw new Error('Wall mesh quad requires a material region.');
  if (!Array.isArray(uvs) || uvs.length !== 8 || uvs.some((value) => !Number.isFinite(value))) {
    throw new Error(`Wall mesh region ${region.id} requires four finite UV coordinates.`);
  }
  const startVertex = target.positions.length / 3;
  const normal = faceNormal(a, b, c);
  for (const vertex of [a, b, c, d]) {
    target.positions.push(...vertex);
    target.normals.push(...normal);
  }
  target.uvs.push(...uvs);
  const indexStart = target.indices.length;
  target.indices.push(
    startVertex, startVertex + 1, startVertex + 2,
    startVertex, startVertex + 2, startVertex + 3,
  );
  target.groups.push(Object.freeze({
    regionId: region.id,
    family: region.family,
    start: indexStart,
    count: 6,
  }));
}

function regionFor(plan, segmentId, side) {
  const region = plan.surfaceDomains.find((candidate) => (
    candidate.segmentId === segmentId && candidate.side === side
  ));
  if (!region) throw new Error(`Wall plan ${plan.wallId} is missing ${segmentId}:${side}.`);
  return region;
}

function segmentDistance(section, segmentId) {
  if (section.segmentId === segmentId) return section.segmentDistance ?? 0;
  return 0;
}

export function buildWallMeshData(plan) {
  if (!plan || !Array.isArray(plan.sections) || plan.sections.length < 2) {
    throw new Error('Wall builder requires a wall geometry plan.');
  }
  const target = { positions: [], normals: [], uvs: [], indices: [], groups: [] };
  const elevation = plan.wall.elevation;
  const top = elevation + plan.wall.height;
  const height = plan.wall.height;
  const thickness = plan.wall.thickness;
  for (let index = 0; index < plan.sections.length - 1; index += 1) {
    const current = plan.sections[index];
    const next = plan.sections[index + 1];
    const segmentId = current.segmentId === next.segmentId ? current.segmentId : next.segmentId;
    const u0 = segmentDistance(current, segmentId);
    const u1 = segmentDistance(next, segmentId);
    const sideA = regionFor(plan, segmentId, 'a');
    const sideB = regionFor(plan, segmentId, 'b');
    const topRegion = regionFor(plan, segmentId, 'top');
    const bottomRegion = regionFor(plan, segmentId, 'bottom');
    pushQuad(
      target,
      point3(current.left, elevation), point3(next.left, elevation),
      point3(next.left, top), point3(current.left, top),
      sideA,
      [u0, 0, u1, 0, u1, height, u0, height],
    );
    pushQuad(
      target,
      point3(current.right, elevation), point3(current.right, top),
      point3(next.right, top), point3(next.right, elevation),
      sideB,
      [u0, 0, u0, height, u1, height, u1, 0],
    );
    pushQuad(
      target,
      point3(current.left, top), point3(next.left, top),
      point3(next.right, top), point3(current.right, top),
      topRegion,
      [u0, 0, u1, 0, u1, thickness, u0, thickness],
    );
    pushQuad(
      target,
      point3(current.right, elevation), point3(next.right, elevation),
      point3(next.left, elevation), point3(current.left, elevation),
      bottomRegion,
      [u0, 0, u1, 0, u1, thickness, u0, thickness],
    );
  }
  const first = plan.sections[0];
  const last = plan.sections.at(-1);
  const capFamily = 'walls';
  pushQuad(
    target,
    point3(first.right, elevation), point3(first.left, elevation),
    point3(first.left, top), point3(first.right, top),
    { id: `${plan.wallId}:cap-start`, family: capFamily },
    [0, 0, thickness, 0, thickness, height, 0, height],
  );
  pushQuad(
    target,
    point3(last.left, elevation), point3(last.right, elevation),
    point3(last.right, top), point3(last.left, top),
    { id: `${plan.wallId}:cap-end`, family: capFamily },
    [0, 0, thickness, 0, thickness, height, 0, height],
  );
  return Object.freeze({
    positions: Object.freeze(target.positions),
    normals: Object.freeze(target.normals),
    uvs: Object.freeze(target.uvs),
    indices: Object.freeze(target.indices),
    groups: Object.freeze(target.groups),
  });
}

export async function buildWallBufferGeometry(plan) {
  const THREE = await import('three/webgpu');
  const mesh = buildWallMeshData(plan);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(mesh.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(mesh.uvs, 2));
  geometry.setIndex(mesh.indices);
  const materialFamilies = [...new Set(mesh.groups.map(({ family }) => family))].sort();
  const materialIndex = new Map(materialFamilies.map((family, index) => [family, index]));
  for (const group of mesh.groups) geometry.addGroup(group.start, group.count, materialIndex.get(group.family));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.workshopWallId = plan.wallId;
  geometry.userData.workshopMaterialRegions = mesh.groups;
  return Object.freeze({ geometry, materialFamilies: Object.freeze(materialFamilies) });
}
