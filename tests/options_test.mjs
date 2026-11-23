// Einrichtung (src/options.html + options.js) in Headless-Chrome mit eigenem Profil. Die Chrome-
// Schnittstellen (i18n, storage, permissions, scripting) sind Attrappen; der Node-Server spielt das
// Modul „Visu-Erweiterung“ (Vertrag 2: koppeln und Beschreibung).
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
const T = (k, wert) => TEXTE[k].message.replace('$1', wert);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

// Der gespeicherte Stand der Attrappe übersteht ein Neuladen (localStorage), wie chrome.storage.
const ATTRAPPE = `<script>
(function () {
  var T = ${JSON.stringify(TEXTE)};
  var z = window.__z = { store: JSON.parse(localStorage.getItem('__store') || '[]'), rechte: [], skript: null, erlauben: true };
  window.chrome = Object.assign(window.chrome || {}, {
    i18n: { getMessage: function (k, a) { return T[k] ? T[k].message.replace('$1', (a || [])[0]) : ''; }, getUILanguage: function () { return 'de'; } },
    storage: { local: { get: function (k) { return Promise.resolve(k === 'camera' ? { camera: z.kamera === true } : { connections: JSON.parse(JSON.stringify(z.store)) }); },
                        set: function (o) {
                          if ('camera' in o) z.kamera = o.camera;
                          if (o.connections) { z.store = JSON.parse(JSON.stringify(o.connections)); localStorage.setItem('__store', JSON.stringify(z.store)); }
                          return Promise.resolve(); } } },
    permissions: { request: function (p) { if (z.erlauben) p.origins.forEach(function (o) { if (z.rechte.indexOf(o) < 0) z.rechte.push(o); }); return Promise.resolve(z.erlauben); },
                   getAll: function () { return Promise.resolve({ origins: z.rechte.slice() }); },
                   remove: function (p) { z.rechte = z.rechte.filter(function (o) { return p.origins.indexOf(o) < 0; }); return Promise.resolve(true); } },
    scripting: { unregisterContentScripts: function () { if (!z.skript) return Promise.reject(new Error('keins')); z.skript = null; return Promise.resolve(); },
                 registerContentScripts: function (a) { z.skript = a; return Promise.resolve(); } }
  });
})();
</script>`;

