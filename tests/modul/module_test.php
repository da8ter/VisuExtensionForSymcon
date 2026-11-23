<?php

declare(strict_types=1);

// Modul „Visu-Erweiterung“ gegen die SDK-Attrappe: Koppeln, Beschreibung, Skripte, Kanal, Andocken.
//   php tests/modul/module_test.php
require __DIR__ . '/bootstrap.php';

class TestExt extends VisuExtension
{
    public int $clock = 1_800_000_000;
    public string $body = '';
    public int $code = 200;
    public array $headers = [];

    protected function now(): int { return $this->clock; }
    protected function input(int $max): string { return substr($this->body, 0, $max); }
    protected function status(int $code): void { $this->code = $code; }
    protected function head(string $line): void { $this->headers[] = $line; }

    /** HTTP-Anfrage an den Hook. @return array{0:int,1:string} Status und Ausgabe */
    public function http(array $get, ?array $post = null, array $server = []): array
    {
        $_GET = $get;
        $_SERVER = $server + ['REQUEST_METHOD' => $post === null ? 'GET' : 'POST'];
        $this->body = $post === null ? '' : (string) json_encode($post);
        $this->code = 200;
        $this->headers = [];
        ob_start();
        $this->ProcessHookData();
        return [$this->code, (string) ob_get_clean()];
    }

    /** WebSocket-Frame einer Verbindung; liefert, was das Modul daraufhin an sie geschickt hat. */
    public function ws(array|string $frame, int $port, string $key = 'k1', string $addr = '127.0.0.1'): array
    {
        $_GET = [];
        $_SERVER = ['REQUEST_METHOD' => 'GET', 'HTTP_UPGRADE' => 'websocket', 'REMOTE_ADDR' => $addr, 'REMOTE_PORT' => (string) $port, 'HTTP_SEC_WEBSOCKET_KEY' => $key];
        $this->body = is_array($frame) ? (string) json_encode($frame) : $frame;
        $from = count($GLOBALS['pushes']);
        $this->ProcessHookData();
        return array_values(array_map(static fn (array $p): array => $p[1],
            array_filter(array_slice($GLOBALS['pushes'], $from), static fn (array $p): bool => $p[2] === $addr && $p[3] === $port)));
    }

    public function devs(): array { return json_decode($this->attributes['Devices'], true); }
    public function sess(): array { return json_decode($this->buffers['Sessions'] ?? '[]', true); }
}

/** Angedocktes Modul nach der Vorlage aus examples/. */
class FakeChild extends IPSModuleStrict
{
    public bool $active = true;
    public string $script = 'window.__probe = /*CONFIG*/null;';
    public array $events = [];
    public mixed $reply = null;

    public function ApplyChanges(): void
    {
        $this->SetReceiveDataFilter('.*"Target":(0|' . $this->InstanceID . ')[,}].*');
    }

    public function ReceiveData(string $JSONString): string
    {
        $data = json_decode($JSONString, true);
        if (($data['DataID'] ?? '') !== VisuExtCore::DOCK_RX || !in_array($data['Target'], [0, $this->InstanceID], true)) {
            return '';
        }
        switch ($data['Action']) {
            case 'Describe':
                return (string) json_encode(['instance' => $this->InstanceID, 'name' => 'Probe ' . $this->InstanceID, 'version' => '1.0', 'active' => $this->active, 'info' => $this->active ? '' : 'aus']);
            case 'Script':
                return str_replace('/*CONFIG*/null', (string) json_encode(['instance' => $this->InstanceID, 'device' => $data['Device']], JSON_UNESCAPED_UNICODE), $this->script);
            case 'Event':
                $this->events[] = [$data['Device'], $data['Data']];
                return $this->reply === null ? '' : (string) json_encode($this->reply);
        }
        return '';
    }

    public function toParent(array $packet): array
    {
        return (array) json_decode($this->SendDataToParent((string) json_encode(['DataID' => VisuExtCore::DOCK_TX, 'Instance' => $this->InstanceID] + $packet)), true);
    }
}

function child(int $id, int $parent): FakeChild
{
    $c = new FakeChild($id);
    $c->parent = $parent;
    $c->ApplyChanges();
    return $c;
}

// ── Bausteine ──
check(VisuExtCore::normalizeCode(' 123-456 ') === '123456' && VisuExtCore::normalizeCode(['x']) === '', 'Code: Leerzeichen und Striche zählen nicht');
check(VisuExtCore::cleanName("  Küche\n\tTablet  ", 'x') === 'Küche Tablet' && VisuExtCore::cleanName('', 'Gerät 1') === 'Gerät 1'
    && mb_strlen(VisuExtCore::cleanName(str_repeat('ä', 80), 'x')) === 40, 'Gerätename: einzeilig, gekürzt, Rückfall');
$t = VisuExtCore::ticket('ab12cd34', 'geheim', 0, 1000);
check(VisuExtCore::ticketValid('ab12cd34', 'geheim', 0, 1000, $t, 990) && !VisuExtCore::ticketValid('ab12cd34', 'geheim', 0, 1000, $t, 1001)
    && !VisuExtCore::ticketValid('ab12cd34', 'geheim', 5, 1000, $t, 990) && !VisuExtCore::ticketValid('ab12cd34', 'anders', 0, 1000, $t, 990)
    && !VisuExtCore::ticketValid('ab12cd34', 'geheim', 0, 99999, VisuExtCore::ticket('ab12cd34', 'geheim', 0, 99999), 990),
    'Ticket: gilt nur für Gerät, Skript und Zeitfenster');
check(preg_match('/^\d{6}$/', VisuExtCore::pairingCode()) === 1 && preg_match('/^[a-f0-9]{8}$/', VisuExtCore::deviceId()) === 1
    && preg_match('/^[a-f0-9]{48}$/', VisuExtCore::deviceKey()) === 1, 'Code sechs Ziffern, Kennung und Schlüssel aus Zufall');

