'use strict';

/**
 * Interfaz de Mundial TV.
 *
 * Dos modos de reproducción conviven en la misma ventana:
 *  - `hls`: canales que emiten en HLS público, reproducidos con hls.js.
 *  - `web`: canales que solo emiten desde su reproductor oficial; la web se
 *    muestra en una vista incrustada gestionada por el proceso principal.
 */

const ALL = '__all__';
const FEATURED = '__featured__';
const FAVOURITES = '__favourites__';

/** Orden curado de los canales que se ven al abrir la aplicación. */
const FEATURED_ORDER = [
  'la 1', 'la 2', 'antena 3', 'lasexta', 'telecinco', 'cuatro',
  '24h', 'teledeporte', 'clan', 'trece', 'neox', 'nova', 'mega',
  'fdf', 'boing', 'divinity', 'energy', 'be mad', 'atreseries',
  'el toro tv', 'real madrid tv', '3catinfo', 'euronews', 'rne para todos',
];

/** Orden preferente de los grupos en la barra lateral. */
const GROUP_ORDER = [
  'Generalistas', 'Informativos', 'Deportivos', 'Infantiles',
  'Musicales', 'Religiosos', 'Eventuales', 'Atresmedia', 'Mediaset',
];

const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 90,
  manifestLoadingTimeOut: 12000,
  manifestLoadingMaxRetry: 2,
  levelLoadingTimeOut: 12000,
  fragLoadingTimeOut: 20000,
  fragLoadingMaxRetry: 3,
};

const ATTEMPT_TIMEOUT_MS = 14000;

const state = {
  channels: [],
  meta: {},
  favourites: new Set(),
  group: FEATURED,
  query: '',
  current: null,
  hls: null,
  sourceIndex: 0,
  attemptTimer: null,
  recovered: false,
  mini: false,
  resumed: false,
  pip: false,
  settings: { volume: 1, muted: false, showInternational: false, resumeLast: true, lastChannelId: null },
};

const el = (id) => document.getElementById(id);

const dom = {
  titlebar: document.querySelector('.titlebar'),
  search: el('search'),
  groups: el('groups'),
  playlistNote: el('playlist-note'),
  gridView: el('grid-view'),
  grid: el('grid'),
  viewTitle: el('view-title'),
  viewSub: el('view-sub'),
  empty: el('empty'),
  playerView: el('player-view'),
  playerTitle: el('player-title'),
  playerSub: el('player-sub'),
  playerBadge: el('player-badge'),
  stage: el('stage'),
  video: el('video'),
  webHost: el('web-host'),
  stageMessage: el('stage-message'),
  stageMessageText: el('stage-message-text'),
  stageSpinner: el('stage-spinner'),
  stageIcon: el('stage-icon'),
  retry: el('btn-retry'),
  nextSource: el('btn-next-source'),
  controls: el('controls'),
  play: el('btn-play'),
  iconPlay: el('icon-play'),
  iconPause: el('icon-pause'),
  mute: el('btn-mute'),
  iconVolume: el('icon-volume'),
  iconMuted: el('icon-muted'),
  volume: el('vol'),
  qualityWrap: el('wrap-quality'),
  quality: el('sel-quality'),
  audioWrap: el('wrap-audio'),
  audio: el('sel-audio'),
  subsWrap: el('wrap-subs'),
  subs: el('sel-subs'),
  full: el('btn-full'),
  back: el('btn-back'),
  fav: el('btn-fav'),
  external: el('btn-external'),
  refresh: el('btn-refresh'),
  refresh2: el('btn-refresh-2'),
  about: el('btn-about'),
  aboutDialog: el('about'),
  closeAbout: el('btn-close-about'),
  openRepo: el('btn-open-repo'),
  toggleInt: el('toggle-int'),
  factVersion: el('fact-version'),
  factElectron: el('fact-electron'),
  factChrome: el('fact-chrome'),
  factChannels: el('fact-channels'),
  factUpdated: el('fact-updated'),
  sheetAttribution: el('sheet-attribution'),
  nowPlaying: el('now-playing'),
  nowPlayingName: el('now-playing-name'),
  nowPlayingNote: el('now-playing-note'),
  nowWatch: el('btn-now-watch'),
  nowStop: el('btn-now-stop'),
  remote: el('btn-remote'),
  remoteDialog: el('remote'),
  remoteNote: el('remote-note'),
  remoteUrl: el('remote-url'),
  qrBox: el('qr-box'),
  closeRemote: el('btn-close-remote'),
  copyRemote: el('btn-copy-remote'),
  openRemote: el('btn-open-remote'),
  rotateRemote: el('btn-rotate-remote'),
  mini: el('btn-mini'),
  miniBack: el('btn-mini-back'),
  miniMessage: el('mini-message'),
  toast: el('toast'),
  toggleAds: el('toggle-ads'),
};

