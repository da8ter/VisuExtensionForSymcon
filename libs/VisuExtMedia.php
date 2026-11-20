<?php

declare(strict_types=1);

/**
 * Eigene Bilder für den Bildschirmschoner: Bild-Medienobjekte aus einer Kategorie, die der Nutzer je
 * Gerät wählt. Das Gerät fragt über den Kanal nach dem nächsten Bild ({t:"pic", seen}); das Modul
 * wählt zufällig und antwortet mit einer Adresse am Hook, die wie eine Skript-Adresse unterschrieben
 * ist und kurz gilt. Ausgeliefert wird in Stücken (&o=<Versatz>), weil Symcon die Ausgabe eines
 * Hooks begrenzt (Spezialschalter ScriptOutputBufferLimit, Vorgabe 1 MB) und Fotos größer sind.
 * Ein Gerät bekommt nur Bilder aus seiner eigenen Kategorie.
 *
 * Braucht vom Modul: devices(), now(), param(), status(), head(), outputLimit(), HOOK.
 */
trait VisuExtMedia
{
    /**
     * Bild-Medienobjekte unter einer Kategorie, auch in Unterkategorien und über Verknüpfungen.
     * @return list<int>
     */
    private function images(int $category): array
    {
        if ($category <= 0 || !@IPS_CategoryExists($category)) {
            return [];
        }
        $found = [];
        $queue = [[$category, 0]];
        while ($queue !== [] && count($found) < VisuExtCore::MAX_IMAGES) {
            [$parent, $depth] = array_shift($queue);
            foreach (IPS_GetChildrenIDs($parent) as $child) {
                $type = IPS_GetObject($child)['ObjectType'];
                if ($type === OBJECTTYPE_LINK) {
                    $child = (int) IPS_GetLink($child)['TargetID'];
                    $type = @IPS_MediaExists($child) ? OBJECTTYPE_MEDIA : -1;
                }
                if ($type === OBJECTTYPE_CATEGORY && $depth < 5) {
                    $queue[] = [$child, $depth + 1];
                } elseif ($type === OBJECTTYPE_MEDIA) {
                    $media = IPS_GetMedia($child);
                    if ($media['MediaType'] === MEDIATYPE_IMAGE && $media['MediaIsAvailable']
                        && $media['MediaSize'] > 0 && $media['MediaSize'] <= VisuExtCore::MAX_IMAGE_BYTES) {
                        $found[$child] = true;
                    }
                }
            }
        }
        return array_slice(array_keys($found), 0, VisuExtCore::MAX_IMAGES);
    }

    /** Antwort auf {t:"pic"}: das nächste Bild dieses Geräts, ohne „u“, wenn es keines gibt. */
    private function picture(string $id, array $device, mixed $seen): array
    {
        [$media, $reset] = VisuExtCore::pickImage($this->images(VisuExtCore::saverOf($device['saver'] ?? null)['category']), $seen);
        if ($media === 0) {
            return ['t' => 'pic'];
        }
        $expires = $this->now() + VisuExtCore::TICKET_SECONDS;
        return ['t' => 'pic', 'i' => $media, 'reset' => $reset, 'u' => '/hook/' . self::HOOK . '?k=media&d=' . $id . '&i=' . $media . '&e=' . $expires
            . '&s=' . VisuExtCore::ticket($id, (string) $device['secret'], $media, $expires, 'media')];
    }

    /** GET ?k=media&d=&i=&e=&s=&o=: ein Stück des Bildes ab dem Versatz o; X-Visu-Size nennt die ganze Größe. */
    private function serveMedia(): void
    {
        $id = $this->param('d');
        $media = ctype_digit($this->param('i')) ? (int) $this->param('i') : 0;
        $offset = ctype_digit($this->param('o')) ? (int) $this->param('o') : 0;
        $device = $this->devices()[$id] ?? null;
        if (!is_array($device) || !empty($device['blocked']) || $media <= 0
            || !VisuExtCore::ticketValid($id, (string) $device['secret'], $media, (int) $this->param('e'), $this->param('s'), $this->now(), 'media')) {
            $this->status(403);
            return;
        }
        // Die Unterschrift allein reicht nicht: Die Kategorie kann sich seither geändert haben.
        if (!in_array($media, $this->images(VisuExtCore::saverOf($device['saver'] ?? null)['category']), true)) {
            $this->status(404);
            return;
        }
        $content = (string) base64_decode((string) @IPS_GetMediaContent($media), true);
        $type = VisuExtCore::imageType(substr($content, 0, 16));
        if ($type === '' || $offset >= strlen($content)) {
            $this->status(404);
            return;
        }
        $this->head('Content-Type: ' . $type);
        $this->head('X-Visu-Size: ' . strlen($content));
        echo substr($content, $offset, min($this->outputLimit(), 786432));
    }
}
