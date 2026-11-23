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
    public static function ticket(string $deviceId, string $deviceKey, int $module, int $expires, string $kind = 'script'): string
    {
        return substr(hash_hmac('sha256', $kind . '|' . $deviceId . '|' . $module . '|' . $expires, $deviceKey), 0, 32);
    }

    /** $kind trennt Skripte ('script', $module = Instanz) von Bildern ('media', $module = Medienobjekt). */
    public static function ticketValid(string $deviceId, string $deviceKey, int $module, int $expires, string $given, int $now, string $kind = 'script'): bool
    {
        return $expires >= $now && $expires <= $now + self::TICKET_SECONDS
            && hash_equals(self::ticket($deviceId, $deviceKey, $module, $expires, $kind), $given);
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

    /** Inhalte des Bildschirmschoners: schwarz, Uhr mit Datum, Kunstwerke oder eigene Bilder im Wechsel. */
    public const SAVER_MODES = ['black', 'clock', 'art', 'media'];
    /** Eigene Bilder: größere Medienobjekte bleiben außen vor (sie laufen ganz durch den Speicher von PHP). */
    public const MAX_IMAGE_BYTES = 15728640;
    public const MAX_IMAGES = 2000;

    /**
     * Bildschirmschoner eines Geräts: Minuten ohne Bedienung (0 = aus, höchstens ein Tag), Inhalt, und
     * für Bilder der Bildwechsel in Minuten (1–60), ob das Bild den Bildschirm füllt (beschnitten) und
     * die Kategorie mit den eigenen Bildern (0 = keine).
     * @return array{minutes:int,mode:string,interval:int,fill:bool,category:int}
     */
    public static function cleanSaver(mixed $minutes, mixed $mode, mixed $interval = 5, mixed $fill = false, mixed $category = 0): array
    {
        return ['minutes' => max(0, min(1440, is_numeric($minutes) ? (int) $minutes : 0)),
            'mode' => in_array($mode, self::SAVER_MODES, true) ? $mode : self::SAVER_MODES[0],
            'interval' => max(1, min(60, is_numeric($interval) ? (int) $interval : 5)),
            'fill' => $fill === true,
            'category' => is_int($category) && $category > 0 ? $category : 0];
    }

    /**
     * Bewegungsmelder eines Geräts: an/aus, Empfindlichkeit (1 = gering, 2 = mittel, 3 = hoch) und
     * Rückstellzeit in Sekunden (so lange nach der letzten Bewegung gilt sie noch; 5 bis 3600).
     * @return array{on:bool,level:int,hold:int}
     */
    public static function cleanMotion(mixed $on, mixed $level, mixed $hold = 30): array
    {
        return ['on' => $on === true, 'level' => in_array($level, [1, 2, 3], true) ? $level : 2,
            'hold' => max(5, min(3600, is_numeric($hold) ? (int) $hold : 30))];
    }

    /** Dasselbe aus dem gespeicherten Eintrag eines Geräts. */
    public static function motionOf(mixed $motion): array
    {
        $motion = is_array($motion) ? $motion : [];
        return self::cleanMotion($motion['on'] ?? false, $motion['level'] ?? 2, $motion['hold'] ?? 30);
    }

    /** Zustand der Kamera, wie ihn die Laufzeit meldet; Unbekanntes wird „error“. */
    public static function cleanCamState(mixed $state): string
    {
        return in_array($state, ['ok', 'blocked', 'denied', 'nocam', 'error'], true) ? $state : 'error';
    }

    /** Dasselbe aus dem gespeicherten Eintrag eines Geräts. */
    public static function saverOf(mixed $saver): array
    {
        $saver = is_array($saver) ? $saver : [];
        return self::cleanSaver($saver['minutes'] ?? 0, $saver['mode'] ?? '', $saver['interval'] ?? 5, $saver['fill'] ?? false, $saver['category'] ?? 0);
    }

    /**
     * Zufällig das nächste eigene Bild: eines, das das Gerät in dieser Runde noch nicht gezeigt hat
     * ($seen, zuletzt gezeigtes am Ende). Sind alle durch, beginnt eine neue Runde, nicht mit dem letzten.
     * @param list<int> $ids
     * @return array{0:int,1:bool} Medienobjekt (0 = keines) und ob eine neue Runde beginnt
     */
    public static function pickImage(array $ids, mixed $seen): array
    {
        $seen = array_values(array_filter(array_slice(is_array($seen) ? $seen : [], -self::MAX_IMAGES), 'is_int'));
        $fresh = array_values(array_diff($ids, $seen));
        $reset = false;
        if ($fresh === []) {
            $reset = $seen !== [];
            $fresh = array_values(count($ids) > 1 && $seen !== [] ? array_diff($ids, [end($seen)]) : $ids);
        }
        return $fresh === [] ? [0, false] : [$fresh[random_int(0, count($fresh) - 1)], $reset];
    }

    /** Bildart nach den ersten Bytes; '' = kein Bild, das ein Browser als <img> zeigt (SVG bewusst nicht). */
    public static function imageType(string $head): string
    {
        return match (true) {
            str_starts_with($head, "\xFF\xD8\xFF") => 'image/jpeg',
            str_starts_with($head, "\x89PNG\r\n\x1A\n") => 'image/png',
            str_starts_with($head, 'GIF87a'), str_starts_with($head, 'GIF89a') => 'image/gif',
            str_starts_with($head, 'RIFF') && substr($head, 8, 4) === 'WEBP' => 'image/webp',
            default => '',
        };
    }

    /**
     * Kunstwerke für den Bildschirmschoner (libs/artworks.json): gemeinfreie Gemälde mit Titel,
     * Künstler, Jahr und Dateiname bei Wikimedia Commons. Unbrauchbare Einträge fallen weg.
     * @return list<array{title:string,artist:string,year:string,file:string}>
     */
    public static function artworks(mixed $data): array
    {
        $list = [];
        foreach (is_array($data) ? $data : [] as $entry) {
            if (is_array($entry) && is_string($entry['file'] ?? null) && preg_match('/^[^\/\\?#\x00-\x1F]{1,200}\.jpe?g$/iu', $entry['file'])) {
                $list[] = ['title' => self::cleanPage($entry['title'] ?? ''), 'artist' => self::cleanPage($entry['artist'] ?? ''),
                    'year' => self::cleanPage($entry['year'] ?? ''), 'file' => $entry['file']];
            }
        }
        return $list;
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