/* --- Utilidades ---------------------------------------------------------- */

function fold(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function initials(name) {
  const clean = String(name).replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function hueOf(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) % 360;
  return hash;
}

/** Grupos que la lista marca como internacionales. */
const WORLD_GROUP_LABELS = {
  'Int. Europa': 'Europa',
  'Int. América': 'América',
  'Int. Asia': 'Asia',
  'Int. África': 'África',
  'Int. Otros': 'Otros países',
};

function isWorldGroup(name) {
  return /^Int\./.test(name);
}

function groupLabel(name) {
  return WORLD_GROUP_LABELS[name] || name;
}

function isInternational(channel) {
  return isWorldGroup(channel.group);
}

function channelMatches(channel, query) {
  if (!query) return true;
  return fold(channel.name).includes(query) || fold(channel.group).includes(query);
}

function visibleChannels() {
  const showInt = state.settings.showInternational;
  return state.channels.filter((channel) => showInt || !isInternational(channel));
}

function featuredChannels() {
  const pool = visibleChannels();
  const ranked = [];
  FEATURED_ORDER.forEach((name) => {
    const match = pool.find(
      (channel) => fold(channel.name) === name && !ranked.includes(channel),
    );
    if (match) ranked.push(match);
  });
  return ranked;
}

function sortGroupNames(names) {
  return names.slice().sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a);
    const ib = GROUP_ORDER.indexOf(b);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    const iaInt = isWorldGroup(a);
    const ibInt = isWorldGroup(b);
    if (iaInt !== ibInt) return iaInt ? 1 : -1;
    return a.localeCompare(b, 'es');
  });
}

let toastTimer = null;

/** Aviso breve y no intrusivo en la parte inferior de la ventana. */
function showToast(text) {
  dom.toast.textContent = text;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 3400);
}

function formatDate(timestamp) {
  if (!timestamp) return 'copia incluida en la aplicación';
  try {
    return new Date(timestamp).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

/* --- Barra lateral y rejilla --------------------------------------------- */

function buildGroupModel() {
  const pool = visibleChannels();
  const counts = new Map();
  for (const channel of pool) counts.set(channel.group, (counts.get(channel.group) || 0) + 1);

  const favourites = pool.filter((channel) => state.favourites.has(channel.id));
  const featured = featuredChannels();

  const shortcuts = [
    { id: FEATURED, name: 'Destacados', count: featured.length },
    { id: ALL, name: 'Todos los canales', count: pool.length },
  ];
  if (favourites.length) shortcuts.push({ id: FAVOURITES, name: 'Favoritos', count: favourites.length });

  const official = ['Atresmedia', 'Mediaset'].filter((name) => counts.has(name));
  const names = [...counts.keys()];
  const spain = sortGroupNames(names.filter((name) => !isWorldGroup(name) && !official.includes(name)));
  const world = sortGroupNames(names.filter((name) => isWorldGroup(name)));
  const item = (name) => ({ id: `g:${name}`, name: groupLabel(name), count: counts.get(name) });

  const sections = [
    { label: 'Atajos', items: shortcuts },
    { label: 'España', items: [...official.map(item), ...spain.map(item)] },
  ];
  if (world.length) sections.push({ label: 'Resto del mundo', items: world.map(item) });

  return { sections, flat: sections.flatMap((section) => section.items) };
}

function renderSidebar() {
  const { sections } = buildGroupModel();
  dom.groups.textContent = '';

  for (const section of sections) {
    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = section.label;
    dom.groups.append(label);

    for (const group of section.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'group-btn';
    if (state.group === group.id) button.classList.add('is-active');

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = group.name;

    const count = document.createElement('span');
    count.className = 'count';
    count.textContent = String(group.count);

    button.append(name, count);
    button.addEventListener('click', () => {
      state.group = group.id;
      state.query = '';
      dom.search.value = '';
      renderSidebar();
      renderGrid();
    });

    dom.groups.append(button);
    }
  }

  const meta = state.meta || {};
  const parts = [`${visibleChannels().length} canales`];
  if (meta.source === 'download') parts.push('lista actualizada');
  else if (meta.source === 'cache' || meta.source === 'cache-stale') parts.push('lista en caché');
  else if (meta.source === 'snapshot') parts.push('lista incluida');
  if (meta.error) parts.push('sin conexión');
  dom.playlistNote.textContent = parts.join(' · ');
}

function makeCard(channel) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card';
  card.dataset.id = channel.id;
  card.title = `${channel.name} — ${channel.group}`;

  const art = document.createElement('span');
  art.className = 'card-art';

  // Solo los canales que se ven desde su reproductor oficial llevan distintivo:
  // marcar los 340 como «en directo» no aportaría nada.
  if (channel.kind === 'web') {
    const badge = document.createElement('span');
    badge.className = 'card-live';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const badgeText = document.createElement('span');
    badgeText.textContent = 'OFICIAL';
    badge.append(dot, badgeText);
    art.append(badge);
  }

  if (channel.logo && /^https:\/\//i.test(channel.logo)) {
    const image = document.createElement('img');
    image.loading = 'lazy';
    image.alt = '';
    image.src = channel.logo;
    image.addEventListener('error', () => {
      image.remove();
      art.append(monogramOf(channel));
    });
    art.append(image);
  } else {
    art.append(monogramOf(channel));
  }

  const name = document.createElement('span');
  name.className = 'card-name';
  name.textContent = channel.name;

  const meta = document.createElement('span');
  meta.className = 'card-meta';
  meta.textContent =
    channel.kind === 'web' ? `${channel.group} · reproductor oficial` : channel.group;

  const fav = document.createElement('button');
  fav.type = 'button';
  fav.className = 'card-fav';
  fav.title = 'Favorito';
  fav.setAttribute('aria-label', 'Marcar como favorito');
  const star = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  star.setAttribute('viewBox', '0 0 16 16');
  const starPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  starPath.setAttribute(
    'd',
    'm8 2.6 1.7 3.6 3.9.5-2.9 2.7.8 3.9L8 11.4l-3.5 1.9.8-3.9-2.9-2.7 3.9-.5Z',
  );
  star.append(starPath);
  fav.append(star);
  if (state.favourites.has(channel.id)) {
    fav.classList.add('is-on');
    starPath.dataset.filled = 'true';
  }
  fav.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleFavourite(channel.id);
  });

  card.append(art, name, meta, fav);
  card.addEventListener('click', () => play(channel));
  return card;
}

