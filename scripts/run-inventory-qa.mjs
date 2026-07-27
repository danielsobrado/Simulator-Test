/**
 * Deterministic browser QA for the inventory overlay.
 *
 * Starts its own strict-port Vite dev server, drives the real inventory DOM and pointer
 * handlers in Chromium, and writes screenshots plus a machine readable report to
 * tmp/inventory-qa.
 *
 * The dev server is deliberate: window.__editor is gated behind import.meta.env.DEV, and
 * the harness needs it to read store state back after each gesture. A production preview
 * would have no hook to assert against.
 *
 * Usage:
 *   npm run qa:inventory
 *   npm run qa:inventory -- --headed
 *   npm run qa:inventory -- --port 4176
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { terminateChildProcess } from './lib/processLifecycle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(root, 'tmp', 'inventory-qa');

function readArgument(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const headed = process.argv.includes('--headed');
const timeoutMs = Number(readArgument('timeoutMs', '120000'));
const requestedPort = process.argv.includes('--port') ? Number(readArgument('port', '4176')) : 0;
let port = 0;
let baseUrl = '';

async function preflightPort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => {
      reject(new Error(`Inventory QA port ${preferredPort} is unavailable: ${error.message}`));
    });
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' ? address.port : preferredPort;
      server.close((error) => (error ? reject(error) : resolve(selectedPort)));
    });
  });
}

function startServer() {
  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
}

async function waitForServer(server) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Inventory QA Vite server exited with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
      lastError = new Error(`Vite returned HTTP ${response.status}.`);
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message ?? 'unknown error'}`);
}

/** Read the parts of inventory state the assertions care about. */
async function inventoryState(page) {
  return page.evaluate(() => {
    const store = window.__editor?.inventoryStore;
    const controller = window.__editor?.inventoryController;
    const state = store?.getState();
    if (!state) return null;
    return {
      isOpen: controller?.isOpen ?? false,
      capacity: state.capacity,
      gold: state.currency.gold,
      activeWeaponSet: state.activeWeaponSet,
      bagFilled: state.bagSlots.filter(Boolean).length,
      bag: state.bagSlots.map((entry) => (entry ? `${entry.itemKey}x${entry.quantity}` : null)),
      chest: state.equipment.armour.chest?.itemKey ?? null,
      head: state.equipment.armour.head?.itemKey ?? null,
      mainHand: state.equipment.weaponSets.set1.mainHand?.itemKey ?? null,
      offHand: state.equipment.weaponSets.set1.offHand?.itemKey ?? null,
      panelVisible: !document.querySelector('.inventory-overlay')?.hidden,
      slotCount: document.querySelectorAll('.inventory-slot').length,
      // Occupied slots that actually draw something — an icon, or the category glyph that
      // stands in for art which has not been authored yet. Guards against the whole bag
      // silently rendering blank when icon paths 404.
      bagSlotsDrawn: [...document.querySelectorAll('.inventory-slot[data-kind="bag"]')]
        .filter((slot) => {
          if (slot.dataset.empty !== 'false') return false;
          const icon = slot.querySelector('.inventory-slot__icon');
          const glyph = slot.querySelector('.inventory-slot__placeholder');
          const iconShown = icon && !icon.hidden && icon.getAttribute('src');
          const glyphShown = glyph && !glyph.hidden && glyph.textContent.trim().length > 0;
          return Boolean(iconShown || glyphShown);
        }).length,
      bagColumns: getComputedStyle(document.querySelector('.inventory-bag'))
        .gridTemplateColumns.split(' ').filter(Boolean).length,
    };
  });
}

/*
 * ---------------------------------------------------------------------------
 * Why this file avoids page.click / page.dblclick / locator.screenshot
 *
 * Those APIs gate on Playwright's actionability checks, which wait on
 * requestAnimationFrame. This app runs a WebGPU world renderer every frame, and under
 * headless software rasterisation a single frame can take tens of seconds — so any
 * rAF-gated call times out even though the page is healthy and responsive. Measured on a
 * developer machine: ~25s per animation frame headless, versus normal frame rates headed.
 *
 * Raw page.mouse.* input is delivered straight through CDP without those checks, so the
 * helpers below drive real pointer and mouse events against the real handlers, and the
 * assertions read state back through window.__editor. That keeps the coverage honest
 * without making the harness hostage to the renderer.
 * ---------------------------------------------------------------------------
 */

/** Centre point of a slot, in viewport coordinates. */
async function slotCentre(page, selector) {
  const box = await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, selector);
  assert.ok(box, `Slot ${selector} is not laid out.`);
  return box;
}

/**
 * Element screenshots need the compositor, which is subject to the same frame-rate problem
 * described above. Capture is therefore best-effort: it succeeds on a machine with working
 * GPU acceleration (or with --headed) and is skipped otherwise. Never a test failure.
 */
