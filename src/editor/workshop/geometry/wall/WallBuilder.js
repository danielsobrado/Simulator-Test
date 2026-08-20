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

function pushQuad(target, a, b, c, d, region) {
  const startVertex = target.positions.length / 3;
  const normal = faceNormal(a, b, c);
  for (const vertex of [a, b, c, d]) {
    target.positions.push(...vertex);
    target.normals.push(...normal);
  }
  target.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
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

export function buildWallMeshData(plan) {
  if (!plan || !Array.isArray(plan.sections) || plan.sections.length < 2) {
    throw new Error('Wall builder requires a wall geometry plan.');
  }
  const target = { positions: [], normals: [], uvs: [], indices: [], groups: [] };
  const elevation = plan.wall.elevation;
  const top = elevation + plan.wall.height;
  for (let index = 0; index < plan.sections.length - 1; index += 1) {
    const current = plan.sections[index];
    const next = plan.sections[index + 1];
    const segmentId = current.segmentId === next.segmentId ? current.segmentId : next.segmentId;
    const regions = plan.surfaceDomains.filter((region) => region.segmentId === segmentId);
    const sideA = regions.find(({ side }) => side === 'a');
    const sideB = regions.find(({ side }) => side === 'b');
    const topRegion = regions.find(({ side }) => side === 'top');
    pushQuad(target,
      point3(current.left, elevation), point3(next.left, elevation),
      point3(next.left, top), point3(current.left, top), sideA);
    pushQuad(target,
      point3(current.right, elevation), point3(current.right, top),
      point3(next.right, top), point3(next.right, elevation), sideB);
    pushQuad(target,
      point3(current.left, top), point3(next.left, top),
      point3(next.right, top), point3(current.right, top), topRegion);
  }
  const first = plan.sections[0];
  const last = plan.sections.at(-1);
  const capFamily = 'walls';
  pushQuad(target,
    point3(first.right, elevation), point3(first.left, elevation),
    point3(first.left, top), point3(first.right, top),
    { id: `${plan.wallId}:cap-start`, family: capFamily });
  pushQuad(target,
    point3(last.left, elevation), point3(last.right, elevation),
    point3(last.right, top), point3(last.left, top),
    { id: `${plan.wallId}:cap-end`, family: capFamily });
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
