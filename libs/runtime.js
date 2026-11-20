/* Visu-Erweiterung für Symcon: Laufzeit im Fenster der Visualisierung (Vertrag 2).
 *
 * Das Modul „Visu-Erweiterung“ liefert diese Datei als erstes Skript aus, mit den Angaben des Geräts
 * an der Stelle der Konfiguration. Sie hält den einen Kanal zu Symcon (WebSocket am Hook des Moduls)
 * und stellt ihn den Skripten der angedockten Module bereit:
 *
 *   (window.visuExtReady = window.visuExtReady || []).push(function (ext) {
 *     ext.on(INSTANZ, function (daten) { … });      // Nachrichten des eigenen Moduls
 *     ext.send(INSTANZ, { … });                     // an das eigene Modul (Aktion „Event“)
 *   });
 *
 * Die Reihenfolge, in der die Skripte laufen, ist nicht festgelegt: deshalb die Warteliste.
 *
 * Gemessen (Symcon 9.1, 20.11.2026): Symcon meldet einer Seite weder Ping noch Trennung, und Connect
 * trennt nach 120 s ohne Daten. Deshalb das Lebenszeichen: bleibt die Antwort aus, baut die Laufzeit
 * die Verbindung neu auf.
 *
 * Dazu der Rücksprung zur Startseite (Einstellung je Gerät im Modul, C.home und Nachricht „cfg“):
 * nach der eingestellten Zeit ohne Berührung, Taste oder Mausrad zurück auf die Startseite. Die
 * Visualisierung führt ihre Seite im Adress-Anhang (#/…); gewechselt wird über diesen Anhang.
 */
