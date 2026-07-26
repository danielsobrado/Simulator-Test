import * as THREE from 'three/webgpu';
import { buildStraightSkeleton } from './ProceduralStraightSkeleton.js';
import {
  rectangleFootprint,
  subtractPolygonDiscs,
  unionRectangleFootprints,
} from './ProceduralWorkshopFootprint.js';
import { shingledRoofFaceGeometries } from './ProceduralWorkshopShingles.js';

const HEIGHT_TOLERANCE = 0.15;
const EPSILON = 1e-8;

function openRing(ring) {
  if (ring.length > 1
    && Math.abs(ring[0][0] - ring.at(-1)[0]) <= EPSILON
    && Math.abs(ring[0][1] - ring.at(-1)[1]) <= EPSILON) {
    return ring.slice(0, -1);
  }
  return ring;
}

function slopeDistance(point, sourceEdge) {
  const [[startX, startZ], [endX, endZ]] = sourceEdge;
  const dx = endX - startX;
  const dz = endZ - startZ;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) throw new Error('A roof face has a zero-length source edge.');
  return Math.abs(dx * (point[1] - startZ) - dz * (point[0] - startX)) / length;
}

function appendTriangulatedSurface({
  positions,
  indices,
  polygon,
  heightAt,
}) {
  const contourPoints = openRing(polygon[0]);
  const holePoints = polygon.slice(1).map(openRing);
  const contour = contourPoints.map(([x, z]) => new THREE.Vector2(x, z));
  const holes = holePoints.map((ring) => ring.map(([x, z]) => new THREE.Vector2(x, z)));
  const triangles = THREE.ShapeUtils.triangulateShape(contour, holes);
  const points = [...contourPoints, ...holePoints.flat()];
  const offset = positions.length / 3;
  for (const [x, z] of points) positions.push(x, heightAt([x, z]), z);
  for (const triangle of triangles) {
    let [a, b, c] = triangle;
    const pa = points[a];
    const pb = points[b];
    const pc = points[c];
    const ya = heightAt(pa);
    const yb = heightAt(pb);
    const yc = heightAt(pc);
    const ab = [pb[0] - pa[0], yb - ya, pb[1] - pa[1]];
    const ac = [pc[0] - pa[0], yc - ya, pc[1] - pa[1]];
    const normalY = ab[2] * ac[0] - ab[0] * ac[2];
    if (normalY < 0) [b, c] = [c, b];
    indices.push(offset + a, offset + b, offset + c);
  }
}

function surfaceGeometry(skeleton, {
  baseY,
  pitchDegrees,
  clipDiscs,
}) {
  const positions = [];
  const indices = [];
  const slope = Math.tan(THREE.MathUtils.degToRad(pitchDegrees));
  for (const face of skeleton.faces) {
    const polygons = subtractPolygonDiscs(face.points, clipDiscs);
    for (const polygon of polygons) {
      appendTriangulatedSurface({
        positions,
        indices,
        polygon,
        heightAt: (point) => baseY + slopeDistance(point, face.sourceEdge) * slope,
      });
    }
  }
  if (indices.length === 0) throw new Error('Tower clipping removed the entire roof.');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const nonIndexed = geometry.toNonIndexed();
  geometry.dispose();
  return nonIndexed;
}

function clippedSkeletonFaces(skeleton, clipDiscs) {
  return skeleton.faces.flatMap((face) => (
    subtractPolygonDiscs(face.points, clipDiscs).map((polygon) => ({
      sourceEdge: face.sourceEdge,
      rings: polygon.map(openRing),
    }))
  ));
}

function flatGeometry(polygon, {
  baseY,
  thickness = 0.25,
  clipDiscs,
}) {
  const clipped = subtractPolygonDiscs(polygon, clipDiscs);
  const geometries = [];
  for (const resultPolygon of clipped) {
    const outer = openRing(resultPolygon[0]);
    const shape = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, z)));
    for (const holeRing of resultPolygon.slice(1)) {
      const hole = new THREE.Path(openRing(holeRing).map(
        ([x, z]) => new THREE.Vector2(x, z),
      ));
      shape.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 1,
      steps: 1,
    });
    geometry.rotateX(Math.PI / 2);
    geometry.translate(0, baseY + thickness, 0);
    geometries.push(geometry);
  }
  if (geometries.length !== 1) {
    throw new Error('A flat roof was split into unsupported disconnected pieces.');
  }
  return geometries[0];
}

