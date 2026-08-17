const manifest = {
  id: 'net.jkanime.stremio',
  version: '1.0.0',
  name: 'JKanime',
  description:
    'Streams de anime desde JKanime.net (Sub Español y Latino) y AnimeJara (Castellano y Japonés sub). Usa IDs IMDB (tt...) o Kitsu (kitsu:ID).',
  types: ['series', 'movie'],
  resources: ['stream'],
  catalogs: [],
  idPrefixes: ['tt', 'kitsu:'],
  behaviorHints: { configurable: false, global: true },
};

module.exports = { manifest };