function monogramOf(channel) {
  const span = document.createElement('span');
  span.className = 'monogram';
  const hue = hueOf(channel.name);
  span.style.background = `hsl(${hue} 30% 20%)`;
  span.style.color = `hsl(${hue} 58% 74%)`;
  span.style.width = '100%';
  span.style.height = '100%';
  span.style.display = 'flex';
  span.style.alignItems = 'center';
  span.style.justifyContent = 'center';
  span.textContent = initials(channel.name);
  return span;
}

function currentList() {
  const query = fold(state.query);
  const pool = visibleChannels();

  if (query) return pool.filter((channel) => channelMatches(channel, query));

  switch (state.group) {
    case FEATURED:
      return featuredChannels();
    case ALL:
      return pool;
    case FAVOURITES:
      return pool.filter((channel) => state.favourites.has(channel.id));
    default: {
      const group = state.group.replace(/^g:/, '');
      return pool.filter((channel) => channel.group === group);
    }
  }
}

function renderGrid() {
  const list = currentList();
  dom.grid.textContent = '';

  const query = fold(state.query);
  if (query) {
    dom.viewTitle.textContent = 'Resultados';
    dom.viewSub.textContent = `${list.length} para «${state.query.trim()}»`;
  } else {
    const model = buildGroupModel().flat.find((group) => group.id === state.group);
    dom.viewTitle.textContent = model ? model.name : 'Canales';
    dom.viewSub.textContent = `${list.length} canales`;
  }

  const fragment = document.createDocumentFragment();
  for (const channel of list) fragment.append(makeCard(channel));
  dom.grid.append(fragment);

  dom.empty.hidden = list.length > 0;
  renderSidebar();
}

/* --- Favoritos ----------------------------------------------------------- */

async function toggleFavourite(channelId) {
  if (state.favourites.has(channelId)) state.favourites.delete(channelId);
  else state.favourites.add(channelId);
  await window.mundial.saveSettings({ favourites: [...state.favourites] });
  renderGrid();
  updateFavButton();
}

function updateFavButton() {
  const active = Boolean(state.current) && state.favourites.has(state.current.id);
  dom.fav.classList.toggle('is-on', active);
  const path = dom.fav.querySelector('path');
  if (active) path.dataset.filled = 'true';
  else delete path.dataset.filled;
  dom.fav.title = active ? 'Quitar de favoritos' : 'Añadir a favoritos';
}

/* --- Reproductor --------------------------------------------------------- */

function showLoading(text) {
  dom.stage.classList.add('is-loading');
  dom.stageMessage.hidden = false;
  dom.stageSpinner.hidden = false;
  dom.stageIcon.hidden = true;
  dom.stageMessageText.textContent = text;
  dom.retry.hidden = true;
  dom.nextSource.hidden = true;
}

function showError(text, canRetry) {
  dom.stage.classList.remove('is-loading');
  dom.stageMessage.hidden = false;
  dom.stageSpinner.hidden = true;
  dom.stageIcon.hidden = false;
  dom.stageMessageText.textContent = text;
  dom.retry.hidden = !canRetry;
}

function clearStageMessage() {
  dom.stage.classList.remove('is-loading');
  dom.stageMessage.hidden = true;
  dom.stageSpinner.hidden = true;
  dom.retry.hidden = true;
  dom.nextSource.hidden = true;
}

