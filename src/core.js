/* Visu-Erweiterung für Symcon: Prüfregeln für Verbindungsadresse und Beschreibung (Vertrag 1).
 * Reine Funktionen ohne Chrome-Schnittstellen; geladen von der Einrichtung, vom Inhaltsskript und
 * von den Tests. Schnittstelle: globalThis.VisuExt. */
(function (root) {
  'use strict';
  var CONTRACT = 1, MAX_SCRIPTS = 8;

  function text(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  /** Adresse eines Hooks auf einem Symcon-Server: http(s), Pfad unter /hook/, ohne Zugangsdaten. */
  function hookUrl(value, base) {
    var u;
    try { u = base ? new URL(value, base) : new URL(value); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!/^\/hook\/[^/]/.test(u.pathname)) return null;
    u.hash = '';
    return u;
  }

  /** Verbindungsadresse aus der Eingabe. {ok, url, origin} oder {ok:false, error:'address'}. */
  function parseAddress(value) {
    var u = typeof value === 'string' ? hookUrl(value.trim()) : null;
    return u ? { ok: true, url: u.href, origin: u.origin } : { ok: false, error: 'address' };
  }

  /** Beschreibung eines Moduls prüfen. `origin` ist der Server der Verbindungsadresse:
   *  Skripte müssen dort unter /hook/ liegen, alles andere wird abgelehnt (nicht übergangen). */
  function checkManifest(data, origin) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'format' };
    if (data.visuExtension !== CONTRACT) return { ok: false, error: 'contract' };
    var name = text(data.name, 100);
    if (!name) return { ok: false, error: 'name' };
    if (!Array.isArray(data.scripts) || data.scripts.length > MAX_SCRIPTS) return { ok: false, error: 'scripts' };
    var scripts = [];
    for (var i = 0; i < data.scripts.length; i++) {
      var u = typeof data.scripts[i] === 'string' ? hookUrl(data.scripts[i], origin + '/') : null;
      if (!u || u.origin !== origin) return { ok: false, error: 'script' };
      if (scripts.indexOf(u.href) < 0) scripts.push(u.href);
    }
    var version = typeof data.version === 'number' ? String(data.version) : text(data.version, 40);
    return { ok: true, name: name, version: version, info: text(data.info, 300), scripts: scripts };
  }

  root.VisuExt = { CONTRACT: CONTRACT, MAX_SCRIPTS: MAX_SCRIPTS, parseAddress: parseAddress, checkManifest: checkManifest };
})(typeof globalThis !== 'undefined' ? globalThis : this);
