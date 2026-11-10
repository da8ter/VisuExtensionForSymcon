/* Visu-Erweiterung für Symcon: Einrichtung. Verbindungen stehen in chrome.storage.local unter
 * `connections` als [{url, name}] (nicht synchronisiert: die Adresse enthält den Schlüssel des Moduls). */
(function () {
  'use strict';
  var core = globalThis.VisuExt, SCRIPT_ID = 'visu-ext';
  var liste = document.getElementById('liste'), meldung = document.getElementById('meldung'), feld = document.getElementById('adresse');
  var verbindungen = [];

  function t(key, wert) { return chrome.i18n.getMessage(key, wert === undefined ? [] : [String(wert)]) || key; }
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
  Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) { el.placeholder = t(el.getAttribute('data-i18n-placeholder')); });
  document.documentElement.lang = chrome.i18n.getUILanguage();

  function muster(url) { return new URL(url).origin + '/*'; }
  function alleMuster() {
    return verbindungen.map(function (c) { return muster(c.url); }).filter(function (m, i, a) { return a.indexOf(m) === i; });
  }

  /** Beschreibung abrufen. Ergebnis {ok, name, scripts, info} oder {ok:false, grund}. */
  function abrufen(url) {
    return fetch(url, { cache: 'no-store', credentials: 'omit' }).then(function (res) {
      if (!res.ok) return { ok: false, grund: t('stHttp', res.status) };
      return res.json().then(function (data) {
        var m = core.checkManifest(data, new URL(url).origin);
        return m.ok ? m : { ok: false, grund: t(m.error === 'script' ? 'stForeign' : 'stInvalid') };
      }, function () { return { ok: false, grund: t('stInvalid') }; });
    }, function () { return { ok: false, grund: t('stUnreachable') }; });
  }

  /** Inhaltsskript auf genau den eingetragenen Servern anmelden, übrige Freigaben zurückgeben. */
  function anmelden() {
    var m = alleMuster();
    return chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(function () { /* noch keins */ }).then(function () {
      if (m.length) return chrome.scripting.registerContentScripts([{ id: SCRIPT_ID, matches: m, js: ['core.js', 'inject.js'], runAt: 'document_idle' }]);
    }).then(function () {
      return chrome.permissions.getAll();
    }).then(function (p) {
      var alt = (p.origins || []).filter(function (o) { return m.indexOf(o) < 0; });
      if (alt.length) return chrome.permissions.remove({ origins: alt });
    });
  }
  function speichern() {
    return chrome.storage.local.set({ connections: verbindungen }).then(anmelden);
  }

  function status(el, c) {
    el.className = 'status';
    el.textContent = t('stChecking');
    abrufen(c.url).then(function (m) {
      if (!m.ok) { el.className = 'status fehler'; el.textContent = m.grund; return; }
      if (m.name !== c.name) { c.name = m.name; chrome.storage.local.set({ connections: verbindungen }); zeichnen(); return; }
      if (!m.scripts.length) { el.className = 'status fehler'; el.textContent = m.info || t('stNoScripts'); return; }
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
      name.textContent = c.name || t('optUnnamed');
      var u = new URL(c.url);
      ort.textContent = u.origin + u.pathname; // ohne den Schlüssel
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
    var a = core.parseAddress(feld.value);
    if (!a.ok) { meldung.textContent = t('errAddress'); return; }
    if (verbindungen.some(function (c) { return c.url === a.url; })) { meldung.textContent = t('errDuplicate'); return; }
    // Muss direkt im Klick passieren: Chrome fragt den Zugriff auf genau diesen Server ab.
    chrome.permissions.request({ origins: [a.origin + '/*'] }).then(function (ok) {
      if (!ok) { meldung.textContent = t('errPermission'); return; }
      return abrufen(a.url).then(function (m) {
        if (!m.ok) {
          meldung.textContent = t('errNoManifest', m.grund);
          return anmelden(); // gibt die eben erteilte Freigabe zurück, wenn sie sonst niemand braucht
        }
        verbindungen.push({ url: a.url, name: m.name });
        feld.value = '';
        return speichern().then(zeichnen);
      });
    }).catch(function (e) { meldung.textContent = String((e && e.message) || e); });
  });

  chrome.storage.local.get('connections').then(function (r) {
    verbindungen = Array.isArray(r.connections) ? r.connections.filter(function (c) { return c && core.parseAddress(c.url).ok; }) : [];
    zeichnen();
  });
})();
