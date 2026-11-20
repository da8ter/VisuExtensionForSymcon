<?php

declare(strict_types=1);

// SDK-Attrappe für das Modul „Visu-Erweiterung“. Verbindet sich nie mit einem laufenden Symcon.
// Signaturen wie IPSModuleStrict: unter strict_types fällt jeder lockere Aufruf als TypeError auf.
const KR_INIT = 10102, KR_READY = 10103, IPS_KERNELSTARTED = 10001, KL_WARNING = 10204, KL_ERROR = 10205,
    IS_ACTIVE = 102, VARIABLETYPE_BOOLEAN = 0, VARIABLETYPE_INTEGER = 1, VARIABLETYPE_STRING = 3,
    VARIABLE_PRESENTATION_VALUE_PRESENTATION = '{3319437D-7CDE-699D-750A-3C6A3841FA75}';

class IPSModuleStrict
{
    public int $InstanceID;
    public array $properties = [], $attributes = [], $buffers = [], $messages = [], $timers = [];
    public array $logs = [], $variables = [], $values = [], $hooks = [], $formFields = [];
    public int $status = 0, $parent = 0;
    public string $filter = '';

    public function __construct(int $InstanceID)
    {
        $this->InstanceID = $InstanceID;
        $GLOBALS['modules'][$InstanceID] = $this;
    }

    public function Create(): void {}
    public function ApplyChanges(): void {}
    public function Destroy(): void {}
    public function MessageSink(int $TimeStamp, int $SenderID, int $Message, array $Data): void {}
    public function GetConfigurationForm(): string { return ''; }
    public function RequestAction(string $Ident, mixed $Value): void {}
    public function ReceiveData(string $JSONString): string { return ''; }
    public function ForwardData(string $JSONString): string { return ''; }

    protected function RegisterPropertyBoolean(string $Name, bool $DefaultValue): bool { $this->properties[$Name] ??= $DefaultValue; return true; }
    protected function ReadPropertyBoolean(string $Name): bool { return $this->read('properties', $Name); }
    protected function RegisterAttributeString(string $Name, string $DefaultValue): bool { $this->attributes[$Name] ??= $DefaultValue; return true; }
    protected function ReadAttributeString(string $Name): string { return $this->read('attributes', $Name); }
    protected function WriteAttributeString(string $Name, string $Value): void { $this->read('attributes', $Name); $this->attributes[$Name] = $Value; }
    protected function SetBuffer(string $Name, string $Data): void { $this->buffers[$Name] = $Data; }
    protected function GetBuffer(string $Name): string { return $this->buffers[$Name] ?? ''; }
    protected function RegisterTimer(string $Ident, int $Milliseconds, string $ScriptText): bool { $this->timers[$Ident] = $Milliseconds; return true; }
    protected function SetTimerInterval(string $Ident, int $Milliseconds): bool { $this->read('timers', $Ident); $this->timers[$Ident] = $Milliseconds; return true; }
    protected function RegisterMessage(int $SenderID, int $Message): bool { $this->messages[$SenderID][] = $Message; return true; }
    protected function SetStatus(int $Status): bool { $this->status = $Status; return true; }
    protected function RegisterHook(string $HookPath): bool { $this->hooks[$HookPath] = true; return true; }
    protected function ProcessHookData(): void {}
    protected function UpdateFormField(string $Field, string $Parameter, mixed $Value): bool { $this->formFields[$Field][$Parameter] = $Value; return true; }
    protected function LogMessage(string $Message, int $Type): bool { $this->logs[] = $Message; return true; }
    protected function SendDebug(string $Message, string $Data, int $Format): bool { return true; }
    protected function Translate(string $Text): string { return $Text; }
    protected function HasActiveParent(): bool { return $this->parent > 0; }
    protected function SetReceiveDataFilter(string $RequiredRegexMatch): bool { $this->filter = $RequiredRegexMatch; return true; }
    protected function RegisterVariableInteger(string $Ident, string $Name, string|array $Profile = '', int $Position = 0): bool { return $this->variable($Ident, VARIABLETYPE_INTEGER, $Name, $Profile, 0); }
    protected function MaintainVariable(string $Ident, string $Name, int $Type, string|array $Profile, int $Position, bool $Keep): bool
    {
        if ($Keep) {
            return $this->variable($Ident, $Type, $Name, $Profile, $Type === VARIABLETYPE_BOOLEAN ? false : 0);
        }
        unset($this->variables[$Ident], $this->values[$Ident]);
        return true;
    }
    protected function UnregisterVariable(string $Ident): bool { unset($this->variables[$Ident], $this->values[$Ident]); return true; }
    protected function GetValue(string $Ident): mixed { $this->read('variables', $Ident); return $this->values[$Ident]; }
    protected function SetValue(string $Ident, mixed $Value): bool { $this->read('variables', $Ident); $this->values[$Ident] = $Value; return true; }

