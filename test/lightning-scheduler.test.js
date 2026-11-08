import assert from 'node:assert/strict';
import test from 'node:test';
import { LightningScheduler, flashEnvelope } from '../src/editor/weather/storm/LightningScheduler.js';

function run(seed, lightning, seconds) {
  const scheduler = new LightningScheduler({ seed });
  const events = [];
  scheduler.subscribe((event) => events.push(event));
  let peak = 0;
  for (let t = 0; t < seconds; t += 1 / 60) peak = Math.max(peak, scheduler.step(1 / 60, lightning));
  return { events, peak };
}

test('the same seed strikes at the same times, places and kinds', () => {
  assert.deepEqual(run(7, 1, 600).events, run(7, 1, 600).events);
  assert.notDeepEqual(run(7, 1, 600).events, run(8, 1, 600).events);
});

test('no lightning, no strikes and no flash', () => {
  const { events, peak } = run(7, 0, 600);
  assert.equal(events.length, 0);
  assert.equal(peak, 0);
});

test('the strike rate rises with lightning toward 3 a minute', () => {
  const full = run(7, 1, 1200).events.length;
  const heavy = run(7, 0.65, 1200).events.length;
  assert.ok(full > 40 && full < 80, `full storm: ${full} strikes in 20 min`);
  assert.ok(heavy < full / 2, `heavy ${heavy} vs full ${full}`);
});

test('strike events are frozen, distant and mostly sheet lightning', () => {
  const { events, peak } = run(3, 1, 3600);
  for (const event of events) {
    assert.ok(Object.isFrozen(event));
    assert.ok(event.distance >= 400 && event.distance <= 8000);
    assert.ok(event.bearing >= 0 && event.bearing < Math.PI * 2);
  }
  const bolts = events.filter((event) => event.kind === 'bolt').length;
  assert.ok(bolts > 0 && bolts < events.length * 0.35);
  assert.ok(peak > 0 && peak <= 1);
});

test('the flash is a double pulse that is over within 250 ms', () => {
  assert.equal(flashEnvelope(0), 1);
  assert.ok(flashEnvelope(0.14) > flashEnvelope(0.11));
  assert.equal(flashEnvelope(0.26), 0);
});