function destroyHls() {
  clearTimeout(state.attemptTimer);
  state.attemptTimer = null;
  if (state.hls) {
    try {
      state.hls.destroy();
    } catch {
      /* ya destruido */
    }
    state.hls = null;
  }
  dom.video.removeAttribute('src');
  try {
    dom.video.load();
  } catch {
    /* sin fuente */
  }
}

async function play(channel) {
  state.current = channel;
  state.sourceIndex = 0;
  state.recovered = false;
  setMiniState(false);

  if (document.pictureInPictureElement) {
    document.exitPictureInPicture().catch(() => {});
  }
  showPlayer();
  dom.playerTitle.textContent = channel.name;
  dom.playerSub.textContent = channel.group;
  dom.playerBadge.textContent = channel.kind === 'web' ? 'Reproductor oficial' : 'HLS';
  document.title = `${channel.name} — Mundial TV`;
  updateFavButton();

  await window.mundial.saveSettings({ lastChannelId: channel.id });
  publishRemoteState();

  if (channel.kind === 'web') playOfficial(channel);
  else playHls(channel);
}

/* --- Canales HLS --------------------------------------------------------- */

function playHls(channel) {
  window.mundial.closeOfficial();
  dom.external.hidden = true;
  dom.stage.classList.remove('is-web');
  dom.webHost.hidden = true;

  const sources = channel.sources || [];
  if (!sources.length) {
    showError('Este canal no tiene ninguna fuente disponible en este momento.', false);
    return;
  }
  attachSource(channel);
}

function setSourceLabel(channel) {
  const sources = channel.sources || [];
  const suffix = sources.length > 1 ? ` · ${state.sourceIndex + 1} de ${sources.length}` : '';
  dom.playerSub.textContent = `${channel.group}${suffix}`;
}

function attachSource(channel) {
  destroyHls();
  const source = channel.sources[state.sourceIndex];
  setSourceLabel(channel);
  showLoading('Conectando con el directo…');

  const Hls = window.Hls;
  if (!Hls || !Hls.isSupported()) {
    showError('Este sistema no puede reproducir el formato de este canal.', false);
    return;
  }

  const hls = new Hls(HLS_CONFIG);
  state.hls = hls;

  state.attemptTimer = setTimeout(() => failover('timeout'), ATTEMPT_TIMEOUT_MS);

  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    clearTimeout(state.attemptTimer);
    state.attemptTimer = null;
    clearStageMessage();
    populateTracks(hls);
    dom.video.play().catch(() => {
      /* la reproducción puede requerir una interacción del usuario */
    });
  });

  hls.on(Hls.Events.LEVEL_SWITCHED, () => {
    const level = hls.levels[hls.currentLevel];
    if (level && state.hls === hls) {
      dom.quality.value = String(hls.autoLevelEnabled ? -1 : hls.currentLevel);
    }
  });

  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (state.hls !== hls) return;
    if (!data.fatal) return;

    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !state.recovered) {
      state.recovered = true;
      try {
        hls.recoverMediaError();
        return;
      } catch {
        /* se intenta la siguiente fuente */
      }
    }
    failover(data.details || data.type);
  });

  hls.loadSource(source.url);
  hls.attachMedia(dom.video);
}

function failover(reason) {
  const channel = state.current;
  if (!channel) return;
  const sources = channel.sources || [];
  const next = state.sourceIndex + 1;

  if (next < sources.length) {
    state.sourceIndex = next;
    attachSource(channel);
    return;
  }

  destroyHls();
  const messages = {
    timeout: 'El canal no responde. Puede estar caído o haber cambiado de dirección.',
    'manifestLoadError': 'No se ha podido cargar la lista de reproducción del canal.',
    'levelLoadError': 'No se ha podido descargar el vídeo del canal.',
  };
  showError(
    messages[reason] || 'No se ha podido reproducir el canal con ninguna de sus fuentes.',
    true,
  );
}

function hasNativeHls() {
  return false;
}

function populateTracks(hls) {
  populateQuality(hls);
  populateAudio(hls);
  populateSubtitles(hls);
}

function fillSelect(select, options, selectedValue) {
  select.textContent = '';
  for (const option of options) {
    const node = document.createElement('option');
    node.value = String(option.value);
    node.textContent = option.label;
    if (String(option.value) === String(selectedValue)) node.selected = true;
    select.append(node);
  }
}

function populateQuality(hls) {
  const levels = hls.levels || [];
  if (levels.length < 2) {
    dom.qualityWrap.hidden = true;
    return;
  }
  const options = [{ value: -1, label: 'Automática' }];
  levels.forEach((level, index) => {
    const height = level.height ? `${level.height}p` : `${Math.round((level.bitrate || 0) / 1000)} kbps`;
    const bitrate = `${Math.round((level.bitrate || 0) / 1000)} kbps`;
    options.push({ value: index, label: `${height} · ${bitrate}` });
  });
  fillSelect(dom.quality, options, hls.autoLevelEnabled ? -1 : hls.currentLevel);
  dom.qualityWrap.hidden = false;
}

