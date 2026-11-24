# Ilha Dinâmica — ajudante de mídia
# Lê a música/vídeo tocando no Windows (Spotify, YouTube no navegador, etc.)
# e recebe comandos pela entrada padrão:
#   mídia:   toggle | next | prev | volup | voldown | mute
#   sistema: vol <0-100> | mudo on|off|toggle | brilho <0-100> | wifi on|off|toggle | bt on|off|toggle | estado
# Saída: uma linha JSON sempre que algo muda.

$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class TeclasIlha {
    [DllImport("user32.dll")]
    public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public static void Apertar(byte vk) {
        keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 2, UIntPtr.Zero);
    }
}
"@

# Lê os comandos do app numa thread separada (Console.In.ReadLineAsync trava no Windows PowerShell)
Add-Type -TypeDefinition @'
using System;
using System.Threading;
using System.Collections.Concurrent;
public static class EntradaIlha {
    static readonly ConcurrentQueue<string> fila = new ConcurrentQueue<string>();
    static volatile bool acabou = false;
    public static void Iniciar() {
        var t = new Thread(() => {
            try { string l; while ((l = Console.In.ReadLine()) != null) fila.Enqueue(l); } catch { }
            acabou = true;
        });
        t.IsBackground = true;
        t.Start();
    }
    public static string Proxima() { string l; return fila.TryDequeue(out l) ? l : null; }
    public static bool Acabou { get { return acabou && fila.IsEmpty; } }
}
'@
[EntradaIlha]::Iniciar()

# Converte operações assíncronas do WinRT em chamadas que esperam o resultado
$asTaskGenerico = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]

function Aguardar($operacao, [Type]$tipo) {
    $tarefa = $asTaskGenerico.MakeGenericMethod($tipo).Invoke($null, @($operacao))
    $null = $tarefa.Wait(5000)
    return $tarefa.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IContentTypeProvider, Windows.Storage.Streams, ContentType = WindowsRuntime]

