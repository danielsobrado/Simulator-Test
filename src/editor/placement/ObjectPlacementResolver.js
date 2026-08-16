import * as THREE from 'three';
import { QUARTER_TURN_RADIANS } from '../constants.js';
import { registerCollisionObjectSource } from '../collision/CollisionPlayerBridge.js';
import { ensureCollisionP6QaFixture } from '../collision/CollisionP6QaFixture.js';
import { evaluateObjectSurface } from '../TerrainPlacement.js';
import {
  canonicalWorldToRenderLocal,
  cellBoundsCenterToCanonicalWorld,
} from '../world/CoordinateSpaces.js';

const FOUNDATION_OVERLAP = 0.04;
const FOUNDATION_FOOTPRINT_SCALE = 0.96;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);

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
    this.releaseCollisionObjectSource = null;
    this.pagehideTarget = null;
    this.pagehideListener = null;
    if (typeof window !== 'undefined') {
      ensureCollisionP6QaFixture(objectMap, window.location.search);
      this.releaseCollisionObjectSource = registerCollisionObjectSource({
        objectMap,
        placementResolver: this,
        objectCatalog: [...definitionByKey.values()],
        tileSize,
      });
      this.pagehideTarget = window;
      this.pagehideListener = () => {
        this.releaseCollisionRegistration();
        this.pagehideTarget = null;
      };
      window.addEventListener('pagehide', this.pagehideListener, { once: true });
    }
  }

  releaseCollisionRegistration() {
    this.releaseCollisionObjectSource?.();
    this.releaseCollisionObjectSource = null;
  }

  dispose() {
    if (this.pagehideTarget && this.pagehideListener) {
      this.pagehideTarget.removeEventListener('pagehide', this.pagehideListener);
    }
    this.pagehideTarget = null;
    this.pagehideListener = null;
    this.releaseCollisionRegistration();
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

  createPlacementQuaternion(object, definition, surface) {
    const yaw = new THREE.Quaternion().setFromAxisAngle(
      WORLD_UP,
      -object.rotation * QUARTER_TURN_RADIANS,
    );
    if (!definition.foundation.alignToNormal) return yaw;
    const normal = new THREE.Vector3(surface.normal.x, surface.normal.y, surface.normal.z);
    return new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normal).multiply(yaw);
  }

  placementFor(object, surfaceOverride = null) {
    if (!surfaceOverride) return this.resolve(object);
    return {
      bounds: this.objectMap.getBounds(
        object.x,
        object.z,
        object.definitionKey,
        object.rotation,
      ),
      definition: requireDefinition(this.definitionByKey, object.definitionKey),
      surface: surfaceOverride,
    };
  }

  createCanonicalObjectMatrix(object, surfaceOverride = null) {
    const placement = this.placementFor(object, surfaceOverride);
    const center = this.canonicalCenter(placement.bounds);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(center.x, placement.surface.baseHeight, center.z),
      this.createPlacementQuaternion(object, placement.definition, placement.surface),
      UNIT_SCALE,
    );
  }

  createObjectMatrix(object, surfaceOverride = null) {
    const placement = this.placementFor(object, surfaceOverride);
    const center = this.renderCenter(placement.bounds);
    return new THREE.Matrix4().compose(
      new THREE.Vector3(center.x, placement.surface.baseHeight, center.z),
      this.createPlacementQuaternion(object, placement.definition, placement.surface),
      UNIT_SCALE,
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
