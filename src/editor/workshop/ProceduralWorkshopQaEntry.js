import '../../styles.css';
import * as THREE from 'three/webgpu';
import { ProceduralAssetStore } from './ProceduralAssetStore.js';
import { createProceduralWorkshopComponentParts } from './ProceduralWorkshopComponentParts.js';
import { ProceduralWorkshopUi } from './ProceduralWorkshopUi.js';

class WorkshopQaManager {
  constructor() {
    this.store = new ProceduralAssetStore();
  }

  createPreviewParts(recipe) {
    return createProceduralWorkshopComponentParts(recipe, { preserveComponents: true });
  }

  create(input) {
    return this.store.add(input);
  }
}

const root = document.querySelector('#app');
const proceduralWorkshop = new ProceduralWorkshopUi({
  root,
  manager: new WorkshopQaManager(),
  onBaked: () => {},
});

root.querySelector('[data-tool="workshop"]').addEventListener('click', () => {
  proceduralWorkshop.open();
});

window.__THREE_QA__ = THREE;
window.__editor = { proceduralWorkshop };
