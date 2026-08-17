const cheerio = require('cheerio');
const { get, post } = require('../utils/http');
const { normalize } = require('../utils/idMapper');

const BASE = 'https://animejara.com';

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;
  return fn().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

const LANG_ORDER = ['CASTELLANO', 'JAPONES', 'LATINO'];
const INTERESTING = ['CASTELLANO', 'JAPONES'];

const STOPWORDS = new Set([
  'the', 'of', 'and', 'a', 'an', 'to', 'in', 'on', 'for', 'with', 'from',
  'de', 'la', 'el', 'los', 'las', 'no', 'del', 'en', 'at', 'es', 'is', 'it',
  'this', 'that', 'vs', 'da', 'wa', 'ha', 'ni', 'wo', 'o', 'mo', 'ga',
  'season', 'part', 'movie', 'ova', 'film', 'ii', 'iii', 'iv', 'x', 'sub', 'dub',
]);

function significantWords(text) {
  return normalize(text).split(' ').filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function scoreMatch(query, title) {
  const q = normalize(query);
  const t = normalize(title);
  if (q && q === t) return 100;
  if (q && (t.startsWith(q) || q.startsWith(t))) return 90;
  if (q && t.includes(q)) return 75;
  const qWords = significantWords(query);
  const tWords = significantWords(title);
  const shared = qWords.filter((w) => tWords.includes(w)).length;
  const firstOk = qWords[0] && tWords[0] === qWords[0];
  let score = shared * 15 + (firstOk ? 15 : 0);
  if (qWords.length && tWords.length) {
    const extra = tWords.filter((w) => !qWords.includes(w)).length;
    score -= extra * 5;
  }
  return score;
}

async function searchAnime(title) {
  return cached(`aj:search:${title}`, 60 * 60 * 1000, async () => {
    const response = await post(
      `${BASE}/wp-admin/admin-ajax.php`,
      new URLSearchParams({ action: 'live_search', s: title }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded', Referer: `${BASE}/` }
    );
    if (response.status !== 200 || !response.data || !response.data.success) return [];
    const animes = (response.data.data && response.data.data.animes) || [];
    return animes
      .filter((a) => String(a.tipo || '').toLowerCase() === 'serie')
      .map((a) => ({
        slug: a.slug,
        title: a.titulo,
        anio: a.anio,
        rating: a.rating,
        score: scoreMatch(title, a.titulo),
      }))
      .sort((x, y) => y.score - x.score);
  });
}

async function pickBestAnime(query, results, season) {
  let best = null;
  let bestScore = 0;
  for (const r of results) {
    let s = scoreMatch(query, r.title);
    if (r.slug && /-tv$/.test(r.slug)) s += 15;
    const w = season && season > 1 ? Number(season) : 1;
    if (w > 1) {
      try {
        const info = await getAnimeInfo(r.slug);
        const has = info.seasons.some((t) => Number(t.numero_temporada) === w);
        s += has ? 20 : -40;
      } catch (e) {
        s -= 40;
      }
    }
    if (s > bestScore) {
      bestScore = s;
      best = r;
    }
  }
  return best && bestScore >= 50 ? best : null;
}

function extractSeasons(html) {
  const idx = html.indexOf('TEMPORADAS_DATA');
  if (idx === -1) return [];
  const start = html.indexOf('[', idx);
  if (start === -1) return [];
  let depth = 0;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch (e) {
          return [];
        }
      }
    }
  }
  return [];
}

