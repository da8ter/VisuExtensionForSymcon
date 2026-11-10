/* Vorlage: Start-Skript eines Moduls für die „Visu-Erweiterung für Symcon“.
 *
 * Die Erweiterung hängt dieses Skript einmal je Laden der Visualisierung als <script src> ins
 * oberste Fenster. Der Hook des Moduls setzt vorher die Konfiguration ein (siehe
 * VisuExtensionExample.php). Drei Regeln:
 *   1. Doppeltes Laden vertragen (Merker am Fenster).
 *   2. Nichts über den Aufbau der Visualisierung voraussetzen: Sie ist keine zugesicherte
 *      Schnittstelle von Symcon. Eigene Elemente an document.body hängen, fremde nicht anfassen.
 *   3. Eigene Namen eindeutig halten (Globale, CSS-Klassen, localStorage-Schlüssel).
 */
(function () {
  'use strict';
  var C = /*CONFIG*/null; // vom Hook eingesetzt: {instance, hook, name}
  var w = window, d = document;
  if (!C || w.top !== w) return;

  // 1. Je Instanz nur einmal starten.
  var laufend = w.__visuExtExample || (w.__visuExtExample = {});
  if (laufend[C.instance]) return;
  laufend[C.instance] = true;

  // Die eigentliche Arbeit des Moduls. Hier: ein kurzer Hinweis unten rechts.
  function hinweis(text) {
    var el = d.createElement('div');
    el.textContent = text; // nie innerHTML mit Texten aus Symcon
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;padding:10px 14px;border-radius:12px;' +
      'background:rgba(0,0,0,.8);color:#fff;font:14px/1.4 system-ui,sans-serif';
    d.body.appendChild(el);
    w.setTimeout(function () { el.remove(); }, 4000);
  }
  hinweis(C.name + ': verbunden');

  /* Optional: Font-Awesome-Icons aus Symcons /icons.js über den geteilten Platz window.__symconIcons
   * ({v, fa, css, fehler}). Wer ihn zuerst braucht, legt ihn an; alle anderen benutzen ihn mit. So
   * läuft die 3 MB große Datei einmal im Fenster der Visualisierung statt in jedem Modul. */
  function icons(fertig) {
    var slot = w.__symconIcons;
    if (!slot) {
      if (w.FontAwesome || w.FontAwesomeConfig) return; // die Visualisierung bringt selbst etwas mit: nicht anfassen
      slot = w.__symconIcons = { v: 1, fa: null, css: '', fehler: false };
      // Ohne diese Schalter würde Font Awesome Elemente der Visualisierung ersetzen.
      w.FontAwesomeConfig = { autoReplaceSvg: false, observeMutations: false, autoAddCss: false };
      var s = d.createElement('script');
      s.src = '/icons.js';
      s.onload = function () {
        s.onload = s.onerror = null;
        if (w.FontAwesome && w.FontAwesome.dom) { slot.css = w.FontAwesome.dom.css(); slot.fa = w.FontAwesome; } else slot.fehler = true;
      };
      s.onerror = function () { s.onload = s.onerror = null; slot.fehler = true; };
      (d.head || d.documentElement).appendChild(s);
    }
    var versuche = 0;
    (function warten() {
      if (slot.fa) fertig(slot.fa);
      else if (!slot.fehler && ++versuche <= 100) w.setTimeout(warten, 100);
    })();
  }
  // Aufruf: icons(function (fa) { var def = fa.findIconDefinition({ prefix: 'fal', iconName: 'bell' });
  //                               var svg = def ? fa.icon(def).html.join('') : ''; });
  void icons;
})();
