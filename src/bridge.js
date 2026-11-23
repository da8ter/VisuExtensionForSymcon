/* Visu-Erweiterung für Symcon: läuft im abgeschotteten Bereich der Erweiterung (ISOLATED).
 * Liest die Verbindung dieses Servers aus chrome.storage, holt die Beschreibung vom Modul
 * „Visu-Erweiterung“ (Vertrag 2), prüft sie (core.js) und reicht die zulässigen Skript-Adressen an
 * inject.js im Fenster der Seite weiter. Dazu der Weg des Bewegungsmelders zwischen Laufzeit und Hintergrund (unten). Der Geräteschlüssel bleibt in diesem Bereich. Übergabe als Text über DOM-Ereignisse; die Reihenfolge der beiden Skripte ist nicht
 * festgelegt, deshalb fragt jede Seite einmal nach der anderen (ask/ready). */
(function () {
  'use strict';
  if (window.top !== window) return;
  if (/^\/(console|hook)(\/|$)/.test(location.pathname)) return;
  var core = globalThis.VisuExt;
  if (!core || !globalThis.chrome || !chrome.storage) return;
  var bereit = false, wartend = [], geprueft = false; // geprueft: Symcon hat dieses Gerät mit Schlüssel bestätigt

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
          if (m && m.ok && m.scripts.length) { geprueft = true; senden(m.scripts); kamera(); }
        })
        .catch(function () { /* Server nicht erreichbar oder keine Beschreibung: nichts laden */ });
    });
  });
  document.dispatchEvent(new CustomEvent('visu-ext:ask'));

  // ── Bewegungsmelder: Die Laufzeit nennt die Einstellung aus Symcon, die Einrichtung die Zustimmung
  // an diesem Gerät (chrome.storage „camera“). Nur wenn beides stimmt, hält die Brücke einen Port zum
  // Hintergrund; solange ein Port offen ist, läuft die Kamera. Zurück kommt nur „Bewegung“ und der Zustand.
  var will = { on: false, level: 2 }, erlaubt = false, port = null;

  function melden(o) { document.dispatchEvent(new CustomEvent('visu-ext:motion', { detail: JSON.stringify(o) })); }
  function kamera() {
    // Nur auf einer Seite, für die Symcon die Beschreibung mit dem Geräteschlüssel geliefert hat (dort läuft die Laufzeit)
    if (!(will.on && erlaubt && geprueft)) {
      if (port) { var p = port; port = null; p.disconnect(); }
      if (will.on && geprueft) melden({ t: 'cam', state: 'blocked' }); // in Symcon an, an diesem Gerät nicht erlaubt
      return;
    }
    if (!port) {
      port = chrome.runtime.connect({ name: 'camera' });
      port.onMessage.addListener(function (m) {
        if (m && m.motion === true) melden({ t: 'motion' });
        else if (m && typeof m.cam === 'string') melden({ t: 'cam', state: m.cam });
      });
      port.onDisconnect.addListener(function () {
        port = null;
        setTimeout(kamera, 1000); // Hintergrunddienst neu gestartet: wieder verbinden, wenn noch gewollt
      });
    }
    port.postMessage({ level: will.level });
  }
  document.addEventListener('visu-ext:camera', function (ev) {
    var m;
    try { m = JSON.parse(ev.detail); } catch (e) { return; }
    will = { on: !!(m && m.on === true), level: m && (m.level === 1 || m.level === 3) ? m.level : 2 };
    kamera();
  });
  chrome.storage.local.get('camera', function (r) { erlaubt = !!(r && r.camera === true); kamera(); });
  chrome.storage.onChanged.addListener(function (c, bereich) {
    if (bereich === 'local' && c.camera) { erlaubt = c.camera.newValue === true; kamera(); }
  });
  document.dispatchEvent(new CustomEvent('visu-ext:camera-ask'));
})();
