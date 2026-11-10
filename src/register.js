/* Visu-Erweiterung für Symcon: Inhaltsskripte auf genau den eingetragenen Servern anmelden.
 * Geladen von der Einrichtung und vom Hintergrunddienst. Schnittstelle: globalThis.VisuExtRegister.
 *
 * Zwei Skripte je Server, weil Chrome sie verschieden behandelt:
 *   inject.js  im Fenster der Seite (MAIN): hängt die Skripte der Module an. Nur dort gilt die
 *              Sicherheitsrichtlinie der Seite; im abgeschotteten Bereich der Erweiterung lässt Chrome
 *              Skripte nur von localhost und 127.0.0.1 zu.
 *   bridge.js  im abgeschotteten Bereich (ISOLATED): liest die Verbindungen aus chrome.storage, holt
 *              und prüft die Beschreibungen und reicht die Skript-Adressen an inject.js weiter, das
 *              auf chrome.storage keinen Zugriff hat.
 * Keine Datei in beiden Anmeldungen: Chrome führt sie sonst nur in einem der Bereiche aus (gemessen
 * mit Chrome 157: core.js lief im Fenster der Seite nicht).
 */
(function (root) {
  'use strict';

  function muster(connections) {
    var m = [];
    (connections || []).forEach(function (c) {
      var u;
      try { u = new URL(c.url); } catch (e) { return; }
      var p = u.origin + '/*';
      if (m.indexOf(p) < 0) m.push(p);
    });
    return m;
  }

  /** Meldet alles ab und für die Verbindungen neu an; gibt Freigaben für nicht mehr eingetragene Server zurück. */
  function anmelden(connections) {
    var m = muster(connections);
    return chrome.scripting.unregisterContentScripts().catch(function () { /* nichts angemeldet */ }).then(function () {
      if (!m.length) return;
      return chrome.scripting.registerContentScripts([
        { id: 'visu-ext-main', matches: m, js: ['inject.js'], runAt: 'document_idle', world: 'MAIN' },
        { id: 'visu-ext-bridge', matches: m, js: ['core.js', 'bridge.js'], runAt: 'document_idle', world: 'ISOLATED' }
      ]);
    }).then(function () {
      return chrome.permissions.getAll();
    }).then(function (p) {
      var alt = (p.origins || []).filter(function (o) { return m.indexOf(o) < 0; });
      if (alt.length) return chrome.permissions.remove({ origins: alt }).catch(function () { /* fest erteilte Freigabe */ });
    });
  }

  root.VisuExtRegister = anmelden;
})(typeof globalThis !== 'undefined' ? globalThis : this);
