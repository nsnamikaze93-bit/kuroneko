const crypto = require('crypto');
const { get } = require('../utils/http');

function log(server, message) {
  console.warn(`[resolver:${server}] ${message}`);
}

/* ------------------------------------------------------------------ */
/* Validacion de URLs directas                                         */
/* ------------------------------------------------------------------ */

async function validateDirect(url, referer) {
  try {
    const response = await get(
      url,
      { Referer: referer || url, Range: 'bytes=0-4096' },
      { responseType: 'arraybuffer', maxContentLength: 1024 * 1024, timeout: 15000 }
    );
    if (response.status !== 200 && response.status !== 206) return false;
    const ct = String(response.headers['content-type'] || '').toLowerCase();
    if (ct.startsWith('video/')) return true;
    if (ct.includes('mpegurl') || ct.includes('mpeg') || ct.includes('mp4')) return true;
    const head = Buffer.from(response.data).slice(0, 32).toString('utf8');
    if (head.startsWith('#EXTM3U')) return true;
    if (ct.includes('octet-stream') && response.data.length > 1024) return true;
    return false;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Player CDN de JKanime (jkplayer/um, umv, jk)                        */
/* ------------------------------------------------------------------ */

async function resolveJkanimePlayer(iframeUrl, referer) {
  const response = await get(iframeUrl, { Referer: referer });
  const html = response.data;
  const m3u8 = html.match(/url:\s*'([^']+\.m3u8[^']*)'/) ||
    html.match(/(https?:\/\/[^'"\s\\]+\.m3u8[^'"\s\\]*)/);
  if (m3u8) return { url: m3u8[1] || m3u8[0], type: 'hls' };
  const mp4 = html.match(/url:\s*'(https?:\/\/jkplayers\.com\/stream\/[^']+)'/) ||
    html.match(/url:\s*'([^']+\.mp4[^']*)'/);
  if (mp4) return { url: mp4[1] || mp4[0], type: 'mp4' };
  return null;
}

/* ------------------------------------------------------------------ */
/* Resolvers de servidores externos                                    */
/* ------------------------------------------------------------------ */

async function resolveStreamtape(url) {
  const m = url.match(/\/(?:e|v)\/([^/]+)/);
  if (!m) return null;
  const id = m[1];
  const response = await get(`https://streamtape.com/e/${id}`, { Referer: url });
  const html = response.data;

  const direct = html.match(/<video[^>]+src="(https?:\/\/[^"]+)"/);
  if (direct) return direct[1];

  const pageVideos = [...new Set(
    [...String(html).matchAll(/get_video\?id=[^"'\\<]+/g)].map((x) => `https://streamtape.com/${x[0]}`)
  )];
  if (pageVideos.length) return pageVideos[0];

  const vm = String(html).match(/var vidconfig = (\{.*?\});/s);
  if (vm) {
    try {
      const cfg = JSON.parse(vm[1]);
      const cors = cfg.cors || '';
      const expires = (cors.match(/expires=(\d+)/) || [])[1] || '';
      const ip = (cors.match(/ip=([^&]+)/) || [])[1] || '';
      const token = (cors.match(/token=([^&]+)/) || [])[1] || '';
      if (cfg.id && expires && token) {
        return `https://streamtape.com/get_video?id=${cfg.id}&expires=${expires}&ip=${ip}&token=${token}&stream=1`;
      }
    } catch (e) {
      log('Streamtape', `vidconfig invalido: ${e.message}`);
    }
  }

  const videoId = (html.match(/"(?:id|fileid)":"([^"]+)"/) || [])[1];
  const expires = (html.match(/expires=(\d+)/) || [])[1] || '';
  const ip = (html.match(/ip=([a-zA-Z0-9]+)/) || [])[1] || '';
  const token = (html.match(/token=([a-zA-Z0-9]+)/) || [])[1] || '';
  if (videoId && expires && token) {
    return `https://streamtape.com/get_video?id=${videoId}&expires=${expires}&ip=${ip}&token=${token}&stream=1`;
  }
  return null;
}

async function resolveDoodstream(url) {
  const m = url.match(/\/(?:e|f|embed)\/([a-zA-Z0-9]+)/);
  if (!m) return null;
  const code = m[1];
  const response = await get(url, { Referer: url });
  const html = response.data;
  const passMd5 = crypto
    .createHash('md5')
    .update(`doodstream${code}doodstream`)
    .digest('hex');
  const domains = html.match(/'([a-zA-Z0-9.-]+\.(?:dooodstream|doodstream|dood|d-s|doodcdn|doodproxy)[^']*)'/);
  if (!domains) return null;
  let host = domains[1];
  if (!host.includes('://')) host = `https://${host}`;
  return `${host}/${passMd5}/${code}`;
}

async function resolveVoe(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  const file =
    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/) ||
    html.match(/hls\.src\(\s*\[\s*\{\s*src:\s*["']([^"']+)["']/) ||
    html.match(/"file"\s*:\s*"([^"]+\.m3u8[^"]*)"/i);
  return file ? file[1] : null;
}

async function resolveStreamwish(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  const file =
    html.match(/file:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
    html.match(/sources:\s*\[\s*\{[^}]*file:\s*["']([^"']+)/i) ||
    html.match(/playlist:\s*\[\s*\{\s*file:\s*["']([^"']+)/i);
  return file ? file[1] : null;
}

async function resolveVidhide(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  const file =
    html.match(/file:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i) ||
    html.match(/(https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*)/);
  return file ? file[1] || file[0] : null;
}

async function resolveMixdrop(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  const m =
    html.match(/MDCore\.playlist\s*=\s*\[?\s*\{?\s*"file"\s*:\s*"([^"]+)"/) ||
    html.match(/https?:\/\/[^"'\s]+\.(?:m3u8|mp4)[^"'\s]*/);
  return m ? m[1] || m[0] : null;
}

async function resolveMp4upload(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  if (html.includes('File was deleted') || html.includes('deleted')) return null;
  const m =
    html.match(/player\.src\(\s*\[\s*\{\s*src:\s*["']([^"']+)["']/) ||
    html.match(/src:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/);
  return m ? m[1] : null;
}

async function resolveOkru(url) {
  const response = await get(url, { Referer: url });
  const html = response.data;
  const optionsMatch = html.match(/data-module="OKVideo"[^>]*data-options="([^"]+)"/);
  if (optionsMatch) {
    try {
      const opts = JSON.parse(optionsMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      const videos = (opts && (opts.videos || opts.movie && opts.movie.embedded || {})) || {};
      const urlMap = videos.videos || videos;
      const keys = Object.keys(urlMap);
      if (keys.length) {
        const best = keys.sort((a, b) => Number(b) - Number(a))[0];
        const direct = urlMap[best];
        if (direct && /^(https?:)?\/\//.test(direct)) return direct;
      }
    } catch (e) {
      log('Okru', `JSON de options invalido: ${e.message}`);
    }
  }
  const m3u8 = html.match(/https?:\/\/[^"'\s]+\.m3u8[^"'\s]*/);
  return m3u8 ? m3u8[0] : null;
}

const EXTERNAL_RESOLVERS = {
  streamtape: resolveStreamtape,
  doodstream: resolveDoodstream,
  voe: resolveVoe,
  streamwish: resolveStreamwish,
  vidhide: resolveVidhide,
  mixdrop: resolveMixdrop,
  mp4upload: resolveMp4upload,
  okru: resolveOkru,
};

async function resolveExternal(server, remoteUrl, referer) {
  const fn = EXTERNAL_RESOLVERS[server.toLowerCase()];
  if (!fn) {
    log(server, `resolver no implementado, se omite`);
    return null;
  }
  return fn(remoteUrl, referer);
}

/* ------------------------------------------------------------------ */
/* Deteccion de calidad (SPS H.264 / playlists HLS)                    */
/* ------------------------------------------------------------------ */

class BitReader {
  constructor(buffer) {
    this.buffer = buffer;
    this.bytePos = 0;
    this.bitPos = 0;
  }
  readBit() {
    if (this.bytePos >= this.buffer.length) return 0;
    const bit = (this.buffer[this.bytePos] >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return bit;
  }
  readBits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | this.readBit();
    return v;
  }
  ue() {
    let zeros = 0;
    while (this.readBit() === 0) zeros++;
    if (zeros > 31) return 0;
    return (1 << zeros) - 1 + this.readBits(zeros);
  }
  se() {
    const codeNum = this.ue();
    return codeNum & 1 ? (codeNum + 1) / 2 : -(codeNum / 2);
  }
}

const HIGH_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

function skipScalingList(reader, size) {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const delta = reader.se();
      nextScale = (lastScale + delta + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

function parseSps(sps) {
  if (!sps || sps.length < 4) return null;
  const profileIdc = sps[1];
  const reader = new BitReader(sps.subarray(4));
  reader.ue();
  let chromaFormatIdc = 1;
  if (HIGH_PROFILES.includes(profileIdc)) {
    chromaFormatIdc = reader.ue();
    if (chromaFormatIdc === 3) reader.readBit();
    reader.ue();
    reader.ue();
    reader.readBit();
    const seqScalingPresent = reader.readBit();
    if (seqScalingPresent) {
      const count = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < count; i++) {
        if (reader.readBit()) {
          skipScalingList(reader, i < 6 ? 16 : 64);
        }
      }
    }
  }
  reader.ue();
  const picOrderCntType = reader.ue();
  if (picOrderCntType === 0) {
    reader.ue();
  } else if (picOrderCntType === 1) {
    reader.readBit();
    reader.se();
    reader.se();
    const n = reader.ue();
    for (let i = 0; i < n; i++) reader.se();
  }
  reader.ue();
  reader.readBit();
  const widthInMbs = reader.ue() + 1;
  const heightInMapUnits = reader.ue() + 1;
  const frameMbsOnly = reader.readBit();
  if (!frameMbsOnly) reader.readBit();
  reader.readBit();
  const width = widthInMbs * 16;
  const height = (2 - frameMbsOnly) * heightInMapUnits * 16;
  return { width, height };
}

function findSpsInBuffer(buf) {
  for (let i = 0; i < buf.length - 5; i++) {
    if (
      buf[i] === 0 &&
      buf[i + 1] === 0 &&
      (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1)) &&
      (buf[i + 3] === 0x67 || buf[i + 4] === 0x67)
    ) {
      let nalStart;
      if (buf[i + 3] === 0x67) nalStart = i + 3;
      else nalStart = i + 4;
      const dims = parseSps(buf.subarray(nalStart, Math.min(buf.length, nalStart + 64)));
      if (dims && dims.width && dims.height) return dims;
    }
  }
  return null;
}

function findAvcC(buf) {
  const marker = Buffer.from('avcC');
  const idx = buf.indexOf(marker);
  if (idx === -1) return null;
  let p = idx + 4;
  if (p + 7 >= buf.length) return null;
  p += 1;
  const numSps = buf[p + 3] & 0x1f;
  p += 4;
  for (let i = 0; i < numSps; i++) {
    if (p + 2 >= buf.length) return null;
    const len = buf.readUInt16BE(p);
    p += 2;
    if (p + len > buf.length) return null;
    const dims = parseSps(buf.subarray(p, p + len));
    if (dims) return dims;
    p += len;
  }
  return null;
}

function resolveRelative(base, maybeRelative) {
  try {
    return new URL(maybeRelative, base).toString();
  } catch (e) {
    return maybeRelative;
  }
}

async function probeSegmentResolution(segUrl, referer) {
  const response = await get(
    segUrl,
    { Referer: referer || segUrl, Range: 'bytes=0-262143' },
    { responseType: 'arraybuffer', maxContentLength: 3 * 1024 * 1024, timeout: 12000 }
  );
  if (response.status !== 200 && response.status !== 206) return null;
  const buf = Buffer.from(response.data);
  return findSpsInBuffer(buf) || findAvcC(buf);
}

async function probeHls(url, referer) {
  try {
    const response = await get(url, { Referer: referer || url }, { maxContentLength: 5 * 1024 * 1024, timeout: 12000 });
    if (response.status !== 200) return [{ url, height: null }];
    const text = typeof response.data === 'string' ? response.data : Buffer.from(response.data).toString('utf8');
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variants = [];
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
          const res = lines[i].match(/RESOLUTION=(\d+)x(\d+)/);
          const next = lines[i + 1] ? lines[i + 1].trim() : '';
          if (next && !next.startsWith('#')) {
            variants.push({
              url: resolveRelative(url, next),
              height: res ? parseInt(res[2], 10) : null,
            });
          }
        }
      }
      return variants.length ? variants : [{ url, height: null }];
    }
    const seg = text.match(/#EXTINF:[\d.]+,\s*\n?(\S+)/);
    let height = null;
    if (seg) {
      try {
        const dims = await probeSegmentResolution(resolveRelative(url, seg[1]), referer);
        height = dims ? dims.height : null;
      } catch (e) {
        height = null;
      }
    }
    return [{ url, height }];
  } catch (e) {
    return [{ url, height: null }];
  }
}

function qualityLabel(height) {
  if (!height) return 'HD';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  return 'SD';
}

function languageLabel(lang, languages) {
  const label = ((languages[lang] || '') + '').toLowerCase();
  if (label.includes('latino')) return 'Latino';
  if (label.includes('sub') || label.includes('espa')) return 'Sub Español';
  if (String(lang) === '2') return 'Latino';
  return 'Sub Español';
}

/* ------------------------------------------------------------------ */
/* Orquestador                                                         */
/* ------------------------------------------------------------------ */

function makeStream(lang, quality, url, server) {
  const title = `${lang} • ${quality}`;
  return {
    name: 'JKanime',
    title,
    url,
    behaviorHints: { notWebReady: false },
  };
}

async function resolveAll(serverInfo, referer, languages) {
  const streams = [];
  const seen = new Set();

  const playerResults = await Promise.all(
    serverInfo.players.map(async (p) => {
      try {
        const direct = await resolveJkanimePlayer(p.iframeUrl, referer);
        if (!direct) return [];
        let heights = [];
        if (direct.type === 'hls') {
          heights = await probeHls(direct.url, referer);
          if (!heights.some((h) => h.url)) return [];
        } else if (direct.type === 'mp4') {
          if (!(await validateDirect(direct.url, referer))) return [];
          heights = [{ url: direct.url, height: null }];
        }
        const lang = languageLabel(p.lang, languages);
        const out = [];
        for (const variant of heights) {
          if (variant.url) out.push(makeStream(lang, qualityLabel(variant.height), variant.url, p.server));
        }
        return out;
      } catch (e) {
        log(p.server, `fallo al resolver player: ${e.message}`);
        return [];
      }
    })
  );

  for (const list of playerResults) {
    for (const s of list) {
      const key = s.url.split('?')[0];
      if (seen.has(key)) continue;
      seen.add(key);
      streams.push(s);
    }
  }

  return streams;
}

module.exports = {
  resolveAll,
  resolveJkanimePlayer,
  resolveExternal,
  validateDirect,
  probeHls,
  qualityLabel,
  languageLabel,
};