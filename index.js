const express = require('express');
const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const { manifest } = require('./manifest');
const { defineStreamHandler } = require('./handlers/streams');

const PORT = process.env.PORT || 7000;

const builder = new addonBuilder(manifest);
builder.defineStreamHandler(defineStreamHandler);

const addonInterface = builder.getInterface();

const app = express();

app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use((req, res, next) => {
  console.log(`[req] ${req.method} ${req.originalUrl} from ${req.headers.origin || req.headers.referer || 'n/a'}`);
  res.on('finish', () => {
    console.log(`[res] ${req.method} ${req.originalUrl} -> ${res.statusCode}`);
  });
  next();
});

app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

app.use(getRouter(addonInterface));

app.post('/manifest.json', (req, res) => {
  res.json(manifest);
});

app.post('/:resource/:type/:id.json', async (req, res) => {
  try {
    const resp = await addonInterface.get(req.params.resource, req.params.type, req.params.id, {});
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Internal error' });
  }
});

app.post('/:resource/:type/:id/:extra.json', async (req, res) => {
  try {
    const resp = await addonInterface.get(req.params.resource, req.params.type, req.params.id, {});
    res.json(resp);
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : 'Internal error' });
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    hint: `Prueba con /manifest.json o /stream/{type}/{id}.json (ej: /stream/series/kitsu:12:1.json)`,
  });
});

app.use((err, req, res, next) => {
  console.error('[server] Error:', err && err.message);
  res.status(500).json({ error: err && err.message ? err.message : 'Internal error' });
});

const server = app.listen(PORT, () => {
  console.log(`JKanime addon corriendo en http://localhost:${PORT}/manifest.json`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`El puerto ${PORT} ya esta en uso.`);
    console.error('Deten la otra instancia (p. ej. cierra la terminal donde corra "npm start")');
    console.error(`y vuelve a ejecutar: npm start`);
    process.exit(1);
  }
  console.error('[server] Error al iniciar:', err.message);
  process.exit(1);
});