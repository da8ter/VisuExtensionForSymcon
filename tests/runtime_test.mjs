// Laufzeit der Visu-Erweiterung (libs/runtime.js) mit nachgestelltem Fenster, WebSocket und Uhr.
//   node tests/runtime_test.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const QUELLE = readFileSync(fileURLToPath(new URL('../libs/runtime.js', import.meta.url)), 'utf8');
const CONFIG = { v: 2, device: { id: 'ab12cd34', name: 'Küche' }, hook: '/hook/visuext', channel: 'kanalwert', beat: 30 };
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

/** Nachgestelltes Element: Kinder, Stil, Text und Horcher, so viel der Bildschirmschoner braucht. */
function element(tag = 'div', merke = null) {
  const el = { tag, style: {}, children: [], attrs: {}, horcher: {}, textContent: '', parent: null,
    insertBefore(k, vor) { const i = el.children.indexOf(vor); el.children.splice(i < 0 ? el.children.length : i, 0, k); k.parent = el; return k; },
    appendChild(k) { el.children.push(k); k.parent = el; return k; },
    remove() { if (el.parent) { el.parent.children = el.parent.children.filter((k) => k !== el); el.parent = null; } },
    setAttribute(n, v) { el.attrs[n] = v; },
    addEventListener(n, f) { el.horcher[n] = f; },
    get firstChild() { return el.children[0] || null; },
    get lastChild() { return el.children[el.children.length - 1] || null; } };
  if (merke) merke.push(el);
  return el;
}

/** Fenster mit stellbarer Uhr; `sockets` sind alle geöffneten Verbindungen in Reihenfolge. */
function welt() {
  let jetzt = 1_000_000, lauf = 0;
  const timer = new Map(), sockets = [], horcher = {}, gewechselt = [], erzeugt = [], abrufe = [], antworten = [], blobs = [], frei = [], gefeuert = [];
  class Socket {
    constructor(url) { this.url = url; this.gesendet = []; this.zu = false; sockets.push(this); }
    send(text) { if (this.zu) throw new Error('zu'); this.gesendet.push(JSON.parse(text)); }
    close() { this.zu = true; }
    // Hilfen für den Test
    oeffne() { this.onopen && this.onopen(); }
    empfange(o) { this.onmessage && this.onmessage({ data: JSON.stringify(o) }); }
    reisse() { this.zu = true; this.onclose && this.onclose(); }
  }
  const win = {
    WebSocket: Socket,
    location: { origin: 'http://symcon.test:3777', pathname: '/', hash: '#/kueche', assign: (ziel) => { gewechselt.push(ziel); } },
    document: { hidden: false, addEventListener: (n, f) => { (horcher[n] = horcher[n] || []).push(f); }, body: element(), createElement: (t) => element(t, erzeugt),
      dispatchEvent: (ev) => { gefeuert.push([ev.type, ev.detail]); (horcher[ev.type] || []).forEach((f) => f(ev)); return true; } },
    CustomEvent: class { constructor(type, o) { this.type = type; this.detail = o && o.detail; } },
    addEventListener: (n, f) => { (horcher[n] = horcher[n] || []).push(f); },
    setTimeout: (f, ms) => { timer.set(++lauf, { f, um: jetzt + ms }); return lauf; },
    setInterval: (f, ms) => { timer.set(++lauf, { f, um: jetzt + ms, alle: ms }); return lauf; },
    clearTimeout: (id) => timer.delete(id),
    clearInterval: (id) => timer.delete(id),
    Date: class { static now() { return jetzt; } toLocaleTimeString() { return 'ZEIT'; } toLocaleDateString() { return 'DATUM'; } },
    JSON, Number, String, Array, Math, Error, Boolean, encodeURIComponent,
    // Abruf eines Bildstücks: `antworten` hält je Abruf {status, size, type, bytes}
    fetch: (url) => {
      abrufe.push(url);
      const a = antworten.shift();
      if (!a) return Promise.reject(new Error('netz'));
      return Promise.resolve({ ok: (a.status || 200) === 200, headers: { get: (n) => ({ 'X-Visu-Size': String(a.size), 'Content-Type': a.type })[n] ?? null },
        arrayBuffer: () => Promise.resolve({ byteLength: a.bytes }) });
    },
    Blob: class { constructor(teile, o) { this.teile = teile.map((t) => t.byteLength); this.type = o.type; blobs.push(this); } },
    URL: { createObjectURL: () => 'blob:' + blobs.length, revokeObjectURL: (u) => frei.push(u) },
  };
  win.window = win; win.top = win;
  const ctx = vm.createContext(win);
  const lade = (mehr = {}) => vm.runInContext(QUELLE.replace('/*VISUEXT*/null', JSON.stringify({ ...CONFIG, ...mehr })), ctx);
  /** Uhr um ms vorstellen und fällige Timer in Zeitfolge laufen lassen. */
  const vor = (ms) => {
    const ziel = jetzt + ms;
    for (;;) {
      let naechster = null;
      for (const [id, t] of timer) if (t.um <= ziel && (!naechster || t.um < naechster.t.um)) naechster = { id, t };
      if (!naechster) break;
      jetzt = naechster.t.um;
      if (naechster.t.alle) naechster.t.um += naechster.t.alle; else timer.delete(naechster.id);
      naechster.t.f();
    }
    jetzt = ziel;
  };
  const melde = (n) => (horcher[n] || []).forEach((f) => f({ type: n }));
  /** Die Brücke meldet etwas an die Laufzeit (DOM-Ereignis „visu-ext:motion“). */
  const bruecke = (o) => (horcher['visu-ext:motion'] || []).forEach((f) => f({ type: 'visu-ext:motion', detail: JSON.stringify(o) }));
  return { win, sockets, lade, vor, melde, gewechselt, erzeugt, abrufe, antworten, blobs, frei, gefeuert, bruecke };
}