$gerente = Aguardar ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) `
    ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

# ---------------------------------------------------------------------------
# Controles do sistema: volume exato (Core Audio) e brilho por DDC/CI (monitores externos)
# ---------------------------------------------------------------------------
try {
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolumeIlha {
    int _RegisterControlChangeNotify(); int _UnregisterControlChangeNotify(); int _GetChannelCount();
    int _SetMasterVolumeLevel();
    int SetMasterVolumeLevelScalar(float fLevel, ref Guid ctx);
    int _GetMasterVolumeLevel();
    int GetMasterVolumeLevelScalar(out float pfLevel);
    int _SetChannelVolumeLevel(); int _SetChannelVolumeLevelScalar(); int _GetChannelVolumeLevel(); int _GetChannelVolumeLevelScalar();
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);
}
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceIlha {
    int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
    int OpenPropertyStore(int access, out IPropertyStoreIlha store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[StructLayout(LayoutKind.Sequential)] public struct PropKeyIlha { public Guid fmtid; public int pid; }
[StructLayout(LayoutKind.Sequential)] public struct PropVariantIlha { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public IntPtr p2; }
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStoreIlha {
    int GetCount(out int n);
    int GetAt(int i, out PropKeyIlha key);
    int GetValue(ref PropKeyIlha key, out PropVariantIlha pv);
}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumeratorIlha {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollectionIlha devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDeviceIlha endpoint);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorIlha { }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollectionIlha {
    int GetCount(out int n);
    int Item(int i, out IMMDeviceIlha dev);
}
// Interface (não documentada, a mesma que o Windows usa) para trocar o dispositivo padrão
[ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPolicyConfigIlha {
    int _GetMixFormat(); int _GetDeviceFormat(); int _ResetDeviceFormat(); int _SetDeviceFormat();
    int _GetProcessingPeriod(); int _SetProcessingPeriod(); int _GetShareMode(); int _SetShareMode();
    int _GetPropertyValue(); int _SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
}
[ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigIlha { }

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformationIlha { int GetPeakValue(out float peak); }

public static class AudioIlha {
    static IAudioMeterInformationIlha medidor;
    static DateTime medidorDesde = DateTime.MinValue;
    // Nível do som que está tocando agora (0 a 1). Refaz o medidor a cada 5 s (troca de fone/caixa).
    public static float Pico() {
        try {
            if (medidor == null || (DateTime.Now - medidorDesde).TotalSeconds > 5) {
                var en = (IMMDeviceEnumeratorIlha)(new MMDeviceEnumeratorIlha());
                IMMDeviceIlha dev;
                Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev));
                Guid iid = typeof(IAudioMeterInformationIlha).GUID;
                object o;
                Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
                medidor = (IAudioMeterInformationIlha)o;
                medidorDesde = DateTime.Now;
            }
            float p;
            Marshal.ThrowExceptionForHR(medidor.GetPeakValue(out p));
            return p;
        } catch { medidor = null; return 0; }
    }
    static IAudioEndpointVolumeIlha Ponto() {
        var en = (IMMDeviceEnumeratorIlha)(new MMDeviceEnumeratorIlha());
        IMMDeviceIlha dev;
        Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(0, 1, out dev)); // eRender, eMultimedia
        Guid iid = typeof(IAudioEndpointVolumeIlha).GUID;
        object o;
        Marshal.ThrowExceptionForHR(dev.Activate(ref iid, 23, IntPtr.Zero, out o));
        return (IAudioEndpointVolumeIlha)o;
    }
    public static int Volume() { float v; Marshal.ThrowExceptionForHR(Ponto().GetMasterVolumeLevelScalar(out v)); return (int)Math.Round(v * 100); }
    public static void DefinirVolume(int pct) {
        Guid g = Guid.Empty;
        var p = Ponto();
        Marshal.ThrowExceptionForHR(p.SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g));
        if (pct > 0) p.SetMute(false, ref g);
    }
    // Nome do dispositivo de saída padrão (ex.: "Fones de ouvido (JBL Tune 510BT)")
    public static string NomeSaida() {
        try {
            var en = (IMMDeviceEnumeratorIlha)(new MMDeviceEnumeratorIlha());
            IMMDeviceIlha dev;
            if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return "";
            IPropertyStoreIlha ps;
            if (dev.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
            var chave = new PropKeyIlha();
            chave.fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0"); // PKEY_Device_FriendlyName
            chave.pid = 14;
            PropVariantIlha v;
            if (ps.GetValue(ref chave, out v) != 0) return "";
            return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
        } catch { return ""; }
    }
    static string NomeDe(IMMDeviceIlha dev) {
        try {
            IPropertyStoreIlha ps;
            if (dev.OpenPropertyStore(0, out ps) != 0 || ps == null) return "";
            var chave = new PropKeyIlha();
            chave.fmtid = new Guid("A45C254E-DF1C-4EFD-8020-67D146A850E0");
            chave.pid = 14;
            PropVariantIlha v;
            if (ps.GetValue(ref chave, out v) != 0) return "";
            return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "";
        } catch { return ""; }
    }
    // Dispositivos ativos: fluxo 0 = saída (caixas/fones), 1 = entrada (microfones). Linhas "padrao<TAB>id<TAB>nome"
    public static string[] Listar(int fluxo) {
        var lista = new System.Collections.Generic.List<string>();
        try {
            var en = (IMMDeviceEnumeratorIlha)(new MMDeviceEnumeratorIlha());
            string padrao = "";
            IMMDeviceIlha def;
            if (en.GetDefaultAudioEndpoint(fluxo, 1, out def) == 0 && def != null) def.GetId(out padrao);
            IMMDeviceCollectionIlha col;
            Marshal.ThrowExceptionForHR(en.EnumAudioEndpoints(fluxo, 1, out col)); // DEVICE_STATE_ACTIVE
            int n; col.GetCount(out n);
            for (int i = 0; i < n; i++) {
                IMMDeviceIlha d; if (col.Item(i, out d) != 0 || d == null) continue;
                string id; d.GetId(out id);
                lista.Add((id == padrao ? "1" : "0") + "\t" + id + "\t" + NomeDe(d));
            }
        } catch { }
        return lista.ToArray();
    }
    public static void DefinirPadrao(string id) {
        var pc = (IPolicyConfigIlha)(new PolicyConfigIlha());
        for (int papel = 0; papel < 3; papel++) Marshal.ThrowExceptionForHR(pc.SetDefaultEndpoint(id, papel)); // console, multimídia, comunicação
    }
    public static bool Mudo() { bool m; Marshal.ThrowExceptionForHR(Ponto().GetMute(out m)); return m; }
    public static void DefinirMudo(bool m) { Guid g = Guid.Empty; Marshal.ThrowExceptionForHR(Ponto().SetMute(m, ref g)); }
}

public static class BrilhoIlha {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct PHYSICAL_MONITOR { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string d; }
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    delegate bool MonitorEnumProc(IntPtr hMon, IntPtr hdc, ref RECT rc, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonitorEnumProc cb, IntPtr data);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr hMon, ref MONITORINFO mi);
    [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr hMon, out uint n);
    [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr hMon, uint n, [Out] PHYSICAL_MONITOR[] arr);
    [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYSICAL_MONITOR[] arr);
    [DllImport("dxva2.dll")] static extern bool GetMonitorBrightness(IntPtr h, out uint min, out uint cur, out uint max);
    [DllImport("dxva2.dll")] static extern bool SetMonitorBrightness(IntPtr h, uint v);

    class Tela { public IntPtr h; public bool principal; public int esquerda; }

    // Telas em ordem: a principal primeiro, depois da esquerda para a direita
    static List<Tela> Telas() {
        var lista = new List<Tela>();
        MonitorEnumProc cb = (IntPtr m, IntPtr d, ref RECT r, IntPtr p) => {
            var mi = new MONITORINFO(); mi.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            GetMonitorInfo(m, ref mi);
            var t = new Tela(); t.h = m; t.principal = (mi.dwFlags & 1) != 0; t.esquerda = mi.rcMonitor.l;
            lista.Add(t);
            return true;
        };
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, cb, IntPtr.Zero);
        GC.KeepAlive(cb);
        lista.Sort((a, b) => a.principal != b.principal ? (a.principal ? -1 : 1) : a.esquerda.CompareTo(b.esquerda));
        return lista;
    }

    // "tela.fisico|principal(0/1)|brilho;..."  só monitores que aceitam DDC/CI
    public static string Listar() {
        var sb = new System.Text.StringBuilder();
        var telas = Telas();
        for (int i = 0; i < telas.Count; i++) {
            uint n;
            if (!GetNumberOfPhysicalMonitorsFromHMONITOR(telas[i].h, out n) || n == 0) continue;
            var arr = new PHYSICAL_MONITOR[n];
            if (!GetPhysicalMonitorsFromHMONITOR(telas[i].h, n, arr)) continue;
            try {
                for (int k = 0; k < arr.Length; k++) {
                    uint mn, c, mx;
                    if (!GetMonitorBrightness(arr[k].h, out mn, out c, out mx) || mx <= mn) continue;
                    int pct = (int)Math.Round(100.0 * (c - mn) / (mx - mn));
                    if (sb.Length > 0) sb.Append(';');
                    sb.Append((i + 1) + "." + k + "|" + (telas[i].principal ? "1" : "0") + "|" + pct);
                }
            } finally { DestroyPhysicalMonitors(n, arr); }
        }
        return sb.ToString();
    }

    public static bool Definir(string id, int pct) {
        var partes = id.Split('.');
        int i, k;
        if (partes.Length != 2 || !int.TryParse(partes[0], out i) || !int.TryParse(partes[1], out k)) return false;
        var telas = Telas();
        if (i < 1 || i > telas.Count) return false;
        uint n;
        if (!GetNumberOfPhysicalMonitorsFromHMONITOR(telas[i - 1].h, out n) || k >= n) return false;
        var arr = new PHYSICAL_MONITOR[n];
        if (!GetPhysicalMonitorsFromHMONITOR(telas[i - 1].h, n, arr)) return false;
        try {
            uint mn, c, mx;
            if (!GetMonitorBrightness(arr[k].h, out mn, out c, out mx) || mx <= mn) return false;
            uint alvo = (uint)Math.Round(mn + (mx - mn) * Math.Max(0, Math.Min(100, pct)) / 100.0);
            return SetMonitorBrightness(arr[k].h, alvo);
        } finally { DestroyPhysicalMonitors(n, arr); }
    }
}
'@
} catch { [Console]::Error.WriteLine("Falha ao compilar controles do sistema: $($_.Exception.Message)") }

# Wi-Fi e Bluetooth (API de rádios do Windows)
$script:radios = @()
try {
    $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
    $null = Aguardar ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
    $script:radios = @(Aguardar ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) `
        ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]))
} catch { [Console]::Error.WriteLine("Rádios indisponíveis: $($_.Exception.Message)") }

