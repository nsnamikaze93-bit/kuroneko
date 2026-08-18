const test = require('node:test');
const assert = require('node:assert/strict');
const idMapper = require('../utils/idMapper');
const { normalize, scoreMatch, pickBest, kitsuTitleVariants, kitsuTitlesOverlap } = idMapper;

test('normalize strips accents and punctuation', () => {
  assert.equal(normalize('Super no Ura de Yani Sû Futari!'), 'super no ura de yani su futari');
  assert.equal(normalize('As a Reincarnated Aristocrat'), 'as a reincarnated aristocrat');
});

test('scoreMatch exact and prefix matches', () => {
  assert.equal(scoreMatch('one piece', 'One Piece'), 100);
  assert.equal(scoreMatch('naruto', 'Naruto Shippuden'), 80);
  assert.equal(scoreMatch('naruto shippuden', 'naruto'), 80);
});

test('scoreMatch romaji query scores high against the romaji variant (Smoking case)', () => {
  const q = 'Super no ura de yani sû futari';
  assert.ok(scoreMatch(q, 'Super no Ura de Yani Suu Futari') >= 79);
  assert.ok(scoreMatch(q, 'Smoking Behind the Supermarket With You') < 60);
  assert.equal(scoreMatch(q, 'Iketeru Futari'), 0);
});

test('scoreMatch a single generic shared word does not win', () => {
  assert.equal(scoreMatch('super no ura de yani su futari', 'Iketeru Futari'), 0);
  assert.equal(scoreMatch('super no ura de yani su futari', 'Super Lovers'), 45);
});

test('pickBest scores against all title variants', () => {
  const real = {
    id: '50040',
    attributes: {
      canonicalTitle: 'Super no Ura de Yani Suu Futari',
      titles: { en: 'Smoking Behind the Supermarket With You', en_jp: 'Super no Ura de Yani Suu Futari' },
    },
  };
  const impostor = {
    id: '591',
    attributes: { canonicalTitle: 'Iketeru Futari', titles: { en_jp: 'Iketeru Futari' } },
  };
  const best = pickBest('Super no ura de yani sû futari', [impostor, real], kitsuTitleVariants);
  assert.equal(best.id, '50040');
});

test('kitsuTitleVariants returns the useful variants in order', () => {
  const data = {
    attributes: {
      canonicalTitle: 'Canon',
      titles: { en_jp: 'Romaji', es: 'Español', en: 'English' },
    },
  };
  assert.deepEqual(kitsuTitleVariants(data), ['Romaji', 'Canon', 'Español', 'English']);
});

test('kitsuTitlesOverlap accepts a real match and rejects an impostor', () => {
  const real = {
    attributes: {
      canonicalTitle: 'Super no Ura de Yani Suu Futari',
      titles: { en_jp: 'Super no Ura de Yani Suu Futari' },
    },
  };
  const impostor = {
    attributes: { canonicalTitle: 'Iketeru Futari', titles: { en_jp: 'Iketeru Futari' } },
  };
  assert.equal(kitsuTitlesOverlap(real, 'Super no ura de yani sû futari'), true);
  assert.equal(kitsuTitlesOverlap(impostor, 'Super no ura de yani sû futari'), false);
});