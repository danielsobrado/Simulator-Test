import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import {
  removeDirectoryWithRetry,
  terminateChildProcess,
} from './lib/processLifecycle.mjs';
import { chromium } from 'playwright';
import {
  TREE_IMPOSTOR_MANIFEST_VERSION,
  validateTreeImpostorManifest,
} from '../src/editor/stylized/impostor/TreeImpostorManifest.js';

const PORT = 5179;
const HOST = '127.0.0.1';
const OUTPUT_DIRECTORY = resolve('public/assets/impostors/trees');
const DOWNLOAD_NAME = 'tree-impostors.bundle.json';
const BAKE_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 15_000;
const FILE_TIMEOUT_MS = 30_000;
const POLL_MS = 250;
const DEBUG_PORT = 9237;
const MAX_DIAGNOSTIC_LINES = 240;

function optionValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.closedError = null;
    this.ready = new Promise((resolvePromise, reject) => {
      const onOpen = () => {
        cleanup();
        resolvePromise();
      };
      const onFailure = () => {
        cleanup();
        reject(new Error('Chrome DevTools connection failed before opening.'));
      };
      const cleanup = () => {
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('error', onFailure);
        this.socket.removeEventListener('close', onFailure);
      };
      this.socket.addEventListener('open', onOpen, { once: true });
      this.socket.addEventListener('error', onFailure, { once: true });
      this.socket.addEventListener('close', onFailure, { once: true });
    });
    this.socket.addEventListener('message', (event) => this.handleMessage(event));
    this.socket.addEventListener('error', () => {
      this.fail(new Error('Chrome DevTools connection failed.'));
    });
    this.socket.addEventListener('close', () => {
      this.fail(new Error('Chrome DevTools connection closed.'));
    });
  }

  handleMessage(event) {
    const message = JSON.parse(String(event.data));
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    for (const listener of this.listeners.get(message.method) ?? []) {
      listener(message.params ?? {});
    }
  }

  fail(error) {
    if (this.closedError) return;
    this.closedError = error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  async call(method, params = {}, timeoutMs = COMMAND_TIMEOUT_MS) {
    await this.ready;
    if (this.closedError) throw this.closedError;
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolvePromise, reject, method, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.fail(new Error('Chrome DevTools connection closed by the baker.'));
    try {
      this.socket.close();
    } catch {
      // The browser may have already closed the socket.
    }
    this.listeners.clear();
  }
}

function appendDiagnostic(diagnostics, value) {
  const lines = String(value).split(/\r?\n/).filter(Boolean);
  diagnostics.push(...lines);
  if (diagnostics.length > MAX_DIAGNOSTIC_LINES) {
    diagnostics.splice(0, diagnostics.length - MAX_DIAGNOSTIC_LINES);
  }
}

function remoteObjectText(object) {
  if (object.value !== undefined) return String(object.value);
  return object.description ?? object.type ?? '<unknown>';
}

async function waitForDevTools(timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://${HOST}:${DEBUG_PORT}/json/list`);
      if (response.ok) {
        const pages = await response.json();
        const page = pages.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl);
        if (page) return page.webSocketDebuggerUrl;
      }
    } catch {
      // Browser DevTools endpoint is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS));
  }
  throw new Error(`Chrome DevTools did not become ready within ${timeoutMs}ms.`);
}

function log(message) {
  process.stdout.write(`[impostor-bake] ${message}\n`);
}

