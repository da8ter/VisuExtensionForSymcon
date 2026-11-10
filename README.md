# Visu-Erweiterung für Symcon

Browser-Erweiterung für Chrome und Edge. Sie lädt Zusatzfunktionen installierter Module in die Kachel-Visualisierung von Symcon, auf jeder Seite und ohne dass eine Kachel des Moduls geladen sein muss. Beispiel: Die [Benachrichtigungs-Kachel](https://github.com/da8ter/TileVisu-Benachrichtigungen) zeigt damit ihre Overlays überall.

Die Erweiterung ist ein reiner Lader. Der Code kommt immer vom Modul auf deinem Symcon-Server, in der Erweiterung steckt nichts davon.

> [!NOTE]
> Kein Produkt der Symcon GmbH. Die Erweiterung nutzt keine zugesicherte Schnittstelle von Symcon; ändert sich die Visualisierung, kann sie ohne Wirkung bleiben. An Symcon selbst ändert sie nichts.

## Installieren

1. Aus den [Releases](https://github.com/da8ter/VisuExtensionForSymcon/releases) das ZIP laden und entpacken.
2. In Chrome `chrome://extensions` öffnen (in Edge `edge://extensions`) und den Entwicklermodus einschalten.
3. „Entpackte Erweiterung laden“ wählen und den entpackten Ordner angeben.

Wer stattdessen das ganze Repo lädt, gibt in Schritt 3 den Unterordner `src` an.

Die Einrichtung öffnet sich danach von selbst. Später erreichst du sie über das Symbol der Erweiterung.

Den Ordner danach nicht verschieben oder löschen: Der Browser lädt die Erweiterung von dort. Für eine neue Fassung den Inhalt des Ordners ersetzen und die Erweiterung auf der Erweiterungsseite neu laden. Die eingetragenen Verbindungen bleiben erhalten.

## Einrichten

1. Im Formular des Moduls die Verbindungsadresse kopieren. Bei der Benachrichtigungs-Kachel heißt das Feld „Adresse für die Browser-Erweiterung“.
2. In der Einrichtung die Adresse deiner Visualisierung davorsetzen und eintragen, zum Beispiel `http://symcon.local:3777/hook/notify/12345?t=…&k=ext`.
3. Den Zugriff auf diesen Server erlauben. Die Erweiterung prüft die Adresse sofort und zeigt den Namen des Moduls und „Verbunden“.
4. Die Visualisierung neu laden.

Je Modul und Instanz trägst du eine Adresse ein. Mehrere Symcon-Server sind möglich.

## Grenzen

- Nur in dem Browser, in dem die Erweiterung installiert ist. Nicht in der Symcon-App, nicht auf iPhone und iPad, nicht in Chrome für Android.
- Die Erweiterung steht nicht im Chrome Web Store. Der Store erlaubt nachgeladenen Code nur in engen Grenzen, und genau das ist hier die Aufgabe.

## Sicherheit

- Trage nur Adressen von Modulen ein, denen du vertraust: Ihr Code läuft in deiner Visualisierung, mit denselben Möglichkeiten wie eine Kachel dieses Moduls.
- Die Erweiterung hat nur Zugriff auf die Server, die du eingetragen und freigegeben hast. Entfernst du die letzte Adresse eines Servers, gibt sie den Zugriff zurück.
- Geladen werden nur Skripte, die auf demselben Server unter `/hook/` liegen. Nennt ein Modul ein Skript von woanders, lädt die Erweiterung von diesem Modul gar nichts.
- Die Verbindungsadresse enthält den Zugriffsschlüssel des Moduls. Sie bleibt in diesem Browser gespeichert und wird nicht synchronisiert. Gib sie nicht weiter.
- Die Erweiterung arbeitet nur im obersten Fenster der Visualisierung, nicht in Kacheln, nicht in der Verwaltungskonsole.

## Für Modulhersteller

Ein Modul braucht einen Hook mit eigenem Schlüssel, der eine kleine Beschreibung und ein Skript ausliefert. Der Vertrag steht in [docs/entwickler.md](docs/entwickler.md), eine Vorlage in [examples/](examples/).

## Prüfen

```bash
node tests/core_test.mjs     # Prüfregeln für Adresse und Beschreibung
node tests/inject_test.mjs   # Inhaltsskript in Headless-Chrome (eigenes Profil)
node tests/options_test.mjs  # Einrichtung in Headless-Chrome, Chrome-Schnittstellen als Attrappe
```

## English summary

Browser extension for Chrome and Edge that loads add-on scripts of installed Symcon modules into the tile visualization, on every page and without a tile of that module being loaded. Install it via “Load unpacked” (the unpacked release ZIP, or the folder `src` of the repository), then enter the connection address shown in the module's form, prefixed with the address of your visualization. Module developers: see [docs/entwickler.md](docs/entwickler.md) (contract, with an English summary) and [examples/](examples/). Not a product of Symcon GmbH.

## Lizenz

MIT, siehe [LICENSE](LICENSE). „Symcon“ ist eine Marke der Symcon GmbH.
