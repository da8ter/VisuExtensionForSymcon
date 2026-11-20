# Plan: Vertrag 2 – ein Symcon-Modul als einzige Verbindung

Stand: 20.11.2026, Entscheidungen des Nutzers eingetragen (siehe unten). Noch offen: der Name und die Messung zum WebSocket.

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
2. **Rückkanal über WebSocket über Symcon**, nicht über Abfragen. Vorher messen: Welcher Weg trägt (eigene WebSocket-Server-Instanz in Symcon mit eigenem Port, oder der WebSocket der Visualisierung), wie verhalten sich HTTPS/Connect und gemischte Inhalte, und baut die Verbindung nach Abriss sauber wieder auf. Bis zur Messung ist das der größte offene Punkt.
3. **Die Kiosk-Funktionen sind in die Visu-Erweiterung eingebaut**, Einstellungen je Gerät in der Geräteliste.
4. **Die gemeinsame Schnittstelle (`window.visuExt`) liefert das Symcon-Modul** als erstes Skript aus. Die Browser-Erweiterung bleibt reiner Lader.
5. Noch offen: der Name des Moduls (Arbeitstitel „Visu-Erweiterung“).

## Reihenfolge

1. WebSocket messen (Docker und SymBox, mit und ohne Connect) und den Weg festlegen.
2. Symcon-Modul: Hook, Kopplung, Geräteliste, Datenfluss zum Andocken, Auslieferung.
3. Erweiterung auf Vertrag 2 umbauen, Vertrag 1 entfernen, Tests anpassen (`extension_test.mjs` mit echter Erweiterung).
4. Benachrichtigungs-Kachel andocken.
5. Visu-Steuerung: Rücksprung und Wächter.
