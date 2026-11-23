<?php

declare(strict_types=1);

require_once __DIR__ . '/../libs/VisuExtCore.php';
require_once __DIR__ . '/../libs/VisuExtDevices.php';
require_once __DIR__ . '/../libs/VisuExtChannel.php';
require_once __DIR__ . '/../libs/VisuExtDock.php';
require_once __DIR__ . '/../libs/VisuExtMedia.php';
require_once __DIR__ . '/../libs/VisuExtMotion.php';

/**
 * Visu-Erweiterung: die eine Verbindung zwischen Symcon und der Browser-Erweiterung (Vertrag 2).
 *
 * Der Hook /hook/visuext trägt alles:
 *   POST ?k=pair    {code, name}            Gerät koppeln → {device:{id,name}, key}
 *   GET  ?k=ext&d=<Kennung>                 Beschreibung; Schlüssel in der Kopfzeile X-Visu-Key
 *   POST ?k=ext     {d, key}                dasselbe, Schlüssel im Rumpf
 *   GET  ?k=script&d=&m=&e=&s=              ein Skript (m=0: die Laufzeit), Adresse mit Ticket
 *   GET  ?k=media&d=&i=&e=&s=&o=            ein Stück eines eigenen Bildes für den Bildschirmschoner
 *   WebSocket                               Kanal zu den Geräten (libs/VisuExtChannel.php)
 * Schlüssel stehen nie in einer Adresse: Symcon schreibt Adressen ins Zugriffsprotokoll.
 *
 * Andere Module docken über den Datenfluss an (libs/VisuExtDock.php).
 */
class VisuExtension extends IPSModuleStrict
{
    use VisuExtDevices;
    use VisuExtChannel;
    use VisuExtDock;
    use VisuExtMedia;
    use VisuExtMotion;

    public const VERSION = '0.3';

    private const MODULE_ID = '{CB9C6C38-9B97-45CA-BFB5-EC7F936AF3FF}';
    private const WEBHOOK_CONTROL = '{015A6EB8-D6E5-4B93-B496-0D3F77AE9FE1}';
    private const HOOK = 'visuext';
    private const STATUS_SECOND_INSTANCE = 201;
    private const MAX_SCRIPTS = 16;
    private const MAX_BODY = 4096;

    public function Create(): void
    {
        parent::Create();

        $this->RegisterPropertyBoolean('DeviceVariables', false);
        // Kennung => {name, secret (Hash des Geräteschlüssels), blocked, created, seen, deny[]}
        $this->RegisterAttributeString('Devices', '{}');
        $this->RegisterAttributeString('VariableIdents', '[]');
        $this->RegisterAttributeString('MotionIdents', '[]');

        $this->RegisterTimer('Sweep', 0, 'IPS_RequestAction($_IPS[\'TARGET\'], \'Sweep\', 0);');

        $this->RegisterVariableInteger('Connected', $this->Translate('Connected devices'), [
            'PRESENTATION' => VARIABLE_PRESENTATION_VALUE_PRESENTATION,
            'ICON'         => 'display',
        ], 1);
    }

    public function ApplyChanges(): void
    {
        parent::ApplyChanges();

        if (IPS_GetKernelRunlevel() !== KR_READY) {
            $this->RegisterMessage(0, IPS_KERNELSTARTED);
            return;
        }

        // Der Hook hat einen festen Namen, damit das Koppeln ohne Instanz-ID auskommt: eine Instanz je Server.
        foreach (IPS_GetInstanceListByModuleID(self::MODULE_ID) as $other) {
            if ($other < $this->InstanceID) {
                $this->SetTimerInterval('Sweep', 0);
                $this->SetStatus(self::STATUS_SECOND_INSTANCE);
                return;
            }
        }

        // Flüchtig: Symcon vergisst den Hook beim Neustart
        $this->RegisterHook(self::HOOK);
        $this->maintainDeviceVariables();
        $this->maintainMotionVariables();
        $this->SetTimerInterval('Sweep', $this->sessions() === [] ? 0 : VisuExtCore::BEAT_SECONDS * 1000);
        $this->refreshPresence();
        $this->SetStatus(IS_ACTIVE);
    }

    public function MessageSink(int $TimeStamp, int $SenderID, int $Message, array $Data): void
    {
        if ($Message === IPS_KERNELSTARTED) {
            $this->ApplyChanges();
        }
    }

