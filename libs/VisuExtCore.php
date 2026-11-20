<?php

declare(strict_types=1);

/**
 * Reine Bausteine der Visu-Erweiterung, ohne Symcon: Kennungen, Schlüssel, Tickets und die Regeln
 * für Namen und Nachrichten. Geteilt von Modul und Tests.
 */
final class VisuExtCore
{
    /** Fassung des Vertrags zwischen Browser-Erweiterung und Modul. */
    public const CONTRACT = 2;
    /** Datenfluss: angedocktes Modul → Visu-Erweiterung (SendDataToParent / ForwardData). */
    public const DOCK_TX = '{A5B87602-1C34-4981-89A5-62A0735CB359}';
    /** Datenfluss: Visu-Erweiterung → angedockte Module (SendDataToChildren / ReceiveData). */
    public const DOCK_RX = '{9E7FA1CF-55F3-418B-8C92-FF4BAAC93EFA}';

    public const PAIRING_SECONDS = 600;
    public const PAIRING_TRIES = 5;
    /** So lange gilt die Adresse eines Skripts aus der Beschreibung. */
    public const TICKET_SECONDS = 120;
    /** Lebenszeichen des Geräts; ohne eines gilt es nach SESSION_SECONDS als getrennt. */
    public const BEAT_SECONDS = 30;
    public const SESSION_SECONDS = 90;
    public const MAX_DEVICES = 50;
    public const MAX_FRAME = 65536;
    public const MAX_NAME = 40;

    public static function deviceId(): string
    {
        return bin2hex(random_bytes(4));
    }

    public static function deviceKey(): string
    {
        return bin2hex(random_bytes(24));
    }

    /** Sechs Ziffern, auch mit führenden Nullen. */
    public static function pairingCode(): string
    {
        return str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    }

    /** Eingabe eines Codes: Leerzeichen und Trennstriche zählen nicht. */
    public static function normalizeCode(mixed $value): string
    {
        return is_string($value) || is_int($value) ? (string) preg_replace('/[\s-]+/', '', (string) $value) : '';
    }

    /** Name eines Geräts: einzeilig, ohne Steuerzeichen, höchstens MAX_NAME Zeichen. */
    public static function cleanName(mixed $value, string $fallback): string
    {
        $text = is_string($value) ? (string) preg_replace('/[\x00-\x1F\x7F]+/u', ' ', $value) : '';
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));
        $text = mb_substr($text, 0, self::MAX_NAME);
        return $text !== '' ? $text : $fallback;
    }

    /**
     * Anmeldung am WebSocket. Abgeleitet, damit der Geräteschlüssel selbst nie im Fenster der
     * Visualisierung steht: dort liegt nur dieser Wert, und er öffnet nur den Kanal.
     */
    public static function channelToken(string $deviceId, string $deviceKey): string
    {
        return hash_hmac('sha256', 'channel|' . $deviceId, $deviceKey);
    }

    /**
     * Unterschrift einer Skript-Adresse. Die Adresse steht im Zugriffsprotokoll von Symcon, deshalb
     * trägt sie keinen Schlüssel, sondern diese Unterschrift mit Ablaufzeit.
     */
    public static function ticket(string $deviceId, string $deviceKey, int $module, int $expires): string
    {
        return substr(hash_hmac('sha256', 'script|' . $deviceId . '|' . $module . '|' . $expires, $deviceKey), 0, 32);
    }

    public static function ticketValid(string $deviceId, string $deviceKey, int $module, int $expires, string $given, int $now): bool
    {
        return $expires >= $now && $expires <= $now + self::TICKET_SECONDS
            && hash_equals(self::ticket($deviceId, $deviceKey, $module, $expires), $given);
    }

    /** Seite der Visualisierung, wie das Gerät sie meldet: nur Pfad und Anker, gekürzt. */
    public static function cleanPage(mixed $value): string
    {
        if (!is_string($value)) {
            return '';
        }
        $text = (string) preg_replace('/[\x00-\x1F\x7F]+/u', '', $value);
        return mb_substr($text, 0, 200);
    }

    /**
     * Rücksprung zur Startseite eines Geräts: Minuten ohne Bedienung (0 = aus, höchstens ein Tag) und
     * die Startseite als Pfad auf dem Server der Visualisierung ('' = die Seite, mit der sie geladen wurde).
     * @return array{minutes:int,page:string}
     */
    public static function cleanHome(mixed $minutes, mixed $page): array
    {
        $page = trim(self::cleanPage($page));
        // nur ein Pfad dieses Servers: kein Schema, kein „//rechner“, kein Rückstrich
        if ($page === '' || $page[0] !== '/' || str_starts_with($page, '//') || str_contains($page, '\\')) {
            $page = '';
        }
        return ['minutes' => max(0, min(1440, is_numeric($minutes) ? (int) $minutes : 0)), 'page' => $page];
    }

    /** Inhalte des Bildschirmschoners: schwarz oder Uhr mit Datum. */
    public const SAVER_MODES = ['black', 'clock'];

    /**
     * Bildschirmschoner eines Geräts: Minuten ohne Bedienung (0 = aus, höchstens ein Tag) und Inhalt.
     * @return array{minutes:int,mode:string}
     */
    public static function cleanSaver(mixed $minutes, mixed $mode): array
    {
        return ['minutes' => max(0, min(1440, is_numeric($minutes) ? (int) $minutes : 0)),
            'mode' => in_array($mode, self::SAVER_MODES, true) ? $mode : self::SAVER_MODES[0]];
    }

    /**
     * Antwort eines angedockten Moduls auf „Describe“ prüfen.
     * @return array{instance:int,name:string,version:string,active:bool,info:string}|null
     */
    public static function checkModule(mixed $data): ?array
    {
        if (!is_array($data) || !isset($data['instance']) || !is_int($data['instance']) || $data['instance'] <= 0) {
            return null;
        }
        return [
            'instance' => $data['instance'],
            'name'     => self::cleanName($data['name'] ?? '', '#' . $data['instance']),
            'version'  => is_string($data['version'] ?? null) || is_int($data['version'] ?? null) ? mb_substr((string) $data['version'], 0, 20) : '',
            'active'   => ($data['active'] ?? true) === true,
            'info'     => is_string($data['info'] ?? null) ? mb_substr($data['info'], 0, 200) : '',
        ];
    }
}
