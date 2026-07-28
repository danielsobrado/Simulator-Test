import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIconGridMarkup } from '../src/editor/ui/IconGridMenu.js';
import { icon } from '../src/editor/ui/icons.js';

function tiles(markup) {
  return [...markup.matchAll(/data-grid-item="([^"]*)"/g)].map(([, id]) => id);
}

function groups(markup) {
  return [...markup.matchAll(/<div class="icon-grid__group"[^>]*>/g)].map(([tag]) => tag);
}

test('a group renders one tile per item, in order', () => {
  const items = ['door', 'window', 'arch'].map((id) => ({ id, label: id }));
  const markup = buildIconGridMarkup({ groups: [{ id: 'kinds', items }] });
  assert.deepEqual(tiles(markup), ['door', 'window', 'arch']);
});

test('each group carries its own column count, defaulting to the panel', () => {
  const markup = buildIconGridMarkup({
    columns: 6,
    groups: [
      { id: 'kinds', items: [{ id: 'door', label: 'Door' }] },
      { id: 'profiles', columns: 4, items: [{ id: 'round', label: 'Round' }] },
    ],
  });
  const [kinds, profiles] = groups(markup);
  assert.ok(kinds.includes('--grid-columns:6'));
  // Per-group columns are what give the panel its ragged reference layout: a
  // wide row of kinds above a short row of profiles, in one popup.
  assert.ok(profiles.includes('--grid-columns:4'));
});

test('a nonsense column count falls back rather than emitting NaN', () => {
  const markup = buildIconGridMarkup({
    groups: [{ id: 'g', columns: 'wide', items: [{ id: 'a', label: 'A' }] }],
  });
  assert.ok(groups(markup)[0].includes('--grid-columns:6'));
  assert.ok(!markup.includes('NaN'));
});

test('every tile is a labelled menu item', () => {
  const markup = buildIconGridMarkup({
    groups: [{ items: [{ id: 'pointed', label: 'Pointed arch' }] }],
  });
  assert.ok(markup.includes('role="menuitem"'));
  assert.ok(markup.includes('aria-label="Pointed arch"'));
  assert.ok(markup.includes('title="Pointed arch"'));
});

test('pressed state is announced only where the caller models one', () => {
  const toggles = buildIconGridMarkup({
    groups: [{ items: [{ id: 'a', label: 'A', active: true }, { id: 'b', label: 'B', active: false }] }],
  });
  assert.ok(toggles.includes('aria-pressed="true"'));
  assert.ok(toggles.includes('aria-pressed="false"'));
  assert.ok(toggles.includes('is-active'));

  // A plain action is not a toggle, and announcing it as one would tell a screen
  // reader there is a state to come back to.
  const plain = buildIconGridMarkup({ groups: [{ items: [{ id: 'a', label: 'A' }] }] });
  assert.ok(!plain.includes('aria-pressed'));
  assert.ok(!plain.includes('is-active'));
});

test('icon markup reaches the tile intact', () => {
  const markup = buildIconGridMarkup({
    groups: [{ items: [{ id: 'door', label: 'Door', icon: icon('door') }] }],
  });
  assert.ok(markup.includes('<svg'), 'the tile must carry its glyph');
  assert.ok(markup.includes('stroke="currentColor"'));
});

test('labels and ids are escaped rather than injected', () => {
  // Icon markup is inserted raw so SVG can reach the page at all, which makes
  // escaping everything else the boundary that keeps that safe.
  const markup = buildIconGridMarkup({
    groups: [{
      id: 'g"><script>x()</script>',
      label: 'Bad "quote" & <tag>',
      items: [{ id: 'a"><script>y()</script>', label: 'Also <bad>' }],
    }],
  });
  assert.ok(!markup.includes('<script>'), 'markup must not carry an injected tag');
  assert.ok(markup.includes('&quot;'));
  assert.ok(markup.includes('&amp;'));
  assert.ok(markup.includes('&lt;tag&gt;'));
});

test('an empty panel renders nothing rather than an empty row', () => {
  assert.equal(buildIconGridMarkup(), '');
  assert.equal(buildIconGridMarkup({ groups: [] }), '');
  assert.equal(buildIconGridMarkup({ groups: [{ items: [] }] }), '');
  // A caller building groups conditionally must not leave a gap behind.
  const partial = buildIconGridMarkup({
    groups: [{ id: 'empty', items: [] }, { id: 'kinds', items: [{ id: 'a', label: 'A' }] }],
  });
  assert.equal(groups(partial).length, 1);
});
