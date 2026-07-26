import assert from 'node:assert/strict';
import test from 'node:test';
import { AssetStartupTelemetry } from '../src/editor/performance/AssetStartupTelemetry.js';

test('asset startup telemetry reports decode, transcode, and residency totals', () => {
  let now = 0;
  const telemetry = new AssetStartupTelemetry({ clock: () => now });
  const asset = telemetry.beginAsset('/assets/tree.glb');
  now = 12;
  telemetry.recordMeshopt({
    durationMs: 3,
    compressedBytes: 20,
    decodedBytes: 80,
  });
  telemetry.recordKtx2({
    durationMs: 5,
    texture: {
      format: 123456,
      mipmaps: [
        { width: 4, height: 4, data: new Uint8Array(16) },
      ],
    },
  });
  telemetry.endAsset(asset);
  now = 15;
  telemetry.markAssetsReady();
  now = 20;
  telemetry.markFirstFrame();

  const report = telemetry.getReport();
  assert.equal(report.status, 'done');
  assert.equal(report.navigationToAssetsReadyMs, 15);
  assert.equal(report.navigationToFirstFrameMs, 20);
  assert.equal(report.assetCount, 1);
  assert.equal(report.failedAssets, 0);
  assert.deepEqual(report.meshopt, {
    decodeCount: 1,
    summedTaskMs: 3,
    p50TaskMs: 3,
    p95TaskMs: 3,
    maxTaskMs: 3,
    compressedBytes: 20,
    decodedBytes: 80,
  });
  assert.equal(report.ktx2.transcodeCount, 1);
  assert.equal(report.ktx2.gpuTextureBytes, 16);
  assert.equal(report.ktx2.rgba8TextureBytes, 64);
  assert.equal(report.ktx2.residencyReductionRatio, 0.75);
});
