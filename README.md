# Kuroneko

Addon de [Stremio](https://stremio.com) que agrega streams de anime desde **JKanime.net** (Sub Español y Latino) y **AnimeJara** (Castellano).

## Características

- Busca el anime por su nombre (IMDB/Cinemeta o Kitsu) y resuelve el episodio solicitado en ambas fuentes.
- Soporta temporadas y series continuas (p. ej. One Piece) con offset de episodios vía Cinemeta.
- Detecta resolución real de streams HLS (1080p/720p/...) leyendo el SPS del vídeo.
- Cache en memoria con límite (LRU) para búsquedas, páginas y APIs (Kitsu/Cinemeta).

## Requisitos

- Node.js >= 18

## Instalación y uso local

```bash
npm install
npm start
```

El addon corre en `http://localhost:7000`. Agrégalo en Stremio:

1. Abre Stremio → **Addons**.
2. **Add addon** → pega `http://localhost:7000/manifest.json`.

### IDs aceptados

- **IMDB**: `tt<id>:<temporada>:<episodio>` (ej. `tt31975847:2:1`).
- **Kitsu**: `kitsu:<animeId>:<episodio>` (ej. `kitsu:47481:5`).
- **Películas**: tipo `movie` con id IMDB `tt<id>`.

## Despliegue en Render

1. Sube el repo a GitHub y conecta el servicio en Render (tipo *Web Service*).
2. Configura el build: `npm install`, y el start: `npm start`.
3. Tras cada `push`, haz **Manual Deploy → Deploy latest commit** (o activa auto-deploy).
4. Usa la URL resultante como manifest en Stremio: `https://<tu-app>.onrender.com/manifest.json`.

> Si después de un deploy sigues viendo resultados viejos en Stremio, desinstala y vuelve a instalar el addon (o reinicia Stremio) para limpiar la caché.

## Tests

```bash
npm test
```

Cubre el parseo de IDs, la puntuación de coincidencias de título (incluye regresiones de falsos positivos entre animes), la selección por temporada y la caché.

## Nota legal

Este proyecto solo indexa y enlaza contenido ya disponible públicamente en los sitios de origen. No aloja ningún archivo de vídeo. Úsalo respetando las leyes de tu país y los términos de los servicios de origen.