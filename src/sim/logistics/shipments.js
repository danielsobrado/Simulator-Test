import { generatedEntityId } from '../model/ids.js';
import { getEntity, listEntities } from '../model/worldState.js';
import { findSettlementNodeId, shortestPath } from '../geography/geographicGraph.js';
import { availableQuantity, reserveStock } from '../economy/stockFlow.js';
import { isShipmentEmbargoed } from '../factions/politics.js';

export const SHIPMENT_STATUSES = Object.freeze([
  'planned',
  'reserved',
  'loading',
  'in_transit',
  'delayed',
  'blocked',
  'intercepted',
  'arrived',
  'cancelled',
  'lost',
]);

export function planGrainShipment(state, definition, {
  commandId,
  originSettlementId,
  destinationSettlementId,
  commodityId = 'grain',
  quantity,
  ordinal = 0,
  config,
}) {
  const origin = getEntity(state, 'settlement', originSettlementId);
  const dest = getEntity(state, 'settlement', destinationSettlementId);
  if (!origin || !dest) {
    throw Object.assign(new Error('missing_settlement'), { code: 'missing_reference' });
  }
  const account = getEntity(state, 'inventoryAccount', origin.data.inventoryAccountId);
  if (!account) {
    throw Object.assign(new Error('missing_inventory'), { code: 'missing_reference' });
  }
  if (availableQuantity(account, commodityId) < quantity) {
    throw Object.assign(new Error('insufficient_stock'), { code: 'insufficient_stock' });
  }

  if (isShipmentEmbargoed(state, originSettlementId, destinationSettlementId)) {
    throw Object.assign(new Error('embargoed'), { code: 'shipment_embargoed' });
  }

  const fromNode = findSettlementNodeId(state, originSettlementId);
  const toNode = findSettlementNodeId(state, destinationSettlementId);
  if (!fromNode || !toNode) {
    throw Object.assign(new Error('missing_graph_nodes'), { code: 'missing_reference' });
  }
  const path = shortestPath(state, fromNode, toNode, {
    dangerWeight: config.geography?.dangerWeight ?? 1,
    tollWeight: config.geography?.tollWeight ?? 1,
  });
  if (!path.ok) {
    throw Object.assign(new Error('unreachable'), { code: 'unreachable' });
  }

  const cargoId = generatedEntityId('inventoryAccount', definition.worldId, commandId, ordinal);
  const shipmentId = generatedEntityId('shipment', definition.worldId, commandId, ordinal + 1);
  const carrierId = generatedEntityId('carrier', definition.worldId, commandId, ordinal + 2);

  const reserved = reserveStock(account, commodityId, quantity);
  const fromQty = { ...account.data.quantities };
  fromQty[commodityId] = (fromQty[commodityId] ?? 0) - quantity;
  if (fromQty[commodityId] <= 0) delete fromQty[commodityId];
  const nextReserved = { ...reserved };
  nextReserved[commodityId] = (nextReserved[commodityId] ?? 0) - quantity;
  if (nextReserved[commodityId] <= 0) delete nextReserved[commodityId];

  account.data.quantities = fromQty;
  account.data.reserved = nextReserved;

  const hours = path.cost ?? 24;
  const expectedArrivalTick = state.calendar.tick + Math.max(1, Math.ceil(hours * (config.time?.ticksPerHour ?? 60)));

  const maxDanger = Math.max(
    0,
    ...path.edgeIds.map((id) => getEntity(state, 'graphEdge', id)?.data.danger ?? 0),
  );

  return {
    events: [
      {
        type: 'entity.patched',
        entityIds: [account.id],
        payload: {
          kind: 'inventoryAccount',
          id: account.id,
          dataPatch: { quantities: fromQty, reserved: nextReserved },
        },
      },
      {
        type: 'entity.upserted',
        entityIds: [cargoId],
        payload: {
          kind: 'inventoryAccount',
          id: cargoId,
          data: {
            ownerEntityId: shipmentId,
            locationId: originSettlementId,
            capacityMassKg: 10000,
            quantities: { [commodityId]: quantity },
            reserved: {},
            accountRole: 'cargo',
          },
        },
      },
      {
        type: 'entity.upserted',
        entityIds: [carrierId],
        payload: {
          kind: 'carrier',
          id: carrierId,
          data: {
            carrierKind: 'caravan',
            capacityMassKg: 10000,
            speedModifier: 1,
            locationSettlementId: originSettlementId,
          },
        },
      },
      {
        type: 'entity.upserted',
        entityIds: [shipmentId],
        payload: {
          kind: 'shipment',
          id: shipmentId,
          data: {
            ownerFactionId: origin.data.stateId ?? null,
            originSettlementId,
            destinationSettlementId,
            cargoInventoryId: cargoId,
            carrierId,
            transportMode: 'road',
            routeEdgeIds: path.edgeIds,
            currentEdgeIndex: 0,
            progress: 0,
            departureTick: state.calendar.tick,
            expectedArrivalTick,
            status: maxDanger > 0.5 ? 'blocked' : 'in_transit',
            riskState: { maxDanger, reasonCodes: maxDanger > 0.5 ? ['route_danger'] : [] },
            costState: { travelCost: path.cost },
            contractIds: [],
            commodityId,
            quantity,
          },
        },
      },
    ],
    shipmentId,
    cargoId,
    carrierId,
    path,
    reasonCodes: maxDanger > 0.5
      ? [{ code: 'shipment_blocked_danger', shipmentId, maxDanger }]
      : [{ code: 'shipment_departed', shipmentId }],
  };
}

