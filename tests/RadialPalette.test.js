import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRadialMarkup, petalAngle } from '../src/editor/ui/RadialPalette.js';

function petals(markup) {
  return [...markup.matchAll(/data-radial-item="([^"]*)"[^>]*style="([^"]*)"/g)]
    .map(([, id, style]) => ({ id, style }));
}

function styleVar(style, name) {
  return new RegExp(`--${name}:([^;"]+)`).exec(style)?.[1] ?? null;
}

test('petals start at the top and divide the circle evenly', () => {
  assert.equal(petalAngle(0, 8), -90);
  assert.equal(petalAngle(2, 8), 0);
  assert.equal(petalAngle(4, 8), 90);
  // A single petal must not divide by zero.
  assert.equal(petalAngle(0, 0), -90);
});

test('a ring renders one petal per item at the expected angles', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id, label: id, color: '#112233' }));
  const found = petals(buildRadialMarkup({ rings: [{ items }] }));
  assert.equal(found.length, 4);
  found.forEach((petal, index) => {
    assert.equal(petal.id, items[index].id);
    assert.equal(styleVar(petal.style, 'angle'), `${petalAngle(index, 4)}deg`);
  });
});

test('each ring carries its own radius', () => {
  const markup = buildRadialMarkup({
    rings: [
      { radius: 79, items: [{ id: 'outer', label: 'Outer' }] },
      { radius: 46, items: [{ id: 'inner', label: 'Inner' }] },
    ],
  });
  const found = petals(markup);
  assert.equal(found.length, 2);
  assert.equal(styleVar(found[0].style, 'ring-radius'), '79px');
  assert.equal(styleVar(found[1].style, 'ring-radius'), '46px');
  // Multi-ring is the capability the workshop original lacked, and the reason
  // `open` takes rings rather than a flat item list.
  assert.notEqual(
    styleVar(found[0].style, 'ring-radius'),
    styleVar(found[1].style, 'ring-radius'),
  );
});

test('petals without a colour fall back to the stylesheet default', () => {
  const markup = buildRadialMarkup({ rings: [{ items: [{ id: 'a', label: 'A' }] }] });
  assert.equal(styleVar(petals(markup)[0].style, 'petal-color'), null);
});

test('the centre and footer buttons appear only when configured', () => {
  const bare = buildRadialMarkup({ rings: [{ items: [{ id: 'a', label: 'A' }] }] });
  assert.ok(!bare.includes('radial-palette__center'));
  assert.ok(!bare.includes('radial-palette__footer'));

  const full = buildRadialMarkup({
    rings: [{ items: [{ id: 'a', label: 'A' }] }],
    center: { action: 'reset', glyph: '↺', label: 'Reset' },
    footer: { action: 'more', label: 'More…' },
  });
  assert.ok(full.includes('data-radial-action="reset"'));
  assert.ok(full.includes('data-radial-action="more"'));
  assert.ok(full.includes('↺'));
  assert.ok(full.includes('More…'));
});

test('every petal is a labelled menu item', () => {
  const markup = buildRadialMarkup({
    rings: [{ items: [{ id: 'granite-masonry', label: 'Granite masonry' }] }],
  });
  assert.ok(markup.includes('role="menuitem"'));
  assert.ok(markup.includes('aria-label="Granite masonry"'));
  assert.ok(markup.includes('title="Granite masonry"'));
});

test('labels and ids are escaped rather than injected', () => {
  const markup = buildRadialMarkup({
    rings: [{ items: [{ id: 'a"><script>x()</script>', label: 'Bad "quote" & <tag>' }] }],
  });
  assert.ok(!markup.includes('<script>'), 'markup must not carry an injected tag');
  assert.ok(markup.includes('&quot;'));
  assert.ok(markup.includes('&amp;'));
  assert.ok(markup.includes('&lt;tag&gt;'));
});

test('an empty palette renders nothing rather than throwing', () => {
  assert.equal(buildRadialMarkup(), '');
  assert.equal(buildRadialMarkup({ rings: [] }), '');
  assert.equal(buildRadialMarkup({ rings: [{ items: [] }] }), '');
});