    public function Destroy(): void
    {
        parent::Destroy();
    }

    public function RequestAction(string $Ident, mixed $Value): void
    {
        if ($Ident === 'Sweep') {
            $this->sweep();
            return;
        }
        throw new \InvalidArgumentException('Invalid ident');
    }

    public function GetConfigurationForm(): string
    {
        $modules = $this->dockedModules();
        $actions = [
            ['type' => 'Label', 'name' => 'PairingInfo', 'caption' => $this->pairingCaption()],
            ['type' => 'Button', 'caption' => 'Add device', 'onClick' => 'VISUEXT_StartPairing($id);'],
            [
                'type'     => 'List',
                'name'     => 'Devices',
                'caption'  => 'Devices',
                'rowCount' => 6,
                'add'      => false,
                'delete'   => true,
                'onEdit'   => 'VISUEXT_UpdateDevice($id, $Devices[\'Id\'], $Devices[\'Name\'], $Devices[\'Blocked\']);',
                'onDelete' => 'VISUEXT_RemoveDevice($id, $Devices[\'Id\']);',
                'columns'  => [
                    ['caption' => 'Name', 'name' => 'Name', 'width' => 'auto', 'edit' => ['type' => 'ValidationTextBox']],
                    ['caption' => 'ID', 'name' => 'Id', 'width' => '110px'],
                    ['caption' => 'State', 'name' => 'State', 'width' => '110px'],
                    ['caption' => 'Last seen', 'name' => 'Seen', 'width' => '160px'],
                    ['caption' => 'Page', 'name' => 'Page', 'width' => '220px'],
                    ['caption' => 'Blocked', 'name' => 'Blocked', 'width' => '90px', 'edit' => ['type' => 'CheckBox']],
                ],
                'values'   => $this->deviceRows(),
            ],
            [
                'type'     => 'List',
                'name'     => 'Modules',
                'caption'  => 'Docked modules',
                'rowCount' => 4,
                'add'      => false,
                'delete'   => false,
                'columns'  => [
                    ['caption' => 'Name', 'name' => 'Name', 'width' => 'auto'],
                    ['caption' => 'Instance', 'name' => 'Instance', 'width' => '110px'],
                    ['caption' => 'Version', 'name' => 'Version', 'width' => '110px'],
                    ['caption' => 'State', 'name' => 'State', 'width' => '300px'],
                ],
                'values'   => array_map(fn (array $m): array => [
                    'Name'     => $m['name'],
                    'Instance' => '#' . $m['instance'],
                    'Version'  => $m['version'],
                    'State'    => $m['active'] ? $this->Translate('active') : trim($this->Translate('inactive') . ' ' . $m['info']),
                ], $modules),
            ],
        ];
        $permissions = $this->permissionRows($modules);
        if ($permissions !== []) {
            $actions[] = [
                'type'     => 'List',
                'name'     => 'Permissions',
                'caption'  => 'Which module runs on which device',
                'rowCount' => 6,
                'add'      => false,
                'delete'   => false,
                'onEdit'   => 'VISUEXT_SetModuleAllowed($id, $Permissions[\'DeviceId\'], $Permissions[\'ModuleId\'], $Permissions[\'Active\']);',
                'columns'  => [
                    ['caption' => 'Device', 'name' => 'Device', 'width' => 'auto'],
                    ['caption' => 'Module', 'name' => 'Module', 'width' => '300px'],
                    ['caption' => 'Active', 'name' => 'Active', 'width' => '90px', 'edit' => ['type' => 'CheckBox']],
                    ['caption' => 'DeviceId', 'name' => 'DeviceId', 'width' => '0px', 'visible' => false],
                    ['caption' => 'ModuleId', 'name' => 'ModuleId', 'width' => '0px', 'visible' => false],
                ],
                'values'   => $permissions,
            ];
        }

        return (string) json_encode([
            'elements' => [
                ['type' => 'Label', 'caption' => 'Connects the browser extension "Visu-Erweiterung für Symcon" with this Symcon. Each browser is paired once; other modules dock onto this instance and need no connection of their own.'],
                ['type' => 'CheckBox', 'name' => 'DeviceVariables', 'caption' => 'Create a variable "online" for each device'],
            ],
            'actions'  => array_merge($actions, $this->kioskPanels(), [$this->motionPanel()]),
            'status'   => [
                ['code' => IS_ACTIVE, 'icon' => 'active', 'caption' => 'Active'],
                ['code' => self::STATUS_SECOND_INSTANCE, 'icon' => 'error', 'caption' => 'There is already an instance of this module. Only one per Symcon is possible.'],
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    protected function ProcessHookData(): void
    {
        if (strtolower((string) ($_SERVER['HTTP_UPGRADE'] ?? '')) === 'websocket') {
            $this->frame($this->input(VisuExtCore::MAX_FRAME + 1), (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
                (int) ($_SERVER['REMOTE_PORT'] ?? 0), (string) ($_SERVER['HTTP_SEC_WEBSOCKET_KEY'] ?? ''));
            return;
        }

        $this->head('X-Content-Type-Options: nosniff');
        $this->head('Cache-Control: no-store');
        $body = null;
        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
            $body = json_decode($this->input(self::MAX_BODY), true);
            $body = is_array($body) ? $body : [];
        }

        switch ($this->param('k')) {
            case 'pair':
                $device = $body !== null ? $this->pair($body['code'] ?? '', $body['name'] ?? '') : null;
                if ($device === null) {
                    $this->status(403);
                    return;
                }
                $this->json(['ok' => true, 'visuExtension' => VisuExtCore::CONTRACT, 'device' => ['id' => $device['id'], 'name' => $device['name']],
                    'key' => $device['key'], 'address' => '/hook/' . self::HOOK]);
                return;

            case 'ext':
                $id = $body !== null ? (is_string($body['d'] ?? null) ? $body['d'] : '') : $this->param('d');
                $key = $body !== null ? (is_string($body['key'] ?? null) ? $body['key'] : '') : (string) ($_SERVER['HTTP_X_VISU_KEY'] ?? '');
                $device = $this->deviceByKey($id, $key);
                if ($device === null) {
                    $this->status(403);
                    return;
                }
                $this->json($this->description($id, $device));
                return;

            case 'script':
                $id = $this->param('d');
                $module = ctype_digit($this->param('m')) ? (int) $this->param('m') : -1;
                $device = $this->devices()[$id] ?? null;
                if (!is_array($device) || !empty($device['blocked']) || $module < 0
                    || !VisuExtCore::ticketValid($id, (string) $device['secret'], $module, (int) $this->param('e'), $this->param('s'), $this->now())) {
                    $this->status(403);
                    return;
                }
                $code = '';
                if ($module === 0) {
                    $code = $this->runtimeScript($id, $device);
                } elseif ($this->moduleAllowed($device, $module)) {
                    $code = $this->moduleScript($module, ['id' => $id, 'name' => (string) $device['name']]);
                }
                if ($code === '' || strlen($code) > $this->outputLimit()) {
                    if ($code !== '') {
                        $this->LogMessage(sprintf('Script of instance #%d is too large (%d bytes)', $module, strlen($code)), KL_WARNING);
                    }
                    $this->status(404);
                    return;
                }
                $this->head('Content-Type: application/javascript; charset=utf-8');
                echo $code;
                return;

            case 'media':
                $this->serveMedia();
                return;
        }
        $this->status(404);
    }

    /** Beschreibung für die Erweiterung: die Laufzeit zuerst, dann die Skripte der angedockten Module. */
    private function description(string $id, array $device): array
    {
        $expires = $this->now() + VisuExtCore::TICKET_SECONDS;
        $address = static fn (int $module): string => '/hook/' . self::HOOK . '?k=script&d=' . $id . '&m=' . $module . '&e=' . $expires
            . '&s=' . VisuExtCore::ticket($id, (string) $device['secret'], $module, $expires);
        $scripts = [$address(0)];
        foreach ($this->dockedModules() as $module) {
            if ($module['active'] && $this->moduleAllowed($device, $module['instance']) && count($scripts) < self::MAX_SCRIPTS) {
                $scripts[] = $address($module['instance']);
            }
        }
        return [
            'visuExtension' => VisuExtCore::CONTRACT,
            'name'          => IPS_GetName($this->InstanceID),
            'version'       => self::VERSION,
            'device'        => ['id' => $id, 'name' => (string) $device['name']],
            'scripts'       => $scripts,
        ];
    }

    /** Die Laufzeit (window.visuExt) mit den Angaben dieses Geräts. */
    private function runtimeScript(string $id, array $device): string
    {
        $config = [
            'v'       => VisuExtCore::CONTRACT,
            'device'  => ['id' => $id, 'name' => (string) $device['name']],
            'hook'    => '/hook/' . self::HOOK,
            'channel' => VisuExtCore::channelToken($id, (string) $device['secret']),
            'beat'    => VisuExtCore::BEAT_SECONDS,
        ] + $this->deviceConfig($device) + [
            // Kunstwerke des Bildschirmschoners: die Bilder lädt der Browser selbst bei Wikimedia Commons
            'art' => VisuExtCore::artworks(json_decode((string) @file_get_contents(__DIR__ . '/../libs/artworks.json'), true)),
        ];
        return str_replace('/*VISUEXT*/null',
            (string) json_encode($config, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_INVALID_UTF8_SUBSTITUTE),
            (string) @file_get_contents(__DIR__ . '/../libs/runtime.js'));
    }

    /** @return list<array<string,mixed>> */
    private function deviceRows(): array
    {
        $rows = [];
        foreach ($this->deviceList() as $device) {
            $rows[] = [
                'Id'      => $device['id'],
                'Name'    => $device['name'],
                'State'   => $this->Translate($device['blocked'] ? 'blocked' : ($device['online'] ? 'online' : 'offline')),
                'Seen'    => $device['seen'] > 0 ? date('d.m.Y H:i', $device['seen']) : '–',
                'Page'    => $device['page'],
                'Blocked' => $device['blocked'],
            ];
        }
        return $rows;
    }

    /** Zwei Aufklappbereiche: Rücksprung zur Startseite und Bildschirmschoner, je eine Zeile je Gerät. */
    private function kioskPanels(): array
    {
        $home = [];
        $saver = [];
        foreach ($this->deviceList() as $device) {
            $home[] = ['Id' => $device['id'], 'Device' => $device['name'], 'HomeMinutes' => $device['home']['minutes'], 'HomePage' => $device['home']['page']];
            $saver[] = ['Id' => $device['id'], 'Device' => $device['name'], 'SaverMinutes' => $device['saver']['minutes'], 'SaverMode' => $device['saver']['mode'],
                'SaverInterval' => $device['saver']['interval'], 'SaverFill' => $device['saver']['fill'], 'SaverCategory' => $device['saver']['category']];
        }
        $minutes = ['type' => 'NumberSpinner', 'minimum' => 0, 'maximum' => 1440, 'suffix' => ' min'];
        $id = ['caption' => 'ID', 'name' => 'Id', 'width' => '0px', 'visible' => false];
        $device = ['caption' => 'Device', 'name' => 'Device', 'width' => 'auto'];
        return [
            [
                'type'    => 'ExpansionPanel',
                'caption' => 'Return to start page',
                'items'   => [
                    ['type' => 'Label', 'caption' => 'After the set minutes without touch, click, key or mouse wheel the visualization on that device returns to its start page (0 = off). Takes effect immediately.'],
                    ['type' => 'Label', 'caption' => 'Start page empty = the page the visualization was loaded with; otherwise the address as shown in the column "Page" of the device list, e.g. /#/12345.'],
                    [
                        'type'     => 'List',
                        'name'     => 'Home',
                        'rowCount' => 6,
                        'add'      => false,
                        'delete'   => false,
                        'onEdit'   => 'VISUEXT_SetReturnHome($id, $Home[\'Id\'], $Home[\'HomeMinutes\'], $Home[\'HomePage\']);',
                        'columns'  => [
                            $device,
                            ['caption' => 'Back to start page after', 'name' => 'HomeMinutes', 'width' => '220px', 'edit' => $minutes],
                            ['caption' => 'Start page', 'name' => 'HomePage', 'width' => '260px', 'edit' => ['type' => 'ValidationTextBox']],
                            $id,
                        ],
                        'values'   => $home,
                    ],
                ],
            ],
            [
                'type'    => 'ExpansionPanel',
                'caption' => 'Screensaver',
                'items'   => [
                    ['type' => 'Label', 'caption' => 'After the set minutes without touch, click, key or mouse wheel a layer covers the visualization on that device (0 = off); the first touch only wakes it up. Takes effect immediately.'],
                    ['type' => 'Label', 'caption' => 'From scripts: VISUEXT_Wake and VISUEXT_StartScreensaver, e.g. for a motion detector.'],
                    ['type' => 'Label', 'caption' => 'Artworks: famous public-domain paintings in turn. The browser loads the images directly from Wikimedia Commons, so the device needs internet access; without it the clock is shown. "Fills the screen" crops the image instead of showing black bars.'],
                    ['type' => 'Label', 'caption' => 'Own images: image media objects from the chosen category in random order, including subcategories and links. Images above 15 MB are skipped; without images the clock is shown.'],
                    [
                        'type'     => 'List',
                        'name'     => 'Saver',
                        'rowCount' => 6,
                        'add'      => false,
                        'delete'   => false,
                        'onEdit'   => 'VISUEXT_SetScreensaver($id, $Saver[\'Id\'], $Saver[\'SaverMinutes\'], $Saver[\'SaverMode\']); VISUEXT_SetScreensaverArt($id, $Saver[\'Id\'], $Saver[\'SaverInterval\'], $Saver[\'SaverFill\']); VISUEXT_SetScreensaverMedia($id, $Saver[\'Id\'], $Saver[\'SaverCategory\']);',
                        'columns'  => [
                            $device,
                            ['caption' => 'Screensaver after', 'name' => 'SaverMinutes', 'width' => '220px', 'edit' => $minutes],
                            ['caption' => 'Screensaver shows', 'name' => 'SaverMode', 'width' => '260px', 'edit' => ['type' => 'Select', 'options' => [
                                ['caption' => 'Black', 'value' => 'black'], ['caption' => 'Clock', 'value' => 'clock'], ['caption' => 'Artworks', 'value' => 'art'], ['caption' => 'Own images', 'value' => 'media']]]],
                            ['caption' => 'Next image every', 'name' => 'SaverInterval', 'width' => '200px', 'edit' => ['type' => 'NumberSpinner', 'minimum' => 1, 'maximum' => 60, 'suffix' => ' min']],
                            ['caption' => 'Image fills the screen', 'name' => 'SaverFill', 'width' => '200px', 'edit' => ['type' => 'CheckBox']],
                            ['caption' => 'Category of own images', 'name' => 'SaverCategory', 'width' => '240px', 'edit' => ['type' => 'SelectCategory']],
                            $id,
                        ],
                        'values'   => $saver,
                    ],
                ],
            ],
        ];
    }

    /** @return list<array<string,mixed>> eine Zeile je Gerät und angedocktem Modul */
    private function permissionRows(array $modules): array
    {
        $rows = [];
        foreach ($this->devices() as $id => $device) {
            foreach ($modules as $module) {
                $rows[] = ['Device' => (string) $device['name'], 'Module' => $module['name'], 'Active' => $this->moduleAllowed($device, $module['instance']),
                    'DeviceId' => (string) $id, 'ModuleId' => $module['instance']];
            }
        }
        return $rows;
    }

    private function param(string $name): string
    {
        return is_string($_GET[$name] ?? null) ? $_GET[$name] : '';
    }

    private function json(array $data): void
    {
        $this->head('Content-Type: application/json; charset=utf-8');
        echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    }

    private function outputLimit(): int
    {
        $limit = @IPS_GetOption('ScriptOutputBufferLimit');
        return (is_int($limit) && $limit > 0 ? $limit : 1048576) - 1024;
    }

    private function webhookControl(): int
    {
        return (int) (IPS_GetInstanceListByModuleID(self::WEBHOOK_CONTROL)[0] ?? 0);
    }

    /** Alles, was Sitzungen oder Geräte liest und zurückschreibt, läuft hier durch. Nicht verschachteln. */
    private function locked(callable $fn): mixed
    {
        $name = 'VISUEXT_' . $this->InstanceID;
        if (!IPS_SemaphoreEnter($name, 3000)) {
            $this->SendDebug('Lock', 'timeout', 0);
            return null;
        }
        try {
            return $fn();
        } finally {
            IPS_SemaphoreLeave($name);
        }
    }

    // ── Nähte für die Tests ──
    protected function now(): int
    {
        return time();
    }

    protected function input(int $max): string
    {
        return (string) file_get_contents('php://input', false, null, 0, $max);
    }

    protected function status(int $code): void
    {
        http_response_code($code);
    }

    protected function head(string $line): void
    {
        header($line);
    }
}
