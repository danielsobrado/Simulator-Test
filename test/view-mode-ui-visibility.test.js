import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const uiSource = readFileSync(
  new URL('../src/editor/player/ViewModeUi.js', import.meta.url),
  'utf8',
);
const cssSource = readFileSync(
  new URL('../src/editor/player/playerMode.css', import.meta.url),
  'utf8',
);

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cssSource.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] ?? '';
}

test('camera mode switch is mounted directly in the viewport', () => {
  assert.match(uiSource, /viewport\.append\(this\.switcher\)/);
  assert.doesNotMatch(uiSource, /topbar\.prepend\(this\.switcher\)/);
  assert.doesNotMatch(uiSource, /querySelector\(['"]\.topbar['"]\)/);
});

test('camera mode switch remains visible above viewport content', () => {
  const rule = cssRule('.view-mode-switcher');
  assert.match(rule, /position:\s*absolute/);
  assert.match(rule, /z-index:\s*[4-9]\d*/);
  assert.match(rule, /left:\s*50%/);
  assert.match(rule, /max-width:\s*calc\(100%\s*-\s*24px\)/);
});