function browserCandidates() {
  const fromEnvironment = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    process.env.CHROMIUM_PATH,
  ].filter(Boolean);
  if (process.platform === 'win32') {
    return [
      ...fromEnvironment,
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
      `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      ...fromEnvironment,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    ...fromEnvironment,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

function findBrowser() {
  const executable = browserCandidates().find((candidate) => candidate && existsSync(candidate));
  if (!executable) {
    throw new Error('Chrome, Chromium or Edge was not found. Set CHROME_PATH to a browser executable.');
  }
  return executable;
}

function spawnLogged(command, args, diagnostics, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(chunk);
    appendDiagnostic(diagnostics, chunk);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(chunk);
    appendDiagnostic(diagnostics, chunk);
  });
  return child;
}

async function waitForServer(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS));
  }
  throw new Error(`Vite did not become ready within ${timeoutMs}ms.`);
}

async function evaluateValue(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  }
  return result.result?.value;
}

async function waitForBakeStatus(cdp, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const status = await evaluateValue(cdp, 'window.__treeImpostorBakeStatus ?? null');
    if (status === 'done') return;
    if (status === 'failed') {
      const error = await evaluateValue(
        cdp,
        'window.__treeImpostorBakeError ?? "Unknown tree impostor bake failure"',
      );
      throw new Error(`Browser tree impostor bake failed: ${error}`);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS));
  }
  throw new Error(`Tree impostor bake did not finish within ${timeoutMs}ms.`);
}

async function waitForFile(path, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(path) && !existsSync(`${path}.crdownload`)) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_MS));
  }
  throw new Error(`Impostor bundle was not downloaded within ${timeoutMs}ms.`);
}

function decodeDataUrl(dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error('Impostor bundle contains an invalid PNG data URL.');
  return Buffer.from(match[1], 'base64');
}

async function writeAssets(bundle) {
  if (bundle.version !== TREE_IMPOSTOR_MANIFEST_VERSION) {
    throw new Error(`Impostor bundle version ${bundle.version} is unsupported.`);
  }
  if (typeof bundle.sourceSignature !== 'string' || bundle.sourceSignature.length < 8) {
    throw new Error('Impostor bundle contains no source signature.');
  }
  if (!Array.isArray(bundle.prototypes) || bundle.prototypes.length === 0) {
    throw new Error('Impostor bundle contains no tree prototypes.');
  }

  await removeDirectoryWithRetry(OUTPUT_DIRECTORY);
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const prototypes = [];
  for (const source of bundle.prototypes) {
    const stem = `prototype-${source.prototypeIndex}`;
    const albedoFilename = `${stem}-albedo.png`;
    const normalFilename = `${stem}-normal.png`;
    await writeFile(join(OUTPUT_DIRECTORY, albedoFilename), decodeDataUrl(source.albedoDataUrl));
    await writeFile(join(OUTPUT_DIRECTORY, normalFilename), decodeDataUrl(source.normalDataUrl));
    prototypes.push({
      prototypeIndex: source.prototypeIndex,
      columns: source.columns,
      rows: source.rows,
      tileSize: source.tileSize,
      gutter: source.gutter ?? 0,
      lowElevationDegrees: source.lowElevationDegrees,
      highElevationDegrees: source.highElevationDegrees,
      width: source.width,
      height: source.height,
      depth: source.depth,
      centerY: source.centerY,
      radius: source.radius,
      albedo: `/assets/impostors/trees/${albedoFilename}`,
      normal: `/assets/impostors/trees/${normalFilename}`,
    });
  }
  const manifest = validateTreeImpostorManifest({
    version: TREE_IMPOSTOR_MANIFEST_VERSION,
    generatedAt: bundle.generatedAt,
    sourceSignature: bundle.sourceSignature,
    prototypes,
  });
  await writeFile(
    join(OUTPUT_DIRECTORY, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function collectPageSnapshot(cdp, diagnostics) {
  try {
    const snapshot = await evaluateValue(cdp, `JSON.stringify({
      href: location.href,
      title: document.title,
      body: document.body?.innerText?.slice(0, 12000) ?? '',
      readyState: document.readyState,
      bakeStatus: window.__treeImpostorBakeStatus ?? null,
      bakeError: window.__treeImpostorBakeError ?? null
    })`);
    appendDiagnostic(diagnostics, `Page snapshot: ${snapshot ?? '<unavailable>'}`);
  } catch (error) {
    appendDiagnostic(diagnostics, `Page snapshot failed: ${error.message}`);
  }
}

async function closeBrowser(cdp, chrome) {
  if (cdp) {
    try {
      await cdp.call('Browser.close', {}, 3_000);
    } catch {
      // Browser.close usually closes the DevTools socket before replying.
    }
    cdp.close();
  }
  await terminateChildProcess(chrome);
}

async function cleanupTemporaryRoot(path) {
  try {
    await removeDirectoryWithRetry(path);
  } catch (error) {
    console.warn(`[impostor-bake] Temporary profile cleanup failed: ${error.message}`);
  }
}

async function bakeWithPlaywright(url, downloadDirectory, diagnostics) {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-gpu-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
    ],
  });
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.on('console', (message) => {
      appendDiagnostic(diagnostics, `console.${message.type()}: ${message.text()}`);
    });
    page.on('pageerror', (error) => {
      appendDiagnostic(diagnostics, `Browser exception: ${error.message}`);
    });
    const downloadPromise = page.waitForEvent('download', {
      timeout: BAKE_TIMEOUT_MS + FILE_TIMEOUT_MS,
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: COMMAND_TIMEOUT_MS });
    await page.waitForFunction(
      () => ['done', 'failed'].includes(window.__treeImpostorBakeStatus),
      null,
      { timeout: BAKE_TIMEOUT_MS },
    );
    const state = await page.evaluate(() => ({
      status: window.__treeImpostorBakeStatus,
      error: window.__treeImpostorBakeError ?? null,
    }));
    if (state.status !== 'done') {
      throw new Error(`Tree impostor bake failed in browser: ${state.error ?? 'unknown error'}`);
    }
    const download = await downloadPromise;
    const bundlePath = join(downloadDirectory, DOWNLOAD_NAME);
    await download.saveAs(bundlePath);
    return bundlePath;
  } finally {
    await browser.close();
  }
}

async function main() {
  const diagnostics = [];
  const installedBrowser = findBrowser();
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'simcity-dnd-impostor-'));
  const downloadDirectory = join(temporaryRoot, 'downloads');
  const profileDirectory = join(temporaryRoot, 'profile');
  await mkdir(downloadDirectory, { recursive: true });
  await mkdir(join(profileDirectory, 'Default'), { recursive: true });
  await writeFile(join(profileDirectory, 'Default', 'Preferences'), JSON.stringify({
    download: {
      default_directory: downloadDirectory,
      prompt_for_download: false,
      directory_upgrade: true,
    },
    safebrowsing: { enabled: false },
  }));

  const externalUrl = optionValue('--url');
  const vite = externalUrl
    ? null
    : spawnLogged(process.execPath, [
      'node_modules/vite/bin/vite.js',
      '--host', HOST,
      '--port', String(PORT),
      '--strictPort',
    ], diagnostics);
  let chrome = null;
  let cdp = null;
  try {
    if (vite) {
      await waitForServer(`http://${HOST}:${PORT}/`, 30_000);
      log(`Vite is ready on ${HOST}:${PORT}.`);
    }
    const url = new URL(externalUrl ?? `http://${HOST}:${PORT}/`);
    url.searchParams.set('bakeImpostors', '1');
    url.searchParams.set('download', '1');
    if (externalUrl) {
      const bundlePath = await bakeWithPlaywright(url, downloadDirectory, diagnostics);
      const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
      await writeAssets(bundle);
      const validation = execFileSync(
        process.execPath,
        ['scripts/validate-impostors.mjs', '--required'],
        { encoding: 'utf8', stdio: 'pipe' },
      );
      process.stdout.write(validation);
      log(`Wrote ${bundle.prototypes.length} tree impostor atlases to ${OUTPUT_DIRECTORY}.`);
      return;
    }
    const browserArguments = [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-component-extensions-with-background-pages',
      '--disable-crash-reporter',
      '--disable-breakpad',
      '--disable-sync',
      '--disable-gpu-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      `--remote-debugging-address=${HOST}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${profileDirectory}`,
      'about:blank',
    ];
    if (process.platform === 'linux') browserArguments.unshift('--no-sandbox');
    chrome = spawnLogged(installedBrowser, browserArguments, diagnostics);
    cdp = new CdpClient(await waitForDevTools(30_000));
    cdp.on('Runtime.consoleAPICalled', ({ type, args }) => {
      appendDiagnostic(diagnostics, `console.${type}: ${(args ?? []).map(remoteObjectText).join(' ')}`);
    });
    cdp.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      appendDiagnostic(
        diagnostics,
        `Browser exception: ${exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Unknown'}`,
      );
    });
    cdp.on('Log.entryAdded', ({ entry }) => {
      appendDiagnostic(diagnostics, `Browser log ${entry?.level ?? 'unknown'}: ${entry?.text ?? ''}`);
    });

    await Promise.all([
      cdp.call('Page.enable'),
      cdp.call('Runtime.enable'),
      cdp.call('Log.enable'),
    ]);
    const downloadBehavior = {
      behavior: 'allow',
      downloadPath: downloadDirectory,
      eventsEnabled: true,
    };
    try {
      await cdp.call('Browser.setDownloadBehavior', downloadBehavior);
    } catch {
      await cdp.call('Page.setDownloadBehavior', downloadBehavior);
    }
    const navigation = await cdp.call('Page.navigate', { url: url.href });
    if (navigation.errorText) throw new Error(`Page navigation failed: ${navigation.errorText}`);

    try {
      await waitForBakeStatus(cdp, BAKE_TIMEOUT_MS);
      await waitForFile(join(downloadDirectory, DOWNLOAD_NAME), FILE_TIMEOUT_MS);
    } catch (error) {
      await collectPageSnapshot(cdp, diagnostics);
      throw error;
    }

    const bundlePath = join(downloadDirectory, DOWNLOAD_NAME);
    const bundle = JSON.parse(await readFile(bundlePath, 'utf8'));
    await writeAssets(bundle);
    const validation = execFileSync(
      process.execPath,
      ['scripts/validate-impostors.mjs', '--required'],
      { encoding: 'utf8', stdio: 'pipe' },
    );
    process.stdout.write(validation);
    log(`Wrote ${bundle.prototypes.length} tree impostor atlases to ${OUTPUT_DIRECTORY}.`);
  } catch (error) {
    appendDiagnostic(diagnostics, error.stack ?? error.message ?? error);
    if (diagnostics.length > 0) {
      process.stderr.write(`\n[impostor-bake] Diagnostics:\n${diagnostics.join('\n')}\n`);
    }
    throw error;
  } finally {
    await closeBrowser(cdp, chrome);
    await terminateChildProcess(vite);
    await cleanupTemporaryRoot(temporaryRoot);
  }
}

main().catch((error) => {
  console.error('[impostor-bake] Failed.', error);
  process.exitCode = 1;
});
