// Hintergrunddienst: öffnet die Einrichtung, meldet nach einer neuen Fassung die Inhaltsskripte neu an
// und betreibt den Bewegungsmelder: Solange eine Visualisierung ihn will (Port „camera“ von bridge.js),
// läuft die Kamera im Offscreen-Dokument camera.html; dessen Meldungen gehen an alle diese Tabs.
importScripts('core.js', 'register.js');

chrome.runtime.onInstalled.addListener(function (info) {
  if (info.reason === 'install') chrome.runtime.openOptionsPage();
  // Die Anmeldung der Inhaltsskripte überlebt ein Update mit dem alten Stand: aus den Verbindungen neu aufbauen.
  chrome.storage.local.get('connections').then(function (r) {
    var liste = Array.isArray(r.connections) ? r.connections.map(VisuExt.checkConnection).filter(Boolean) : [];
    return VisuExtRegister(liste);
  }).catch(function () { /* beim nächsten Speichern in der Einrichtung */ });
});
chrome.action.onClicked.addListener(function () { chrome.runtime.openOptionsPage(); });

// ── Bewegungsmelder ──
var ports = new Map(), camState = '', busy = Promise.resolve(), closeTimer = null;

function level() {
  var l = 0;
  ports.forEach(function (v) { if (v > l) l = v; });
  return l || 2;
}
// Nacheinander, damit sich Öffnen und Schließen nicht überholen
function queue(fn) { busy = busy.then(fn).catch(function () { /* nächster Versuch beim nächsten Anlass */ }); return busy; }
function open(restart) {
  return queue(function () {
    return chrome.offscreen.hasDocument().then(function (has) {
      if (has && !restart) return chrome.runtime.sendMessage({ to: 'camera', level: level() }).catch(function () {});
      return (has ? chrome.offscreen.closeDocument() : Promise.resolve()).then(function () {
        camState = '';
        return chrome.offscreen.createDocument({ url: 'camera.html', reasons: ['USER_MEDIA'], justification: 'Motion detection for the Symcon visualization' });
      });
    });
  });
}
function update() {
  if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
  if (ports.size) { open(false); return; }
  // Kurz warten: Beim Neuladen der Visualisierung kommt der Tab gleich wieder
  closeTimer = setTimeout(function () {
    closeTimer = null;
    if (!ports.size) queue(function () { return chrome.offscreen.hasDocument().then(function (has) { camState = ''; if (has) return chrome.offscreen.closeDocument(); }); });
  }, 3000);
}
function toTabs(m) { ports.forEach(function (v, p) { try { p.postMessage(m); } catch (e) { /* Tab weg */ } }); }

chrome.runtime.onConnect.addListener(function (port) {
  if (port.name !== 'camera' || !port.sender || !port.sender.tab) return;
  ports.set(port, 2);
  port.onMessage.addListener(function (m) {
    if (!m || !(m.level === 1 || m.level === 2 || m.level === 3)) return;
    ports.set(port, m.level);
    update();
  });
  port.onDisconnect.addListener(function () { ports.delete(port); update(); });
  if (camState) port.postMessage({ cam: camState });
});

chrome.runtime.onMessage.addListener(function (m, sender, reply) {
  if (!m || sender.id !== chrome.runtime.id) return;
  if (m.from === 'camera') {
    if (m.hello) { reply({ level: level() }); return; }
    if (typeof m.cam === 'string') { camState = m.cam; toTabs({ cam: m.cam }); }
    if (m.motion === true) toTabs({ motion: true });
    if (!ports.size && !closeTimer) update(); // Hintergrund war neu gestartet und kennt keinen Tab mehr; eine laufende Frist nicht verlängern
    return;
  }
  // Die Einrichtung hat die Freigabe geändert: Kamera neu starten bzw. beenden
  if (m.to === 'background' && m.camera === 'changed') {
    if (ports.size) open(true); else update();
  }
});