async function capture(page, name) {
  try {
    await page.locator('.inventory-panel').screenshot({
      path: path.join(outputDirectory, name),
      timeout: 15000,
    });
    return true;
  } catch {
    console.warn(`Skipped screenshot ${name} (renderer too slow to composite headless).`);
    return false;
  }
}

/** Real pointer drag between two slots, exercising the pointer handlers rather than the API. */
async function dragSlot(page, fromSelector, toSelector) {
  const from = await slotCentre(page, fromSelector);
  const to = await slotCentre(page, toSelector);

  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Several steps so the 5px drag threshold is crossed by movement rather than one jump.
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await delay(80);
}

/** Double-click via raw mouse input, so no actionability check is involved. */
async function doubleClickSlot(page, selector) {
  const centre = await slotCentre(page, selector);
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.dblclick(centre.x, centre.y);
  await delay(80);
}

async function findBagSlotWith(page, itemKey) {
  const index = await page.evaluate((key) => {
    const slots = window.__editor?.inventoryStore?.getState()?.bagSlots ?? [];
    return slots.findIndex((entry) => entry?.itemKey === key);
  }, itemKey);
  assert.ok(index >= 0, `Starting loadout has no ${itemKey} in the bag.`);
  return `.inventory-slot[data-location="bag:${index}"]`;
}