// ── Anlegen ──
$x = new TestExt(20000);
$x->Create();
$x->ApplyChanges();
check($x->status === IS_ACTIVE && isset($x->hooks['visuext']) && $x->values['Connected'] === 0 && $x->timers['Sweep'] === 0, 'Start: aktiv, Hook visuext, niemand verbunden');
$zwei = new TestExt(20001);
$zwei->Create();
$zwei->ApplyChanges();
check($zwei->status === 201 && $zwei->hooks === [], 'Zweite Instanz: Fehlerstatus, kein Hook');
unset($GLOBALS['modules'][20001]);

// ── Koppeln ──
check($x->http(['k' => 'pair'], ['code' => '123456', 'name' => 'x'])[0] === 403, 'Koppeln ohne laufenden Code: 403');
$code = $x->StartPairing();
check(preg_match('/^\d{6}$/', $code) === 1 && str_contains($x->formFields['PairingInfo']['caption'], substr($code, 0, 3) . ' ' . substr($code, 3)), 'Kopplung gestartet: Code steht im Formular');
check($x->http(['k' => 'pair'])[0] === 403, 'Koppeln per GET: 403');
$falsch = $code === '000000' ? '000001' : '000000';
check($x->http(['k' => 'pair'], ['code' => $falsch])[0] === 403 && $x->devs() === [], 'Falscher Code: 403, kein Gerät');
[$status, $out] = $x->http(['k' => 'pair'], ['code' => substr($code, 0, 3) . ' ' . substr($code, 3), 'name' => " Küche\n"]);
$pair = json_decode($out, true);
$id = $pair['device']['id'];
$key = $pair['key'];
check($status === 200 && $pair['ok'] === true && $pair['visuExtension'] === 2 && $pair['device']['name'] === 'Küche' && $pair['address'] === '/hook/visuext'
    && preg_match('/^[a-f0-9]{8}$/', $id) === 1 && preg_match('/^[a-f0-9]{48}$/', $key) === 1, 'Richtiger Code (mit Leerzeichen): Gerät mit Kennung und Schlüssel');
check(!str_contains($x->attributes['Devices'], $key) && $x->devs()[$id]['secret'] === hash('sha256', $key), 'Gespeichert wird nur der Hash des Schlüssels');
check($x->http(['k' => 'pair'], ['code' => $code])[0] === 403 && count($x->devs()) === 1, 'Der Code gilt nur einmal');
$code = $x->StartPairing();
for ($i = 0; $i < 5; $i++) {
    $x->http(['k' => 'pair'], ['code' => $code === '999999' ? '999998' : '999999']);
}
check($x->http(['k' => 'pair'], ['code' => $code])[0] === 403, 'Nach fünf Fehlversuchen ist der Code verbraucht');
$code = $x->StartPairing();
$x->clock += 601;
check($x->http(['k' => 'pair'], ['code' => $code])[0] === 403, 'Nach zehn Minuten ist der Code abgelaufen');
$code = $x->StartPairing();
$zweites = json_decode($x->http(['k' => 'pair'], ['code' => $code])[1], true);
check($zweites['device']['name'] === 'Device 2' && count($x->devs()) === 2, 'Ohne Namen: „Gerät N“');
$id2 = $zweites['device']['id'];
$key2 = $zweites['key'];

// ── Beschreibung ──
check($x->http(['k' => 'ext', 'd' => $id])[0] === 403 && $x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key2])[0] === 403
    && $x->http(['k' => 'ext', 'd' => 'nixnixni'], null, ['HTTP_X_VISU_KEY' => $key])[0] === 403, 'Beschreibung: ohne, mit fremdem Schlüssel und für unbekanntes Gerät 403');
[$status, $out] = $x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key]);
$ext = json_decode($out, true);
check($status === 200 && $ext['visuExtension'] === 2 && $ext['device'] === ['id' => $id, 'name' => 'Küche'] && $ext['version'] === VisuExtension::VERSION
    && count($ext['scripts']) === 1 && str_starts_with($ext['scripts'][0], '/hook/visuext?k=script&d=' . $id . '&m=0&e='), 'Beschreibung: Vertrag 2, Gerät, zuerst die Laufzeit');
check(!str_contains($out, $key) && in_array('Cache-Control: no-store', $x->headers, true), 'Beschreibung nennt den Schlüssel nicht und wird nicht gespeichert');
check(json_decode($x->http(['k' => 'ext'], ['d' => $id, 'key' => $key])[1], true)['device']['id'] === $id, 'Beschreibung auch mit Schlüssel im Rumpf');

// ── Skripte ──
parse_str((string) parse_url($ext['scripts'][0], PHP_URL_QUERY), $q);
[$status, $js] = $x->http($q);
check($status === 200 && in_array('Content-Type: application/javascript; charset=utf-8', $x->headers, true) && !str_contains($js, '/*VISUEXT*/null')
    && str_contains($js, '"channel":"' . VisuExtCore::channelToken($id, hash('sha256', $key)) . '"') && str_contains($js, '"id":"' . $id . '"') && !str_contains($js, $key),
    'Laufzeit: mit Kennung und Kanal-Anmeldung, ohne den Schlüssel');
check($x->http(['s' => 'x' . substr($q['s'], 1)] + $q)[0] === 403 && $x->http(['m' => '7'] + $q)[0] === 403 && $x->http(['d' => $id2] + $q)[0] === 403
    && $x->http(['e' => (string) ((int) $q['e'] + 10)] + $q)[0] === 403, 'Skript: veränderte Unterschrift, anderes Skript, anderes Gerät, andere Frist 403');
$x->clock += 121;
check($x->http($q)[0] === 403, 'Skript: nach zwei Minuten ist die Adresse abgelaufen');