function Radio($tipo) { $script:radios | Where-Object { "$($_.Kind)" -eq $tipo } | Select-Object -First 1 }

function Definir-Radio($tipo, $valor) {
    $r = Radio $tipo
    if (-not $r) { return }
    if ($valor -eq 'toggle') { $valor = if ("$($r.State)" -eq 'On') { 'off' } else { 'on' } }
    $novo = if ($valor -eq 'on') { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off }
    $null = Aguardar ($r.SetStateAsync($novo)) ([Windows.Devices.Radios.RadioAccessStatus])
}

# Brilho: notebooks usam WMI; monitores externos, DDC/CI
$script:temWmi = $null
function Tem-WmiBrilho {
    if ($null -eq $script:temWmi) {
        $script:temWmi = [bool](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue)
    }
    return $script:temWmi
}
# Lista as telas com brilho ajustável: [{ id, nome, principal, brilho }]
function Ler-Monitores {
    $lista = New-Object System.Collections.ArrayList
    try {
        $txt = [BrilhoIlha]::Listar()
        foreach ($item in ($txt -split ';' | Where-Object { $_ })) {
            $p = $item -split '\|'
            $null = $lista.Add([ordered]@{ id = $p[0]; principal = ($p[1] -eq '1'); brilho = [int]$p[2] })
        }
    } catch { }
    if (Tem-WmiBrilho) {
        $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($b) {
            $temPrincipal = @($lista | Where-Object { $_.principal }).Count -gt 0
            $null = $lista.Insert(0, [ordered]@{ id = 'wmi'; principal = (-not $temPrincipal); brilho = [int]$b.CurrentBrightness; notebook = $true })
        }
    }
    # Nomes amigáveis: Principal, Tela 2, Tela 3...
    $ordenada = @($lista | Sort-Object @{ Expression = { -not $_.principal } }, @{ Expression = { $_.id } })
    $n = 1
    foreach ($m in $ordenada) {
        if ($m.notebook) { $m.nome = 'Tela do notebook' }
        elseif ($m.principal) { $m.nome = 'Tela principal' }
        else { $n++; $m.nome = "Tela $n" }
    }
    return ,$ordenada
}

