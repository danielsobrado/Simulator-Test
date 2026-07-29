import assert from 'node:assert/strict';
import test from 'node:test';
import { ICON_VIEWBOX, ICONS, hasIcon, icon, iconNames } from '../src/editor/ui/icons.js';

test('every icon renders an svg on the shared grid', () => {
  assert.ok(iconNames().length > 0, 'the set must not be empty');
  for (const name of iconNames()) {
    const markup = icon(name);
    assert.ok(markup.startsWith('<svg'), `${name} must render an svg`);
    assert.ok(markup.endsWith('</svg>'), `${name} must close its svg`);
    assert.ok(
      markup.includes(`viewBox="${ICON_VIEWBOX}"`),
      `${name} must share the icon grid so sizes stay comparable`,
    );
  }
});

test('no icon carries a colour of its own', () => {
  // Icons take their colour from the button via `currentColor`. A hardcoded
  // fill or stroke survives review — it looks right against today's dark glass —
  // and then goes invisible the moment the surrounding theme changes.
  for (const [name, body] of Object.entries(ICONS)) {
    assert.ok(!body.includes('fill="'), `${name} must not set its own fill`);
    assert.ok(!body.includes('stroke="'), `${name} must not set its own stroke`);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(body), `${name} must not carry a hex colour`);
    assert.ok(!/\brgb\(|\bhsl\(/i.test(body), `${name} must not carry a colour function`);
  }
});

test('the root svg supplies the stroke every icon relies on', () => {
  const markup = icon('cut');
  assert.ok(markup.includes('stroke="currentColor"'));
  assert.ok(markup.includes('fill="none"'));
  assert.ok(markup.includes('stroke-width="1.5"'));
});

test('an icon is decorative to assistive tech', () => {
  // The label lives on the button; announcing the glyph too would read every
  // menu item twice.
  const markup = icon('trash');
  assert.ok(markup.includes('aria-hidden="true"'));
  assert.ok(markup.includes('focusable="false"'));
});

test('an unknown icon degrades to nothing rather than to "undefined"', () => {
  assert.equal(icon('no-such-icon'), '');
  assert.equal(icon(), '');
  assert.equal(icon(null), '');
  assert.equal(hasIcon('no-such-icon'), false);
  assert.equal(hasIcon('cut'), true);
});

test('an inherited property name is not an icon', () => {
  // `ICONS` is a plain object, so a bare `ICONS[name]` lookup walks the
  // prototype: `constructor` resolves to a function, which is truthy and used to
  // land its native source in the markup. `hasIcon` and `icon` must agree.
  for (const name of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
    assert.equal(hasIcon(name), false, `${name} must not count as an icon`);
    assert.equal(icon(name), '', `${name} must not render`);
  }
});

test('size and class name are caller-controlled and escaped', () => {
  const sized = icon('door', { size: 24 });
  assert.ok(sized.includes('width="24"'));
  assert.ok(sized.includes('height="24"'));

  const classed = icon('door', { className: 'tile"><script>x()</script>' });
  assert.ok(!classed.includes('<script>'), 'a class name must not inject markup');
  assert.ok(classed.includes('&quot;'));
});

test('the set covers every kind, profile, top and bond the editor validates', () => {
  // These mirror ConstructionSchema's FEATURE_KINDS, OPENING_PROFILES and
  // TOP_STYLES, and ConstructionStyleCatalog's bonds. A menu built from those
  // constants renders a blank tile for anything missing here, so the gap is
  // worth failing on rather than discovering in the viewport.
  const required = [
    'door', 'window', 'arch', 'gate', 'tower', 'breach',
    'profile-round', 'profile-segmental', 'profile-pointed', 'profile-flat',
    'top-flat', 'top-crenellated', 'top-ruined', 'top-irregular',
    'bond-coursed-rubble', 'bond-ashlar', 'bond-random-rubble', 'bond-dry-stone',
    'cut', 'duplicate', 'trash', 'move', 'rotate', 'scale', 'settings', 'link',
    'material', 'reset', 'reset-all', 'center', 'frame', 'close',
  ];
  for (const name of required) {
    assert.ok(hasIcon(name), `the icon set is missing ${name}`);
  }
});