// ── Andocken ──
$a = child(30001, 20000);
$b = child(30002, 20000);
$fremd = child(30003, 0); // nicht verbunden
$scripts = json_decode($x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key])[1], true)['scripts'];
check(count($scripts) === 3 && str_contains($scripts[1], '&m=30001&') && str_contains($scripts[2], '&m=30002&'), 'Angedockte Module erscheinen in der Beschreibung, nach Instanz sortiert');
parse_str((string) parse_url($scripts[1], PHP_URL_QUERY), $qa);
[$status, $js] = $x->http($qa);
check($status === 200 && $js === 'window.__probe = {"instance":30001,"device":{"id":"' . $id . '","name":"Küche"}};', 'Skript eines Moduls: vom Kind, mit dem Gerät');
$b->active = false;
check(count(json_decode($x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key])[1], true)['scripts']) === 2, 'Inaktives Modul: nicht in der Beschreibung');
$b->active = true;
check($x->SetModuleAllowed($id, 30001, false) && $x->devs()[$id]['deny'] === [30001], 'Modul für ein Gerät abschalten');
$scripts = json_decode($x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key])[1], true)['scripts'];
check(count($scripts) === 2 && str_contains($scripts[1], '&m=30002&'), 'Abgeschaltetes Modul fehlt in der Beschreibung dieses Geräts');
$e = $x->clock + 60;
check($x->http(['k' => 'script', 'd' => $id, 'm' => '30001', 'e' => (string) $e, 's' => VisuExtCore::ticket($id, hash('sha256', $key), 30001, $e)])[0] === 404, 'und wird auch mit gültigem Ticket nicht ausgeliefert');
check(count(json_decode($x->http(['k' => 'ext', 'd' => $id2], null, ['HTTP_X_VISU_KEY' => $key2])[1], true)['scripts']) === 3, 'Das andere Gerät bekommt es weiter');
$x->SetModuleAllowed($id, 30001, true);
check($x->devs()[$id]['deny'] === [], 'Modul wieder zulassen');
$a->script = str_repeat('x', 1048576);
parse_str((string) parse_url(json_decode($x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key])[1], true)['scripts'][1], PHP_URL_QUERY), $qa);
check($x->http($qa)[0] === 404 && str_contains(end($x->logs), 'too large'), 'Zu großes Skript: 404 und Warnung statt abgeschnittener Ausgabe');
$a->script = 'window.__probe = /*CONFIG*/null;';

// ── Kanal ──
$kanal = VisuExtCore::channelToken($id, hash('sha256', $key));
check($x->ws(['t' => 'hello', 'd' => $id, 'c' => 'falsch'], 5001) === [['t' => 'denied']] && $x->sess() === [], 'Anmeldung mit falschem Wert: abgewiesen');
check($x->ws(['t' => 'beat'], 5001) === [['t' => 'unknown']], 'Lebenszeichen ohne Anmeldung: „unbekannt“');
check($x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal, 'page' => '/#/kueche'], 5001) === [['t' => 'welcome', 'name' => 'Küche', 'beat' => 30], ['t' => 'cfg', 'home' => ['minutes' => 0, 'page' => ''], 'saver' => ['minutes' => 0, 'mode' => 'black', 'interval' => 5, 'fill' => false, 'category' => 0], 'motion' => ['on' => false, 'level' => 2, 'hold' => 30]]]
    && $x->values['Connected'] === 1 && $x->timers['Sweep'] === 30000, 'Anmeldung: willkommen, Gerät zählt als verbunden, Aufräum-Timer läuft');
$liste = json_decode($x->GetDevices(), true);
check($liste[0] === ['id' => $id, 'name' => 'Küche', 'online' => true, 'blocked' => false, 'seen' => $x->clock, 'page' => '/#/kueche', 'home' => ['minutes' => 0, 'page' => ''], 'saver' => ['minutes' => 0, 'mode' => 'black', 'interval' => 5, 'fill' => false, 'category' => 0], 'motion' => ['on' => false, 'level' => 2, 'hold' => 30]] && !str_contains($x->GetDevices(), 'secret'),
    'Geräteliste: online mit Seite, ohne Geheimnis');
$x->clock += 30;
check($x->ws(['t' => 'beat', 'page' => '/#/flur'], 5001) === [['t' => 'beat']] && $x->sess()['127.0.0.1|5001']['page'] === '/#/flur', 'Lebenszeichen: beantwortet, Seite nachgeführt');
check($x->ws(['t' => 'beat'], 5001, 'k2') === [['t' => 'unknown']], 'Gleicher Port, andere Verbindung: „unbekannt“');
check($x->ws(str_repeat('x', 70000), 5001) === [] && $x->ws('kein json', 5001) === [], 'Übergroße und kaputte Frames: übergangen');

$a->reply = ['ok' => 1];
check($x->ws(['t' => 'ev', 'm' => 30001, 'data' => ['taste' => 3]], 5001) === [['t' => 'msg', 'm' => 30001, 'data' => ['ok' => 1]]]
    && $a->events === [[['id' => $id, 'name' => 'Küche'], ['taste' => 3]]] && $b->events === [], 'Ereignis: nur beim Zielmodul, Antwort zurück an das Gerät');
$a->reply = null;
check($x->ws(['t' => 'ev', 'm' => 30001, 'data' => 1], 5001) === [] && count($a->events) === 2, 'Ereignis ohne Antwort: nichts zurück');
check($x->ws(['t' => 'ev', 'm' => 30001, 'data' => 1], 5009) === [['t' => 'unknown']] && count($a->events) === 2, 'Ereignis ohne Anmeldung: verworfen');
$x->SetModuleAllowed($id, 30002, false);
check($x->ws(['t' => 'ev', 'm' => 30002, 'data' => 1], 5001) === [] && $b->events === [], 'Ereignis an ein abgeschaltetes Modul: verworfen');
$x->SetModuleAllowed($id, 30002, true);

// zweites Gerät, zweite Verbindung
$x->ws(['t' => 'hello', 'd' => $id2, 'c' => VisuExtCore::channelToken($id2, hash('sha256', $key2))], 5002, 'k9');
check($x->values['Connected'] === 2, 'Zwei Geräte verbunden');
$von = count($pushes);
check($a->toParent(['Action' => 'Send', 'Device' => '', 'Data' => ['text' => 'hallo']]) === ['ok' => true, 'sent' => 2]
    && array_map(static fn (array $p): array => [$p[0], $p[1], $p[3]], array_slice($pushes, $von)) === [
        ['/hook/visuext', ['t' => 'msg', 'm' => 30001, 'data' => ['text' => 'hallo']], 5001],
        ['/hook/visuext', ['t' => 'msg', 'm' => 30001, 'data' => ['text' => 'hallo']], 5002]], 'Modul sendet an alle Geräte');
