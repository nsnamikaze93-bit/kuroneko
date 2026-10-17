const test = require('node:test');
const assert = require('node:assert/strict');
const { viaProxy } = require('../utils/http');

const env = { PROXY_URL: 'https://p.example.workers.dev/', PROXY_KEY: 'secreto' };

test('viaProxy: sin PROXY_URL va directo y sin cambios', () => {
  const r = viaProxy('https://jkanime.net/buscar/x/', { A: '1' }, {});
  assert.equal(r.url, 'https://jkanime.net/buscar/x/');
  assert.deepEqual(r.headers, { A: '1' });
});

test('viaProxy: enruta JKanime y AnimeJara por el Worker con la clave', () => {
  const r = viaProxy('https://jkanime.net/buscar/noragami/', { A: '1' }, env);
  assert.equal(r.url, 'https://p.example.workers.dev/?url=https%3A%2F%2Fjkanime.net%2Fbuscar%2Fnoragami%2F');
  assert.equal(r.headers['x-proxy-key'], 'secreto');
  assert.equal(r.headers.A, '1');
  assert.ok(viaProxy('https://animejara.com/wp-admin/admin-ajax.php', {}, env).url.startsWith('https://p.example.workers.dev/?url='));
});

test('viaProxy: otros hosts (Kitsu, Cinemeta, reproductores) no pasan por el proxy ni reciben la clave', () => {
  for (const u of ['https://kitsu.io/api/edge/anime/1', 'https://v3-cinemeta.strem.io/meta/series/tt1.json', 'https://uqload.com/x']) {
    const r = viaProxy(u, { A: '1' }, env);
    assert.equal(r.url, u);
    assert.equal(r.headers['x-proxy-key'], undefined);
  }
});
