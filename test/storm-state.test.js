import assert from 'node:assert/strict';
import test from 'node:test';
import { StormState, readStormOverride, stormTargetForSettings } from '../src/editor/weather/storm/StormState.js';

const run = (state, seconds, step = 0.05) => {
  for (let t = 0; t < seconds; t += step) state.step(step);
  return state.frame;
};

test('a storm builds no faster than 90 s and breaks no faster than 150 s', () => {
  const state = new StormState();
  state.setTarget(stormTargetForSettings({ weatherMode: 'storm', weatherIntensity: 1 }));
  assert.ok(run(state, 60).storm < 0.7, 'still building after a minute');
  assert.equal(run(state, 120).storm, 1);
  state.setTarget(stormTargetForSettings({ weatherMode: 'off' }));
  assert.ok(run(state, 100).storm > 0.3, 'still breaking after 100 s');
  assert.equal(run(state, 200).storm, 0);
});

test('the sky darkens before rain falls, and rain stops before the sky clears', () => {
  const state = new StormState();
  state.setTarget(stormTargetForSettings({ weatherMode: 'rain', weatherIntensity: 1 }));
  const early = run(state, 15);
  assert.ok(early.cloud > 20 * early.rain, `cloud ${early.cloud} rain ${early.rain}`);
  run(state, 200);
  state.setTarget(stormTargetForSettings({ weatherMode: 'off' }));
  let frame;
  do frame = state.step(0.05); while (frame.rain > 0.02);
  assert.ok(frame.cloud > 0.2, `cloud still in when the rain has stopped (${frame.cloud})`);
});

test('climate splits precipitation into rain, sleet and snow; explicit modes force it', () => {
  const state = new StormState();
  state.setTarget(stormTargetForSettings({ weatherMode: 'storm', weatherIntensity: 1 }));
  state.setSnowShare(0.5);
  const sleet = state.snap();
  assert.equal(sleet.rain, 0.5);
  assert.equal(sleet.snow, 0.5);
  assert.ok(sleet.lightning > 0 && sleet.lightning < 1);
  state.setSnowShare(1);
  assert.equal(state.snap().lightning, 0, 'no thunder in a blizzard');
  state.setTarget(stormTargetForSettings({ weatherMode: 'rain', weatherIntensity: 1 }));
  assert.equal(state.snap().snow, 0, 'rain mode rains even in snow country');
});

test('dry modes only set floors, and intensities above 1 stay denser than a storm', () => {
  const overcast = new StormState();
  overcast.setTarget(stormTargetForSettings({ weatherMode: 'overcast', weatherIntensity: 0.6 }));
  assert.deepEqual([overcast.snap().cloud, overcast.frame.precip], [0.6, 0]);
  const capture = new StormState();
  capture.setTarget(stormTargetForSettings({ weatherMode: 'rain', weatherIntensity: 1.4 }));
  assert.equal(capture.snap().rain, 1.4);
  assert.equal(new StormState().snap().cloud, 0, 'clear stays clear');
});

test('the URL override reads storm, snap and kind', () => {
  assert.equal(readStormOverride('?x=1'), null);
  assert.deepEqual(readStormOverride('?storm=0.75&stormSnap=1&stormKind=snow'), { storm: 0.75, kind: 'snow', snap: true });
  assert.deepEqual(readStormOverride('?storm=7&stormKind=hail'), { storm: 1, kind: 'auto', snap: false });
});
