/** Track hierarchy edits once, including lights inserted below an existing group. */
export class ReflectionShadowRegistry {
  constructor(scene) {
    this.objects = new Set();
    this.owners = new Set();
    this.added = event => this.track(event.child);
    this.removed = event => this.untrack(event.child);
    this.track(scene);
  }

  track(root) {
    root.traverse(object => {
      if (this.objects.has(object)) return;
      this.objects.add(object);
      // A light may replace its shadow object without changing its hierarchy.
      if (object.isLight || object.shadow) this.owners.add(object);
      object.addEventListener('childadded', this.added);
      object.addEventListener('childremoved', this.removed);
    });
  }

  untrack(root) {
    root.traverse(object => {
      this.objects.delete(object);
      this.owners.delete(object);
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
    });
  }

  dispose() {
    for (const object of this.objects) {
      object.removeEventListener('childadded', this.added);
      object.removeEventListener('childremoved', this.removed);
    }
    this.objects.clear(); this.owners.clear();
  }
}
