// Bewegungserkennung der Erweiterung (libs/extension/motion.js) mit erzeugten Graubildern.
//   node tests/motion_test.mjs
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ctx = vm.createContext({ Uint8Array, Math });
vm.runInContext(readFileSync(fileURLToPath(new URL('../libs/extension/motion.js', import.meta.url)), 'utf8'), ctx);
const M = ctx.VisuExtMotion;
let fehler = 0, anzahl = 0;
const pruefe = (name, ist, soll) => {
  anzahl++;
  const a = JSON.stringify(ist), b = JSON.stringify(soll);
  if (a !== b) { fehler++; console.log(`FEHL ${name}\n     ist:  ${a}\n     soll: ${b}`); } else console.log(`OK   ${name}`);
};

// Hintergrund mit Struktur (Raum), leicht verrauscht wie ein Kamerabild
let saat = 7;
const zufall = () => { saat = (saat * 1103515245 + 12345) & 0x7fffffff; return saat / 0x7fffffff; };
const raum = () => { const b = new Uint8Array(M.W * M.H); for (let i = 0; i < b.length; i++) b[i] = 60 + ((i % M.W) * 2) + Math.floor(zufall() * 8); return b; };
const heller = (b, d) => b.map((v) => Math.min(255, v + d));
const mitFleck = (b, groesse) => { const c = b.slice(); for (let y = 10; y < 10 + groesse; y++) for (let x = 20; x < 20 + groesse; x++) c[y * M.W + x] = 240; return c; };
const stufen = (n) => [1, 2, 3].filter((l) => M.isMotion(n, l));

const a = raum(), b = raum();
pruefe('Ruhiger Raum mit Bildrauschen: keine Bewegung auf keiner Stufe', stufen(M.changed(a, b)), []);
pruefe('Licht wird heller (alle Pixel +40): keine Bewegung', stufen(M.changed(a, heller(b, 40))), []);
pruefe('Großer Fleck (20 × 20, z. B. eine Person nah): alle Stufen', stufen(M.changed(a, mitFleck(b, 20))), [1, 2, 3]);
pruefe('Mittlerer Fleck (10 × 10): mittel und hoch', stufen(M.changed(a, mitFleck(b, 10))), [2, 3]);
pruefe('Kleiner Fleck (7 × 7): nur hoch', stufen(M.changed(a, mitFleck(b, 7))), [3]);
pruefe('Winziger Fleck (4 × 4, z. B. Insekt): keine Stufe', stufen(M.changed(a, mitFleck(b, 4))), []);
pruefe('Fleck und gleichzeitig heller: erkannt', stufen(M.changed(a, heller(mitFleck(b, 20), 30))), [1, 2, 3]);
pruefe('Ohne Vorbild (erstes Bild): nichts', M.changed(null, a), 0);
const rgba = new Uint8Array(M.W * M.H * 4).fill(0);
rgba[0] = 255; rgba[5] = 255; rgba[10] = 255;
pruefe('Graustufen aus RGBA: Rot, Grün, Blau gewichtet', Array.from(M.gray(rgba).slice(0, 3)), [76, 153, 25]);

console.log(fehler ? `\n${fehler} von ${anzahl} Prüfungen fehlgeschlagen` : `\nAlle ${anzahl} Prüfungen bestanden.`);
process.exit(fehler ? 1 : 0);