function Id-Principal {
    $p = @($script:monitores | Where-Object { $_.principal } | Select-Object -First 1)
    if ($p.Count) { return $p[0].id }
    if (@($script:monitores).Count) { return @($script:monitores)[0].id }
    return $null
}

# brilho <pct>  -> só a tela principal  |  brilho <id> <pct> -> uma tela específica
function Definir-Brilho([string]$arg) {
    $partes = $arg -split '\s+'
    if ($partes.Count -ge 2) { $id = $partes[0]; $pct = [int]$partes[1] } else { $id = Id-Principal; $pct = [int]$partes[0] }
    if (-not $id) { return }
    $pct = [Math]::Max(0, [Math]::Min(100, $pct))
    if ($id -eq 'wmi') {
        Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction SilentlyContinue | ForEach-Object {
            Invoke-CimMethod -InputObject $_ -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte]$pct } | Out-Null
        }
    } else {
        try { $null = [BrilhoIlha]::Definir($id, $pct) } catch { }
    }
    foreach ($m in @($script:monitores)) { if ($m.id -eq $id) { $m.brilho = $pct } }
}

$script:monitores = @()
$script:avisouAudio = $false
# completo = lê também o brilho (lento em monitores externos); leve = só o que mudou
function Enviar-Sistema([switch]$Leve) {
    $e = [ordered]@{ tipo = 'sistema' }
    try { $e.volume = [AudioIlha]::Volume(); $e.mudo = [AudioIlha]::Mudo() } catch {
        $e.volume = $null; $e.mudo = $null
        if (-not $script:avisouAudio) { $script:avisouAudio = $true; [Console]::Error.WriteLine("Controle de volume indisponível: $($_.Exception.Message)") }
    }
    if (-not $Leve) { $script:monitores = Ler-Monitores }
    $e.monitores = @($script:monitores)
    $principal = @($script:monitores | Where-Object { $_.principal } | Select-Object -First 1)
    $e.brilho = if ($principal.Count) { $principal[0].brilho } else { $null }
    $w = Radio 'WiFi'; $e.wifi = if ($w) { "$($w.State)" -eq 'On' } else { $null }
    $b = Radio 'Bluetooth'; $e.bt = if ($b) { "$($b.State)" -eq 'On' } else { $null }
    [Console]::Out.WriteLine(($e | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

$ultimoEstado = ''
$script:chaveCapaEnviada = ''
$ultimaChaveCapa = ''
$capaAtual = $null
$cicloDiag = 0
$capaTentativas = 0
$rajada = 0
$tocando = $false
$ultimoNivel = -1.0

$capaErroAvisado = $false
function Avisar-Log($msg) {
    [Console]::Out.WriteLine((@{ tipo = 'log'; msg = $msg } | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
}
function Ler-Capa($props) {
    if (-not $props.Thumbnail) { return $null }
    $stream = $null
    try {
        $stream = Aguardar ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    } catch {
        if (-not $script:capaErroAvisado) { $script:capaErroAvisado = $true; Avisar-Log ("capa: não abriu: " + $_.Exception.Message) }
        return $null
    }
    if (-not $stream) { return $null }
    $cru = $stream.psobject.BaseObject   # o objeto do Windows de verdade (sem o "invólucro" do PowerShell)
    # O PowerShell recebe o stream como __ComObject "cru": as chamadas vão por reflexão
    # (o .NET faz a conversão para a interface do Windows, que o PowerShell não faz sozinho)
    $tipo = 'image/png'
    try { $tipo = [string]([Windows.Storage.Streams.IContentTypeProvider].GetProperty('ContentType').GetValue($cru, $null)) } catch { }
    $bytes = $null
    # 1) Conversão para stream do .NET por reflexão
    try {
        $metodo = [System.IO.WindowsRuntimeStreamExtensions].GetMethod('AsStreamForRead', [Type[]]@([Windows.Storage.Streams.IInputStream]))
        $netStream = $metodo.Invoke($null, [object[]]@($cru))
        $memoria = New-Object System.IO.MemoryStream
        $netStream.CopyTo($memoria)
        $bytes = $memoria.ToArray()
        $netStream.Dispose(); $memoria.Dispose()
    } catch {
        $bytes = $null
        if (-not $script:capaErroAvisado) { $script:capaErroAvisado = $true; Avisar-Log ("capa: AsStreamForRead falhou: " + $_.Exception.InnerException.Message + ' ' + $_.Exception.Message) }
    }
    # 2) DataReader por reflexão
    if (-not $bytes -or $bytes.Length -eq 0) {
        try {
            $tam = [uint32]([Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($cru, $null))
            $entrada = [Windows.Storage.Streams.IRandomAccessStream].GetMethod('GetInputStreamAt').Invoke($cru, [object[]]@([uint64]0))
            $leitor = [Windows.Storage.Streams.DataReader]::new($entrada)
            $n = Aguardar ($leitor.LoadAsync($tam)) ([uint32])
            $bytes = New-Object byte[] $n
            $leitor.ReadBytes($bytes)
            $leitor.Dispose()
        } catch {
            $bytes = $null
            Avisar-Log ("capa: DataReader falhou: " + $_.Exception.InnerException.Message + ' ' + $_.Exception.Message)
        }
    }
    try { $stream.Dispose() } catch { }
    if (-not $bytes -or $bytes.Length -eq 0) { return $null }
    if ($tipo -notmatch '^image/') { $tipo = 'image/jpeg' }
    return "data:$tipo;base64," + [Convert]::ToBase64String($bytes)
}

# Qual player mostrar: SEMPRE o que está tocando de verdade (o "atual" do Windows pode ser um pausado).
# - se um player começa a tocar agora, ele passa a ser o mostrado;
# - se o mostrado pausar, continua nele (para dar play de novo pela ilha).
$sessaoFixa = $null
$tocandoAntes = @{}
$fixaTocouEm = [DateTime]::MinValue
$segurar = $false
# Som que não é música/vídeo: chamada e notificação do WhatsApp Web, avisos de sites...
# O navegador manda essas "mídias" sem nome de música, só com o endereço do site como título.
function Eh-Ruido($x) {
    try {
        $p = Aguardar ($x.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        if (-not $p) { return $false }
        $t = ([string]$p.Title).Trim()
        $a = ([string]$p.Artist).Trim()
        if ($t -match '(?i)whatsapp') { return $true }
        if (-not $a -and $t -match '^(?i)(https?://)?[a-z0-9-]+(\.[a-z0-9-]+)+(/\S*)?$') { return $true }
    } catch { }
    return $false
}

$ultimoDiag = ''
function Diagnosticar {
    try {
        $partes = @()
        foreach ($x in @($gerente.GetSessions())) {
            $st = ''; $t = ''; $a = ''; $th = ''
            try { $st = [string]$x.GetPlaybackInfo().PlaybackStatus } catch { $st = 'erro' }
            try {
                $p = Aguardar ($x.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
                if ($p) { $t = [string]$p.Title; $a = [string]$p.Artist; $th = if ($p.Thumbnail) { 'capa' } else { 'sem capa' } } else { $t = '(sem props)' }
            } catch { $t = '(erro props)' }
            $partes += "$([string]$x.SourceAppUserModelId) [$st] '$t' / '$a' ($th) ruido=$(Eh-Ruido $x)"
        }
        $txt = 'sessões: ' + ($partes -join ' | ') + " || fixa=$script:sessaoFixa"
        if ($txt -ne $script:ultimoDiag) {
            $script:ultimoDiag = $txt
            [Console]::Out.WriteLine((@{ tipo = 'log'; msg = $txt } | ConvertTo-Json -Compress))
            [Console]::Out.Flush()
        }
    } catch { }
}

function Escolher-Sessao {
    if (-not $gerente) { return $null }
    # Leve: o status de cada player é rápido de ler; o nome (para filtrar ligação/notificação)
    # só é lido de quem está TOCANDO, e não de todos os players abertos a cada olhada
    $todas = @()
    try { $todas = @($gerente.GetSessions()) } catch { }
    if ($todas.Count -eq 0) { $script:sessaoFixa = $null; return $null }
    $tocandoAgora = @{}
    $tocando = New-Object System.Collections.Generic.List[object]
    foreach ($x in $todas) {
        $st = ''
        try { $st = [string]$x.GetPlaybackInfo().PlaybackStatus } catch { }
        if ($st -eq 'Playing' -and -not (Eh-Ruido $x)) { $tocando.Add($x); $tocandoAgora[[string]$x.SourceAppUserModelId] = $true }
    }
    $escolhida = $null
    if ($tocando.Count -gt 0) {
        # 1) acabou de começar a tocar (não tocava na última olhada)
        $novo = $tocando | Where-Object { -not $script:tocandoAntes.ContainsKey([string]$_.SourceAppUserModelId) } | Select-Object -First 1
        # 2) a que já estava sendo mostrada, se continua tocando
        $fixa = $tocando | Where-Object { [string]$_.SourceAppUserModelId -eq $script:sessaoFixa } | Select-Object -First 1
        if ($novo) { $escolhida = $novo } elseif ($fixa) { $escolhida = $fixa } else { $escolhida = $tocando[0] }
    } else {
        $escolhida = $todas | Where-Object { [string]$_.SourceAppUserModelId -eq $script:sessaoFixa } | Select-Object -First 1
        if (-not $escolhida) {
            # O player que estava tocando sumiu por um instante (trocando de música): segura a tela
            # como está em vez de pular para outro player que está pausado
            if ($script:sessaoFixa -and ((Get-Date) - $script:fixaTocouEm).TotalSeconds -lt 8) {
                $script:tocandoAntes = $tocandoAgora
                $script:segurar = $true
                return $null
            }
            $escolhida = $gerente.GetCurrentSession()
            if ($escolhida -and (Eh-Ruido $escolhida)) { $escolhida = $null }
        }
        if (-not $escolhida) { $escolhida = $todas | Where-Object { -not (Eh-Ruido $_) } | Select-Object -First 1 }
        if (-not $escolhida) { $script:tocandoAntes = $tocandoAgora; return $null }
    }
    $script:tocandoAntes = $tocandoAgora
    if ($escolhida) {
        $script:sessaoFixa = [string]$escolhida.SourceAppUserModelId
        if ($tocandoAgora.ContainsKey($script:sessaoFixa)) { $script:fixaTocouEm = Get-Date }
    }
    return $escolhida
}

function Enviar-Estado {
    $script:segurar = $false
    $sessao = Escolher-Sessao
    if ($script:segurar) { return }   # player trocando de música: não mostra o de outro app
    $estado = [ordered]@{ ativo = $false }

    if ($sessao) {
        $props = Aguardar ($sessao.TryGetMediaPropertiesAsync()) `
            ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $info = $sessao.GetPlaybackInfo()
        # sem título no meio da troca de música: espera a música nova em vez de piscar "nada tocando"
        if (-not ($props -and $props.Title) -and ((Get-Date) - $script:fixaTocouEm).TotalSeconds -lt 8) { return }
        if ($props -and $props.Title) {
            $estado.ativo = $true
            $estado.titulo = [string]$props.Title
            $estado.artista = [string]$props.Artist
            $estado.app = [string]$sessao.SourceAppUserModelId
            $estado.status = [string]$info.PlaybackStatus   # Playing, Paused, Stopped...
            try {
                $linha = $sessao.GetTimelineProperties()
                $dur = ($linha.EndTime - $linha.StartTime).TotalSeconds
                if ($dur -gt 1) {
                    $estado.dur = [Math]::Round($dur, 1)
                    $estado.pos = [Math]::Round($linha.Position.TotalSeconds, 1)
                    $estado.quando = $linha.LastUpdatedTime.ToUnixTimeMilliseconds()
                }
            } catch { }
            $chaveCapa = "$($props.Title)|$($props.Artist)"
            if ($chaveCapa -ne $script:ultimaChaveCapa) {
                $script:ultimaChaveCapa = $chaveCapa
                $script:capaTentativas = 0
                $script:capaAtual = Ler-Capa $props
            } elseif (-not $script:capaAtual -and $script:capaTentativas -lt 12) {
                # o player (ex.: Spotify) costuma mandar a capa uns segundos depois do nome: tenta de novo
                $script:capaTentativas++
                $script:capaAtual = Ler-Capa $props
                if ($script:capaAtual) { $script:chaveCapaEnviada = '' }
            }
        }
    }

    $script:tocando = ($estado.status -eq 'Playing')
    $json = $estado | ConvertTo-Json -Compress
    # tocando: manda sempre (posição da música); parado: só quando algo muda
    if ($json -ne $script:ultimoEstado -or $estado.status -eq 'Playing') {
        $script:ultimoEstado = $json
        if ($estado.ativo -and $script:chaveCapaEnviada -ne $script:ultimaChaveCapa) {
            $estado.capa = $script:capaAtual            # a capa só vai quando a música muda
            $script:chaveCapaEnviada = $script:ultimaChaveCapa
        }
        [Console]::Out.WriteLine(($estado | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    }
}

function Executar($comando) {
    $sessao = $null
    if ($gerente) {
        try { $sessao = @($gerente.GetSessions()) | Where-Object { [string]$_.SourceAppUserModelId -eq $script:sessaoFixa } | Select-Object -First 1 } catch { }
        if (-not $sessao) { $sessao = Escolher-Sessao }
    }
    $partes = $comando.Trim() -split '\s+', 2
    $arg = if ($partes.Count -gt 1) { $partes[1] } else { '' }
    switch ($partes[0]) {
        'vol'    {
            try { [AudioIlha]::DefinirVolume([int]$arg) } catch { [Console]::Error.WriteLine("Falha ao definir volume: $($_.Exception.Message)") }
            Enviar-Sistema -Leve
        }
        'mudo'   {
            try {
                $m = if ($arg -eq 'toggle') { -not [AudioIlha]::Mudo() } else { $arg -eq 'on' }
                [AudioIlha]::DefinirMudo($m)
            } catch { if ($arg -eq 'toggle') { [TeclasIlha]::Apertar(0xAD) } }
            Enviar-Sistema -Leve
        }
        'brilho' { Definir-Brilho $arg; Enviar-Sistema -Leve }
        'wifi'   { Definir-Radio 'WiFi' $arg; Start-Sleep -Milliseconds 400; Enviar-Sistema }
        'bt'     { Definir-Radio 'Bluetooth' $arg; Start-Sleep -Milliseconds 400; Enviar-Sistema }
        'estado' { Enviar-Sistema }
        'dispositivos' { Enviar-Dispositivos }
        'padrao' {
            try { [AudioIlha]::DefinirPadrao($arg.Trim()) } catch { [Console]::Error.WriteLine("Falha ao trocar dispositivo: $($_.Exception.Message)") }
            Start-Sleep -Milliseconds 300
            Enviar-Dispositivos; Enviar-Sistema
        }
        'toggle' {
            if ($sessao) { $null = Aguardar ($sessao.TryTogglePlayPauseAsync()) ([bool]) }
            $script:rajada = 45
            else { [TeclasIlha]::Apertar(0xB3) }
        }
        'next' {
            if ($sessao) { $null = Aguardar ($sessao.TrySkipNextAsync()) ([bool]) }
            $script:rajada = 45
            else { [TeclasIlha]::Apertar(0xB0) }
        }
        'prev' {
            if ($sessao) { $null = Aguardar ($sessao.TrySkipPreviousAsync()) ([bool]) }
            $script:rajada = 45
            else { [TeclasIlha]::Apertar(0xB1) }
        }
        'hw'     {
            # Temperaturas e uso da GPU (classes de desempenho do Windows: não precisam de administrador)
            $r = [ordered]@{ tipo = 'hw' }
            # 1) LibreHardwareMonitor aberto? É o sensor mais fiel da CPU
            try {
                $s = Get-CimInstance -Namespace 'root/LibreHardwareMonitor' -ClassName Sensor -ErrorAction Stop |
                    Where-Object { $_.SensorType -eq 'Temperature' -and $_.Identifier -like '*cpu*' -and ($_.Name -like '*Package*' -or $_.Name -like '*Tctl*' -or $_.Name -like '*Tdie*' -or $_.Name -like '*Core (Average)*') } |
                    Select-Object -First 1
                if ($s) { $r.cpuTemp = [Math]::Round([double]$s.Value); $r.cpuFonte = 'lhm' }
            } catch { }
            # 2) Sensor térmico da placa (ACPI), em Kelvin
            if (-not $r.Contains('cpuTemp')) {
                try {
                    $z = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction Stop | Where-Object { $_.Temperature -gt 250 })
                    if ($z.Count) { $r.cpuTemp = [Math]::Round(([double](($z | Measure-Object -Property Temperature -Maximum).Maximum)) - 273.15); $r.cpuFonte = 'acpi' }
                } catch { }
            }
            # 3) Uso da GPU (motor 3D, como no Gerenciador de Tarefas) — só se não tiver NVIDIA
            if ($arg -ne 'semgpu') {
                try {
                    $g = @(Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -like '*engtype_3D*' })
                    if ($g.Count) { $r.gpuUso = [Math]::Min(100, [int](($g | Measure-Object -Property UtilizationPercentage -Sum).Sum)) }
                } catch { }
            }
            [Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
            [Console]::Out.Flush()
        }
        'seek'    {
            if ($sessao) {
                $ticks = [long]([double]$arg * 10000000)
                $null = Aguardar ($sessao.TryChangePlaybackPositionAsync($ticks)) ([bool])
                $script:ultimoEstado = ''
            }
        }
        'volup'   { [TeclasIlha]::Apertar(0xAF); Enviar-Sistema -Leve }
        'voldown' { [TeclasIlha]::Apertar(0xAE); Enviar-Sistema -Leve }
        'mute'    { [TeclasIlha]::Apertar(0xAD); Enviar-Sistema -Leve }
    }
}

$ciclo = 0
Enviar-Estado

$script:volVisto = $null; $script:mudoVisto = $null; $script:brilhoVisto = $null
$script:saidaVista = $null
$script:ultimoComando = [DateTime]::MinValue
function Vigiar-Volume {
    try { $v = [AudioIlha]::Volume(); $m = [AudioIlha]::Mudo() } catch { return }
    if ($null -ne $script:volVisto -and ($v -ne $script:volVisto -or $m -ne $script:mudoVisto)) {
        $externo = ([DateTime]::Now - $script:ultimoComando).TotalMilliseconds -gt 700
        [Console]::Out.WriteLine((@{ tipo = 'osd'; o = 'volume'; valor = $v; mudo = $m; externo = $externo } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        Enviar-Sistema -Leve
    }
    $script:volVisto = $v; $script:mudoVisto = $m
}
function Vigiar-Brilho {
    if (-not (Tem-WmiBrilho)) { return }   # teclas de brilho só existem em notebooks
    $b = Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $b) { return }
    $v = [int]$b.CurrentBrightness
    if ($null -ne $script:brilhoVisto -and $v -ne $script:brilhoVisto) {
        $externo = ([DateTime]::Now - $script:ultimoComando).TotalMilliseconds -gt 700
        foreach ($m in @($script:monitores)) { if ($m.id -eq 'wmi') { $m.brilho = $v } }
        [Console]::Out.WriteLine((@{ tipo = 'osd'; o = 'brilho'; valor = $v; externo = $externo } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
        Enviar-Sistema -Leve
    }
    $script:brilhoVisto = $v
}
function Enviar-Dispositivos {
    $conv = {
        param($linhas)
        $r = @()
        foreach ($l in $linhas) { $p = $l -split "`t", 3; if ($p.Count -eq 3) { $r += [ordered]@{ padrao = ($p[0] -eq '1'); id = $p[1]; nome = $p[2] } } }
        ,$r
    }
    $obj = [ordered]@{ tipo = 'dispositivos'; saidas = (& $conv ([AudioIlha]::Listar(0))); entradas = (& $conv ([AudioIlha]::Listar(1))) }
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $obj -Compress -Depth 4))
    [Console]::Out.Flush()
}

function Vigiar-Saida {
    $nome = [AudioIlha]::NomeSaida()
    if ($null -ne $script:saidaVista -and $nome -and $nome -ne $script:saidaVista) {
        [Console]::Out.WriteLine((@{ tipo = 'saida'; nome = $nome } | ConvertTo-Json -Compress))
        [Console]::Out.Flush()
    }
    if ($nome) { $script:saidaVista = $nome }
}
$cicloVigia = 0

while ($true) {
    if ([EntradaIlha]::Acabou) { exit }   # o app fechou
    # 1) Junta todos os comandos que chegaram (ao arrastar a barra chegam vários por segundo)
    $fila = New-Object System.Collections.Generic.List[string]
    while ($null -ne ($linha = [EntradaIlha]::Proxima())) { $fila.Add($linha.Trim()) }
    if ($fila.Count -gt 0) {
        # 2) Para volume e brilho só importa o último valor pedido
        $ultimoVol = ($fila | Where-Object { $_ -like 'vol *' } | Select-Object -Last 1)
        $chaveBrilho = { param($c) $p = $c -split '\s+'; if ($p.Count -ge 3) { 'brilho ' + $p[1] } else { 'brilho' } }
        $ultimosBrilho = @{}
        foreach ($c in $fila) { if ($c -like 'brilho *') { $ultimosBrilho[(& $chaveBrilho $c)] = $c } }
        $feitos = @{}
        foreach ($cmd in $fila) {
            if ($cmd -like 'vol *') { if ($cmd -ne $ultimoVol -or $feitos['vol']) { continue }; $feitos['vol'] = $true }
            elseif ($cmd -like 'brilho *') {
                $ch = & $chaveBrilho $cmd
                if ($cmd -ne $ultimosBrilho[$ch] -or $feitos[$ch]) { continue }; $feitos[$ch] = $true
            }
            elseif ($cmd -eq 'estado') { if ($feitos['estado']) { continue }; $feitos['estado'] = $true }
            try { Executar $cmd } catch { }
        }
        $script:ultimoComando = [DateTime]::Now
        $ciclo = 9   # atualiza a mídia logo depois
    }
    $cicloVigia++
    if ($cicloVigia % 3 -eq 0) { Vigiar-Volume }                 # ~4x por segundo
    if ($cicloVigia % 18 -eq 0) { try { Vigiar-Brilho } catch { } }   # ~1,5 s
    if ($cicloVigia % 12 -eq 0) { try { Vigiar-Saida } catch { } }    # ~1 s
    # Depois de passar a música: confere a cada ~240 ms por uns 3,5 s (o player demora a trocar)
    if ($script:rajada -gt 0) {
        $script:rajada--
        if ($script:rajada % 3 -eq 0) { try { Enviar-Estado } catch { } }
    }
    # Tocando: manda o nível do som ~12x por segundo (olhinhos curtindo a música)
    if ($script:tocando) {
        $v = 0.0
        try { $v = [Math]::Round([double][AudioIlha]::Pico(), 2) } catch { }
        if ($v -ne $script:ultimoNivel) {
            $script:ultimoNivel = $v
            [Console]::Out.WriteLine('{"tipo":"nivel","v":' + $v.ToString([Globalization.CultureInfo]::InvariantCulture) + '}')
            [Console]::Out.Flush()
        }
    }
    $ciclo++
    $cicloDiag++
    if ($cicloDiag % 375 -eq 0) { Diagnosticar }   # ~30 s, só registra quando muda
    if ($ciclo -ge 10) {   # mídia: ~1 vez por segundo
        $ciclo = 0
        try { Enviar-Estado } catch { }
    }
    Start-Sleep -Milliseconds 80
}
