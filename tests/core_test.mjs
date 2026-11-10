// Prüfregeln aus src/core.js: Verbindungsadresse und Beschreibung, vor allem die Ablehnungen.
//   node tests/core_test.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ctx = vm.createContext({ URL });
vm.runInContext(readFileSync(fileURLToPath(new URL('../src/core.js', import.meta.url)), 'utf8'), ctx);
const core = ctx.VisuExt;
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};
const O = 'http://symcon.local:3777';
const gut = { visuExtension: 1, name: 'Probe', scripts: ['/hook/probe/1?t=abc&k=start.js'] };
const m = (mehr, origin = O) => core.checkManifest({ ...gut, ...mehr }, origin);

// ── Adresse ─────────────────────────────────────────────────────────────────────
pruefe('Adresse: Hook mit Schlüssel', core.parseAddress(`  ${O}/hook/probe/1?t=abc&k=ext#x `), { ok: true, url: `${O}/hook/probe/1?t=abc&k=ext`, origin: O });
pruefe('Adresse: https', core.parseAddress('https://haus.example/hook/a').ok, true);
pruefe('Adresse: abgelehnt (kein Hook, nur /hook/, anderes Schema, Zugangsdaten, kein Text, Pfad nach oben)',
  ['http://symcon.local:3777/', `${O}/hook/`, 'javascript:alert(1)', 'file:///hook/a', 'http://u:p@symcon.local/hook/a', 42, `${O}/hook/../console/x`, `${O}/hook/%2e%2e/console/x`, '/hook/a']
    .map((a) => core.parseAddress(a).ok), [false, false, false, false, false, false, false, false, false]);

// ── Beschreibung ────────────────────────────────────────────────────────────────
pruefe('Beschreibung: gültig, Skript als volle Adresse', m({}), { ok: true, name: 'Probe', version: '', info: '', scripts: [`${O}/hook/probe/1?t=abc&k=start.js`] });
pruefe('Beschreibung: Fassung als Zahl, Hinweis, doppelte Skripte einmal',
  m({ version: 2, info: ' aus ', scripts: ['/hook/a.js', `${O}/hook/a.js`, '/hook/b.js'] }),
  { ok: true, name: 'Probe', version: '2', info: 'aus', scripts: [`${O}/hook/a.js`, `${O}/hook/b.js`] });
pruefe('Beschreibung: ohne Skripte erlaubt', m({ scripts: [] }).scripts, []);
pruefe('Beschreibung: lange Texte gekürzt', [m({ name: 'x'.repeat(500) }).name.length, m({ info: 'y'.repeat(900) }).info.length], [100, 300]);
pruefe('Beschreibung: falsches Format', [null, [], 'text', 7].map((d) => core.checkManifest(d, O).error), ['format', 'format', 'format', 'format']);
pruefe('Beschreibung: falsche oder fehlende Fassung', [m({ visuExtension: 2 }).error, m({ visuExtension: '1' }).error, m({ visuExtension: undefined }).error], ['contract', 'contract', 'contract']);
pruefe('Beschreibung: Name fehlt', [m({ name: '' }).error, m({ name: 5 }).error, m({ name: '   ' }).error], ['name', 'name', 'name']);
pruefe('Beschreibung: Skriptliste fehlt oder zu lang', [m({ scripts: 'a' }).error, m({ scripts: Array(9).fill('/hook/a.js') }).error, m({ scripts: Array(8).fill('/hook/a.js') }).ok], ['scripts', 'scripts', true]);
pruefe('Beschreibung: fremde und unerlaubte Skripte lehnen ALLES ab',
  ['https://boese.example/hook/x.js', '//boese.example/hook/x.js', 'http://symcon.local:3778/hook/x.js', 'https://symcon.local:3777/hook/x.js',
   '/console/x.js', '/hook/../x.js', '/hook/%2e%2e/x.js', 'javascript:alert(1)', 'data:text/javascript,alert(1)', 5, '/hook/']
    .map((s) => m({ scripts: ['/hook/gut.js', s] }).error), Array(11).fill('script'));
pruefe('Beschreibung: Server der Verbindung entscheidet', m({ scripts: [`${O}/hook/a.js`] }, 'http://anderer.local:3777').error, 'script');

console.log(`\n${anzahl} Zusicherungen, ${fehler} Abweichung(en).`);
process.exit(fehler === 0 ? 0 : 1);
