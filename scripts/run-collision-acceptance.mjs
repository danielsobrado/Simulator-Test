/**
 * Run the deterministic collision acceptance battery against a hardware WebGPU adapter.
 *
 * Usage:
 *   npm run qa:collision
 *   npm run qa:collision -- --headed
 *   npm run qa:collision:release
 *   npm run qa:collision -- --url http://127.0.0.1:5173
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadCollisionAcceptanceConfig } from './lib/collisionAcceptanceConfig.mjs';
import {
  buildCollisionAcceptanceReport,
  renderCollisionAcceptanceMarkdown,
} from './lib/collisionAcceptanceReport.mjs';
import {
  removeDirectoryWithRetry,
  terminateChildProcess,
} from './lib/processLifecycle.mjs';
import {
  normaliseQaBaseUrl,
  resolveQaOutputDirectory,
} from './lib/qaRuntimeConfig.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHILD_TIMEOUT_PADDING_MS = 30_000;
const MAX_SERVER_LOG_CHARACTERS = 5_000_000;

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
  return parsed;
}

function resolveFromRepository(requestedPath, fallback) {
  const value = requestedPath ?? fallback;
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
}

function caseTimeoutMs(config, caseConfig) {
  return Math.ceil(
    (caseConfig.warmupSeconds
      + caseConfig.durationSeconds
      + config.timeoutPaddingSeconds) * 1000,
  );
}

function appendServerLog(current, chunk) {
  const next = current + chunk.toString();
  if (next.length <= MAX_SERVER_LOG_CHARACTERS) return next;
  return `[earlier Vite output truncated]\n${next.slice(-MAX_SERVER_LOG_CHARACTERS)}`;
}

async function preflightPort(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', (error) => reject(
      new Error(`Collision QA port ${preferredPort} is unavailable: ${error.message}`),
    ));
    server.listen({ host: '127.0.0.1', port: preferredPort }, () => {
      const address = server.address();
      const selectedPort = typeof address === 'object' ? address.port : preferredPort;
      server.close((error) => (error ? reject(error) : resolve(selectedPort)));
    });
  });
}

function startServer(port) {
  const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  return spawn(
    process.execPath,
    [viteEntry, '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
}

async function waitForServer(server, baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let spawnError = null;
  const recordSpawnError = (error) => { spawnError = error; };
  server.once('error', recordSpawnError);
  try {
    while (Date.now() < deadline) {
      if (spawnError) {
        throw new Error(`Collision QA Vite server failed to start: ${spawnError.message}`);
      }
      if (server.exitCode !== null) {
        throw new Error(`Collision QA Vite server exited with code ${server.exitCode}.`);
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
  } finally {
    server.off('error', recordSpawnError);
  }
  throw new Error(`Timed out waiting for ${baseUrl}: ${lastError?.message ?? 'unknown error'}`);
}

async function runChild(command, args, timeoutMs) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve('exited');
      else reject(new Error(`${path.basename(command)} exited with code ${code}.`));
    });
  });
  const outcome = await Promise.race([
    exit,
    delay(timeoutMs).then(() => 'timeout'),
  ]);
  if (outcome !== 'timeout') return;
  await terminateChildProcess(child);
  throw new Error(`${path.basename(command)} timed out after ${timeoutMs} ms.`);
}

function appendOptional(args, name, value) {
  if (value == null) return;
  args.push(`--${name}`, String(value));
}

function runnerArguments({
  config,
  caseConfig,
  baseUrl,
  reportPath,
  screenshotPath,
  headed,
}) {
  const timeoutMs = caseTimeoutMs(config, caseConfig);
  const args = [
    path.join(root, 'scripts', 'run-perf-qa.mjs'),
    '--url', baseUrl,
    '--qa', caseConfig.scenario,
    '--warmup', String(caseConfig.warmupSeconds),
    '--duration', String(caseConfig.durationSeconds),
    '--speed', caseConfig.speed,
    '--hitchMs', String(config.hitchMs),
    '--viewportWidth', String(config.viewport.width),
    '--viewportHeight', String(config.viewport.height),
    '--deviceScaleFactor', String(config.viewport.deviceScaleFactor),
    '--timeoutMs', String(timeoutMs),
    '--out', reportPath,
    '--screenshot', screenshotPath,
  ];
  appendOptional(args, 'x', caseConfig.spawn?.x);
  appendOptional(args, 'z', caseConfig.spawn?.z);
  appendOptional(args, 'yaw', caseConfig.yawDegrees);
  appendOptional(args, 'pitch', caseConfig.pitchDegrees);
  appendOptional(args, 'buildings', caseConfig.buildings);
  if (headed) args.push('--headed');
  return args;
}

async function loadReport(reportPath) {
  const text = await readFile(reportPath, 'utf8');
  return JSON.parse(text);
}

function relativeArtifact(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

async function runBattery() {
  const configPath = resolveFromRepository(
    readArgument('config'),
    path.join('config', 'collision-acceptance.yaml'),
  );
  const baseConfig = loadCollisionAcceptanceConfig(configPath);
  const repeatOverride = readArgument('repeats');
  const config = repeatOverride === null
    ? baseConfig
    : Object.freeze({
      ...baseConfig,
      repeats: positiveInteger(repeatOverride, '--repeats'),
    });
  const outputDirectory = resolveQaOutputDirectory(
    root,
    readArgument('output'),
    'collision-acceptance',
  );
  const externalUrl = normaliseQaBaseUrl(readArgument('url'));
  const headed = hasFlag('headed');
  const releaseMode = hasFlag('release');
  const requestedPort = readArgument('port');
  const serverTimeoutMs = positiveInteger(
    readArgument('serverTimeoutMs', '120000'),
    '--serverTimeoutMs',
  );

  await removeDirectoryWithRetry(outputDirectory);
  await mkdir(path.join(outputDirectory, 'cases'), { recursive: true });

  let server = null;
  let serverOutput = '';
  let baseUrl = externalUrl;
  const runs = [];

  try {
    if (!baseUrl) {
      const port = await preflightPort(
        requestedPort === null ? 0 : positiveInteger(requestedPort, '--port'),
      );
      baseUrl = `http://127.0.0.1:${port}`;
      server = startServer(port);
      server.stdout.on('data', (chunk) => { serverOutput = appendServerLog(serverOutput, chunk); });
      server.stderr.on('data', (chunk) => { serverOutput = appendServerLog(serverOutput, chunk); });
      await waitForServer(server, baseUrl, serverTimeoutMs);
    }

    for (const caseConfig of config.cases) {
      const caseDirectory = path.join(outputDirectory, 'cases', caseConfig.id);
      await mkdir(caseDirectory, { recursive: true });
      for (let repeat = 1; repeat <= config.repeats; repeat += 1) {
        const runName = `run-${String(repeat).padStart(2, '0')}`;
        const reportPath = path.join(caseDirectory, `${runName}.json`);
        const screenshotPath = path.join(caseDirectory, `${runName}.png`);
        await Promise.all([
          unlink(reportPath).catch(() => {}),
          unlink(screenshotPath).catch(() => {}),
        ]);
        console.log(`\n=== ${caseConfig.id} · run ${repeat}/${config.repeats} ===`);
        try {
          const timeoutMs = caseTimeoutMs(config, caseConfig) + CHILD_TIMEOUT_PADDING_MS;
          await runChild(process.execPath, runnerArguments({
            config,
            caseConfig,
            baseUrl,
            reportPath,
            screenshotPath,
            headed,
          }), timeoutMs);
          runs.push({
            caseId: caseConfig.id,
            repeat,
            reportPath: relativeArtifact(reportPath),
            screenshotPath: relativeArtifact(screenshotPath),
            report: await loadReport(reportPath),
            error: null,
          });
        } catch (error) {
          runs.push({
            caseId: caseConfig.id,
            repeat,
            reportPath: relativeArtifact(reportPath),
            screenshotPath: relativeArtifact(screenshotPath),
            report: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } finally {
    await terminateChildProcess(server);
    if (serverOutput) {
      await writeFile(path.join(outputDirectory, 'vite.log'), serverOutput, 'utf8');
    }
  }

  const report = buildCollisionAcceptanceReport({
    config,
    runs,
    source: Object.freeze({
      configPath: relativeArtifact(configPath),
      baseUrl,
      releaseMode,
      branch: process.env.GITHUB_REF_NAME ?? null,
      commit: process.env.GITHUB_SHA ?? null,
    }),
  });
  const reportPath = path.join(outputDirectory, 'report.json');
  const markdownPath = path.join(outputDirectory, 'report.md');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderCollisionAcceptanceMarkdown(report), 'utf8');

  console.log('\n=== COLLISION ACCEPTANCE ===');
  console.log(`execution gate: ${report.gates.execution.passed ? 'PASS' : 'FAIL'}`);
  console.log(`release gate: ${report.gates.release.passed ? 'PASS' : 'FAIL'}`);
  console.log(`missing coverage: ${report.coverage.missing.join(', ') || 'none'}`);
  console.log(`report: ${reportPath}`);
  console.log(`markdown: ${markdownPath}`);

  const passed = releaseMode
    ? report.gates.release.passed
    : report.gates.execution.passed;
  if (!passed) process.exitCode = 1;
}

await runBattery();
