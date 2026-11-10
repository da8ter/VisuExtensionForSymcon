# Ein Modul anbinden (Vertrag 1)

Die Visu-Erweiterung lädt Skripte deines Moduls ins oberste Fenster der Kachel-Visualisierung. Dein Modul braucht dafür nur einen Hook, der zwei Dinge ausliefert: eine Beschreibung und das Skript. Eine vollständige Vorlage liegt in [`examples/`](../examples/).

## Ablauf

1. Dein Modul registriert einen Hook und erzeugt je Instanz einen eigenen Schlüssel.
2. Das Formular des Moduls zeigt die **Verbindungsadresse**, zum Beispiel `/hook/mein-modul/<ID>?t=<Schlüssel>&k=ext`. Den Server setzt der Nutzer davor, den kennt nur sein Browser.
3. Der Nutzer trägt die Adresse in der Erweiterung ein und gibt den Server frei.
4. Bei jedem Laden der Visualisierung ruft die Erweiterung die Adresse ab, prüft die Beschreibung und hängt die genannten Skripte als `<script src>` an.

## Die Beschreibung

Die Verbindungsadresse antwortet mit JSON:

```json
{
  "visuExtension": 1,
  "name": "Mein Modul",
  "version": "1.0",
  "scripts": ["/hook/mein-modul/<ID>?t=<Schlüssel>&k=start.js"],
  "info": ""
}
```

| Feld | Pflicht | Bedeutung |
|------|---------|-----------|
| `visuExtension` | ja | Fassung des Vertrags, die Zahl `1`. |
| `name` | ja | Name in der Einrichtung, höchstens 100 Zeichen. Sinnvoll ist der Name der Instanz. |
| `scripts` | ja | Liste der Skript-Adressen, höchstens 8, auch leer. Relativ zum Server oder vollständig. |
| `version` | nein | Text oder Zahl, wird neben „Verbunden“ angezeigt. |
| `info` | nein | Hinweis für den Nutzer, wenn `scripts` leer ist, zum Beispiel „Funktion X ist ausgeschaltet“. |

Was die Erweiterung durchsetzt:

- Die Verbindungsadresse und jedes Skript liegen unter `/hook/` auf **demselben Server** (gleiches Protokoll, gleicher Name, gleicher Port).
- Ist ein einziges Skript unzulässig, lädt die Erweiterung von dieser Verbindung nichts.
- Antwortet die Adresse nicht mit Status 200 und gültigem JSON, lädt sie nichts.

Antworte mit `Cache-Control: no-store`. Die Erweiterung ruft die Beschreibung bei jedem Laden der Visualisierung neu ab; so wirken Änderungen an deinem Modul ohne Zutun des Nutzers.

## Das Skript

- Es läuft **einmal je Laden** der Visualisierung, zum Zeitpunkt `document_idle`, im obersten Fenster. Die Visualisierung lädt beim Seitenwechsel nicht neu: Dein Skript lebt also, bis der Nutzer die Seite neu lädt.
- Es läuft nicht in Kacheln, nicht in der Verwaltungskonsole (`/console`) und nicht auf Hook-Seiten.
- **Doppeltes Laden vertragen.** Dieselbe Verbindung kann doppelt eingetragen sein, und eine Kachel deines Moduls kann denselben Code ebenfalls ins Hauptfenster laden. Ein Merker am Fenster genügt (siehe Vorlage).
- **Nichts voraussetzen.** Der Aufbau der Visualisierung ist keine zugesicherte Schnittstelle von Symcon. Hänge eigene Elemente an `document.body` und fasse fremde nicht an.
- **Eindeutige Namen** für Globale, CSS-Klassen und `localStorage`-Schlüssel.
- Das Skript-Element wird nach dem Laden wieder entfernt. `document.currentScript` steht nur während der ersten Ausführung zur Verfügung.
- Das Modul muss ohne die Erweiterung weiter funktionieren. Die Erweiterung stellt deinem Skript bewusst nichts bereit.

Konfiguration bekommt das Skript am einfachsten, indem der Hook sie beim Ausliefern einsetzt (Platzhalter `/*CONFIG*/null` in der Vorlage). Lege dort nichts hinein, was nicht jeder Betrachter der Visualisierung sehen darf.

## Schlüssel und Sicherheit

- Schütze den Hook mit einem zufälligen Schlüssel je Instanz (`bin2hex(random_bytes(16))`), prüfe ihn mit `hash_equals` und antworte sonst mit 403. Hooks sind ohne das Passwort der Visualisierung erreichbar.
- Ein Skript der Erweiterung hat dieselben Möglichkeiten wie eine Kachel deines Moduls im Browser. Schreibende Hook-Aufrufe sollten trotzdem nur das Nötigste können.
- Texte aus Symcon nie als HTML einsetzen (`textContent` statt `innerHTML`).

## Geteilte Icons (optional)

Symcons `/icons.js` (Font Awesome) ist rund 3 MB groß. Damit sie nur einmal im Fenster der Visualisierung läuft, gibt es eine Konvention: den Platz `window.__symconIcons` mit der Form `{ v: 1, fa, css, fehler }`.

- Ist der Platz gefüllt (`fa` gesetzt), benutze ihn.
- Gibt es ihn nicht, lege ihn an, setze vor dem Laden `FontAwesomeConfig = { autoReplaceSvg: false, observeMutations: false, autoAddCss: false }` und lade `/icons.js`. Ohne diese Schalter würde Font Awesome Elemente der Visualisierung ersetzen.
- Bringt die Visualisierung selbst ein `FontAwesome` mit, fasse nichts an.

Die Funktion `icons()` in [`examples/start-script.js`](../examples/start-script.js) macht genau das.

## Prüfen

- Beschreibung abrufen: `curl 'http://<Server>/hook/mein-modul/<ID>?t=<Schlüssel>&k=ext'`. Ohne oder mit falschem Schlüssel muss 403 kommen.
- Erweiterung entpackt laden, Adresse eintragen: Die Einrichtung nennt den Grund, wenn etwas nicht passt.
- In der Visualisierung die Entwicklerwerkzeuge öffnen: Fehler deines Skripts stehen in der Konsole der Seite.

## Fassungen des Vertrags

`visuExtension: 1` ist diese Fassung. Neue Felder kommen abwärtskompatibel dazu; unbekannte Felder übergeht die Erweiterung. Ein Bruch bekäme die Zahl `2`; die Erweiterung soll dann beide Fassungen verstehen.

## English summary

A module connects through a hook protected by its own per-instance token. The **connection address** (any URL under `/hook/…`) returns JSON: `visuExtension` (must be `1`), `name`, `scripts` (up to 8 URLs, may be empty), optional `version` and `info`. Every script must be served from the same origin under `/hook/`; otherwise nothing from that connection is loaded. The extension fetches the description on every load of the visualization and appends each script once as a classic `<script src>` to the top window (not in tiles, the console or hook pages). Scripts must tolerate being loaded twice, must not rely on the structure of the visualization, and should use unique names. See [`examples/`](../examples/) for a PHP hook and a start script, including the optional shared icon slot `window.__symconIcons`.
