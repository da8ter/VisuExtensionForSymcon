/* Visu-Erweiterung für Symcon: Bewegung in zwei aufeinanderfolgenden Kamerabildern erkennen.
 * Ohne Chrome-Schnittstellen (auch in Node prüfbar), Schnittstelle: globalThis.VisuExtMotion.
 * Verglichen wird ein verkleinertes Graubild (64 × 48). Die mittlere Helligkeit wird vorher
 * herausgerechnet: Ein Wolkenschatten oder die Belichtung der Kamera ändern alle Pixel ein wenig,
 * eine Person nur einen Teil, den aber deutlich. */
(function (root) {
  'use strict';
  var W = 64, H = 48, PIXEL = 25;
  // Anteil der Pixel, die sich deutlich ändern müssen: 1 = gering, 2 = mittel, 3 = hoch empfindlich
  var SHARE = { 1: 0.06, 2: 0.03, 3: 0.012 };

  /** RGBA-Daten (W × H) → Graustufen. */
  function gray(rgba) {
    var out = new Uint8Array(W * H);
    for (var i = 0; i < out.length; i++) out[i] = (rgba[i * 4] * 3 + rgba[i * 4 + 1] * 6 + rgba[i * 4 + 2]) / 10;
    return out;
  }

  /** Zahl der Pixel, die sich über die allgemeine Helligkeitsänderung hinaus deutlich geändert haben. */
  function changed(prev, cur) {
    if (!prev || !cur || prev.length !== cur.length) return 0;
    var sum = 0, i, n = 0;
    for (i = 0; i < cur.length; i++) sum += cur[i] - prev[i];
    var shift = sum / cur.length;
    for (i = 0; i < cur.length; i++) if (Math.abs(cur[i] - prev[i] - shift) > PIXEL) n++;
    return n;
  }

  function isMotion(count, level) {
    return count >= Math.ceil(W * H * (SHARE[level] || SHARE[2]));
  }

  root.VisuExtMotion = { W: W, H: H, gray: gray, changed: changed, isMotion: isMotion };
})(typeof globalThis !== 'undefined' ? globalThis : this);
