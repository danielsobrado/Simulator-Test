import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { COLLIDER_TYPE_MESH_INSTANCE } from '../colliders/ColliderRecords.js';
import {
  createCharacterCapsule,
  moveCharacterCapsule,
} from './CharacterCapsule.js';
import {
  capsuleOverlapsPrimitive,
  findPrimitiveSideContact,
} from './CharacterContacts.js';
import { findCharacterSupport } from './CharacterSupport.js';
import { tryCharacterStep } from './CharacterStep.js';
import {
  MAX_CHARACTER_SOLVER_ITERATIONS,
  MAX_CHARACTER_SUBSTEPS,
} from './CharacterMotorLimits.js';

const CONTACT_DEPTH_EPSILON = 1e-7;

function assertFinitePoint(point, name) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || !Number.isFinite(point.z)) {
    throw new Error(`Character motor ${name} must contain finite x, y, and z.`);
  }
}

function addUnique(target, value) {
  if (!target.includes(value)) target.push(value);
}

function copyPosition(position) {
  return Object.freeze({ x: position.x, y: position.y, z: position.z });
}

function copyNormal(normal) {
  return Object.freeze({
    x: normal?.x ?? 0,
    y: normal?.y ?? 1,
    z: normal?.z ?? 0,
  });
}

function safeDisplacement(displacement, maximumDistance) {
  const length = Math.hypot(displacement.x, displacement.z);
  if (!(length > maximumDistance)) return displacement;
  const scale = maximumDistance / length;
  return { x: displacement.x * scale, z: displacement.z * scale };
}

export class CharacterMotor {
  constructor({
    collisionRuntime,
    terrainProvider,
    config,
    stepHeight,
    groundSnapDistance,
  }) {
    if (!collisionRuntime
        || typeof collisionRuntime.querySweptCapsule !== 'function'
        || typeof collisionRuntime.checkMovementReadiness !== 'function') {
      throw new Error('Character motor requires a collision runtime.');
    }
    if (!terrainProvider) throw new Error('Character motor requires terrain support.');
    if (!config || !(config.radius > 0) || !(config.bodyHeight > config.radius * 2)) {
      throw new Error('Character motor capsule configuration is invalid.');
    }
    if (!(config.skinWidth >= 0)
        || !(config.maxSubstepDistance > 0)
        || !Number.isSafeInteger(config.maxIterations)
        || config.maxIterations < 1
        || config.maxIterations > MAX_CHARACTER_SOLVER_ITERATIONS) {
      throw new Error('Character motor solver configuration is invalid.');
    }
    if (!(stepHeight > 0) || !(groundSnapDistance >= 0)) {
      throw new Error('Character motor support configuration is invalid.');
    }

    this.collisionRuntime = collisionRuntime;
    this.terrainProvider = terrainProvider;
    this.config = Object.freeze({ ...config });
    this.stepHeight = stepHeight;
    this.groundSnapDistance = groundSnapDistance;
    this.maximumSlopeCosine = Math.cos(config.maxSlopeDegrees * Math.PI / 180);
    this.candidateBuffer = [];
    this.contactScratch = {};
    this.previousValidPosition = null;
    this.lastResult = null;
    this.primitiveTests = 0;
  }

  reset(position) {
    assertFinitePoint(position, 'reset position');
    this.previousValidPosition = copyPosition(position);
    this.lastResult = null;
    this.primitiveTests = 0;
  }

  contact(capsule, collider, out = this.contactScratch) {
    this.primitiveTests += 1;
    return collider.type === COLLIDER_TYPE_MESH_INSTANCE
      ? this.collisionRuntime.findMeshSideContact?.(
        capsule,
        collider,
        this.config.skinWidth,
        out,
      ) ?? null
      : findPrimitiveSideContact(capsule, collider, this.config.skinWidth, out);
  }

  overlaps(capsule, collider) {
    if (collider.type === COLLIDER_TYPE_MESH_INSTANCE) {
      return this.contact(capsule, collider, {}) !== null;
    }
    this.primitiveTests += 1;
    return capsuleOverlapsPrimitive(capsule, collider, this.config.skinWidth);
  }

  collides(capsule, candidates) {
    for (const collider of candidates) {
      if (this.overlaps(capsule, collider)) return true;
    }
    return false;
  }

