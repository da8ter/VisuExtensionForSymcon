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
 *
 * Und der Bildschirmschoner (C.saver, „cfg“, „saver“): eine Ebene über der ganzen Visualisierung,
 * schwarz, mit Uhr oder mit Kunstwerken im Wechsel (C.art: gemeinfreie Gemälde, die Bilder lädt der
 * Browser direkt bei Wikimedia Commons). Eigene Elemente am body liegen über der Visualisierung und fangen Zeiger ab
 * (gemessen 10.11.2026): Die erste Berührung weckt deshalb nur auf und löst in der Visu nichts aus.
 * Abschalten oder dimmen kann eine Seite das Display nicht, nur abdunkeln.
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
        setSaver(m.saver);
        break;
      case 'saver': // aus Symcon: sofort einschalten oder aufwecken
        if (m.on === true) startSaver(); else wakeSaver();
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
    },
    /** Weckt das Gerät aus dem Bildschirmschoner, z. B. wenn ein Modul etwas Wichtiges zeigt. */
    wake: function () { wakeSaver(); }
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
  function activity(ev) {
    if (saverLayer) {
      // Die erste Bedienung weckt nur auf. Zeiger und Finger weckt die Ebene selbst mit dem Ende der
      // Geste (click): fiele sie schon beim Aufsetzen weg, bekäme die Visualisierung den Rest der Geste.
      if (ev && (ev.type === 'keydown' || ev.type === 'wheel')) wakeSaver();
      return;
    }
    var now = Date.now();
    if (now - lastActivity < 1000) return; // die Fristen höchstens einmal je Sekunde neu stellen
    lastActivity = now;
    armHome();
    armSaver();
  }

  // ── Bildschirmschoner ──
  var saver = { ms: 0, mode: 'black', interval: 300000, fill: false }, saverTimer = null, saverLayer = null, saverTick = null;
  var art = Array.isArray(C.art) ? C.art.slice() : [], artIndex = -1, artTimer = null, artShown = null, artFailed = false;

  function armSaver() {
    if (saverTimer) { clearTimeout(saverTimer); saverTimer = null; }
    if (saver.ms > 0 && !saverLayer) saverTimer = setTimeout(startSaver, saver.ms);
  }
  function setSaver(s) {
    var minutes = s && typeof s.minutes === 'number' && s.minutes > 0 ? Math.min(s.minutes, 1440) : 0;
    var next = {
      ms: minutes * 60000,
      mode: s && (s.mode === 'clock' || s.mode === 'art') ? s.mode : 'black',
      interval: (s && typeof s.interval === 'number' && s.interval >= 1 ? Math.min(s.interval, 60) : 5) * 60000,
      fill: !!(s && s.fill === true)
    };
    if (saver.ms === next.ms && saver.mode === next.mode && saver.interval === next.interval && saver.fill === next.fill) return;
    saver = next;
    if (saverLayer) showSaver(); // läuft er gerade, nur den Inhalt wechseln
    else armSaver();
  }
  /* Uhr und Datum; alle Minute neu und an anderer Stelle, damit sich nichts einbrennt. Kunstwerke
     zeigen die Uhr nur, wenn sich kein Bild laden ließ (kein Netz). */
  function drawSaver() {
    if (!saverLayer) return;
    var box = saverLayer.firstChild;
    if (saver.mode === 'black' || (saver.mode === 'art' && art.length && !artFailed)) { box.style.display = 'none'; return; }
    var now = new Date();
    box.style.display = 'block';
    box.firstChild.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    box.lastChild.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
    // innerhalb des Bildschirms bleiben: der Platz hängt von Schriftgröße und Fenster ab
    var freeX = saverLayer.clientWidth - box.offsetWidth, freeY = saverLayer.clientHeight - box.offsetHeight;
    if (freeX > 0 && freeY > 0) {
      box.style.left = Math.floor(Math.random() * freeX) + 'px';
      box.style.top = Math.floor(Math.random() * freeY) + 'px';
    } else {
      box.style.left = Math.floor(Math.random() * 20) + '%';
      box.style.top = Math.floor(Math.random() * 60) + '%';
    }
  }

  /* Kunstwerke: zufällige Reihenfolge, das nächste Bild wird geladen und erst gezeigt, wenn es da
     ist (weiches Überblenden); schlägt das Laden fehl, bleibt das alte Bild oder die Uhr. */
  function artUrl(file) {
    var need = Math.max((w.screen && w.screen.width) || 0, w.innerWidth || 0) * (w.devicePixelRatio || 1);
    var width = need <= 1280 ? 1280 : need <= 1920 ? 1920 : 2560; // feste Stufen: Commons hält sie vor
    return 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(file) + '?width=' + width;
  }
  function artImageStyle() {
    return 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:' + (saver.fill ? 'cover' : 'contain') + ';opacity:0;transition:opacity 1.5s ease;';
  }
  function nextArt() {
    if (!saverLayer || saver.mode !== 'art' || !art.length) return;
    if (artIndex < 0 || artIndex >= art.length - 1) { // neu mischen
      for (var i = art.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = art[i]; art[i] = art[j]; art[j] = t; }
      artIndex = -1;
    }
    var work = art[++artIndex], layer = saverLayer, img = document.createElement('img');
    img.alt = '';
    img.style.cssText = artImageStyle();
    img.onload = function () {
      img.onload = img.onerror = null;
      if (layer !== saverLayer || saver.mode !== 'art') return;
      var old = artShown, caption = layer.lastChild;
      layer.insertBefore(img, caption);
      artShown = img;
      artFailed = false;
      caption.textContent = [work.title, work.artist, work.year].filter(Boolean).join(' · ');
      caption.style.display = 'block';
      drawSaver();
      setTimeout(function () { img.style.opacity = '1'; if (old) { old.style.opacity = '0'; setTimeout(function () { old.remove(); }, 1600); } }, 30);
    };
    img.onerror = function () {
      img.onload = img.onerror = null;
      if (layer !== saverLayer) return;
      if (!artShown) { artFailed = true; drawSaver(); } // noch kein Bild: die Uhr zeigen
    };
    img.src = artUrl(work.file);
  }
  /* Inhalt nach der Einstellung aufbauen; auch beim Umstellen im Betrieb. */
  function showSaver() {
    if (!saverLayer) return;
    if (artTimer) { clearInterval(artTimer); artTimer = null; }
    var caption = saverLayer.lastChild;
    if (saver.mode === 'art' && art.length) {
      if (artShown) artShown.style.objectFit = saver.fill ? 'cover' : 'contain';
      else nextArt();
      artTimer = setInterval(nextArt, saver.interval);
    } else {
      if (artShown) { artShown.remove(); artShown = null; }
      caption.style.display = 'none';
    }
    drawSaver();
  }
  function startSaver() {
    if (saverTimer) { clearTimeout(saverTimer); saverTimer = null; }
    if (saverLayer || !document.body) return;
    var d = document, layer = d.createElement('div'), box = d.createElement('div'), time = d.createElement('div'), date = d.createElement('div'), caption = d.createElement('div');
    layer.setAttribute('data-visuext', 'saver');
    layer.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;z-index:2147483647;background:#000;cursor:none;touch-action:none;overflow:hidden;';
    box.style.cssText = 'position:absolute;z-index:1;color:#8a8a8e;font:300 16px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;white-space:nowrap;';
    time.style.cssText = 'font-size:min(18vw,160px);font-weight:200;letter-spacing:.02em;';
    date.style.cssText = 'font-size:min(4vw,30px);margin-top:.2em;';
    caption.style.cssText = 'display:none;position:absolute;z-index:1;left:0;right:0;bottom:0;padding:28px 20px 14px;color:rgba(255,255,255,.82);' +
      'font:400 14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;background:linear-gradient(transparent,rgba(0,0,0,.55));text-shadow:0 1px 2px rgba(0,0,0,.8);';
    caption.style.display = 'none'; // erscheint erst mit dem ersten geladenen Bild
    box.appendChild(time);
    box.appendChild(date);
    layer.appendChild(box);
    layer.appendChild(caption);
    layer.addEventListener('click', wakeSaver);
    d.body.appendChild(layer);
    saverLayer = layer;
    artShown = null;
    artFailed = false;
    showSaver();
    saverTick = setInterval(drawSaver, 60000);
  }
  function wakeSaver() {
    if (saverTick) { clearInterval(saverTick); saverTick = null; }
    if (artTimer) { clearInterval(artTimer); artTimer = null; }
    artShown = null;
    if (saverLayer) { saverLayer.remove(); saverLayer = null; }
    lastActivity = Date.now();
    armHome();
    armSaver();
  }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(function (name) {
    w.addEventListener(name, activity, { capture: true, passive: true });
  });
  setHome(C.home);
  setSaver(C.saver);

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
