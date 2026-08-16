import { createDomainEvent } from '../events/domainEvent.js';
import { applyEvent } from '../events/reducers.js';
import { cloneWorldState } from '../model/worldState.js';
import { recordValidationFailure } from '../model/validation/validateWorldState.js';
import { calendarFromTick } from '../time/worldClock.js';

const handlers = new Map();

export function registerCommandHandler(type, handler) {
  if (handlers.has(type)) {
    throw new Error(`duplicate_handler:${type}`);
  }
  handlers.set(type, handler);
}

export function createCommandDispatcher({ onAccepted = null } = {}) {
  return {
    dispatch(state, command, runtimeCtx = null) {
      const handler = handlers.get(command.type);
      if (!handler) {
        state.diagnostics.commandsRejected += 1;
        recordValidationFailure(state, 'unknown_command_type');
        return {
          ok: false,
          code: 'unknown_command_type',
          events: [],
          state,
        };
      }

      if (command.expectedWorldRevision != null
          && command.expectedWorldRevision !== state.revision) {
        state.diagnostics.commandsRejected += 1;
        recordValidationFailure(state, 'stale_world_revision');
        return {
          ok: false,
          code: 'stale_world_revision',
          events: [],
          state,
        };
      }

      const working = cloneWorldState(state);
      const commandWithCtx = runtimeCtx
        ? { ...command, payload: { ...command.payload, __ctx: runtimeCtx, __result: null } }
        : { ...command, payload: { ...command.payload, __result: null } };
      let emitted;
      try {
        if (runtimeCtx?.config?.time) {
          working.calendar = calendarFromTick(command.issuedAtTick, runtimeCtx.config.time);
        }
        emitted = handler(working, commandWithCtx) ?? [];
      } catch (error) {
        state.diagnostics.commandsRejected += 1;
        const code = error.code ?? 'command_failed';
        recordValidationFailure(state, code);
        return {
          ok: false,
          code,
          message: error.message,
          events: [],
          state,
        };
      }

      const events = emitted.map((partial, index) => createDomainEvent({
        id: `${command.id}:event:${index}`,
        type: partial.type,
        tick: command.issuedAtTick,
        causedByCommandId: command.id,
        entityIds: partial.entityIds ?? [],
        payload: partial.payload ?? {},
        schemaVersion: partial.schemaVersion ?? 1,
      }));

      try {
        for (const event of events) {
          applyEvent(working, event);
          working.diagnostics.eventsEmitted += 1;
        }
      } catch (error) {
        state.diagnostics.commandsRejected += 1;
        const code = error.code ?? 'event_apply_failed';
        recordValidationFailure(state, code);
        return {
          ok: false,
          code,
          message: error.message,
          events: [],
          state,
        };
      }

      working.diagnostics.commandsAccepted += 1;
      if (onAccepted) onAccepted(command, events, working);
      return {
        ok: true,
        code: 'accepted',
        events,
        state: working,
        result: commandWithCtx.payload.__result ?? null,
      };
    },
  };
}

export function listRegisteredCommandTypes() {
  return [...handlers.keys()].sort();
}

// Core bootstrap handlers
registerCommandHandler('sim.upsertEntity', (_state, command) => [{
  type: 'entity.upserted',
  entityIds: [command.payload.id],
  payload: command.payload,
}]);

registerCommandHandler('sim.destroyEntity', (_state, command) => [{
  type: 'entity.destroyed',
  entityIds: [command.payload.id],
  payload: command.payload,
}]);

registerCommandHandler('sim.patchEntity', (_state, command) => [{
  type: 'entity.patched',
  entityIds: [command.payload.id],
  payload: command.payload,
}]);

registerCommandHandler('sim.setCalendar', (_state, command) => [{
  type: 'calendar.set',
  entityIds: [],
  payload: command.payload,
}]);
