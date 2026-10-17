const cheerio = require('cheerio');
const http = require('../utils/http');
const { describeResponse, assertUsableResponse } = require('../utils/diagnostics');
const { normalize } = require('../utils/idMapper');
const { createStore, createCached } = require('../utils/cache');

const BASE = 'https://jkanime.net';

const cached = createCached(createStore(400));

const STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'from',
  'de', 'la', 'el', 'los', 'las', 'no', 'del', 'en', 'at', 'es', 'is', 'it',
  'this', 'that', 'vs', 'da', 'wa', 'ha', 'ni', 'no', 'wo', 'o', 'mo', 'ga',
  'season', 'part', 'movie', 'ova', 'film', 'ii', 'iii', 'iv', 'x', 'sub', 'dub',
]);

function slugifyTitle(title) {
  return normalize(title).trim().replace(/\s+/g, '-').replace(/-+/g, '-');
}

function significantWords(text) {
  return normalize(text).split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function buildSearchQueries(title) {
  const words = significantWords(title);
  const queries = [];
  const full = slugifyTitle(title);
  if (full) queries.push(full);
  if (words.length > 2) queries.push(words.slice(0, 3).join('-'));
  if (words.length > 4) queries.push(words.slice(0, 2).join('-'));
  const unique = [...new Set(words)];
  const ranked = unique.slice().sort((a, b) => b.length - a.length);
  const pick = ranked.slice(0, 4);
  if (unique[0] && !pick.includes(unique[0])) pick.push(unique[0]);
  for (const w of pick) queries.push(w);
  return [...new Set(queries)];
}

const RESERVED_SLUGS = new Set([
  'buscar', 'directorio', 'horario', 'top', 'login', 'registro', 'ajax', 'ver',
  'animes', 'generos', 'genero', 'tipo', 'estado', 'contacto', 'terminos',
  'privacidad', 'dmca', 'faq', 'static', 'assets', 'index', 'calendario',
]);

function slugFromHref(href) {
  const m = String(href || '').match(/^(?:https?:\/\/(?:www\.)?jkanime\.net)?\/([a-z0-9][a-z0-9-]*)\/?(?:[?#].*)?$/i);
  return m ? m[1] : null;
}

// Extracción principal (.anime__item). Si la web cambia ese contenedor, se usa un
// respaldo basado en enlaces; la validación por título (pickBestAnime) evita falsos positivos.
function parseSearchResults($) {
  const results = [];
  const seen = new Set();
  $('.anime__item').each((i, el) => {
    const link = $(el).find('a[href]').first();
    const slug = slugFromHref(link.attr('href'));
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    const itemTitle = $(el).find('h5 a').first().text().trim() || slug;
    const kind = $(el).find('.anime__item__text li.anime').first().text().trim() || 'Serie';
    results.push({ slug, title: itemTitle, kind });
  });
  if (results.length) return results;

  $('a[href]').each((i, el) => {
    const slug = slugFromHref($(el).attr('href'));
    if (!slug || RESERVED_SLUGS.has(slug) || seen.has(slug)) return;
    const text = ($(el).attr('title') || $(el).text() || '').trim().replace(/\s+/g, ' ');
    if (text.length < 2) return;
    seen.add(slug);
    results.push({ slug, title: text, kind: 'Serie', fallback: true });
  });
  if (results.length) {
    console.warn(`[jkanime] selector .anime__item sin resultados; usando extracción de respaldo (${results.length} enlaces candidatos)`);
  }
  return results;
}

async function searchOnce(query) {
  const url = `${BASE}/buscar/${query}/`;
  const response = await http.get(url);
  assertUsableResponse('JKanime', url, response);
  const $ = cheerio.load(response.data);
  const results = parseSearchResults($);
  if (!results.length) {
    console.log(`[jkanime] búsqueda "${query}": 0 resultados (${describeResponse(response)})`);
  }
  return results;
}

async function searchAnime(title) {
  const queries = buildSearchQueries(title);
  if (!queries.length) {
    throw new Error(`Titulo vacio para buscar en JKanime: "${title}"`);
  }
  return cached(
    `search:${title}`,
    60 * 60 * 1000,
    async () => {
      const failures = [];
      let succeeded = 0;
      const run = async (q) => {
        try {
          const items = await searchOnce(q);
          succeeded++;
          return items;
        } catch (e) {
          failures.push(e.message);
          return [];
        }
      };
      const fullResults = await run(queries[0]);
      if (fullResults.length) return fullResults;
      const merged = new Map();
      await Promise.all(
        queries.slice(1).map(async (q) => {
          for (const it of await run(q)) if (!merged.has(it.slug)) merged.set(it.slug, it);
        })
      );
      // Si ninguna búsqueda llegó a completarse, es un fallo (no "sin coincidencias").
      if (!merged.size && succeeded === 0 && failures.length) throw new Error(failures[0]);
      return [...merged.values()];
    },
    // Los resultados vacíos solo se recuerdan 5 min para no ocultar una recuperación del sitio.
    { ttlFor: (v) => (v.length ? 60 * 60 * 1000 : 5 * 60 * 1000) }
  );
}

function detectSeason(r) {
  const slug = String(r.slug || '').toLowerCase();
  const title = String(r.title || '').toLowerCase();
  const text = `${slug} ${title}`;
  const m = text.match(/(?:season|temporada|saison)\s*(\d+)/);
  if (m) return Number(m[1]);
  const tokenized = text.replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokenized.includes('part')) {
    const p = tokenized.indexOf('part');
    const n = tokenized[p + 1];
    if (/^\d+$/.test(n || '')) return Number(n);
  }
  const romans = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12 };
  if (tokenized.includes('2nd') || tokenized.includes('second') || /-2-?$/.test(slug) || /-2nd-season/.test(slug)) return 2;
  if (tokenized.includes('3rd') || tokenized.includes('third')) return 3;
  if (tokenized.includes('4th') || tokenized.includes('fourth')) return 4;
  if (tokenized.includes('revenge')) return 2;
  for (const [rom, num] of Object.entries(romans)) {
    if (tokenized.includes(rom)) return num;
  }
  return 1;
}

function titleScore(query, title) {
  const q = normalize(query);
  const t = normalize(title);
  if (!q || !t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q) || q.startsWith(t)) return 90;
  if (t.includes(q)) return 75;
  const qWords = significantWords(query);
  const tWords = significantWords(title);
  let score = qWords.filter((w) => tWords.includes(w)).length * 15;
  if (qWords[0] && tWords[0] === qWords[0]) score += 15;
  if (tWords.length >= 2 && qWords[0] === tWords[0] && qWords[1] === tWords[1]) score += 15;
  return score;
}

function pickBestAnime(query, results, season) {
  const want = season && season > 1 ? Number(season) : 1;

  const scored = results
    .map((r) => ({ r, base: titleScore(query, r.title) }))
    .filter((c) => c.base > 0);
  if (!scored.length) return null;

  const sameAnime = scored.filter((c) => c.base >= 60);
  const hasVariants = sameAnime.some((c) => detectSeason(c.r) > 1);

  let best = null;
  let bestScore = 0;
  for (const { r, base } of scored) {
    let score = base;
    if (base >= 60 && hasVariants) {
      const got = detectSeason(r);
      if (got === want) score += 40;
      else if (got !== 1 || want !== 1) score -= 60;
    }
    if (score > bestScore) {
      bestScore = score;
      best = r;
    } else if (score === bestScore && best && score > 0 && r.slug.length < best.slug.length) {
      best = r;
    }
  }
  if (bestScore >= 50 && best) {
    const continuous = !hasVariants && want > 1;
    return { ...best, continuous };
  }
  return null;
}

async function getAnimeInfo(slug) {
  return cached(`anime:${slug}`, 60 * 60 * 1000, async () => {
    const url = `${BASE}/${slug}/`;
    const response = await http.get(url);
    if (response.status !== 200) {
      throw new Error(`JKanime anime "${slug}" fallo (HTTP ${response.status})`);
    }
    const html = response.data;
    const idMatch = html.match(/jkanime\.net\/ajax\/episodes\/(\d+)\//);
    const animeId = idMatch ? idMatch[1] : null;
    if (!animeId) {
      throw new Error(`No se pudo obtener el id del anime "${slug}"`);
    }
    const tokenMatch = html.match(/name="csrf-token" content="([^"]+)"/);
    const token = tokenMatch ? tokenMatch[1] : '';
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/property="og:title" content="([^"]+)"/);
    const title = titleMatch ? titleMatch[1].trim() : slug;
    return { animeId, token, title, html };
  });
}

