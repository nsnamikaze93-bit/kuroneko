// Utilidades para describir respuestas HTTP en logs y mensajes de error,
// sin volcar contenido completo ni cabeceras sensibles (cookies, tokens).

const PROTECTION_RE =
  /just a moment|cf-browser-verification|challenge-platform|__cf_chl|ddos-guard|checking your browser|attention required/i;

function htmlTitle(html) {
  const m = String(html).match(/<title[^>]*>([^<]{0,120})/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

function looksLikeProtection(response) {
  const data = response && response.data;
  if (typeof data !== 'string') return false;
  return PROTECTION_RE.test(data.slice(0, 20000));
}

function describeResponse(response) {
  if (!response) return 'sin respuesta';
  const h = response.headers || {};
  const data = response.data;
  const parts = [`HTTP ${response.status}`];
  if (h['content-type']) parts.push(`content-type=${String(h['content-type']).split(';')[0]}`);
  if (h.server) parts.push(`server=${h.server}`);
  if (h['cf-ray']) parts.push('cloudflare');
  if (typeof data === 'string') {
    parts.push(`${data.length} chars`);
    const title = htmlTitle(data);
    if (title) parts.push(`title="${title}"`);
    if (looksLikeProtection(response)) parts.push('posible página anti-bot');
  } else if (data && typeof data === 'object') {
    parts.push(`json claves=[${Object.keys(data).slice(0, 8).join(',')}]`);
  } else {
    parts.push('cuerpo vacío');
  }
  return parts.join(', ');
}

// Lanza un error descriptivo si la respuesta no es utilizable.
function assertUsableResponse(source, url, response) {
  if (response.status !== 200) {
    throw new Error(`${source}: petición fallida a ${url} (${describeResponse(response)})`);
  }
  if (looksLikeProtection(response)) {
    throw new Error(`${source}: respuesta de protección anti-bot en ${url} (${describeResponse(response)})`);
  }
}

module.exports = { describeResponse, assertUsableResponse, looksLikeProtection, htmlTitle };
