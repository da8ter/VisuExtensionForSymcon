/* Visu-Erweiterung für Symcon: Einrichtung. Verbindungen stehen in chrome.storage.local unter
 * `connections` als [{origin, id, key, name, server}], eine je Server (nicht synchronisiert: der
 * Eintrag enthält den Schlüssel dieses Browsers). */
(function () {
  'use strict';
  var core = globalThis.VisuExt;
  var liste = document.getElementById('liste'), meldung = document.getElementById('meldung');
  var feldAdresse = document.getElementById('adresse'), feldCode = document.getElementById('code'), feldName = document.getElementById('name');
  var verbindungen = [];

  function t(key, wert) { return chrome.i18n.getMessage(key, wert === undefined ? [] : [String(wert)]) || key; }
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  document.documentElement.lang = chrome.i18n.getUILanguage();

  /** Anfrage an den Hook. Ergebnis {status, data}; status 0 = nicht erreichbar, data null = kein JSON. */
  function hole(anfrage) {
    return fetch(anfrage.url, anfrage.init).then(function (res) {
      return res.json().then(function (data) { return { status: res.status, data: data }; }, function () { return { status: res.status, data: null }; });
    }, function () { return { status: 0, data: null }; });
  }

  /** Beschreibung abrufen. Ergebnis {ok, name, version, device, scripts} oder {ok:false, grund}. */
  function abrufen(c) {
    return hole(core.manifestRequest(c)).then(function (r) {
      if (r.status === 0) return { ok: false, grund: t('stUnreachable') };
      if (r.status === 403) return { ok: false, grund: t('stDenied') };
      if (r.status !== 200) return { ok: false, grund: t('stHttp', r.status) };
      var m = core.checkManifest(r.data, c.origin);
      return m.ok ? m : { ok: false, grund: t(m.error === 'script' ? 'stForeign' : 'stInvalid') };
    });
  }

  // Inhaltsskripte auf genau den eingetragenen Servern anmelden, übrige Freigaben zurückgeben (register.js).
  function anmelden() { return globalThis.VisuExtRegister(verbindungen); }
  function speichern() {
    return chrome.storage.local.set({ connections: verbindungen }).then(anmelden);
  }

  function status(el, c) {
    el.className = 'status';
    el.textContent = t('stChecking');
    abrufen(c).then(function (m) {
      if (!m.ok) { el.className = 'status fehler'; el.textContent = m.grund; return; }
      var name = m.device.name || c.name;
      if (m.name !== c.server || name !== c.name) { c.server = m.name; c.name = name; chrome.storage.local.set({ connections: verbindungen }); zeichnen(); return; }
      el.className = 'status ok';
      el.textContent = t('stConnected') + (m.version ? ' · ' + m.version : '');
    });
  }

  function knopf(text, klick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.addEventListener('click', klick);
    return b;
  }

  function zeichnen() {
    liste.textContent = '';
    if (!verbindungen.length) {
      var leer = document.createElement('div');
      leer.className = 'leer';
      leer.textContent = t('optEmpty');
      liste.appendChild(leer);
      return;
    }
    verbindungen.forEach(function (c, i) {
      var zeile = document.createElement('div'), haupt = document.createElement('div');
      var name = document.createElement('div'), ort = document.createElement('div'), st = document.createElement('div');
      zeile.className = 'zeile'; haupt.className = 'haupt'; name.className = 'name'; ort.className = 'ort';
      name.textContent = c.server || t('optUnnamed');
      ort.textContent = c.origin + (c.name ? ' · ' + t('optDevice', c.name) : ''); // nie der Schlüssel
      haupt.appendChild(name); haupt.appendChild(ort); haupt.appendChild(st);
      zeile.appendChild(haupt);
      zeile.appendChild(knopf(t('optCheck'), function () { status(st, c); }));
      zeile.appendChild(knopf(t('optRemove'), function () {
        verbindungen.splice(i, 1);
        speichern().then(zeichnen);
      }));
      liste.appendChild(zeile);
      status(st, c);
    });
  }

  document.getElementById('neu').addEventListener('submit', function (ev) {
    ev.preventDefault();
    meldung.textContent = '';
    var server = core.parseServer(feldAdresse.value), code = core.parseCode(feldCode.value);
    if (!server.ok) { meldung.textContent = t('errAddress'); return; }
    if (!code.ok) { meldung.textContent = t('errCode'); return; }
    if (verbindungen.some(function (c) { return c.origin === server.origin; })) { meldung.textContent = t('errDuplicate'); return; }
    // Muss direkt im Klick passieren: Chrome fragt den Zugriff auf genau diesen Server ab.
    chrome.permissions.request({ origins: [server.origin + '/*'] }).then(function (ok) {
      if (!ok) { meldung.textContent = t('errPermission'); return; }
      return hole(core.pairRequest(server.origin, code.code, feldName.value.trim())).then(function (r) {
        var p = r.status === 200 ? core.checkPairing(r.data) : null;
        if (!p || !p.ok) {
          meldung.textContent = t('errNoManifest', r.status === 0 ? t('stUnreachable') : r.status === 403 ? t('errPairDenied')
            : r.status === 404 ? t('errPairMissing') : r.status === 200 ? t('stInvalid') : t('stHttp', r.status));
          return anmelden(); // gibt die eben erteilte Freigabe zurück, wenn sie sonst niemand braucht
        }
        verbindungen.push({ origin: server.origin, id: p.id, key: p.key, name: p.name, server: '' });
        feldCode.value = '';
        feldName.value = '';
        return speichern().then(zeichnen);
      });
    }).catch(function (e) { meldung.textContent = String((e && e.message) || e); });
  });

  chrome.storage.local.get('connections').then(function (r) {
    // Einträge einer früheren Fassung (Vertrag 1) passen nicht mehr und fallen hier weg.
    verbindungen = Array.isArray(r.connections) ? r.connections.map(core.checkConnection).filter(Boolean) : [];
    zeichnen();
    // Anmeldung der Inhaltsskripte bei jedem Öffnen auf den Stand der Liste bringen (z. B. nach einer neuen Fassung).
    return anmelden();
  });
})();