export function advanceShipments(state, config) {
  const events = [];
  const reasonCodes = [];
  const ticksPerHour = config.time?.ticksPerHour ?? 60;

  for (const shipment of listEntities(state, 'shipment', { includeDestroyed: false })) {
    if (shipment.data.status !== 'in_transit' && shipment.data.status !== 'delayed') continue;
    const edges = shipment.data.routeEdgeIds ?? [];
    if (edges.length === 0) continue;

    let edgeIndex = shipment.data.currentEdgeIndex ?? 0;
    let progress = shipment.data.progress ?? 0;
    let status = shipment.data.status;
    const edge = getEntity(state, 'graphEdge', edges[edgeIndex]);
    if (!edge) continue;

    if ((edge.data.danger ?? 0) > 0.5) {
      status = 'blocked';
      reasonCodes.push({ code: 'shipment_blocked_danger', shipmentId: shipment.id });
      events.push({
        type: 'entity.patched',
        entityIds: [shipment.id],
        payload: {
          kind: 'shipment',
          id: shipment.id,
          dataPatch: {
            status,
            riskState: {
              ...(shipment.data.riskState ?? {}),
              maxDanger: edge.data.danger,
              reasonCodes: ['route_danger'],
            },
          },
        },
      });
      continue;
    }

    const hoursPerDay = config.time?.hoursPerDay ?? 24;
    const dayProgress = hoursPerDay / Math.max(0.1, edge.data.baseTravelHours);
    progress += dayProgress;
    while (progress >= 1 && edgeIndex < edges.length - 1) {
      progress -= 1;
      edgeIndex += 1;
      const nextEdge = getEntity(state, 'graphEdge', edges[edgeIndex]);
      if ((nextEdge?.data.danger ?? 0) > 0.5) {
        status = 'blocked';
        reasonCodes.push({ code: 'shipment_blocked_danger', shipmentId: shipment.id });
        break;
      }
    }

    if (status !== 'blocked' && edgeIndex >= edges.length - 1 && progress >= 1) {
      status = 'arrived';
      const cargo = getEntity(state, 'inventoryAccount', shipment.data.cargoInventoryId);
      const dest = getEntity(state, 'settlement', shipment.data.destinationSettlementId);
      const destInv = dest ? getEntity(state, 'inventoryAccount', dest.data.inventoryAccountId) : null;
      if (cargo && destInv) {
        const commodityId = shipment.data.commodityId;
        const quantity = shipment.data.quantity;
        const cargoQty = { ...cargo.data.quantities };
        const destQty = { ...destInv.data.quantities };
        cargoQty[commodityId] = (cargoQty[commodityId] ?? 0) - quantity;
        if (cargoQty[commodityId] <= 0) delete cargoQty[commodityId];
        destQty[commodityId] = (destQty[commodityId] ?? 0) + quantity;
        cargo.data.quantities = cargoQty;
        destInv.data.quantities = destQty;
        events.push({
          type: 'entity.patched',
          entityIds: [cargo.id],
          payload: { kind: 'inventoryAccount', id: cargo.id, dataPatch: { quantities: cargoQty } },
        });
        events.push({
          type: 'entity.patched',
          entityIds: [destInv.id],
          payload: { kind: 'inventoryAccount', id: destInv.id, dataPatch: { quantities: destQty } },
        });
        reasonCodes.push({ code: 'shipment_arrived', shipmentId: shipment.id });
        if (!shipment.data.paymentSettled) {
          const origin = getEntity(state, 'settlement', shipment.data.originSettlementId);
          const destSettlement = getEntity(state, 'settlement', shipment.data.destinationSettlementId);
          const originTreasury = origin
            ? getEntity(state, 'inventoryAccount', origin.data.treasuryAccountId)
            : null;
          const destTreasury = destSettlement
            ? getEntity(state, 'inventoryAccount', destSettlement.data.treasuryAccountId)
            : null;
          if (originTreasury && destTreasury) {
            const price = Math.max(1, Math.floor(quantity));
            const destCoin = destTreasury.data.quantities?.coin ?? 0;
            const paid = Math.min(destCoin, price);
            const nextDest = { ...destTreasury.data.quantities, coin: destCoin - paid };
            if (nextDest.coin <= 0) delete nextDest.coin;
            const nextOrigin = {
              ...originTreasury.data.quantities,
              coin: (originTreasury.data.quantities?.coin ?? 0) + paid,
            };
            destTreasury.data.quantities = nextDest;
            originTreasury.data.quantities = nextOrigin;
            events.push({
              type: 'entity.patched',
              entityIds: [destTreasury.id],
              payload: { kind: 'inventoryAccount', id: destTreasury.id, dataPatch: { quantities: nextDest } },
            });
            events.push({
              type: 'entity.patched',
              entityIds: [originTreasury.id],
              payload: { kind: 'inventoryAccount', id: originTreasury.id, dataPatch: { quantities: nextOrigin } },
            });
            reasonCodes.push({ code: 'shipment_payment_settled', shipmentId: shipment.id, paid });
            shipment.data.paymentSettled = true;
          }
        }
      }
    }

    events.push({
      type: 'entity.patched',
      entityIds: [shipment.id],
      payload: {
        kind: 'shipment',
        id: shipment.id,
        dataPatch: {
          currentEdgeIndex: edgeIndex,
          progress,
          status,
          paymentSettled: shipment.data.paymentSettled ?? false,
          expectedArrivalTick: shipment.data.expectedArrivalTick ?? (state.calendar.tick + ticksPerHour),
        },
      },
    });
  }

  return { events, reasonCodes };
}