  resolveSubstep(capsule, targetX, targetZ, candidates, contactIds) {
    let resolved = moveCharacterCapsule(capsule, targetX, capsule.y, targetZ);
    let iterations = 0;
    let blocked = false;
    let exhausted = false;

    for (; iterations < this.config.maxIterations; iterations += 1) {
      let deepest = null;
      for (const collider of candidates) {
        const contact = this.contact(resolved, collider);
        if (!contact) continue;
        if (!deepest
            || contact.depth > deepest.depth + CONTACT_DEPTH_EPSILON
            || (Math.abs(contact.depth - deepest.depth) <= CONTACT_DEPTH_EPSILON
              && contact.sourceId < deepest.sourceId)) {
          deepest = {
            sourceId: contact.sourceId,
            normalX: contact.normalX,
            normalZ: contact.normalZ,
            depth: contact.depth,
          };
        }
      }
      if (!deepest) break;
      blocked = true;
      addUnique(contactIds, deepest.sourceId);
      resolved = moveCharacterCapsule(
        resolved,
        resolved.x + deepest.normalX * deepest.depth,
        resolved.y,
        resolved.z + deepest.normalZ * deepest.depth,
      );
    }

    if (iterations >= this.config.maxIterations && this.collides(resolved, candidates)) {
      resolved = capsule;
      exhausted = true;
    }
    return { capsule: resolved, iterations, blocked, exhausted };
  }

  meshSupport(options) {
    return this.collisionRuntime.findMeshTopSupport?.(options) ?? null;
  }

