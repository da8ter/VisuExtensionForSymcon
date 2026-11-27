// Prüfregeln aus libs/extension/core.js (Vertrag 2): Adresse, Code, Verbindung, Kopplung und Beschreibung, vor allem die Ablehnungen.
//   node tests/core_test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const lies = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const ctx = vm.createContext({ URL });
vm.runInContext(lies('../libs/extension/core.js'), ctx);
const core = ctx.VisuExt;
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};
const O = 'http://symcon.local:3777';
const KEY = 'ab'.repeat(24);
const gut = { visuExtension: 2, name: 'Visu-Erweiterung', version: '0.2', device: { id: 'a1b2c3d4', name: 'Küche' }, scripts: ['/hook/visuext?k=script&d=a1b2c3d4&m=0&e=1&s=x'] };
const m = (mehr, origin = O) => core.checkManifest({ ...gut, ...mehr }, origin);

// ── Adresse der Visualisierung ──────────────────────────────────────────────────
pruefe('Adresse: mit Pfad und Anker, ohne Schema, https', [`  ${O}/#/kueche `, 'symcon.local:3777', 'https://haus.example/visu/'].map((a) => core.parseServer(a)),
  [{ ok: true, origin: O }, { ok: true, origin: O }, { ok: true, origin: 'https://haus.example' }]);
