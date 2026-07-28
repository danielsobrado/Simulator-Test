import { RadialPalette } from '../../ui/RadialPalette.js';
import {
  BUILTIN_WORKSHOP_MATERIAL_PRESETS,
  getWorkshopMaterialPreset,
} from '../../workshop/ProceduralWorkshopMaterialConfig.js';
import { CONSTRUCTION_STYLES } from '../masonry/ConstructionStyleCatalog.js';
import { ConstructionInspector } from './ConstructionInspector.js';

/**
 * The right-click palette for live constructions.
 *
 * Two rings, which is why the shared `RadialPalette` takes `rings` rather than
 * a flat list: materials on the outside, wall-top actions on the inside. The
 * reference game puts "Flat Top" on its colour tool, and grouping it with the
 * materials here is what makes one right-click cover both.
 */

/**
 * Families that make sense on a wall. The built-in masonry and plaster presets
 * are all `walls`; `stone` exists for custom presets authored against the
 * construction stone slot.
 */
const WALL_PRESET_FAMILIES = new Set(['walls', 'stone']);

const TOP_ACTIONS = Object.freeze([
  { id: 'top:flat', label: 'Flat top', color: '#cfd6e4', glyph: '▬' },
  { id: 'top:crenellated', label: 'Crenellate', color: '#b9c6dd', glyph: '⊓' },
  { id: 'top:ruined', label: 'Ruin', color: '#a89684', glyph: '⋰' },
  { id: 'top:irregular', label: 'Irregular top', color: '#c2b9a4', glyph: '∿' },
]);

export class ConstructionPaletteController {
  constructor({ host, controller, materialStore, onStatus = null }) {
    this.controller = controller;
    this.materialStore = materialStore;
    this.onStatus = onStatus;
    this.constructionId = null;
    this.palette = new RadialPalette({
      host,
      modifier: 'radial-palette--construction',
      onSelect: (id) => this.select(id),
      onHover: (id) => this.preview(id),
      onHoverEnd: () => this.clearPreview(),
      onAction: (action) => this.action(action),
    });
    this.inspector = new ConstructionInspector({ host, controller, onStatus });
  }

  get isOpen() {
    return this.palette.isOpen;
  }

  get isInspectorOpen() {
    return this.inspector.isOpen;
  }

  /**
   * The built-ins plus any custom presets in the world's material library.
   *
   * `materialLibrary.presets` holds **only** custom presets — the built-ins are
   * a separate constant that `availablePreset` consults alongside it — so
   * reading the library alone yields an empty palette on a fresh world.
   */
  materialPresets() {
    const custom = this.materialStore?.document?.materialLibrary?.presets ?? {};
    return [...Object.values(BUILTIN_WORKSHOP_MATERIAL_PRESETS), ...Object.values(custom)]
      .filter((preset) => WALL_PRESET_FAMILIES.has(preset.family))
      .slice(0, 8);
  }

  open(constructionId, { clientX, clientY }) {
    this.inspector.close();
    this.constructionId = constructionId;
    this.palette.open({
      clientX,
      clientY,
      rings: [
        {
          radius: 79,
          items: this.materialPresets().map((preset) => ({
            id: `material:${preset.id}`,
            label: preset.label,
            color: preset.baseColor,
          })),
        },
        { radius: 46, items: TOP_ACTIONS },
      ],
      center: { action: 'reset-material', glyph: '↺', label: 'Reset material' },
      footer: { action: 'more', label: 'More…' },
    });
  }

  close() {
    // Clear hover preview before dropping constructionId — otherwise the last
    // petal tint stays on the meshes until another selection refresh.
    this.clearPreview();
    this.palette.close({ notify: false });
    this.constructionId = null;
  }

  closeInspector() {
    this.inspector.close();
  }

  select(id) {
    if (!this.constructionId) return;
    const [kind, value] = id.split(':');
    if (kind === 'material') {
      this.controller.runConstructionCommand({
        type: 'set_material',
        constructionId: this.constructionId,
        materials: { stone: value },
      });
      this.onStatus?.(`Applied ${getWorkshopMaterialPreset(
        this.materialStore?.document,
        value,
      )?.label ?? value}.`);
    }
    if (kind === 'top') {
      this.controller.setConstructionTopStyle(value);
      this.onStatus?.(`Wall top set to ${value}.`);
    }
    this.close();
  }

  /**
   * Hover preview is material-only: previewing a top style would re-pack the
   * masonry on every pointer move, which is exactly what the "preview never
   * waits for masonry" invariant forbids.
   */
  preview(id) {
    if (!this.constructionId || !id.startsWith('material:')) return;
    this.controller.previewConstructionMaterial?.(this.constructionId, id.slice(9));
  }

  clearPreview() {
    this.controller.previewConstructionMaterial?.(this.constructionId, null);
  }

  action(action) {
    if (!this.constructionId) return;
    if (action === 'reset-material') {
      this.controller.runConstructionCommand({
        type: 'set_material',
        constructionId: this.constructionId,
        materials: { stone: null, mortar: null, roof: null },
      });
      this.close();
      return;
    }
    if (action === 'more') {
      const id = this.constructionId;
      this.close();
      this.inspector.open(id);
    }
  }

  styleOptions() {
    return Object.values(CONSTRUCTION_STYLES).map(({ key, label }) => ({ key, label }));
  }

  dispose() {
    this.palette.dispose();
    this.inspector.dispose();
  }
}
