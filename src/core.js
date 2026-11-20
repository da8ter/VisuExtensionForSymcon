/* Visu-Erweiterung für Symcon: Prüfregeln für Adresse, Kopplung, Verbindung und Beschreibung (Vertrag 2).
 * Reine Funktionen ohne Chrome-Schnittstellen; geladen von der Einrichtung, vom Inhaltsskript und
 * von den Tests. Schnittstelle: globalThis.VisuExt. */
(function (root) {
  'use strict';
  var CONTRACT = 2, MAX_SCRIPTS = 16, HOOK = '/hook/visuext';
  var ID = /^[A-Za-z0-9_-]{4,64}$/, KEY = /^[A-Za-z0-9_-]{16,256}$/;

  function text(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  /** Adresse, unter der die Visualisierung geöffnet wird → Server (Ursprung). Ohne Schema gilt http. */
  function parseServer(value) {
    var v = typeof value === 'string' ? value.trim() : '', u;
    if (!v) return { ok: false, error: 'address' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = 'http://' + v;
    try { u = new URL(v); } catch (e) { return { ok: false, error: 'address' }; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password || !u.hostname) return { ok: false, error: 'address' };
    return { ok: true, origin: u.origin };
  }

  /** Kopplungscode: sechs Ziffern, Leerzeichen und Striche zählen nicht. */
  function parseCode(value) {
    var c = typeof value === 'string' ? value.replace(/[\s-]+/g, '') : '';
    return /^\d{6}$/.test(c) ? { ok: true, code: c } : { ok: false, error: 'code' };
  }

  /** Gespeicherte Verbindung prüfen: {origin, id, key, name, server} oder null. */
  function checkConnection(c) {
    if (!c || typeof c !== 'object') return null;
    var s = parseServer(c.origin);
    if (!s.ok || s.origin !== c.origin || !ID.test(c.id) || !KEY.test(c.key)) return null;
    return { origin: c.origin, id: c.id, key: c.key, name: text(c.name, 40), server: text(c.server, 100) };
  }

  /** Antwort auf das Koppeln prüfen: {ok, id, key, name} oder {ok:false, error}. */
  function checkPairing(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.ok !== true) return { ok: false, error: 'format' };
    if (data.visuExtension !== CONTRACT) return { ok: false, error: 'contract' };
    var d = data.device;
    if (!d || typeof d !== 'object' || !ID.test(d.id) || !KEY.test(data.key)) return { ok: false, error: 'format' };
    return { ok: true, id: d.id, key: data.key, name: text(d.name, 40) };
  }

  /** Adresse eines Hooks auf einem Symcon-Server: http(s), Pfad unter /hook/, ohne Zugangsdaten. */
  function hookUrl(value, base) {
    var u;
    try { u = new URL(value, base); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return null;
    if (!/^\/hook\/[^/]/.test(u.pathname)) return null;
    u.hash = '';
    return u;
  }

  /** Beschreibung prüfen. `origin` ist der Server der Verbindung: Skripte müssen dort unter /hook/
   *  liegen, alles andere wird abgelehnt (nicht übergangen). */
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
    var d = data.device && typeof data.device === 'object' ? data.device : {};
    return { ok: true, name: name, version: version, info: text(data.info, 300), device: { id: text(d.id, 64), name: text(d.name, 40) }, scripts: scripts };
  }

  /** Anfragen an den Hook. Der Schlüssel reist im Rumpf, nie in der Adresse (Symcon protokolliert Adressen);
   *  als Text gesendet, damit der Browser keine Voranfrage stellt. */
  function pairRequest(origin, code, name) {
    return { url: origin + HOOK + '?k=pair', init: { method: 'POST', body: JSON.stringify({ code: code, name: name }), cache: 'no-store', credentials: 'omit' } };
  }
  function manifestRequest(c) {
    return { url: c.origin + HOOK + '?k=ext', init: { method: 'POST', body: JSON.stringify({ d: c.id, key: c.key }), cache: 'no-store', credentials: 'omit' } };
  }

  root.VisuExt = { CONTRACT: CONTRACT, MAX_SCRIPTS: MAX_SCRIPTS, HOOK: HOOK, parseServer: parseServer, parseCode: parseCode,
    checkConnection: checkConnection, checkPairing: checkPairing, checkManifest: checkManifest, pairRequest: pairRequest, manifestRequest: manifestRequest };
})(typeof globalThis !== 'undefined' ? globalThis : this);
