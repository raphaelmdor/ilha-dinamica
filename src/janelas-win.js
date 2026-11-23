// Descobre como está a janela em primeiro plano no Windows (via koffi, sem compilar nada).
// estadoPrimeiroPlano() -> { modo: 'cheia'|'maximizada'|'normal', exe, protegido, d3d } ou null (manter o estado atual)

let w = null;
let koffiRef = null;
let proprio = 0n; // a própria janela da ilha (ignorada)

// Janelas do próprio Windows que não devem mudar o modo da ilha
const AREA_DE_TRABALHO = new Set(['Progman', 'WorkerW']);
const PASSAGEIRAS = new Set([
  'Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow',
  'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow',
  'XamlExplorerHostIslandWindow', 'ForegroundStaging', 'MultitaskingViewFrame',
  'TaskListThumbnailWnd', '#32768', // menus de contexto
]);

function iniciar(log = () => {}, handlePropria = null) {
  if (process.platform !== 'win32') return false;
  try {
    const koffi = require('koffi');
    koffiRef = koffi;
    if (handlePropria) proprio = handlePropria.readBigUInt64LE(0);
    const user32 = koffi.load('user32.dll');
    const RECT = koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    const MONITORINFO = koffi.struct('MONITORINFO', {
      cbSize: 'uint32', rcMonitor: RECT, rcWork: RECT, dwFlags: 'uint32',
    });
    w = {
      MONITORINFO_SIZE: koffi.sizeof(MONITORINFO),
      GetForegroundWindow: user32.func('__stdcall', 'GetForegroundWindow', 'void *', []),
      GetWindowRect: user32.func('__stdcall', 'GetWindowRect', 'bool', ['void *', koffi.out(koffi.pointer(RECT))]),
      MonitorFromWindow: user32.func('__stdcall', 'MonitorFromWindow', 'void *', ['void *', 'uint32']),
      GetMonitorInfoW: user32.func('__stdcall', 'GetMonitorInfoW', 'bool', ['void *', koffi.inout(koffi.pointer(MONITORINFO))]),
      GetClassNameW: user32.func('__stdcall', 'GetClassNameW', 'int', ['void *', 'void *', 'int']),
      IsZoomed: user32.func('__stdcall', 'IsZoomed', 'bool', ['void *']),
      IsWindowVisible: user32.func('__stdcall', 'IsWindowVisible', 'bool', ['void *']),
      IsIconic: user32.func('__stdcall', 'IsIconic', 'bool', ['void *']),
      GetTopWindow: user32.func('__stdcall', 'GetTopWindow', 'void *', ['void *']),
      GetWindow: user32.func('__stdcall', 'GetWindow', 'void *', ['void *', 'uint32']),
      GetWindowLongW: user32.func('__stdcall', 'GetWindowLongW', 'long', ['void *', 'int']),
    };
    const kernel32 = koffi.load('kernel32.dll');
    const shell32 = koffi.load('shell32.dll');
    w.GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', koffi.out(koffi.pointer('uint32'))]);
    w.OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'bool', 'uint32']);
    w.QueryFullProcessImageNameW = kernel32.func('__stdcall', 'QueryFullProcessImageNameW', 'bool', ['void *', 'uint32', 'void *', koffi.inout(koffi.pointer('uint32'))]);
    w.CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'bool', ['void *']);
    w.GetAsyncKeyState = user32.func('__stdcall', 'GetAsyncKeyState', 'int16', ['int32']);
    // Para trazer uma janela nossa para a frente (o Windows bloqueia apps "de fundo" de pegar o foco)
    w.GetForegroundWindowI = user32.func('__stdcall', 'GetForegroundWindow', 'intptr', []);
    w.GetWindowThreadProcessIdI = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['intptr', 'void *']);
    w.AttachThreadInput = user32.func('__stdcall', 'AttachThreadInput', 'bool', ['uint32', 'uint32', 'bool']);
    w.SetForegroundWindowI = user32.func('__stdcall', 'SetForegroundWindow', 'bool', ['intptr']);
    w.BringWindowToTopI = user32.func('__stdcall', 'BringWindowToTop', 'bool', ['intptr']);
    w.GetCurrentThreadId = kernel32.func('__stdcall', 'GetCurrentThreadId', 'uint32', []);
    // 3 = jogo/app DirectX em tela cheia exclusiva
    w.SHQueryUserNotificationState = shell32.func('__stdcall', 'SHQueryUserNotificationState', 'long', [koffi.out(koffi.pointer('int'))]);
    try {
      const dwm = koffi.load('dwmapi.dll');
      w.DwmGetWindowAttribute = dwm.func('__stdcall', 'DwmGetWindowAttribute', 'long',
        ['void *', 'uint32', koffi.out(koffi.pointer('uint32')), 'uint32']);
    } catch { /* sem DWM: ignora a checagem de janelas "invisíveis" */ }
    log('Detector de janelas (koffi) pronto');
    return true;
  } catch (erro) {
    log('Detector de janelas indisponível:', erro.message);
    w = null;
    return false;
  }
}