export function setRouteDanger(state, routeId, danger) {
  const route = getEntity(state, 'route', routeId);
  if (!route) {
    throw Object.assign(new Error('missing_route'), { code: 'missing_reference' });
  }
  const events = [{
    type: 'entity.patched',
    entityIds: [routeId],
    payload: {
      kind: 'route',
      id: routeId,
      dataPatch: { danger },
    },
  }];
  for (const edge of listEntities(state, 'graphEdge', { includeDestroyed: false })) {
    if (edge.data.routeId !== routeId) continue;
    events.push({
      type: 'entity.patched',
      entityIds: [edge.id],
      payload: {
        kind: 'graphEdge',
        id: edge.id,
        dataPatch: { danger },
      },
    });
  }
  return {
    events,
    reasonCodes: [{ code: 'route_danger_updated', routeId, danger }],
  };
}

export function createTradeOffer(state, definition, {
  commandId,
  settlementId,
  commodityId,
  kind,
  quantity,
  limitPrice,
  ordinal = 0,
}) {
  const id = generatedEntityId('tradeOffer', definition.worldId, commandId, ordinal);
  return {
    offerId: id,
    events: [{
      type: 'entity.upserted',
      entityIds: [id],
      payload: {
        kind: 'tradeOffer',
        id,
        data: {
          settlementId,
          commodityId,
          kind,
          quantity,
          limitPrice,
          earliestTick: state.calendar.tick,
          latestTick: state.calendar.tick + 1440 * 30,
          priority: 1,
        },
      },
    }],
    reasonCodes: [{ code: 'trade_offer_created', offerId: id, kind, commodityId }],
  };
}

