const test = require('node:test');
const assert = require('node:assert/strict');
const { parseId } = require('../handlers/streams');

test('parseId parses imdb ids with season and episode', () => {
  assert.deepEqual(parseId('tt31975847:3:1', 'series'), {
    type: 'imdb',
    imdbId: 'tt31975847',
    season: '3',
    episode: '1',
  });
  assert.deepEqual(parseId('tt123', 'series'), {
    type: 'imdb',
    imdbId: 'tt123',
    season: '1',
    episode: '1',
  });
});

test('parseId treats movies as movie type', () => {
  assert.equal(parseId('tt123', 'movie').type, 'movie');
  assert.equal(parseId('tt123', 'series').type, 'imdb');
});

test('parseId parses kitsu ids with episode', () => {
  assert.deepEqual(parseId('kitsu:47481:5', 'series'), {
    type: 'kitsu',
    kitsuId: '47481',
    episode: '5',
  });
  assert.deepEqual(parseId('kitsu:47481', 'series'), {
    type: 'kitsu',
    kitsuId: '47481',
    episode: '1',
  });
});