// ── Start, Warteliste, Anmeldung ──
{
  const { win, sockets, lade, vor } = welt();
  const frueh = [];
  win.visuExtReady = [(ext) => frueh.push(ext.device.id)];
  lade();
  pruefe('Wartende Skripte bekommen die Laufzeit', frueh, ['ab12cd34']);
  const spaet = [];
  win.visuExtReady.push((ext) => spaet.push(ext.v));
  pruefe('Später angemeldete laufen sofort', spaet, [2]);
  pruefe('Kanal zum Ursprung der Seite', sockets.map((s) => s.url), ['ws://symcon.test:3777/hook/visuext']);
  const s = sockets[0];
  pruefe('Vor dem Öffnen wird nichts gesendet', s.gesendet, []);
  const ext = win.visuExt, zustand = [], post = [], fremd = [];
  ext.onState((an) => zustand.push(an));
  const ab = ext.on(30001, (d) => post.push(d));
  ext.on(30002, (d) => fremd.push(d));
  pruefe('Senden ohne Kanal: false, die Nachricht wartet', ext.send(30001, { a: 1 }), false);
  s.oeffne();
  pruefe('Anmeldung im ersten Frame, ohne Schlüssel in der Adresse', s.gesendet, [{ t: 'hello', d: 'ab12cd34', c: 'kanalwert', page: '/#/kueche' }]);
  pruefe('Vor „willkommen“ noch nicht verbunden', [ext.connected(), zustand], [false, []]);
  s.empfange({ t: 'welcome', name: 'Küche neu', beat: 30 });
  pruefe('Willkommen: verbunden, Name übernommen, Wartendes gesendet',
    [ext.connected(), zustand, ext.device.name, s.gesendet.slice(1)], [true, [true], 'Küche neu', [{ t: 'ev', m: 30001, data: { a: 1 } }]]);
  s.empfange({ t: 'msg', m: 30001, data: { text: 'hallo' } });
  pruefe('Nachricht geht nur an das Zielmodul', [post, fremd], [[{ text: 'hallo' }], []]);
  ab();
  s.empfange({ t: 'msg', m: 30001, data: 2 });
  pruefe('Abgemeldeter Empfänger bekommt nichts mehr', post.length, 1);
  pruefe('Senden mit Kanal', [ext.send('30002', 5), s.gesendet.at(-1)], [true, { t: 'ev', m: 30002, data: 5 }]);

  // ── Lebenszeichen ──
  win.location.hash = '#/flur';
  vor(30000);
  pruefe('Lebenszeichen nach 30 s mit der aktuellen Seite', s.gesendet.at(-1), { t: 'beat', page: '/#/flur' });
  s.empfange({ t: 'beat' });
  vor(30000);
  s.empfange({ t: 'beat' });
  vor(30000); // dritter Takt, Antwort bleibt ab jetzt aus
  vor(60000);
  pruefe('Bleibt die Antwort aus: getrennt gemeldet, alte Verbindung zu', [ext.connected(), zustand, s.zu], [false, [true, false], true]);
  vor(1000);
  pruefe('Nach 1 s ein neuer Versuch', sockets.length, 2);

  // ── Neu verbinden mit wachsendem Abstand ──
  sockets[1].reisse();
  vor(1999); pruefe('Zweiter Fehlversuch: 2 s warten', sockets.length, 2);
  vor(1); pruefe('dann neu', sockets.length, 3);
  sockets[2].reisse();
  vor(5000); pruefe('Dritter: 5 s', sockets.length, 4);
  sockets[3].oeffne();
  sockets[3].empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  pruefe('Wieder verbunden', [ext.connected(), zustand], [true, [true, false, true]]);
  sockets[3].reisse();
  vor(1000);
  pruefe('Nach einem Erfolg beginnt der Abstand wieder bei 1 s', sockets.length, 5);

  // ── Sitzung unbekannt, abgewiesen ──
  const t = sockets[4];
  t.oeffne();
  t.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  t.empfange({ t: 'unknown' });
  pruefe('Symcon kennt die Sitzung nicht mehr: neu anmelden', [t.gesendet.at(-1).t, ext.connected()], ['hello', false]);
  t.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  pruefe('und wieder verbunden', ext.connected(), true);
  t.empfange({ t: 'denied' });
  vor(120000);
  pruefe('Abgewiesen (gesperrt oder entfernt): getrennt, kein weiterer Versuch', [ext.connected(), sockets.length, t.zu], [false, 5, true]);
}