export function matchTradeOffers(state, definition, { commandId, config, ordinalBase = 0 } = {}) {
  const sells = listEntities(state, 'tradeOffer', { includeDestroyed: false })
    .filter((o) => o.data.kind === 'sell' && o.status === 'active')
    .sort((a, b) => a.data.limitPrice - b.data.limitPrice || a.id.localeCompare(b.id));
  const buys = listEntities(state, 'tradeOffer', { includeDestroyed: false })
    .filter((o) => o.data.kind === 'buy' && o.status === 'active')
    .sort((a, b) => b.data.limitPrice - a.data.limitPrice || a.id.localeCompare(b.id));
  const events = [];
  const reasonCodes = [];
  const shipments = [];
  let ordinal = ordinalBase;
  const used = new Set();

  for (const buy of buys) {
    if (used.has(buy.id)) continue;
    for (const sell of sells) {
      if (used.has(sell.id)) continue;
      if (buy.data.commodityId !== sell.data.commodityId) continue;
      if (buy.data.settlementId === sell.data.settlementId) continue;
      if (buy.data.limitPrice < sell.data.limitPrice) continue;
      const quantity = Math.min(buy.data.quantity, sell.data.quantity);
      if (quantity <= 0) continue;
      try {
        const planned = planGrainShipment(state, definition, {
          commandId: `${commandId}:match`,
          originSettlementId: sell.data.settlementId,
          destinationSettlementId: buy.data.settlementId,
          commodityId: buy.data.commodityId,
          quantity,
          ordinal,
          config,
        });
        events.push(...planned.events);
        const buyRemaining = buy.data.quantity - quantity;
        const sellRemaining = sell.data.quantity - quantity;
        buy.data.quantity = buyRemaining;
        sell.data.quantity = sellRemaining;
        events.push({
          type: 'entity.patched',
          entityIds: [buy.id],
          payload: {
            kind: 'tradeOffer',
            id: buy.id,
            status: buyRemaining > 0 ? 'active' : 'inactive',
            dataPatch: { quantity: buyRemaining },
          },
        });
        events.push({
          type: 'entity.patched',
          entityIds: [sell.id],
          payload: {
            kind: 'tradeOffer',
            id: sell.id,
            status: sellRemaining > 0 ? 'active' : 'inactive',
            dataPatch: { quantity: sellRemaining },
          },
        });
        if (buyRemaining <= 0) used.add(buy.id);
        if (sellRemaining <= 0) used.add(sell.id);
        shipments.push(planned.shipmentId);
        reasonCodes.push({
          code: 'trade_matched',
          buyOfferId: buy.id,
          sellOfferId: sell.id,
          shipmentId: planned.shipmentId,
          quantity,
          buyRemaining,
          sellRemaining,
        });
        ordinal += 3;
        break;
      } catch (error) {
        reasonCodes.push({
          code: 'trade_match_failed',
          buyOfferId: buy.id,
          sellOfferId: sell.id,
          reason: error.code ?? error.message,
        });
      }
    }
  }
  return { events, reasonCodes, shipments, nextOrdinal: ordinal };
}

