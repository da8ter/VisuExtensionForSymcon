<?php

declare(strict_types=1);

/**
 * Bewegungsmelder: Die Kamera eines Geräts läuft in der Browser-Erweiterung (Offscreen-Dokument),
 * nicht in der Visualisierung. Hier stehen die Einstellung je Gerät (an/aus, Empfindlichkeit; sie geht
 * mit „cfg“ an die Laufzeit), die Variable „Bewegung“ je Gerät und der Zustand der Kamera, den die
 * Laufzeit meldet. Bilder kommen nie bei Symcon an, nur „motion“ (an/aus) und „cam“ (Zustand).
 *
 * Braucht vom Modul: locked(), devices(), saveDevices(), sessions(), saveSessions(), checkSession(), sendConfig().
 */
trait VisuExtMotion
{
    /**
     * Bewegungsmelder eines Geräts ein- oder ausschalten; $Sensitivity 1 = gering, 2 = mittel, 3 = hoch;
     * $HoldSeconds: so lange nach der letzten Bewegung bleibt die Variable „Bewegung“ an (5–3600).
     * Die Kamera läuft nur, wenn zusätzlich in der Erweiterung auf dem Gerät zugestimmt ist. Wirkt sofort.
     */
    public function SetMotion(string $DeviceID, bool $Enabled, int $Sensitivity, int $HoldSeconds): bool
    {
        $found = $this->locked(function () use ($DeviceID, $Enabled, $Sensitivity, $HoldSeconds): bool {
            $devices = $this->devices();
            if (!isset($devices[$DeviceID])) {
                return false;
            }
            $devices[$DeviceID]['motion'] = VisuExtCore::cleanMotion($Enabled, $Sensitivity, $HoldSeconds);
            $this->saveDevices($devices);
            return true;
        });
        if ($found) {
            $this->maintainMotionVariables();
            $this->sendConfig($DeviceID);
        }
        return (bool) $found;
    }

    /** Nachrichten „motion“ {on} und „cam“ {state} eines Geräts. */
    private function motionFrame(string $addr, int $port, string $wsKey, array $msg): void
    {
        [$state, $session, $device] = $this->checkSession($addr, $port, $wsKey, null);
        if ($state !== 'ok') {
            $this->push($addr, $port, ['t' => $state]);
            return;
        }
        $id = (string) $session['d'];
        if (!VisuExtCore::motionOf($device['motion'] ?? null)['on']) {
            return;
        }
        if ($msg['t'] === 'motion') {
            $this->setMotionValue($id, ($msg['on'] ?? false) === true);
            return;
        }
        $cam = VisuExtCore::cleanCamState($msg['state'] ?? '');
        $this->locked(function () use ($addr, $port, $cam): void {
            $sessions = $this->sessions();
            if (isset($sessions[$addr . '|' . $port])) {
                $sessions[$addr . '|' . $port]['cam'] = $cam;
                $this->saveSessions($sessions);
            }
        });
        $this->UpdateFormField('Motion', 'values', (string) json_encode($this->motionRows(), JSON_UNESCAPED_UNICODE));
    }

    private function setMotionValue(string $deviceId, bool $on): void
    {
        $ident = 'Motion_' . $deviceId;
        if (in_array($ident, $this->motionIdents(), true) && $this->GetValue($ident) !== $on) {
            $this->SetValue($ident, $on);
        }
    }

    /** Geräte ohne Verbindung melden keine Bewegung mehr. */
    private function resetMotion(): void
    {
        $online = $this->onlineDevices();
        foreach ($this->motionIdents() as $ident) {
            $id = substr($ident, strlen('Motion_'));
            if (!isset($online[$id])) {
                $this->setMotionValue($id, false);
            }
        }
        $this->UpdateFormField('Motion', 'values', (string) json_encode($this->motionRows(), JSON_UNESCAPED_UNICODE));
    }

    /** Je Gerät mit eingeschaltetem Bewegungsmelder eine Variable „Bewegung“; sonst keine. */
    private function maintainMotionVariables(): void
    {
        $known = $this->motionIdents();
        $idents = [];
        foreach ($this->devices() as $id => $device) {
            if (VisuExtCore::motionOf($device['motion'] ?? null)['on']) {
                $ident = 'Motion_' . $id;
                $this->MaintainVariable($ident, sprintf($this->Translate('%s motion'), (string) $device['name']), VARIABLETYPE_BOOLEAN, $this->motionPresentation(), 20, true);
                $idents[] = $ident;
            }
        }
        foreach (array_diff($known, $idents) as $ident) {
            $this->UnregisterVariable($ident);
        }
        if ($known !== $idents) {
            $this->WriteAttributeString('MotionIdents', (string) json_encode($idents));
        }
    }

