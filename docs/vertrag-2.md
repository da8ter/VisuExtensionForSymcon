# Vertrag 2: das Modul „Visu-Erweiterung“

Stand: 20.11.2026. Das Symcon-Modul in diesem Repo (`VisuExtension/`, Präfix `VISUEXT`) und die Browser-Erweiterung in `src/` (ab 0.2) sprechen diese Fassung. Vertrag 1 gibt es nicht mehr.

Die Erweiterung verbindet sich je Server mit genau einer Instanz „Visu-Erweiterung“. Andere Module docken in Symcon an diese Instanz an. Sie brauchen keinen eigenen Hook, keinen eigenen Schlüssel und kein Adressfeld.

```
Browser (Erweiterung) ──/hook/visuext──▶ Visu-Erweiterung ──Datenfluss──▶ angedockte Module
```

## Für Modulhersteller

Wie ein Modul andockt (Datenfluss, die drei Anfragen, das Skript und die Laufzeit `window.visuExt`), steht in [entwickler.md](entwickler.md); eine Vorlage liegt in [`examples/`](../examples/). Dieser Text beschreibt, wie Erweiterung und Modul miteinander sprechen.

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
| | `{t:"cfg", home:{minutes, page}, saver:{minutes, mode, interval, fill}}` | Einstellungen des Geräts: nach jeder Anmeldung und bei jeder Änderung |
| | `{t:"saver", on}` | Bildschirmschoner sofort einschalten oder aufwecken |
| | `{t:"msg", m, data}` | Nachricht des Moduls `m` |

Bleibt das Lebenszeichen 90 Sekunden aus, gilt die Verbindung für Symcon als getrennt. Bleibt die Antwort zweieinhalb Takte aus, baut die Laufzeit die Verbindung neu auf (nach 1, 2, 5, 10, dann alle 30 Sekunden). Über Symcon Connect hält das Lebenszeichen die Verbindung zugleich offen: Connect trennt nach 120 Sekunden ohne Daten.

## Im Formular der Instanz

- **Geräte:** Name, Kennung, Zustand, zuletzt gesehen, aktuelle Seite. Umbenennen, sperren, entfernen.
- **Angedockte Module** und, sobald es beides gibt, **welches Modul auf welchem Gerät läuft** (Vorgabe: jedes auf jedem).
- **Zurück zur Startseite** je Gerät: Nach den eingestellten Minuten ohne Berührung, Taste oder Mausrad wechselt die Visualisierung zurück auf ihre Startseite (0 = aus). Ohne eigene Angabe ist das die Seite, mit der sie geladen wurde; sonst die Adresse wie in der Spalte „Seite“, zum Beispiel `/#/12345`. Die Laufzeit misst die Bedienpause im Browser und wechselt über den Adress-Anhang; die Einstellung wirkt sofort, auch auf einer geöffneten Visualisierung.
- **Bildschirmschoner** je Gerät: Nach den eingestellten Minuten ohne Bedienung legt sich eine Ebene über die Visualisierung, schwarz, mit Uhr und Datum (die Uhr wandert jede Minute) oder mit Kunstwerken im Wechsel. Die Kunstwerke sind gemeinfreie Gemälde aus `libs/artworks.json`; der Browser lädt die Bilder direkt bei Wikimedia Commons, wahlweise mit schwarzem Rand oder bildschirmfüllend beschnitten, mit Titel, Künstler und Jahr am unteren Rand. Ohne Netz erscheint die Uhr. Die erste Berührung weckt nur auf und löst in der Visualisierung nichts aus. Aus Symcon lässt er sich einschalten und aufwecken; angedockte Module wecken mit `ext.wake()`. Das Display abschalten oder dimmen kann er nicht, nur abdunkeln.
- Rücksprung und Bildschirmschoner haben im Formular je einen eigenen Aufklappbereich.
- Auf Wunsch je Gerät eine Variable „online“. Die Variable „Verbundene Geräte“ gibt es immer.

Funktionen für Skripte: `VISUEXT_StartPairing`, `VISUEXT_GetDevices`, `VISUEXT_UpdateDevice`, `VISUEXT_RemoveDevice`, `VISUEXT_SetModuleAllowed`, `VISUEXT_SetReturnHome` (Gerät, Minuten, Startseite), `VISUEXT_SetScreensaver` (Gerät, Minuten, `black`, `clock` oder `art`), `VISUEXT_SetScreensaverArt` (Gerät, Bildwechsel in Minuten, bildschirmfüllend), `VISUEXT_Wake` und `VISUEXT_StartScreensaver` (Gerät oder `''` für alle).

Je Symcon ist eine Instanz möglich; eine zweite meldet einen Fehlerstatus.

## Prüfen

```bash
php tests/modul/module_test.php   # Modul gegen eine SDK-Attrappe
node tests/runtime_test.mjs       # Laufzeit mit nachgestelltem Fenster, WebSocket und Uhr
node tests/core_test.mjs          # Prüfregeln der Erweiterung
node tests/inject_test.mjs        # Lader und Brücke in Headless-Chrome
node tests/options_test.mjs       # Einrichtung (koppeln), Chrome-Schnittstellen als Attrappe
node tests/extension_test.mjs     # die echte Erweiterung, Server nicht unter localhost
```

Am 20.11.2026 zusätzlich an einem laufenden Symcon durchgespielt, mit der echten Erweiterung in Chrome und einem angedockten Probe-Modul nach der Vorlage: koppeln in der Einrichtung, Laufzeit und Skript des Moduls auf der Seite der Visualisierung, Nachrichten in beide Richtungen, Sperren des Geräts (Kanal getrennt, nach dem Neuladen wird nichts mehr geladen, die Einrichtung nennt den Grund). Über Symcon Connect mit der echten Erweiterung: koppeln, Laufzeit geladen, Kanal steht. Nicht geprüft: Edge, Dauerbetrieb, die Freigabe-Abfrage des Browsers (im Prüflauf vorab erteilt).

## English summary

One Symcon module (“Visu Extension”, hook `/hook/visuext`) is the single connection between the browser extension and Symcon. A browser is paired once with a six-digit code (`POST ?k=pair`) and receives a device id and key. The description (`?k=ext`, key in the `X-Visu-Key` header or in a POST body) lists script URLs signed with a short-lived ticket; the first one is the runtime `window.visuExt`, which keeps a WebSocket channel to the hook (login in the first frame, heartbeat every 30 s, automatic reconnect). Other modules dock onto the instance through the data flow: they answer `Describe`, `Script` and `Event` in `ReceiveData()` and send to devices with `SendDataToParent()` (`Send`, `Devices`). See [`examples/`](../examples/).