function populateAudio(hls) {
  const tracks = hls.audioTracks || [];
  if (tracks.length < 2) {
    dom.audioWrap.hidden = true;
    return;
  }
  const options = tracks.map((track, index) => ({
    value: index,
    label: track.name || track.lang || `Pista ${index + 1}`,
  }));
  fillSelect(dom.audio, options, hls.audioTrack);
  dom.audioWrap.hidden = false;
}

function populateSubtitles(hls) {
  const tracks = hls.subtitleTracks || [];
  if (!tracks.length) {
    dom.subsWrap.hidden = true;
    return;
  }
  const options = [{ value: -1, label: 'Desactivados' }];
  tracks.forEach((track, index) => {
    options.push({ value: index, label: track.name || track.lang || `Pista ${index + 1}` });
  });
  fillSelect(dom.subs, options, hls.subtitleTrack);
  dom.subsWrap.hidden = false;
}

/* --- Canales con reproductor oficial ------------------------------------- */

function playOfficial(channel) {
  destroyHls();
  clearStageMessage();
  dom.stage.classList.add('is-web');
  dom.webHost.hidden = false;
  dom.external.hidden = false;

  const bounds = dom.webHost.getBoundingClientRect();
  window.mundial
    .openOfficial({
      url: channel.officialUrl,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    })
    .then((result) => {
      if (result && result.ok === false) {
        showError(
          'No se ha podido abrir el reproductor oficial. Puedes abrirlo en tu navegador.',
          true,
        );
      }
    });
}

let boundsObserver = null;

function watchWebBounds() {
  if (boundsObserver || typeof ResizeObserver === 'undefined') return;
  boundsObserver = new ResizeObserver(() => updateWebBounds());
  boundsObserver.observe(dom.webHost);
  window.addEventListener('resize', updateWebBounds);
}

function updateWebBounds() {
  if (dom.webHost.hidden) return;
  const bounds = dom.webHost.getBoundingClientRect();
  window.mundial.updateOfficialBounds({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  });
}

/* --- Minirreproductor ---------------------------------------------------- */

/**
 * Deja el canal en una ventana pequeña que se mantiene por encima del resto.
 *
 * En los canales HLS se usa la ventana flotante del propio motor de vídeo, que
 * es la única forma de no duplicar la conexión. En los canales que se ven desde
 * su reproductor oficial se traslada esa misma vista a una ventana aparte.
 */
function setMiniState(active) {
  state.mini = Boolean(active);
  const isWeb = Boolean(state.current && state.current.kind === 'web');

  dom.mini.classList.toggle('is-on', state.mini);
  dom.mini.title = state.mini ? 'Devolverlo a la ventana principal' : 'Minirreproductor siempre visible';
  dom.miniMessage.hidden = !state.mini;
  dom.webHost.hidden = !isWeb || state.mini;

  if (isWeb && !state.mini) updateWebBounds();
}

async function toggleMini() {
  const channel = state.current;
  if (!channel) return;

  if (channel.kind === 'web') {
    const result = await window.mundial.toggleMiniView(!state.mini);
    setMiniState(Boolean(result && result.mini));
    showToast(state.mini ? 'El canal sigue en el minirreproductor.' : 'Canal de vuelta en la ventana principal.');
    return;
  }

  if (!document.pictureInPictureEnabled) {
    showToast('Este equipo no ofrece ventana flotante para este canal.');
    return;
  }

  try {
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await dom.video.requestPictureInPicture();
  } catch {
    showToast('No se ha podido abrir la ventana flotante.');
  }
}

/* --- Navegación ---------------------------------------------------------- */

function showPlayer() {
  dom.playerView.hidden = false;
  dom.gridView.hidden = true;
  dom.nowPlaying.hidden = true;
}

/** Vuelve a la rejilla sin tocar el canal: sigue sonando mientras eliges otro. */
function showGridOnly() {
  dom.playerView.hidden = true;
  dom.gridView.hidden = false;
  document.title = 'Mundial TV';
  renderGrid();
  refreshNowPlaying();
}

/**
 * Deja la rejilla a la vista sin cortar el canal.
 *
 * Los canales que emiten en HLS pasan a la ventana flotante del sistema y, si
 * el equipo no la ofrece, siguen sonando de fondo. Los canales que se ven desde
 * su reproductor oficial se trasladan al minirreproductor.
 */
