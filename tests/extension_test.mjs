// Die ECHTE Erweiterung in Headless-Chrome (eigenes Profil), geladen über das Entwicklerprotokoll.
// Prüft, was Attrappen nicht zeigen: Chromes eigene Sicherheitsrichtlinie für Erweiterungen. Der
// nachgespielte Symcon-Server läuft unter dem Namen symcon.test (auf 127.0.0.1 umgelenkt), weil Chrome
// für localhost und 127.0.0.1 Ausnahmen macht und der Fehler dort nicht auftritt.
//   node tests/extension_test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TEXTE = JSON.parse(readFileSync(join(ROOT, 'libs/extension/_locales/de/messages.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

// ── Nachgespieltes Modul „Visu-Erweiterung“ (Vertrag 2) ─────────────────────────
const KEY = 'ab'.repeat(24), ID = 'ab12cd34';
const symcon = { gesperrt: false, anfragen: [], kamera: false };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const html = (t) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(t); };
  const js = (t) => { res.setHeader('Content-Type', 'application/javascript'); res.end(t); };
  const status = (n) => { res.statusCode = n; res.end(); };
  symcon.anfragen.push(req.method + ' ' + req.url);
  if (u.pathname === '/') return html('<!doctype html><meta charset="utf-8"><title>Visu</title><body><div id="visu">Visu</div><iframe id="k" src="/kachel"></iframe></body>');
  if (u.pathname === '/kachel' || u.pathname === '/console/') return html('<!doctype html><title>x</title><body>x</body>');
  if (u.pathname !== '/hook/visuext') return status(404);
  const k = u.searchParams.get('k');
  if (k === 'script') {
    // Die Laufzeit (m=0) antwortet später als das Modul: ausgeführt werden muss sie trotzdem zuerst.
    const m = u.searchParams.get('m');
    // Mit symcon.kamera spielt die Laufzeit den Bewegungsmelder nach: einschalten und Meldungen der Brücke sammeln.
    const kamera = m === '0' && symcon.kamera ? `window.__bew = []; document.addEventListener('visu-ext:motion', (e) => window.__bew.push(JSON.parse(e.detail)));
      window.__kamera = (on) => document.dispatchEvent(new CustomEvent('visu-ext:camera', { detail: JSON.stringify({ on: on, level: 2 }) })); window.__kamera(true);` : '';
    return void setTimeout(() => js(`(window.__lauf = window.__lauf || []).push(${JSON.stringify(m)});` + kamera), m === '0' ? 250 : 0);
  }
  if (req.method !== 'POST') return status(404);
  let rumpf = '';
  req.on('data', (d) => { rumpf += d; });
  req.on('end', () => {
    let a = {};
    try { a = JSON.parse(rumpf); } catch { /* leer */ }
    if (k === 'pair') return a.code === '123456' ? json({ ok: true, visuExtension: 2, device: { id: ID, name: a.name || 'Browser' }, key: KEY, address: '/hook/visuext' }) : status(403);
    if (k === 'ext') {
      if (a.d !== ID || a.key !== KEY || symcon.gesperrt) return status(403);
      return json({ visuExtension: 2, name: 'Symcon Zuhause', version: '0.2', device: { id: ID, name: 'Küche' },
        scripts: [`/hook/visuext?k=script&d=${ID}&m=0&e=1&s=x`, `/hook/visuext?k=script&d=${ID}&m=12345&e=1&s=x`] });
    }
    status(404);
  });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://symcon.test:${srv.address().port}`;