// ── Nachgespieltes Modul ────────────────────────────────────────────────────────
const KEY = 'ab'.repeat(24), ID = 'ab12cd34';
const symcon = { name: '', gesperrt: false, fremd: false, anfragen: [] };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
  const status = (n) => { res.statusCode = n; res.end(); };
  if (u.pathname === '/ext/options.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(readFileSync(join(ROOT, 'src/options.html'), 'utf8').replace('<script src="core.js">', ATTRAPPE + '<script src="core.js">'));
  }
  if (u.pathname.startsWith('/ext/')) { res.setHeader('Content-Type', 'application/javascript'); return res.end(readFileSync(join(ROOT, 'src', u.pathname.slice(5)), 'utf8')); }
  if (u.pathname !== '/hook/visuext' || req.method !== 'POST') return status(404);
  let rumpf = '';
  req.on('data', (d) => { rumpf += d; });
  req.on('end', () => {
    let a = {};
    try { a = JSON.parse(rumpf); } catch { /* leer */ }
    const k = u.searchParams.get('k');
    symcon.anfragen.push({ adresse: req.url, typ: String(req.headers['content-type'] || '').split(';')[0], k, rumpf: a });
    if (k === 'pair') {
      if (a.code === '404404') return status(404); // Server ohne das Modul
      if (a.code === '111111') return json({ ok: true, visuExtension: 1, device: { id: ID, name: 'x' }, key: KEY });
      if (a.code !== '123456') return status(403);
      symcon.name = a.name || 'Browser';
      return json({ ok: true, visuExtension: 2, device: { id: ID, name: symcon.name }, key: KEY, address: '/hook/visuext' });
    }
    if (k === 'ext') {
      if (a.d !== ID || a.key !== KEY || symcon.gesperrt) return status(403);
      return json({ visuExtension: 2, name: 'Symcon Zuhause', version: '0.2', device: { id: ID, name: symcon.name },
        scripts: symcon.fremd ? ['https://boese.example/hook/x.js'] : [`/hook/visuext?k=script&d=${ID}&m=0&e=1&s=x`] });
    }
    status(404);
  });
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
  const oeffnen = async () => { await page.send('Page.navigate', { url: ORIGIN + '/ext/options.html' }); await sleep(900); };
  const koppeln = async (adresse, code, name = '') => {
    await ev(`document.getElementById('adresse').value = ${JSON.stringify(adresse)}; document.getElementById('code').value = ${JSON.stringify(code)};
      document.getElementById('name').value = ${JSON.stringify(name)}; document.getElementById('neu').requestSubmit()`);
    await sleep(900);
  };
  const zeilen = () => ev(`Array.prototype.map.call(document.querySelectorAll('.zeile'), (z) => [z.querySelector('.name').textContent, z.querySelector('.ort').textContent, z.querySelector('.status').textContent, z.querySelector('.status').className])`);
  const meldung = () => ev(`document.getElementById('meldung').textContent`);
  const zustand = () => ev(`[__z.store.map((c) => [c.origin, c.id, c.key === ${JSON.stringify(KEY)}, c.name, c.server]), __z.rechte, __z.skript && __z.skript.map((s) => [s.world, s.js, s.matches, s.runAt])]`);
  const pruefen = async () => { await ev(`document.querySelectorAll('.zeile button')[0].click()`); await sleep(700); };
  const LEER = [[], [], null];
  const nicht = (grund) => T('errNoManifest', grund);

  await oeffnen();
  pruefe('Start: Texte gesetzt, leere Liste, drei Schritte', [await ev('document.querySelector("h1").textContent'), await ev('document.querySelector(".leer").textContent'),
    await ev('document.getElementById("adresse").placeholder'), await ev('Array.prototype.map.call(document.querySelectorAll("ol li"), (l) => l.textContent)')],
    [T('extName'), T('optEmpty'), T('optPlaceholder'), [T('optStep1'), T('optStep2'), T('optStep3')]]);

  await koppeln('ftp://symcon.local', '123456');
  pruefe('Ungültige Adresse: Meldung, keine Anfrage, nichts gespeichert', [await meldung(), await zustand(), symcon.anfragen.length], [T('errAddress'), LEER, 0]);
  await koppeln(ORIGIN, '12345');
  pruefe('Code mit fünf Ziffern: Meldung, keine Anfrage', [await meldung(), await zustand(), symcon.anfragen.length], [T('errCode'), LEER, 0]);

  await ev('__z.erlauben = false');
  await koppeln(ORIGIN, '123456');
  pruefe('Freigabe abgelehnt: Meldung, der Code wird nicht verbraucht', [await meldung(), await zustand(), symcon.anfragen.length], [T('errPermission'), LEER, 0]);
  await ev('__z.erlauben = true');

  await koppeln(ORIGIN, '999999');
  pruefe('Falscher Code: nicht verbunden, Freigabe zurückgegeben', [await meldung(), await zustand()], [nicht(T('errPairDenied')), LEER]);
  await koppeln(ORIGIN, '404404');
  pruefe('Server ohne das Modul: eigener Hinweis', [await meldung(), await zustand()], [nicht(T('errPairMissing')), LEER]);
  await koppeln(ORIGIN, '111111');
  pruefe('Antwort einer anderen Fassung: abgelehnt, nichts gespeichert', [await meldung(), await zustand()], [nicht(T('stInvalid')), LEER]);
  await koppeln('http://127.0.0.1:1', '123456');
  pruefe('Server nicht erreichbar', [await meldung(), await zustand()], [nicht(T('stUnreachable')), LEER]);

  symcon.anfragen = [];
  await koppeln(`${ORIGIN}/#/kueche`, '123 456', ' Küche ');
  pruefe('Gekoppelt: Zeile mit Servername, Ort und Browsername, „Verbunden · Fassung“',
    await zeilen(), [['Symcon Zuhause', `${ORIGIN} · ${T('optDevice', 'Küche')}`, 'Verbunden · 0.2', 'status ok']]);
  pruefe('Gekoppelt: gespeichert, Server freigegeben, Inhaltsskripte angemeldet, Code und Name geleert',
    [await zustand(), await meldung(), await ev('[document.getElementById("code").value, document.getElementById("name").value]')],
    [[[[ORIGIN, ID, true, 'Küche', 'Symcon Zuhause']], [`${ORIGIN}/*`], [['MAIN', ['inject.js'], [`${ORIGIN}/*`], 'document_idle'], ['ISOLATED', ['core.js', 'bridge.js'], [`${ORIGIN}/*`], 'document_idle']]], '', ['', '']]);
  pruefe('Koppeln: Code ohne Leerzeichen und Name im Rumpf, als Text gesendet (keine Voranfrage)',
    symcon.anfragen.filter((a) => a.k === 'pair').map((a) => [a.adresse, a.typ, a.rumpf]), [['/hook/visuext?k=pair', 'text/plain', { code: '123456', name: 'Küche' }]]);
  pruefe('Der Schlüssel steht in keiner Adresse und nicht auf der Seite',
    [symcon.anfragen.some((a) => a.adresse.includes(KEY)), await ev(`document.documentElement.outerHTML.includes(${JSON.stringify(KEY)})`)], [false, false]);

  await koppeln(ORIGIN, '123456');
  pruefe('Derselbe Server noch einmal: Meldung, keine zweite Zeile', [await meldung(), (await zeilen()).length], [T('errDuplicate'), 1]);

  symcon.name = 'Küche neu';
  await pruefen();
  pruefe('In Symcon umbenannt: Name nach „Prüfen“ übernommen und gespeichert', [(await zeilen())[0][1], (await zustand())[0][0][3]], [`${ORIGIN} · ${T('optDevice', 'Küche neu')}`, 'Küche neu']);
  symcon.fremd = true;
  await pruefen();
  pruefe('Beschreibung mit fremdem Skript: abgelehnt', (await zeilen())[0].slice(2), [T('stForeign'), 'status fehler']);
  symcon.fremd = false;
  symcon.gesperrt = true;
  await pruefen();
  pruefe('In Symcon gesperrt oder entfernt: Hinweis, neu zu verbinden', (await zeilen())[0].slice(2), [T('stDenied'), 'status fehler']);
  symcon.gesperrt = false;

  await ev(`localStorage.setItem('__store', JSON.stringify([{ url: ${JSON.stringify(ORIGIN)} + '/hook/a?t=ok', name: 'Vertrag 1' }].concat(__z.store)))`);
  await oeffnen();
  pruefe('Neu geöffnet: Verbindung wieder da, Eintrag aus Vertrag 1 fällt weg, Inhaltsskripte neu angemeldet',
    [(await zeilen()).map((z) => z[0]), (await zustand())[2].map((s) => s[2])], [['Symcon Zuhause'], [[`${ORIGIN}/*`], [`${ORIGIN}/*`]]]);

  await ev(`__z.rechte = [${JSON.stringify(ORIGIN + '/*')}]; document.querySelectorAll('.zeile button')[1].click()`);
  await sleep(500);
  pruefe('Entfernen: Liste leer, Inhaltsskripte abgemeldet, Freigabe zurückgegeben', [(await zeilen()).length, await zustand()], [0, LEER]);
} catch (e) {
  fehler++;
  console.log('FEHL Ablauf: ' + e.message);
} finally {
  await aufraeumen();
}
console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
