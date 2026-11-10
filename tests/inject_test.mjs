// Inhaltsskript (src/core.js + src/inject.js) in Headless-Chrome mit eigenem Profil. Ein Node-Server
// spielt Visu und Hooks nach; chrome.storage ist eine Attrappe, weil sich eine entpackte Erweiterung
// in aktuellem Chrome nicht mehr per Startparameter laden lässt.
//   node tests/inject_test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

// ── Nachgespielter Server ───────────────────────────────────────────────────────
const server = { verbindungen: [], abrufe: [] };
const seite = (inhalt = '') => `<!doctype html><meta charset="utf-8"><body><div id="visu">Visu</div>${inhalt}
<script>window.chrome = Object.assign(window.chrome || {}, { storage: { local: { get: function (k, cb) { cb({ connections: ${JSON.stringify(server.verbindungen)} }); } } } });</script>
<script src="/ext/core.js"></script><script src="/ext/inject.js"></script></body>`;
const skript = (name) => `window.__lauf = window.__lauf || {}; window.__lauf[${JSON.stringify(name)}] = (window.__lauf[${JSON.stringify(name)}] || 0) + 1;`;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = (t) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(t); };
  const js = (t) => { res.setHeader('Content-Type', 'application/javascript'); res.end(t); };
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.pathname.startsWith('/hook/')) server.abrufe.push(u.pathname + u.search);
  if (u.pathname === '/' || u.pathname === '/console/' || u.pathname === '/hook/seite') return html(seite());
  if (u.pathname === '/rahmen') return html('<!doctype html><body><iframe id="k" src="/"></iframe></body>');
  if (u.pathname.startsWith('/ext/')) return js(readFileSync(join(ROOT, 'src', u.pathname.slice(5)), 'utf8'));
  if (u.pathname === '/hook/a') return u.searchParams.get('t') === 'ok' ? json({ visuExtension: 1, name: 'A', scripts: ['/hook/a/start.js', '/hook/gemeinsam.js'] }) : (res.statusCode = 403, res.end());
  if (u.pathname === '/hook/b') return json({ visuExtension: 1, name: 'B', scripts: ['/hook/b/start.js', '/hook/gemeinsam.js'] });
  if (u.pathname === '/hook/fremd') return json({ visuExtension: 1, name: 'Fremd', scripts: ['/hook/fremd/start.js', 'https://boese.example/hook/x.js'] });
  if (u.pathname === '/hook/alt') return json({ visuExtension: 2, name: 'Alt', scripts: ['/hook/alt/start.js'] });
  if (u.pathname === '/hook/kaputt') return html('<html>kein JSON</html>');
  if (u.pathname === '/hook/leer') return json({ visuExtension: 1, name: 'Leer', scripts: [], info: 'aus' });
  const m = u.pathname.match(/^\/hook\/([a-z]+)\/start\.js$/) || u.pathname.match(/^\/hook\/(gemeinsam)\.js$/);
  if (m) return js(skript(m[1]));
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

// ── Chrome ──────────────────────────────────────────────────────────────────────
const profile = mkdtempSync(join(tmpdir(), 'visuext-chrome-'));
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, '--window-size=900,700', 'about:blank'], { stdio: 'ignore', detached: true });
async function cdpJson(p) { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${port}${p}`)).json(); } catch { await sleep(200); } } throw new Error('kein CDP'); }
class Cdp {
  constructor(u) { this.ws = new WebSocket(u); this.id = 0; this.p = new Map(); this.ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && this.p.has(m.id)) { const [a, b] = this.p.get(m.id); this.p.delete(m.id); m.error ? b(new Error(JSON.stringify(m.error))) : a(m.result); } }; this.ready = new Promise((r) => { this.ws.onopen = r; }); }
  send(method, params = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((a, b) => this.p.set(id, [a, b])); }
}
const aufraeumen = async () => { try { process.kill(-chrome.pid); } catch { /* weg */ } await sleep(300); rmSync(profile, { recursive: true, force: true }); srv.close(); };

try {
  const page = new Cdp((await cdpJson('/json/list')).find((t) => t.type === 'page').webSocketDebuggerUrl);
  await page.ready;
  await page.send('Runtime.enable');
  const ev = async (expr) => {
    const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const laden = async (pfad, verbindungen) => {
    server.verbindungen = verbindungen.map((url) => ({ url, name: 'x' }));
    server.abrufe = [];
    await page.send('Page.navigate', { url: ORIGIN + pfad });
    await sleep(900);
  };
  const lauf = () => ev('window.__lauf || null');

  await laden('/', [`${ORIGIN}/hook/a?t=ok`, `${ORIGIN}/hook/b`, `${ORIGIN}/hook/a?t=ok`]);
  pruefe('Zwei Module: jedes Skript läuft genau einmal, auch das gemeinsame und bei doppelter Verbindung', await lauf(), { a: 1, gemeinsam: 1, b: 1 });
  pruefe('Angehängte Skript-Elemente sind wieder entfernt', await ev('document.querySelectorAll("script[src^=\\"/hook/\\"], script[src*=\\"/hook/\\"]").length'), 0);

  await laden('/', [`${ORIGIN}/hook/a?t=falsch`, `${ORIGIN}/hook/kaputt`, `${ORIGIN}/hook/alt`, `${ORIGIN}/hook/leer`]);
  pruefe('Falscher Schlüssel, kein JSON, fremde Fassung, leere Liste: nichts läuft', await lauf(), null);

  await laden('/', [`${ORIGIN}/hook/fremd`]);
  pruefe('Beschreibung mit fremdem Skript: auch das eigene läuft nicht', [await lauf(), server.abrufe], [null, ['/hook/fremd']]);

  await laden('/', ['http://127.0.0.1:1/hook/a?t=ok', 'kein-url', `${ORIGIN}/console/x`]);
  pruefe('Verbindung eines anderen Servers und ungültige Einträge: kein Abruf', [await lauf(), server.abrufe], [null, []]);

  await laden('/console/', [`${ORIGIN}/hook/b`]);
  pruefe('Verwaltungskonsole: kein Abruf', [await lauf(), server.abrufe], [null, []]);
  await laden('/hook/seite', [`${ORIGIN}/hook/b`]);
  pruefe('Hook-Seite: kein Abruf der Beschreibung', [await lauf(), server.abrufe], [null, ['/hook/seite']]);

  await laden('/rahmen', [`${ORIGIN}/hook/b`]);
  pruefe('In einem Rahmen (Kachel): nichts läuft', [await ev('document.getElementById("k").contentWindow.__lauf || null'), server.abrufe], [null, []]);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
