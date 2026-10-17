// NOTA: los HTML/JSON de estos tests son fixtures SINTÉTICOS, modelados sobre los
// selectores y la estructura que el código ya esperaba (.anime__item, data.data.animes).
// No son capturas reales de JKanime/AnimeJara: sirven para probar la lógica de
// búsqueda, validación y manejo de errores sin depender de las webs externas.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('../utils/http');
const idMapper = require('../utils/idMapper');
const { createStore, createCached } = require('../utils/cache');
const jkanime = require('../scrapers/jkanime');
const animejara = require('../scrapers/animejara');
const streams = require('../handlers/streams');

const item = (slug, title, kind = 'Serie') =>
  `<div class="anime__item"><a href="https://jkanime.net/${slug}/"><div class="anime__item__pic"></div></a>` +
  `<div class="anime__item__text"><ul><li class="anime">${kind}</li></ul><h5><a href="https://jkanime.net/${slug}/">${title}</a></h5></div></div>`;
const page = (body, title = 'Buscar') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
const res = (status, data, headers = {}) => ({ status, data, headers });

// ---------- JKanime ----------

test('JKanime: encuentra Noragami y lo valida (caso del bug)', async (t) => {
  t.mock.method(http, 'get', async () => res(200, page(item('noragami', 'Noragami') + item('noragami-aragoto', 'Noragami Aragoto'))));
  const results = await jkanime.searchAnime('Noragami');
  assert.ok(results.some((r) => r.slug === 'noragami'));
  assert.equal(jkanime.pickBestAnime('Noragami', results, 1).slug, 'noragami');
});

test('JKanime: tolera mayúsculas, espacios y puntuación en el título', async (t) => {
  const results = [{ slug: 'noragami', title: 'Noragami' }];
  assert.equal(jkanime.pickBestAnime('NORAGAMI', results, 1).slug, 'noragami');
  assert.equal(jkanime.pickBestAnime('  noragami!! ', results, 1).slug, 'noragami');
  assert.equal(jkanime.slugifyTitle('Noragami: Aragoto'), 'noragami-aragoto');
});

test('JKanime: acepta enlaces relativos en los resultados', async (t) => {
  t.mock.method(http, 'get', async () =>
    res(200, page('<div class="anime__item"><a href="/noragami-rel/"></a><h5><a href="/noragami-rel/">Noragami Rel</a></h5></div>')));
  const results = await jkanime.searchAnime('Noragami Rel');
  assert.equal(results[0].slug, 'noragami-rel');
});

test('JKanime: búsqueda sin coincidencias devuelve [] y pickBestAnime null', async (t) => {
  t.mock.method(http, 'get', async () => res(200, page('<p>Sin resultados</p>')));
  const results = await jkanime.searchAnime('zzzxqv inexistente');
  assert.deepEqual(results, []);
  assert.equal(jkanime.pickBestAnime('zzzxqv inexistente', results, 1), null);
});

test('JKanime: un HTTP de error se propaga como fallo, no como "sin coincidencias"', async (t) => {
  t.mock.method(http, 'get', async () => res(503, 'Service Unavailable'));
  await assert.rejects(() => jkanime.searchAnime('Fallo Http Uno'), /HTTP 503/);
});

test('JKanime: una página anti-bot con HTTP 200 se detecta', async (t) => {
  t.mock.method(http, 'get', async () => res(200, page('<div id="cf-chl-widget"></div>', 'Just a moment...')));
  await assert.rejects(() => jkanime.searchAnime('Antibot Uno'), /anti-bot/);
});

test('JKanime: HTML con estructura inesperada usa el respaldo por enlaces, validado por título', async (t) => {
  t.mock.method(http, 'get', async () =>
    res(200, page('<ul><li><a href="https://jkanime.net/horario/">Horario</a></li><li><a href="https://jkanime.net/noragami-nuevo/">Noragami Nuevo</a></li></ul>')));
  const results = await jkanime.searchAnime('Noragami Nuevo');
  assert.deepEqual(results.map((r) => r.slug), ['noragami-nuevo']);
  assert.equal(jkanime.pickBestAnime('Noragami Nuevo', results, 1).slug, 'noragami-nuevo');
  // un enlace de navegación no debe validarse como coincidencia
  assert.equal(jkanime.pickBestAnime('Noragami', [{ slug: 'x', title: 'Horario' }], 1), null);
});

test('JKanime: un fallo no se cachea, el siguiente intento se recupera', async (t) => {
  let down = true;
  t.mock.method(http, 'get', async () => (down ? res(500, 'err') : res(200, page(item('recupera', 'Recupera Test')))));
  await assert.rejects(() => jkanime.searchAnime('Recupera Test'), /HTTP 500/);
  down = false;
  const results = await jkanime.searchAnime('Recupera Test');
  assert.equal(results[0].slug, 'recupera');
});

test('cache: ttlFor permite que los vacíos caduquen antes', async () => {
  const cached = createCached(createStore(10));
  let calls = 0;
  const fn = async () => { calls++; return []; };
  const opts = { ttlFor: (v) => (v.length ? 1000 : 10) };
  await cached('k', 1000, fn, opts);
  await cached('k', 1000, fn, opts);
  assert.equal(calls, 1);
  await new Promise((r) => setTimeout(r, 25));
  await cached('k', 1000, fn, opts);
  assert.equal(calls, 2);
});