async function findEpisode(animeId, episodeNumber, token) {
  const url = `${BASE}/ajax/search_episode/${animeId}/${episodeNumber}`;
  const response = await http.post(
    url,
    `_token=${encodeURIComponent(token || '')}`,
    { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }
  );
  if (response.status !== 200) {
    throw new Error(`JKanime search_episode fallo (HTTP ${response.status})`);
  }
  const data = response.data;
  if (Array.isArray(data) && data.length > 0) {
    return data[0];
  }
  return null;
}

async function getEpisodePage(slug, episodeNumber) {
  return cached(`ep:${slug}:${episodeNumber}`, 30 * 60 * 1000, async () => {
    const url = `${BASE}/${slug}/${episodeNumber}/`;
    const response = await http.get(url);
    if (response.status !== 200) {
      throw new Error(`JKanime episodio "${slug}/${episodeNumber}" fallo (HTTP ${response.status})`);
    }
    return response.data;
  });
}

function inferPlayerName(iframeUrl) {
  if (iframeUrl.includes('/jkplayer/um?')) return 'Desu';
  if (iframeUrl.includes('/jkplayer/umv?')) return 'Magi';
  if (iframeUrl.includes('/jkplayer/jk?')) return 'JKplayer';
  const m = iframeUrl.match(/[?&]s=([a-z0-9]+)/i);
  if (m) return m[1];
  return 'JKanime';
}