// ── Doppelt geladen, Aufwachen ──
{
  const { win, sockets, lade, vor, melde } = welt();
  lade();
  const erste = win.visuExt;
  lade();
  pruefe('Doppelt geladen: eine Laufzeit, ein Kanal', [win.visuExt === erste, sockets.length], [true, 1]);
  sockets[0].reisse();
  sockets[0].reisse = () => {};
  vor(500);
  melde('visibilitychange');
  pruefe('Zurück im Vordergrund: sofort neu verbinden statt warten', sockets.length, 2);
  melde('online');
  pruefe('Läuft schon ein Versuch, kommt kein zweiter dazu', sockets.length, 2);
  vor(5000);
  pruefe('Der alte Wartetimer löst keinen weiteren Versuch aus', sockets.length, 2);
}

// ── Kachel: nicht im obersten Fenster ──
{
  const { win, sockets, lade } = welt();
  win.top = {};
  lade();
  pruefe('In einem Rahmen (Kachel) startet die Laufzeit nicht', [typeof win.visuExt, sockets.length], ['undefined', 0]);
}

// ── Rücksprung zur Startseite ──
{
  const { win, sockets, lade, vor, melde, gewechselt } = welt();
  lade({ home: { minutes: 2, page: '' } });
  const seite = () => win.location.pathname + win.location.hash;
  win.location.hash = '#/flur';
  melde('pointerdown');
  vor(119000);
  pruefe('Rücksprung: vor Ablauf der Frist bleibt die Seite', seite(), '/#/flur');
  vor(1500);
  pruefe('Nach zwei Minuten ohne Bedienung: zurück auf die Seite, mit der geladen wurde', seite(), '/#/kueche');
  win.location.hash = '#/flur';
  melde('keydown');
  vor(100000);
  melde('wheel');
  vor(100000);
  pruefe('Jede Bedienung stellt die Frist neu', seite(), '/#/flur');
  vor(21000);
  pruefe('und danach läuft sie wieder ab', seite(), '/#/kueche');
  vor(600000);
  pruefe('Auf der Startseite passiert nichts', [seite(), gewechselt], ['/#/kueche', []]);

  const s = sockets[0];
  s.oeffne();
  s.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  s.empfange({ t: 'cfg', home: { minutes: 1, page: '/#/start' } });
  vor(61000);
  pruefe('Einstellung aus dem Modul wirkt sofort: andere Frist, eigene Startseite', seite(), '/#/start');
  win.location.hash = '#/flur';
  melde('touchstart');
  s.empfange({ t: 'cfg', home: { minutes: 1, page: '/visu/#/7' } });
  vor(61000);
  pruefe('Startseite unter einem anderen Pfad: ganze Adresse wechseln', gewechselt, ['/visu/#/7']);
  s.empfange({ t: 'cfg', home: { minutes: 1, page: 'https://boese.example/' } });
  melde('pointerdown');
  vor(61000);
  pruefe('Fremde Adresse als Startseite gilt nicht: zurück auf die geladene Seite', [seite(), gewechselt.length], ['/#/kueche', 1]);
  win.location.hash = '#/flur';
  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' } });
  melde('pointerdown');
  vor(3600000);
  pruefe('Ausgeschaltet: kein Rücksprung', seite(), '/#/flur');
}
{
  const { win, lade, vor } = welt();
  lade();
  win.location.hash = '#/flur';
  vor(3600000);
  pruefe('Ohne Einstellung kein Rücksprung', win.location.hash, '#/flur');
}

