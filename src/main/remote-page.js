'use strict';

/**
 * Página del mando para el teléfono.
 *
 * Es una única página autocontenida, sin bibliotecas, pensada para verse bien
 * en cualquier móvil: cabecera con lo que suena, controles grandes y lista de
 * canales con sus logotipos. Nada de aquí sale a internet: solo habla con el
 * servidor que la sirve, que vive en la red local.
 *
 * @param {string} token clave de esta sesión, que viaja en la dirección
 * @returns {string} HTML completo
 */
function mobilePage(token) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0f14">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="Mando TV">
<link rel="manifest" href="/manifest.webmanifest?k=${token}">
<link rel="icon" href="/icono-192.png?k=${token}">
<link rel="apple-touch-icon" href="/icono-192.png?k=${token}">
<title>Mando de Mundial TV</title>
<style>
  :root {
    --bg: #0b0f14;
    --surface: #111821;
    --surface-2: #17212d;
    --border: #223040;
    --border-soft: #1a2531;
    --text: #e7eef5;
    --text-soft: #b6c4d2;
    --muted: #8494a4;
    --accent: #f0a53c;
    --live: #e5484d;
    --ok: #46c07a;
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    padding-bottom: calc(20px + env(safe-area-inset-bottom));
    overscroll-behavior-y: contain;
  }
  button { font: inherit; color: var(--text); background: var(--surface); border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
  button:active { background: var(--surface-2); }

  /* --- cabecera --- */
  header {
    position: sticky; top: 0; z-index: 10;
    padding: calc(10px + env(safe-area-inset-top)) 14px 12px;
    background: rgba(14, 20, 27, 0.94);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border-bottom: 1px solid var(--border-soft);
  }
  .marca { display: flex; align-items: center; gap: 9px; min-width: 0; }
  .marca img { width: 26px; height: 26px; border-radius: 7px; display: block; flex: none; }
  .marca span {
    font-weight: 600; letter-spacing: 0.01em;
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .pill {
    flex: none;
    margin-left: auto; display: inline-flex; align-items: center; gap: 6px;
    padding: 3px 10px 3px 8px; border-radius: 999px;
    border: 1px solid var(--border); background: var(--surface);
    font-size: 11.5px; color: var(--text-soft);
  }
  .pill i { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); display: block; }
  .pill.on i { background: var(--ok); }
  .pill.off i { background: var(--live); }

  .ahora {
    display: flex; align-items: center; gap: 12px;
    margin-top: 12px; padding: 10px 12px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
  }
  .ahora .texto { min-width: 0; flex: 1; }
  .ahora .texto b { display: block; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ahora .texto small { color: var(--muted); font-size: 12px; }
  .ahora.sonando .texto small { color: var(--text-soft); }

  .logo {
    width: 46px; height: 34px; flex: none; border-radius: 8px;
    background: #0d131a; display: flex; align-items: center; justify-content: center;
    overflow: hidden; font-size: 12px; font-weight: 600; color: var(--muted);
  }
  .logo img { max-width: 82%; max-height: 78%; object-fit: contain; }

  /* Los botones comparten fila y el volumen va debajo: así nada se sale del
     ancho del teléfono por muy estrecho que sea. */
  .mandos { display: flex; gap: 9px; margin-top: 11px; }
  .mandos button { flex: 1 1 0; min-width: 0; height: 46px; padding: 0 10px; font-weight: 600; }
  .mandos button.principal { background: var(--accent); border-color: var(--accent); color: #241704; }
  .mandos button.principal:active { filter: brightness(0.92); }
  .mandos button[disabled] { opacity: 0.45; }
  .volumen { display: flex; align-items: center; gap: 9px; margin-top: 11px; }
  .volumen svg { width: 17px; height: 17px; flex: none; fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .volumen input { flex: 1 1 auto; width: 100%; min-width: 0; accent-color: var(--accent); height: 34px; }
  .volumen output { flex: none; font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; width: 34px; text-align: right; }

  /* --- buscador y filtros --- */
  .buscador { padding: 12px 14px 0; }
  .buscador input {
    width: 100%; height: 44px; padding: 0 13px;
    background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
    color: var(--text); font-size: 16px; outline: none;
    -webkit-appearance: none; appearance: none;
  }
  .buscador input:focus { border-color: #33465c; }
  .chips { display: flex; gap: 7px; overflow-x: auto; padding: 11px 14px 3px; scrollbar-width: none; }
  .chips::-webkit-scrollbar { display: none; }
  .chip {
    flex: none; height: 32px; padding: 0 13px; border-radius: 999px;
    background: var(--surface); border: 1px solid var(--border);
    color: var(--text-soft); font-size: 13px; white-space: nowrap;
  }
  .chip.activo { background: var(--surface-2); border-color: #3a4d63; color: var(--text); font-weight: 600; }

  /* --- lista --- */
  ul { list-style: none; margin: 0; padding: 8px 8px 8px; }
  li {
    display: flex; align-items: center; gap: 12px;
    padding: 9px 10px; border-radius: 12px; cursor: pointer;
    transition: background 0.12s ease;
  }
  li:active { background: var(--surface-2); }
  li.on { background: var(--surface-2); box-shadow: inset 3px 0 0 var(--accent); }
  li.enviando { opacity: 0.55; }
  li .meta { min-width: 0; flex: 1; }
  li .meta b { display: block; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  li .meta small { color: var(--muted); font-size: 12px; }
  li .marca-vivo { width: 7px; height: 7px; border-radius: 50%; background: var(--live); flex: none; }
  .vacio { padding: 26px 14px; text-align: center; color: var(--muted); }
</style>
</head>
<body>
<header>
  <div class="marca">
    <img src="/icono-192.png?k=${token}" alt="">
    <span>Mando TV</span>
    <em class="pill" id="estado"><i></i><b id="estado-texto">Conectando</b></em>
  </div>

  <div class="ahora" id="ahora">
    <div class="logo" id="ahora-logo">–</div>
    <div class="texto">
      <b id="ahora-nombre">Nada en el ordenador</b>
      <small id="ahora-sub">Toca un canal para ponerlo</small>
    </div>
  </div>

  <div class="mandos">
    <button id="btn-play" class="principal" disabled>Reproducir</button>
    <button id="btn-stop" disabled>Parar</button>
  </div>
  <div class="volumen">
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 6h2.5L9 3.2v9.6L5.5 10H3V6Z"/><path d="M11.4 5.6a3.4 3.4 0 0 1 0 4.8"/></svg>
    <input id="vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volumen">
    <output id="vol-texto">100%</output>
  </div>
</header>

<div class="buscador"><input id="q" type="search" placeholder="Buscar canal" autocomplete="off" spellcheck="false" enterkeyhint="search"></div>
<div class="chips" id="chips"></div>
<ul id="lista"></ul>
<p class="vacio" id="vacio" hidden>Ningún canal coincide.</p>

<script>
(function () {
  'use strict';

  var TOKEN = ${JSON.stringify(token)};
  var canales = [];
  var grupos = [];
  var actual = null;
  var reproduciendo = false;
  var filtroGrupo = '';
  var firma = '';
  var pidiendo = false;
  var vivo = true;

  var el = function (id) { return document.getElementById(id); };

  function cabeceras() {
    return { 'Content-Type': 'application/json', 'X-Clave': TOKEN };
  }

  function pedir(ruta, opciones) {
    opciones = opciones || {};
    opciones.headers = cabeceras();
    opciones.cache = 'no-store';
    return fetch(ruta, opciones).then(function (r) {
      if (!r.ok) throw new Error('respuesta ' + r.status);
      return r.json();
    });
  }

  function comando(accion, datos) {
    var cuerpo = Object.assign({ accion: accion }, datos || {});
    return pedir('/api/comando', { method: 'POST', body: JSON.stringify(cuerpo) });
  }

  function iniciales(nombre) {
    var limpio = String(nombre || '?').replace(/[^\\p{L}\\p{N}\\s]+/gu, ' ').trim();
    var partes = limpio.split(/\\s+/).filter(Boolean);
    if (!partes.length) return '?';
    if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
    return (partes[0][0] + partes[1][0]).toUpperCase();
  }

  function matiz(texto) {
    var h = 0;
    for (var i = 0; i < texto.length; i += 1) h = (h * 31 + texto.charCodeAt(i)) % 360;
    return h;
  }

  function crearLogo(canal) {
    var caja = document.createElement('div');
    caja.className = 'logo';
    if (canal.logo) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.src = canal.logo;
      img.addEventListener('error', function () {
        img.remove();
        pintarIniciales(caja, canal.nombre);
      });
      caja.appendChild(img);
    } else {
      pintarIniciales(caja, canal.nombre);
    }
    return caja;
  }

  function pintarIniciales(caja, nombre) {
    var h = matiz(nombre);
    caja.textContent = iniciales(nombre);
    caja.style.background = 'hsl(' + h + ' 30% 20%)';
    caja.style.color = 'hsl(' + h + ' 58% 74%)';
  }

  function visibles() {
    var texto = (el('q').value || '').toLowerCase();
    return canales.filter(function (c) {
      if (filtroGrupo && c.grupo !== filtroGrupo) return false;
      if (!texto) return true;
      return c.nombre.toLowerCase().indexOf(texto) >= 0 || c.grupo.toLowerCase().indexOf(texto) >= 0;
    });
  }

  function pintarChips() {
    if (el('chips').childElementCount === grupos.length + 1) return;
    el('chips').textContent = '';
    var todos = document.createElement('button');
    todos.className = 'chip' + (filtroGrupo ? '' : ' activo');
    todos.textContent = 'Todos';
    todos.addEventListener('click', function () { filtroGrupo = ''; firma = ''; pintar(); });
    el('chips').appendChild(todos);

    grupos.forEach(function (nombre) {
      var chip = document.createElement('button');
      chip.className = 'chip' + (filtroGrupo === nombre ? ' activo' : '');
      chip.textContent = nombre;
      chip.addEventListener('click', function () {
        filtroGrupo = filtroGrupo === nombre ? '' : nombre;
        firma = '';
        pintar();
      });
      el('chips').appendChild(chip);
    });
  }

  function pintarLista(lista) {
    var contenedor = el('lista');
    contenedor.textContent = '';
    var fragmento = document.createDocumentFragment();

    lista.forEach(function (canal) {
      var fila = document.createElement('li');
      if (canal.id === actual) fila.className = 'on';

      var meta = document.createElement('div');
      meta.className = 'meta';
      var nombre = document.createElement('b');
      nombre.textContent = canal.nombre;
      var grupo = document.createElement('small');
      grupo.textContent = canal.grupo;
      meta.appendChild(nombre);
      meta.appendChild(grupo);

      fila.appendChild(crearLogo(canal));
      fila.appendChild(meta);
      if (canal.id === actual) {
        var punto = document.createElement('span');
        punto.className = 'marca-vivo';
        fila.appendChild(punto);
      }

      fila.addEventListener('click', function () {
        if (fila.classList.contains('enviando')) return;
        fila.classList.add('enviando');
        comando('canal', { canalId: canal.id }).then(function () {
          actual = canal.id;
          firma = '';
          refrescar();
        }).catch(function () {
          fila.classList.remove('enviando');
          marcarEstado(false);
        });
      });

      fragmento.appendChild(fila);
    });

    contenedor.appendChild(fragmento);
    el('vacio').hidden = lista.length > 0;
  }

  function pintarAhora() {
    var canal = null;
    for (var i = 0; i < canales.length; i += 1) {
      if (canales[i].id === actual) { canal = canales[i]; break; }
    }

    el('ahora-logo').textContent = '';
    el('ahora').classList.toggle('sonando', Boolean(canal));

    if (canal) {
      el('ahora-logo').appendChild(crearLogo(canal));
      el('ahora-nombre').textContent = canal.nombre;
      el('ahora-sub').textContent = (reproduciendo ? 'En directo' : 'En pausa') + ' · ' + canal.grupo;
    } else {
      el('ahora-logo').textContent = '–';
      el('ahora-nombre').textContent = 'Nada en el ordenador';
      el('ahora-sub').textContent = 'Toca un canal para ponerlo';
    }

    el('btn-play').textContent = reproduciendo ? 'Pausa' : 'Reproducir';
    el('btn-play').disabled = !canal;
    el('btn-stop').disabled = !canal;
  }

  function pintar() {
    var lista = visibles();
    var marca = filtroGrupo + '|' + el('q').value + '|' + actual + '|' + lista.length;
    pintarChips();
    pintarAhora();
    if (marca === firma) return;
    firma = marca;
    pintarLista(lista);
  }

  function marcarEstado(conectado) {
    el('estado').className = 'pill ' + (conectado ? 'on' : 'off');
    el('estado-texto').textContent = conectado ? 'Conectado' : 'Sin conexión';
  }

  function refrescar() {
    if (pidiendo) return;
    pidiendo = true;
    return pedir('/api/estado').then(function (datos) {
      canales = datos.canales || [];
      grupos = datos.grupos || [];
      actual = datos.actual;
      reproduciendo = Boolean(datos.reproduciendo);
      if (datos.volumen !== null && datos.volumen !== undefined) {
        el('vol').value = datos.volumen;
        el('vol-texto').textContent = Math.round(datos.volumen * 100) + '%';
      }
      marcarEstado(true);
      pintar();
    }).catch(function () {
      marcarEstado(false);
    }).then(function () {
      pidiendo = false;
    });
  }

  el('q').addEventListener('input', pintar);

  el('btn-play').addEventListener('click', function () {
    comando(reproduciendo ? 'pausa' : 'reanudar').then(refrescar).catch(function () { marcarEstado(false); });
  });

  el('btn-stop').addEventListener('click', function () {
    comando('detener').then(refrescar).catch(function () { marcarEstado(false); });
  });

  el('vol').addEventListener('input', function () {
    el('vol-texto').textContent = Math.round(this.value * 100) + '%';
  });

  el('vol').addEventListener('change', function () {
    comando('volumen', { valor: Number(this.value) }).then(refrescar).catch(function () { marcarEstado(false); });
  });

  document.addEventListener('visibilitychange', function () {
    vivo = !document.hidden;
    if (vivo) refrescar();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  }

  refrescar();
  setInterval(function () { if (vivo) refrescar(); }, 2500);
})();
</script>
</body>
</html>
`;
}

module.exports = { mobilePage };
