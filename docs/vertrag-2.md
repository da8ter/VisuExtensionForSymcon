# Vertrag 2: das Modul „Visu-Erweiterung“

Stand: 20.11.2026. Das Symcon-Modul in diesem Repo (`VisuExtension/`, Präfix `VISUEXT`) spricht diese Fassung. Die Browser-Erweiterung in `src/` spricht noch Vertrag 1 ([entwickler.md](entwickler.md)) und wird als Nächstes umgestellt.

Die Erweiterung verbindet sich je Server mit genau einer Instanz „Visu-Erweiterung“. Andere Module docken in Symcon an diese Instanz an. Sie brauchen keinen eigenen Hook, keinen eigenen Schlüssel und kein Adressfeld.

```
Browser (Erweiterung) ──/hook/visuext──▶ Visu-Erweiterung ──Datenfluss──▶ angedockte Module
```

## Für Modulhersteller: andocken

Eine vollständige Vorlage liegt in [`examples/`](../examples/).

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

### Das Skript

Die Erweiterung hängt jedes Skript einmal je Laden der Visualisierung als `<script src>` ins oberste Fenster. Die Regeln aus Vertrag 1 gelten weiter: doppeltes Laden vertragen, nichts über den Aufbau der Visualisierung voraussetzen, eindeutige Namen, Texte nie als HTML einsetzen.

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

`INSTANZ` ist die Instanz-ID des eigenen Moduls; das Modul setzt sie beim Ausliefern in das Skript ein.

## Für die Erweiterung: der Hook

Alles läuft über `/hook/visuext` auf dem Server der Visualisierung. Schlüssel stehen nie in einer Adresse, weil Symcon Adressen ins Zugriffsprotokoll schreibt.

### Koppeln

Im Formular der Instanz „Gerät hinzufügen“ drücken: Es erscheint ein Code aus sechs Ziffern, zehn Minuten gültig, einmal verwendbar, nach fünf Fehlversuchen verbraucht.

```
POST /hook/visuext?k=pair        {"code": "123456", "name": "Küche"}
→ 200 {"ok": true, "visuExtension": 2, "device": {"id": "a1b2c3d4", "name": "Küche"}, "key": "<48 Hex-Zeichen>", "address": "/hook/visuext"}
→ 403 ohne laufenden, mit falschem oder abgelaufenem Code
```

Den Schlüssel gibt es nur in dieser einen Antwort. Symcon speichert nur seinen Hash.

### Beschreibung

```
GET  /hook/visuext?k=ext&d=<Kennung>      Kopfzeile  X-Visu-Key: <Schlüssel>
POST /hook/visuext?k=ext                  {"d": "<Kennung>", "key": "<Schlüssel>"}
→ 200 {"visuExtension": 2, "name": "…", "version": "0.2", "device": {"id", "name"},
       "scripts": ["/hook/visuext?k=script&d=…&m=0&e=…&s=…", "…&m=<Instanz>&…"]}
→ 403 unbekanntes oder gesperrtes Gerät, falscher Schlüssel
```

Das erste Skript (`m=0`) ist die Laufzeit, danach folgt je angedocktem, aktivem und für das Gerät zugelassenem Modul eines. Die Adressen tragen statt des Schlüssels eine Unterschrift und gelten zwei Minuten: Die Erweiterung holt die Beschreibung bei jedem Laden der Visualisierung neu und hängt die Skripte gleich an.

### Kanal

WebSocket auf `ws(s)://<Server der Visualisierung>/hook/visuext`. Die Laufzeit meldet sich im ersten Frame an; der Wert dafür steht in ihrem Skript und öffnet nur den Kanal dieses Geräts.

| Richtung | Nachricht | Bedeutung |
|---|---|---|
| Gerät → Symcon | `{t:"hello", d, c, page}` | Anmeldung |
| | `{t:"beat", page}` | Lebenszeichen alle 30 s |
| | `{t:"ev", m, data}` | Ereignis an das Modul `m` |
| Symcon → Gerät | `{t:"welcome", name, beat}` | angemeldet |
| | `{t:"denied"}` | Gerät entfernt oder gesperrt: nicht weiter versuchen |
| | `{t:"unknown"}` | Sitzung unbekannt (Modul neu geladen): neu anmelden |
| | `{t:"beat"}` | Antwort auf das Lebenszeichen |
| | `{t:"msg", m, data}` | Nachricht des Moduls `m` |

Bleibt das Lebenszeichen 90 Sekunden aus, gilt die Verbindung für Symcon als getrennt. Bleibt die Antwort zweieinhalb Takte aus, baut die Laufzeit die Verbindung neu auf (nach 1, 2, 5, 10, dann alle 30 Sekunden). Über Symcon Connect hält das Lebenszeichen die Verbindung zugleich offen: Connect trennt nach 120 Sekunden ohne Daten.

## Im Formular der Instanz

- **Geräte:** Name, Kennung, Zustand, zuletzt gesehen, aktuelle Seite. Umbenennen, sperren, entfernen.
- **Angedockte Module** und, sobald es beides gibt, **welches Modul auf welchem Gerät läuft** (Vorgabe: jedes auf jedem).
- Auf Wunsch je Gerät eine Variable „online“. Die Variable „Verbundene Geräte“ gibt es immer.

Funktionen für Skripte: `VISUEXT_StartPairing`, `VISUEXT_GetDevices`, `VISUEXT_UpdateDevice`, `VISUEXT_RemoveDevice`, `VISUEXT_SetModuleAllowed`.

Je Symcon ist eine Instanz möglich; eine zweite meldet einen Fehlerstatus.

## Prüfen

```bash
php tests/modul/module_test.php   # Modul gegen eine SDK-Attrappe
node tests/runtime_test.mjs       # Laufzeit mit nachgestelltem Fenster, WebSocket und Uhr
```

Am 20.11.2026 zusätzlich an Symcon 9.1 durchgespielt, mit einem angedockten Probe-Modul nach der Vorlage: koppeln, Beschreibung, Skripte, Kanal, Nachrichten in beide Richtungen, Abmelden ohne Lebenszeichen. Im echten Chrome liefen Laufzeit und Beispielskript auf der Seite der Visualisierung, auch über ein Neuladen des Moduls hinweg. Über Symcon Connect geprüft: koppeln, Beschreibung, Laufzeit und Anmeldung am Kanal. Nicht geprüft: mit der Erweiterung selbst (sie spricht noch Vertrag 1), Dauerbetrieb.

## English summary

One Symcon module (“Visu Extension”, hook `/hook/visuext`) is the single connection between the browser extension and Symcon. A browser is paired once with a six-digit code (`POST ?k=pair`) and receives a device id and key. The description (`?k=ext`, key in the `X-Visu-Key` header or in a POST body) lists script URLs signed with a short-lived ticket; the first one is the runtime `window.visuExt`, which keeps a WebSocket channel to the hook (login in the first frame, heartbeat every 30 s, automatic reconnect). Other modules dock onto the instance through the data flow: they answer `Describe`, `Script` and `Event` in `ReceiveData()` and send to devices with `SendDataToParent()` (`Send`, `Devices`). See [`examples/`](../examples/).
