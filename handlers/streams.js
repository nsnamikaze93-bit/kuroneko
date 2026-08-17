const jkanime = require('../scrapers/jkanime');
const resolvers = require('../resolvers');
const idMapper = require('../utils/idMapper');

const BASE = 'https://jkanime.net';

function parseId(id) {
  if (id.startsWith('kitsu:')) {
    const parts = id.split(':');
    return { type: 'kitsu', kitsuId: parts[1], episode: parts[2] || '1' };
  }
  const parts = id.split(':');
  return { type: 'imdb', imdbId: parts[0], season: parts[1] || '1', episode: parts[2] || '1' };
}

async function resolveTitles(parsed) {
  if (parsed.type === 'kitsu') {
    const data = await idMapper.getKitsuAnime(parsed.kitsuId);
    return idMapper.kitsuSearchTitles(data);
  }
  return idMapper.imdbToRomajiTitles(parsed.imdbId);
}

async function findAnimeOnJkanime(titles, season) {
  let lastError = null;
  for (const title of titles) {
    try {
      const results = await jkanime.searchAnime(title);
      if (results.length) {
        const best = jkanime.pickBestAnime(title, results, season);
        if (best) return best;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`No hubo coincidencia en JKanime para "${titles[0]}"`);
}

async function resolveEpisodeStreams(slug, episode, animeInfo) {
  const episodeData = await jkanime.findEpisode(animeInfo.animeId, episode, animeInfo.token);
  let html;
  if (episodeData) {
    html = await jkanime.getEpisodePage(slug, episodeData.number);
  } else {
    html = await jkanime.getEpisodePage(slug, episode);
  }
  const servers = jkanime.extractServers(html);
  if (!servers.players.length && !servers.external.length) {
    console.warn(`[streams] No se encontraron reproductores en ${slug}/${episode}`);
    return [];
  }
  const referer = `${BASE}/${slug}/${episode}/`;
  return resolvers.resolveAll(servers, referer, servers.languages);
}

async function defineStreamHandler(args) {
  const { id } = args;
  const streams = [];
  const start = Date.now();

  try {
    const parsed = parseId(id);
    const titles = await resolveTitles(parsed);
    console.log(`[streams] Resolviendo "${titles[0]}" para ${id}`);

    const anime = await findAnimeOnJkanime(titles, parsed.season ? Number(parsed.season) : 1);
    console.log(`[streams] Anime en JKanime: "${anime.title}" (${anime.slug})`);

    const animeInfo = await jkanime.getAnimeInfo(anime.slug);
    const episode = Number(parsed.episode) || 1;

    const resolved = await resolveEpisodeStreams(anime.slug, episode, animeInfo);
    streams.push(...resolved);
  } catch (e) {
    console.error(`[streams] Error resolviendo ${id}: ${e.message}`);
  }

  console.log(
    `[streams] ${id}: ${streams.length} stream(s) en ${Date.now() - start}ms`
  );
  return { streams };
}

module.exports = { defineStreamHandler, parseId };