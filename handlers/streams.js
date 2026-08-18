const jkanime = require('../scrapers/jkanime');
const animejara = require('../scrapers/animejara');
const resolvers = require('../resolvers');
const idMapper = require('../utils/idMapper');

const BASE = 'https://jkanime.net';

function parseId(id, type) {
  if (id.startsWith('kitsu:')) {
    const parts = id.split(':');
    return { type: 'kitsu', kitsuId: parts[1], episode: parts[2] || '1' };
  }
  const parts = id.split(':');
  return {
    type: type === 'movie' ? 'movie' : 'imdb',
    imdbId: parts[0],
    season: parts[1] || '1',
    episode: parts[2] || '1',
  };
}

async function resolveTitles(parsed) {
  if (parsed.type === 'kitsu') {
    const data = await idMapper.getKitsuAnime(parsed.kitsuId);
    return idMapper.kitsuSearchTitles(data);
  }
  return idMapper.imdbToRomajiTitles(parsed.imdbId, parsed.type === 'movie');
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
  if (!episodeData) {
    console.warn(`[streams] Episodio ${episode} no existe aun en JKanime (${slug}), se omite`);
    return [];
  }
  const html = await jkanime.getEpisodePage(slug, episodeData.number);
  const servers = jkanime.extractServers(html);
  if (!servers.players.length && !servers.external.length) {
    console.warn(`[streams] No se encontraron reproductores en ${slug}/${episode}`);
    return [];
  }
  const referer = `${BASE}/${slug}/${episode}/`;
  return resolvers.resolveAll(servers, referer, servers.languages);
}

async function findAnimeOnAnimejara(titles, season) {
  let lastError = null;
  for (const title of titles) {
    try {
      const results = await animejara.searchAnime(title);
      if (results.length) {
        const best = await animejara.pickBestAnime(title, results, season);
        if (best) return best;
      }
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error(`No hubo coincidencia en AnimeJara para "${titles[0]}"`);
}

async function resolveAnimejaraEpisodeStreams(anime, season, episode) {
  const info = await animejara.getAnimeInfo(anime.slug);
  const match = animejara.findEpisodeInSeasons(info.seasons, season, episode);
  if (!match) return [];

  const html = await animejara.getEpisodePage(anime.slug, match.season, match.episode.numero_episodio);
  const embeds = animejara.extractEmbeds(html);
  const streams = [];
  const seen = new Set();

  for (const lang of animejara.INTERESTING) {
    const embedUrl = embeds[lang];
    if (!embedUrl) continue;
    let servers;
    try {
      servers = await animejara.getEmbedServers(embedUrl);
    } catch (e) {
      console.warn(`[streams] AnimeJara embed ${lang} fallo: ${e.message}`);
      continue;
    }
    for (const srv of servers) {
      const direct = await animejara.resolveServer(srv.server, srv.url);
      if (!direct) continue;
      const key = direct.url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      streams.push({
        name: 'AnimeJara',
        title: `${animejara.langLabel(lang)}`,
        url: direct.url,
        behaviorHints: { notWebReady: false },
      });
    }
  }
  return streams;
}

async function defineStreamHandler(args) {
  const { id, type } = args;
  const streams = [];
  const start = Date.now();

  try {
    const parsed = parseId(id, type);
    const titles = await resolveTitles(parsed);
    console.log(`[streams] Resolviendo "${titles[0]}" para ${id}`);

    const season = parsed.season ? Number(parsed.season) : 1;
    let episode = Number(parsed.episode) || 1;

    try {
      const anime = await findAnimeOnJkanime(titles, season);
      console.log(`[streams] Anime en JKanime: "${anime.title}" (${anime.slug})${anime.continuous ? ' [serie continua]' : ''}`);

      const animeInfo = await jkanime.getAnimeInfo(anime.slug);
      if (anime.continuous && parsed.type === 'imdb' && season > 1) {
        const offset = await idMapper.getGlobalEpisodeOffset(parsed.imdbId, season);
        episode += offset;
        console.log(`[streams] ${id} -> episodio global ${episode} (offset ${offset})`);
      }

      const resolved = await resolveEpisodeStreams(anime.slug, episode, animeInfo);
      streams.push(...resolved);
    } catch (e) {
      console.log(`[streams] JKanime: ${e.message}`);
    }

    try {
      const ajAnime = await findAnimeOnAnimejara(titles, season);
      console.log(`[streams] Anime en AnimeJara: "${ajAnime.title}" (${ajAnime.slug})`);
      const ajStreams = await resolveAnimejaraEpisodeStreams(ajAnime, season, episode);
      streams.push(...ajStreams);
    } catch (e) {
      console.log(`[streams] AnimeJara: ${e.message}`);
    }
  } catch (e) {
    console.error(`[streams] Error resolviendo ${id}: ${e.message}`);
  }

  console.log(
    `[streams] ${id}: ${streams.length} stream(s) en ${Date.now() - start}ms`
  );
  return { streams };
}

module.exports = { defineStreamHandler, parseId };