const manifest = {
  id: 'net.kuroneko.stremio',
  version: '1.0.0',
  name: 'Kuroneko',
  description:
    'Streams de anime desde JKanime.net (Sub Español y Latino) y AnimeJara (Castellano). Usa IDs IMDB (tt...) o Kitsu (kitsu:ID).',
  types: ['series', 'movie'],
  resources: ['stream'],
  catalogs: [],
  idPrefixes: ['tt', 'kitsu:'],
  behaviorHints: { configurable: false, global: true },
};

module.exports = { manifest };