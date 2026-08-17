const axios = require('axios');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeaders(headers) {
    const setCookies = headers && headers['set-cookie'];
    if (!setCookies) return;
    const list = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const sc of list) {
      const parts = String(sc).split(';');
      const pair = parts[0];
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.cookies.set(name, value);
    }
  }

  toHeader() {
    const parts = [];
    for (const [k, v] of this.cookies.entries()) parts.push(`${k}=${v}`);
    return parts.join('; ');
  }
}

const jar = new CookieJar();

function baseConfig(extraHeaders = {}) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
    'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  };
  Object.assign(headers, extraHeaders);
  const cookie = jar.toHeader();
  if (cookie) headers.Cookie = cookie;
  return { headers, timeout: 20000, maxRedirects: 5, validateStatus: () => true };
}

function saveResponseCookies(response) {
  jar.setFromHeaders(response.headers);
}

async function get(url, extraHeaders = {}, options = {}) {
  const config = baseConfig(extraHeaders);
  Object.assign(config, options);
  const response = await axios.get(url, config);
  saveResponseCookies(response);
  return response;
}

async function post(url, body, extraHeaders = {}, options = {}) {
  const config = baseConfig(extraHeaders);
  Object.assign(config, options);
  const response = await axios.post(url, body, config);
  saveResponseCookies(response);
  return response;
}

module.exports = { get, post, jar, USER_AGENT };