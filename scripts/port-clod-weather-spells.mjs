/**
 * Port clod-poc weather + spell VFX sources into SimCity-DnD as ESM JavaScript.
 * Creates shim modules for CLOD-only dependencies (sun atlas, terrain edit, audio bus).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const simCity = path.resolve(__dirname, '..');
const clod = path.resolve(
  simCity,
  '..',
  'workspace',
  'GitHub',
  'drus',
  'drusniel-voxels-bevy',
  'tools',
  'clod-poc',
);
const altClod = 'F:\\Development\\workspace\\GitHub\\drus\\drusniel-voxels-bevy\\tools\\clod-poc';
const clodRoot = fs.existsSync(clod) ? clod : altClod;

const weatherOut = path.join(simCity, 'src', 'editor', 'weather');
const spellsOut = path.join(simCity, 'src', 'editor', 'spells');
const shimRoot = path.join(simCity, 'src', 'editor', '_clod_shims');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyTsSources(relDir, outDir) {
  ensureDir(outDir);
  const srcDir = path.join(clodRoot, relDir);
  for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith('.ts') && !name.endsWith('.css')) continue;
    if (name.includes('.test.')) continue;
    fs.copyFileSync(path.join(srcDir, name), path.join(outDir, name));
  }
}

function write(file, contents) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, contents);
}

function writeShims() {
  write(path.join(shimRoot, 'sun_light_gpu_atlas.js'), `
export function getSunLightGpuAtlas() {
  return {
    version: 0,
    valid: 0,
    originX: 0,
    originZ: 0,
    worldSize: 1,
  };
}
`);

  write(path.join(shimRoot, 'environment_mask_config.js'), `
export const DEFAULT_ENVIRONMENTAL_MASK_SETTINGS = Object.freeze({
  enabled: true,
  riverCobble: Object.freeze({ enabled: true, strength: 1, minDepthM: 0.06, maxDepthM: 1.4, minFlowStrength: 0.015, maxFlowStrength: 1.8, maxShoreDistanceM: 10, minNormalY: 0.58 }),
  riverMist: Object.freeze({ enabled: true, strength: 1, minFlowStrength: 0.01, maxShoreDistanceM: 14, particles: Object.freeze({ spawnRadiusM: 54, spacingM: 5.5, sampleHintM: 16, emitIntervalS: 0.12, maxParticles: 240, maxEmittersPerTick: 18, scanCellsPerFrame: 28, pointSizeM: 3.4, opacity: 0.32, spawnProbability: 0.72, riseSpeedMps: 0.16, driftSpeedMps: 0.13, minLifetimeS: 2.8, maxLifetimeS: 5.5, surfaceOffsetM: 0.22, colorRgb: [0.82, 0.91, 0.94] }) }),
  rapidSplash: Object.freeze({ enabled: true, strength: 1, flowStart: 0.35, flowEnd: 1.2, bedDropStart: 0.35, bedDropEnd: 1.8 }),
  sunbeamMote: Object.freeze({
    enabled: true,
    strength: 1,
    visibilityStart: 0.45,
    visibilityEnd: 0.9,
    particles: Object.freeze({
      maxParticles: 1200,
      spawnRadiusM: 42,
      fadeStartM: 34,
      fadeEndM: 42,
      updatePeriodFrames: 8,
      density: 0.72,
      opacity: 0.82,
      forwardScatterPower: 8,
      mistFloor: 0.18,
      warmColorRgb: [0.85, 0.75, 0.45],
      coldColorRgb: [0.78, 0.9, 1],
    }),
  }),
  calmPool: Object.freeze({ enabled: true, strength: 1, minDepthM: 0.45, maxFlowStrength: 0.08 }),
  frost: Object.freeze({ enabled: true, strength: 1, visibilityStart: 0.2, visibilityEnd: 0.85, wetnessSuppression: 0.7 }),
  dew: Object.freeze({ enabled: true, strength: 1, wetnessStart: 0.25, wetnessEnd: 0.85 }),
  shoreDebris: Object.freeze({ enabled: true, strength: 1 }),
});
`);

  write(path.join(shimRoot, 'environment_mask_runtime.js'), `
import { DEFAULT_ENVIRONMENTAL_MASK_SETTINGS } from './environment_mask_config.js';

let settings = DEFAULT_ENVIRONMENTAL_MASK_SETTINGS;

export function readEnvironmentalMaskSettings() {
  return settings;
}

export function setEnvironmentalMaskSettings(next) {
  settings = next ?? DEFAULT_ENVIRONMENTAL_MASK_SETTINGS;
}
`);

  write(path.join(shimRoot, 'environment_mask_types.js'), `
// Types-only module in clod-poc; runtime placeholder for JS imports.
export {};
`);

  write(path.join(shimRoot, 'sunbeam_mote_mask_state.js'), `
export function evaluateSunbeamMoteAirborneState(biome) {
  if (!biome || biome.enabled === false) {
    return { amount: 0, coldBlend: 0, localMist: 0 };
  }
  const pollen = Number(biome.pollenAmount) || 0;
  const frost = Number(biome.frostAmount) || 0;
  const mist = Number(biome.morningMist) || 0;
  return {
    amount: Math.min(1, Math.max(0, pollen * 0.55 + mist * 0.35 + 0.15)),
    coldBlend: Math.min(1, Math.max(0, frost)),
    localMist: Math.min(1, Math.max(0, mist)),
  };
}
`);

  write(path.join(shimRoot, 'biome_visual_state.js'), `
export function readActiveBiomeVisualState() {
  return {
    enabled: true,
    pollenAmount: 0.55,
    frostAmount: 0,
    morningMist: 0.2,
  };
}
`);

  write(path.join(shimRoot, 'audio.js'), `
export function emitAudio() {}
export function setAudioEnabled() {}
export function setMasterVolume() {}
export function getAudioState() {
  return { enabled: false, masterVolume: 0 };
}
`);

  write(path.join(shimRoot, 'terrain.js'), `
export const BrushOp = Object.freeze({ Add: 'add', Remove: 'remove' });
export const BrushShape = Object.freeze({ Sphere: 'sphere', Cube: 'cube' });
export function getDigEditRevision() {
  return 0;
}
`);

  write(path.join(shimRoot, 'terrain_edit_service.js'), `
export function createTerrainEditService() {
  return {
    prepare() { return null; },
    execute() { return { ok: false, reason: 'terrain-edit-unavailable' }; },
  };
}
export function prepareTerrainEdit() { return null; }
export function executeTerrainEdit() { return { ok: false }; }
`);

  write(path.join(shimRoot, 'edit_commands.js'), `
export function createEditCommand() {
  return null;
}
`);

  // Copy prop_billboard as TS then transpile with the rest
  fs.copyFileSync(
    path.join(clodRoot, 'src', 'props', 'prop_billboard.ts'),
    path.join(shimRoot, 'prop_billboard.ts'),
  );
}

function rewriteImports(filePath) {
  let text = fs.readFileSync(filePath, 'utf8');
  const replacements = [
    [/from ["']\.\.\/terrain\/sun_visibility\/sun_light_gpu_atlas\.js["']/g, "from '../_clod_shims/sun_light_gpu_atlas.js'"],
    [/from ["']\.\.\/environment_masks\/environment_mask_config\.js["']/g, "from '../_clod_shims/environment_mask_config.js'"],
    [/from ["']\.\.\/environment_masks\/environment_mask_runtime\.js["']/g, "from '../_clod_shims/environment_mask_runtime.js'"],
    [/from ["']\.\.\/environment_masks\/environment_mask_types\.js["']/g, "from '../_clod_shims/environment_mask_types.js'"],
    [/from ["']\.\.\/environment_masks\/sunbeam_mote_mask_state\.js["']/g, "from '../_clod_shims/sunbeam_mote_mask_state.js'"],
    [/from ["']\.\.\/environment\/biome_visual_state\.js["']/g, "from '../_clod_shims/biome_visual_state.js'"],
    [/from ["']\.\.\/audio\/index\.js["']/g, "from '../_clod_shims/audio.js'"],
    [/from ["']\.\.\/props\/prop_billboard\.js["']/g, "from '../_clod_shims/prop_billboard.js'"],
    [/from ["']\.\.\/terrain\/terrain\.js["']/g, "from '../_clod_shims/terrain.js'"],
    [/from ["']\.\.\/terrain\/editing\/terrain_edit_service\.js["']/g, "from '../_clod_shims/terrain_edit_service.js'"],
    [/from ["']\.\.\/player\/edit_commands\.js["']/g, "from '../_clod_shims/edit_commands.js'"],
  ];
  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }
  fs.writeFileSync(filePath, text);
}

function patchSpellConfig() {
  const file = path.join(spellsOut, 'spell_config.ts');
  let text = fs.readFileSync(file, 'utf8');
  text = text.replace(/^import \{ load \} from "js-yaml";\r?\n/, '');
  text = text.replace(/^import spellsYamlText from ["'][^"']+["'];\r?\n/, '');
  text = text.replace(
    /export function parseSpellConfig\(text: string = spellsYamlText\): SpellConfig \{[\s\S]*?\n\}\r?\n\r?\nexport const defaultSpellConfig = parseSpellConfig\(\);/,
    `export function parseSpellConfig(_text?: string): SpellConfig {
  return DEFAULT_SPELL_CONFIG;
}

export const defaultSpellConfig = DEFAULT_SPELL_CONFIG;`,
  );
  fs.writeFileSync(file, text);
}

function embedSpellsYaml() {
  const yamlPath = path.join(clodRoot, 'config', 'spells.yaml');
  if (!fs.existsSync(yamlPath)) return;
  const parsed = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
  write(
    path.join(simCity, 'config', 'spells.yaml'),
    fs.readFileSync(yamlPath, 'utf8'),
  );
  write(
    path.join(spellsOut, 'spells_yaml_defaults.json'),
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
}

function transpileAll() {
  const entries = [];
  for (const dir of [weatherOut, spellsOut, shimRoot]) {
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.ts')) entries.push(path.join(dir, name));
    }
  }
  for (const entry of entries) {
    const outfile = entry.replace(/\.ts$/, '.js');
    const result = spawnSync(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      [
        '--yes',
        'esbuild',
        entry,
        `--outfile=${outfile}`,
        '--format=esm',
        '--platform=browser',
        '--target=es2022',
      ],
      {
        cwd: simCity,
        encoding: 'utf8',
        shell: true,
      },
    );
    if (result.status !== 0) {
      console.error(result.stdout);
      console.error(result.stderr);
      throw new Error(`esbuild transpile failed for ${entry}`);
    }
    fs.unlinkSync(entry);
  }
}

function rewriteJsImports() {
  for (const dir of [weatherOut, spellsOut]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.js')) continue;
      rewriteImports(path.join(dir, name));
    }
  }
}

ensureDir(weatherOut);
ensureDir(spellsOut);
copyTsSources('src/weather', weatherOut);
copyTsSources('src/spells', spellsOut);
writeShims();
patchSpellConfig();
embedSpellsYaml();

// Rewrite TS imports before transpile so esbuild resolves shims.
for (const dir of [weatherOut, spellsOut]) {
  for (const name of fs.readdirSync(dir)) {
    if (name.endsWith('.ts')) rewriteImports(path.join(dir, name));
  }
}

transpileAll();
rewriteJsImports();

console.log('Ported weather + spells from', clodRoot);
console.log('weather files', fs.readdirSync(weatherOut).length);
console.log('spells files', fs.readdirSync(spellsOut).length);