  move({
    start,
    displacement,
    grounded,
    allowStep = grounded,
    supportDownDistance = this.groundSnapDistance,
  }) {
    assertFinitePoint(start, 'start');
    if (!displacement || !Number.isFinite(displacement.x) || !Number.isFinite(displacement.z)) {
      throw new Error('Character motor displacement must contain finite x and z.');
    }
    if (!Number.isFinite(supportDownDistance) || supportDownDistance < 0) {
      throw new Error('Character motor supportDownDistance must be non-negative.');
    }
    if (!this.previousValidPosition) this.previousValidPosition = copyPosition(start);
    this.primitiveTests = 0;

    const maximumDistance = this.config.maxSubstepDistance * MAX_CHARACTER_SUBSTEPS;
    const boundedDisplacement = safeDisplacement(displacement, maximumDistance);
    const unconstrainedEnd = {
      x: start.x + boundedDisplacement.x,
      z: start.z + boundedDisplacement.z,
    };
    const constrained = this.terrainProvider.constrainMovement({
      startX: start.x,
      startZ: start.z,
      endX: unconstrainedEnd.x,
      endZ: unconstrainedEnd.z,
      radius: this.config.radius,
      maximumSlopeCosine: this.maximumSlopeCosine,
    });
    const finalDisplacement = {
      x: constrained.x - start.x,
      z: constrained.z - start.z,
    };
    const queryStart = {
      x: start.x,
      y: start.y - Math.max(this.groundSnapDistance, supportDownDistance),
      z: start.z,
    };
    const queryEnd = {
      x: constrained.x,
      y: start.y + (allowStep && grounded ? this.stepHeight + this.config.skinWidth : 0),
      z: constrained.z,
    };
    const readiness = this.collisionRuntime.checkMovementReadiness({
      start: queryStart,
      end: queryEnd,
      radius: this.config.radius,
      bodyHeight: this.config.bodyHeight,
    });

    if (!readiness.ready) {
      PerfCounters.inc('collisionNotReadyStops');
      PerfCounters.set('collisionPrimitiveTests', 0);
      const support = this.terrainProvider.sample(
        this.previousValidPosition.x,
        this.previousValidPosition.z,
        this.config.radius,
      );
      const result = Object.freeze({
        position: this.previousValidPosition,
        ready: false,
        blocked: true,
        stepped: false,
        slopeConstrained: constrained.constrained,
        supportSourceId: support.sourceId,
        supportHeight: support.height,
        supportNormal: copyNormal(support.normal),
        supportWalkable: support.normal.y >= this.maximumSlopeCosine,
        previousValidPosition: this.previousValidPosition,
        contacts: Object.freeze([]),
        iterations: 0,
        substeps: 0,
        primitiveTests: 0,
        readiness,
      });
      this.lastResult = result;
      return result;
    }

    const candidates = this.collisionRuntime.querySweptCapsule({
      start: queryStart,
      end: queryEnd,
      radius: this.config.radius,
      bodyHeight: this.config.bodyHeight,
      layers: COLLISION_LAYERS.solid,
      out: this.candidateBuffer,
    });
    const distance = Math.hypot(finalDisplacement.x, finalDisplacement.z);
    const substeps = distance > 0
      ? Math.max(1, Math.ceil(distance / this.config.maxSubstepDistance))
      : 0;
    const stepX = substeps > 0 ? finalDisplacement.x / substeps : 0;
    const stepZ = substeps > 0 ? finalDisplacement.z / substeps : 0;
    const contactIds = [];
    let capsule = createCharacterCapsule({
      x: start.x,
      y: start.y,
      z: start.z,
      radius: this.config.radius,
      bodyHeight: this.config.bodyHeight,
    });
    let blocked = false;
    let stepped = false;
    let totalIterations = 0;

    for (let index = 0; index < substeps; index += 1) {
      const targetX = capsule.x + stepX;
      const targetZ = capsule.z + stepZ;
      const resolved = this.resolveSubstep(capsule, targetX, targetZ, candidates, contactIds);
      totalIterations += resolved.iterations;
      if (resolved.blocked) blocked = true;

      if (resolved.blocked && allowStep && grounded) {
        const step = tryCharacterStep({
          capsule,
          targetX,
          targetZ,
          candidates,
          terrainProvider: this.terrainProvider,
          maximumSlopeCosine: this.maximumSlopeCosine,
          stepHeight: this.stepHeight,
          skinWidth: this.config.skinWidth,
          collides: (candidateCapsule, records) => this.collides(candidateCapsule, records),
          findMeshTopSupport: (options) => this.meshSupport(options),
        });
        if (step) {
          capsule = step.capsule;
          stepped = true;
          continue;
        }
      }
      capsule = resolved.capsule;
    }

    const support = findCharacterSupport({
      x: capsule.x,
      z: capsule.z,
      referenceY: capsule.y,
      radius: capsule.radius,
      terrainProvider: this.terrainProvider,
      candidates,
      maximumUp: grounded ? this.stepHeight : 0,
      maximumDown: supportDownDistance,
      maximumSlopeCosine: this.maximumSlopeCosine,
      findMeshTopSupport: (options) => this.meshSupport(options),
    }) ?? this.terrainProvider.sample(capsule.x, capsule.z, capsule.radius);
    const position = copyPosition({ x: capsule.x, y: capsule.y, z: capsule.z });
    this.previousValidPosition = position;

    PerfCounters.set('collisionContacts', contactIds.length);
    PerfCounters.set('collisionSolverIterations', totalIterations);
    PerfCounters.set('collisionSubsteps', substeps);
    PerfCounters.set('collisionPrimitiveTests', this.primitiveTests);
    if (stepped) PerfCounters.inc('collisionStepUps');

    const result = Object.freeze({
      position,
      ready: true,
      blocked,
      stepped,
      slopeConstrained: constrained.constrained,
      supportSourceId: support.sourceId,
      supportHeight: support.height,
      supportNormal: copyNormal(support.normal),
      supportWalkable: support.walkable !== false,
      previousValidPosition: this.previousValidPosition,
      contacts: Object.freeze([...contactIds]),
      iterations: totalIterations,
      substeps,
      primitiveTests: this.primitiveTests,
      readiness,
    });
    this.lastResult = result;
    return result;
  }

  getStatus() {
    if (!this.lastResult) {
      return Object.freeze({
        active: true,
        ready: false,
        blocked: false,
        stepped: false,
        supportSourceId: null,
        supportNormal: Object.freeze({ x: 0, y: 1, z: 0 }),
        supportWalkable: true,
        contacts: Object.freeze([]),
        primitiveTests: 0,
        previousValidPosition: this.previousValidPosition,
      });
    }
    return Object.freeze({
      active: true,
      ready: this.lastResult.ready,
      blocked: this.lastResult.blocked,
      stepped: this.lastResult.stepped,
      slopeConstrained: this.lastResult.slopeConstrained,
      supportSourceId: this.lastResult.supportSourceId,
      supportNormal: this.lastResult.supportNormal,
      supportWalkable: this.lastResult.supportWalkable,
      contacts: this.lastResult.contacts,
      iterations: this.lastResult.iterations,
      substeps: this.lastResult.substeps,
      primitiveTests: this.lastResult.primitiveTests,
      previousValidPosition: this.previousValidPosition,
    });
  }

  dispose() {
    this.candidateBuffer.length = 0;
    this.previousValidPosition = null;
    this.lastResult = null;
    this.primitiveTests = 0;
  }
}
