<?php

declare(strict_types=1);

/**
 * Kanal zu den Geräten: WebSocket am Hook des Moduls.
 *
 * Gemessen an Symcon 9.1 (20.11.2026, docs/plan-vertrag-2.md): Symcon nimmt die Verbindung an, bevor
 * Modulcode läuft, und meldet weder Ping noch Trennung. Deshalb meldet sich das Gerät im ersten Frame
 * an und schickt alle BEAT_SECONDS ein Lebenszeichen; bleibt es SESSION_SECONDS aus, gilt die
 * Verbindung als getrennt. Frames verschiedener Verbindungen laufen gleichzeitig: jede Änderung an
 * der Sitzungstabelle geschieht unter der Sperre.
 *
 * Nachrichten Gerät → Modul: {t:"hello", d, c, page} · {t:"beat", page} · {t:"ev", m, data}
 * Nachrichten Modul → Gerät: {t:"welcome", name, beat} · {t:"denied"} · {t:"unknown"} · {t:"beat"} · {t:"msg", m, data}
 *
 * Braucht vom Modul: locked(), now(), devices(), saveDevices(), moduleAllowed(), moduleEvent(), HOOK.
 */
trait VisuExtChannel
{
    private function frame(string $text, string $addr, int $port, string $wsKey): void
    {
        if ($text === '' || strlen($text) > VisuExtCore::MAX_FRAME || $port <= 0) {
            return;
        }
        $msg = json_decode($text, true);
        if (!is_array($msg)) {
            return;
        }
        switch ((string) ($msg['t'] ?? '')) {
            case 'hello':
                $this->hello($addr, $port, $wsKey, $msg);
                return;
            case 'beat':
                [$state] = $this->checkSession($addr, $port, $wsKey, VisuExtCore::cleanPage($msg['page'] ?? ''));
                $this->push($addr, $port, ['t' => $state === 'ok' ? 'beat' : $state]);
                return;
            case 'ev':
                [$state, $session, $device] = $this->checkSession($addr, $port, $wsKey, null);
                if ($state !== 'ok') {
                    $this->push($addr, $port, ['t' => $state]);
                    return;
                }
                $module = is_int($msg['m'] ?? null) ? $msg['m'] : 0;
                if ($module <= 0 || !$this->moduleAllowed($device, $module)) {
                    return;
                }
                // Außerhalb der Sperre: das Modul darf während der Antwort selbst an Geräte senden
                $reply = $this->moduleEvent($module, ['id' => (string) $session['d'], 'name' => (string) $device['name']], $msg['data'] ?? null);
                if ($reply !== null) {
                    $this->push($addr, $port, ['t' => 'msg', 'm' => $module, 'data' => $reply]);
                }
                return;
        }
    }

    /**
     * Sitzung einer Verbindung samt Gerät, in einem Zug unter der Sperre geprüft. Ein gesperrtes oder
     * entferntes Gerät verliert die Sitzung spätestens hier, auch wenn sich sein Abweisen und eine
     * Anmeldung gekreuzt haben. Mit $page zählt der Frame als Lebenszeichen.
     * @return array{0:string,1:?array,2:?array} 'ok' | 'unknown' | 'denied', dazu Sitzung und Gerät
     */
    private function checkSession(string $addr, int $port, string $wsKey, ?string $page): array
    {
        $result = $this->locked(function () use ($addr, $port, $wsKey, $page): array {
            $sessions = $this->sessions();
            $sid = $addr . '|' . $port;
            $session = $sessions[$sid] ?? null;
            if (!is_array($session) || $session['k'] !== $wsKey) {
                return ['unknown', null, null];
            }
            $device = $this->devices()[$session['d']] ?? null;
            if (!is_array($device) || !empty($device['blocked'])) {
                unset($sessions[$sid]);
                $this->saveSessions($sessions);
                return ['denied', null, null];
            }
            if ($page !== null) {
                $sessions[$sid]['t'] = $this->now();
                $sessions[$sid]['page'] = $page;
                $this->saveSessions($sessions);
            }
            return ['ok', $session, $device];
        }) ?? ['unknown', null, null];
        if ($result[0] === 'denied') {
            $this->refreshPresence();
        }
        return $result;
    }

