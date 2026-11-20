# Plan: Vertrag 2 – ein Symcon-Modul als einzige Verbindung

Stand: 20.11.2026. Die Schritte 1 bis 4 sind erledigt (Messung, Symcon-Modul, Erweiterung, erste Module angedockt); was Modul und Erweiterung tun, steht in [vertrag-2.md](vertrag-2.md), das Andocken in [entwickler.md](entwickler.md). Offen: Rücksprung und Wächter. Der Name bleibt beim Arbeitstitel „Visu-Erweiterung“.

## Ziel

Die Erweiterung verbindet sich mit genau **einem** Symcon-Modul je Server, der „Visu-Erweiterung“. Andere Module docken in Symcon an dieses Modul an und brauchen keinen eigenen Hook, keinen eigenen Schlüssel und kein Adressfeld mehr. Die Erweiterung bleibt ein reiner Lader.

Vertrag 1 entfällt ersatzlos (Nutzerentscheid 20.11.2026: die Erweiterung ist noch nicht angekündigt). Die Benachrichtigungs-Kachel zieht auf das Andocken um.

## Bausteine

```
Browser (Erweiterung)  ──Hook──▶  Visu-Erweiterung (Symcon, eine Instanz je Server)
                                     ├─ Benachrichtigungs-Kachel   (angedockt)
                                     ├─ Visu-Steuerung / Kiosk     (angedockt oder eingebaut)
                                     └─ weitere Module             (angedockt)
```

### 1. Modul „Visu-Erweiterung“ (Symcon)

- Eine Instanz je Server, ein Hook `/hook/visuext/<ID>`.
- **Geräteliste** im Formular: Name, Kennung, zuletzt gesehen, aktuelle Seite, gesperrt ja/nein. Je Gerät ein eigener Schlüssel, einzeln sperrbar.
- **Freigaben** je Gerät: welche angedockten Module dort laufen (Vorgabe: alle).
- Variablen je Gerät (optional): online, zuletzt aktiv.
- Liefert die Beschreibung, die Skripte der angedockten Module und nimmt Meldungen der Geräte entgegen.

### 2. Koppeln statt Adresse kopieren

1. Im Formular „Gerät hinzufügen“ drücken → das Modul zeigt einen **Kopplungscode** (z. B. 6 Ziffern, 10 Minuten gültig) und die Serveradresse.
2. In der Erweiterung Serveradresse und Code eingeben, dazu einen Gerätenamen („Küche“).
3. Die Erweiterung ruft `POST /hook/visuext/<ID>?k=pair` mit Code und Namen auf und bekommt **Gerätekennung und Geräteschlüssel** zurück. Der Code ist danach verbraucht.
4. Ab dann ruft sie `…?k=ext&d=<Kennung>&t=<Schlüssel>` auf.

Vorteil: Kein langer Schlüssel zum Kopieren, jedes Gerät hat seinen eigenen Schlüssel, und das Modul kennt jedes Gerät mit Namen.

### 3. Andocken in Symcon

Angedockte Module hängen im **Datenfluss** als Kinder an der Visu-Erweiterung (eigene Datenfluss-GUIDs, `GetCompatibleParents`).

- **Skript anmelden:** Die Visu-Erweiterung fragt ihre Kinder per `SendDataToChildren` nach ihrem Paket: Name, Skripttext (oder Kennung, unter der sie ihn auf Nachfrage liefern), Version, Konfiguration für das Skript.
- **Ausliefern:** Die Erweiterung lädt `…?k=script&m=<Kind-Instanz>&d=…&t=…`; die Visu-Erweiterung holt den Text beim Kind und liefert ihn aus. Die Kinder brauchen dafür keinen eigenen Hook.
- **Gerät → Modul:** `POST …?k=event&m=<Kind>` mit JSON; die Visu-Erweiterung reicht es mit Gerätekennung an das Kind weiter.
- **Modul → Gerät:** Kinder schicken Befehle mit Ziel (ein Gerät, alle Geräte) an die Visu-Erweiterung; die schiebt sie per WebSocket an die Geräte.

### 4. Beschreibung (Vertrag 2)

```json
{
  "visuExtension": 2,
  "name": "Visu-Erweiterung",
  "device": { "id": "a1b2c3", "name": "Küche" },
  "scripts": ["/hook/visuext/<ID>?k=script&m=<Kind>&d=a1b2c3&t=<Schlüssel>"],
  "channel": "/hook/visuext/<ID>?k=poll&d=a1b2c3&t=<Schlüssel>"
}
```

Die Prüfregeln bleiben: Verbindung und Skripte nur unter `/hook/` auf demselben Server, ein unzulässiges Skript verwirft alles, höchstens 8 Skripte (Grenze neu bewerten).

