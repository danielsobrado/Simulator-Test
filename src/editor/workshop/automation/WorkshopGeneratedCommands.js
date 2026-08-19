import { cloneWorkshopProperties } from '../kernel/WorkshopEntity.js';
import { WorkshopPatch } from '../kernel/WorkshopPatch.js';
import {
  WORKSHOP_GENERATED_MODES,
  WORKSHOP_GENERATION_CONTROL_TYPE,
  WORKSHOP_GENERATION_RULE_ID_PATTERN,
} from './WorkshopGeneratedConstants.js';

const MODES = new Set(WORKSHOP_GENERATED_MODES);

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'generated';
}

export function generationControlId(targetId) {
  if (typeof targetId !== 'string' || targetId.length === 0 || targetId.length > 256) {
    throw new Error('Generated target id must be a non-empty string up to 256 characters.');
  }
  return `generation-control:${slug(targetId)}-${hashString(targetId)}`;
}

function normalizeProvenance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Generated entity command requires provenance.');
  }
  if (typeof input.ruleId !== 'string' || !WORKSHOP_GENERATION_RULE_ID_PATTERN.test(input.ruleId)) {
    throw new Error('Generated provenance rule id is invalid.');
  }
  if (typeof input.derivationKey !== 'string' || input.derivationKey.length === 0 || input.derivationKey.length > 256) {
    throw new Error('Generated provenance derivation key is invalid.');
  }
  const sourceIds = input.sourceIds ?? [];
  if (!Array.isArray(sourceIds) || sourceIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new Error('Generated provenance source ids must be strings.');
  }
  return Object.freeze({
    ruleId: input.ruleId,
    derivationKey: input.derivationKey,
    sourceIds: Object.freeze([...new Set(sourceIds)].sort()),
  });
}

function controlEntity(command, mode) {
  if (!MODES.has(mode)) throw new Error(`Unsupported generated entity mode: ${mode}.`);
  const targetId = command.targetId;
  const provenance = normalizeProvenance(command.provenance);
  if ((mode === 'pinned' || mode === 'detached') && (!command.snapshot || typeof command.snapshot !== 'object')) {
    throw new Error(`${mode} generated entities require a semantic snapshot.`);
  }
  const properties = {
    targetId,
    mode,
    provenance,
    ...(command.snapshot ? {
      snapshot: cloneWorkshopProperties(command.snapshot, `Generated ${mode} snapshot`),
    } : {}),
  };
  return {
    id: generationControlId(targetId),
    type: WORKSHOP_GENERATION_CONTROL_TYPE,
    parentId: null,
    properties,
    dependsOn: [],
  };
}

function modeHandler(mode) {
  return ({ command }) => new WorkshopPatch({
    label: command.label ?? `${mode} generated entity`,
    operations: [{ op: 'put', entity: controlEntity(command, mode) }],
  });
}

function resetHandler({ command, document }) {
  const id = generationControlId(command.targetId);
  if (!document.hasEntity(id)) return new WorkshopPatch({ label: command.label ?? 'Reset generated entity', operations: [] });
  return new WorkshopPatch({
    label: command.label ?? 'Reset generated entity',
    operations: [{ op: 'remove', id }],
  });
}

export function registerWorkshopGeneratedCommands(bus) {
  if (!bus || typeof bus.register !== 'function') throw new Error('Generated commands require a workshop command bus.');
  const unregister = [
    bus.register('generated.pin', modeHandler('pinned')),
    bus.register('generated.detach', modeHandler('detached')),
    bus.register('generated.suppress', modeHandler('suppressed')),
    bus.register('generated.reset-to-auto', resetHandler),
  ];
  return () => unregister.forEach((dispose) => dispose());
}

export function getGenerationControl(document, targetId) {
  return document.getEntity(generationControlId(targetId));
}
