import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalFirstWorldContentProvider,
  UrlWorldContentProvider,
} from '../src/editor/world/WorldContentProvider.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('local-first provider rejects malformed remote providers', () => {
  assert.throws(
    () => new LocalFirstWorldContentProvider({
      local: { async getChunk() { return null; } },
      remote: {},
    }),
    /remote provider must support getChunk/,
  );
});

test('local-first provider disposal is idempotent and blocks new work', async () => {
  let localDisposals = 0;
  let remoteDisposals = 0;
  let localReads = 0;
  let localWrites = 0;
  const provider = new LocalFirstWorldContentProvider({
    local: {
      async getChunk() { localReads += 1; return null; },
      async putChunk() { localWrites += 1; },
      dispose() { localDisposals += 1; },
    },
    remote: {
      async getChunk() { return null; },
      dispose() { remoteDisposals += 1; },
    },
  });

  provider.dispose();
  provider.dispose();

  await assert.rejects(provider.getChunk('world', 0, 0), /provider is disposed/);
  await assert.rejects(provider.putChunk('world', 0, 0, {}), /provider is disposed/);
  assert.equal(localReads, 0);
  assert.equal(localWrites, 0);
  assert.equal(localDisposals, 1);
  assert.equal(remoteDisposals, 1);
});

test('local-first provider disposes remote resources when local disposal fails', () => {
  const localError = new Error('local cleanup failed');
  let remoteDisposals = 0;
  const provider = new LocalFirstWorldContentProvider({
    local: {
      async getChunk() { return null; },
      dispose() { throw localError; },
    },
    remote: {
      async getChunk() { return null; },
      dispose() { remoteDisposals += 1; },
    },
  });

  assert.throws(() => provider.dispose(), (error) => error === localError);
  assert.equal(remoteDisposals, 1);
  assert.equal(provider.disposed, true);
});

test('local-first provider reports multiple disposal failures together', () => {
  const localError = new Error('local cleanup failed');
  const remoteError = new Error('remote cleanup failed');
  const provider = new LocalFirstWorldContentProvider({
    local: {
      async getChunk() { return null; },
      dispose() { throw localError; },
    },
    remote: {
      async getChunk() { return null; },
      dispose() { throw remoteError; },
    },
  });

  assert.throws(
    () => provider.dispose(),
    (error) => error instanceof AggregateError
      && error.errors[0] === localError
      && error.errors[1] === remoteError,
  );
  assert.equal(provider.disposed, true);
});

test('local-first provider does not cache a remote result after disposal', async () => {
  const remoteResult = deferred();
  const remoteStarted = deferred();
  let localWrites = 0;
  const provider = new LocalFirstWorldContentProvider({
    local: {
      async getChunk() { return null; },
      async putChunk() { localWrites += 1; },
      dispose() {},
    },
    remote: {
      getChunk() {
        remoteStarted.resolve();
        return remoteResult.promise;
      },
      dispose() {},
    },
  });

  const request = provider.getChunk('world', 4, 5);
  await remoteStarted.promise;
  provider.dispose();
  remoteResult.resolve({ encounter: 'ruins' });

  await assert.rejects(request, /provider is disposed/);
  assert.equal(localWrites, 0);
});

test('URL provider rejects a late fetch result after disposal even if abort is ignored', async () => {
  const fetchResult = deferred();
  const fetchStarted = deferred();
  const provider = new UrlWorldContentProvider({
    baseUrl: 'https://content.example',
    fetchImpl() {
      fetchStarted.resolve();
      return fetchResult.promise;
    },
  });

  const request = provider.getChunk('world', 1, 2);
  await fetchStarted.promise;
  provider.dispose();
  fetchResult.resolve({
    status: 200,
    ok: true,
    async json() { return { value: 1 }; },
  });

  await assert.rejects(request, /URL provider is disposed/);
});
