import * as THREE from 'three';
import { QUARTER_TURN_RADIANS } from '../constants.js';
import { evaluateObjectSurface } from '../TerrainPlacement.js';
import {
  canonicalWorldToRenderLocal,
  cellBoundsCenterToCanonicalWorld,
} from '../world/CoordinateSpaces.js';

const FOUNDATION_OVERLAP = 0.04;
const FOUNDATION_FOOTPRINT_SCALE = 0.96;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function requireDefinition(definitionByKey, definitionKey) {
  const definition = definitionByKey.get(definitionKey);
  if (!definition) throw new Error(`Unknown object definition: ${definitionKey}.`);
  return definition;
}

export function resolveObjectCanonicalCenter({ object, objectMap, tileSize }) {
  if (!object) throw new Error('Object placement is required.');
  const bounds = objectMap.getBounds(
    object.x,
    object.z,
    object.definitionKey,
    object.rotation,
  );
  return cellBoundsCenterToCanonicalWorld(bounds, tileSize);
}

export class ObjectPlacementResolver {
  constructor({
    objectMap,
    definitionByKey,
    heightField,
    tileSize,
    floatingOrigin,
  }) {
    this.objectMap = objectMap;
    this.definitionByKey = definitionByKey;
    this.heightField = heightField;
    this.tileSize = tileSize;
    this.floatingOrigin = floatingOrigin;
  }

  resolve(object) {
    const definition = requireDefinition(this.definitionByKey, object.definitionKey);
    const bounds = this.objectMap.getBounds(
      object.x,
      object.z,
      object.definitionKey,
      object.rotation,
    );
    const evaluation = evaluateObjectSurface({
      definition,
      heightField: this.heightField,
      bounds,
      tileSize: this.tileSize,
    });
    return Object.freeze({ definition, bounds, ...evaluation });
  }

  canonicalCenter(bounds) {
    return cellBoundsCenterToCanonicalWorld(bounds, this.tileSize);
  }

  renderCenter(bounds) {
    const canonical = this.canonicalCenter(bounds);
    return canonicalWorldToRenderLocal(canonical.x, canonical.z, this.floatingOrigin);
  }

  createObjectMatrix(object, surfaceOverride = null) {
    const placement = surfaceOverride
      ? {
        bounds: this.objectMap.getBounds(
          object.x,
          object.z,
          object.definitionKey,
          object.rotation,
        ),
        definition: requireDefinition(this.definitionByKey, object.definitionKey),
        surface: surfaceOverride,
      }
      : this.resolve(object);
    const center = this.renderCenter(placement.bounds);
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      WORLD_UP,
      -object.rotation * QUARTER_TURN_RADIANS,
    );
    let quaternion = yaw;

    if (placement.definition.foundation.alignToNormal) {
      const normal = new THREE.Vector3(
        placement.surface.normal.x,
        placement.surface.normal.y,
        placement.surface.normal.z,
      );
      const alignment = new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normal);
      quaternion = alignment.multiply(yaw);
    }

    return new THREE.Matrix4().compose(
      new THREE.Vector3(center.x, placement.surface.baseHeight, center.z),
      quaternion,
      new THREE.Vector3(1, 1, 1),
    );
  }

  createFoundationMatrix(bounds, surface) {
    const center = this.renderCenter(bounds);
    const depth = surface.foundationDepth + FOUNDATION_OVERLAP;
    return new THREE.Matrix4().compose(
      new THREE.Vector3(center.x, surface.baseHeight - depth / 2, center.z),
      new THREE.Quaternion(),
      new THREE.Vector3(
        bounds.width * this.tileSize * FOUNDATION_FOOTPRINT_SCALE,
        depth,
        bounds.depth * this.tileSize * FOUNDATION_FOOTPRINT_SCALE,
      ),
    );
  }
}
