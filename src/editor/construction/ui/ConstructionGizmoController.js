import { GizmoCluster } from '../../ui/GizmoCluster.js';
import { IconGridMenu } from '../../ui/IconGridMenu.js';
import { icon } from '../../ui/icons.js';
import { FEATURE_KINDS, OPENING_PROFILES } from '../ConstructionSchema.js';

/**
 * The on-selection action cluster and the opening-variant grid behind it.
 *
 * Complements the right-click `ConstructionPaletteController` rather than
 * repeating it: the radial palette answers "what does this wall look like"
 * — colour, bond, top — and this answers "what do I do to it".
 *
 * The split is a shape argument. Look is a small set of exclusive choices, which
 * a radial menu aims at well. Openings are six kinds crossed with four profiles,
 * which will not fit on a ring and which the user wants to compare side by side.
 *
 * Owns menu state only. What the next cut carves lives on the editor controller,
 * because the Alt-drag gesture reads it too and two copies would disagree the
 * first time someone used the modifier instead of the menu.
 */

/**
 * Openings a cut can produce. `tower` and `breach` are in `FEATURE_KINDS` but
 * are authored on a record rather than drawn, so they are not offered here.
 */
const CUTTABLE_KINDS = Object.freeze(['door', 'window', 'arch', 'gate']);

const KIND_LABELS = Object.freeze({
  door: 'Door',
  window: 'Window',
  arch: 'Archway',
  gate: 'Gate',
});

const PROFILE_LABELS = Object.freeze({
  round: 'Round arch',
  segmental: 'Segmental arch',
  pointed: 'Pointed arch',
  flat: 'Flat lintel',
});

export class ConstructionGizmoController {
  constructor({ host, controller, palette = null, onStatus = null }) {
    this.controller = controller;
    this.palette = palette;
    this.onStatus = onStatus;
    this.constructionId = null;
    this.anchor = { clientX: 0, clientY: 0 };

    this.cluster = new GizmoCluster({
      host,
      modifier: 'icon-gizmo--construction',
      onAction: (action) => this.action(action),
    });
    this.grid = new IconGridMenu({
      host,
      modifier: 'icon-grid--construction',
      onSelect: (id) => this.select(id),
    });
  }

  get isOpen() {
    return this.cluster.isOpen;
  }

  get isGridOpen() {
    return this.grid.isOpen;
  }

  /** What the next cut carves. The controller is the single owner. */
  get opening() {
    return this.controller.constructionOpening ?? { kind: null, profile: 'round', dressed: true };
  }

  /** Actions on the selection itself, arranged as in the reference layout. */
  clusterActions() {
    return [
      {
        id: 'openings',
        label: 'Openings',
        slot: 'right',
        icon: icon('link'),
        active: this.grid.isOpen,
      },
      { id: 'cut', label: 'Cut an opening', slot: 'top', icon: icon('cut') },
      { id: 'properties', label: 'Wall properties', slot: 'bottom', icon: icon('settings') },
      { id: 'delete', label: 'Delete wall', slot: 'left', icon: icon('trash') },
    ];
  }

  /**
   * Three rows: kind, arch profile, and whether the opening is dressed.
   *
   * Built by filtering the schema's own sets rather than listing kinds again, so
   * a kind added to `FEATURE_KINDS` cannot quietly miss the menu — and one
   * removed from it cannot linger here as a tile that fails validation on click.
   */
  openingGroups() {
    const { kind, profile, dressed } = this.opening;
    const kinds = CUTTABLE_KINDS.filter((name) => FEATURE_KINDS.has(name));
    const profiles = [...OPENING_PROFILES];
    return [
      {
        id: 'kinds',
        label: 'Opening kind',
        columns: kinds.length,
        items: kinds.map((name) => ({
          id: `kind:${name}`,
          label: KIND_LABELS[name] ?? name,
          icon: icon(name),
          active: kind === name,
        })),
      },
      {
        id: 'profiles',
        label: 'Arch profile',
        columns: profiles.length,
        items: profiles.map((name) => ({
          id: `profile:${name}`,
          label: PROFILE_LABELS[name] ?? name,
          icon: icon(`profile-${name}`),
          active: profile === name,
        })),
      },
      {
        id: 'dressing',
        label: 'Surround',
        columns: 2,
        items: [
          { id: 'dressed:1', label: 'Dressed surround', icon: icon('dressed'), active: dressed },
          { id: 'dressed:0', label: 'Plain opening', icon: icon('plain'), active: !dressed },
        ],
      },
    ];
  }

  open(constructionId, { clientX, clientY }) {
    this.constructionId = constructionId;
    this.anchor = { clientX, clientY };
    this.cluster.open({ clientX, clientY, actions: this.clusterActions() });
  }

  close() {
    this.closeGrid();
    this.cluster.close({ notify: false });
    this.constructionId = null;
  }

  closeGrid() {
    this.grid.close({ notify: false });
  }

  /** Re-render both menus in place, so a pick shows as selected immediately. */
  refresh() {
    if (this.grid.isOpen) {
      this.grid.open({ ...this.anchor, groups: this.openingGroups(), focus: false });
    }
    if (this.cluster.isOpen) {
      this.cluster.open({ ...this.anchor, actions: this.clusterActions() });
    }
  }

  action(action) {
    if (!this.constructionId) return;
    if (action === 'openings') {
      // Toggle, so the button that opened the grid also puts it away.
      if (this.grid.isOpen) this.closeGrid();
      else this.grid.open({ ...this.anchor, groups: this.openingGroups() });
      this.cluster.open({ ...this.anchor, actions: this.clusterActions() });
      return;
    }
    if (action === 'cut') {
      this.controller.armConstructionCut(true);
      this.onStatus?.('Drag across the wall to carve an opening.');
      this.close();
      return;
    }
    if (action === 'properties') {
      const id = this.constructionId;
      this.close();
      this.palette?.openInspector(id);
      return;
    }
    if (action === 'delete') {
      this.controller.setSelectedConstruction(this.constructionId);
      this.close();
      this.controller.deleteSelectedConstruction();
      this.onStatus?.('Wall deleted.');
    }
  }

  select(id) {
    const [field, value] = id.split(':');
    if (field === 'kind') {
      // Re-picking the active kind clears it, which hands the choice back to the
      // stroke geometry — the behaviour before any kind was ever selected.
      const next = this.opening.kind === value ? null : value;
      this.controller.setConstructionOpening({ kind: next });
      this.onStatus?.(next
        ? `Next cut carves a ${(KIND_LABELS[next] ?? next).toLowerCase()}.`
        : 'Next cut follows the stroke.');
    }
    if (field === 'profile') {
      this.controller.setConstructionOpening({ profile: value });
      this.onStatus?.(`Next opening: ${PROFILE_LABELS[value] ?? value}.`);
    }
    if (field === 'dressed') {
      this.controller.setConstructionOpening({ dressed: value === '1' });
      this.onStatus?.(value === '1' ? 'Openings get a stone surround.' : 'Openings left plain.');
    }
    // The grid stays up: choosing a kind and then a profile is one gesture.
    this.refresh();
  }

  dispose() {
    this.cluster.dispose();
    this.grid.dispose();
  }
}
