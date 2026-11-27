# Visu-Erweiterung für Symcon

![Visu-Erweiterung für Symcon — Bildschirmschoner mit Kunstwerk](https://raw.githubusercontent.com/da8ter/images/main/Visu-Erweiterung%20Bildschirmschoner%20Kunstwerk.jpg)

Browser-Erweiterung für Chrome und Edge mit dem passenden Symcon-Modul. Zusammen laden sie Zusatzfunktionen installierter Module in die Kachel-Visualisierung von Symcon: auf jeder Seite und ohne dass eine Kachel des Moduls geladen sein muss. Ein Modul kann so zum Beispiel Hinweise über die ganze Visualisierung legen.

```
Browser (Erweiterung)  ──▶  Symcon-Modul „Visu-Erweiterung“  ──▶  angedockte Module
```

Du richtest je Browser genau eine Verbindung ein, zum Modul „Visu-Erweiterung“. Andere Module docken in Symcon daran an und brauchen in der Erweiterung keine eigene Einrichtung. Die Erweiterung ist ein reiner Lader: Der Code kommt immer von deinem Symcon, in der Erweiterung steckt nichts davon.

> [!NOTE]
> Kein Produkt der Symcon GmbH. Die Erweiterung nutzt keine zugesicherte Schnittstelle von Symcon; ändert sich die Visualisierung, kann sie ohne Wirkung bleiben. An Symcon selbst ändert sie nichts.

## Installieren

### Symcon-Modul

1. In der Verwaltungskonsole unter „Module“ dieses Repository hinzufügen: `https://github.com/da8ter/VisuExtensionForSymcon`
2. Eine Instanz „Visu-Erweiterung“ anlegen. Je Symcon ist eine möglich.

Benötigt wird Symcon ab Version 8.1.

### Browser-Erweiterung

1. Aus den [Releases](https://github.com/da8ter/VisuExtensionForSymcon/releases) das ZIP laden und entpacken.
2. In Chrome `chrome://extensions` öffnen (in Edge `edge://extensions`) und den Entwicklermodus einschalten.
3. „Entpackte Erweiterung laden“ wählen und den entpackten Ordner angeben.

Wer stattdessen das ganze Repo lädt, gibt in Schritt 3 den Unterordner `src` an.

Die Einrichtung öffnet sich danach von selbst. Später erreichst du sie über das Symbol der Erweiterung.

Den Ordner danach nicht verschieben oder löschen: Der Browser lädt die Erweiterung von dort. Für eine neue Fassung den Inhalt des Ordners ersetzen und die Erweiterung auf der Erweiterungsseite neu laden. Die Verbindung bleibt erhalten.

## Einen Browser verbinden

![Visu-Erweiterung für Symcon — Einrichtung der Erweiterung](https://raw.githubusercontent.com/da8ter/images/main/Visu-Erweiterung%20Einrichtung.png)

1. Im Formular der Instanz „Visu-Erweiterung“ auf „Gerät hinzufügen“ drücken. Es erscheint ein Code aus sechs Ziffern, zehn Minuten gültig.
2. In der Einrichtung der Erweiterung die Adresse eintragen, unter der du die Visualisierung öffnest (zum Beispiel `http://symcon.local:3777`), dazu den Code und einen Namen für diesen Browser („Küche“).
3. Den Zugriff auf diesen Server erlauben. Die Einrichtung zeigt „Verbunden“.
4. Die Visualisierung neu laden.

Jeder Browser wird einzeln verbunden und bekommt dabei seinen eigenen Schlüssel. Öffnest du die Visualisierung unter mehreren Adressen (zu Hause und über Symcon Connect), verbindest du jede Adresse einmal.

## Im Formular der Instanz

- **Geräte:** jeder verbundene Browser mit Name, Zustand, zuletzt gesehen und aktueller Seite. Umbenennen, sperren, entfernen.
- **Zurück zur Startseite:** je Gerät einstellbar. Nach den eingestellten Minuten ohne Bedienung wechselt die Visualisierung dort zurück auf ihre Startseite, zum Beispiel an einem Wandtablett.
- **Bildschirmschoner:** je Gerät einstellbar: schwarz, mit Uhr, mit berühmten Kunstwerken im Wechsel (57 gemeinfreie Gemälde) oder mit eigenen Bildern: Bild-Medienobjekte aus einer Kategorie in Symcon, die ihr je Gerät wählt, in zufälliger Reihenfolge (auch aus Unterkategorien und über Verknüpfungen, je Bild bis 15 MB). Bilder wahlweise bildschirmfüllend. Die eigenen Bilder kommen aus eurem Symcon und verlassen das Haus nicht. Die Kunstwerke lädt der Browser direkt bei Wikimedia Commons; das Gerät braucht dafür Internet, und Wikimedia sieht seine Adresse. Die erste Berührung weckt nur auf; aus Symcon lässt er sich einschalten und aufwecken (`VISUEXT_StartScreensaver`, `VISUEXT_Wake`), etwa über einen Bewegungsmelder.
- **Bewegungsmelder:** je Gerät einstellbar, mit drei Stufen der Empfindlichkeit. Die Kamera des Geräts weckt den Bildschirmschoner, sobald jemand davorsteht, und setzt die Variable „Bewegung“ des Geräts; nach der Rückstellzeit ohne Bewegung (je Gerät einstellbar, Vorgabe 30 Sekunden) geht sie wieder aus. Damit taugt das Wandtablett auch als Präsenzmelder für Licht oder Ereignisse. Zusätzlich muss man am Gerät selbst zustimmen: „Kamera als Bewegungsmelder erlauben“ in der Einrichtung der Erweiterung, dabei fragt der Browser nach der Kamera. Die Kamera läuft in der Erweiterung, nicht in der Visualisierung, deshalb klappt es auch, wenn die Visualisierung über `http://` im Heimnetz geöffnet ist. Die Erkennung braucht kaum Rechenzeit: Die Kamera liefert ein kleines Bild mit höchstens 5 Bildern je Sekunde, verglichen werden drei je Sekunde.
- **Angedockte Module** und, sobald es mehrere gibt, welches Modul auf welchem Gerät läuft (Vorgabe: jedes auf jedem).
- Die Variable „Verbundene Geräte“ gibt es immer, auf Wunsch je Gerät eine Variable „online“.

Angedockte Module erscheinen auf jeder Seite der Visualisierung, hier der Mini-Player des [Musikplayers für Spotify](https://github.com/da8ter/MusicPlayerForSpotify):

![Visu-Erweiterung für Symcon — Mini-Player eines angedockten Moduls](https://raw.githubusercontent.com/da8ter/images/main/Visu-Erweiterung%20Mini-Player.png)

## Grenzen

- Nur in dem Browser, in dem die Erweiterung installiert ist. Nicht in der Symcon-App, nicht auf iPhone und iPad, nicht in Chrome für Android.
- Der Bewegungsmelder arbeitet nur, solange das Display an ist. Schaltet das Betriebssystem den Bildschirm ab, ruht der Browser und mit ihm die Kamera; der Bildschirmschoner dunkelt dagegen nur ab. Solange die Kamera läuft, zeigt der Browser das an.
- Die Erweiterung steht nicht im Chrome Web Store. Der Store erlaubt nachgeladenen Code nur in engen Grenzen, und genau das ist hier die Aufgabe.

## Sicherheit

- Verbinde nur dein eigenes Symcon: Der Code der dort angedockten Module läuft in deiner Visualisierung, mit denselben Möglichkeiten wie eine Kachel dieser Module.
- Die Erweiterung hat nur Zugriff auf die Server, die du verbunden und freigegeben hast. Entfernst du die Verbindung, gibt sie den Zugriff zurück.
- Geladen werden nur Skripte, die auf demselben Server unter `/hook/` liegen. Nennt Symcon ein Skript von woanders, lädt die Erweiterung von diesem Server gar nichts.
- Der Schlüssel eines Browsers entsteht beim Verbinden, bleibt in diesem Browser gespeichert und wird nicht synchronisiert. Symcon speichert nur seinen Hash. Er steht in keiner Adresse und ist für die Seite der Visualisierung nicht erreichbar.
- In Symcon kannst du jeden Browser einzeln sperren oder entfernen. Er lädt dann nichts mehr.
- Der Hook des Moduls ist wie jeder Hook ohne das Passwort der Visualisierung erreichbar. Ohne gültigen Code oder Schlüssel antwortet er mit „verboten“.
- Bewegungsmelder: Kein Kamerabild verlässt die Erweiterung. Sie vergleicht die Bilder selbst und meldet der Visualisierung und Symcon nur „Bewegung“, „keine Bewegung“ und den Zustand der Kamera. Ohne die Zustimmung in der Einrichtung bleibt die Kamera aus, auch wenn Symcon den Bewegungsmelder einschaltet.
- Die Erweiterung arbeitet nur im obersten Fenster der Visualisierung, nicht in Kacheln, nicht in der Verwaltungskonsole.

## Für Modulhersteller

Ein Modul dockt in Symcon über den Datenfluss an die Visu-Erweiterung an: Es liefert ihr sein Skript und tauscht über ihren Kanal Nachrichten mit den verbundenen Browsern. Einen eigenen Hook oder Schlüssel braucht es dafür nicht. Ein Beispiel aus dem Betrieb ist die [Benachrichtigungs-Kachel](https://github.com/da8ter/TileVisu-Benachrichtigungen): Angedockt zeigt sie ihre Overlays auf jeder Seite. Die Anleitung steht in [docs/entwickler.md](docs/entwickler.md), eine Vorlage in [examples/](examples/), das Protokoll zwischen Erweiterung und Modul in [docs/vertrag-2.md](docs/vertrag-2.md).

## Prüfen

```bash
php tests/modul/module_test.php  # Symcon-Modul gegen eine SDK-Attrappe
node tests/runtime_test.mjs      # Laufzeit window.visuExt
node tests/core_test.mjs         # Prüfregeln der Erweiterung
node tests/motion_test.mjs       # Bewegungserkennung mit erzeugten Bildern
node tests/inject_test.mjs       # Lader und Brücke in Headless-Chrome (eigenes Profil)
node tests/options_test.mjs      # Einrichtung in Headless-Chrome, Chrome-Schnittstellen als Attrappe
node tests/extension_test.mjs    # die echte Erweiterung in Headless-Chrome, Server nicht unter localhost
```

## English summary

A browser extension for Chrome and Edge plus a Symcon module. Together they load add-on scripts of installed Symcon modules into the tile visualization, on every page and without a tile of that module being loaded. Add this repository in Symcon's module control and create one instance “Visu Extension”. Install the extension via “Load unpacked” (the unpacked release ZIP, or the folder `src` of the repository). To connect a browser, press “Add device” in the instance form and enter the address of your visualization and the six-digit code in the extension's options. Other modules dock onto the instance inside Symcon and need no setup in the extension; module developers see [docs/entwickler.md](docs/entwickler.md) (with an English summary) and [examples/](examples/). Not a product of Symcon GmbH.

## Lizenz

MIT, siehe [LICENSE](LICENSE). „Symcon“ ist eine Marke der Symcon GmbH.