### 5. Erweiterung

- Einrichtung: Serveradresse + Kopplungscode + Gerätename statt fertiger Adresse. Eine Verbindung je Server.
- Lader wie bisher (`inject.js` hängt im Fenster der Seite an).
- Die gemeinsame Schnittstelle (`window.visuExt`: Gerätekennung, `send(modul, daten)`, `on(modul, rückruf)`) liefert das Symcon-Modul als erstes Skript; die Erweiterung selbst stellt weiter nichts bereit.

## Erste Pakete

1. **Benachrichtigungs-Kachel** andocken (bestehender Code, eigener `k=ext` entfällt).
2. **Visu-Steuerung** (eingebaut in die Visu-Erweiterung):
   - Zurück zur Startseite nach X Minuten ohne Berührung (je Gerät).
   - Wächter: Seite neu laden, wenn die Verbindung zu Symcon abreißt oder die Seite hängt.
   - Später: Seite aus Symcon ansteuern, Bildschirmschoner/Nachtmodus, Bildschirm wach halten, Gerätestatus.

## Entscheidungen (Nutzer, 20.11.2026)

1. **Das Symcon-Modul liegt im Repo der Erweiterung.** Eine Bibliothek: `library.json` und Modulordner neben `src/`; Versionen gehen gemeinsam.
2. **Rückkanal über WebSocket über Symcon**, nicht über Abfragen. Gemessen am 20.11.2026: Der WebSocket am eigenen Hook trägt (siehe „Messung WebSocket“). Eine eigene WebSocket-Server-Instanz mit eigenem Port und der WebSocket der Visualisierung sind damit vom Tisch.
3. **Die Kiosk-Funktionen sind in die Visu-Erweiterung eingebaut**, Einstellungen je Gerät in der Geräteliste.
4. **Die gemeinsame Schnittstelle (`window.visuExt`) liefert das Symcon-Modul** als erstes Skript aus. Die Browser-Erweiterung bleibt reiner Lader.
5. Noch offen: der Name des Moduls (Arbeitstitel „Visu-Erweiterung“).

## Messung WebSocket (20.11.2026)

Gemessen an Symcon 9.1 (Build vom 21.10.2026) im Docker, mit einem Probe-Modul (Hook mit Echo), Node-Clients und einem echten Headless-Chrome. Die SymBox läuft auf demselben Build und wurde deshalb nicht eigens gemessen.

| Frage | Ergebnis |
|---|---|
| Nimmt der Hook des Moduls WebSockets an? | Ja, direkt und über Symcon Connect (HTTP 101). |
| Aus dem Browser, auf der Visu-Seite selbst? | Ja. `ws://` bei HTTP, `wss://` über Connect, jeweils zum eigenen Ursprung; kein gemischter Inhalt. Die Visu setzt keine Content-Security-Policy. |
| Laufzeiten | Direkt: offen nach 5–50 ms, Echo rund 3 ms. Über Connect: offen nach 0,2–0,5 s, Echo rund 75 ms. 100 kB je Frame in beiden Richtungen vollständig. |
| Gezielt an ein Gerät senden (`WC_PushMessageEx`) | Geht, auch über Connect und auch aus einem Skript heraus (nicht nur als Antwort). Über Connect haben alle Verbindungen die Adresse 127.0.0.1 und unterscheiden sich nur im Port; zwei gleichzeitige Verbindungen bekamen nur ihre eigenen Nachrichten. |
| Was sieht das Modul je Frame? | Adresse und Port der Verbindung, `Sec-WebSocket-Key`, die Abfrage der Adresse, aus dem Browser auch `Origin`. Über Connect steht die echte Adresse nur in `X-Forwarded-For`. |
| Stille Verbindung | Direkt: 290 s Stille überstanden. **Über Connect wird nach 120 s ohne Daten getrennt** (Close 1006 beim Client). Mit einem Frame alle 50 s hielt sie über 350 s. |
| Komprimierung | Der Browser bietet `permessage-deflate` an, Symcon nimmt es nicht an. |

Schon vorher bekannt (Messung 26.10.2026 für die Display-Kachel, gleicher Build-Stand): Symcon nimmt die Verbindung an, bevor Modulcode läuft. Ping, Pong und Close erreichen das Modul nicht, es gibt kein Trenn-Ereignis. Frames verschiedener Verbindungen laufen im Modul gleichzeitig. `WC_PushMessageEx` meldet auch an eine tote Verbindung „gesendet“. Ein Kernel-Neustart trennt, ohne dass der Client sofort ein Close sieht; ein Modul-Reload trennt nicht, leert aber die Puffer.