$von = count($pushes);
check($a->toParent(['Action' => 'Send', 'Device' => $id2, 'Data' => 7])['sent'] === 1 && $pushes[$von][3] === 5002 && count($pushes) === $von + 1, 'Modul sendet an ein Gerät');
$x->SetModuleAllowed($id2, 30001, false);
check($a->toParent(['Action' => 'Send', 'Device' => '', 'Data' => 1])['sent'] === 1, 'Senden überspringt Geräte, auf denen das Modul abgeschaltet ist');
check($a->toParent(['Action' => 'Devices'])['devices'] === [['id' => $id, 'name' => 'Küche', 'online' => true]], 'Modul fragt seine Geräte ab');
$x->SetModuleAllowed($id2, 30001, true);
check($fremd->parent === 0 && json_decode($x->ForwardData((string) json_encode(['DataID' => VisuExtCore::DOCK_TX, 'Instance' => 30003, 'Action' => 'Send', 'Data' => 1])), true)['ok'] === false,
    'Nicht angedockte Instanz: abgelehnt');
check($x->ForwardData('{"DataID":"{00000000-0000-0000-0000-000000000000}"}') === '', 'Fremdes Datenpaket: übergangen');

// ── Variablen je Gerät ──
$x->properties['DeviceVariables'] = true;
$x->ApplyChanges();
check($x->values['Online_' . $id] === true && $x->values['Online_' . $id2] === true && $x->variables['Online_' . $id]['name'] === 'Küche online'
    && $x->variables['Online_' . $id]['presentation']['PRESENTATION'] === VARIABLE_PRESENTATION_VALUE_PRESENTATION, 'Variable „online“ je Gerät, als Darstellung');

// ── Aufräumen ──
$x->clock += 60;
$x->ws(['t' => 'beat'], 5001);
$x->clock += 31; // Gerät 2 seit 91 s still, Gerät 1 seit 31 s
$x->RequestAction('Sweep', 0);
check(array_keys($x->sess()) === ['127.0.0.1|5001'] && $x->values['Connected'] === 1 && $x->values['Online_' . $id2] === false
    && $x->devs()[$id2]['seen'] === $x->clock - 91 && $x->timers['Sweep'] === 30000, 'Ohne Lebenszeichen seit 90 s: getrennt, „zuletzt gesehen“ gemerkt');

// ── Verwalten ──
$von = count($pushes);
check($x->UpdateDevice($id, 'Küche neu', true) && $x->devs()[$id]['name'] === 'Küche neu' && $x->sess() === [] && $pushes[$von][1] === ['t' => 'denied']
    && $x->values['Connected'] === 0, 'Sperren: Verbindung abgewiesen');
check($x->http(['k' => 'ext', 'd' => $id], null, ['HTTP_X_VISU_KEY' => $key])[0] === 403 && $x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal], 5003) === [['t' => 'denied']],
    'Gesperrtes Gerät: keine Beschreibung, keine Anmeldung');
// Eine Sitzung, die das Sperren überlebt hat (Anmeldung und Sperre haben sich gekreuzt), fällt beim nächsten Frame
$alt = ['d' => $id, 'a' => '127.0.0.1', 'p' => 5004, 'k' => 'k1', 't' => $x->clock, 'page' => ''];
$x->buffers['Sessions'] = (string) json_encode(['127.0.0.1|5004' => $alt]);
$ereignisse = count($a->events);
check($x->ws(['t' => 'ev', 'm' => 30001, 'data' => 1], 5004) === [['t' => 'denied']] && count($a->events) === $ereignisse && $x->sess() === [],
    'Gesperrtes Gerät mit alter Sitzung: Ereignis abgewiesen, Sitzung weg');
$x->buffers['Sessions'] = (string) json_encode(['127.0.0.1|5004' => $alt]);
check($x->ws(['t' => 'beat'], 5004) === [['t' => 'denied']] && $x->sess() === [] && $x->values['Connected'] === 0, 'und ein Lebenszeichen hält sie nicht am Leben');
$von = count($pushes);
$x->buffers['Sessions'] = (string) json_encode(['127.0.0.1|5004' => $alt]);
check($a->toParent(['Action' => 'Send', 'Device' => '', 'Data' => 1])['sent'] === 0 && count($pushes) === $von, 'An ein gesperrtes Gerät sendet kein Modul');
$x->buffers['Sessions'] = '[]';
$x->RequestAction('Sweep', 0);
check($x->timers['Sweep'] === 0, 'Niemand mehr verbunden: Aufräum-Timer aus');
check($x->UpdateDevice($id, '', false) && $x->devs()[$id]['name'] === 'Küche neu' && !$x->UpdateDevice('nixnixni', 'x', false), 'Freigeben; leerer Name lässt den alten, unbekanntes Gerät false');

// ── Rücksprung zur Startseite ──
check(VisuExtCore::cleanHome(5, '/#/12345') === ['minutes' => 5, 'page' => '/#/12345'] && VisuExtCore::cleanHome(-3, 'https://boese.example/') === ['minutes' => 0, 'page' => '']
    && VisuExtCore::cleanHome('9999', '//boese.example/x') === ['minutes' => 1440, 'page' => ''] && VisuExtCore::cleanHome(null, "/\\boese") === ['minutes' => 0, 'page' => '']
    && VisuExtCore::cleanHome(2, '  /visu/#/1  ')['page'] === '/visu/#/1', 'Rücksprung: Minuten begrenzt, Startseite nur als Pfad dieses Servers');
