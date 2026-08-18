const axios = require('axios');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers, url) {
    const setCookies = headers && headers['set-cookie'];
    if (!setCookies) return;
    const host = hostOf(url);
    if (!host) return;
    const list = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const sc of list) {
      const parts = String(sc).split(';');
      const pair = parts[0];
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      let domain = host;
      const domAttr = parts.find((p) => /^\s*Domain=/i.test(p));
      if (domAttr) {
        const d = domAttr.replace(/^\s*Domain=/i, '').trim().replace(/^\./, '').toLowerCase();
        if (d) domain = d;
      }
      if (!this.cookies.has(domain)) this.cookies.set(domain, new Map());
      this.cookies.get(domain).set(name, value);
    }
  }

  toHeader(url) {
    const host = hostOf(url);
    if (!host) return '';
    const parts = [];
    for (const [domain, jar] of this.cookies) {
      if (host === domain || host.endsWith('.' + domain)) {
        for (const [k, v] of jar) parts.push(`${k}=${v}`);
      }
    }
    return parts.join('; ');
  }
}

const jar = new CookieJar();

function baseConfig(url, extraHeaders = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  };
  Object.assign(headers, extraHeaders);
  const cookie = jar.toHeader(url);
  if (cookie) headers.Cookie = cookie;
  return { headers, timeout: 20000, maxRedirects: 5, validateStatus: () => true };
}

async function get(url, extraHeaders = {}, options = {}) {
  const config = baseConfig(url, extraHeaders);
  Object.assign(config, options);
  const response = await axios.get(url, config);
  jar.setFromHeaders(response.headers, url);
  return response;
}

async function post(url, body, extraHeaders = {}, options = {}) {
  const config = baseConfig(url, extraHeaders);
  Object.assign(config, options);
  const response = await axios.post(url, body, config);
  jar.setFromHeaders(response.headers, url);
  return response;
}

module.exports = { get, post, jar, USER_AGENT };