    /** Wie Symcon (Doku): liefert die Rückgaben von ReceiveData der verbundenen Kinder, deren Filter passt. */
    protected function SendDataToChildren(string $Data): array
    {
        $answers = [];
        foreach ($GLOBALS['modules'] as $module) {
            if ($module->parent === $this->InstanceID && ($module->filter === '' || preg_match('/' . $module->filter . '/', $Data) === 1)) {
                $answers[] = $module->ReceiveData($Data);
            }
        }
        return $answers;
    }

    protected function SendDataToParent(string $Data): string
    {
        return isset($GLOBALS['modules'][$this->parent]) ? $GLOBALS['modules'][$this->parent]->ForwardData($Data) : '';
    }

    private function variable(string $Ident, int $Type, string $Name, string|array $Presentation, mixed $Default): bool
    {
        if (!is_array($Presentation)) {
            throw new RuntimeException('Variable ' . $Ident . ' without presentation');
        }
        $this->variables[$Ident] = ['type' => $Type, 'name' => $Name, 'presentation' => $Presentation];
        $this->values[$Ident] ??= $Default;
        return true;
    }

    private function read(string $store, string $name): mixed
    {
        if (!array_key_exists($name, $this->{$store})) {
            throw new RuntimeException('Not registered (' . $store . '): ' . $name);
        }
        return $this->{$store}[$name];
    }
}

// Kernel-Zustand der Attrappe
$runlevel = KR_READY;
$modules = [];
$pushes = [];      // [Pfad, Text, Adresse, Port] je WC_PushMessageEx
$semaphores = [];

const WEBHOOK_CONTROL_ID = 11111;

function IPS_GetKernelRunlevel(): int { return $GLOBALS['runlevel']; }
function IPS_GetName(int $ID): string { return 'Visu-Erweiterung'; }
function IPS_GetOption(string $Option): mixed { return false; }
function IPS_GetInstance(int $InstanceID): array|false
{
    return isset($GLOBALS['modules'][$InstanceID]) ? ['ConnectionID' => $GLOBALS['modules'][$InstanceID]->parent] : false;
}
function IPS_GetInstanceListByModuleID(string $ModuleID): array
{
    if ($ModuleID === '{015A6EB8-D6E5-4B93-B496-0D3F77AE9FE1}') {
        return [WEBHOOK_CONTROL_ID];
    }
    $ids = [];
    foreach ($GLOBALS['modules'] as $id => $module) {
        if ($module instanceof VisuExtension) {
            $ids[] = $id;
        }
    }
    return $ids;
}
// Ohne Wiedereintritt wie in Symcon: wer eine gehaltene Sperre erneut nimmt, scheitert.
function IPS_SemaphoreEnter(string $Name, int $Milliseconds): bool
{
    if (isset($GLOBALS['semaphores'][$Name])) {
        throw new RuntimeException('Semaphore nested: ' . $Name);
    }
    $GLOBALS['semaphores'][$Name] = true;
    return true;
}
function IPS_SemaphoreLeave(string $Name): bool { unset($GLOBALS['semaphores'][$Name]); return true; }
function WC_PushMessageEx(int $InstanceID, string $Hook, string $Data, string $Address, int $Port): bool
{
    if ($InstanceID !== WEBHOOK_CONTROL_ID) {
        throw new RuntimeException('WC_PushMessageEx: wrong control instance');
    }
    $GLOBALS['pushes'][] = [$Hook, json_decode($Data, true, 512, JSON_THROW_ON_ERROR), $Address, $Port];
    return true;
}

function check(bool $condition, string $label): void
{
    if (!$condition) {
        throw new RuntimeException('FAIL: ' . $label);
    }
    echo 'PASS: ' . $label . PHP_EOL;
}

// Jede Warnung bricht ab, außer sie ist im Modul ausdrücklich mit @ unterdrückt.
set_error_handler(static function (int $severity, string $message, string $file, int $line): bool {
    if ((error_reporting() & $severity) === 0) {
        return false;
    }
    throw new ErrorException($message, 0, $severity, $file, $line);
});

require __DIR__ . '/../../VisuExtension/module.php';
