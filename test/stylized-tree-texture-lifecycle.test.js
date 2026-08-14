import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedTreeView } from '../src/editor/stylized/StylizedTreeView.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function texture() {
  return {
    disposeCount: 0,
    dispose() {
      this.disposeCount += 1;
    },
  };
}

function createView(loader) {
  const view = Object.create(StylizedTreeView.prototype);
  view.disposed = false;
  view.textures = [];
  view.textureLoader = loader;
  view.resolveUrl = (path) => path;
  view.config = {
    assets: {
      barkColor: 'color',
      barkAo: 'ao',
      barkHeight: 'height',
      foliageCard: 'foliage',
    },
    trees: {
      enabled: true,
      cardsPerLobe: 1,
    },
  };
  return view;
}

test('bark textures that finish after disposal are released instead of retained', async () => {
  const pending = new Map([
    ['color', deferred()],
    ['ao', deferred()],
    ['height', deferred()],
  ]);
  const view = createView({ loadAsync: (path) => pending.get(path).promise });
  const loaded = view.loadBarkTextures();
  const textures = [texture(), texture(), texture()];

  view.disposed = true;
  pending.get('color').resolve(textures[0]);
  pending.get('ao').resolve(textures[1]);
  pending.get('height').resolve(textures[2]);

  assert.equal(await loaded, null);
  assert.deepEqual(textures.map((value) => value.disposeCount), [1, 1, 1]);
  assert.equal(view.textures.length, 0);
});

test('partial bark load failure releases every texture that did load', async () => {
  const pending = new Map([
    ['color', deferred()],
    ['ao', deferred()],
    ['height', deferred()],
  ]);
  const view = createView({ loadAsync: (path) => pending.get(path).promise });
  const loaded = view.loadBarkTextures();
  const color = texture();
  const height = texture();

  pending.get('color').resolve(color);
  pending.get('ao').reject(new Error('AO failed'));
  pending.get('height').resolve(height);

  await assert.rejects(loaded, /AO failed/);
  assert.equal(color.disposeCount, 1);
  assert.equal(height.disposeCount, 1);
  assert.equal(view.textures.length, 0);
});

test('foliage card that finishes after disposal is released', async () => {
  const pending = deferred();
  const view = createView({ loadAsync: () => pending.promise });
  const loaded = view.loadFoliageCard();
  const card = texture();

  view.disposed = true;
  pending.resolve(card);

  assert.equal(await loaded, null);
  assert.equal(card.disposeCount, 1);
  assert.equal(view.textures.length, 0);
});

test('tree source load failure releases textures loaded by the sibling task', async () => {
  const view = createView({ loadAsync: async () => null });
  const bark = texture();
  view.loadBarkTextures = async () => {
    view.textures.push(bark);
    return { color: bark, ao: bark, height: bark };
  };
  view.loadFoliageCard = async () => {
    throw new Error('Foliage failed');
  };

  await assert.rejects(view.buildFromScene({}, []), /Foliage failed/);
  assert.equal(bark.disposeCount, 1);
  assert.equal(view.textures.length, 0);
});