function leavePlayer() {
  const channel = state.current;
  if (!channel) {
    showGridOnly();
    return;
  }

  if (channel.kind === 'web') {
    window.mundial.toggleMiniView(true).then((result) => {
      setMiniState(Boolean(result && result.mini));
      showGridOnly();
    });
    return;
  }

  if (document.pictureInPictureEnabled && !document.pictureInPictureElement) {
    dom.video.requestPictureInPicture().catch(() => {});
  }
  showGridOnly();
}

/** Detiene el canal actual y deja la rejilla limpia. */
function stopCurrent() {
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  destroyHls();
  setMiniState(false);
  window.mundial.closeOfficial();
  state.current = null;
  dom.stage.classList.remove('is-web');
  dom.webHost.hidden = true;
  dom.nowPlaying.hidden = true;
  publishRemoteState();
  renderGrid();
}

/** Texto de la barra que avisa de que el canal sigue en marcha. */
function refreshNowPlaying() {
  const channel = state.current;
  // La barra solo tiene sentido mientras se elige canal con algo sonando.
  if (!channel || dom.gridView.hidden) {
    dom.nowPlaying.hidden = true;
    return;
  }
  dom.nowPlaying.hidden = false;
  dom.nowPlayingName.textContent = channel.name;
  dom.nowPlayingNote.textContent =
    state.mini || document.pictureInPictureElement
      ? 'en el minirreproductor'
      : 'se sigue oyendo de fondo';
}

/* --- Mando desde el móvil ------------------------------------------------ */

/** Cuenta al proceso principal qué se está viendo, para que lo lea el móvil. */
function publishRemoteState() {
  const channel = state.current;
  const sounding = Boolean(channel) && (channel.kind === 'web' || !dom.video.paused);
  window.mundial.publishRemoteState({
    actual: channel ? channel.id : null,
    nombre: channel ? channel.name : null,
    reproduciendo: sounding,
    volumen: Number(dom.volume.value),
  });
}

/** Órdenes que llegan del teléfono. */
function handleRemoteCommand(command) {
  if (!command || typeof command.accion !== 'string') return;
  const channel = state.current;

  switch (command.accion) {
    case 'canal': {
      const target = state.channels.find((item) => item.id === command.canalId);
      if (target) play(target);
      break;
    }
    case 'pausa':
      if (channel && channel.kind === 'web') window.mundial.controlOfficialPlayback('pausa');
      else dom.video.pause();
      break;
    case 'reanudar':
      if (channel && channel.kind === 'web') window.mundial.controlOfficialPlayback('reanudar');
      else dom.video.play().catch(() => {});
      break;
    case 'detener':
      stopCurrent();
      showGridOnly();
      break;
    case 'volumen': {
      const value = Math.max(0, Math.min(1, Number(command.valor)));
      if (Number.isFinite(value)) {
        dom.volume.value = String(value);
        if (channel && channel.kind === 'web') window.mundial.controlOfficialPlayback('volumen', value);
        applyVolume();
      }
      break;
    }
    default:
      break;
  }
  publishRemoteState();
}

/**
 * Abre un cuadro de diálogo apartando el vídeo oficial, que siempre se dibuja
 * por encima de la página y lo dejaría tapado.
 */
function openSheet(dialog) {
  window.mundial.setOfficialVisible(false);
  dialog.addEventListener('close', () => window.mundial.setOfficialVisible(true), { once: true });
  dialog.showModal();
}

/** Pinta en el cuadro del mando los datos que devuelve el proceso principal. */
function renderRemoteInfo(info) {
  dom.qrBox.textContent = '';
  dom.qrBox.hidden = false;

  if (info && info.qr) {
    const image = document.createElement('img');
    image.alt = 'Código QR para abrir el mando';
    image.src = info.qr;
    dom.qrBox.append(image);
  } else {
    dom.qrBox.hidden = true;
  }

  dom.remoteUrl.textContent = info && info.url ? info.url : '—';
  dom.remoteNote.textContent =
    info && info.running
      ? 'Escanea el código con el móvil, o escribe la dirección en su navegador. El teléfono tiene que estar en la misma red Wi-Fi que este ordenador.'
      : 'El mando no ha podido arrancar. Puede que el puerto esté ocupado por otro programa.';
}

async function openRemoteDialog() {
  let info = null;
  try {
    info = await window.mundial.remoteInfo();
  } catch {
    info = null;
  }
  renderRemoteInfo(info);
  openSheet(dom.remoteDialog);
}

/* --- Ajustes y diálogo --------------------------------------------------- */

async function refreshCatalogue(showFeedback) {
  if (showFeedback) {
    dom.refresh.disabled = true;
    dom.refresh.classList.add('is-on');
  }
  const snapshot = await window.mundial.refresh();
  applyCatalogue(snapshot);
  if (showFeedback) {
    dom.refresh.disabled = false;
    setTimeout(() => dom.refresh.classList.remove('is-on'), 600);
  }
}

function applyCatalogue(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.channels)) return;
  state.channels = snapshot.channels;
  state.meta = snapshot.meta || {};
  renderGrid();
  updateFacts();
  resumeLastChannel();
}