// ── Bildschirmschoner ──
{
  const { win, sockets, lade, vor, melde } = welt();
  lade({ home: { minutes: 1, page: '' }, saver: { minutes: 3, mode: 'clock' } });
  const ebene = () => win.document.body.children.find((k) => k.attrs['data-visuext'] === 'saver') || null;
  const uhr = () => { const e = ebene(); return e ? [e.firstChild.style.display, e.firstChild.firstChild.textContent, e.firstChild.lastChild.textContent] : null; };
  win.location.hash = '#/flur';
  melde('pointerdown');
  vor(179000);
  pruefe('Bildschirmschoner: vor Ablauf nichts; der Rücksprung lief schon', [ebene(), win.location.hash], [null, '#/kueche']);
  vor(1500);
  pruefe('Nach drei Minuten ohne Bedienung: Ebene über allem, mit Uhr und Datum', [ebene().style.cssText.includes('z-index:2147483647'), uhr()], [true, ['block', 'ZEIT', 'DATUM']]);
  const ort = [ebene().firstChild.style.left, ebene().firstChild.style.top];
  let gewandert = false;
  for (let i = 0; i < 10 && !gewandert; i++) { vor(60000); gewandert = ebene().firstChild.style.left !== ort[0] || ebene().firstChild.style.top !== ort[1]; }
  pruefe('Die Uhr wandert, damit sich nichts einbrennt', gewandert, true);
  melde('pointerdown');
  melde('touchstart');
  pruefe('Aufsetzen von Zeiger oder Finger lässt die Ebene stehen (die Geste soll nicht in die Visu fallen)', ebene() !== null, true);
  ebene().horcher.click();
  pruefe('Ende der Geste auf der Ebene: aufgewacht', ebene(), null);
  vor(181000);
  pruefe('Danach läuft die Frist neu', ebene() !== null, true);
  melde('keydown');
  pruefe('Eine Taste weckt sofort', ebene(), null);

  const s = sockets[0];
  s.oeffne();
  s.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  s.empfange({ t: 'saver', on: true });
  pruefe('Aus Symcon einschalten: sofort', ebene() !== null, true);
  s.empfange({ t: 'cfg', home: { minutes: 1, page: '' }, saver: { minutes: 3, mode: 'black' } });
  pruefe('Inhalt im Betrieb umgestellt: schwarz, ohne Uhr', uhr()[0], 'none');
  s.empfange({ t: 'saver', on: false });
  pruefe('Aus Symcon aufwecken', ebene(), null);
  s.empfange({ t: 'saver', on: true });
  win.visuExt.wake();
  pruefe('Ein Modul weckt über ext.wake()', ebene(), null);
  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { minutes: 0, mode: 'black' } });
  s.empfange({ t: 'saver', on: true });
  s.empfange({ t: 'saver', on: true });
  pruefe('Einschalten aus Symcon geht auch ohne Einstellung, und nur eine Ebene', win.document.body.children.length, 1);
  win.visuExt.wake();
  melde('pointerdown');
  vor(7200000);
  pruefe('Ausgeschaltet: kein Bildschirmschoner von selbst', ebene(), null);
}