export function loseShipment(state, shipmentId, { transferToLoot = false, lootInventoryId = null } = {}) {
  const shipment = getEntity(state, 'shipment', shipmentId);
  if (!shipment) {
    throw Object.assign(new Error('missing_shipment'), { code: 'missing_reference' });
  }
  const events = [];
  const cargo = getEntity(state, 'inventoryAccount', shipment.data.cargoInventoryId);
  if (cargo) {
    if (transferToLoot && lootInventoryId) {
      const loot = getEntity(state, 'inventoryAccount', lootInventoryId);
      if (loot) {
        const nextLoot = { ...loot.data.quantities };
        for (const [commodityId, qty] of Object.entries(cargo.data.quantities ?? {})) {
          nextLoot[commodityId] = (nextLoot[commodityId] ?? 0) + qty;
        }
        events.push({
          type: 'entity.patched',
          entityIds: [loot.id],
          payload: { kind: 'inventoryAccount', id: loot.id, dataPatch: { quantities: nextLoot } },
        });
      }
    }
    events.push({
      type: 'entity.patched',
      entityIds: [cargo.id],
      payload: { kind: 'inventoryAccount', id: cargo.id, dataPatch: { quantities: {} } },
    });
  }
  events.push({
    type: 'entity.patched',
    entityIds: [shipmentId],
    payload: {
      kind: 'shipment',
      id: shipmentId,
      dataPatch: { status: 'lost' },
      status: null,
    },
  });
  return {
    events,
    reasonCodes: [{ code: 'shipment_lost', shipmentId, transferToLoot: !!transferToLoot }],
  };
}

export function settleShipmentPayment(state, shipment, ledger) {
  if (shipment.data.paymentSettled) return { events: [], reasonCodes: [] };
  const origin = getEntity(state, 'settlement', shipment.data.originSettlementId);
  const dest = getEntity(state, 'settlement', shipment.data.destinationSettlementId);
  const originTreasury = origin ? getEntity(state, 'inventoryAccount', origin.data.treasuryAccountId) : null;
  const destTreasury = dest ? getEntity(state, 'inventoryAccount', dest.data.treasuryAccountId) : null;
  if (!originTreasury || !destTreasury) {
    return { events: [], reasonCodes: [{ code: 'payment_skipped_missing_treasury', shipmentId: shipment.id }] };
  }
  const price = Math.max(1, Math.floor(shipment.data.quantity * 1));
  const destCoin = destTreasury.data.quantities?.coin ?? 0;
  const paid = Math.min(destCoin, price);
  const nextDest = { ...destTreasury.data.quantities, coin: destCoin - paid };
  if (nextDest.coin <= 0) delete nextDest.coin;
  const nextOrigin = {
    ...originTreasury.data.quantities,
    coin: (originTreasury.data.quantities?.coin ?? 0) + paid,
  };
  destTreasury.data.quantities = nextDest;
  originTreasury.data.quantities = nextOrigin;
  ledger?.record({
    tick: state.calendar.tick,
    type: 'shipment_payment',
    shipmentId: shipment.id,
    commodityId: 'coin',
    quantity: paid,
  });
  return {
    events: [
      {
        type: 'entity.patched',
        entityIds: [destTreasury.id],
        payload: { kind: 'inventoryAccount', id: destTreasury.id, dataPatch: { quantities: nextDest } },
      },
      {
        type: 'entity.patched',
        entityIds: [originTreasury.id],
        payload: { kind: 'inventoryAccount', id: originTreasury.id, dataPatch: { quantities: nextOrigin } },
      },
      {
        type: 'entity.patched',
        entityIds: [shipment.id],
        payload: {
          kind: 'shipment',
          id: shipment.id,
          dataPatch: { paymentSettled: true, paymentAmount: paid },
        },
      },
    ],
    reasonCodes: [{ code: 'shipment_payment_settled', shipmentId: shipment.id, paid }],
  };
}