function extractServers(html) {
  const $ = cheerio.load(html);
  const languages = {};
  $('#deflang option').each((i, el) => {
    const value = $(el).attr('value');
    const label = $(el).text().trim();
    if (value) languages[value] = label;
  });

  const buttons = [];
  $('.bg-servers a').each((i, el) => {
    const dataId = $(el).attr('data-id');
    const label = $(el).text().trim();
    const cls = $(el).attr('class') || '';
    const langMatch = cls.match(/\blg_(\d+)\b/);
    buttons.push({ dataId, label, lang: langMatch ? langMatch[1] : '1' });
  });

  const players = [];
  const videoRe = /video\[(\d+)\]\s*=\s*'<iframe[^>]+src="([^"]+)"/g;
  let vm;
  while ((vm = videoRe.exec(html)) !== null) {
    const idx = vm[1];
    const iframeUrl = vm[2];
    const btn = buttons.find((b) => b.dataId === idx);
    players.push({
      id: idx,
      iframeUrl,
      server: btn ? btn.label : inferPlayerName(iframeUrl),
      lang: btn ? btn.lang : '1',
    });
  }

  const external = [];
  const serversRe = /var\s+servers\s*=\s*(\[.*?\]);/s;
  const sm = serversRe.exec(html);
  if (sm) {
    try {
      const servers = JSON.parse(sm[1]);
      for (const s of servers) {
        let remoteUrl = '';
        try {
          remoteUrl = Buffer.from(s.remote, 'base64').toString('utf8');
        } catch (e) {
          remoteUrl = s.remote || '';
        }
        if (!s.server || s.server === 'Mediafire') continue;
        external.push({ server: s.server, remoteUrl, lang: String(s.lang || '1') });
      }
    } catch (e) {
      console.warn('[jkanime] No se pudo parsear el array de servidores:', e.message);
    }
  }

  return { languages, players, external };
}

module.exports = {
  searchAnime,
  parseSearchResults,
  pickBestAnime,
  detectSeason,
  getAnimeInfo,
  findEpisode,
  getEpisodePage,
  extractServers,
  slugifyTitle,
  inferPlayerName,
};