// ---------- AnimeJara ----------

const ajOk = (animes) => res(200, { success: true, data: { animes } });

test('AnimeJara: encuentra Noragami y descarta lo que no es serie', async (t) => {
  t.mock.method(http, 'post', async () =>
    ajOk([
      { slug: 'noragami-tv', titulo: 'Noragami', tipo: 'Serie', anio: 2014, rating: 8 },
      { slug: 'noragami-movie', titulo: 'Noragami Movie', tipo: 'Pelicula' },
    ]));
  const results = await animejara.searchAnime('Noragami');
  assert.deepEqual(results.map((r) => r.slug), ['noragami-tv']);
  assert.equal((await animejara.pickBestAnime('Noragami', results, 1)).slug, 'noragami-tv');
});

test('AnimeJara: tolera diferencias de mayúsculas y puntuación', () => {
  assert.equal(animejara.scoreMatch('NORAGAMI!!', 'noragami'), 100);
  assert.equal(animejara.scoreMatch('  Noragami ', 'Noragami'), 100);
});

test('AnimeJara: búsqueda sin coincidencias devuelve [] y pickBestAnime null', async (t) => {
  t.mock.method(http, 'post', async () => ajOk([]));
  const results = await animejara.searchAnime('zzzxqv inexistente aj');
  assert.deepEqual(results, []);
  assert.equal(await animejara.pickBestAnime('zzzxqv inexistente aj', results, 1), null);
});

test('AnimeJara: HTTP de error se propaga como fallo', async (t) => {
  t.mock.method(http, 'post', async () => res(403, 'Forbidden'));
  await assert.rejects(() => animejara.searchAnime('Error Http Aj'), /HTTP 403/);
});

test('AnimeJara: respuesta que no es JSON (HTML) da un error descriptivo', async (t) => {
  t.mock.method(http, 'post', async () => res(200, page('<p>0</p>', 'Inicio')));
  await assert.rejects(() => animejara.searchAnime('Html Aj'), /no devolvió JSON/);
});

test('AnimeJara: success=false y estructura JSON inesperada dan errores descriptivos', async (t) => {
  const post = t.mock.method(http, 'post', async () => res(200, { success: false, data: 'x' }));
  await assert.rejects(() => animejara.searchAnime('Sf Aj'), /success=false/);
  post.mock.mockImplementation(async () => res(200, { success: true, data: { results: [] } }));
  await assert.rejects(() => animejara.searchAnime('Estructura Aj'), /estructura inesperada: data=\[results\]/);
});

// ---------- Handler: aislamiento entre fuentes y mensajes ----------

test('findAnimeOnJkanime distingue fallo de petición, 0 resultados y sin coincidencia válida', async (t) => {
  const s = t.mock.method(jkanime, 'searchAnime', async () => { throw new Error('HTTP 503'); });
  await assert.rejects(() => streams.findAnimeOnJkanime(['Noragami'], 1), /Búsqueda fallida en JKanime.*HTTP 503/);
  s.mock.mockImplementation(async () => []);
  await assert.rejects(() => streams.findAnimeOnJkanime(['Noragami'], 1), /No hubo coincidencia en JKanime.*0 resultados/);
  s.mock.mockImplementation(async () => [{ slug: 'otra', title: 'Otra Serie' }]);
  await assert.rejects(() => streams.findAnimeOnJkanime(['Noragami'], 1), /sin coincidencia válida \[Otra Serie\]/);
});

test('handler: si JKanime falla, AnimeJara sigue devolviendo streams', async (t) => {
  t.mock.method(idMapper, 'imdbToRomajiTitles', async () => ['Noragami']);
  t.mock.method(jkanime, 'searchAnime', async () => { throw new Error('HTTP 503'); });
  t.mock.method(animejara, 'searchAnime', async () => [{ slug: 'noragami-tv', title: 'Noragami', score: 100 }]);
  t.mock.method(animejara, 'getAnimeInfo', async () => ({ seasons: [{ numero_temporada: 1, episodios: [{ numero_episodio: 1 }] }] }));
  t.mock.method(animejara, 'getEpisodePage', async () => '<html></html>');
  t.mock.method(animejara, 'extractEmbeds', () => ({ CASTELLANO: 'https://embed.test/x' }));
  t.mock.method(animejara, 'getEmbedServers', async () => [{ server: 'uqload', url: 'https://uq.test/v' }]);
  t.mock.method(animejara, 'resolveServer', async () => ({ url: 'https://cdn.test/v.m3u8', server: 'uqload' }));
  const out = await streams.defineStreamHandler({ id: 'tt3225270:1:1', type: 'series' });
  assert.equal(out.streams.length, 1);
  assert.equal(out.streams[0].name, 'AnimeJara');
});

test('handler: si ambas fuentes fallan devuelve { streams: [] } sin lanzar', async (t) => {
  t.mock.method(idMapper, 'imdbToRomajiTitles', async () => ['Noragami']);
  t.mock.method(jkanime, 'searchAnime', async () => { throw new Error('HTTP 503'); });
  t.mock.method(animejara, 'searchAnime', async () => { throw new Error('HTTP 403'); });
  const out = await streams.defineStreamHandler({ id: 'tt3225270:1:1', type: 'series' });
  assert.deepEqual(out, { streams: [] });
});