$x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal, 'page' => '/#/flur'], 5004, 'k4');
$von = count($pushes);
check($x->SetReturnHome($id, 5, '/#/start') && $x->devs()[$id]['home'] === ['minutes' => 5, 'page' => '/#/start'] && !$x->SetReturnHome('nixnixni', 5, ''), 'Rücksprung: gespeichert; unbekanntes Gerät: false');
check(array_slice($pushes, $von) === [['/hook/visuext', ['t' => 'cfg', 'home' => ['minutes' => 5, 'page' => '/#/start'], 'saver' => ['minutes' => 0, 'mode' => 'black', 'interval' => 5, 'fill' => false, 'category' => 0], 'motion' => ['on' => false, 'level' => 2, 'hold' => 30]], '127.0.0.1', 5004]], 'Rücksprung: die offene Visualisierung des Geräts bekommt die Einstellung sofort, sonst niemand');
$e = $x->clock + 60;
[, $laufzeit] = $x->http(['k' => 'script', 'd' => $id, 'm' => '0', 'e' => (string) $e, 's' => VisuExtCore::ticket($id, $x->devs()[$id]['secret'], 0, $e)]);
check(str_contains($laufzeit, '"home":{"minutes":5,"page":"/#/start"}'), 'Rücksprung: die Laufzeit trägt die Einstellung schon beim Laden');
check($x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal], 5005, 'k5')[1] === ['t' => 'cfg', 'home' => ['minutes' => 5, 'page' => '/#/start'], 'saver' => ['minutes' => 0, 'mode' => 'black', 'interval' => 5, 'fill' => false, 'category' => 0], 'motion' => ['on' => false, 'level' => 2, 'hold' => 30]], 'Rücksprung: nach jeder Anmeldung noch einmal, falls sie sich getrennt geändert hat');
$bereiche = array_values(array_filter(json_decode($x->GetConfigurationForm(), true)['actions'], static fn (array $a): bool => ($a['type'] ?? '') === 'ExpansionPanel'));
$listeIn = static fn (array $bereich): array => array_values(array_filter($bereich['items'], static fn (array $a): bool => ($a['type'] ?? '') === 'List'))[0];
check(array_column($bereiche, 'caption') === ['Return to start page', 'Screensaver', 'Motion detector'], 'Rücksprung, Bildschirmschoner und Bewegungsmelder: je ein eigener Aufklappbereich');
check($listeIn($bereiche[0])['values'][0] === ['Id' => $id, 'Device' => 'Küche neu', 'HomeMinutes' => 5, 'HomePage' => '/#/start']
    && $listeIn($bereiche[0])['onEdit'] === 'VISUEXT_SetReturnHome($id, $Home[\'Id\'], $Home[\'HomeMinutes\'], $Home[\'HomePage\']);', 'Rücksprung: je Gerät einstellbar');
check($listeIn($bereiche[1])['values'][0] === ['Id' => $id, 'Device' => 'Küche neu', 'SaverMinutes' => 0, 'SaverMode' => 'black', 'SaverInterval' => 5, 'SaverFill' => false, 'SaverCategory' => 0]
    && str_contains($listeIn($bereiche[1])['onEdit'], 'VISUEXT_SetScreensaver($id,') && str_contains($listeIn($bereiche[1])['onEdit'], 'VISUEXT_SetScreensaverArt($id,'), 'Bildschirmschoner: je Gerät einstellbar');

// ── Bildschirmschoner ──
check(VisuExtCore::cleanSaver(10, 'clock') === ['minutes' => 10, 'mode' => 'clock', 'interval' => 5, 'fill' => false, 'category' => 0] && VisuExtCore::cleanSaver(-1, 'disco', 0, 'ja') === ['minutes' => 0, 'mode' => 'black', 'interval' => 1, 'fill' => false, 'category' => 0]
    && VisuExtCore::cleanSaver('5000', 'art', 999, true) === ['minutes' => 1440, 'mode' => 'art', 'interval' => 60, 'fill' => true, 'category' => 0], 'Bildschirmschoner: Minuten begrenzt, unbekannter Inhalt wird schwarz');
$von = count($pushes);
check($x->SetScreensaver($id, 10, 'clock') && $x->devs()[$id]['saver'] === ['minutes' => 10, 'mode' => 'clock', 'interval' => 5, 'fill' => false, 'category' => 0] && !$x->SetScreensaver('nixnixni', 1, 'black'), 'Bildschirmschoner: gespeichert; unbekanntes Gerät: false');
check(array_column(array_slice($pushes, $von), 1) === array_fill(0, 2, ['t' => 'cfg', 'home' => ['minutes' => 5, 'page' => '/#/start'], 'saver' => ['minutes' => 10, 'mode' => 'clock', 'interval' => 5, 'fill' => false, 'category' => 0], 'motion' => ['on' => false, 'level' => 2, 'hold' => 30]]),
    'Bildschirmschoner: beide offenen Verbindungen des Geräts bekommen die Einstellung sofort');
$von = count($pushes);
check($x->StartScreensaver($id) === 2 && $x->Wake('') === 2 && $x->Wake('nixnixni') === 0
    && array_column(array_slice($pushes, $von), 1) === [['t' => 'saver', 'on' => true], ['t' => 'saver', 'on' => true], ['t' => 'saver', 'on' => false], ['t' => 'saver', 'on' => false]],
    'Einschalten und Aufwecken aus Symcon: an ein Gerät oder an alle, Rückgabe zählt die Verbindungen');
check($x->SetScreensaverArt($id, 3, true) && $x->devs()[$id]['saver'] === ['minutes' => 10, 'mode' => 'clock', 'interval' => 3, 'fill' => true, 'category' => 0]
    && $x->SetScreensaver($id, 2, 'art') && $x->devs()[$id]['saver'] === ['minutes' => 2, 'mode' => 'art', 'interval' => 3, 'fill' => true, 'category' => 0] && !$x->SetScreensaverArt('nixnixni', 3, true),
    'Kunstwerke: Bildwechsel und „füllt den Bildschirm“ gespeichert, beide Einstellungen lassen einander stehen');
