'use strict';

/**
 * Canales cuyos derechos de emisión en internet se sirven únicamente desde el
 * reproductor oficial de su grupo audiovisual.
 *
 * Estos canales no se emiten como HLS libre, así que en lugar de recurrir a
 * fuentes de terceros la aplicación abre la web oficial en directo dentro de
 * la propia ventana. Sin intermediarios y sin saltarse ninguna protección.
 */
const OFFICIAL_CHANNELS = [
  { id: 'web:atresmedia:antena3', name: 'Antena 3', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/antena3/' },
  { id: 'web:atresmedia:lasexta', name: 'laSexta', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/lasexta/' },
  { id: 'web:atresmedia:neox', name: 'Neox', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/neox/' },
  { id: 'web:atresmedia:nova', name: 'Nova', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/nova/' },
  { id: 'web:atresmedia:mega', name: 'Mega', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/mega/' },
  { id: 'web:atresmedia:atreseries', name: 'Atreseries', group: 'Atresmedia', url: 'https://www.atresplayer.com/directos/atreseries/' },
  { id: 'web:mediaset:telecinco', name: 'Telecinco', group: 'Mediaset', url: 'https://www.mitele.es/directo/telecinco/' },
  { id: 'web:mediaset:cuatro', name: 'Cuatro', group: 'Mediaset', url: 'https://www.mitele.es/directo/cuatro/' },
  { id: 'web:mediaset:fdf', name: 'FDF', group: 'Mediaset', url: 'https://www.mitele.es/directo/fdf/' },
  { id: 'web:mediaset:boing', name: 'Boing', group: 'Mediaset', url: 'https://www.mitele.es/directo/boing/' },
  { id: 'web:mediaset:divinity', name: 'Divinity', group: 'Mediaset', url: 'https://www.mitele.es/directo/divinity/' },
  { id: 'web:mediaset:energy', name: 'Energy', group: 'Mediaset', url: 'https://www.mitele.es/directo/energy/' },
  { id: 'web:mediaset:bemad', name: 'Be Mad', group: 'Mediaset', url: 'https://www.mitele.es/directo/bemad/' },
];

/** Orden en el que aparecen los grupos de canales oficiales. */
const OFFICIAL_GROUPS = ['Atresmedia', 'Mediaset'];

/**
 * @returns {Array<object>} canales oficiales normalizados con la misma forma
 *   que los canales HLS, más el campo `officialUrl`.
 */
function officialChannels() {
  return OFFICIAL_CHANNELS.map((channel) => ({
    id: channel.id,
    name: channel.name,
    logo: '',
    group: channel.group,
    kind: 'web',
    officialUrl: channel.url,
    sources: [],
  }));
}

module.exports = { OFFICIAL_CHANNELS, OFFICIAL_GROUPS, officialChannels };
