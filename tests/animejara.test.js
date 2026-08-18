const test = require('node:test');
const assert = require('node:assert/strict');
const animejara = require('../scrapers/animejara');
const { langLabel, scoreMatch } = animejara;

test('langLabel maps the known languages', () => {
  assert.equal(langLabel('CASTELLANO'), 'Castellano');
  assert.equal(langLabel('JAPONES'), 'Japonés sub');
  assert.equal(langLabel('LATINO'), 'Latino');
});

test('scoreMatch prefers exact matches over loose word overlap', () => {
  assert.equal(scoreMatch('Super no Ura de Yani Suu Futari', 'Super no Ura de Yani Suu Futari'), 100);
  assert.ok(scoreMatch('Super no Ura de Yani Suu Futari', 'Super no Ura de Yani Suu Futari') >
    scoreMatch('Super no Ura de Yani Suu Futari', 'Iketeru Futari'));
});