// ── Bewegungsmelder ──
{
  const { win, sockets, lade, vor, melde, gefeuert, bruecke } = welt();
  const kamera = () => gefeuert.filter((g) => g[0] === 'visu-ext:camera').map((g) => JSON.parse(g[1]));
  lade({ saver: { minutes: 3, mode: 'clock' } });
  const ebene = () => win.document.body.children.find((k) => k.attrs['data-visuext'] === 'saver') || null;
  pruefe('Bewegungsmelder aus: der Brücke wird nichts gesagt', kamera(), []);
  const s = sockets[0];
  // Uhr vorstellen und dabei die Lebenszeichen beantworten, sonst baut die Laufzeit die Verbindung ab
  const lebe = (ms) => { while (ms > 0) { const d = Math.min(ms, 10000); vor(d); ms -= d; if (!s.zu) s.empfange({ t: 'beat' }); } };
  s.oeffne();
  s.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  bruecke({ t: 'motion' });
  pruefe('Ausgeschaltet: Bewegungen der Brücke bleiben folgenlos', s.gesendet.filter((m) => m.t === 'motion'), []);
  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { minutes: 3, mode: 'clock' }, motion: { on: true, level: 3 } });
  pruefe('Eingeschaltet: die Brücke erfährt es mit der Empfindlichkeit', kamera(), [{ on: true, level: 3 }]);
  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { minutes: 3, mode: 'clock' }, motion: { on: true, level: 3 } });
  gefeuert.length = 0;
  win.document.dispatchEvent({ type: 'visu-ext:camera-ask' });
  pruefe('Unverändert: nichts neu; auf Nachfrage der Brücke noch einmal', kamera(), [{ on: true, level: 3 }]);
  melde('pointerdown');
  lebe(181000);
  pruefe('Bildschirmschoner läuft', ebene() !== null, true);
  bruecke({ t: 'motion' });
  pruefe('Bewegung: weckt den Bildschirmschoner und meldet Symcon den Beginn', [ebene(), s.gesendet.filter((m) => m.t === 'motion')], [null, [{ t: 'motion', on: true }]]);
  lebe(20000);
  bruecke({ t: 'motion' });
  lebe(29000);
  pruefe('Weitere Bewegung: kein neuer Beginn, die Nachlaufzeit beginnt neu', s.gesendet.filter((m) => m.t === 'motion').length, 1);
  lebe(1500);
  pruefe('30 s ohne Bewegung: Ende an Symcon', s.gesendet.filter((m) => m.t === 'motion').pop(), { t: 'motion', on: false });
  lebe(152000);
  pruefe('Bewegung hält den Bildschirmschoner nur hin: ohne weitere Bewegung kommt er wieder', ebene() !== null, true);
  bruecke({ t: 'cam', state: 'denied' });
  bruecke({ t: 'cam', state: 'denied' });
  pruefe('Zustand der Kamera geht an Symcon, nur bei Änderung', s.gesendet.filter((m) => m.t === 'cam'), [{ t: 'cam', state: 'denied' }]);
  s.reisse();
  vor(1000);
  const s2 = sockets[1];
  s2.oeffne();
  s2.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  pruefe('Nach dem Neuverbinden: Stand der Bewegung und der Kamera noch einmal', s2.gesendet.filter((m) => m.t === 'motion' || m.t === 'cam'), [{ t: 'motion', on: false }, { t: 'cam', state: 'denied' }]);
  gefeuert.length = 0;
  s2.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { minutes: 3, mode: 'clock' }, motion: { on: false, level: 3 } });
  pruefe('Ausgeschaltet: die Brücke erfährt es (Kamera aus)', kamera(), [{ on: false, level: 3 }]);
}

