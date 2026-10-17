// Diagnóstico de búsqueda contra las webs reales. Usa http directamente (sin caché)
// para que ningún resultado cacheado oculte el estado actual. No expone cookies ni cabeceras.
const cheerio = require('cheerio');
const http = require('./http');
const { describeResponse } = require('./diagnostics');
const jkanime = require('../scrapers/jkanime');
const animejara = require('../scrapers/animejara');

async function step(fn) {
  const t0 = Date.now();
  try {
    return { ok: true, ms: 0, ...(await fn()), ms_total: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: `${e.code || ''} ${e.message}`.trim(), ms_total: Date.now() - t0 };
  }
}

async function diagnoseJkanime(title) {
  const slug = jkanime.slugifyTitle(title);
  return step(async () => {
    const url = `https://jkanime.net/buscar/${slug}/`;
    const r = await http.get(url);
    const $ = cheerio.load(typeof r.data === 'string' ? r.data : '');
    const results = typeof r.data === 'string' ? jkanime.parseSearchResults($) : [];
    return {
      url,
      response: describeResponse(r),
      anime__item_count: $('.anime__item').length,
      parsed: results.slice(0, 5),
      used_fallback: results.some((x) => x.fallback),
      best: jkanime.pickBestAnime(title, results, 1),
    };
  });
}

async function diagnoseAnimejara(title) {
  return step(async () => {
    const url = 'https://animejara.com/wp-admin/admin-ajax.php';
    const r = await http.post(
      url,
      new URLSearchParams({ action: 'live_search', s: title }).toString(),
      { 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://animejara.com/' }
    );
    const out = { url, response: describeResponse(r) };
    if (r.data && typeof r.data === 'object') {
      out.success = r.data.success;
      out.data_keys = r.data.data && typeof r.data.data === 'object' ? Object.keys(r.data.data) : typeof r.data.data;
      const animes = r.data.data && r.data.data.animes;
      if (Array.isArray(animes)) {
        out.animes_count = animes.length;
        out.tipos = [...new Set(animes.map((a) => a.tipo))];
        out.sample = animes.slice(0, 5).map((a) => ({ slug: a.slug, titulo: a.titulo, tipo: a.tipo }));
        try {
          out.parsed_count = animejara.parseLiveSearch(r, title).length;
        } catch (e) {
          out.parse_error = e.message;
        }
      }
    }
    return out;
  });
}

async function diagnose(title) {
  const [jk, aj] = await Promise.all([diagnoseJkanime(title), diagnoseAnimejara(title)]);
  return { title, jkanime: jk, animejara: aj };
}

module.exports = { diagnose };
