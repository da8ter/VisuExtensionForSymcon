# Visu-Erweiterung

Gegenstück der Browser-Erweiterung [Visu-Erweiterung für Symcon](../README.md) in Symcon. Die Instanz koppelt Browser, stellt je Gerät Rücksprung, Bildschirmschoner und Bewegungsmelder ein und ist die Andockstelle für andere Module.

### Inhaltsverzeichnis

1. [Funktionsumfang](#1-funktionsumfang)
2. [Voraussetzungen](#2-voraussetzungen)
3. [Software-Installation](#3-software-installation)
4. [Einrichten der Instanz](#4-einrichten-der-instanz)
5. [Statusvariablen](#5-statusvariablen)
6. [PHP-Befehlsreferenz](#6-php-befehlsreferenz)

### 1. Funktionsumfang

- Browser mit einem sechsstelligen Code koppeln, umbenennen, sperren und entfernen
- **Zurück zur Startseite:** je Gerät nach einstellbarer Zeit ohne Bedienung
- **Bildschirmschoner:** je Gerät schwarz, mit Uhr, mit gemeinfreien Gemälden oder mit eigenen Bildern aus einer Kategorie in Symcon
- **Bewegungsmelder:** Die Kamera des Geräts weckt den Bildschirmschoner und setzt eine Variable „Bewegung“
- **Andocken:** Andere Module verbinden sich mit der Instanz und zeigen ihre Funktionen auf jeder Seite der Visualisierung

### 2. Voraussetzungen

- Symcon ab Version 8.1 mit Kachel-Visualisierung
- Die Browser-Erweiterung „Visu-Erweiterung für Symcon“ in Chrome oder Edge unter Windows, macOS oder Linux. Sie steht nicht im Chrome Web Store und wird als ZIP aus den [Releases](https://github.com/da8ter/VisuExtensionForSymcon/releases) geladen; die Schritte stehen in der [Anleitung](../README.md#installieren).
- Nicht in der Symcon-App, nicht auf iPhone und iPad, nicht in Chrome für Android
- Für die Gemälde des Bildschirmschoners braucht das Gerät Internet: Der Browser lädt sie direkt bei Wikimedia Commons.

### 3. Software-Installation

- Über das Module Control folgende URL hinzufügen: `https://github.com/da8ter/VisuExtensionForSymcon`

### 4. Einrichten der Instanz

Unter „Instanz hinzufügen“ das Modul „Visu-Erweiterung“ wählen. Je Symcon ist eine Instanz möglich; eine zweite meldet einen Fehlerstatus.

__Konfigurationsseite__

Name | Beschreibung
---- | ------------
Gerät hinzufügen | Zeigt einen Code aus sechs Ziffern, zehn Minuten gültig. Er wird mit der Adresse der Visualisierung in der Einrichtung der Browser-Erweiterung eingegeben.
Geräte | Jeder gekoppelte Browser mit Name, Zustand, zuletzt gesehen und aktueller Seite. Umbenennen, sperren, entfernen.
Variable „online“ je Gerät | Legt für jedes Gerät eine Variable an, die zeigt, ob es verbunden ist.
Zurück zur Startseite | Je Gerät: Minuten ohne Bedienung (0 = aus) und die Seite. Ohne Angabe ist es die Seite, mit der die Visualisierung geladen wurde, sonst die Adresse aus der Spalte „Seite“.
Bildschirmschoner | Je Gerät: Minuten ohne Bedienung (0 = aus), Inhalt (schwarz, Uhr, Kunstwerke, eigene Bilder), Bildwechsel in Minuten, bildschirmfüllend, Kategorie der eigenen Bilder.
Bewegungsmelder | Je Gerät: an oder aus, Empfindlichkeit in drei Stufen, Rückstellzeit (5–3600 s, Vorgabe 30). Zusätzlich muss am Gerät in der Einrichtung der Browser-Erweiterung zugestimmt werden.
Angedockte Module | Die mit der Instanz verbundenen Module. Sobald es mehrere Module und Geräte gibt, lässt sich festlegen, welches Modul auf welchem Gerät läuft (Vorgabe: jedes auf jedem).

Die Einstellungen je Gerät wirken sofort, auch auf einer geöffneten Visualisierung.

### 5. Statusvariablen

Name | Typ | Beschreibung
---- | --- | ------------
Verbundene Geräte | Integer | Zahl der Browser, die gerade verbunden sind
online (je Gerät, auf Wunsch) | Boolean | Ob dieser Browser verbunden ist
Bewegung (je Gerät mit Bewegungsmelder) | Boolean | Geht an, sobald die Kamera Bewegung sieht, und nach der Rückstellzeit oder beim Trennen des Geräts wieder aus

Variablenprofile legt das Modul nicht an.

### 6. PHP-Befehlsreferenz

`$DeviceID` ist die Kennung eines Geräts, wie sie im Formular und in `VISUEXT_GetDevices` steht.

`string VISUEXT_StartPairing(int $InstanzID);`
Startet eine Kopplung und liefert den Code (sechs Ziffern, zehn Minuten gültig).

`string VISUEXT_GetDevices(int $InstanzID);`
Liefert die Geräte als JSON: `id`, `name`, `online`, `blocked`, `seen`, `page`, `home`, `saver`, `motion`.

`bool VISUEXT_UpdateDevice(int $InstanzID, string $DeviceID, string $Name, bool $Blocked);`
Ändert Name und Sperre eines Geräts. Ein gesperrtes Gerät bekommt keine Skripte und keine Verbindung.

`bool VISUEXT_RemoveDevice(int $InstanzID, string $DeviceID);`
Entfernt ein Gerät. Der Browser muss danach neu gekoppelt werden.

`bool VISUEXT_SetReturnHome(int $InstanzID, string $DeviceID, int $Minutes, string $Page);`
Rücksprung nach `$Minutes` ohne Bedienung (0 = aus) auf `$Page` (`''` = die Seite, mit der die Visualisierung geladen wurde).

`bool VISUEXT_SetScreensaver(int $InstanzID, string $DeviceID, int $Minutes, string $Mode);`
Bildschirmschoner nach `$Minutes` ohne Bedienung (0 = aus). `$Mode`: `black`, `clock`, `art` oder `media`.

`bool VISUEXT_SetScreensaverArt(int $InstanzID, string $DeviceID, int $IntervalMinutes, bool $Fill);`
Bildwechsel alle `$IntervalMinutes` (1–60) und ob das Bild den Bildschirm füllt. Gilt für Kunstwerke und eigene Bilder.

`bool VISUEXT_SetScreensaverMedia(int $InstanzID, string $DeviceID, int $CategoryID);`
Kategorie, aus der das Gerät eigene Bilder zeigt, auch aus Unterkategorien und über Verknüpfungen (0 = keine).

`bool VISUEXT_SetMotion(int $InstanzID, string $DeviceID, bool $Enabled, int $Sensitivity, int $HoldSeconds);`
Bewegungsmelder an oder aus, Empfindlichkeit 1–3, Rückstellzeit in Sekunden (5–3600).

`int VISUEXT_Wake(int $InstanzID, string $DeviceID);`
Weckt ein Gerät aus dem Bildschirmschoner (`''` = alle). Liefert die Zahl der erreichten Verbindungen.

`int VISUEXT_StartScreensaver(int $InstanzID, string $DeviceID);`
Schaltet den Bildschirmschoner sofort ein (`''` = alle), auch wenn er dort nicht eingestellt ist.

`bool VISUEXT_SetModuleAllowed(int $InstanzID, string $DeviceID, int $ModuleInstanceID, bool $Allowed);`
Legt fest, ob ein angedocktes Modul auf einem Gerät läuft.

Beispiel: den Bildschirmschoner auf allen Geräten wecken, wenn es klingelt.

```php
VISUEXT_Wake(12345, '');
```
