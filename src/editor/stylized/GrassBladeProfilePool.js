import { resolveAssetUrl } from '../assets/assetUrl.js';
import {
  describeProfileSets,
  resolveProfileSet,
} from './grassBladeProfiles.js';

/**
 * The blade silhouettes the whole grass field is currently wearing.
 *
 * One pool serves all 49 grass slots. Slots read it through a provider and compare
 * `revision`, so switching sets is a single assignment here plus each slot noticing
 * on its next update — no walk over the slots, and no second rebuild path beside
 * the allocate-on-demand one they already have.
 *
 * The manifest is a build artifact of `scripts/extract-grass-blade-profiles.mjs`.
 * A missing or stale one is not fatal: every set falls back to the generated taper,
 * which is a duller field but a field.
 */
export class GrassBladeProfilePool {
  constructor({ config, nearSegments, farSegments }) {
    this.config = config;
    this.nearSegments = nearSegments;
    this.farSegments = farSegments;
    this.manifest = null;
    this.manifestError = null;
    this.setId = config.bladeProfiles?.set ?? 'generated';
    this.revision = 0;
    this.near = null;
    this.far = null;
    this.resolve();
  }

  get sets() {
    return this.config.bladeProfiles?.sets ?? {};
  }

  async load(baseUrl = '') {
    const url = this.config.bladeProfiles?.manifest;
    if (!url) return;
    try {
      const response = await fetch(resolveAssetUrl(baseUrl, url));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest?.profiles)) throw new Error('manifest has no profiles array');
      this.manifest = manifest;
      this.manifestError = null;
    } catch (error) {
      this.manifestError = error;
      console.warn(
        `Grass blade profiles could not be loaded from ${url}; falling back to the generated taper. `
        + 'Run `npm run extract:grass-profiles` to bake them.',
        error,
      );
    }
    this.resolve();
  }

  resolve() {
    const shared = { manifest: this.manifest, sets: this.sets, setId: this.setId };
    this.near = resolveProfileSet({ ...shared, segments: this.nearSegments });
    this.far = resolveProfileSet({ ...shared, segments: this.farSegments });
    this.revision += 1;
  }

  /** Returns false when the set is already active, so a repeated UI selection does
   *  not cost every resident chunk a geometry rebuild. */
  select(setId) {
    if (setId === this.setId) return false;
    if (!this.sets[setId]) return false;
    this.setId = setId;
    this.resolve();
    return true;
  }

  /** What a Settings control needs to render itself and report what it switched to. */
  describe() {
    return {
      setId: this.setId,
      manifestLoaded: Boolean(this.manifest),
      manifestError: this.manifestError ? String(this.manifestError.message ?? this.manifestError) : null,
      activeProfiles: this.near?.map((profile) => profile.id) ?? [],
      sets: describeProfileSets({ manifest: this.manifest, sets: this.sets }),
    };
  }
}