const vazio = () => ({ left: 0, top: 0, right: 0, bottom: 0 });

const WS_EX_TRANSPARENT = 0x20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;

function classe(h) {
  const buf = Buffer.alloc(512);
  const n = w.GetClassNameW(h, buf, 256);
  return buf.toString('utf16le', 0, Math.max(0, n) * 2);
}

function ehPropria(h) {
  return proprio && koffiRef.address(h) === proprio;
}

// Janela de app "de verdade", visível e não minimizada
function ehAppVisivel(h) {
  if (!h || ehPropria(h) || !w.IsWindowVisible(h) || w.IsIconic(h)) return false;
  const c = classe(h);
  if (PASSAGEIRAS.has(c) || AREA_DE_TRABALHO.has(c)) return false;
  const ex = w.GetWindowLongW(h, -20) >>> 0; // GWL_EXSTYLE
  if (ex & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TRANSPARENT)) return false; // overlays, widgets
  if (w.DwmGetWindowAttribute) {
    const oculta = [0];
    if (w.DwmGetWindowAttribute(h, 14, oculta, 4) === 0 && oculta[0]) return false; // "cloaked" (apps da Store suspensos, outras áreas de trabalho)
  }
  const r = vazio();
  if (!w.GetWindowRect(h, r)) return false;
  return r.right - r.left > 50 && r.bottom - r.top > 50;
}

// Classifica uma janela: 'cheia' | 'maximizada' | 'normal' | 'outro-monitor'
function classificar(h) {
  const r = vazio();
  if (!w.GetWindowRect(h, r)) return 'normal';
  const mi = { cbSize: w.MONITORINFO_SIZE, rcMonitor: vazio(), rcWork: vazio(), dwFlags: 0 };
  if (!w.GetMonitorInfoW(w.MonitorFromWindow(h, 2), mi)) return 'normal';
  if ((mi.dwFlags & 1) === 0) return 'outro-monitor'; // a ilha fica no monitor principal
  const m = mi.rcMonitor;
  const t = mi.rcWork;
  if (r.left <= m.left && r.top <= m.top && r.right >= m.right && r.bottom >= m.bottom) return 'cheia';
  if (w.IsZoomed(h)) return 'maximizada';
  // Apps sem moldura que ocupam a área de trabalho inteira contam como maximizados
  const folga = 4;
  if (r.left <= t.left + folga && r.top <= t.top + folga && r.right >= t.right - folga && r.bottom >= t.bottom - folga) {
    return 'maximizada';
  }
  return 'normal';
}

