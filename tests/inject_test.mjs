// Inhaltsskripte (libs/extension/inject.js fürs Seitenfenster, libs/extension/core.js + libs/extension/bridge.js für den abgeschotteten
// Bereich) in Headless-Chrome mit eigenem Profil, hier beide im selben Fenster. Ein Node-Server spielt
// Visu und das Modul „Visu-Erweiterung“ nach; chrome.storage ist eine Attrappe. Die echte Erweiterung prüft extension_test.mjs.
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
// Das Modul „Visu-Erweiterung“ (Vertrag 2): Beschreibung per POST mit Kennung und Schlüssel im Rumpf.
const KEY = 'ab'.repeat(24);
const server = { verbindungen: [], abrufe: [] };
const LADER = '<script src="/ext/inject.js"></script>', BRUECKE = '<script src="/ext/core.js"></script><script src="/ext/bridge.js"></script>';
const seite = (umgekehrt = false) => `<!doctype html><meta charset="utf-8"><body><div id="visu">Visu</div>
<script>window.chrome = Object.assign(window.chrome || {}, { storage: { local: { get: function (k, cb) { ${umgekehrt ? 'setTimeout(function () {' : ''} cb({ connections: ${JSON.stringify(server.verbindungen)} }); ${umgekehrt ? '}, 30);' : ''} } } } });</script>
${umgekehrt ? BRUECKE + LADER : LADER + BRUECKE}</body>`;
const skript = (name) => `(window.__lauf = window.__lauf || []).push(${JSON.stringify(name)});`;
const BESCHREIBUNG = {
  gut00001: { visuExtension: 2, name: 'Symcon', version: '0.2', device: { id: 'gut00001', name: 'Küche' }, scripts: ['/hook/visuext?k=script&m=0', '/hook/visuext?k=script&m=11', '/hook/visuext?k=script&m=12'] },
  alt00001: { visuExtension: 1, name: 'Alt', scripts: ['/hook/visuext?k=script&m=11'] },
  fremd001: { visuExtension: 2, name: 'Fremd', scripts: ['/hook/visuext?k=script&m=11', 'https://boese.example/hook/x.js'] },
};
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const html = (t) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(t); };
  const js = (t) => { res.setHeader('Content-Type', 'application/javascript'); res.end(t); };
  if (u.pathname.startsWith('/hook/')) server.abrufe.push(req.method + ' ' + u.pathname + u.search);
  if (u.pathname === '/' || u.pathname === '/console/' || u.pathname === '/hook/seite') return html(seite());
  if (u.pathname === '/umgekehrt') return html(seite(true));
  if (u.pathname === '/rahmen') return html('<!doctype html><body><iframe id="k" src="/"></iframe></body>');
  if (u.pathname.startsWith('/ext/')) return js(readFileSync(join(ROOT, 'libs/extension', u.pathname.slice(5)), 'utf8'));
  if (u.pathname === '/hook/visuext' && u.searchParams.get('k') === 'ext' && req.method === 'POST') {
    let rumpf = '';
    req.on('data', (d) => { rumpf += d; });
    req.on('end', () => {
      let a = {};
      try { a = JSON.parse(rumpf); } catch { /* leer */ }
      if (a.key !== KEY) { res.statusCode = 403; return res.end(); }
      if (a.d === 'kaputt01') return html('<html>kein JSON</html>');
      if (!BESCHREIBUNG[a.d]) { res.statusCode = 403; return res.end(); }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(BESCHREIBUNG[a.d]));
    });
    return;
  }
  if (u.pathname === '/hook/visuext' && u.searchParams.get('k') === 'script') {
    // Die Laufzeit (m=0) kommt absichtlich zuletzt an: ausgeführt werden muss sie trotzdem zuerst.
    const m = u.searchParams.get('m');
    return void setTimeout(() => js(skript(m)), m === '0' ? 250 : 0);
  }
  if (u.pathname === '/hook/b/start.js') return js(skript('b'));
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;
const verbindung = (id, mehr = {}) => ({ origin: ORIGIN, id, key: KEY, name: 'Küche', server: 'Symcon', ...mehr });

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
    server.verbindungen = verbindungen;
    server.abrufe = [];
    await page.send('Page.navigate', { url: ORIGIN + pfad });
    await sleep(1100);
  };
  const lauf = () => ev('window.__lauf || null');

  await laden('/', [verbindung('gut00001'), verbindung('gut00001')]);
  pruefe('Laufzeit zuerst, dann die Module in der Reihenfolge der Beschreibung, jedes genau einmal (auch bei doppeltem Eintrag)', await lauf(), ['0', '11', '12']);
  pruefe('Die Beschreibung wird einmal geholt, per POST', server.abrufe.filter((a) => a.includes('k=ext')), ['POST /hook/visuext?k=ext']);
  pruefe('Der Schlüssel steht in keiner Adresse', server.abrufe.some((a) => a.includes(KEY)), false);
  pruefe('Angehängte Skript-Elemente sind wieder entfernt', await ev('document.querySelectorAll("script[src*=\\"/hook/\\"]").length'), 0);

  await laden('/umgekehrt', [verbindung('gut00001')]);
  pruefe('Brücke vor dem Lader gestartet, Einstellungen kommen verzögert: läuft genauso', await lauf(), ['0', '11', '12']);

  await laden('/', []);
  await ev(`document.dispatchEvent(new CustomEvent('visu-ext:scripts', { detail: JSON.stringify(['https://boese.example/hook/x.js', '/console/x.js', 'javascript:window.__lauf=["boese"]', 5, ${JSON.stringify(ORIGIN)} + '/console/start.js', ${JSON.stringify(ORIGIN)} + '/hook/b/start.js']) })); 1`);
  await sleep(500);
  pruefe('Gefälschtes Ereignis der Seite: nur Adressen dieses Servers unter /hook/ werden angehängt', [await lauf(), await ev('typeof window.VisuExt')], [['b'], 'object']);

  await laden('/', [verbindung('gut00001', { key: 'cd'.repeat(24) }), verbindung('kaputt01'), verbindung('alt00001'), verbindung('unbekannt')]);
  pruefe('Falscher Schlüssel, kein JSON, Vertrag 1, unbekanntes Gerät: nichts läuft', await lauf(), null);

  await laden('/', [verbindung('fremd001')]);
  pruefe('Beschreibung mit fremdem Skript: auch das eigene läuft nicht', [await lauf(), server.abrufe], [null, ['POST /hook/visuext?k=ext']]);

  await laden('/', [verbindung('gut00001', { origin: 'http://127.0.0.1:1' }), { url: `${ORIGIN}/hook/a?t=ok`, name: 'Vertrag 1' }, 'kein-objekt', verbindung('a b')]);
  pruefe('Verbindung eines anderen Servers, Einträge aus Vertrag 1 und ungültige: kein Abruf', [await lauf(), server.abrufe], [null, []]);

  await laden('/console/', [verbindung('gut00001')]);
  pruefe('Verwaltungskonsole: kein Abruf', [await lauf(), server.abrufe], [null, []]);
  await laden('/hook/seite', [verbindung('gut00001')]);
  pruefe('Hook-Seite: kein Abruf der Beschreibung', [await lauf(), server.abrufe], [null, ['GET /hook/seite']]);

  await laden('/rahmen', [verbindung('gut00001')]);
  pruefe('In einem Rahmen (Kachel): nichts läuft', [await ev('document.getElementById("k").contentWindow.__lauf || null'), server.abrufe], [null, []]);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
