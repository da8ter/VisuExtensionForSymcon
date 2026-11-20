<?php

declare(strict_types=1);

/**
 * Andocken anderer Module über den Datenfluss.
 *
 * Ein angedocktes Modul ist ein Kind dieser Instanz. Es braucht keinen eigenen Hook und keinen
 * eigenen Schlüssel: Sein Skript liefert diese Instanz aus, Nachrichten laufen über ihren Kanal.
 *
 * An die Kinder (SendDataToChildren, DataID DOCK_RX), jede Antwort als Rückgabewert von ReceiveData:
 *   {Action:"Describe", Target:0}                       → {instance, name, version, active, info}
 *   {Action:"Script", Target:<Instanz>, Device:{id,name}} → der Skripttext
 *   {Action:"Event", Target:<Instanz>, Device:{id,name}, Data} → '' oder JSON, das an das Gerät zurückgeht
 * Von den Kindern (SendDataToParent, DataID DOCK_TX), Antwort als JSON:
 *   {Action:"Send", Instance, Device:<Kennung oder ''>, Data} → {ok, sent}
 *   {Action:"Devices", Instance}                         → {ok, devices:[{id, name, online}]}
 *
 * „Target“ steht immer an dritter Stelle, damit Kinder mit SetReceiveDataFilter vorsortieren können.
 * Diese Aufrufe laufen nie unter der Sperre: ein Kind darf in seiner Antwort selbst senden.
 */
trait VisuExtDock
{
    public function ForwardData(string $JSONString): string
    {
        $data = json_decode($JSONString, true);
        if (!is_array($data) || ($data['DataID'] ?? '') !== VisuExtCore::DOCK_TX) {
            return '';
        }
        $child = is_int($data['Instance'] ?? null) ? $data['Instance'] : 0;
        if ($child <= 0 || !$this->isChild($child)) {
            return (string) json_encode(['ok' => false, 'error' => 'instance']);
        }
        switch ((string) ($data['Action'] ?? '')) {
            case 'Send':
                $device = is_string($data['Device'] ?? null) ? $data['Device'] : '';
                return (string) json_encode(['ok' => true, 'sent' => $this->sendToDevices($device, $child, $data['Data'] ?? null)]);
            case 'Devices':
                $devices = $this->devices();
                $list = [];
                foreach ($this->deviceList() as $entry) {
                    if (!$entry['blocked'] && $this->moduleAllowed($devices[$entry['id']], $child)) {
                        $list[] = ['id' => $entry['id'], 'name' => $entry['name'], 'online' => $entry['online']];
                    }
                }
                return (string) json_encode(['ok' => true, 'devices' => $list], JSON_UNESCAPED_UNICODE);
        }
        return (string) json_encode(['ok' => false, 'error' => 'action']);
    }

    /** @return list<array{instance:int,name:string,version:string,active:bool,info:string}> */
    private function dockedModules(): array
    {
        $modules = [];
        foreach ($this->askChildren('Describe', 0) as $answer) {
            $module = VisuExtCore::checkModule(json_decode($answer, true));
            if ($module !== null && $this->isChild($module['instance'])) {
                $modules[$module['instance']] = $module;
            }
        }
        ksort($modules);
        return array_values($modules);
    }

    private function moduleScript(int $module, array $device): string
    {
        return $this->askChildren('Script', $module, ['Device' => $device])[0] ?? '';
    }

    /** @return mixed|null Antwort des Moduls an das Gerät, null ohne Antwort */
    private function moduleEvent(int $module, array $device, mixed $data): mixed
    {
        $answer = $this->askChildren('Event', $module, ['Device' => $device, 'Data' => $data])[0] ?? '';
        return $answer === '' ? null : json_decode($answer, true);
    }

    /** @return list<string> nicht leere Antworten der Kinder */
    private function askChildren(string $action, int $target, array $extra = []): array
    {
        try {
            $answers = @$this->SendDataToChildren((string) json_encode(
                ['DataID' => VisuExtCore::DOCK_RX, 'Action' => $action, 'Target' => $target] + $extra,
                JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
            ));
        } catch (\Throwable $e) {
            $this->SendDebug('Dock', $action . ': ' . $e->getMessage(), 0);
            return [];
        }
        return array_values(array_filter(is_array($answers) ? $answers : [], static fn ($a): bool => is_string($a) && $a !== ''));
    }

    private function isChild(int $instance): bool
    {
        $info = @IPS_GetInstance($instance);
        return is_array($info) && (int) ($info['ConnectionID'] ?? 0) === $this->InstanceID;
    }
}