// ── Bildschirmschoner mit Kunstwerken ──
{
  const KUNST = [{ title: 'Die Sternennacht', artist: 'Vincent van Gogh', year: '1889', file: 'Van Gogh - Starry Night.jpg' },
    { title: 'Der Schrei', artist: 'Edvard Munch', year: '1893', file: 'The Scream & more.jpg' }, { title: 'Ohne Angaben', artist: '', year: '', file: 'x.jpg' }];
  const { win, sockets, lade, vor, melde, erzeugt } = welt();
  lade({ art: KUNST, saver: { minutes: 1, mode: 'art', interval: 2, fill: false } });
  const ebene = () => win.document.body.children.find((k) => k.attrs['data-visuext'] === 'saver') || null;
  const bilder = () => erzeugt.filter((e) => e.tag === 'img');
  const imBild = () => ebene().children.filter((k) => k.tag === 'img');
  vor(61000);
  const erstes = bilder()[0];
  const datei = decodeURIComponent(erstes.src.split('FilePath/')[1].split('?')[0]);
  pruefe('Kunst: das erste Bild wird bei Wikimedia Commons angefordert, Dateiname kodiert, feste Breite',
    [erstes.src.startsWith('https://commons.wikimedia.org/wiki/Special:FilePath/'), KUNST.some((k) => k.file === datei), /[ &]/.test(erstes.src.split('?')[0].slice(8)), erstes.src.endsWith('?width=1280')], [true, true, false, true]);
  pruefe('Bis es geladen ist: schwarz, ohne Uhr und ohne Beschriftung', [imBild().length, ebene().firstChild.style.display, ebene().lastChild.style.display], [0, 'none', 'none']);
  erstes.onload();
  vor(100);
  const werk = KUNST.find((k) => k.file === datei);
  pruefe('Geladen: Bild eingeblendet, mit schwarzem Rand statt Beschnitt, Beschriftung mit Titel, Künstler und Jahr',
    [imBild().length, erstes.style.opacity, erstes.style.cssText.includes('object-fit:contain'), ebene().lastChild.textContent, ebene().lastChild.style.display],
    [1, '1', true, [werk.title, werk.artist, werk.year].filter(Boolean).join(' · '), 'block']);
  vor(120000);
  const zweites = bilder()[1];
  pruefe('Nach dem eingestellten Wechsel: ein anderes Werk wird geladen, das alte bleibt bis dahin', [bilder().length, zweites.src !== erstes.src, imBild().length], [2, true, 1]);
  zweites.onload();
  vor(2000);
  pruefe('Überblendet: nur noch das neue Bild', [imBild().length, imBild()[0] === zweites, zweites.style.opacity], [1, true, '1']);
  vor(120000);
  bilder()[2].onerror();
  pruefe('Lädt ein späteres Bild nicht: das gezeigte bleibt, keine Uhr', [imBild()[0] === zweites, ebene().firstChild.style.display], [true, 'none']);

  const s = sockets[0];
  s.oeffne();
  s.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { minutes: 1, mode: 'art', interval: 2, fill: true } });
  pruefe('„Füllt den Bildschirm“ im Betrieb umgestellt: das gezeigte Bild wird beschnitten', zweites.style.objectFit, 'cover');
  vor(120000);
  pruefe('und neue Bilder ebenso', bilder()[bilder().length - 1].style.cssText.includes('object-fit:cover'), true);
  const anzahl = bilder().length;
  ebene().horcher.click();
  vor(50000);
  pruefe('Aufgeweckt: Ebene weg, es wird nichts mehr geladen', [ebene(), bilder().length], [null, anzahl]);
}
{
  const { win, lade, vor, erzeugt } = welt();
  lade({ art: [{ title: 'A', artist: 'B', year: '1', file: 'a.jpg' }], saver: { minutes: 1, mode: 'art', interval: 5, fill: false } });
  vor(61000);
  const ebene = win.document.body.children[0];
  erzeugt.filter((e) => e.tag === 'img')[0].onerror();
  pruefe('Kein Netz: lässt sich das erste Bild nicht laden, erscheint die Uhr', [ebene.firstChild.style.display, ebene.firstChild.firstChild.textContent, ebene.lastChild.style.display], ['block', 'ZEIT', 'none']);
}
{
  const { win, lade, vor, erzeugt } = welt();
  lade({ saver: { minutes: 1, mode: 'art', interval: 5, fill: false } });
  vor(61000);
  pruefe('Ohne Liste der Kunstwerke: die Uhr statt einer leeren Fläche', [erzeugt.filter((e) => e.tag === 'img').length, win.document.body.children[0].firstChild.style.display], [0, 'block']);
}