$e = $x->clock + 60;
[, $laufzeit] = $x->http(['k' => 'script', 'd' => $id, 'm' => '0', 'e' => (string) $e, 's' => VisuExtCore::ticket($id, $x->devs()[$id]['secret'], 0, $e)]);
preg_match('/var C = (\{.*\});/', $laufzeit, $cm);
$kunst = json_decode($cm[1] ?? '', true)['art'] ?? [];
check(count($kunst) >= 40 && array_keys($kunst[0]) === ['title', 'artist', 'year', 'file'] && count(array_unique(array_column($kunst, 'file'))) === count($kunst)
    && strlen($laufzeit) < 60000, 'Kunstwerke: die Laufzeit trägt die Liste (Titel, Künstler, Jahr, Datei), ohne Doppelte');
check(VisuExtCore::artworks([['file' => 'a/b.jpg'], ['file' => 'x.png'], ['file' => 'weg?x=1.jpg'], 'x', ['file' => 'gut.JPG', 'title' => "T\n"]]) === [['title' => 'T', 'artist' => '', 'year' => '', 'file' => 'gut.JPG']],
    'Kunstwerke: nur JPEG-Dateinamen ohne Pfad und Abfrage, Texte bereinigt');
check($x->SetScreensaver($id, 0, 'black') && $x->SetScreensaverArt($id, 5, false), 'Bildschirmschoner wieder aus');
check(json_decode($x->GetDevices(), true)[0]['home'] === ['minutes' => 5, 'page' => '/#/start'] && $x->SetReturnHome($id, 0, ''), 'Rücksprung: in GetDevices sichtbar, wieder ausschaltbar');
check($x->RemoveDevice($id2) && !isset($x->devs()[$id2]) && !isset($x->variables['Online_' . $id2]) && isset($x->variables['Online_' . $id]) && !$x->RemoveDevice($id2),
    'Entfernen: Gerät und seine Variable weg');
$x->properties['DeviceVariables'] = false;
$x->ApplyChanges();
check(!isset($x->variables['Online_' . $id]) && $x->attributes['VariableIdents'] === '[]', 'Ohne den Schalter verschwinden die Variablen');

// ── Formular ──
$form = json_decode($x->GetConfigurationForm(), true);
$liste = static function (array $form, string $name): array {
    foreach ($form['actions'] as $element) {
        if (($element['name'] ?? '') === $name) {
            return $element['values'];
        }
    }
    throw new RuntimeException('Liste fehlt: ' . $name);
};
$geraete = $liste($form, 'Devices');
$module = $liste($form, 'Modules');
$rechte = $liste($form, 'Permissions');
check($geraete === [['Id' => $id, 'Name' => 'Küche neu', 'State' => 'online', 'Seen' => date('d.m.Y H:i', $x->clock), 'Page' => '/#/flur', 'Blocked' => false]], 'Formular: Geräteliste (seit der Rücksprung-Probe wieder verbunden): ' . json_encode($geraete, JSON_UNESCAPED_UNICODE));
check(array_column($module, 'Instance') === ['#30001', '#30002'] && $module[0]['State'] === 'active', 'Formular: angedockte Module');
check(count($rechte) === 2 && $rechte[0] === ['Device' => 'Küche neu', 'Module' => 'Probe 30001', 'Active' => true, 'DeviceId' => $id, 'ModuleId' => 30001], 'Formular: je Gerät und Modul eine Zeile');
$a->parent = 0;
$b->parent = 0;
check(!in_array('Permissions', array_column(json_decode($x->GetConfigurationForm(), true)['actions'], 'name'), true), 'Ohne angedockte Module keine Rechte-Liste');


// ── Eigene Bilder aus Medienobjekten ──
$jpeg = "\xFF\xD8\xFF\xE0" . str_repeat('J', 2_000_000);
$png = "\x89PNG\r\n\x1A\n" . str_repeat('P', 100);
$bild = static fn (string $inhalt, int $art = MEDIATYPE_IMAGE, bool $da = true, ?int $groesse = null): array
    => ['type' => OBJECTTYPE_MEDIA, 'media' => [$art, $da, $groesse ?? strlen($inhalt)], 'content' => $inhalt];
$GLOBALS['objects'] = [
    40000 => ['type' => OBJECTTYPE_CATEGORY, 'children' => [40001, 40002, 40003, 40004, 40005, 40010, 40020]],
    40001 => $bild($jpeg),
    40002 => $bild($png),
    40003 => $bild('Ton', 2),                                   // kein Bild
    40004 => $bild($jpeg, MEDIATYPE_IMAGE, false),              // Datei fehlt
    40005 => $bild($jpeg, MEDIATYPE_IMAGE, true, VisuExtCore::MAX_IMAGE_BYTES + 1), // zu groß
    40010 => ['type' => OBJECTTYPE_CATEGORY, 'children' => [40011, 40012]],
    40011 => $bild('<svg xmlns="http://www.w3.org/2000/svg"/>'), // als Bild angelegt, aber keines, das ausgeliefert wird
    40012 => ['type' => 2],                                     // Variable
    40020 => ['type' => OBJECTTYPE_LINK, 'target' => 41001],
    41000 => ['type' => OBJECTTYPE_CATEGORY, 'children' => [41001, 41002]],
    41001 => $bild($png),
    41002 => $bild($png),
];
check(VisuExtCore::cleanSaver(1, 'media', 5, false, 40000)['category'] === 40000 && VisuExtCore::cleanSaver(1, 'media', 5, false, '40000')['category'] === 0
    && VisuExtCore::cleanSaver(1, 'media', 5, false, -3) === ['minutes' => 1, 'mode' => 'media', 'interval' => 5, 'fill' => false, 'category' => 0], 'Eigene Bilder: Inhalt „media“, Kategorie nur als positive Zahl');
check(VisuExtCore::imageType($jpeg) === 'image/jpeg' && VisuExtCore::imageType($png) === 'image/png' && VisuExtCore::imageType('GIF89a..') === 'image/gif'
    && VisuExtCore::imageType('RIFF1234WEBPVP8 ') === 'image/webp' && VisuExtCore::imageType('<svg') === '' && VisuExtCore::imageType('') === '', 'Bildart nach den ersten Bytes; SVG und Unbekanntes nicht');