    /** @return list<string> */
    private function motionIdents(): array
    {
        $idents = json_decode($this->ReadAttributeString('MotionIdents'), true);
        return is_array($idents) ? array_values(array_map('strval', $idents)) : [];
    }

    private function motionPresentation(): array
    {
        $option = fn (bool $value, string $caption, int $color): array => ['Value' => $value, 'Caption' => $this->Translate($caption),
            'IconActive' => false, 'IconValue' => '', 'ColorActive' => true, 'ColorValue' => $color, 'ContentColorActive' => false, 'ContentColorValue' => -1];
        return [
            'PRESENTATION' => VARIABLE_PRESENTATION_VALUE_PRESENTATION,
            'ICON'         => 'person-walking',
            'OPTIONS'      => (string) json_encode([$option(false, 'No motion', 0x808080), $option(true, 'Motion', 0xFF8000)], JSON_UNESCAPED_UNICODE),
        ];
    }

    /** @return list<array<string,mixed>> eine Zeile je Gerät */
    private function motionRows(): array
    {
        $cams = [];
        foreach ($this->sessions() as $session) {
            if (($session['cam'] ?? '') !== '') {
                $cams[(string) $session['d']] = (string) $session['cam'];
            }
        }
        $labels = ['ok' => 'running', 'blocked' => 'not allowed in the extension on this device', 'denied' => 'camera not granted in the browser',
            'nocam' => 'no camera', 'error' => 'error'];
        $rows = [];
        foreach ($this->devices() as $id => $device) {
            $motion = VisuExtCore::motionOf($device['motion'] ?? null);
            $cam = $cams[(string) $id] ?? '';
            $rows[] = ['Id' => (string) $id, 'Device' => (string) $device['name'], 'MotionOn' => $motion['on'], 'MotionLevel' => $motion['level'], 'MotionHold' => $motion['hold'],
                'Camera' => $motion['on'] && isset($labels[$cam]) ? $this->Translate($labels[$cam]) : '–'];
        }
        return $rows;
    }

    private function motionPanel(): array
    {
        return [
            'type'    => 'ExpansionPanel',
            'caption' => 'Motion detector',
            'items'   => [
                ['type' => 'Label', 'caption' => 'The camera of the device wakes the screensaver and sets the variable "motion" of the device; it goes off again after the reset time without motion. The camera runs in the browser extension; images never leave the device.'],
                ['type' => 'Label', 'caption' => 'Needs consent on the device: "Allow the camera as motion detector" in the setup of the browser extension. Only works while the display is on.'],
                [
                    'type'     => 'List',
                    'name'     => 'Motion',
                    'rowCount' => 6,
                    'add'      => false,
                    'delete'   => false,
                    'onEdit'   => 'VISUEXT_SetMotion($id, $Motion[\'Id\'], $Motion[\'MotionOn\'], $Motion[\'MotionLevel\'], $Motion[\'MotionHold\']);',
                    'columns'  => [
                        ['caption' => 'Device', 'name' => 'Device', 'width' => 'auto'],
                        ['caption' => 'Active', 'name' => 'MotionOn', 'width' => '90px', 'edit' => ['type' => 'CheckBox']],
                        ['caption' => 'Sensitivity', 'name' => 'MotionLevel', 'width' => '160px', 'edit' => ['type' => 'Select', 'options' => [
                            ['caption' => 'Low', 'value' => 1], ['caption' => 'Medium', 'value' => 2], ['caption' => 'High', 'value' => 3]]]],
                        ['caption' => 'Reset after', 'name' => 'MotionHold', 'width' => '160px', 'edit' => ['type' => 'NumberSpinner', 'minimum' => 5, 'maximum' => 3600, 'suffix' => ' s']],
                        ['caption' => 'Camera', 'name' => 'Camera', 'width' => '320px'],
                        ['caption' => 'ID', 'name' => 'Id', 'width' => '0px', 'visible' => false],
                    ],
                    'values'   => $this->motionRows(),
                ],
            ],
        ];
    }
}