    private function hello(string $addr, int $port, string $wsKey, array $msg): void
    {
        $id = is_string($msg['d'] ?? null) ? $msg['d'] : '';
        $token = is_string($msg['c'] ?? null) ? $msg['c'] : '';
        // Prüfen und Eintragen unter derselben Sperre: sonst könnte ein Gerät, das gerade gesperrt wird,
        // nach dem Abweisen seiner Verbindungen noch eine neue Sitzung bekommen.
        $device = $this->locked(function () use ($addr, $port, $wsKey, $id, $token, $msg): ?array {
            $device = $this->devices()[$id] ?? null;
            if (!is_array($device) || !empty($device['blocked']) || !hash_equals(VisuExtCore::channelToken($id, (string) $device['secret']), $token)) {
                return null;
            }
            $sessions = $this->sessions();
            $sessions[$addr . '|' . $port] = ['d' => $id, 'a' => $addr, 'p' => $port, 'k' => $wsKey, 't' => $this->now(),
                'page' => VisuExtCore::cleanPage($msg['page'] ?? '')];
            $this->saveSessions($sessions);
            return $device;
        });
        if (!is_array($device)) {
            $this->push($addr, $port, ['t' => 'denied']);
            return;
        }
        $this->SetTimerInterval('Sweep', VisuExtCore::BEAT_SECONDS * 1000);
        $this->push($addr, $port, ['t' => 'welcome', 'name' => (string) $device['name'], 'beat' => VisuExtCore::BEAT_SECONDS]);
        // Einstellungen des Geräts: sie können sich geändert haben, während es getrennt war
        $this->push($addr, $port, ['t' => 'cfg'] + $this->deviceConfig($device));
        $this->refreshPresence();
    }

    /** Entfernt Verbindungen ohne Lebenszeichen und hält fest, wann ein Gerät zuletzt da war. */
    private function sweep(): void
    {
        $now = $this->now();
        [$gone, $left] = $this->locked(function () use ($now): array {
            $sessions = $this->sessions();
            $gone = [];
            foreach ($sessions as $sid => $session) {
                if ($now - (int) $session['t'] > VisuExtCore::SESSION_SECONDS) {
                    $gone[(string) $session['d']] = max($gone[(string) $session['d']] ?? 0, (int) $session['t']);
                    unset($sessions[$sid]);
                }
            }
            if ($gone !== []) {
                $this->saveSessions($sessions);
                $devices = $this->devices();
                foreach ($gone as $id => $seen) {
                    if (isset($devices[$id])) {
                        $devices[$id]['seen'] = $seen;
                    }
                }
                $this->saveDevices($devices);
            }
            return [$gone, count($sessions)];
        }) ?? [[], 0];
        if ($left === 0) {
            $this->SetTimerInterval('Sweep', 0);
        }
        if ($gone !== []) {
            $this->refreshPresence();
        }
    }

    /** Verbindungen eines Geräts abweisen (entfernt oder gesperrt). */
    private function dropSessions(string $deviceId): void
    {
        $dropped = $this->locked(function () use ($deviceId): array {
            $sessions = $this->sessions();
            $dropped = [];
            foreach ($sessions as $sid => $session) {
                if ($session['d'] === $deviceId) {
                    $dropped[] = $session;
                    unset($sessions[$sid]);
                }
            }
            if ($dropped !== []) {
                $this->saveSessions($sessions);
                $devices = $this->devices();
                if (isset($devices[$deviceId])) {
                    $devices[$deviceId]['seen'] = max(array_map(static fn (array $s): int => (int) $s['t'], $dropped));
                    $this->saveDevices($devices);
                }
            }
            return $dropped;
        }) ?? [];
        foreach ($dropped as $session) {
            $this->push((string) $session['a'], (int) $session['p'], ['t' => 'denied']);
        }
    }