function gableGeometries(primitive, {
  baseY,
  pitchDegrees,
  overhang,
}) {
  const [width, depth] = primitive.dimensions;
  const alongWidth = width >= depth;
  const halfLong = (alongWidth ? width : depth) / 2 + overhang;
  const halfShort = (alongWidth ? depth : width) / 2 + overhang;
  const ridgeHeight = baseY + halfShort * Math.tan(THREE.MathUtils.degToRad(pitchDegrees));
  const local = alongWidth
    ? [
      [-halfLong, -halfShort], [halfLong, -halfShort],
      [halfLong, halfShort], [-halfLong, halfShort],
      [-halfLong, 0], [halfLong, 0],
    ]
    : [
      [-halfShort, -halfLong], [halfShort, -halfLong],
      [halfShort, halfLong], [-halfShort, halfLong],
      [0, -halfLong], [0, halfLong],
    ];
  const radians = primitive.rotation * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const world = local.map(([x, z]) => [
    primitive.position[0] + cosine * x + sine * z,
    primitive.position[1] - sine * x + cosine * z,
  ]);
  const vertices = [
    [world[0], baseY], [world[1], baseY], [world[5], ridgeHeight],
    [world[0], baseY], [world[5], ridgeHeight], [world[4], ridgeHeight],
    [world[3], baseY], [world[4], ridgeHeight], [world[5], ridgeHeight],
    [world[3], baseY], [world[5], ridgeHeight], [world[2], baseY],
  ];
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(
    vertices.flatMap(([[x, z], y]) => [x, y, z]),
    3,
  ));
  roof.computeVertexNormals();

  const endIndices = alongWidth ? [[0, 3, 4], [1, 2, 5]] : [[0, 1, 4], [3, 2, 5]];
  const gables = new THREE.BufferGeometry();
  gables.setAttribute('position', new THREE.Float32BufferAttribute(
    endIndices.flatMap(([left, right, ridge]) => [
      world[left][0], baseY, world[left][1],
      world[right][0], baseY, world[right][1],
      world[ridge][0], ridgeHeight, world[ridge][1],
    ]),
    3,
  ));
  gables.computeVertexNormals();
  return {
    roof,
    gables,
    faces: [
      { sourceEdge: [world[0], world[1]], rings: [[world[0], world[1], world[5], world[4]]] },
      { sourceEdge: [world[2], world[3]], rings: [[world[2], world[3], world[4], world[5]]] },
    ],
  };
}

function groupByTop(rectangles) {
  const groups = [];
  for (const primitive of rectangles) {
    const top = primitive.elevation + primitive.height;
    let group = groups.find((entry) => Math.abs(entry.top - top) <= HEIGHT_TOLERANCE);
    if (!group) {
      group = { top, primitives: [] };
      groups.push(group);
    }
    group.primitives.push(primitive);
  }
  return groups.sort((left, right) => left.top - right.top);
}

function resolvedFamily(primitives) {
  if (primitives.length === 1) {
    const [primitive] = primitives;
    if (primitive.roofFamily !== 'auto') return primitive.roofFamily;
    const [width, depth] = primitive.dimensions;
    return Math.max(width, depth) / Math.min(width, depth) > 1.3 ? 'gable' : 'hip';
  }
  if (primitives.every(({ roofFamily }) => roofFamily === 'flat')) return 'flat';
  return 'hip';
}

function semantic(geometry, primitive, label) {
  geometry.userData.workshopSemantic = {
    id: primitive.id,
    label,
    kind: 'structure',
    attachmentSurface: null,
  };
  return geometry;
}

function roofPart(geometry, material, groupId, componentId, label, family = 'roof') {
  return {
    geometry,
    material,
    matrix: new THREE.Matrix4(),
    materialRegion: {
      id: groupId,
      componentId,
      label,
      family,
      connected: true,
    },
  };
}

