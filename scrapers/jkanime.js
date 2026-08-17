const cheerio = require('cheerio');
const { get, post } = require('../utils/http');
const { normalize } = require('../utils/idMapper');

const BASE = 'https://jkanime.net';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return fn().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

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

async function searchOnce(query) {
  const url = `${BASE}/buscar/${query}/`;
  const response = await get(url);
  if (response.status !== 200) return [];
  const $ = cheerio.load(response.data);
  const results = [];
  $('.anime__item').each((i, el) => {
    const link = $(el).find('a[href]').first();
    const href = link.attr('href') || '';
    const m = href.match(/jkanime\.net\/([^/]+)\/?$/);
    if (!m) return;
    const slug = m[1];
    const itemTitle = $(el).find('h5 a').first().text().trim() || slug;
    const kind = $(el).find('.anime__item__text li.anime').first().text().trim() || 'Serie';
    results.push({ slug, title: itemTitle, kind });
  });
  return results;
}

async function searchAnime(title) {
  const queries = buildSearchQueries(title);
  if (!queries.length) {
    throw new Error(`Titulo vacio para buscar en JKanime: "${title}"`);
  }
  return cached(`search:${title}`, 60 * 60 * 1000, async () => {
    const fullResults = await searchOnce(queries[0]);
    if (fullResults.length) return fullResults;
    if (queries.length === 1) return [];
    const merged = new Map();
    await Promise.all(
      queries.slice(1).map(async (q) => {
        try {
          const items = await searchOnce(q);
          for (const it of items) if (!merged.has(it.slug)) merged.set(it.slug, it);
        } catch (e) {
          // ignora búsquedas individuales que fallen
        }
      })
    );
    return [...merged.values()];
  });
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

function pickBestAnime(query, results, season) {
  const q = normalize(query);
  const qWords = significantWords(query);
  const prefix2 = qWords.slice(0, 2).join(' ');
  const want = season && season > 1 ? Number(season) : 1;
  const hasVariants = results.some((r) => detectSeason(r) > 1);
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    const t = normalize(r.title);
    const tWords = significantWords(r.title);
    let score = 0;
    if (t === q) score = 100;
    else if (t.startsWith(q) || q.startsWith(t)) score = 90;
    else if (t.includes(q)) score = 75;
    else {
      const shared = qWords.filter((w) => tWords.includes(w)).length;
      const firstOk = qWords[0] && tWords[0] === qWords[0];
      score = shared * 15 + (firstOk ? 15 : 0);
      if (tWords.length >= 2 && qWords[0] === tWords[0] && qWords[1] === tWords[1]) score += 15;
    }
    if (hasVariants) {
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
    const response = await get(url);
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
  const response = await post(
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
    const response = await get(url);
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
  pickBestAnime,
  detectSeason,
  getAnimeInfo,
  findEpisode,
  getEpisodePage,
  extractServers,
  slugifyTitle,
  inferPlayerName,
};