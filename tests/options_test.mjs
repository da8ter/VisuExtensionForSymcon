// Einrichtung (src/options.html + options.js) in Headless-Chrome mit eigenem Profil. Die Chrome-
// Schnittstellen (i18n, storage, permissions, scripting) sind Attrappen; der Node-Server spielt die Hooks.
//   node tests/options_test.mjs
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, rmSync, mkdtempSync } from 'node:fs';
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

const ATTRAPPE = `<script>
(function () {
  var T = ${JSON.stringify(TEXTE)};
  var z = window.__z = { store: [], rechte: [], skript: null, erlauben: true };
  window.chrome = Object.assign(window.chrome || {}, {
    i18n: { getMessage: function (k, a) { return T[k] ? T[k].message.replace('$1', (a || [])[0]) : ''; }, getUILanguage: function () { return 'de'; } },
    storage: { local: { get: function () { return Promise.resolve({ connections: JSON.parse(JSON.stringify(z.store)) }); },
                        set: function (o) { z.store = JSON.parse(JSON.stringify(o.connections)); return Promise.resolve(); } } },
    permissions: { request: function (p) { if (z.erlauben) p.origins.forEach(function (o) { if (z.rechte.indexOf(o) < 0) z.rechte.push(o); }); return Promise.resolve(z.erlauben); },
                   getAll: function () { return Promise.resolve({ origins: z.rechte.slice() }); },
                   remove: function (p) { z.rechte = z.rechte.filter(function (o) { return p.origins.indexOf(o) < 0; }); return Promise.resolve(true); } },
    scripting: { unregisterContentScripts: function () { if (!z.skript) return Promise.reject(new Error('keins')); z.skript = null; return Promise.resolve(); },
                 registerContentScripts: function (a) { z.skript = a; return Promise.resolve(); } }
  });
})();
</script>`;
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  if (u.pathname === '/ext/options.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(readFileSync(join(ROOT, 'src/options.html'), 'utf8').replace('<script src="core.js">', ATTRAPPE + '<script src="core.js">'));
  }
  if (u.pathname.startsWith('/ext/')) { res.setHeader('Content-Type', 'application/javascript'); return res.end(readFileSync(join(ROOT, 'src', u.pathname.slice(5)), 'utf8')); }
  if (u.pathname === '/hook/a') return u.searchParams.get('t') === 'ok' ? json({ visuExtension: 1, name: 'Benachrichtigungen', version: '1.2', scripts: ['/hook/a/start.js'] }) : (res.statusCode = 403, res.end());
  if (u.pathname === '/hook/leer') return json({ visuExtension: 1, name: 'Leer', scripts: [], info: 'Funktion ist ausgeschaltet' });
  if (u.pathname === '/hook/fremd') return json({ visuExtension: 1, name: 'Fremd', scripts: ['https://boese.example/hook/x.js'] });
  res.statusCode = 404; res.end();
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${srv.address().port}`;

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
  const eintragen = async (adresse) => {
    await ev(`document.getElementById('adresse').value = ${JSON.stringify(adresse)}; document.getElementById('neu').requestSubmit()`);
    await sleep(700);
  };
  const zeilen = () => ev(`Array.prototype.map.call(document.querySelectorAll('.zeile'), (z) => [z.querySelector('.name').textContent, z.querySelector('.ort').textContent, z.querySelector('.status').textContent, z.querySelector('.status').className])`);
  const meldung = () => ev(`document.getElementById('meldung').textContent`);
  const zustand = () => ev(`[__z.store.map((c) => c.name), __z.rechte, __z.skript && __z.skript.map((s) => [s.world, s.js, s.matches, s.runAt])]`);

  await page.send('Page.navigate', { url: ORIGIN + '/ext/options.html' });
  await sleep(900);
  pruefe('Start: Texte gesetzt, leere Liste', [await ev('document.querySelector("h1").textContent'), await ev('document.querySelector(".leer").textContent'), await ev('document.getElementById("adresse").placeholder')],
    [TEXTE.extName.message, TEXTE.optEmpty.message, TEXTE.optPlaceholder.message]);

  await eintragen('kein-hook');
  pruefe('Ungültige Adresse: Meldung, nichts gespeichert', [await meldung(), await zustand()], [TEXTE.errAddress.message, [[], [], null]]);

  await eintragen(`${ORIGIN}/hook/a?t=falsch`);
  pruefe('Falscher Schlüssel: nicht hinzugefügt, Freigabe zurückgegeben',
    [await meldung(), await zustand()], [TEXTE.errNoManifest.message.replace('$1', TEXTE.stHttp.message.replace('$1', '403')), [[], [], null]]);

  await eintragen(`${ORIGIN}/hook/fremd`);
  pruefe('Fremdes Skript: abgelehnt', [await meldung(), (await zustand())[0]], [TEXTE.errNoManifest.message.replace('$1', TEXTE.stForeign.message), []]);

  await eintragen(`${ORIGIN}/hook/a?t=ok`);
  pruefe('Gültig: Zeile mit Name, Ort ohne Schlüssel, „Verbunden · Fassung“', await zeilen(), [['Benachrichtigungen', `${ORIGIN}/hook/a`, 'Verbunden · 1.2', 'status ok']]);
  pruefe('Gültig: gespeichert, Server freigegeben, Inhaltsskript angemeldet, Feld geleert',
    [await zustand(), await meldung(), await ev('document.getElementById("adresse").value')],
    [[['Benachrichtigungen'], [`${ORIGIN}/*`], [['MAIN', ['inject.js'], [`${ORIGIN}/*`], 'document_idle'], ['ISOLATED', ['core.js', 'bridge.js'], [`${ORIGIN}/*`], 'document_idle']]], '', '']);

  await eintragen(`${ORIGIN}/hook/a?t=ok`);
  pruefe('Doppelt: Meldung, keine zweite Zeile', [await meldung(), (await zeilen()).length], [TEXTE.errDuplicate.message, 1]);

  await eintragen(`${ORIGIN}/hook/leer`);
  pruefe('Modul ohne Skripte: Hinweis des Moduls als Status', (await zeilen())[1], ['Leer', `${ORIGIN}/hook/leer`, 'Funktion ist ausgeschaltet', 'status fehler']);

  await ev('__z.erlauben = false');
  await eintragen('http://anderer.invalid/hook/x');
  pruefe('Freigabe abgelehnt: Meldung, nichts gespeichert', [await meldung(), (await zustand())[0].length], [TEXTE.errPermission.message, 2]);

  await page.send('Page.navigate', { url: ORIGIN + '/ext/options.html' });
  await sleep(900);
  pruefe('Neu geladen ohne gespeicherte Verbindungen der Attrappe: leer', (await zeilen()).length, 0);

  await ev('__z.erlauben = true');
  await eintragen(`${ORIGIN}/hook/a?t=ok`);
  await ev(`document.querySelectorAll('.zeile button')[1].click()`);
  await sleep(500);
  pruefe('Entfernen: Liste leer, Inhaltsskript abgemeldet, Freigabe zurückgegeben', [(await zeilen()).length, await zustand()], [0, [[], [], null]]);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