(function () {
  'use strict';
  var C = /*VISUEXT*/null;
  var w = window;
  if (!C || w.top !== w) return;
  if (w.visuExt && w.visuExt.v) return; // doppelt geladen

  var RETRY = [1, 2, 5, 10, 30]; // Sekunden bis zum nächsten Versuch
  var handlers = {}, stateHandlers = [], queue = [];
  var ws = null, open = false, stopped = false, tries = 0, beatTimer = null, retryTimer = null, lastAnswer = 0;

  function call(fn, a) {
    try { fn(a); } catch (e) { setTimeout(function () { throw e; }, 0); }
  }
  function page() {
    return (location.pathname + location.hash).slice(0, 200);
  }
  function raw(message) {
    try { ws.send(JSON.stringify(message)); return true; } catch (e) { return false; }
  }
  function setOpen(value) {
    if (open === value) return;
    open = value;
    stateHandlers.slice().forEach(function (fn) { call(fn, value); });
  }

  function lost() {
    if (beatTimer) { clearInterval(beatTimer); beatTimer = null; }
    var old = ws;
    ws = null;
    if (old) { old.onopen = old.onmessage = old.onclose = old.onerror = null; try { old.close(); } catch (e) { /* schon zu */ } }
    setOpen(false);
    if (stopped || retryTimer) return;
    var delay = RETRY[Math.min(tries, RETRY.length - 1)] * 1000;
    tries++;
    retryTimer = setTimeout(function () { retryTimer = null; connect(); }, delay);
  }

  function beat() {
    // Zweieinhalb Takte ohne Antwort: die Verbindung ist tot, auch wenn der Browser sie offen zeigt
    if (Date.now() - lastAnswer > C.beat * 2500) { lost(); return; }
    raw({ t: 'beat', page: page() });
  }

  function onMessage(text) {
    var m;
    try { m = JSON.parse(text); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;
    lastAnswer = Date.now();
    switch (m.t) {
      case 'welcome':
        tries = 0;
        if (typeof m.name === 'string') api.device.name = m.name;
        setOpen(true);
        queue.splice(0).forEach(raw);
        break;
      case 'unknown': // Symcon kennt die Sitzung nicht mehr (Modul neu geladen): neu anmelden
        setOpen(false);
        raw({ t: 'hello', d: C.device.id, c: C.channel, page: page() });
        break;
      case 'denied': // Gerät entfernt oder gesperrt: nicht weiter versuchen
        stopped = true;
        lost();
        break;
      case 'cfg': // Einstellungen des Geräts aus dem Modul, auch nachträglich geändert
        setHome(m.home);
        break;
      case 'msg':
        (handlers[String(m.m)] || []).slice().forEach(function (fn) { call(fn, m.data); });
        break;
    }
  }

  function connect() {
    if (stopped || ws) return;
    var socket;
    try { socket = new WebSocket(location.origin.replace(/^http/, 'ws') + C.hook); } catch (e) { lost(); return; }
    ws = socket;
    socket.onopen = function () {
      lastAnswer = Date.now();
      raw({ t: 'hello', d: C.device.id, c: C.channel, page: page() });
      beatTimer = setInterval(beat, C.beat * 1000);
    };
    socket.onmessage = function (ev) { if (socket === ws && typeof ev.data === 'string') onMessage(ev.data); };
    socket.onclose = function () { if (socket === ws) lost(); };
    socket.onerror = function () { /* onclose folgt */ };
  }

  var api = {
    v: C.v,
    device: { id: C.device.id, name: C.device.name },
    /** true, solange der Kanal steht und das Gerät angemeldet ist. */
    connected: function () { return open; },
    /** Schickt Daten an das eigene Modul. Ohne Kanal wartet die Nachricht (höchstens 50), Rückgabe false. */
    send: function (module, data) {
      var message = { t: 'ev', m: Number(module), data: data === undefined ? null : data };
      if (open) return raw(message);
      if (queue.length < 50) queue.push(message);
      return false;
    },
    /** Meldet einen Empfänger für Nachrichten des Moduls an; die Rückgabe meldet ihn wieder ab. */
    on: function (module, fn) {
      var key = String(module), list = handlers[key] || (handlers[key] = []);
      list.push(fn);
      return function () { var i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
    },
    /** Ruft fn(true/false), wenn der Kanal steht bzw. abreißt; sofort, falls er schon steht. */
    onState: function (fn) {
      stateHandlers.push(fn);
      if (open) call(fn, true);
    }
  };

  // ── Rücksprung zur Startseite ──
  var startPage = page(); // die Seite, mit der die Visualisierung geladen wurde
  var home = { ms: 0, page: '' }, homeTimer = null, lastActivity = 0;

  function homeTarget() {
    return home.page || startPage;
  }
  function goHome() {
    homeTimer = null;
    var target = homeTarget();
    if (page() === target) return;
    var i = target.indexOf('#'), path = i < 0 ? target : target.slice(0, i);
    if (path === location.pathname) location.hash = i < 0 ? '' : target.slice(i);
    else location.assign(target);
  }
  function armHome() {
    if (homeTimer) { clearTimeout(homeTimer); homeTimer = null; }
    if (home.ms > 0) homeTimer = setTimeout(goHome, home.ms);
  }
  function setHome(h) {
    var minutes = h && typeof h.minutes === 'number' && h.minutes > 0 ? Math.min(h.minutes, 1440) : 0;
    var target = h && typeof h.page === 'string' && h.page.charAt(0) === '/' && h.page.charAt(1) !== '/' ? h.page.slice(0, 200) : '';
    if (home.ms === minutes * 60000 && home.page === target) return; // unverändert: die laufende Frist bleibt
    home = { ms: minutes * 60000, page: target };
    armHome();
  }
  function activity() {
    var now = Date.now();
    if (now - lastActivity < 1000) return; // die Frist höchstens einmal je Sekunde neu stellen
    lastActivity = now;
    armHome();
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (name) {
    w.addEventListener(name, activity, { capture: true, passive: true });
  });
  setHome(C.home);

  // Zurück im Vordergrund oder wieder im Netz: nicht auf den nächsten Versuch warten
  function wake() {
    if (stopped || open || ws) return;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    connect();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) wake(); });
  w.addEventListener('online', wake);

  var waiting = Array.isArray(w.visuExtReady) ? w.visuExtReady : [];
  w.visuExt = api;
  w.visuExtReady = { push: function (fn) { if (typeof fn === 'function') call(fn, api); } };
  waiting.forEach(function (fn) { w.visuExtReady.push(fn); });
  connect();
})();
