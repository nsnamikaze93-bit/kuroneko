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

// options.ttlFor(value) permite usar un TTL distinto al guardar (p. ej. más corto
// para resultados vacíos, de modo que una búsqueda vacía no se quede "pegada").
function createCached(store) {
  return function cached(key, ttlMs, fn, options = {}) {
    const hit = store.get(key);
    if (hit && Date.now() - hit.at < (hit.ttl != null ? hit.ttl : ttlMs)) {
      return Promise.resolve(hit.value);
    }
    return Promise.resolve()
      .then(fn)
      .then((value) => {
        const ttl = options.ttlFor ? options.ttlFor(value) : ttlMs;
        store.set(key, { at: Date.now(), value, ttl });
        return value;
      });
  };
}

module.exports = { createStore, createCached };
