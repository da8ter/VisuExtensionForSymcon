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
const TEXTE = JSON.parse(readFileSync(join(ROOT, 'src/_locales/de/messages.json'), 'utf8'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

// ── Nachgespielter Symcon-Server ────────────────────────────────────────────────
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const html = (t) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(t); };
  if (u.pathname === '/') return html('<!doctype html><meta charset="utf-8"><title>Visu</title><body><div id="visu">Visu</div><iframe id="k" src="/kachel"></iframe></body>');
  if (u.pathname === '/kachel' || u.pathname === '/console/') return html('<!doctype html><title>x</title><body>x</body>');
  if (u.pathname === '/hook/a') return u.searchParams.get('t') === 'ok' ? json({ visuExtension: 1, name: 'Probe-Modul', version: '1.0', scripts: ['/hook/a/start.js?t=ok'] }) : (res.statusCode = 403, res.end());
  if (u.pathname === '/hook/a/start.js') { res.setHeader('Content-Type', 'application/javascript'); return res.end('window.__lauf = (window.__lauf || 0) + 1;'); }
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://symcon.test:${srv.address().port}`;

// ── Erweiterung: Kopie mit vorab erteiltem Zugriff (die Freigabe-Abfrage kann hier niemand anklicken) ──
const arbeit = mkdtempSync(join(tmpdir(), 'visuext-echt-'));
const ext = join(arbeit, 'ext'), profil = join(arbeit, 'profil');
cpSync(join(ROOT, 'src'), ext, { recursive: true });
const manifest = JSON.parse(readFileSync(join(ext, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://*/*'];
writeFileSync(join(ext, 'manifest.json'), JSON.stringify(manifest));

// ── Chrome über die Protokoll-Pipe (nur so lässt sich eine entpackte Erweiterung laden) ─────────────
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profil}`,
  '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP symcon.test 127.0.0.1',
  '--window-size=900,700', 'about:blank'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], detached: true });
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

  // Einrichtung: Verbindung hinzufügen
  const opt = await seite(`chrome-extension://${geladen.id}/options.html`);
  await sleep(800);
  await opt.ev(`document.getElementById('adresse').value = ${JSON.stringify(ORIGIN + '/hook/a?t=ok')}; document.getElementById('neu').requestSubmit(); 1`, true);
  await sleep(1500);
  pruefe('Einrichtung: Verbindung mit Name und „Verbunden“',
    await opt.ev(`[document.getElementById('meldung').textContent].concat(Array.prototype.map.call(document.querySelectorAll('.zeile'), (z) => z.querySelector('.name').textContent + ' | ' + z.querySelector('.status').textContent))`),
    ['', 'Probe-Modul | ' + TEXTE.stConnected.message + ' · 1.0']);
  pruefe('Inhaltsskripte angemeldet: eines im Fenster der Seite, eines mit Zugriff auf die Einstellungen',
    await opt.ev(`chrome.scripting.getRegisteredContentScripts().then((l) => l.map((s) => [s.world, s.js.join('+'), s.matches.join(' ')]).sort())`),
    [['ISOLATED', 'core.js+bridge.js', ORIGIN + '/*'], ['MAIN', 'inject.js', ORIGIN + '/*']]);

  // Visu: das Skript des Moduls muss laufen, obwohl der Server nicht localhost heißt
  const visu = await seite(ORIGIN + '/');
  await sleep(2000);
  pruefe('Visu: Skript des Moduls läuft genau einmal, nicht im Rahmen, keine Reste im Fenster',
    [await visu.ev('window.__lauf || 0'), await visu.ev('document.getElementById("k").contentWindow.__lauf || 0'), await visu.ev('typeof window.VisuExt')], [1, 0, 'undefined']);
  pruefe('Visu: kein Verstoß gegen eine Sicherheitsrichtlinie', log.filter((t) => /Content Security Policy/i.test(t)).length, 0);
  await visu.zu();

  const konsole = await seite(ORIGIN + '/console/');
  await sleep(1200);
  pruefe('Verwaltungskonsole: nichts läuft', await konsole.ev('window.__lauf || 0'), 0);
  await konsole.zu();

  // Entfernen: danach lädt die Visu nichts mehr
  await opt.ev(`document.querySelectorAll('.zeile button')[1].click(); 1`, true);
  await sleep(1000);
  pruefe('Entfernt: keine Inhaltsskripte mehr angemeldet', await opt.ev(`chrome.scripting.getRegisteredContentScripts().then((l) => l.length)`), 0);
  const danach = await seite(ORIGIN + '/');
  await sleep(1500);
  pruefe('Entfernt: in der Visu läuft nichts mehr', await danach.ev('window.__lauf || 0'), 0);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  const csp = log.filter((t) => /Content Security Policy/i.test(t));
  if (csp.length) console.log('     Chrome meldet: ' + csp[0].replace(/t=[0-9a-z]+/g, 't=…').slice(0, 260));
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
