<?php

declare(strict_types=1);

/**
 * Geräte der Visu-Erweiterung: koppeln, verwalten, anmelden.
 *
 * Ein Gerät ist ein Browser mit der Erweiterung. Es bekommt beim Koppeln eine Kennung und einen
 * eigenen Schlüssel. Gespeichert wird nur der Hash des Schlüssels (settings.json ist Klartext);
 * Tickets und die Anmeldung am Kanal leiten sich aus diesem Hash ab.
 *
 * Braucht vom Modul: locked(), now(), refreshPresence(), dropSessions().
 */
trait VisuExtDevices
{
    /** Startet eine Kopplung und liefert den Code (sechs Ziffern, zehn Minuten gültig). */
    public function StartPairing(): string
    {
        $code = VisuExtCore::pairingCode();
        $this->SetBuffer('Pairing', (string) json_encode(['code' => $code, 'until' => $this->now() + VisuExtCore::PAIRING_SECONDS, 'tries' => 0]));
        $this->UpdateFormField('PairingInfo', 'caption', $this->pairingCaption());
        return $code;
    }

    /** Entfernt ein Gerät; seine Verbindungen werden abgewiesen. */
    public function RemoveDevice(string $DeviceID): bool
    {
        $found = $this->locked(function () use ($DeviceID): bool {
            $devices = $this->devices();
            if (!isset($devices[$DeviceID])) {
                return false;
            }
            unset($devices[$DeviceID]);
            $this->saveDevices($devices);
            return true;
        });
        if ($found) {
            $this->dropSessions($DeviceID);
            $this->maintainDeviceVariables();
            $this->refreshPresence();
        }
        return (bool) $found;
    }

    /** Name und Sperre eines Geräts ändern. Ein gesperrtes Gerät bekommt keine Skripte und keinen Kanal. */
    public function UpdateDevice(string $DeviceID, string $Name, bool $Blocked): bool
    {
        $found = $this->locked(function () use ($DeviceID, $Name, $Blocked): bool {
            $devices = $this->devices();
            if (!isset($devices[$DeviceID])) {
                return false;
            }
            $devices[$DeviceID]['name'] = VisuExtCore::cleanName($Name, (string) $devices[$DeviceID]['name']);
            $devices[$DeviceID]['blocked'] = $Blocked;
            $this->saveDevices($devices);
            return true;
        });
        if ($found) {
            if ($Blocked) {
                $this->dropSessions($DeviceID);
            }
            $this->refreshPresence();
        }
        return (bool) $found;
    }

    /**
     * Rücksprung zur Startseite: Nach $Minutes ohne Bedienung (0 = aus) wechselt die Visualisierung auf
     * diesem Gerät zurück auf $Page ('' = die Seite, mit der sie geladen wurde). Wirkt sofort, auch auf
     * einer schon geöffneten Visualisierung.
     */
    public function SetReturnHome(string $DeviceID, int $Minutes, string $Page): bool
    {
        $found = $this->locked(function () use ($DeviceID, $Minutes, $Page): bool {
            $devices = $this->devices();
            if (!isset($devices[$DeviceID])) {
                return false;
            }
            $devices[$DeviceID]['home'] = VisuExtCore::cleanHome($Minutes, $Page);
            $this->saveDevices($devices);
            return true;
        });
        if ($found) {
            $this->sendConfig($DeviceID);
        }
        return (bool) $found;
    }

    /** Legt fest, ob ein angedocktes Modul auf einem Gerät läuft (Vorgabe: jedes Modul auf jedem Gerät). */
    public function SetModuleAllowed(string $DeviceID, int $ModuleInstanceID, bool $Allowed): bool
    {
        return (bool) $this->locked(function () use ($DeviceID, $ModuleInstanceID, $Allowed): bool {
            $devices = $this->devices();
            if (!isset($devices[$DeviceID]) || $ModuleInstanceID <= 0) {
                return false;
            }
            $deny = array_values(array_diff(array_map('intval', (array) ($devices[$DeviceID]['deny'] ?? [])), [$ModuleInstanceID]));
            if (!$Allowed) {
                $deny[] = $ModuleInstanceID;
            }
            $devices[$DeviceID]['deny'] = $deny;
            $this->saveDevices($devices);
            return true;
        });
    }

