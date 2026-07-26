import {
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGB_S3TC_DXT1_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_ASTC_6x6_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_2BPPV1_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
} from 'three';

const FORMAT_NAMES = new Map([
  [RGB_ETC1_Format, 'ETC1_RGB'],
  [RGB_ETC2_Format, 'ETC2_RGB'],
  [RGBA_ETC2_EAC_Format, 'ETC2_RGBA'],
  [RGB_S3TC_DXT1_Format, 'BC1_RGB'],
  [RGBA_S3TC_DXT1_Format, 'BC1_RGBA'],
  [RGBA_S3TC_DXT5_Format, 'BC3_RGBA'],
  [RGBA_BPTC_Format, 'BC7_RGBA'],
  [RGBA_ASTC_4x4_Format, 'ASTC_4x4_RGBA'],
  [RGBA_ASTC_6x6_Format, 'ASTC_6x6_RGBA'],
  [RGB_PVRTC_4BPPV1_Format, 'PVRTC1_4_RGB'],
  [RGBA_PVRTC_4BPPV1_Format, 'PVRTC1_4_RGBA'],
  [RGBA_PVRTC_2BPPV1_Format, 'PVRTC1_2_RGBA'],
]);

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function round(value) {
  return Number(value.toFixed(3));
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.floor(ordered.length * ratio));
  return round(ordered[index]);
}

function resourceTiming(url) {
  if (typeof performance === 'undefined' || typeof location === 'undefined') return null;
  const resolved = new URL(url, location.href).href;
  const entries = performance.getEntriesByName(resolved, 'resource');
  const entry = entries.at(-1);
  if (!entry) return null;
  return {
    durationMs: round(entry.duration),
    transferBytes: entry.transferSize ?? 0,
    encodedBodyBytes: entry.encodedBodySize ?? 0,
    decodedBodyBytes: entry.decodedBodySize ?? 0,
  };
}

function textureStorage(texture) {
  const levels = texture.mipmaps?.length
    ? texture.mipmaps
    : (texture.image ? [texture.image] : []);
  let gpuBytes = 0;
  let rgba8Bytes = 0;
  for (const level of levels) {
    const width = level.width ?? texture.image?.width ?? 0;
    const height = level.height ?? texture.image?.height ?? 0;
    const depth = level.depth ?? texture.image?.depth ?? 1;
    gpuBytes += level.data?.byteLength ?? 0;
    rgba8Bytes += width * height * depth * 4;
  }
  return {
    width: levels[0]?.width ?? texture.image?.width ?? 0,
    height: levels[0]?.height ?? texture.image?.height ?? 0,
    mipLevels: levels.length,
    gpuBytes,
    rgba8Bytes,
    format: FORMAT_NAMES.get(texture.format) ?? `format-${texture.format}`,
  };
}

export class AssetStartupTelemetry {
  constructor({ clock = () => performance.now(), navigationStart = 0 } = {}) {
    this.clock = clock;
    this.startedAt = navigationStart;
    this.assetsReadyAt = null;
    this.firstFrameAt = null;
    this.status = 'loading';
    this.assets = [];
    this.meshoptDecodes = [];
    this.ktx2Transcodes = [];
    this.ktx2Support = null;
  }

  beginAsset(url) {
    return { url, startedAt: this.clock() };
  }

  endAsset(token, error = null) {
    const endedAt = this.clock();
    this.assets.push({
      url: token.url,
      durationMs: round(endedAt - token.startedAt),
      failed: Boolean(error),
      error: error ? String(error.message ?? error) : null,
      resource: resourceTiming(token.url),
    });
  }

  recordMeshopt({ durationMs, compressedBytes, decodedBytes }) {
    this.meshoptDecodes.push({
      durationMs: round(durationMs),
      compressedBytes,
      decodedBytes,
    });
  }

  recordKtx2({ durationMs, texture, error = null }) {
    this.ktx2Transcodes.push({
      durationMs: round(durationMs),
      failed: Boolean(error),
      error: error ? String(error.message ?? error) : null,
      ...(texture ? textureStorage(texture) : {}),
    });
  }

  setKtx2Support(support) {
    this.ktx2Support = { ...support };
  }

  markAssetsReady() {
    if (this.assetsReadyAt !== null) return;
    this.assetsReadyAt = this.clock();
    this.status = 'assets-ready';
  }

  markFirstFrame() {
    if (this.firstFrameAt !== null) return;
    this.firstFrameAt = this.clock();
    this.status = 'done';
  }

  getReport() {
    const meshoptDurationMs = sum(this.meshoptDecodes.map((entry) => entry.durationMs));
    const ktx2DurationMs = sum(this.ktx2Transcodes.map((entry) => entry.durationMs));
    const meshoptDurations = this.meshoptDecodes.map((entry) => entry.durationMs);
    const ktx2Durations = this.ktx2Transcodes.map((entry) => entry.durationMs);
    const gpuTextureBytes = sum(this.ktx2Transcodes.map((entry) => entry.gpuBytes ?? 0));
    const rgba8TextureBytes = sum(this.ktx2Transcodes.map((entry) => entry.rgba8Bytes ?? 0));
    return {
      version: 1,
      kind: 'simcity-dnd-asset-startup-qa',
      status: this.status,
      navigationToAssetsReadyMs: this.assetsReadyAt === null
        ? null
        : round(this.assetsReadyAt - this.startedAt),
      navigationToFirstFrameMs: this.firstFrameAt === null
        ? null
        : round(this.firstFrameAt - this.startedAt),
      assetCount: this.assets.length,
      failedAssets: this.assets.filter((entry) => entry.failed).length,
      assets: this.assets.map((entry) => ({ ...entry })),
      meshopt: {
        decodeCount: this.meshoptDecodes.length,
        summedTaskMs: round(meshoptDurationMs),
        p50TaskMs: percentile(meshoptDurations, 0.5),
        p95TaskMs: percentile(meshoptDurations, 0.95),
        maxTaskMs: round(Math.max(0, ...meshoptDurations)),
        compressedBytes: sum(
          this.meshoptDecodes.map((entry) => entry.compressedBytes),
        ),
        decodedBytes: sum(this.meshoptDecodes.map((entry) => entry.decodedBytes)),
      },
      ktx2: {
        transcodeCount: this.ktx2Transcodes.length,
        failedTranscodes: this.ktx2Transcodes.filter((entry) => entry.failed).length,
        summedTaskMs: round(ktx2DurationMs),
        p50TaskMs: percentile(ktx2Durations, 0.5),
        p95TaskMs: percentile(ktx2Durations, 0.95),
        maxTaskMs: round(Math.max(0, ...ktx2Durations)),
        gpuTextureBytes,
        rgba8TextureBytes,
        residencyReductionRatio: rgba8TextureBytes > 0
          ? round(1 - gpuTextureBytes / rgba8TextureBytes)
          : null,
        formats: Object.fromEntries(
          [...new Set(this.ktx2Transcodes.map((entry) => entry.format).filter(Boolean))]
            .sort()
            .map((format) => [
              format,
              this.ktx2Transcodes.filter((entry) => entry.format === format).length,
            ]),
        ),
        support: this.ktx2Support ? { ...this.ktx2Support } : null,
        textures: this.ktx2Transcodes.map((entry) => ({ ...entry })),
      },
    };
  }
}

export const assetStartupTelemetry = new AssetStartupTelemetry();

if (typeof window !== 'undefined') {
  window.__assetStartupTelemetry = {
    get status() {
      return assetStartupTelemetry.status;
    },
    getReport() {
      return assetStartupTelemetry.getReport();
    },
  };
}
