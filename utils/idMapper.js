const { get } = require('./http');

const CINEMETA = 'https://v3-cinemeta.strem.io';
const KITSU = 'https://kitsu.io/api/edge';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ');
}

function scoreMatch(query, title) {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return 0;
  if (q === t) return 100;
  if (q.startsWith(t) || t.startsWith(q)) return 80;
  if (t.includes(q)) return 60;
  return 0;
}

function pickBest(query, candidates, titleFn) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const score = scoreMatch(query, titleFn(c));
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore > 0 ? best : null;
}

async function getTitleFromImdb(imdbId) {
  const url = `${CINEMETA}/meta/series/${imdbId}.json`;
  const response = await get(url);
  if (response.status !== 200) {
    throw new Error(`Cinemeta no encontro ${imdbId} (HTTP ${response.status})`);
  }
  const meta = response.data && response.data.meta;
  if (!meta || !meta.name) {
    throw new Error(`Cinemeta devolvio datos vacios para ${imdbId}`);
  }
  return { name: meta.name, type: meta.type || 'series', year: meta.year || null };
}

async function getKitsuAnime(kitsuId) {
  const response = await get(`${KITSU}/anime/${kitsuId}`, {
    Accept: 'application/vnd.api+json',
  });
  if (response.status !== 200) {
    throw new Error(`Kitsu no encontro el anime ${kitsuId} (HTTP ${response.status})`);
  }
  const data = response.data && response.data.data;
  if (!data || !data.attributes) {
    throw new Error(`Kitsu devolvio datos vacios para ${kitsuId}`);
  }
  return data;
}

function kitsuTitle(data) {
  const attrs = data.attributes || {};
  const titles = attrs.titles || {};
  const title =
    titles.es ||
    titles.es_la ||
    titles.en ||
    titles.en_us ||
    titles.en_jp ||
    attrs.canonicalTitle ||
    attrs.abbreviatedTitles?.[0] ||
    '';
  return title;
}

async function searchKitsu(query) {
  const url = `${KITSU}/anime?filter[text]=${encodeURIComponent(query)}&page[limit]=10`;
  const response = await get(url, { Accept: 'application/vnd.api+json' });
  if (response.status !== 200) {
    throw new Error(`Kitsu search fallo (HTTP ${response.status})`);
  }
  const list = response.data && response.data.data ? response.data.data : [];
  return pickBest(query, list, kitsuTitle);
}

async function searchCinemeta(query) {
  const url = `${CINEMETA}/catalog/series/top/search=${encodeURIComponent(query)}.json`;
  const response = await get(url);
  if (response.status !== 200) return [];
  const metas = response.data && response.data.metas ? response.data.metas : [];
  const best = pickBest(query, metas, (m) => m.name);
  return best ? best : null;
}

async function kitsuToImdb(kitsuId) {
  const mappingResponse = await get(`${KITSU}/anime/${kitsuId}/mappings`, {
    Accept: 'application/vnd.api+json',
  });
  if (mappingResponse.status === 200 && mappingResponse.data) {
    const mappings = mappingResponse.data.data || [];
    const imdb = mappings.find((m) => {
      const site = m.attributes && m.attributes.externalSite;
      return site && site.toLowerCase() === 'imdb';
    });
    if (imdb && imdb.attributes.externalId) {
      return imdb.attributes.externalId;
    }
  }

  const data = await getKitsuAnime(kitsuId);
  const title = kitsuTitle(data);
  const cinemeta = await searchCinemeta(title);
  if (cinemeta && cinemeta.id) return cinemeta.id;

  return null;
}

async function imdbToKitsu(imdbId) {
  const { name } = await getTitleFromImdb(imdbId);
  const kitsu = await searchKitsu(name);
  return kitsu ? kitsu.id : null;
}

module.exports = {
  getTitleFromImdb,
  getKitsuAnime,
  kitsuTitle,
  searchKitsu,
  searchCinemeta,
  kitsuToImdb,
  imdbToKitsu,
  normalize,
};