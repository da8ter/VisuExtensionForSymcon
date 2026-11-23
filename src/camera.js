/* Visu-Erweiterung für Symcon: Kamera als Bewegungsmelder, im Offscreen-Dokument der Erweiterung.
 * Hier und nicht in der Visualisierung, weil der Browser die Kamera nur sicheren Seiten gibt; eine
 * Visualisierung über http ist keine, die Seiten der Erweiterung schon. Kein Bild verlässt dieses
 * Dokument: Weitergegeben wird nur „Bewegung“ und der Zustand der Kamera.
 * Sparsam: kleines Bild, höchstens 5 Bilder je Sekunde von der Kamera, 3 Vergleiche je Sekunde. */
(function () {
  'use strict';
  var M = globalThis.VisuExtMotion;
  var level = 2, stream = null, video = null, ctx = null, prev = null, loop = null, lastSent = 0, retry = null;

  function say(o) { o.from = 'camera'; chrome.runtime.sendMessage(o).catch(function () { /* Hintergrund startet gerade */ }); }

  function stop() {
    if (loop) { clearInterval(loop); loop = null; }
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    prev = null;
  }

  function look() {
    if (!video || video.readyState < 2) return;
    ctx.drawImage(video, 0, 0, M.W, M.H);
    var cur = M.gray(ctx.getImageData(0, 0, M.W, M.H).data);
    var n = M.changed(prev, cur);
    prev = cur;
    var now = Date.now();
    if (M.isMotion(n, level) && now - lastSent >= 1000) { lastSent = now; say({ motion: true }); }
  }

  function start() {
    retry = null;
    stop();
    navigator.mediaDevices.getUserMedia({ audio: false, video: { width: { ideal: 160 }, height: { ideal: 120 }, frameRate: { ideal: 5, max: 5 } } }).then(function (s) {
      stream = s;
      video = video || document.createElement('video');
      video.muted = true;
      video.srcObject = s;
      video.play().catch(function () { /* spielt trotzdem */ });
      ctx = ctx || new OffscreenCanvas(M.W, M.H).getContext('2d', { willReadFrequently: true });
      s.getVideoTracks().forEach(function (t) { t.onended = function () { fail('nocam'); }; }); // Kamera abgezogen
      loop = setInterval(look, 333);
      say({ cam: 'ok' });
    }, function (e) {
      var name = e && e.name;
      fail(name === 'NotAllowedError' ? 'denied' : name === 'NotFoundError' || name === 'OverconstrainedError' ? 'nocam' : 'error');
    });
  }

  function fail(state) {
    stop();
    say({ cam: state });
    // Ohne Freigabe nicht weiter versuchen: Die Einrichtung startet neu, wenn sie erteilt wird.
    if (state !== 'denied' && !retry) retry = setTimeout(start, 60000);
  }

  chrome.runtime.onMessage.addListener(function (m) {
    if (!m || m.to !== 'camera') return;
    if (m.level === 1 || m.level === 2 || m.level === 3) level = m.level;
  });
  // Lebenszeichen: hält den Hintergrunddienst wach, solange die Kamera läuft
  setInterval(function () { say({ alive: true }); }, 20000);
  chrome.runtime.sendMessage({ from: 'camera', hello: true }).then(function (r) {
    if (r && (r.level === 1 || r.level === 2 || r.level === 3)) level = r.level;
  }).catch(function () {}).then(start);
})();