/**
 * Vuelve al último canal visto, una sola vez y solo cuando hay canales de
 * verdad en la lista.
 */
function resumeLastChannel() {
  if (state.resumed || state.current || !state.settings.resumeLast) return;
  if (!state.channels.length) return;
  state.resumed = true;
  const last = state.channels.find((channel) => channel.id === state.settings.lastChannelId);
  if (last) play(last);
}

function updateFacts() {
  dom.factChannels.textContent = String(state.channels.length);
  dom.factUpdated.textContent = formatDate(state.meta.fetchedAt);
  dom.toggleInt.checked = Boolean(state.settings.showInternational);
  dom.toggleAds.checked = Boolean(state.settings.skipAds);
  dom.sheetAttribution.textContent =
    'Las direcciones de los canales proceden del proyecto TDTChannels (LaQuay), publicado bajo licencia Apache-2.0. Antena 3, laSexta, Telecinco, Cuatro y sus canales temáticos se ven desde sus reproductores oficiales. El salto de anuncios no bloquea publicidad: solo pulsa el botón que la propia web ofrece. La aplicación no aloja ni retransmite ningún contenido.';
}

async function applyVolume() {
  const volume = Number(dom.volume.value);
  dom.video.volume = volume;
  dom.video.muted = Boolean(state.settings.muted);
  dom.iconVolume.hidden = Boolean(state.settings.muted) || volume === 0;
  dom.iconMuted.hidden = !dom.iconVolume.hidden;
  dom.mute.title = state.settings.muted ? 'Activar sonido' : 'Silenciar';
  state.settings.volume = volume;
  await window.mundial.saveSettings({ volume, muted: state.settings.muted });
}

/* --- Eventos ------------------------------------------------------------- */