async function run() {
  await mkdir(outputDirectory, { recursive: true });
  port = await preflightPort(requestedPort);
  baseUrl = `http://127.0.0.1:${port}/`;

  const server = startServer();
  let serverOutput = '';
  server.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });

  const report = { baseUrl, startedAt: new Date().toISOString(), checks: [] };
  const record = (name, detail) => report.checks.push({ name, detail, at: Date.now() });

  let browser;
  try {
    await waitForServer(server);
    // channel:'chromium' selects the full browser rather than the headless shell, which
    // has no usable GPU path. Combined with the flags below — the same set the workshop
    // harness uses — the world renderer keeps a workable frame rate, which matters because
    // Playwright's actionability and screenshot paths both wait on animation frames.
    browser = await chromium.launch({
      headless: !headed,
      channel: 'chromium',
      args: [
        '--enable-unsafe-webgpu',
        '--ignore-gpu-blocklist',
        '--use-angle=default',
        '--enable-gpu-rasterization',
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
      ],
    });
    const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });

    const consoleErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));

    await page.goto(baseUrl, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForFunction(() => window.__editor?.inventoryStore != null, { timeout: timeoutMs });

    // 1 — closed by default, and the overlay contributes no visible DOM.
    let state = await inventoryState(page);
    assert.equal(state.isOpen, false, 'Inventory must start closed.');
    assert.equal(state.panelVisible, false, 'Overlay must be hidden while closed.');
    record('starts-closed', { capacity: state.capacity, bagFilled: state.bagFilled });

    // 2 — "I" opens it and the full slot complement is present.
    await page.keyboard.press('KeyI');
    await page.waitForSelector('.inventory-panel', { state: 'visible', timeout: 10000 });
    state = await inventoryState(page);
    assert.equal(state.isOpen, true, 'KeyI must open the inventory.');
    assert.equal(state.slotCount, state.capacity + 11,
      `Expected ${state.capacity} bag slots + 9 equipment + 2 weapon slots.`);
    assert.equal(state.bagColumns, 10, 'Desktop bag grid must be 10 columns.');
    record('opens-with-i', { slotCount: state.slotCount, bagColumns: state.bagColumns });

    // Every occupied bag slot must draw something. The item art is not authored yet, so
    // this is really asserting that the missing-icon fallback works — without it the whole
    // bag renders as empty squares while the store is perfectly populated.
    await page.waitForFunction(
      (expected) => [...document.querySelectorAll('.inventory-slot[data-kind="bag"]')]
        .filter((slot) => {
          if (slot.dataset.empty !== 'false') return false;
          const icon = slot.querySelector('.inventory-slot__icon');
          const glyph = slot.querySelector('.inventory-slot__placeholder');
          return Boolean((icon && !icon.hidden && icon.getAttribute('src'))
            || (glyph && !glyph.hidden && glyph.textContent.trim().length > 0));
        }).length === expected,
      state.bagFilled,
      { timeout: 15000 },
    ).catch(() => {});
    state = await inventoryState(page);
    assert.equal(state.bagSlotsDrawn, state.bagFilled,
      `Only ${state.bagSlotsDrawn} of ${state.bagFilled} occupied bag slots render an icon or glyph.`);
    record('occupied-slots-render', { drawn: state.bagSlotsDrawn, filled: state.bagFilled });
    await capture(page, '01-open.png');

    // 3 — drag a chest piece from the bag onto the chest slot.
    const armourSlot = await findBagSlotWith(page, 'leather_armour');
    const beforeDrag = await inventoryState(page);
    await dragSlot(page, armourSlot, '.inventory-slot[data-location="equipment:chest"]');
    state = await inventoryState(page);
    assert.equal(state.chest, 'leather_armour', 'Dragging leather armour onto chest must equip it.');
    assert.equal(state.bagFilled, beforeDrag.bagFilled - 1, 'Equipping must free the bag slot.');
    record('drag-to-equip', { chest: state.chest, bagFilled: state.bagFilled });
    await capture(page, '02-equipped.png');

    // 4 — double-click the equipped item to send it back to the bag.
    await doubleClickSlot(page, '.inventory-slot[data-location="equipment:chest"]');
    state = await inventoryState(page);
    assert.equal(state.chest, null, 'Double-clicking equipped armour must unequip it.');
    assert.equal(state.bagFilled, beforeDrag.bagFilled, 'Unequipping must return the item to the bag.');
    record('double-click-unequip', { bagFilled: state.bagFilled });

    // 5 — an equippable item dropped on the wrong slot is rejected without mutating the
    // store. The sword is main-hand only, so the head slot must refuse it.
    const swordSlot = await findBagSlotWith(page, 'iron_sword');
    const beforeInvalid = await inventoryState(page);
    await dragSlot(page, swordSlot, '.inventory-slot[data-location="equipment:head"]');
    state = await inventoryState(page);
    assert.equal(state.head, null, 'A sword must not equip into the head slot.');
    assert.deepEqual(state.bag, beforeInvalid.bag, 'A rejected drop must leave the bag untouched.');
    record('invalid-drop-rejected', { head: state.head });

    // 6 — dragging the same sword onto the main hand does work, proving the rejection
    // above was about slot compatibility rather than a broken drag.
    await dragSlot(page, swordSlot, '.inventory-slot[data-location="weapon:1:mainHand"]');
    state = await inventoryState(page);
    assert.equal(state.mainHand, 'iron_sword', 'The sword must equip into the main hand.');
    record('drag-to-weapon-slot', { mainHand: state.mainHand });

    // 6 — weapon set switching via the number keys.
    await page.keyboard.press('Digit2');
    await delay(60);
    state = await inventoryState(page);
    assert.equal(state.activeWeaponSet, 2, 'Digit2 must switch to weapon set II.');
    await page.keyboard.press('Digit1');
    await delay(60);
    state = await inventoryState(page);
    assert.equal(state.activeWeaponSet, 1, 'Digit1 must switch back to weapon set I.');
    record('weapon-set-switch', { activeWeaponSet: state.activeWeaponSet });

    // 7 — arrow keys move slot focus. This is the regression most at risk: the overlay
    // coordinator swallows every keydown, so navigation only works while it is routed
    // through InventoryController.setKeyNavigationHandler.
    await page.evaluate(() => document.querySelector('.inventory-slot[data-location="bag:0"]').focus());
    await page.keyboard.press('ArrowRight');
    await delay(40);
    const focused = await page.evaluate(() => document.activeElement?.dataset?.location ?? null);
    assert.equal(focused, 'bag:1', 'ArrowRight must move slot focus one column right.');
    record('arrow-key-navigation', { focused });

    // 8 — narrow viewport halves the grid rather than shrinking cells.
    await page.setViewportSize({ width: 720, height: 900 });
    await delay(120);
    state = await inventoryState(page);
    assert.equal(state.bagColumns, 5, 'Narrow viewport must drop the bag grid to 5 columns.');
    record('responsive-grid', { bagColumns: state.bagColumns });
    await capture(page, '03-narrow.png');
    await page.setViewportSize({ width: 1600, height: 950 });
    await delay(120);

    // 9 — Escape closes, and closing does not disturb inventory contents.
    const beforeClose = await inventoryState(page);
    await page.keyboard.press('Escape');
    await delay(80);
    state = await inventoryState(page);
    assert.equal(state.isOpen, false, 'Escape must close the inventory.');
    assert.equal(state.panelVisible, false, 'Overlay must be hidden after closing.');
    assert.deepEqual(state.bag, beforeClose.bag, 'Closing must not alter the bag.');
    record('escape-closes', { bagFilled: state.bagFilled });

    // Missing item art is expected until the prompt sheet has been worked through, so
    // 404s for /assets/items are not failures. Anything else is.
    const unexpected = consoleErrors.filter((text) => !/\/assets\/(items|ui)\//.test(text));
    assert.deepEqual(unexpected, [], `Unexpected console errors:\n${unexpected.join('\n')}`);
    report.missingArtWarnings = consoleErrors.length - unexpected.length;

    report.ok = true;
  } catch (error) {
    report.ok = false;
    report.error = error.message;
    report.serverOutput = serverOutput.slice(-4000);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(
      path.join(outputDirectory, 'report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
      'utf8',
    );
    await browser?.close();
    await terminateChildProcess(server);
  }

  console.log(`Inventory QA passed ${report.checks.length} checks.`);
  console.log(`Report and screenshots: ${path.relative(root, outputDirectory)}`);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