### Folgen für den Bau

- **Ein Kanal:** `ws(s)://<Ursprung der Visu>/hook/visuext/<ID>`. Die Adresse leitet das Skript aus `location.origin` ab; so passt sie für LAN, HTTPS und Connect von selbst.
- **Anmeldung im ersten Frame** (Gerätekennung und Geräteschlüssel), nicht in der Adresse: Symcon schreibt Adressen ins Zugriffsprotokoll. Unangemeldete Verbindungen bekommen nichts. Nie `WC_PushMessage` (an alle) mit Inhalt.
- **Lebenszeichen vom Gerät alle 30 s**, vom Modul beantwortet. Damit bleibt die Verbindung über Connect offen, das Gerät erkennt einen Kernel-Neustart (keine Antwort → neu verbinden), und das Modul erkennt ein verschwundenes Gerät (kein Lebenszeichen seit 90 s → offline).
- **Neu verbinden** mit wachsendem Abstand; auf „unbekannte Sitzung“ (nach Modul-Reload) meldet sich das Gerät neu an.
- **Sitzungstabelle im Modul** (Gerät → Adresse, Port, Schlüssel der Verbindung, zuletzt gesehen) hinter einer Sperre, weil Frames gleichzeitig laufen.
- **`Origin` wird nicht geprüft** (beim Bau entschieden): Die Anmeldung trägt einen eigenen Wert und kein Cookie, eine fremde Seite kann sie also nicht mitbenutzen. Eine Prüfung gegen den Host träfe dagegen Aufbauten mit einem Proxy, der den Host umschreibt.
- **Beschreibung und Skripte bleiben HTTP** (wie bisher), der WebSocket trägt nur Befehle, Ereignisse und Lebenszeichen.

Nicht gemessen: Dauerbetrieb über Stunden, mehrere Dutzend Geräte gleichzeitig, das Verhalten im Browser bei einem Kernel-Neustart (nur aus der Messung mit Node bekannt) und etwaige Mengengrenzen von Connect für dauerhaft offene Verbindungen.

## Reihenfolge

1. ~~WebSocket messen und den Weg festlegen.~~ Erledigt am 20.11.2026.
2. ~~Symcon-Modul: Hook, Kopplung, Geräteliste, Datenfluss zum Andocken, Auslieferung.~~ Erledigt am 20.11.2026 (`VisuExtension/`, `libs/`, Tests in `tests/modul/` und `tests/runtime_test.mjs`). Abweichungen vom Entwurf oben: fester Hook `/hook/visuext` und eine Instanz je Symcon (das Koppeln braucht so keine Instanz-ID); die Beschreibung nennt keinen Kanal, die Laufzeit kennt ihn; Skript-Adressen tragen ein Ticket statt des Schlüssels; Freigaben als Sperrliste je Gerät.
3. ~~Erweiterung auf Vertrag 2 umbauen, Vertrag 1 entfernen, Tests anpassen.~~ Erledigt am 20.11.2026 (Fassung 0.2.0). Einrichtung: Adresse der Visualisierung, Code, Name; eine Verbindung je Server als `{origin, id, key, name, server}`. Die Beschreibung holt die Erweiterung per POST mit Kennung und Schlüssel im Rumpf (als Text, ohne Voranfrage), die Skripte laufen in der Reihenfolge der Beschreibung. Höchstens 16 Skripte. Mit der echten Erweiterung an einem laufenden Symcon geprüft, direkt und über Symcon Connect.
4. ~~Benachrichtigungs-Kachel andocken (ebenso die Klebezettel, die Vertrag 1 auch sprachen).~~ Erledigt am 20.11.2026, jeweils im Repo des Moduls. Beide beantworten `Describe` und `Script`; ihre Daten holen die Skripte weiter über den eigenen Hook des Moduls. Über den Kanal schickt das Modul nur einen Anstoß (`{seq}`), das Skript fragt dann sofort statt im Takt: gemessen unter einer Sekunde bei 60 Sekunden Abfrage-Intervall. Ohne Visu-Erweiterung arbeiten beide wie zuvor. An einem laufenden Symcon geprüft, beide Module zugleich über eine Verbindung.
5. Visu-Steuerung. **Rücksprung zur Startseite** gebaut am 20.11.2026: Einstellung je Gerät (`VISUEXT_SetReturnHome`, Spalten im Formular), die Laufzeit misst die Bedienpause und wechselt über den Adress-Anhang; Nachricht `cfg` bringt Änderungen sofort aufs Gerät. Offen: der Wächter (neu laden, wenn die Verbindung abreißt oder die Seite hängt).