// ── Bildschirmschoner mit eigenen Bildern aus Symcon ──
{
  const { win, sockets, lade, vor, erzeugt, abrufe, antworten, blobs, frei } = welt();
  const warte = () => new Promise((r) => setImmediate(r));
  const MEDIA = { minutes: 1, mode: 'media', interval: 2, fill: true, category: 40000 };
  lade({ saver: MEDIA });
  const ebene = () => win.document.body.children.find((k) => k.attrs['data-visuext'] === 'saver') || null;
  const bilder = () => erzeugt.filter((e) => e.tag === 'img');
  const imBild = () => ebene().children.filter((k) => k.tag === 'img');
  const s = sockets[0];
  vor(61000);
  pruefe('Eigene Bilder ohne Kanal: die Uhr', [ebene().firstChild.style.display, abrufe.length], ['block', 0]);
  const senden = s.send.bind(s);
  s.send = (text) => { senden(text); if (JSON.parse(text).t === 'beat') s.empfange({ t: 'beat' }); }; // Symcon antwortet auf das Lebenszeichen
  s.oeffne();
  s.empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  const fragen = () => s.gesendet.filter((m) => m.t === 'pic');
  pruefe('Sobald der Kanal steht: die Laufzeit fragt Symcon nach dem nächsten Bild', fragen(), [{ t: 'pic', seen: [] }]);
  antworten.push({ size: 5, type: 'image/jpeg', bytes: 3 }, { size: 5, type: 'image/jpeg', bytes: 2 });
  s.empfange({ t: 'pic', i: 40001, reset: false, u: '/hook/visuext?k=media&d=ab12cd34&i=40001&e=1&s=x' });
  await warte(); await warte();
  pruefe('Das Bild kommt in Stücken vom Hook, jedes ab dem bisher Geladenen', abrufe, ['/hook/visuext?k=media&d=ab12cd34&i=40001&e=1&s=x&o=0', '/hook/visuext?k=media&d=ab12cd34&i=40001&e=1&s=x&o=3']);
  pruefe('und wird zu einem Bild zusammengesetzt', [blobs.length, blobs[0].teile, blobs[0].type, bilder()[0].src], [1, [3, 2], 'image/jpeg', 'blob:1']);
  bilder()[0].onload();
  vor(100);
  pruefe('Geladen: eingeblendet, bildschirmfüllend, ohne Beschriftung, die Uhr ist weg',
    [imBild().length, bilder()[0].style.opacity, bilder()[0].style.cssText.includes('object-fit:cover'), ebene().lastChild.style.display, ebene().firstChild.style.display], [1, '1', true, 'none', 'none']);
  vor(120000);
  pruefe('Beim Wechsel nennt die Laufzeit, was sie schon gezeigt hat', fragen()[1], { t: 'pic', seen: [40001] });
  antworten.push({ size: 4, type: 'image/png', bytes: 4 });
  s.empfange({ t: 'pic', i: 40002, reset: true, u: '/hook/visuext?k=media&i=40002' });
  await warte(); await warte();
  bilder()[1].onload();
  vor(2000);
  pruefe('Überblendet: nur das neue Bild, der Speicher des alten ist frei', [imBild().length, imBild()[0].src, frei], [1, 'blob:2', ['blob:1']]);
  vor(120000);
  pruefe('Neue Runde: die Liste des Gezeigten beginnt neu', fragen()[2], { t: 'pic', seen: [40002] });
  s.empfange({ t: 'pic' });
  s.empfange({ t: 'pic', i: 9, u: 'https://fremd.example/bild.jpg' });
  s.empfange({ t: 'pic', i: 9, u: '/hook/anderes?k=media' });
  await warte();
  pruefe('Kein Bild oder eine fremde Adresse: nichts wird geladen, das gezeigte bleibt, keine Uhr', [abrufe.length, imBild()[0].src, ebene().firstChild.style.display], [3, 'blob:2', 'none']);
  antworten.push({ status: 403, size: 0, type: '', bytes: 0 });
  s.empfange({ t: 'pic', i: 40003, u: '/hook/visuext?k=media&i=40003' });
  await warte(); await warte();
  pruefe('Der Hook lehnt ab: das gezeigte Bild bleibt', [abrufe.length, imBild().length, blobs.length], [4, 1, 2]);

  s.empfange({ t: 'cfg', home: { minutes: 0, page: '' }, saver: { ...MEDIA, category: 41000 } });
  pruefe('Andere Kategorie im Betrieb: das alte Bild verschwindet, sofort wird neu gefragt', [imBild().length, frei, fragen().length, fragen()[3]], [0, ['blob:1', 'blob:2'], 4, { t: 'pic', seen: [] }]);
  antworten.push({ size: 2, type: 'image/jpeg', bytes: 2 });
  s.empfange({ t: 'pic', i: 41001, u: '/hook/visuext?k=media&i=41001' });
  ebene().horcher.click();
  await warte(); await warte();
  pruefe('Aufgeweckt, während ein Bild lädt: es wird verworfen', [ebene(), blobs.length, bilder().length], [null, 2, 2]);
  s.empfange({ t: 'pic', i: 41002, u: '/hook/visuext?k=media&i=41002' });
  await warte();
  pruefe('Eine späte Antwort ohne Bildschirmschoner lädt nichts', abrufe.length, 5);
  s.empfange({ t: 'saver', on: true });
  s.reisse();
  vor(120000);
  pruefe('Kanal abgerissen und noch kein Bild: die Uhr', ebene().firstChild.style.display, 'block');
}
{
  const { win, sockets, lade, vor, antworten, erzeugt } = welt();
  lade({ saver: { minutes: 1, mode: 'media', interval: 5, fill: false, category: 1 } });
  sockets[0].oeffne();
  sockets[0].empfange({ t: 'welcome', name: 'Küche', beat: 30 });
  vor(61000);
  sockets[0].empfange({ t: 'pic' });
  pruefe('Leere Kategorie: die Uhr statt einer leeren Fläche', [erzeugt.filter((e) => e.tag === 'img').length, win.document.body.children[0].firstChild.style.display], [0, 'block']);
  antworten.push({ size: 9, type: 'text/html', bytes: 9 });
  sockets[0].empfange({ t: 'pic', i: 2, u: '/hook/visuext?k=media&i=2' });
  await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r));
  pruefe('Was kein Bild ist, wird nicht gezeigt', erzeugt.filter((e) => e.tag === 'img').length, 0);
}

console.log(fehler ? `\n${fehler} von ${anzahl} Prüfungen fehlgeschlagen` : `\nAlle ${anzahl} Prüfungen bestanden.`);
process.exit(fehler ? 1 : 0);