pruefe('Adresse: abgelehnt (leer, anderes Schema, Zugangsdaten, kein Text, Unsinn)',
  ['', '   ', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://symcon.local', 'http://u:p@symcon.local', 42, null, 'http://', 'http://a b'].map((a) => core.parseServer(a).ok), Array(10).fill(false));

// ── Code ────────────────────────────────────────────────────────────────────────
pruefe('Code: sechs Ziffern, Leerzeichen und Striche zählen nicht', [' 123 456 ', '123-456', '000001'].map((c) => core.parseCode(c)),
  [{ ok: true, code: '123456' }, { ok: true, code: '123456' }, { ok: true, code: '000001' }]);
pruefe('Code: abgelehnt', ['12345', '1234567', 'abcdef', '', 123456, null].map((c) => core.parseCode(c).ok), Array(6).fill(false));

// ── Gespeicherte Verbindung ─────────────────────────────────────────────────────
pruefe('Verbindung: gültig, Namen gekürzt', core.checkConnection({ origin: O, id: 'a1b2c3d4', key: KEY, name: ' Küche ', server: 'x'.repeat(300), mehr: 1 }),
  { origin: O, id: 'a1b2c3d4', key: KEY, name: 'Küche', server: 'x'.repeat(100) });
pruefe('Verbindung: abgelehnt (Vertrag 1, Ursprung mit Pfad, kaputte Kennung, kurzer Schlüssel, kein Objekt)',
  [{ url: `${O}/hook/a?t=x`, name: 'alt' }, { origin: O + '/', id: 'a1b2c3d4', key: KEY }, { origin: O, id: 'a b', key: KEY }, { origin: O, id: 'a1b2c3d4', key: 'kurz' },
   { origin: 'javascript:1', id: 'a1b2c3d4', key: KEY }, null, 'text'].map((c) => core.checkConnection(c)), Array(7).fill(null));

// ── Antwort auf das Koppeln ─────────────────────────────────────────────────────
const paar = { ok: true, visuExtension: 2, device: { id: 'a1b2c3d4', name: 'Küche' }, key: KEY, address: '/hook/visuext' };
pruefe('Kopplung: gültig', core.checkPairing(paar), { ok: true, id: 'a1b2c3d4', key: KEY, name: 'Küche' });
pruefe('Kopplung: abgelehnt (nicht ok, andere Fassung, ohne Gerät, ohne Schlüssel, kein Objekt)',
  [{ ...paar, ok: false }, { ...paar, visuExtension: 1 }, { ...paar, device: null }, { ...paar, key: '' }, null, []].map((p) => core.checkPairing(p).error),
  ['format', 'contract', 'format', 'format', 'format', 'format']);

// ── Beschreibung ────────────────────────────────────────────────────────────────
pruefe('Beschreibung: gültig, Skript als volle Adresse', m({}),
  { ok: true, name: 'Visu-Erweiterung', version: '0.2', info: '', device: { id: 'a1b2c3d4', name: 'Küche' }, scripts: [`${O}/hook/visuext?k=script&d=a1b2c3d4&m=0&e=1&s=x`] });
pruefe('Beschreibung: Fassung als Zahl, doppelte Skripte einmal, ohne Gerät',
  m({ version: 2, device: undefined, scripts: ['/hook/a.js', `${O}/hook/a.js`, '/hook/b.js'] }),
  { ok: true, name: 'Visu-Erweiterung', version: '2', info: '', device: { id: '', name: '' }, scripts: [`${O}/hook/a.js`, `${O}/hook/b.js`] });
pruefe('Beschreibung: falsches Format', [null, [], 'text', 7].map((d) => core.checkManifest(d, O).error), ['format', 'format', 'format', 'format']);
pruefe('Beschreibung: Vertrag 1 und fehlende Fassung abgelehnt', [m({ visuExtension: 1 }).error, m({ visuExtension: '2' }).error, m({ visuExtension: undefined }).error], ['contract', 'contract', 'contract']);
pruefe('Beschreibung: Name fehlt', [m({ name: '' }).error, m({ name: 5 }).error], ['name', 'name']);
pruefe('Beschreibung: Skriptliste fehlt oder zu lang', [m({ scripts: 'a' }).error, m({ scripts: Array(17).fill('/hook/a.js') }).error, m({ scripts: Array(16).fill('/hook/a.js') }).ok], ['scripts', 'scripts', true]);
pruefe('Beschreibung: fremde und unerlaubte Skripte lehnen ALLES ab',
  ['https://boese.example/hook/x.js', '//boese.example/hook/x.js', 'http://symcon.local:3778/hook/x.js', 'https://symcon.local:3777/hook/x.js',
   '/console/x.js', '/hook/../x.js', '/hook/%2e%2e/x.js', 'javascript:alert(1)', 'data:text/javascript,alert(1)', 5, '/hook/']
    .map((s) => m({ scripts: ['/hook/gut.js', s] }).error), Array(11).fill('script'));
pruefe('Beschreibung: Server der Verbindung entscheidet', m({ scripts: [`${O}/hook/a.js`] }, 'http://anderer.local:3777').error, 'script');

// ── Anfragen ────────────────────────────────────────────────────────────────────
const c = { origin: O, id: 'a1b2c3d4', key: KEY };
const ext = core.manifestRequest(c), pair = core.pairRequest(O, '123456', 'Küche');
pruefe('Anfragen: Schlüssel und Code stehen im Rumpf, nie in der Adresse',
  [ext.url, ext.init.method, JSON.parse(ext.init.body), ext.url.includes(KEY), pair.url, JSON.parse(pair.init.body), ext.init.headers === undefined],
  [`${O}/hook/visuext?k=ext`, 'POST', { d: 'a1b2c3d4', key: KEY }, false, `${O}/hook/visuext?k=pair`, { code: '123456', name: 'Küche' }, true]);

// ── Texte ───────────────────────────────────────────────────────────────────────
const de = JSON.parse(lies('../libs/extension/_locales/de/messages.json')), en = JSON.parse(lies('../libs/extension/_locales/en/messages.json'));
const quelle = lies('../libs/extension/options.js') + lies('../libs/extension/options.html') + lies('../libs/extension/manifest.json');
// Verlangt: jeder Schlüssel, den t('…'), data-i18n oder __MSG_…__ nennt. Erwähnt: jeder, der irgendwo in Anführungszeichen steht.
const verlangt = new Set([...quelle.matchAll(/\bt\('(\w+)'/g), ...quelle.matchAll(/data-i18n(?:-placeholder)?="(\w+)"/g), ...quelle.matchAll(/__MSG_(\w+)__/g)].map((x) => x[1]));
const erwaehnt = new Set([...verlangt, ...[...quelle.matchAll(/'(\w+)'/g)].map((x) => x[1])]);
pruefe('Texte: jeder benutzte Schlüssel ist übersetzt, keiner übrig, de und en gleich',
  [[...verlangt].filter((k) => !de[k]).sort(), Object.keys(de).filter((k) => !erwaehnt.has(k)).sort(), JSON.stringify(Object.keys(de)) === JSON.stringify(Object.keys(en))], [[], [], true]);

console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
