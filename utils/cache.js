function createStore(maxEntries = 400) {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set: (key, value) => {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
    },
    clear: () => map.clear(),
    size: () => map.size,
  };
}

function createCached(store) {
  return function cached(key, ttlMs, fn) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
    return Promise.resolve()
      .then(fn)
      .then((value) => {
        store.set(key, { at: Date.now(), value });
        return value;
      });
  };
}

module.exports = { createStore, createCached };