// ── Erweiterung: Kopie mit vorab erteiltem Zugriff (die Freigabe-Abfrage kann hier niemand anklicken) ──
const arbeit = mkdtempSync(join(tmpdir(), 'visuext-echt-'));
const ext = join(arbeit, 'ext'), profil = join(arbeit, 'profil');
cpSync(join(ROOT, 'libs/extension'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://*/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));

// ── Chrome über die Protokoll-Pipe (nur so lässt sich eine entpackte Erweiterung laden) ─────────────
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`,
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP symcon.test 127.0.0.1',
  '--window-size=900,700', '--use-fake-device-for-media-stream', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true });
const raus = chrome.stdio[3], rein = chrome.stdio[4];
let id = 0, rest = '';
const offen = new Map(), log = [];
rein.on('data', (d) => {
  rest += d.toString('utf8');
  let i;
  while ((i = rest.indexOf('\0')) >= 0) {
    const m = JSON.parse(rest.slice(0, i));
    rest = rest.slice(i + 1);
    if (m.id && offen.has(m.id)) { const [a, b] = offen.get(m.id); offen.delete(m.id); m.error ? b(new Error(JSON.stringify(m.error))) : a(m.result); }
    else if (m.method === 'Log.entryAdded') log.push(m.params.entry.text);
    else if (m.method === 'Runtime.exceptionThrown') log.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  }
});
const send = (method, params = {}, sessionId) => {
  const n = ++id;
  raus.write(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  return new Promise((a, b) => { offen.set(n, [a, b]); setTimeout(() => { if (offen.has(n)) { offen.delete(n); b(new Error('keine Antwort auf ' + method)); } }, 15000); });
};
const seite = async (url) => {
  const { targetId } = await send('Target.createTarget', { url });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Runtime.enable', {}, sessionId);
  await send('Log.enable', {}, sessionId);
  const ev = async (expr, geste = false) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: geste }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { ev, zu: () => send('Target.closeTarget', { targetId }) };
};
const aufraeumen = async () => { try { process.kill(-chrome.pid); } catch { /* weg */ } await sleep(400); rmSync(arbeit, { recursive: true, force: true }); srv.close(); };

try {
  await sleep(1500);
  const geladen = await send('Extensions.loadUnpacked', { path: ext });
  pruefe('Erweiterung geladen', typeof geladen.id === 'string' && geladen.id.length > 10, true);
  await sleep(1500);

  // Einrichtung: koppeln (die Seite der Erweiterung ruft einen fremden Server)
  const opt = await seite(`chrome-extension://${geladen.id}/options.html`);
  await sleep(800);
  const koppeln = async (code) => {
    await opt.ev(`document.getElementById('adresse').value = ${JSON.stringify(ORIGIN)}; document.getElementById('code').value = ${JSON.stringify(code)};
      document.getElementById('name').value = 'Küche'; document.getElementById('neu').requestSubmit(); 1`, true);
    await sleep(1800);
  };
  const stand = () => opt.ev(`[document.getElementById('meldung').textContent].concat(Array.prototype.map.call(document.querySelectorAll('.zeile'), (z) => z.querySelector('.name').textContent + ' | ' + z.querySelector('.ort').textContent + ' | ' + z.querySelector('.status').textContent))`);
  const angemeldet = () => opt.ev(`chrome.scripting.getRegisteredContentScripts().then((l) => l.map((s) => [s.world, s.js.join('+'), s.matches.join(' ')]).sort())`);

  await koppeln('999999');
  pruefe('Einrichtung: falscher Code wird als solcher gemeldet (Antwort des fremden Servers lesbar), nichts angemeldet',
    [await stand(), await angemeldet()], [[TEXTE.errNoManifest.message.replace('$1', TEXTE.errPairDenied.message)], []]);
  await koppeln('123456');
  pruefe('Einrichtung: gekoppelt, Zeile mit Servername, Browsername und „Verbunden“',
    await stand(), ['', `Symcon Zuhause | ${ORIGIN} · ${TEXTE.optDevice.message.replace('$1', 'Küche')} | ${TEXTE.stConnected.message} · 0.2`]);
  pruefe('Inhaltsskripte angemeldet: eines im Fenster der Seite, eines mit Zugriff auf die Einstellungen',
    await angemeldet(), [['ISOLATED', 'core.js+bridge.js', ORIGIN + '/*'], ['MAIN', 'inject.js', ORIGIN + '/*']]);
  pruefe('Gespeichert in chrome.storage.local: eine Verbindung mit Kennung und Schlüssel',
    await opt.ev(`chrome.storage.local.get('connections').then((r) => r.connections.map((c) => [c.origin, c.id, c.key.length, c.name, c.server]))`), [[ORIGIN, ID, 48, 'Küche', 'Symcon Zuhause']]);
  pruefe('Keine Voranfrage (OPTIONS) an den Server', symcon.anfragen.filter((a) => a.startsWith('OPTIONS')).length, 0);

  // Visu: Laufzeit und Modul müssen laufen, obwohl der Server nicht localhost heißt
  symcon.anfragen = [];
  const visu = await seite(ORIGIN + '/');
  await sleep(2200);
  pruefe('Visu: Laufzeit vor dem Modul, jedes genau einmal, nicht im Rahmen, keine Reste im Fenster',
    [await visu.ev('window.__lauf || null'), await visu.ev('document.getElementById("k").contentWindow.__lauf || null'), await visu.ev('typeof window.VisuExt')], [['0', '12345'], null, 'undefined']);
  pruefe('Visu: Beschreibung einmal per POST geholt, der Schlüssel in keiner Adresse',
    [symcon.anfragen.filter((a) => a.includes('k=ext')), symcon.anfragen.some((a) => a.includes(KEY))], [['POST /hook/visuext?k=ext'], false]);
  pruefe('Visu: Der Schlüssel ist aus dem Fenster der Seite nicht erreichbar',
    await visu.ev('[typeof (window.chrome && window.chrome.storage), document.documentElement.outerHTML.includes(' + JSON.stringify(KEY) + ')]'), ['undefined', false]);
  pruefe('Visu: kein Verstoß gegen eine Sicherheitsrichtlinie', log.filter((t) => /Content Security Policy/i.test(t)).length, 0);
  await visu.zu();

  // Bewegungsmelder: Kamera im Offscreen-Dokument der Erweiterung, Meldungen im Tab der Visu (Server über http, nicht localhost)
  symcon.kamera = true;
  const offscreen = () => opt.ev(`chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((l) => l.length)`);
  const zustaende = (v) => v.ev('(window.__bew || []).filter((m) => m.t === "cam").map((m) => m.state)');
  const bewegt = (v) => v.ev('(window.__bew || []).some((m) => m.t === "motion")');
  const kv = await seite(ORIGIN + '/');
  await sleep(2500);
  pruefe('Bewegungsmelder in Symcon an, am Gerät nicht erlaubt: Zustand „blocked“, keine Kamera', [await zustaende(kv), await offscreen()], [['blocked'], 0]);
  await opt.ev(`chrome.storage.local.set({ camera: true }).then(() => 1)`);
  await sleep(2500);
  pruefe('Erlaubt, aber im Browser nicht freigegeben: „denied“', (await zustaende(kv)).pop(), 'denied');
  await send('Browser.grantPermissions', { origin: `chrome-extension://${geladen.id}`, permissions: ['videoCapture'] });
  await opt.ev(`chrome.runtime.sendMessage({ to: 'background', camera: 'changed' }).then(() => 1, () => 1)`);
  await sleep(3500);
  pruefe('Freigegeben: Kamera läuft im Offscreen-Dokument, Bewegung kommt im Tab an (Testbild bewegt sich)',
    [(await zustaende(kv)).pop(), await offscreen(), await bewegt(kv)], ['ok', 1, true]);
  pruefe('Kein Kamerabild im Tab: nur Zustand und Bewegung', await kv.ev('window.__bew.every((m) => Object.keys(m).every((k) => k === "t" || k === "state"))'), true);
  await kv.ev('window.__kamera(false)');
  await sleep(4500);
  pruefe('In Symcon ausgeschaltet: Offscreen-Dokument geschlossen, Kamera aus', await offscreen(), 0);
  await kv.ev('window.__kamera(true)');
  await sleep(2500);
  pruefe('Wieder eingeschaltet: Kamera läuft wieder', await offscreen(), 1);
  await kv.zu();
  await sleep(4500);
  pruefe('Visu geschlossen: Kamera aus', await offscreen(), 0);
  await opt.ev(`chrome.storage.local.set({ camera: false }).then(() => 1)`);
  await send('Browser.resetPermissions', {});
  symcon.kamera = false;

  const konsole = await seite(ORIGIN + '/console/');
  await sleep(1200);
  pruefe('Verwaltungskonsole: nichts läuft', await konsole.ev('window.__lauf || null'), null);
  await konsole.zu();

  // In Symcon gesperrt: nichts läuft mehr, die Einrichtung sagt es
  symcon.gesperrt = true;
  const gesperrt = await seite(ORIGIN + '/');
  await sleep(1500);
  pruefe('Gesperrt: in der Visu läuft nichts', await gesperrt.ev('window.__lauf || null'), null);
  await gesperrt.zu();
  await opt.ev(`document.querySelectorAll('.zeile button')[0].click(); 1`, true);
  await sleep(1000);
  pruefe('Gesperrt: Die Einrichtung nennt den Grund', (await stand())[1].split(' | ')[2], TEXTE.stDenied.message);
  symcon.gesperrt = false;

  // Entfernen: danach lädt die Visu nichts mehr
  await opt.ev(`document.querySelectorAll('.zeile button')[1].click(); 1`, true);
  await sleep(1000);
  pruefe('Entfernt: keine Inhaltsskripte mehr angemeldet, nichts mehr gespeichert',
    [await opt.ev(`chrome.scripting.getRegisteredContentScripts().then((l) => l.length)`), await opt.ev(`chrome.storage.local.get('connections').then((r) => r.connections.length)`)], [0, 0]);
  symcon.anfragen = [];
  const danach = await seite(ORIGIN + '/');
  await sleep(1500);
  pruefe('Entfernt: in der Visu läuft nichts mehr, keine Anfrage an den Hook', [await danach.ev('window.__lauf || null'), symcon.anfragen.filter((a) => a.includes('/hook/'))], [null, []]);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  const csp = log.filter((t) => /Content Security Policy/i.test(t));
  if (csp.length) console.log('     Chrome meldet: ' + csp[0].slice(0, 260));
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
