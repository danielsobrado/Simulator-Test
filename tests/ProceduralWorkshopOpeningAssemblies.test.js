import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextOpeningAssemblyId,
  normalizeOpeningAssemblies,
  serializeOpeningAssemblies,
} from '../src/editor/workshop/ProceduralWorkshopOpeningAssemblies.js';

test('opening assemblies normalize and serialize canonically', () => {
  const normalized = normalizeOpeningAssemblies({
    'assembly-window-2': {
      kind: 'window',
      hostId: 'structure-main',
      memberIds: ['window-3', 'window-2'],
    },
    'assembly-door-1': {
      kind: 'door',
      hostId: 'structure-left',
      memberIds: ['door-1', 'copy-door-1-1'],
    },
  });
  assert.deepEqual(Object.keys(normalized), ['assembly-door-1', 'assembly-window-2']);
  assert.deepEqual(normalized['assembly-window-2'].memberIds, ['window-3', 'window-2']);
  assert.ok(Object.isFrozen(normalized['assembly-window-2'].memberIds));
  assert.deepEqual(serializeOpeningAssemblies(normalized), {
    'assembly-door-1': {
      kind: 'door',
      hostId: 'structure-left',
      memberIds: ['door-1', 'copy-door-1-1'],
    },
    'assembly-window-2': {
      kind: 'window',
      hostId: 'structure-main',
      memberIds: ['window-3', 'window-2'],
    },
  });
});

test('opening assemblies reject invalid and multiply claimed members', () => {
  assert.throws(
    () => normalizeOpeningAssemblies(null),
    /Opening assemblies must be an object/,
  );
  assert.throws(
    () => normalizeOpeningAssemblies({
      'assembly-opening-1': {
        kind: 'opening',
        hostId: 'structure-main',
        memberIds: ['arch-1', 'arch-2'],
      },
    }),
    /invalid identifier/,
  );
  assert.throws(
    () => normalizeOpeningAssemblies({
      'assembly-window-1': {
        kind: 'window',
        hostId: 'structure-main',
        memberIds: ['window-1', 'window-1'],
      },
    }),
    /duplicate member/,
  );
  assert.throws(
    () => normalizeOpeningAssemblies({
      'assembly-window-1': {
        kind: 'window',
        hostId: 'structure-main',
        memberIds: ['window-1', 'window-2'],
      },
      'assembly-window-2': {
        kind: 'window',
        hostId: 'structure-main',
        memberIds: ['window-2', 'window-3'],
      },
    }),
    /belongs to more than one assembly/,
  );
});

test('opening assembly identifiers are deterministic by kind', () => {
  assert.equal(nextOpeningAssemblyId('window', {}), 'assembly-window-1');
  assert.equal(nextOpeningAssemblyId('window', {
    'assembly-window-1': {
      kind: 'window',
      hostId: 'structure-main',
      memberIds: ['window-1', 'window-2'],
    },
  }), 'assembly-window-2');
  assert.equal(nextOpeningAssemblyId('door', {
    'assembly-window-1': {
      kind: 'window',
      hostId: 'structure-main',
      memberIds: ['window-1', 'window-2'],
    },
  }), 'assembly-door-1');
});