$wahl = [];
for ($i = 0; $i < 200; $i++) {
    $wahl[] = VisuExtCore::pickImage([1, 2, 3], [1, 3]);
    $wahl[] = VisuExtCore::pickImage([1, 2, 3], [3, 1, 2])[0] === 2 ? 'wiederholt' : [2, false];
}
check(array_unique($wahl, SORT_REGULAR) === [[2, false]] && VisuExtCore::pickImage([1, 2, 3], [1, 2, 3])[1] === true && VisuExtCore::pickImage([7], [7]) === [7, true]
    && VisuExtCore::pickImage([7], 'x') === [7, false] && VisuExtCore::pickImage([], [1]) === [0, false],
    'Zufallswahl: nur noch nicht Gezeigtes; sind alle durch, neue Runde ohne das letzte; ohne Bilder keines');
$von = count($pushes);
$x->SetScreensaverArt($id, 3, true);
check($x->SetScreensaverMedia($id, 40000) && $x->SetScreensaver($id, 2, 'media') && !$x->SetScreensaverMedia('nixnixni', 40000)
    && $x->devs()[$id]['saver'] === ['minutes' => 2, 'mode' => 'media', 'interval' => 3, 'fill' => true, 'category' => 40000]
    && end($pushes)[1]['saver']['category'] === 40000, 'Eigene Bilder: Kategorie gespeichert, die anderen Einstellungen bleiben, das Gerät erfährt es sofort');
$gezeigt = [];
$adressen = [];
for ($i = 0; $i < 4; $i++) {
    $antwort = $x->ws(['t' => 'pic', 'seen' => $gezeigt], 5005, 'k5')[0];
    $gezeigt[] = $antwort['i'];
    $adressen[$antwort['i']] = $antwort['u'];
}
sort($gezeigt);
check($gezeigt === [40001, 40002, 40011, 41001] && $antwort['reset'] === false && $x->ws(['t' => 'pic', 'seen' => $gezeigt], 5005, 'k5')[0]['reset'] === true,
    'Nächstes Bild über den Kanal: jedes Bild der Kategorie einmal (Unterkategorie und Verknüpfung zählen; kein Ton, nichts Fehlendes, nichts zu Großes), dann neue Runde');
check($x->ws(['t' => 'pic'], 5999, 'fremd') === [['t' => 'unknown']], 'Ohne Sitzung gibt es kein Bild');
parse_str((string) parse_url($adressen[40001], PHP_URL_QUERY), $q);
check(str_starts_with($adressen[40001], '/hook/visuext?k=media&d=' . $id . '&i=40001&e=') && !str_contains($adressen[40001], $x->devs()[$id]['secret']), 'Die Adresse trägt eine Unterschrift, keinen Schlüssel');
$ganz = '';
$stuecke = 0;
do {
    [$status, $teil] = $x->http($q + ['o' => (string) strlen($ganz)]);
    $ganz .= $teil;
    $stuecke++;
} while ($status === 200 && $teil !== '' && strlen($ganz) < strlen($jpeg) && $stuecke < 10);
check($ganz === $jpeg && $stuecke === 3 && in_array('Content-Type: image/jpeg', $x->headers, true) && in_array('X-Visu-Size: ' . strlen($jpeg), $x->headers, true)
    && in_array('Cache-Control: no-store', $x->headers, true), 'Auslieferung in Stücken unter Symcons Ausgabegrenze, mit Bildart und ganzer Größe');
check($x->http($q + ['o' => (string) strlen($jpeg)])[0] === 404 && $x->http(['s' => str_repeat('0', 32)] + $q)[0] === 403 && $x->http(['i' => '40002'] + $q)[0] === 403
    && $x->http(['k' => 'script', 'm' => '40001'] + $q)[0] === 403 && $x->http(['e' => (string) ($q['e'] + 1)] + $q)[0] === 403, 'Versatz hinter dem Ende: 404; falsche Unterschrift, anderes Bild, als Skript oder verlängert: 403');
$fuer = static fn (int $media): array => ['k' => 'media', 'd' => $id, 'i' => (string) $media, 'e' => (string) ($x->clock + 60),
    's' => VisuExtCore::ticket($id, $x->devs()[$id]['secret'], $media, $x->clock + 60, 'media')];
check($x->http($fuer(41002))[0] === 404 && $x->http($fuer(40011))[0] === 404 && $x->http($fuer(40003))[0] === 404, 'Nur Bilder aus der Kategorie des Geräts, und nur echte Bilder: sonst 404 trotz gültiger Unterschrift');
$x->clock += VisuExtCore::TICKET_SECONDS + 1;
check($x->http($q)[0] === 403, 'Die Adresse eines Bildes gilt nur kurz');
$x->SetScreensaverMedia($id, 41000);
check($x->http($fuer(40001))[0] === 404 && $x->http($fuer(41002))[0] === 200, 'Kategorie gewechselt: die alten Bilder gibt es nicht mehr, die neuen schon');
$x->SetScreensaverMedia($id, 49999);
check($x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal], 5006, 'k6')[0]['t'] === 'welcome' && $x->ws(['t' => 'pic', 'seen' => []], 5006, 'k6') === [['t' => 'pic']], 'Kategorie gibt es nicht oder sie ist leer: Antwort ohne Bild');
$x->SetScreensaverMedia($id, 0);
$x->SetScreensaver($id, 2, 'art');

// ── Bewegungsmelder ──
check(VisuExtCore::cleanMotion(true, 3, 120) === ['on' => true, 'level' => 3, 'hold' => 120] && VisuExtCore::cleanMotion('ja', 7, 1) === ['on' => false, 'level' => 2, 'hold' => 5]
    && VisuExtCore::cleanMotion(true, 1, 99999)['hold'] === 3600
    && VisuExtCore::motionOf(null) === ['on' => false, 'level' => 2, 'hold' => 30] && VisuExtCore::cleanCamState('ok') === 'ok' && VisuExtCore::cleanCamState('<b>') === 'error',
    'Bewegungsmelder: nur echtes true schaltet ein, Empfindlichkeit 1–3, Rückstellzeit 5–3600 s, unbekannter Kamera-Zustand wird „error“');
