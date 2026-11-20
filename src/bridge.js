/* Visu-Erweiterung für Symcon: läuft im abgeschotteten Bereich der Erweiterung (ISOLATED).
 * Liest die Verbindung dieses Servers aus chrome.storage, holt die Beschreibung vom Modul
 * „Visu-Erweiterung“ (Vertrag 2), prüft sie (core.js) und reicht die zulässigen Skript-Adressen an
 * inject.js im Fenster der Seite weiter. Der Geräteschlüssel bleibt in diesem Bereich. Übergabe als Text über DOM-Ereignisse; die Reihenfolge der beiden Skripte ist nicht
 * festgelegt, deshalb fragt jede Seite einmal nach der anderen (ask/ready). */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (/^\/(console|hook)(\/|$)/.test(location.pathname)) return;
  var core = globalThis.VisuExt;
  if (!core || !globalThis.chrome || !chrome.storage) return;
  var bereit = false, wartend = [];

  function senden(scripts) {
    if (!bereit) { wartend.push(scripts); return; }
    document.dispatchEvent(new CustomEvent('visu-ext:scripts', { detail: JSON.stringify(scripts) }));
  }
  document.addEventListener('visu-ext:ready', function () {
    if (bereit) return;
    bereit = true;
    var w = wartend;
    wartend = [];
    w.forEach(senden);
  });

  chrome.storage.local.get('connections', function (r) {
    var geholt = {};
    ((r && r.connections) || []).forEach(function (roh) {
      var c = core.checkConnection(roh);
      if (!c || c.origin !== location.origin || geholt[c.id]) return;
      geholt[c.id] = true;
      var anfrage = core.manifestRequest(c);
      fetch(anfrage.url, anfrage.init)
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          var m = data ? core.checkManifest(data, location.origin) : null;
          if (m && m.ok && m.scripts.length) senden(m.scripts);
        })
        .catch(function () { /* Server nicht erreichbar oder keine Beschreibung: nichts laden */ });
    });
  });
  document.dispatchEvent(new CustomEvent('visu-ext:ask'));
})();