export function createSkeletonRoofParts({
  recipe = null,
  rectangles,
  circles = [],
  roofMaterial,
  wallMaterial,
  roofPitch = recipe?.roofPitch ?? 38,
  roofOverhang = recipe?.roofOverhang ?? 0.35,
}) {
  const parts = [];
  const stats = {
    roofGroups: 0,
    roofSkeletonFallbacks: 0,
    roofGableDowngrades: 0,
    roofFlatDowngrades: 0,
    roofShingles: 0,
  };

  for (const heightGroup of groupByTop(rectangles)) {
    let components;
    try {
      components = unionRectangleFootprints(heightGroup.primitives, { overhang: roofOverhang });
    } catch {
      components = heightGroup.primitives.map((primitive) => ({
        polygon: rectangleFootprint(primitive, roofOverhang),
        primitiveIds: [primitive.id],
        fallback: true,
      }));
      stats.roofSkeletonFallbacks += heightGroup.primitives.length;
    }

    for (let componentIndex = 0; componentIndex < components.length; componentIndex += 1) {
      const component = components[componentIndex];
      const members = heightGroup.primitives.filter(({ id }) => component.primitiveIds.includes(id));
      const representative = members[0];
      const family = resolvedFamily(members);
      const groupId = `${representative.id}:roof:group-${componentIndex + 1}`;
      const clipDiscs = circles
        .filter((circle) => circle.elevation + circle.height >= heightGroup.top - HEIGHT_TOLERANCE)
        .map((circle) => ({ center: circle.position, radius: circle.radius }));
      stats.roofGroups += 1;

      // Staged, not pushed directly: a throw part-way through a component must
      // leave no geometry behind and must not add a fallback roof *alongside* a
      // main roof that was already emitted (15-…md: failed generation releases
      // all partially created geometry).
      const staged = [];
      try {
        if (family === 'flat') {
          const geometry = semantic(flatGeometry(component.polygon, {
            baseY: heightGroup.top,
            clipDiscs,
          }), representative, 'Flat roof');
          staged.push(roofPart(
            geometry,
            roofMaterial,
            groupId,
            representative.id,
            'Flat roof',
          ));
        } else if (family === 'gable' && members.length === 1 && clipDiscs.length === 0) {
          const geometries = gableGeometries(representative, {
            baseY: heightGroup.top,
            pitchDegrees: roofPitch,
            overhang: roofOverhang,
          });
          // Tiles are generated before anything is staged, so a tile-budget
          // failure cannot leave a roof behind.
          const shingleGeometries = recipe ? shingledRoofFaceGeometries(recipe, {
            faces: geometries.faces,
            baseY: heightGroup.top,
            pitchDegrees: roofPitch,
            seedOffset: stats.roofGroups * 100,
          }) : [];
          for (const geometry of shingleGeometries) geometry.deleteAttribute('uv');
          stats.roofShingles += shingleGeometries.length;
          staged.push(
            roofPart(
              semantic(geometries.roof, representative, 'Gable roof'),
              roofMaterial,
              groupId,
              representative.id,
              'Gable roof',
            ),
            roofPart(
              semantic(geometries.gables, representative, 'Gable panels'),
              wallMaterial,
              `${representative.id}:gable-panels`,
              representative.id,
              'Gable panels',
              'walls',
            ),
            ...shingleGeometries.map((geometry) => roofPart(
              semantic(geometry, representative, 'Gable roof tiles'),
              roofMaterial,
              groupId,
              representative.id,
              'Gable roof tiles',
            )),
          );
        } else {
          if (members.some(({ roofFamily }) => roofFamily === 'gable')) {
            stats.roofGableDowngrades += 1;
          }
          // A connected group cannot honour a per-primitive `flat` alongside a
          // pitched neighbour either. That downgrade was previously silent.
          if (members.some(({ roofFamily }) => roofFamily === 'flat')) {
            stats.roofFlatDowngrades += 1;
          }
          const skeleton = buildStraightSkeleton(component.polygon);
          const geometry = semantic(surfaceGeometry(skeleton, {
            baseY: heightGroup.top,
            pitchDegrees: roofPitch,
            clipDiscs,
          }), representative, 'Skeleton roof');
          const shingleGeometries = recipe ? shingledRoofFaceGeometries(recipe, {
            faces: clippedSkeletonFaces(skeleton, clipDiscs),
            baseY: heightGroup.top,
            pitchDegrees: roofPitch,
            seedOffset: stats.roofGroups * 100,
          }) : [];
          for (const shingle of shingleGeometries) shingle.deleteAttribute('uv');
          stats.roofShingles += shingleGeometries.length;
          staged.push(
            roofPart(
              geometry,
              roofMaterial,
              groupId,
              representative.id,
              'Main roof',
            ),
            ...shingleGeometries.map((shingle) => roofPart(
              semantic(shingle, representative, 'Skeleton roof tiles'),
              roofMaterial,
              groupId,
              representative.id,
              'Skeleton roof tiles',
            )),
          );
        }
        parts.push(...staged);
      } catch {
        for (const part of staged) part.geometry.dispose();
        staged.length = 0;
        stats.roofSkeletonFallbacks += 1;
        for (const primitive of members) {
          const roofHeight = Math.min(3, primitive.dimensions[1] * 0.42);
          const geometry = new THREE.ConeGeometry(
            Math.hypot(...primitive.dimensions) * 0.53,
            roofHeight,
            4,
          );
          geometry.rotateY(Math.PI / 4 + THREE.MathUtils.degToRad(primitive.rotation));
          geometry.translate(
            primitive.position[0],
            primitive.elevation + primitive.height + roofHeight / 2,
            primitive.position[1],
          );
          parts.push(roofPart(
            semantic(geometry, primitive, 'Fallback roof'),
            roofMaterial,
            `${primitive.id}:roof:fallback`,
            primitive.id,
            'Fallback roof',
          ));
        }
      }
    }
  }
  return { parts, stats: Object.freeze(stats) };
}