check($x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal], 5007, 'k7')[0]['t'] === 'welcome' && $x->ws(['t' => 'motion', 'on' => true], 5007, 'k7') === []
    && !isset($x->variables['Motion_' . $id]), 'Bewegungsmelder aus: Meldungen des Geräts bleiben folgenlos, keine Variable');
$von = count($pushes);
check($x->SetMotion($id, true, 3, 120) && $x->devs()[$id]['motion'] === ['on' => true, 'level' => 3, 'hold' => 120] && !$x->SetMotion('nixnixni', true, 2, 30)
    && $x->variables['Motion_' . $id]['type'] === VARIABLETYPE_BOOLEAN && $x->values['Motion_' . $id] === false
    && $x->variables['Motion_' . $id]['presentation']['PRESENTATION'] === VARIABLE_PRESENTATION_VALUE_PRESENTATION,
    'Bewegungsmelder an: gespeichert, Variable „Bewegung“ des Geräts mit Darstellung');
check(array_column(array_slice($pushes, $von), 1)[0]['motion'] === ['on' => true, 'level' => 3, 'hold' => 120], 'Bewegungsmelder: die offene Visualisierung bekommt die Einstellung sofort');
$x->ws(['t' => 'motion', 'on' => true], 5007, 'k7');
check($x->values['Motion_' . $id] === true, 'Bewegung gemeldet: Variable an');
$x->ws(['t' => 'cam', 'state' => 'blocked'], 5007, 'k7');
$zeile = array_values(array_filter(json_decode($x->formFields['Motion']['values'], true), static fn (array $r): bool => $r['Id'] === $id))[0];
check($zeile['MotionOn'] === true && $zeile['MotionLevel'] === 3 && $zeile['MotionHold'] === 120 && $zeile['Camera'] === 'not allowed in the extension on this device', 'Zustand der Kamera erscheint im Formular');
$x->ws(['t' => 'motion', 'on' => false], 5007, 'k7');
check($x->values['Motion_' . $id] === false, 'Ende der Bewegung: Variable aus');
$x->ws(['t' => 'motion', 'on' => true], 5007, 'k7');
$x->clock += VisuExtCore::SESSION_SECONDS + 1;
$x->RequestAction('Sweep', 0);
check($x->values['Motion_' . $id] === false, 'Gerät verliert die Verbindung: Variable aus');
$x->SetMotion($id, false, 2, 30);
check(!isset($x->variables['Motion_' . $id]) && $x->devs()[$id]['motion'] === ['on' => false, 'level' => 2, 'hold' => 30], 'Bewegungsmelder aus: Variable entfernt');

// ── Neustart: Puffer leer, Attribute bleiben ──
$x->buffers = [];
$x->Create();
$x->ApplyChanges();
check(count($x->devs()) === 1 && $x->ws(['t' => 'beat'], 5001) === [['t' => 'unknown']]
    && $x->ws(['t' => 'hello', 'd' => $id, 'c' => $kanal], 5001)[0]['t'] === 'welcome', 'Nach einem Neustart: Geräte bleiben, Sitzungen melden sich neu an');

// ── Kernelstart ──
$GLOBALS['runlevel'] = KR_INIT;
$y = new TestExt(19000);
$y->Create();
$y->ApplyChanges();
check($y->hooks === [] && $y->messages[0] === [IPS_KERNELSTARTED], 'Vor dem Kernelstart: nichts anmelden, auf den Start warten');
unset($GLOBALS['modules'][19000]);
$GLOBALS['runlevel'] = KR_READY;

// ── Dateien ──
$lib = json_decode((string) file_get_contents(__DIR__ . '/../../library.json'), true);
$mod = json_decode((string) file_get_contents(__DIR__ . '/../../VisuExtension/module.json'), true);
check($lib['version'] === VisuExtension::VERSION && $mod['prefix'] === 'VISUEXT' && str_replace(' ', '', $mod['name']) === 'VisuExtension' && $mod['vendor'] === '' && $mod['aliases'] === []
    && $mod['implemented'] === [VisuExtCore::DOCK_TX] && $mod['childRequirements'] === [VisuExtCore::DOCK_RX], 'module.json und library.json passen zum Code');
$locale = json_decode((string) file_get_contents(__DIR__ . '/../../VisuExtension/locale.json'), true)['translations'];
$quelle = file_get_contents(__DIR__ . '/../../VisuExtension/module.php') . file_get_contents(__DIR__ . '/../../libs/VisuExtDevices.php') . file_get_contents(__DIR__ . '/../../libs/VisuExtMotion.php');
preg_match_all('/\'(?:ok|blocked|denied|nocam|error)\' => \'([^\']+)\'/', (string) file_get_contents(__DIR__ . '/../../libs/VisuExtMotion.php'), $kam);
preg_match_all('/(?:Translate\(|\'caption\'\s*=>\s*)\'((?:[^\'\\\\]|\\\\.)+)\'/', $quelle, $m);
preg_match_all('/Translate\(\$\w+\[\'blocked\'\] \? \'(\w+)\' : \(\$\w+\[\'online\'\] \? \'(\w+)\' : \'(\w+)\'\)\)/', $quelle, $z);
$texte = array_unique(array_merge(array_map('stripslashes', $m[1]), $z[1], $z[2], $z[3], $kam[1], ['Offline', 'Online', 'Visu Extension', 'No motion', 'Motion']));
$fehlend = array_values(array_diff($texte, array_keys($locale['de'])));
check($fehlend === [] && array_keys($locale['de']) === array_keys($locale['en']), 'Jeder Text hat eine Übersetzung, de und en mit denselben Schlüsseln' . ($fehlend ? ': ' . implode(' | ', $fehlend) : ''));

echo PHP_EOL . 'Alle Prüfungen bestanden.' . PHP_EOL;
