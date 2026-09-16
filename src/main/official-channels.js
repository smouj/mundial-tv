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
  { id: 'web:atresmedia:antena3', name: 'Antena 3', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/65/Antena_3_2025_%28sin_wordmark%29.svg/250px-Antena_3_2025_%28sin_wordmark%29.svg.png', url: 'https://www.atresplayer.com/directos/antena3/' },
  { id: 'web:atresmedia:lasexta', name: 'laSexta', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/75/LaSexta_2024_Logo.svg/250px-LaSexta_2024_Logo.svg.png', url: 'https://www.atresplayer.com/directos/lasexta/' },
  { id: 'web:atresmedia:neox', name: 'Neox', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/3c/Neox_2023_logo.svg/250px-Neox_2023_logo.svg.png', url: 'https://www.atresplayer.com/directos/neox/' },
  { id: 'web:atresmedia:nova', name: 'Nova', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/1e/Nova.svg/250px-Nova.svg.png', url: 'https://www.atresplayer.com/directos/nova/' },
  { id: 'web:atresmedia:mega', name: 'Mega', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8c/MEGA.svg/250px-MEGA.svg.png', url: 'https://www.atresplayer.com/directos/mega/' },
  { id: 'web:atresmedia:atreseries', name: 'Atreseries', group: 'Atresmedia', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/16/Atreseries_2020_logo.svg/250px-Atreseries_2020_logo.svg.png', url: 'https://www.atresplayer.com/directos/atreseries/' },
  { id: 'web:mediaset:telecinco', name: 'Telecinco', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/13/Telecinco_2024_Logo.svg/250px-Telecinco_2024_Logo.svg.png', url: 'https://www.mitele.es/directo/telecinco/' },
  { id: 'web:mediaset:cuatro', name: 'Cuatro', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/51/Cuatro_2012.png/250px-Cuatro_2012.png', url: 'https://www.mitele.es/directo/cuatro/' },
  { id: 'web:mediaset:fdf', name: 'FDF', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/42/Factor%C3%ADa_de_Ficci%C3%B3n.svg/250px-Factor%C3%ADa_de_Ficci%C3%B3n.svg.png', url: 'https://www.mitele.es/directo/fdf/' },
  { id: 'web:mediaset:boing', name: 'Boing', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/95/Boing_2020.svg/250px-Boing_2020.svg.png', url: 'https://www.mitele.es/directo/boing/' },
  { id: 'web:mediaset:divinity', name: 'Divinity', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e6/Divinity_TV.png/250px-Divinity_TV.png', url: 'https://www.mitele.es/directo/divinity/' },
  { id: 'web:mediaset:energy', name: 'Energy', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/ae/Energy.svg/250px-Energy.svg.png', url: 'https://www.mitele.es/directo/energy/' },
  { id: 'web:mediaset:bemad', name: 'Be Mad', group: 'Mediaset', logo: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7d/BeMad_2022_Logo.svg/250px-BeMad_2022_Logo.svg.png', url: 'https://www.mitele.es/directo/bemad/' },
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
    logo: channel.logo || '',
    group: channel.group,
    kind: 'web',
    officialUrl: channel.url,
    sources: [],
  }));
}

module.exports = { OFFICIAL_CHANNELS, OFFICIAL_GROUPS, officialChannels };