async function getAnimeInfo(slug) {
  return cached(`aj:anime:${slug}`, 60 * 60 * 1000, async () => {
    const url = `${BASE}/anime/${slug}/`;
    const response = await get(url, { Referer: `${BASE}/` });
    if (response.status !== 200) {
      throw new Error(`AnimeJara anime "${slug}" fallo (HTTP ${response.status})`);
    }
    const html = response.data;
    const $ = cheerio.load(html);
    const title =
      ($('h1').first().text().trim()) ||
      (html.match(/og:title" content="([^"]+)"/) || [])[1] ||
      slug;
    const seasons = extractSeasons(html);
    if (!seasons.length) {
      throw new Error(`No se pudo extraer temporadas de "${slug}" en AnimeJara`);
    }
    return { title, slug, seasons, html };
  });
}

function findEpisodeInSeasons(seasons, seasonNumber, episodeNumber) {
  const wanted = String(seasonNumber);
  const season = seasons.find((s) => String(s.numero_temporada) === wanted);
  if (!season) return null;
  const ep = (season.episodios || []).find(
    (e) => String(e.numero_episodio) === String(episodeNumber)
  );
  return ep ? { season: Number(season.numero_temporada), episode: ep } : null;
}

function extractEmbeds(html) {
  const enlacesMatch = html.match(/const\s+enlaces\s*=\s*(\[[^\]]*\])/);
  let embeds = [];
  if (enlacesMatch) {
    try {
      embeds = JSON.parse(enlacesMatch[1].replace(/\\\//g, '/'));
    } catch (e) {
      embeds = [];
    }
  }
  const order = [];
  const re = /cambiarIdioma\((\d+),\s*this\)[\s\S]{0,400}?alt="([A-Z]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    order[Number(m[1])] = m[2];
  }
  if (!order.length) {
    order.push('LATINO');
  }
  const byLang = {};
  embeds.forEach((url, i) => {
    const lang = order[i] || 'LATINO';
    byLang[lang] = url;
  });
  return byLang;
}

async function getEpisodePage(slug, seasonNumber, episodeNumber) {
  return cached(`aj:ep:${slug}:${seasonNumber}:${episodeNumber}`, 30 * 60 * 1000, async () => {
    const url = `${BASE}/episode/${slug}-${seasonNumber}x${episodeNumber}/`;
    const response = await get(url, { Referer: `${BASE}/anime/${slug}/` });
    return response.data;
  });
}

async function getEmbedServers(embedUrl) {
  return cached(`aj:embed:${embedUrl}`, 30 * 60 * 1000, async () => {
    const response = await get(embedUrl, { Referer: `${BASE}/` });
    const html = response.data;
    const servers = [];
    const liRe = /<li[^>]*onclick=([\s\S]*?)<\/li>/g;
    let lm;
    while ((lm = liRe.exec(html)) !== null) {
      const liFull = lm[0];
      const liOpen = liFull.slice(0, liFull.indexOf('>') + 1);
      const liInner = lm[1];
      const openMatch = liOpen.match(/playVideo\(&quot;([^&]+)&quot;\)/);
      const innerMatch = liInner.match(/playVideo\(&quot;([^&]+)&quot;\)/);
      const urlMatch = openMatch || innerMatch;
      const nameMatch = liInner.match(/nombre-server[^>]*>([^<]+)</);
      if (!nameMatch || !urlMatch) continue;
      servers.push({
        server: nameMatch[1].trim(),
        url: urlMatch[1].replace(/\\\//g, '/'),
      });
    }
    return servers;
  });
}

function decodePacker(html) {
  const idx = html.indexOf('eval(function(p,a,c,k,e,d)');
  if (idx === -1) return null;
  let end = html.indexOf('</script>', idx);
  if (end === -1) end = html.length;
  const evalStr = html.slice(idx, end);
  const dictMatch = evalStr.match(/'([^']*)'\.split\('\|'\)\s*\)\)\s*;?\s*$/);
  if (!dictMatch) return null;
  const dict = dictMatch[1].split('|');
  const tailIdx = evalStr.indexOf("'" + dictMatch[1] + "'.split('|')");
  const before = evalStr.slice(0, tailIdx);
  const m = before.match(/,(\d+),(\d+),$/);
  if (!m) return null;
  const base = parseInt(m[1], 10);
  const count = parseInt(m[2], 10);
  const packedStart = evalStr.indexOf("}('") + 3;
  let packed = before.slice(packedStart, before.length - m[0].length);
  packed = packed.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  let p = packed;
  for (let i = count - 1; i >= 0; i--) {
    if (dict[i]) p = p.replace(new RegExp('\\b' + i.toString(base) + '\\b', 'g'), dict[i]);
  }
  const file = p.match(/(https?:\/\/[^"'\s]+\.m3u8[^"'\s]*)/);
  return file ? file[1] : null;
}

async function resolveUqload(url) {
  const response = await get(url, { Referer: 'https://uqload.com/' });
  return decodePacker(response.data);
}

async function resolveFilelions(url) {
  const response = await get(url, { Referer: 'https://filelions.top/' });
  return decodePacker(response.data);
}

const RESOLVERS = {
  uqload: resolveUqload,
  filelions: resolveFilelions,
  vidhide: resolveFilelions,
};

async function resolveServer(server, url) {
  const name = String(server).toLowerCase();
  const fn = RESOLVERS[name];
  if (!fn) return null;
  try {
    const direct = await fn(url);
    if (direct) return { url: direct, server };
  } catch (e) {
    console.warn(`[animejara] fallo resolver ${server}: ${e.message}`);
  }
  return null;
}

function langLabel(lang) {
  if (lang === 'CASTELLANO') return 'Castellano';
  if (lang === 'JAPONES') return 'Japonés sub';
  return 'Latino';
}

module.exports = {
  searchAnime,
  pickBestAnime,
  getAnimeInfo,
  findEpisodeInSeasons,
  getEpisodePage,
  extractEmbeds,
  getEmbedServers,
  resolveServer,
  decodePacker,
  langLabel,
  INTERESTING,
  LANG_ORDER,
};