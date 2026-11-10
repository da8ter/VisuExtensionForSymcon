/* Visu-Erweiterung für Symcon: läuft im Fenster der Seite (MAIN), im obersten Fenster der
 * Visualisierung. Bekommt von bridge.js die geprüften Skript-Adressen der Module und hängt sie an.
 * Der Code der Module kommt immer vom Modul, hier wird nichts davon gepflegt.
 *
 * Warum im Fenster der Seite: Skript-Elemente aus dem abgeschotteten Bereich der Erweiterung prüft
 * Chrome gegen eine eigene Richtlinie, die nur localhost und 127.0.0.1 zulässt. Hier gilt die der Seite.
 * Die Datei steht für sich: eine Datei, die in beiden Anmeldungen vorkommt, führt Chrome nur in
 * einem der beiden Bereiche aus. */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (/^\/(console|hook)(\/|$)/.test(location.pathname)) return;
  if (window.__visuExtLoader) return;
  window.__visuExtLoader = true;
  var geladen = {};

  // Ereignisse kann auch die Seite selbst auslösen: nur Adressen dieses Servers unter /hook/ annehmen.
  function erlaubt(src) {
    var u;
    try { u = new URL(src); } catch (e) { return null; }
    return u.origin === location.origin && /^\/hook\/[^/]/.test(u.pathname) && !u.username && !u.password ? u.href : null;
  }

  // Einzige Stelle, an der Code eines Moduls in die Seite kommt.
  function anhaengen(src) {
    if (geladen[src]) return;
    geladen[src] = true;
    var s = document.createElement('script');
    s.src = src;
    s.onload = s.onerror = function () { s.onload = s.onerror = null; s.remove(); };
    (document.head || document.documentElement).appendChild(s);
  }

  document.addEventListener('visu-ext:scripts', function (ev) {
    var liste;
    try { liste = JSON.parse(ev.detail); } catch (e) { return; }
    if (!Array.isArray(liste)) return;
    liste.forEach(function (src) {
      var adresse = typeof src === 'string' ? erlaubt(src) : null;
      if (adresse) anhaengen(adresse);
    });
  });
  document.addEventListener('visu-ext:ask', function () { document.dispatchEvent(new CustomEvent('visu-ext:ready')); });
  document.dispatchEvent(new CustomEvent('visu-ext:ready'));
})();
