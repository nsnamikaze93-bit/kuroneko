const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, createCached } = require('../utils/cache');

test('createStore evicts the oldest entry when over the limit', () => {
  const store = createStore(3);
  store.set('a', 1);
  store.set('b', 2);
  store.set('c', 3);
  store.set('d', 4);
  assert.equal(store.size(), 3);
  assert.equal(store.get('a'), undefined);
  assert.equal(store.get('b'), 2);
  assert.equal(store.get('d'), 4);
});

test('createStore re-inserts refresh the LRU position', () => {
  const store = createStore(2);
  store.set('a', 1);
  store.set('b', 2);
  store.get('a');
  store.set('a', 10);
  store.set('c', 3);
  assert.equal(store.get('a'), 10);
  assert.equal(store.get('b'), undefined);
});

test('cached returns the value without calling fn again while fresh', async () => {
  const cached = createCached(createStore(10));
  let calls = 0;
  const fn = async () => ++calls;
  const v1 = await cached('k', 1000, fn);
  const v2 = await cached('k', 1000, fn);
  assert.equal(v1, 1);
  assert.equal(v2, 1);
  assert.equal(calls, 1);
});

test('cached expires after the TTL', async () => {
  const cached = createCached(createStore(10));
  let calls = 0;
  const fn = async () => ++calls;
  await cached('k', 30, fn);
  await new Promise((r) => setTimeout(r, 60));
  await cached('k', 30, fn);
  assert.equal(calls, 2);
});

test('cached does not store rejected promises', async () => {
  const cached = createCached(createStore(10));
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls === 1) throw new Error('boom');
    return 'ok';
  };
  await assert.rejects(() => cached('k', 1000, fn), /boom/);
  const v = await cached('k', 1000, fn);
  assert.equal(v, 'ok');
  assert.equal(calls, 2);
});