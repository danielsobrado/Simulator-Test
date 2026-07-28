/**
 * Escaping shared by the string-building menu components.
 *
 * `RadialPalette`, `IconGridMenu` and `GizmoCluster` all assemble markup as
 * strings so their layout stays unit-testable in Node, which has no DOM. Three
 * private copies of the same escape is exactly the drift `RadialPalette` was
 * extracted to prevent, so it lives here once.
 *
 * The rule these components share: **ids and labels are escaped, icon markup is
 * not.** Icon markup has to be inserted raw or no SVG could reach the page at
 * all, so it must only ever come from the `ICONS` constant in `icons.js` —
 * never from a world document, a preset or anything else a user can author.
 */

export function escapeAttribute(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}
