# Ein Modul andocken (Vertrag 2)

Die Browser-Erweiterung verbindet sich je Server mit genau einer Instanz des Symcon-Moduls „Visu-Erweiterung“. Dein Modul dockt in Symcon an diese Instanz an. Es braucht dafür keinen eigenen Hook, keinen eigenen Schlüssel und kein Adressfeld im Formular: Sein Skript liefert die Visu-Erweiterung aus, und Nachrichten laufen über ihren Kanal zu den gekoppelten Browsern.

```
Browser (Erweiterung) ──/hook/visuext──▶ Visu-Erweiterung ──Datenfluss──▶ dein Modul
```

Eine vollständige Vorlage liegt in [`examples/`](../examples/). Wie Erweiterung und Visu-Erweiterung miteinander sprechen (Koppeln, Beschreibung, Kanal), steht in [vertrag-2.md](vertrag-2.md); zum Andocken musst du das nicht kennen.

## Andocken

1. In die `module.json` des Moduls:
   ```json
   "parentRequirements": ["{A5B87602-1C34-4981-89A5-62A0735CB359}"],
   "implemented":        ["{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}"]
   ```
2. `GetCompatibleParents()` nennt die Visu-Erweiterung (`{CB9C6C38-9B97-45CA-BFB5-EC7F936AF3FF}`) mit `type: "connect"`. Das Modul muss ohne sie weiter funktionieren (`HasActiveParent()` prüfen).
3. `ReceiveData()` beantwortet drei Anfragen. Die Rückgabe ist die Antwort; `''` heißt „nicht für mich“.

| Anfrage | Felder | Antwort |
|---|---|---|
| `Describe` | `Target: 0` | JSON `{instance, name, version, active, info}`. Mit `active: false` lädt die Erweiterung das Skript nicht; `info` nennt den Grund. |
| `Script` | `Target: <Instanz>`, `Device: {id, name}` | Der Skripttext (JavaScript), mit eingesetzter Konfiguration. Höchstens rund 1 MB. |
| `Event` | `Target: <Instanz>`, `Device: {id, name}`, `Data` | `''` oder JSON. Eine Antwort geht als Nachricht an genau dieses Gerät zurück. |

Jedes Paket trägt `DataID` (`{9E7FA1CF-…}`), `Action` und `Target` in dieser Reihenfolge. Mit `SetReceiveDataFilter('.*"Target":(0|<Instanz>)[,}].*')` kommen nur die eigenen Pakete an; `ReceiveData()` prüft `Target` trotzdem selbst.

4. Senden an die Geräte mit `SendDataToParent()` (DataID `{A5B87602-…}`):

| Aktion | Felder | Antwort |
|---|---|---|
| `Send` | `Instance`, `Device` (Kennung oder `''` für alle), `Data` | `{ok, sent}`. `sent` zählt Verbindungen, bestätigt aber keine Zustellung. |
| `Devices` | `Instance` | `{ok, devices: [{id, name, online}]}`: die Geräte, auf denen das Modul läuft. |

`GetCompatibleParents()` gibt es ab Symcon 8.2.

## Das Skript

- Die Erweiterung hängt es **einmal je Laden** der Visualisierung als `<script src>` ins oberste Fenster. Die Visualisierung lädt beim Seitenwechsel nicht neu: Dein Skript lebt, bis der Nutzer die Seite neu lädt.
- Es läuft nicht in Kacheln, nicht in der Verwaltungskonsole (`/console`) und nicht auf Hook-Seiten.
- **Doppeltes Laden vertragen.** Eine Kachel deines Moduls kann denselben Code ebenfalls ins Hauptfenster laden. Ein Merker am Fenster genügt (siehe Vorlage).
- **Nichts voraussetzen.** Der Aufbau der Visualisierung ist keine zugesicherte Schnittstelle von Symcon. Hänge eigene Elemente an `document.body` und fasse fremde nicht an.
- **Eindeutige Namen** für Globale, CSS-Klassen und `localStorage`-Schlüssel.
- Das Skript-Element wird nach dem Laden wieder entfernt. `document.currentScript` steht nur während der ersten Ausführung zur Verfügung.
- Dein Modul muss ohne die Erweiterung weiter funktionieren.

Konfiguration bekommt das Skript, indem dein Modul sie beim Ausliefern einsetzt (Platzhalter `/*CONFIG*/null` in der Vorlage). Die Anfrage `Script` nennt das Gerät, du kannst also je Browser anders antworten.

### Der Kanal zu deinem Modul

Den Kanal zu Symcon stellt die Laufzeit `window.visuExt` bereit. Sie ist das erste Skript der Beschreibung, die Reihenfolge der Ausführung ist aber offen. Deshalb über die Warteliste holen:

```js
(window.visuExtReady = window.visuExtReady || []).push(function (ext) {
  ext.on(INSTANZ, function (daten) { /* Nachricht des eigenen Moduls (Aktion „Send“) */ });
  ext.send(INSTANZ, { taste: 3 });           // an das eigene Modul (Aktion „Event“)
  ext.onState(function (verbunden) { });     // Kanal steht / ist abgerissen
});
```

