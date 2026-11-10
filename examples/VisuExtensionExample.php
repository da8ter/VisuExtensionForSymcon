<?php

declare(strict_types=1);

/**
 * Beispiel: ein Modul an die „Visu-Erweiterung für Symcon“ anbinden (Vertrag 1).
 *
 * Das Modul bietet über seinen Hook zwei Dinge an:
 *   /hook/visu-ext-example/<ID>?t=<Schlüssel>&k=ext        die Beschreibung (JSON): das ist die Verbindungsadresse
 *   /hook/visu-ext-example/<ID>?t=<Schlüssel>&k=start.js   das Skript, das im Fenster der Visualisierung läuft
 *
 * Benötigt Symcon 8.1 (RegisterHook in IPSModuleStrict). Die Datei ist eine Vorlage zum Übernehmen,
 * kein installierbares Modul: module.json, locale.json und start-script.js gehören dazu.
 */
class VisuExtensionExample extends IPSModuleStrict
{
    private const HOOK = 'visu-ext-example';

    public function Create(): void
    {
        parent::Create();
        $this->RegisterAttributeString('HookToken', '');
        // Der Hook ist flüchtig: Symcon entfernt ihn beim Neustart und mit der Instanz.
        $this->SetBuffer('Hook', $this->RegisterHook(self::HOOK . '/' . $this->InstanceID) ? '1' : '');
    }

    public function ApplyChanges(): void
    {
        parent::ApplyChanges();
        if (IPS_GetKernelRunlevel() !== KR_READY) {
            $this->RegisterMessage(0, IPS_KERNELSTARTED);
            return;
        }
        // Eigener Schlüssel je Instanz: ohne ihn antwortet der Hook mit 403.
        if ($this->ReadAttributeString('HookToken') === '') {
            $this->WriteAttributeString('HookToken', bin2hex(random_bytes(16)));
        }
    }

    public function MessageSink(int $TimeStamp, int $SenderID, int $Message, array $Data): void
    {
        if ($Message === IPS_KERNELSTARTED) {
            $this->ApplyChanges();
        }
    }

    /** Das Formular nennt die Verbindungsadresse (ohne Server: den kennt nur der Browser des Nutzers). */
    public function GetConfigurationForm(): string
    {
        $form = ['elements' => [], 'actions' => []];
        $base = $this->HookBase();
        if ($base !== '') {
            // Beschriftungen übersetzt Symcon über die locale.json.
            $form['actions'][] = ['type' => 'Label', 'caption' => 'Enter this address in the browser extension, with the address of your visualization in front.'];
            $form['actions'][] = ['type' => 'ValidationTextBox', 'name' => 'ExtensionAddress', 'caption' => 'Address for the browser extension', 'width' => '700px', 'value' => $base . '&k=ext'];
        }
        return (string) json_encode($form);
    }

    protected function ProcessHookData(): void
    {
        $token = $this->ReadAttributeString('HookToken');
        $given = isset($_GET['t']) && is_string($_GET['t']) ? $_GET['t'] : '';
        if ($token === '' || !hash_equals($token, $given)) {
            http_response_code(403);
            return;
        }
        header('X-Content-Type-Options: nosniff');
        $k = isset($_GET['k']) && is_string($_GET['k']) ? $_GET['k'] : '';
        switch ($k) {
            case 'ext':
                // Die Beschreibung. Skripte müssen auf diesem Server unter /hook/ liegen.
                header('Content-Type: application/json; charset=utf-8');
                header('Cache-Control: no-store');
                echo json_encode([
                    'visuExtension' => 1,
                    'name'          => IPS_GetName($this->InstanceID),
                    'version'       => '1.0',
                    'scripts'       => [$this->HookBase() . '&k=start.js'],
                    'info'          => '',
                ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
                return;
            case 'start.js':
                // Das Skript mit eingesetzter Konfiguration. Nichts hineinlegen, was nicht jeder
                // Betrachter der Visualisierung sehen darf.
                header('Content-Type: application/javascript; charset=utf-8');
                header('Cache-Control: no-cache');
                $config = ['instance' => $this->InstanceID, 'hook' => $this->HookBase(), 'name' => IPS_GetName($this->InstanceID)];
                echo str_replace(
                    '/*CONFIG*/null',
                    (string) json_encode($config, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    (string) file_get_contents(__DIR__ . '/start-script.js')
                );
                return;
        }
        http_response_code(404);
    }

    private function HookBase(): string
    {
        $token = $this->ReadAttributeString('HookToken');
        return $this->GetBuffer('Hook') === '' || $token === '' ? '' : '/hook/' . self::HOOK . '/' . $this->InstanceID . '?t=' . $token;
    }
}
