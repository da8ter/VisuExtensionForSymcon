/* Visu-Erweiterung für Symcon: läuft auf den eingerichteten Servern im obersten Fenster der
 * Visualisierung. Holt je Verbindung die Beschreibung des Moduls und hängt dessen Skripte an.
 * Der Code der Module kommt immer vom Modul, hier wird nichts davon gepflegt. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (/^\/(console|hook)(\/|$)/.test(location.pathname)) return;
  var core = globalThis.VisuExt;
  if (!core || !globalThis.chrome || !chrome.storage) return;
  var geladen = {};

  // Einzige Stelle, an der Code eines Moduls in die Seite kommt.
  function anhaengen(src) {
    if (geladen[src]) return;
    geladen[src] = true;
    var s = document.createElement('script');
    s.src = src;
    s.onload = s.onerror = function () { s.onload = s.onerror = null; s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  chrome.storage.local.get('connections', function (r) {
    ((r && r.connections) || []).forEach(function (c) {
      var a = core.parseAddress(c && c.url);
      if (!a.ok || a.origin !== location.origin) return;
      fetch(a.url, { cache: 'no-store', credentials: 'same-origin' })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
          var m = data ? core.checkManifest(data, location.origin) : null;
          if (m && m.ok) m.scripts.forEach(anhaengen);
        })
        .catch(function () { /* Server nicht erreichbar oder keine Beschreibung: nichts laden */ });
    });
  });
})();