function wireEvents() {
  dom.search.addEventListener('input', () => {
    state.query = dom.search.value;
    renderGrid();
  });

  dom.refresh.addEventListener('click', () => refreshCatalogue(true));
  dom.refresh2.addEventListener('click', () => refreshCatalogue(true));

  dom.back.addEventListener('click', leavePlayer);

  dom.nowWatch.addEventListener('click', async () => {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    }
    if (state.mini) {
      const result = await window.mundial.toggleMiniView(false);
      setMiniState(Boolean(result && result.mini));
    }
    showPlayer();
  });

  dom.nowStop.addEventListener('click', () => {
    stopCurrent();
    showGridOnly();
  });

  dom.remote.addEventListener('click', openRemoteDialog);
  dom.closeRemote.addEventListener('click', () => dom.remoteDialog.close());
  dom.copyRemote.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dom.remoteUrl.textContent);
      showToast('Dirección copiada.');
    } catch {
      showToast('Selecciona la dirección y cópiala a mano.');
    }
  });
  dom.rotateRemote.addEventListener('click', async () => {
    dom.rotateRemote.disabled = true;
    try {
      renderRemoteInfo(await window.mundial.rotateRemote());
      showToast('Clave nueva. El móvil que estaba conectado tendrá que escanear el código otra vez.');
    } catch {
      showToast('No se ha podido generar una clave nueva.');
    }
    dom.rotateRemote.disabled = false;
  });

  dom.openRemote.addEventListener('click', () => {
    const url = dom.remoteUrl.textContent;
    if (/^https?:\/\//i.test(url)) window.mundial.openExternal(url);
  });

  dom.fav.addEventListener('click', () => {
    if (state.current) toggleFavourite(state.current.id);
  });

  dom.mini.addEventListener('click', toggleMini);
  dom.miniBack.addEventListener('click', () => {
    if (state.mini) toggleMini();
  });

  dom.video.addEventListener('enterpictureinpicture', () => {
    state.pip = true;
    dom.mini.classList.add('is-on');
    refreshNowPlaying();
  });
  dom.video.addEventListener('leavepictureinpicture', () => {
    dom.mini.classList.remove('is-on');
    refreshNowPlaying();
    // Si se cierra la ventana flotante mientras se elige canal, se detiene todo.
    if (state.pip && !dom.gridView.hidden && state.current) stopCurrent();
    state.pip = false;
  });

  dom.external.addEventListener('click', () => {
    if (state.current && state.current.officialUrl) {
      window.mundial.openExternal(state.current.officialUrl);
    }
  });

  dom.about.addEventListener('click', () => {
    updateFacts();
    openSheet(dom.aboutDialog);
  });
  dom.closeAbout.addEventListener('click', () => dom.aboutDialog.close());
  dom.openRepo.addEventListener('click', () => window.mundial.openExternal(state.info.repository));

  dom.toggleAds.addEventListener('change', async () => {
    state.settings.skipAds = dom.toggleAds.checked;
    await window.mundial.saveSettings({ skipAds: state.settings.skipAds });
    showToast(
      state.settings.skipAds
        ? 'Se pulsará el botón de saltar anuncio en cuanto aparezca.'
        : 'Salto de anuncios desactivado.',
    );
  });

  dom.toggleInt.addEventListener('change', async () => {
    state.settings.showInternational = dom.toggleInt.checked;
    await window.mundial.saveSettings({ showInternational: state.settings.showInternational });
    if (state.group.startsWith('g:Int.')) state.group = ALL;
    renderGrid();
  });

  dom.play.addEventListener('click', () => {
    if (dom.video.paused) dom.video.play().catch(() => {});
    else dom.video.pause();
  });

  dom.video.addEventListener('play', () => {
    dom.iconPlay.hidden = true;
    dom.iconPause.hidden = false;
    publishRemoteState();
  });
  dom.video.addEventListener('pause', () => {
    dom.iconPlay.hidden = false;
    dom.iconPause.hidden = true;
    publishRemoteState();
  });
  dom.video.addEventListener('error', () => {
    if (state.current && state.current.kind === 'hls') failover('levelLoadError');
  });

  dom.mute.addEventListener('click', async () => {
    state.settings.muted = !state.settings.muted;
    await applyVolume();
  });
  dom.volume.addEventListener('input', () => {
    applyVolume();
    publishRemoteState();
  });

  dom.quality.addEventListener('change', () => {
    if (!state.hls) return;
    state.hls.currentLevel = Number(dom.quality.value);
  });

  dom.audio.addEventListener('change', () => {
    if (!state.hls) return;
    state.hls.audioTrack = Number(dom.audio.value);
  });

  dom.subs.addEventListener('change', () => {
    if (!state.hls) return;
    const value = Number(dom.subs.value);
    state.hls.subtitleDisplay = value >= 0;
    state.hls.subtitleTrack = value;
  });

  dom.full.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else dom.stage.requestFullscreen().catch(() => {});
  });

  dom.retry.addEventListener('click', () => {
    if (!state.current) return;
    if (state.current.kind === 'web') playOfficial(state.current);
    else {
      state.sourceIndex = 0;
      state.recovered = false;
      attachSource(state.current);
    }
  });

  dom.nextSource.addEventListener('click', () => {
    if (state.current) {
      state.sourceIndex = 0;
      playHls(state.current);
    }
  });

  dom.stage.addEventListener('mousemove', () => {
    dom.stage.classList.add('show-controls');
    clearTimeout(dom.stage._hideTimer);
    dom.stage._hideTimer = setTimeout(() => dom.stage.classList.remove('show-controls'), 2400);
  });

  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;

    if (event.key === '/' && !typing) {
      event.preventDefault();
      dom.search.focus();
      return;
    }
    if (event.key === 'Escape' && typing) {
      dom.search.blur();
      return;
    }
    if (typing) return;

    // El mando del móvil está a un atajo de distancia, en cualquier pantalla.
    if (event.key === 'r' || event.key === 'R') {
      event.preventDefault();
      openRemoteDialog();
      return;
    }

    if (dom.playerView.hidden) return;

    switch (event.key) {
      case ' ':
      case 'k':
        event.preventDefault();
        dom.play.click();
        break;
      case 'f':
        dom.full.click();
        break;
      case 'm':
        dom.mute.click();
        break;
      case 'ArrowUp':
        event.preventDefault();
        dom.volume.value = String(Math.min(1, Number(dom.volume.value) + 0.05));
        applyVolume();
        break;
      case 'ArrowDown':
        event.preventDefault();
        dom.volume.value = String(Math.max(0, Number(dom.volume.value) - 0.05));
        applyVolume();
        break;
      default:
        break;
    }
  });
}

/* --- Arranque ------------------------------------------------------------ */

async function boot() {
  state.settings = { ...state.settings, ...((await window.mundial.settings()) || {}) };
  state.favourites = new Set(state.settings.favourites || []);
  state.info = await window.mundial.info();

  dom.volume.value = String(state.settings.volume ?? 1);

  dom.factVersion.textContent = state.info.version;
  dom.factElectron.textContent = state.info.electron;
  dom.factChrome.textContent = state.info.chrome;

  wireEvents();
  watchWebBounds();

  const snapshot = await window.mundial.channels();
  applyCatalogue(snapshot);

  window.mundial.onCatalogue((payload) => applyCatalogue(payload));
  window.mundial.onMiniChange((payload) => setMiniState(Boolean(payload && payload.active)));
  window.mundial.onRemoteCommand((command) => handleRemoteCommand(command));
  window.mundial.onAdSkipped((payload) => {
    const total = payload && payload.total > 1 ? ` (${payload.total} en total)` : '';
    showToast(`Anuncio saltado${total}`);
  });

  await applyVolume();

  resumeLastChannel();
}

document.addEventListener('DOMContentLoaded', boot);