// Caminho do .exe dono da janela. protegido = o processo não deixa nem ler o nome (anti-cheat).
const cacheExe = new Map();
function infoProcesso(h) {
  const chave = String(koffiRef.address(h));
  if (cacheExe.has(chave)) return cacheExe.get(chave);
  let info = { exe: '', protegido: false };
  try {
    const pid = [0];
    w.GetWindowThreadProcessId(h, pid);
    const proc = pid[0] ? w.OpenProcess(0x1000, false, pid[0]) : null; // PROCESS_QUERY_LIMITED_INFORMATION
    if (!proc) {
      info.protegido = true;
    } else {
      const buf = Buffer.alloc(2048);
      const tam = [1024];
      if (w.QueryFullProcessImageNameW(proc, 0, buf, tam)) info.exe = buf.toString('utf16le', 0, tam[0] * 2);
      w.CloseHandle(proc);
    }
  } catch { /* sem informação */ }
  if (cacheExe.size > 300) cacheExe.clear();
  cacheExe.set(chave, info);
  return info;
}

function telaCheiaExclusiva() {
  try {
    const estado = [0];
    if (w.SHQueryUserNotificationState(estado) === 0) return estado[0] === 3; // QUNS_RUNNING_D3D_FULL_SCREEN
  } catch { /* ignora */ }
  return false;
}

function resultado(modo, h) {
  const r = { modo, exe: '', protegido: false, d3d: telaCheiaExclusiva() };
  if (h && modo !== 'normal') Object.assign(r, infoProcesso(h));
  return r;
}

function estadoPrimeiroPlano() {
  if (!w) return { modo: 'normal', exe: '', protegido: false, d3d: false };

  // 1) Caso comum: o app em foco
  const fg = w.GetForegroundWindow();
  if (fg && AREA_DE_TRABALHO.has(classe(fg))) return resultado('normal');
  if (ehAppVisivel(fg)) {
    const estado = classificar(fg);
    if (estado !== 'outro-monitor') return resultado(estado, fg);
  }
  // Em tela cheia exclusiva, a janela do jogo às vezes nem aparece como "visível" para o Windows
  if (telaCheiaExclusiva()) return { modo: 'cheia', exe: '', protegido: false, d3d: true };

  // 2) Foco na barra de tarefas, menu Iniciar, janela minimizada...:
  //    percorre as janelas de cima para baixo e usa o primeiro app visível no monitor principal
  let h = w.GetTopWindow(null);
  for (let i = 0; h && i < 600; i++) {
    if (AREA_DE_TRABALHO.has(classe(h))) return resultado('normal');
    if (ehAppVisivel(h)) {
      const estado = classificar(h);
      if (estado !== 'outro-monitor') return resultado(estado, h);
    }
    h = w.GetWindow(h, 2); // GW_HWNDNEXT
  }
  return resultado('normal');
}

// Botão esquerdo do mouse apertado? (para não abrir a ilha enquanto você arrasta uma aba)
function botaoMouseApertado() {
  try { return !!w && (w.GetAsyncKeyState(0x01) & 0x8000) !== 0; } catch { return false; }
}

// Joga uma janela nossa para a frente com foco de teclado, mesmo com outro app em primeiro plano
// (liga por um instante a fila de entrada da nossa thread com a do app da frente).
function trazerParaFrente(handle) {
  if (!w || !w.SetForegroundWindowI || !handle) return false;
  try {
    const alvo = Number(handle.length >= 8 ? handle.readBigInt64LE(0) : handle.readInt32LE(0));
    const frente = w.GetForegroundWindowI();
    if (Number(frente) === alvo) return true;
    const nossa = w.GetCurrentThreadId();
    const dela = frente ? w.GetWindowThreadProcessIdI(frente, null) : 0;
    const ligou = dela && dela !== nossa ? w.AttachThreadInput(nossa, dela, true) : false;
    w.BringWindowToTopI(alvo);
    const ok = w.SetForegroundWindowI(alvo);
    if (ligou) w.AttachThreadInput(nossa, dela, false);
    return ok;
  } catch { return false; }
}

module.exports = { iniciar, estadoPrimeiroPlano, botaoMouseApertado, trazerParaFrente };