| | |
|---|---|
| `ext.v` | Fassung des Vertrags, `2` |
| `ext.device` | `{id, name}` des gekoppelten Browsers |
| `ext.connected()` | `true`, solange der Kanal steht und das Gerät angemeldet ist |
| `ext.send(instanz, daten)` | Schickt `daten` an das Modul. Ohne Kanal wartet die Nachricht (höchstens 50) und die Rückgabe ist `false`. |
| `ext.on(instanz, fn)` | Empfänger für Nachrichten des Moduls; die Rückgabe meldet ihn wieder ab |
| `ext.onState(fn)` | `fn(true/false)` bei jedem Wechsel; sofort, falls der Kanal schon steht |
| `ext.wake()` | Weckt das Gerät aus dem Bildschirmschoner der Visu-Erweiterung, bevor das Skript etwas Wichtiges zeigt |

`INSTANZ` ist die Instanz-ID des eigenen Moduls; das Modul setzt sie beim Ausliefern in das Skript ein.

Nachrichten sind JSON, höchstens rund 64 kB je Nachricht. `Send` bestätigt keine Zustellung: Ist ein Browser gerade nicht verbunden, bekommt er die Nachricht nicht nachgereicht. Was ein Gerät beim Verbinden wissen muss, holt sich das Skript in `onState` selbst ab.

## Sicherheit

- Das Skript läuft im Fenster der Visualisierung, mit denselben Möglichkeiten wie eine Kachel deines Moduls. Lege nichts hinein, was nicht jeder Betrachter dieser Visualisierung sehen darf.
- Ereignisse (`Event`) kommen von einem gekoppelten, nicht gesperrten Browser; die Visu-Erweiterung nennt dir, von welchem. Behandle den Inhalt trotzdem wie jede Eingabe von außen: prüfen, und nur das Nötigste auslösen.
- Texte aus Symcon nie als HTML einsetzen (`textContent` statt `innerHTML`).
- Der Nutzer kann dein Modul je Gerät abschalten und Geräte sperren; dein Skript wird dort dann nicht mehr ausgeliefert.

## Geteilte Icons (optional)

Symcons `/icons.js` (Font Awesome) ist rund 3 MB groß. Damit sie nur einmal im Fenster der Visualisierung läuft, gibt es eine Konvention: den Platz `window.__symconIcons` mit der Form `{ v: 1, fa, css, fehler }`.

- Ist der Platz gefüllt (`fa` gesetzt), benutze ihn.
- Gibt es ihn nicht, lege ihn an, setze vor dem Laden `FontAwesomeConfig = { autoReplaceSvg: false, observeMutations: false, autoAddCss: false }` und lade `/icons.js`. Ohne diese Schalter würde Font Awesome Elemente der Visualisierung ersetzen.
- Bringt die Visualisierung selbst ein `FontAwesome` mit, fasse nichts an.

Die Funktion `icons()` in [`examples/start-script.js`](../examples/start-script.js) macht genau das.

## Prüfen

1. Instanz „Visu-Erweiterung“ anlegen, dein Modul als Kind verbinden: Es erscheint im Formular unter „Angedockte Module“ mit Name, Version und Zustand.
2. Einen Browser koppeln (Erweiterung entpackt laden, Adresse und Code eintragen) und die Visualisierung neu laden.
3. In den Entwicklerwerkzeugen der Visualisierung: `visuExt.connected()` ist `true`, Fehler deines Skripts stehen in der Konsole der Seite.
4. Aus Symcon senden (Aktion `Send`) und im Debug-Fenster deiner Instanz die Ereignisse des Skripts ansehen.

## Fassungen des Vertrags

`visuExtension: 2` ist diese Fassung. Fassung 1 (je Modul ein eigener Hook mit Schlüssel und eine eigene Adresse in der Erweiterung) gibt es nicht mehr; die Erweiterung ab 0.2 spricht nur Fassung 2.

## English summary

A module docks onto the Symcon instance “Visu Extension” through the data flow and needs no hook, token or address field of its own. Add `parentRequirements` `{A5B87602-1C34-4981-89A5-62A0735CB359}` and `implemented` `{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}` to its `module.json`, offer the Visu Extension in `GetCompatibleParents()` and answer three requests in `ReceiveData()`: `Describe` (name, version, active), `Script` (the JavaScript text with its configuration inserted) and `Event` (data sent by the script). Send to the paired browsers with `SendDataToParent()` (`Send`, `Devices`). In the page, get the runtime through the queue `window.visuExtReady` and use `ext.on`, `ext.send` and `ext.onState`. Scripts run once per load in the top window of the visualization, must tolerate being loaded twice, must not rely on the structure of the visualization and should use unique names. See [`examples/`](../examples/) for a complete template, including the optional shared icon slot `window.__symconIcons`.
