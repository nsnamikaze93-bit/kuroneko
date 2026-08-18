const test = require('node:test');
const assert = require('node:assert/strict');
const jkanime = require('../scrapers/jkanime');
const { detectSeason, pickBestAnime } = jkanime;

test('detectSeason parses plain, numbered and roman seasons', () => {
  assert.equal(detectSeason({ slug: 'naruto', title: 'Naruto' }), 1);
  assert.equal(detectSeason({ slug: 'x-2nd-season', title: 'X 2nd Season' }), 2);
  assert.equal(detectSeason({ slug: 'x-3rd-season', title: 'X 3rd Season' }), 3);
  assert.equal(detectSeason({ slug: 'hyakushou-kizoku-3rd-season', title: 'Hyakushou Kizoku 3rd Season' }), 3);
  assert.equal(detectSeason({ slug: 'x-ii', title: 'X II' }), 2);
});

test('pickBestAnime S1/S2 picks the right variant and S3 returns null (Tensei Kizoku case)', () => {
  const results = [
    { slug: 'tensei-kizoku-kantei-skill-de-nariagaru', title: 'Tensei Kizoku, Kantei Skill de Nariagaru' },
    { slug: 'tensei-kizoku-kantei-skill-de-nariagaru-2nd-season', title: 'Tensei Kizoku, Kantei Skill de Nariagaru 2nd Season' },
    { slug: 'hyakushou-kizoku-3rd-season', title: 'Hyakushou Kizoku 3rd Season' },
  ];
  const q = 'Tensei Kizoku, Kantei Skill de Nariagaru';

  const s1 = pickBestAnime(q, results, 1);
  assert.equal(s1.slug, 'tensei-kizoku-kantei-skill-de-nariagaru');

  const s2 = pickBestAnime(q, results, 2);
  assert.equal(s2.slug, 'tensei-kizoku-kantei-skill-de-nariagaru-2nd-season');

  const s3 = pickBestAnime(q, results, 3);
  assert.equal(s3, null);
});

test('pickBestAnime marks continuous series when a season is requested but no variants exist', () => {
  const results = [{ slug: 'one-piece', title: 'One Piece' }];
  const s2 = pickBestAnime('One Piece', results, 2);
  assert.equal(s2.slug, 'one-piece');
  assert.equal(s2.continuous, true);
});

test('pickBestAnime picks the matching season among same-anime variants', () => {
  const results = [
    { slug: 'shingeki-no-kyojin', title: 'Shingeki no Kyojin' },
    { slug: 'shingeki-no-kyojin-season-3', title: 'Shingeki no Kyojin Season 3' },
  ];
  const s3 = pickBestAnime('Shingeki no Kyojin', results, 3);
  assert.equal(s3.slug, 'shingeki-no-kyojin-season-3');
});

test('pickBestAnime returns null when there is no reasonable title match', () => {
  const results = [{ slug: 'totally-unrelated', title: 'Totally Unrelated Show' }];
  assert.equal(pickBestAnime('Naruto', results, 1), null);
});