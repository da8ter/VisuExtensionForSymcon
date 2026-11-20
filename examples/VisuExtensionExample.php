<?php

declare(strict_types=1);

/**
 * Beispiel: ein Modul an die „Visu-Erweiterung“ andocken (Vertrag 2).
 *
 * Das Modul hängt im Datenfluss als Kind an der Instanz „Visu-Erweiterung“. Es braucht keinen
 * eigenen Hook und keinen eigenen Schlüssel: Sein Skript liefert die Visu-Erweiterung aus, und
 * Nachrichten laufen über deren Kanal zu den gekoppelten Browsern.
 *
 * In die module.json des Moduls gehören die beiden Pakete des Datenflusses:
 *   "parentRequirements": ["{A5B87602-1C34-4981-89A5-62A0735CB359}"],
 *   "implemented":        ["{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}"]
 *
 * Benötigt Symcon 8.2 (GetCompatibleParents). Die Datei ist eine Vorlage zum Übernehmen, kein
 * installierbares Modul: module.json, locale.json und start-script.js gehören dazu.
 */
class VisuExtensionExample extends IPSModuleStrict
{
    /** Dieses Modul → Visu-Erweiterung */
    private const DOCK_TX = '{A5B87602-1C34-4981-89A5-62A0735CB359}';
    /** Visu-Erweiterung → dieses Modul */
    private const DOCK_RX = '{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}';
    private const VISU_EXTENSION = '{CB9C6C38-9B97-45CA-BFB5-EC7F936AF3FF}';

    public function Create(): void
    {
        parent::Create();
    }

    public function ApplyChanges(): void
    {
        parent::ApplyChanges();
        // Nur Pakete an alle (Target 0) oder an diese Instanz. ReceiveData prüft das Ziel trotzdem selbst.
        $this->SetReceiveDataFilter('.*"Target":(0|' . $this->InstanceID . ')[,}].*');
    }

    public function Destroy(): void
    {
        parent::Destroy();
    }

    /** An eine vorhandene Visu-Erweiterung anschließen; das Modul arbeitet auch ohne sie. */
    public function GetCompatibleParents(): string
    {
        return (string) json_encode(['type' => 'connect', 'moduleIDs' => [self::VISU_EXTENSION]]);
    }

    /** Anfragen der Visu-Erweiterung. Die Rückgabe ist die Antwort. */
    public function ReceiveData(string $JSONString): string
    {
        $data = json_decode($JSONString, true);
        if (!is_array($data) || ($data['DataID'] ?? '') !== self::DOCK_RX || !in_array($data['Target'] ?? null, [0, $this->InstanceID], true)) {
            return '';
        }
        switch ((string) ($data['Action'] ?? '')) {
            case 'Describe':
                // „active“ false blendet das Skript aus; „info“ nennt dem Nutzer den Grund.
                return (string) json_encode([
                    'instance' => $this->InstanceID,
                    'name'     => IPS_GetName($this->InstanceID),
                    'version'  => '1.0',
                    'active'   => true,
                    'info'     => '',
                ], JSON_UNESCAPED_UNICODE);

            case 'Script':
                // Das Skript mit eingesetzter Konfiguration. $data['Device'] = {id, name} des Browsers.
                // Nichts hineinlegen, was nicht jeder Betrachter der Visualisierung sehen darf.
                $config = ['instance' => $this->InstanceID, 'name' => IPS_GetName($this->InstanceID)];
                return str_replace(
                    '/*CONFIG*/null',
                    (string) json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG),
                    (string) file_get_contents(__DIR__ . '/start-script.js')
                );

            case 'Event':
                // Das Skript hat ext.send(INSTANZ, daten) gerufen. Eine Rückgabe (JSON) geht an genau dieses Gerät zurück.
                $this->SendDebug('Event', (string) json_encode([$data['Device'] ?? null, $data['Data'] ?? null]), 0);
                return (string) json_encode(['text' => 'Angekommen']);
        }
        return '';
    }

    /** Zeigt einen Hinweis auf allen gekoppelten Browsern ('' = alle) bzw. auf einem Gerät. */
    public function ShowHint(string $Text, string $DeviceID): int
    {
        if (!$this->HasActiveParent()) {
            return 0;
        }
        $answer = json_decode($this->SendDataToParent((string) json_encode([
            'DataID'   => self::DOCK_TX,
            'Action'   => 'Send',
            'Instance' => $this->InstanceID,
            'Device'   => $DeviceID,
            'Data'     => ['text' => $Text],
        ], JSON_UNESCAPED_UNICODE)), true);
        // Zahl der Verbindungen, an die gesendet wurde; eine Zustellung bestätigt das nicht.
        return is_array($answer) && !empty($answer['ok']) ? (int) $answer['sent'] : 0;
    }
}
