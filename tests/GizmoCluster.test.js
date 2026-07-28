import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GIZMO_SLOTS,
  buildGizmoClusterMarkup,
  resolveGizmoSlot,
} from '../src/editor/ui/GizmoCluster.js';

function actions(markup) {
  return [...markup.matchAll(/data-gizmo-action="([^"]*)"[^>]*data-gizmo-slot="([^"]*)"/g)]
    .map(([, id, slot]) => ({ id, slot }));
}

test('each action renders in the slot it asked for', () => {
  const markup = buildGizmoClusterMarkup({
    actions: [
      { id: 'cut', label: 'Cut', slot: 'top' },
      { id: 'settings', label: 'Properties', slot: 'bottom' },
      { id: 'trash', label: 'Delete', slot: 'left' },
      { id: 'link', label: 'Openings', slot: 'right' },
    ],
  });
  assert.deepEqual(actions(markup), [
    { id: 'cut', slot: 'top' },
    { id: 'settings', slot: 'bottom' },
    { id: 'trash', slot: 'left' },
    { id: 'link', slot: 'right' },
  ]);
});

test('a slot emits its class so placement stays in the stylesheet', () => {
  // The markup names the slot and nothing else; the offsets that turn
  // `--top-left` into a position live in compactMenus.css, so rearranging the
  // cluster is a CSS change.
  for (const slot of GIZMO_SLOTS) {
    const markup = buildGizmoClusterMarkup({ actions: [{ id: 'a', label: 'A', slot }] });
    assert.ok(
      markup.includes(`icon-gizmo__button--${slot}`),
      `${slot} must emit its modifier class`,
    );
  }
  assert.ok(!/\d+px/.test(buildGizmoClusterMarkup({
    actions: [{ id: 'a', label: 'A', slot: 'top' }],
  })), 'the markup must not hardcode offsets');
});

test('an unrecognised slot stacks in the centre rather than throwing', () => {
  assert.equal(resolveGizmoSlot('top'), 'top');
  assert.equal(resolveGizmoSlot('nowhere'), 'center');
  assert.equal(resolveGizmoSlot(undefined), 'center');
  const markup = buildGizmoClusterMarkup({
    actions: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', slot: 'diagonal-ish' }],
  });
  assert.deepEqual(actions(markup).map(({ slot }) => slot), ['center', 'center']);
});

test('every button is labelled', () => {
  const markup = buildGizmoClusterMarkup({
    actions: [{ id: 'cut', label: 'Cut an opening', slot: 'top' }],
  });
  assert.ok(markup.includes('aria-label="Cut an opening"'));
  assert.ok(markup.includes('title="Cut an opening"'));
});

test('pressed state is announced only where the caller models one', () => {
  const toggled = buildGizmoClusterMarkup({
    actions: [{ id: 'move', label: 'Move', slot: 'center', active: true }],
  });
  assert.ok(toggled.includes('aria-pressed="true"'));
  assert.ok(toggled.includes('is-active'));

  const plain = buildGizmoClusterMarkup({ actions: [{ id: 'cut', label: 'Cut', slot: 'top' }] });
  assert.ok(!plain.includes('aria-pressed'));
});

test('labels and ids are escaped rather than injected', () => {
  const markup = buildGizmoClusterMarkup({
    actions: [{ id: 'a"><script>x()</script>', label: 'Bad "quote" & <tag>', slot: 'top' }],
  });
  assert.ok(!markup.includes('<script>'), 'markup must not carry an injected tag');
  assert.ok(markup.includes('&quot;'));
  assert.ok(markup.includes('&amp;'));
  assert.ok(markup.includes('&lt;tag&gt;'));
});

test('an empty cluster renders nothing rather than throwing', () => {
  assert.equal(buildGizmoClusterMarkup(), '');
  assert.equal(buildGizmoClusterMarkup({ actions: [] }), '');
});
