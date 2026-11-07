import assert from 'node:assert/strict';
import test from 'node:test';
import { ReflectionCaptureSchedule } from '../src/render/reflections/ReflectionCaptureSchedule.js';
import { RENDER_ENHANCEMENT_DEFAULTS } from '../src/config/RenderEnhancements.js';
import { FrameSlack } from '../src/editor/performance/FrameSlack.js';

test('reflection scheduling keeps the default cadence and honors custom strides', () => {
  for (const stride of [1, 4, 7, 16]) {
    const schedule = new ReflectionCaptureSchedule({ ...RENDER_ENHANCEMENT_DEFAULTS.waterReflections, captureFrameStride: stride });
    const turns = Array.from({ length: 50 }, (_, frame) => schedule.nextFrame() ? frame : null).filter(frame => frame !== null);
    assert.deepEqual(turns, Array.from({ length: Math.ceil(50 / stride) }, (_, index) => index * stride));
  }
});

test('reflection reservations estimate cube and planar work independently without reducing the capture cadence', () => {
  const schedule = new ReflectionCaptureSchedule({ initialCaptureCpuMs: 3, captureSafetyFactor: 1.5 });
  assert.equal(schedule.budgetMs('cube'), 4.5);
  assert.equal(schedule.budgetMs('planar'), 4.5);
  schedule.record('cube', 1);
  assert.equal(schedule.budgetMs('cube'), 1.5);
  schedule.record('planar', 8);
  assert.equal(schedule.budgetMs('planar'), 12);
  schedule.record('cube', 5);
  assert.equal(schedule.budgetMs('cube'), 7.5, 'expensive work raises the estimate immediately');
  schedule.record('cube', 1);
  assert.equal(schedule.budgetMs('cube'), 6, 'cheaper work relaxes the estimate gradually');
  schedule.record('cube', NaN);
  assert.equal(schedule.budgetMs('cube'), 6);
  const slack = new FrameSlack({ targetMs: 20, reserveMs: 0, now: () => 0 }); slack.beginFrame();
  const reservation = slack.reserve(0, schedule.budgetMs('planar'));
  assert.equal(slack.deferredMs, 12);
  reservation.cancel(); assert.equal(slack.deferredMs, 0);
  const zero = new ReflectionCaptureSchedule({}); zero.record('cube', 0);
  assert.ok(zero.budgetMs('cube') > 0, 'coarse clocks cannot starve future captures with a zero reservation');
});