    /**
     * Schickt eine Nachricht eines Moduls an ein Gerät ('' = alle Geräte, auf denen das Modul läuft).
     * @return int Zahl der Verbindungen, an die gesendet wurde (keine Zustellbestätigung)
     */
    private function sendToDevices(string $deviceId, int $module, mixed $data): int
    {
        $devices = $this->devices();
        $sent = 0;
        foreach ($this->sessions() as $session) {
            $id = (string) $session['d'];
            $device = $devices[$id] ?? null;
            if (($deviceId !== '' && $id !== $deviceId) || !is_array($device) || !empty($device['blocked']) || !$this->moduleAllowed($device, $module)) {
                continue;
            }
            $this->push((string) $session['a'], (int) $session['p'], ['t' => 'msg', 'm' => $module, 'data' => $data]);
            $sent++;
        }
        return $sent;
    }

    /** Einstellungen, die die Laufzeit auf dem Gerät anwendet (im Skript und als Nachricht „cfg“). */
    private function deviceConfig(array $device): array
    {
        return [
            'home'  => VisuExtCore::cleanHome($device['home']['minutes'] ?? 0, $device['home']['page'] ?? ''),
            'saver' => VisuExtCore::cleanSaver($device['saver']['minutes'] ?? 0, $device['saver']['mode'] ?? ''),
        ];
    }

    /** Schickt einem Gerät seine Einstellungen auf allen offenen Verbindungen. */
    private function sendConfig(string $deviceId): void
    {
        $device = $this->devices()[$deviceId] ?? null;
        if (!is_array($device) || !empty($device['blocked'])) {
            return;
        }
        foreach ($this->sessions() as $session) {
            if ((string) $session['d'] === $deviceId) {
                $this->push((string) $session['a'], (int) $session['p'], ['t' => 'cfg'] + $this->deviceConfig($device));
            }
        }
    }

    /** Bildschirmschoner auf einem Gerät ('' = alle) ein- oder ausschalten; liefert die Zahl der Verbindungen. */
    private function sendSaver(string $deviceId, bool $on): int
    {
        $devices = $this->devices();
        $sent = 0;
        foreach ($this->sessions() as $session) {
            $id = (string) $session['d'];
            if (($deviceId !== '' && $id !== $deviceId) || !is_array($devices[$id] ?? null) || !empty($devices[$id]['blocked'])) {
                continue;
            }
            $this->push((string) $session['a'], (int) $session['p'], ['t' => 'saver', 'on' => $on]);
            $sent++;
        }
        return $sent;
    }

    private function push(string $addr, int $port, array $msg): void
    {
        $control = $this->webhookControl();
        if ($control > 0) {
            // Meldet auch an eine tote Verbindung „gesendet“: der Rückgabewert sagt nichts
            @WC_PushMessageEx($control, '/hook/' . self::HOOK,
                (string) json_encode($msg, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE), $addr, $port);
        }
    }

    /** @return array<string,array{d:string,a:string,p:int,k:string,t:int,page:string}> */
    private function sessions(): array
    {
        $data = json_decode($this->GetBuffer('Sessions'), true);
        return is_array($data) ? $data : [];
    }

    private function saveSessions(array $sessions): void
    {
        $this->SetBuffer('Sessions', (string) json_encode($sessions, JSON_UNESCAPED_UNICODE));
    }

    /** @return array<string,array{t:int,page:string}> Kennung => jüngste Verbindung */
    private function onlineDevices(): array
    {
        $online = [];
        foreach ($this->sessions() as $session) {
            $id = (string) $session['d'];
            if (!isset($online[$id]) || $online[$id]['t'] < (int) $session['t']) {
                $online[$id] = ['t' => (int) $session['t'], 'page' => (string) ($session['page'] ?? '')];
            }
        }
        return $online;
    }

    /** Variablen und offenes Formular an den Stand der Verbindungen angleichen. */
    private function refreshPresence(): void
    {
        $online = $this->onlineDevices();
        if ($this->GetValue('Connected') !== count($online)) {
            $this->SetValue('Connected', count($online));
        }
        // nur Variablen, die maintainDeviceVariables() angelegt hat
        $idents = json_decode($this->ReadAttributeString('VariableIdents'), true);
        foreach (is_array($idents) ? $idents : [] as $ident) {
            $id = substr((string) $ident, strlen('Online_'));
            if ($this->GetValue((string) $ident) !== isset($online[$id])) {
                $this->SetValue((string) $ident, isset($online[$id]));
            }
        }
        $this->UpdateFormField('Devices', 'values', (string) json_encode($this->deviceRows(), JSON_UNESCAPED_UNICODE));
    }
}