    /** Geräte als JSON: id, name, online, blocked, seen (Unix-Zeit), page, home {minutes, page}. Ohne Schlüssel. */
    public function GetDevices(): string
    {
        return (string) json_encode($this->deviceList(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /** @return array<string,array<string,mixed>> Kennung => Gerät */
    private function devices(): array
    {
        $data = json_decode($this->ReadAttributeString('Devices'), true);
        return is_array($data) ? $data : [];
    }

    /** @param array<string,array<string,mixed>> $devices */
    private function saveDevices(array $devices): void
    {
        $this->WriteAttributeString('Devices', (string) json_encode($devices === [] ? new \stdClass() : $devices, JSON_UNESCAPED_UNICODE));
    }

    /** Gerät, wenn Kennung und Schlüssel stimmen und es nicht gesperrt ist. */
    private function deviceByKey(string $id, string $key): ?array
    {
        $device = $this->devices()[$id] ?? null;
        if (!is_array($device) || !empty($device['blocked']) || $key === '') {
            return null;
        }
        return hash_equals((string) $device['secret'], hash('sha256', $key)) ? $device : null;
    }

    private function moduleAllowed(array $device, int $module): bool
    {
        return !in_array($module, array_map('intval', (array) ($device['deny'] ?? [])), true);
    }

    /**
     * Koppelt ein Gerät mit dem Code aus dem Formular. Jeder Fehlversuch zählt; nach
     * PAIRING_TRIES ist der Code verbraucht.
     * @return array{id:string,name:string,key:string}|null
     */
    private function pair(mixed $code, mixed $name): ?array
    {
        $device = $this->locked(function () use ($code, $name): ?array {
            $pairing = json_decode($this->GetBuffer('Pairing'), true);
            if (!is_array($pairing) || (int) $pairing['until'] < $this->now()) {
                return null;
            }
            if (!hash_equals((string) $pairing['code'], VisuExtCore::normalizeCode($code))) {
                $pairing['tries'] = (int) $pairing['tries'] + 1;
                $this->SetBuffer('Pairing', $pairing['tries'] >= VisuExtCore::PAIRING_TRIES ? '' : (string) json_encode($pairing));
                return null;
            }
            $devices = $this->devices();
            if (count($devices) >= VisuExtCore::MAX_DEVICES) {
                return null;
            }
            do {
                $id = VisuExtCore::deviceId();
            } while (isset($devices[$id]));
            $key = VisuExtCore::deviceKey();
            $label = VisuExtCore::cleanName($name, sprintf($this->Translate('Device %d'), count($devices) + 1));
            $devices[$id] = ['name' => $label, 'secret' => hash('sha256', $key), 'blocked' => false, 'created' => $this->now(), 'seen' => 0, 'deny' => []];
            $this->saveDevices($devices);
            $this->SetBuffer('Pairing', '');
            return ['id' => $id, 'name' => $label, 'key' => $key];
        });
        if (is_array($device)) {
            $this->maintainDeviceVariables();
            $this->refreshPresence();
        }
        $this->UpdateFormField('PairingInfo', 'caption', $this->pairingCaption());
        return is_array($device) ? $device : null;
    }

    private function pairingCaption(): string
    {
        $pairing = json_decode($this->GetBuffer('Pairing'), true);
        if (!is_array($pairing) || (int) $pairing['until'] < $this->now()) {
            return $this->Translate('To connect a browser, press "Add device" and enter the code in the browser extension.');
        }
        $code = (string) $pairing['code'];
        return sprintf($this->Translate('Code %s, valid until %s. Enter it in the browser extension together with the address of your visualization.'),
            substr($code, 0, 3) . ' ' . substr($code, 3), date('H:i', (int) $pairing['until']));
    }

    /** @return list<array{id:string,name:string,online:bool,blocked:bool,seen:int,page:string,home:array{minutes:int,page:string}}> */
    private function deviceList(): array
    {
        $online = $this->onlineDevices();
        $list = [];
        foreach ($this->devices() as $id => $device) {
            $id = (string) $id;
            $list[] = [
                'id'      => $id,
                'name'    => (string) $device['name'],
                'online'  => isset($online[$id]),
                'blocked' => !empty($device['blocked']),
                'seen'    => isset($online[$id]) ? $online[$id]['t'] : (int) ($device['seen'] ?? 0),
                'page'    => isset($online[$id]) ? $online[$id]['page'] : '',
                'home'    => VisuExtCore::cleanHome($device['home']['minutes'] ?? 0, $device['home']['page'] ?? ''),
            ];
        }
        return $list;
    }

    /** Je Gerät eine Variable „online“, wenn im Formular gewünscht; sonst keine. */
    private function maintainDeviceVariables(): void
    {
        $want = $this->ReadPropertyBoolean('DeviceVariables');
        $devices = $this->devices();
        $known = json_decode($this->ReadAttributeString('VariableIdents'), true);
        $known = is_array($known) ? $known : [];
        $idents = [];
        foreach ($devices as $id => $device) {
            $ident = 'Online_' . $id;
            if ($want) {
                $this->MaintainVariable($ident, sprintf($this->Translate('%s online'), (string) $device['name']), VARIABLETYPE_BOOLEAN, $this->onlinePresentation(), 10, true);
                $idents[] = $ident;
            }
        }
        foreach (array_diff($known, $idents) as $ident) {
            $this->UnregisterVariable((string) $ident);
        }
        if ($known !== $idents) {
            $this->WriteAttributeString('VariableIdents', (string) json_encode($idents));
        }
    }

    private function onlinePresentation(): array
    {
        $option = fn (bool $value, string $caption, int $color): array => ['Value' => $value, 'Caption' => $this->Translate($caption),
            'IconActive' => false, 'IconValue' => '', 'ColorActive' => true, 'ColorValue' => $color, 'ContentColorActive' => false, 'ContentColorValue' => -1];
        return [
            'PRESENTATION' => VARIABLE_PRESENTATION_VALUE_PRESENTATION,
            'ICON'         => 'display',
            'OPTIONS'      => (string) json_encode([$option(false, 'Offline', 0x808080), $option(true, 'Online', 0x00C000)], JSON_UNESCAPED_UNICODE),
        ];
    }
}
