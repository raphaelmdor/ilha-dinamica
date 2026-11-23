// Ilha Dinâmica — processo principal (Electron)
const {
  app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu,
  nativeImage, shell, session, net, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { spawn, execFileSync } = require('child_process');
const janelasWin = require('./janelas-win');
const lancador = require('./lancador');
const jogos = require('./jogos');
const servicos = require('./servicos');

// ---------------------------------------------------------------------------
// Constantes e configuração
// ---------------------------------------------------------------------------
const PORTA = 41789; // fixa: o cache do modelo (IndexedDB) depende da origem
const MODELO_NOME = 'vosk-model-small-pt-0.3';
const MODELO_URL = `https://alphacephei.com/vosk/models/${MODELO_NOME}.zip`;

// Mesma pasta de dados na versão de desenvolvimento e na instalada (tarefas, agenda, configurações)
// (usa a pasta que já existir, para não perder tarefas, agenda, configurações e o modelo de voz)
{
  const base = app.getPath('appData');
  const opcoes = ['Ilha Dinâmica', 'ilha-dinamica'].map((n) => path.join(base, n));
  app.setPath('userData', opcoes.find((p) => fs.existsSync(p)) || opcoes[0]);
}
const DIR_DADOS = app.getPath('userData');
const DIR_MODELO = path.join(DIR_DADOS, 'modelo');
const ARQ_MODELO = path.join(DIR_MODELO, `${MODELO_NOME}.tar.gz`);
const ARQ_CONFIG = path.join(DIR_DADOS, 'config.json');
const ARQ_DADOS = path.join(DIR_DADOS, 'dados.json');
const DIR_RENDERER = path.join(__dirname, 'renderer');
const VOSK_JS = require.resolve('vosk-browser/dist/vosk.js');

// Janela transparente maior que a ilha: a área vazia deixa o clique passar.
// A janela fica colada no topo; o respiro da ilha (modo normal) é feito no CSS, com animação
const JANELA = { largura: 640, altura: 420 };

const CONFIG_PADRAO = {
  escutaContinua: false,   // ouve sempre, esperando a palavra "ilha"
  palavraAtivacao: 'ilha',
  respostaFalada: true,    // responde em voz (voz pt-BR do Windows)
  iniciarComWindows: false,
  atalhoVoz: 'Control+Alt+Space',
  atalhoMostrar: 'Control+Alt+I',
  atalhoBusca: 'Alt+Space',       // se estiver ocupado, usa Ctrl+Alt+P
  atalhoPainel: '',               // atalho para abrir o painel (opcional, grave nas configurações)
  // Aparência
  corOlhos: '#f5f5f7',
  corRelogio: '#f5f5f7',
  corDestaque: '#60a5fa',
  fundo: 'preto',                 // preto | grafite | translucido
  tamanho: 1,                     // 0.85 a 1.25
  relogio24h: true,
  mostrarSegundos: false,
  mostrarOlhos: true,
  formatoOlhos: 'pilula',         // pilula | redondo
  // Comportamento
  abrirAoPassar: true,
  atrasoAbrir: 140,
  modoNotch: true,
  modoMini: true,
  // Widgets
  widgets: ['inicio', 'agenda', 'tarefas', 'foco', 'dock', 'bandeja', 'notas', 'clima', 'clipboard', 'sistema'],
  cidade: 'Niterói',
  focoMin: 25,
  pausaMin: 5,
  pausaLongaMin: 15,
  focoAuto: false,
  historicoCopiados: true,
  // Jogos
  esconderEmJogos: true,
  agendasIcs: [],                 // links secretos (iCal) da Google Agenda/Outlook — só leitura
  focoSilencia: true,             // pausa as notificações do Windows durante o Pomodoro
  // Apps com abas no topo (navegador, VS Code...): a ilha vira um tracinho que não bloqueia cliques
  modoDiscreto: 'abas',           // abas | sempre (todo app maximizado) | nunca
  appsComAbas: ['chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe', 'brave.exe', 'vivaldi.exe',
    'arc.exe', 'zen.exe', 'code.exe', 'cursor.exe', 'windowsterminal.exe', 'explorer.exe', 'notepad.exe',
    'notepad++.exe', 'devenv.exe', 'idea64.exe', 'pycharm64.exe', 'webstorm64.exe', 'postman.exe'],
  jogosExtras: [],      // .exe que você marcou como jogo
  naoJogos: [],         // .exe que você marcou como "não é jogo"
};

// Log simples na pasta do projeto (ajuda a diagnosticar problemas)
const VERSAO = app.getVersion ? (app.getVersion() || '4.1') : '4.1';
const ARQ_LOG = path.join(app.isPackaged ? DIR_DADOS : app.getAppPath(), 'ilha-log.txt');
function log(...partes) {
  try {
    const linha = `[${new Date().toLocaleString('pt-BR')}] ${partes.join(' ')}\n`;
    fs.appendFileSync(ARQ_LOG, linha);
  } catch { /* sem log */ }
}

let config = carregarConfig();
let janela = null;
let bandeja = null;
let servidor = null;
let ajudanteMidia = null;
let visivel = true;
let atalhoBuscaAtivo = null;
let ocultaPorJogo = false;      // sumiu porque um jogo está aberto
let mostrarMesmoEmJogo = false; // você pediu para mostrar (Ctrl+Alt+I) durante o jogo
let jogoAtual = '';             // motivo/nome do jogo detectado
let ultimoAppGrande = '';       // último app maximizado/tela cheia (para marcar como jogo pelo menu)
let encerrando = false;

function carregarConfig() {
  try {
    const c = { ...CONFIG_PADRAO, ...JSON.parse(fs.readFileSync(ARQ_CONFIG, 'utf8')) };
    // Versão 4: widgets novos entram na lista de quem já tinha uma salva
    if (!c.migrouV4 && Array.isArray(c.widgets)) {
      for (const w of ['dock', 'bandeja']) {
        if (!c.widgets.includes(w)) {
          const i = c.widgets.indexOf('foco');
          c.widgets.splice(i >= 0 ? i + 1 : c.widgets.length, 0, w);
        }
      }
      c.migrouV4 = true;
    }
    return c;
  } catch {
    return { ...CONFIG_PADRAO, migrouV4: true };
  }
}

function salvarConfig() {
  fs.mkdirSync(DIR_DADOS, { recursive: true });
  fs.writeFileSync(ARQ_CONFIG, JSON.stringify(config, null, 2));
  janela?.webContents.send('config', config);
}

// ---------------------------------------------------------------------------
// Servidor local: serve a interface, o vosk.js e o modelo de voz.
// (O Vosk roda num Web Worker que baixa o modelo por URL; file:// não serve.)
// ---------------------------------------------------------------------------
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
};

function iniciarServidor() {
  return new Promise((resolve, reject) => {
    servidor = http.createServer((req, res) => {
      const url = new URL(req.url, `http://127.0.0.1:${PORTA}`);
      let arquivo;
      if (url.pathname === '/' || url.pathname === '/index.html') {
        arquivo = path.join(DIR_RENDERER, 'index.html');
      } else if (url.pathname === '/vendor/vosk.js') {
        arquivo = VOSK_JS;
      } else if (url.pathname === '/modelo/modelo.tar.gz') {
        arquivo = ARQ_MODELO;
      } else {
        arquivo = path.normalize(path.join(DIR_RENDERER, url.pathname));
        if (!arquivo.startsWith(DIR_RENDERER)) { res.writeHead(403).end(); return; }
      }
      fs.stat(arquivo, (erro, info) => {
        if (erro || !info.isFile()) { res.writeHead(404).end(); return; }
        res.writeHead(200, {
          'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
          'Content-Length': info.size,
          'Cache-Control': 'no-store',
        });
        fs.createReadStream(arquivo).pipe(res);
      });
    });
    servidor.once('error', reject);
    // Só escuta no próprio PC (127.0.0.1): nada fica exposto na rede.
    servidor.listen(PORTA, '127.0.0.1', () => resolve());
  });
}

// ---------------------------------------------------------------------------
// Modelo de voz: baixa o .zip oficial na 1ª execução e converte para .tar.gz
// ---------------------------------------------------------------------------
let promessaModelo = null;

function garantirModelo() {
  if (fs.existsSync(ARQ_MODELO)) return Promise.resolve(true);
  if (!promessaModelo) {
    promessaModelo = baixarModelo().catch((erro) => {
      promessaModelo = null;
      throw erro;
    });
  }
  return promessaModelo;
}

async function baixarModelo() {
  const AdmZip = require('adm-zip');
  const tar = require('tar');
  fs.mkdirSync(DIR_MODELO, { recursive: true });

  const temp = path.join(DIR_MODELO, 'temp');
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });
  const zipLocal = path.join(DIR_MODELO, `${MODELO_NOME}.zip`);

  // Se você já baixou o .zip manualmente, basta colocá-lo na pasta do modelo.
  if (!fs.existsSync(zipLocal)) {
    enviarStatusModelo({ fase: 'baixando', progresso: 0 });
    const resp = await net.fetch(MODELO_URL);
    if (!resp.ok) throw new Error(`Falha ao baixar o modelo (HTTP ${resp.status})`);
    const total = Number(resp.headers.get('content-length')) || 0;
    const leitor = resp.body.getReader();
    const parcial = zipLocal + '.parcial';
    const saida = fs.createWriteStream(parcial);
    let recebido = 0;
    let ultimo = 0;
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      recebido += value.length;
      if (!saida.write(Buffer.from(value))) await new Promise((r) => saida.once('drain', r));
      const agora = Date.now();
      if (total && agora - ultimo > 250) {
        ultimo = agora;
        enviarStatusModelo({ fase: 'baixando', progresso: recebido / total });
      }
    }
    await new Promise((r, j) => saida.end((e) => (e ? j(e) : r())));
    fs.renameSync(parcial, zipLocal);
  }

  enviarStatusModelo({ fase: 'preparando' });
  new AdmZip(zipLocal).extractAllTo(temp, true);
  // O Vosk do navegador remove a 1ª pasta do .tar.gz, então mantemos uma pasta raiz.
  const pastas = fs.readdirSync(temp).filter((n) => fs.statSync(path.join(temp, n)).isDirectory());
  const raiz = pastas.length === 1 ? pastas[0] : null;
  if (!raiz) throw new Error('Formato inesperado do modelo de voz');
  await tar.c({ gzip: true, file: ARQ_MODELO + '.parcial', cwd: temp, portable: true }, [raiz]);
  fs.renameSync(ARQ_MODELO + '.parcial', ARQ_MODELO);
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(zipLocal, { force: true });
  enviarStatusModelo({ fase: 'pronto' });
  return true;
}

function enviarStatusModelo(status) {
  janela?.webContents.send('modelo:status', status);
}

// ---------------------------------------------------------------------------
// Ajudante de mídia (PowerShell + API de mídia do Windows)
// ---------------------------------------------------------------------------
function caminhoScriptMidia() {
  // No instalador, o .ps1 fica fora do pacote .asar (ver "asarUnpack").
  return path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');
}

let tentativasMidia = 0;

function iniciarAjudanteMidia() {
  if (process.platform !== 'win32' || encerrando) return;
  ajudanteMidia = spawn('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', caminhoScriptMidia(),
  ], { windowsHide: true });

  let buffer = '';
  ajudanteMidia.stdout.setEncoding('utf8');
  ajudanteMidia.stdout.on('data', (pedaco) => {
    buffer += pedaco;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!linha.startsWith('{')) continue;
      try {
        const dados = JSON.parse(linha);
        if (dados.tipo === 'osd' || dados.tipo === 'saida') {
          janela?.webContents.send(dados.tipo, dados);
        } else if (dados.tipo === 'sistema') {
          dados.escuro = temaEscuro();
          lancador.atualizarEstadoSistema(dados);
          janela?.webContents.send('sistema', dados);
        } else {
          janela?.webContents.send('midia', dados);
        }
        tentativasMidia = 0;
      } catch { /* linha incompleta ou inválida */ }
    }
  });
  log('Ajudante de mídia iniciado:', caminhoScriptMidia());
  ajudanteMidia.stderr.on('data', (d) => log('[ajudante ERRO]', String(d).trim().slice(0, 800)));
  ajudanteMidia.on('error', (e) => log('[ajudante falhou ao abrir]', e.message));
  ajudanteMidia.on('exit', (codigo) => {
    log('Ajudante de mídia encerrou, código', codigo);
    ajudanteMidia = null;
    if (encerrando) return;
    tentativasMidia += 1;
    const espera = Math.min(30000, 1000 * 2 ** tentativasMidia);
    setTimeout(iniciarAjudanteMidia, espera);
  });
}

function comandoMidia(cmd, vezes = 1) {
  const validos = ['toggle', 'next', 'prev', 'volup', 'voldown', 'mute'];
  if (!validos.includes(cmd) || !ajudanteMidia) return false;
  for (let i = 0; i < Math.min(vezes, 20); i++) ajudanteMidia.stdin.write(cmd + '\n');
  return true;
}

// Controles do sistema (volume exato, brilho, Wi-Fi, Bluetooth, mudo)
const pendentes = {};
const timersSistema = {};
function enviarSistema(cmd) {
  cmd = String(cmd);
  const ok = /^(vol \d{1,3}|brilho( (wmi|\d{1,2}\.\d{1,2}))? \d{1,3}|(wifi|bt|mudo) (on|off|toggle)|estado)$/.test(cmd);
  if (!ok || !ajudanteMidia) return false;
  const partes = cmd.split(' ');
  // cada tela tem a sua fila: mexer numa não atrasa a outra
  const tipo = partes[0] === 'brilho' ? 'brilho:' + (partes.length === 3 ? partes[1] : 'principal') : partes[0];
  if (tipo === 'vol' || tipo.startsWith('brilho')) {
    // Ao arrastar a barra: guarda só o último valor e envia em ritmo controlado
    pendentes[tipo] = cmd;
    if (!timersSistema[tipo]) {
      const enviar = () => {
        if (pendentes[tipo]) {
          ajudanteMidia?.stdin.write(pendentes[tipo] + '\n');
          pendentes[tipo] = null;
          timersSistema[tipo] = setTimeout(enviar, tipo === 'vol' ? 70 : 180);
        } else {
          timersSistema[tipo] = null;
        }
      };
      enviar();
    }
    return true;
  }
  ajudanteMidia.stdin.write(cmd + '\n');
  return true;
}

// Modo escuro/claro do Windows (registro do usuário)
const CHAVE_TEMA = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
function temaEscuro() {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync('reg.exe', ['query', CHAVE_TEMA, '/v', 'AppsUseLightTheme'], { encoding: 'utf8', windowsHide: true });
    return /0x0\b/.test(out);
  } catch { return null; }
}
function alternarTema() {
  const escuro = !temaEscuro();
  const valor = escuro ? '0' : '1';
  for (const nome of ['AppsUseLightTheme', 'SystemUsesLightTheme']) {
    try { execFileSync('reg.exe', ['add', CHAVE_TEMA, '/v', nome, '/t', 'REG_DWORD', '/d', valor, '/f'], { windowsHide: true }); } catch { /* ignora */ }
  }
  log('Tema:', escuro ? 'escuro' : 'claro');
  setTimeout(() => enviarSistema('estado'), 300);
  return escuro;
}

const EXTRAS_LANCADOR = {
  copiar: (t) => clipboard.writeText(t),
  claude: (t) => shell.openExternal('claude://claude.ai/new?q=' + encodeURIComponent(String(t).slice(0, 2000)))
    .catch(() => shell.openExternal('https://claude.ai/new?q=' + encodeURIComponent(t))),
  alternarTema,
};

// ---------------------------------------------------------------------------
// Ações do sistema (lista fechada: a voz só aciona o que está aqui)
// ---------------------------------------------------------------------------
const APPS = {
  calculadora: 'calc',
  'bloco de notas': 'notepad',
  notas: 'notepad',
  explorador: 'explorer',
  arquivos: 'explorer',
  pastas: 'explorer',
  configuracoes: 'ms-settings:',
  armazenamento: 'ms-settings:storagesense',
  energia: 'ms-settings:powersleep',
  'gerenciador de tarefas': 'taskmgr',
  terminal: 'wt',
  paint: 'mspaint',
  spotify: 'spotify:',
  whatsapp: 'whatsapp:',
  navegador: 'https://www.google.com',
  chrome: 'chrome',
  edge: 'microsoft-edge:',
  youtube: 'https://www.youtube.com',
  email: 'mailto:',
};

function abrirNoWindows(alvo) {
  if (/^https?:\/\//.test(alvo)) return shell.openExternal(alvo);
  if (process.platform !== 'win32') return null;
  // "start" resolve tanto executáveis (calc) quanto protocolos (ms-settings:)
  spawn('cmd.exe', ['/c', 'start', '""', alvo], { windowsHide: true, detached: true }).unref();
  return null;
}

function executarAcao(acao) {
  switch (acao?.tipo) {
    case 'midia':
      if (acao.cmd === 'seek') {
        const seg = Number(acao.valor);
        if (!Number.isFinite(seg) || seg < 0 || seg > 86400 || !ajudanteMidia) return false;
        ajudanteMidia.stdin.write(`seek ${seg.toFixed(1)}\n`);
        return true;
      }
      return comandoMidia(acao.cmd, acao.vezes);
    case 'abrirApp':
      if (typeof acao.appId !== 'string' || acao.appId.length > 400 || /[\r\n"]/.test(acao.appId)) return false;
      spawn('explorer.exe', ['shell:AppsFolder\\' + acao.appId], { detached: true, windowsHide: true }).unref();
      return true;
    case 'abrirArquivo':
    case 'mostrarNaPasta': {
      const alvo = String(acao.caminho || '');
      if (!path.isAbsolute(alvo) || !fs.existsSync(alvo)) return false;
      if (acao.tipo === 'abrirArquivo') shell.openPath(alvo); else shell.showItemInFolder(alvo);
      return true;
    }
    case 'sistema':
      if (['wifi', 'bt', 'mudo'].includes(acao.id) && ['on', 'off'].includes(acao.valor)) {
        return enviarSistema(`${acao.id} ${acao.valor}`);
      }
      return lancador.executarSistema(acao.id, acao.valor, enviarSistema, EXTRAS_LANCADOR);
    case 'abrirBusca':
      setTimeout(abrirLancador, 50);
      return true;
    case 'abrir': {
      const alvo = APPS[acao.app];
      if (!alvo) return false;
      abrirNoWindows(alvo);
      return true;
    }
    case 'pesquisar':
      shell.openExternal('https://www.google.com/search?q=' + encodeURIComponent(acao.termo));
      return true;
    case 'youtube':
      shell.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(acao.termo));
      return true;
    case 'bloquear':
      if (process.platform === 'win32') {
        spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true }).unref();
      }
      return true;
    case 'captura':
      abrirNoWindows('ms-screenclip:');
      return true;
    case 'esconder':
      alternarVisibilidade(false);
      return true;
    case 'claude': {
      // Link oficial do Claude Desktop: abre um chat novo com a pergunta preenchida
      const texto = String(acao.texto || '').slice(0, 2000);
      shell.openExternal('claude://claude.ai/new?q=' + encodeURIComponent(texto))
        .catch(() => shell.openExternal('https://claude.ai/new?q=' + encodeURIComponent(texto)));
      return true;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Janela da ilha
// ---------------------------------------------------------------------------
function posicionarJanela() {
  if (!janela) return;
  const tela = screen.getPrimaryDisplay();
  const area = tela.workArea;
  // Responsivo: em telas estreitas a janela encolhe junto
  const largura = Math.round(Math.min(JANELA.largura, area.width * 0.9));
  const x = Math.round(area.x + (area.width - largura) / 2);
  const y = tela.bounds.y;
  janela.setBounds({ x, y, width: largura, height: JANELA.altura });
  janela.webContents.send('tela', {
    largura: area.width,
    altura: area.height,
    escala: tela.scaleFactor,
  });
}

function criarJanela() {
  janela = new BrowserWindow({
    width: JANELA.largura,
    height: JANELA.altura,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false, // não rouba o foco do app que você está usando
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.setVisibleOnAllWorkspaces(true);
  janela.setIgnoreMouseEvents(true, { forward: true });
  janela.loadURL(`http://127.0.0.1:${PORTA}/`);
  janela.once('ready-to-show', () => {
    posicionarJanela();
    janela.showInactive();
  });
  janela.webContents.on('did-finish-load', () => {
    janela.webContents.send('config', config);
    posicionarJanela();
  });
  // Links nunca abrem dentro da ilha
  janela.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janela.webContents.on('will-navigate', (e) => e.preventDefault());
}

function alternarVisibilidade(forcar) {
  if (!janela) return;
  if (ocultaPorJogo && typeof forcar !== 'boolean') {
    // Ctrl+Alt+I durante o jogo: mostra só até o jogo fechar
    mostrarMesmoEmJogo = !mostrarMesmoEmJogo;
    aplicarVisibilidadeReal();
    return;
  }
  visivel = typeof forcar === 'boolean' ? forcar : !visivel;
  aplicarVisibilidadeReal();
  atualizarMenuBandeja();
}

function aplicarVisibilidadeReal() {
  if (!janela) return;
  const mostrar = visivel && (!ocultaPorJogo || mostrarMesmoEmJogo);
  if (mostrar) {
    janela.showInactive();
    janela.setAlwaysOnTop(true, 'screen-saver');
  } else {
    if (lancadorAberto) fecharLancador();
    janela.hide();
  }
}

// Abre/fecha o painel completo (atalho opcional ou menu do ícone)
function alternarPainel() {
  if (!janela) return;
  if (!visivel) alternarVisibilidade(true);
  janela.webContents.send('painel:alternar');
}

function definirJogo(ativo, motivo) {
  if (ativo === ocultaPorJogo) return;
  ocultaPorJogo = ativo;
  jogoAtual = ativo ? motivo : '';
  if (!ativo) mostrarMesmoEmJogo = false;
  log(ativo ? `Jogo detectado: ${motivo} — ilha escondida` : 'Jogo fechado — ilha de volta');
  aplicarVisibilidadeReal();
  atualizarMenuBandeja();
}

// ---------------------------------------------------------------------------
// Barra de busca: a ilha passa a aceitar teclado enquanto está aberta
// ---------------------------------------------------------------------------
let lancadorAberto = false;

function abrirLancador() {
  if (!janela) return;
  if (lancadorAberto) { fecharLancador(); return; } // o mesmo atalho fecha
  if (!visivel) alternarVisibilidade(true);
  lancadorAberto = true;
  janela.setFocusable(true);
  janela.setIgnoreMouseEvents(false);
  janela.show();
  janela.focus();
  janela.webContents.focus();
  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.webContents.send('lancador:abrir');
  enviarSistema('estado');
}

function fecharLancador() {
  if (!janela || !lancadorAberto) return;
  lancadorAberto = false;
  janela.webContents.send('lancador:fechar');
  janela.setFocusable(false);
  janela.setIgnoreMouseEvents(true, { forward: true });
  janela.blur();
  janela.setAlwaysOnTop(true, 'screen-saver');
}

// ---------------------------------------------------------------------------
// Atalhos de teclado (podem ser trocados nas configurações)
// ---------------------------------------------------------------------------
function registrarAtalhos() {
  globalShortcut.unregisterAll();
  const erros = {};
  const tentar = (nome, atalho, acao) => {
    if (!atalho) return null;
    try {
      if (globalShortcut.register(atalho, acao)) return atalho;
    } catch { /* formato inválido */ }
    erros[nome] = `"${atalho}" já está em uso por outro programa ou é inválido`;
    return null;
  };
  const foraDeJogo = (fn) => () => { if (!ocultaPorJogo || mostrarMesmoEmJogo) fn(); };
  tentar('atalhoVoz', config.atalhoVoz, foraDeJogo(() => janela?.webContents.send('voz:ativar')));
  tentar('atalhoMostrar', config.atalhoMostrar, () => alternarVisibilidade());
  atalhoBuscaAtivo = tentar('atalhoBusca', config.atalhoBusca, foraDeJogo(abrirLancador));
  tentar('atalhoPainel', config.atalhoPainel, foraDeJogo(alternarPainel));
  if (!atalhoBuscaAtivo && config.atalhoBusca === CONFIG_PADRAO.atalhoBusca) {
    atalhoBuscaAtivo = tentar('atalhoBusca2', 'Control+Alt+P', foraDeJogo(abrirLancador));
    if (atalhoBuscaAtivo) delete erros.atalhoBusca;
  }
  log('Atalhos:', config.atalhoVoz, '|', config.atalhoMostrar, '| busca:', atalhoBuscaAtivo || 'nenhum', Object.keys(erros).length ? JSON.stringify(erros) : '');
  atualizarMenuBandeja();
  return erros;
}

// ---------------------------------------------------------------------------
// Teclado sob demanda: a ilha só "pega" o teclado quando você clica num campo
// ---------------------------------------------------------------------------
let tecladoAtivo = false;
function ativarTeclado(sim) {
  if (!janela) return;
  if (sim) {
    tecladoAtivo = true;
    janela.setFocusable(true);
    janela.setIgnoreMouseEvents(false);
    janela.focus();
    janela.webContents.focus();
  } else if (tecladoAtivo) {
    tecladoAtivo = false;
    janela.webContents.send('teclado:fim');
    if (!lancadorAberto) {
      janela.setFocusable(false);
      janela.blur();
    }
    janela.setAlwaysOnTop(true, 'screen-saver');
  }
}

// ---------------------------------------------------------------------------
// Dados dos widgets (tarefas, eventos, notas...) — salvos em dados.json
// ---------------------------------------------------------------------------
const CHAVES_DADOS = ['tarefas', 'eventos', 'notas', 'foco', 'paginaAtual', 'bandeja', 'dock', 'silenciouNotif', 'versaoAnterior'];
let dados = {};
try { dados = JSON.parse(fs.readFileSync(ARQ_DADOS, 'utf8')); } catch { dados = {}; }
let tSalvarDados = null;
function salvarDados(chave, valor) {
  if (!CHAVES_DADOS.includes(chave)) return false;
  dados[chave] = valor;
  clearTimeout(tSalvarDados);
  // a marca de "notificações pausadas" precisa ir para o disco na hora (a ilha pode estar fechando)
  tSalvarDados = setTimeout(gravarDados, chave === 'silenciouNotif' ? 0 : 300);
  if (chave === 'silenciouNotif') gravarDados();
  return true;
}
function gravarDados() {
  try {
    fs.mkdirSync(DIR_DADOS, { recursive: true });
    fs.writeFileSync(ARQ_DADOS + '.tmp', JSON.stringify(dados));
    fs.renameSync(ARQ_DADOS + '.tmp', ARQ_DADOS);
  } catch (e) { log('Erro ao salvar dados:', e.message); }
}


// ---------------------------------------------------------------------------
// Foco: pausa os banners de notificação do Windows e devolve como estavam
// ---------------------------------------------------------------------------
function silenciarNoFoco(sim) {
  if (process.platform !== 'win32') return;
  if (sim) {
    if (config.focoSilencia === false || dados.silenciouNotif) return;
    if (!servicos.notificacoesLigadas()) return; // você já tinha desligado: não mexe
    if (servicos.definirNotificacoes(false)) salvarDados('silenciouNotif', true);
  } else if (dados.silenciouNotif) {
    servicos.definirNotificacoes(true);
    salvarDados('silenciouNotif', false);
  }
}

// ---------------------------------------------------------------------------
// Clima (Open-Meteo: grátis e sem chave)
// ---------------------------------------------------------------------------
const cacheCidades = new Map();
async function buscarClima() {
  try {
    const nome = String(config.cidade || 'Niterói').trim();
    let local = cacheCidades.get(nome);
    if (!local) {
      const g = await (await net.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&name=${encodeURIComponent(nome)}`)).json();
      const r = g?.results?.[0];
      if (!r) return { ok: false, erro: `cidade "${nome}" não encontrada` };
      local = { lat: r.latitude, lon: r.longitude, nome: r.name };
      cacheCidades.set(nome, local);
    }
    const url = 'https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=7'
      + `&latitude=${local.lat}&longitude=${local.lon}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code'
      + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m,relative_humidity_2m,is_day'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,'
      + 'wind_speed_10m_max,uv_index_max,sunrise,sunset';
    const f = await (await net.fetch(url)).json();
    if (!f?.current) return { ok: false, erro: 'resposta inválida' };
    return { ok: true, cidade: local.nome, atual: f.current, diario: f.daily, horario: f.hourly };
  } catch (e) {
    return { ok: false, erro: 'sem internet' };
  }
}

// ---------------------------------------------------------------------------
// Histórico da área de transferência (só na memória, nunca salvo em disco)
// ---------------------------------------------------------------------------
let copiados = [];
let ultimoCopiado = '';
function vigiarCopiados() {
  setInterval(() => {
    if (config.historicoCopiados === false) return;
    let t = '';
    try { t = clipboard.readText(); } catch { return; }
    if (!t || t === ultimoCopiado) return;
    ultimoCopiado = t;
    if (!t.trim() || t.length > 10000) return;
    copiados = [t, ...copiados.filter((x) => x !== t)].slice(0, 25);
    janela?.webContents.send('copiados', copiados);
  }, 1000);
}

// ---------------------------------------------------------------------------
// Monitor do sistema
// ---------------------------------------------------------------------------
let cpuAnterior = os.cpus();
function recursos() {
  const agora = os.cpus();
  let ocioso = 0; let total = 0;
  agora.forEach((c, i) => {
    const a = cpuAnterior[i]?.times || c.times;
    const t = c.times;
    const tt = (t.user - a.user) + (t.nice - a.nice) + (t.sys - a.sys) + (t.irq - a.irq) + (t.idle - a.idle);
    total += tt; ocioso += t.idle - a.idle;
  });
  cpuAnterior = agora;
  let discoTotal = 0; let discoUsado = 0;
  try {
    const st = fs.statfsSync(process.platform === 'win32' ? 'C:\\' : '/');
    discoTotal = st.blocks * st.bsize;
    discoUsado = discoTotal - st.bavail * st.bsize;
  } catch { /* sem informação de disco */ }
  return {
    cpu: total ? Math.round(100 * (1 - ocioso / total)) : 0,
    nucleos: agora.length,
    ramTotal: os.totalmem(),
    ramUsada: os.totalmem() - os.freemem(),
    discoTotal,
    discoUsado,
    uptime: os.uptime(),
  };
}

// ---------------------------------------------------------------------------
// Janela de configurações
// ---------------------------------------------------------------------------
let janelaConfig = null;
function abrirConfiguracoes() {
  if (janelaConfig) { janelaConfig.show(); janelaConfig.focus(); return; }
  janelaConfig = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 520,
    minHeight: 480,
    title: 'Ilha Dinâmica — Configurações',
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0d',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  janelaConfig.loadURL(`http://127.0.0.1:${PORTA}/configuracoes.html`);
  janelaConfig.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  janelaConfig.on('closed', () => { janelaConfig = null; });
}

const VALIDADORES = {
  corOlhos: (v) => /^#[0-9a-f]{6}$/i.test(v), corRelogio: (v) => /^#[0-9a-f]{6}$/i.test(v), corDestaque: (v) => /^#[0-9a-f]{6}$/i.test(v),
  fundo: (v) => ['preto', 'grafite', 'translucido'].includes(v),
  tamanho: (v) => typeof v === 'number' && v >= 0.8 && v <= 1.3,
  relogio24h: (v) => typeof v === 'boolean', mostrarSegundos: (v) => typeof v === 'boolean',
  mostrarOlhos: (v) => typeof v === 'boolean', formatoOlhos: (v) => ['pilula', 'redondo'].includes(v),
  abrirAoPassar: (v) => typeof v === 'boolean', atrasoAbrir: (v) => Number.isInteger(v) && v >= 0 && v <= 2000,
  modoNotch: (v) => typeof v === 'boolean', modoMini: (v) => typeof v === 'boolean',
  widgets: (v) => Array.isArray(v) && v.every((x) => CONFIG_PADRAO.widgets.includes(x)),
  cidade: (v) => typeof v === 'string' && v.length <= 80,
  focoMin: (v) => Number.isInteger(v) && v >= 1 && v <= 180,
  pausaMin: (v) => Number.isInteger(v) && v >= 1 && v <= 60,
  pausaLongaMin: (v) => Number.isInteger(v) && v >= 1 && v <= 120,
  focoAuto: (v) => typeof v === 'boolean', historicoCopiados: (v) => typeof v === 'boolean',
  esconderEmJogos: (v) => typeof v === 'boolean',
  agendasIcs: (v) => Array.isArray(v) && v.length <= 3 && v.every((x) => typeof x === 'string' && x.length <= 2000 && /^(https|webcal):\/\//i.test(x)),
  focoSilencia: (v) => typeof v === 'boolean',
  modoDiscreto: (v) => ['abas', 'sempre', 'nunca'].includes(v),
  appsComAbas: (v) => Array.isArray(v) && v.length <= 80 && v.every((x) => typeof x === 'string' && /^[^\\/:*?"<>|]{1,80}\.exe$/i.test(x)),
  jogosExtras: (v) => Array.isArray(v) && v.length <= 60 && v.every((x) => typeof x === 'string' && /^[^\\/:*?"<>|]{1,80}\.exe$/i.test(x)),
  naoJogos: (v) => Array.isArray(v) && v.length <= 60 && v.every((x) => typeof x === 'string' && /^[^\\/:*?"<>|]{1,80}\.exe$/i.test(x)),
  escutaContinua: (v) => typeof v === 'boolean', respostaFalada: (v) => typeof v === 'boolean',
  iniciarComWindows: (v) => typeof v === 'boolean',
  palavraAtivacao: (v) => typeof v === 'string' && /^[a-zà-ú]{2,20}$/i.test(v),
  atalhoVoz: (v) => typeof v === 'string' && v.length <= 40,
  atalhoMostrar: (v) => typeof v === 'string' && v.length <= 40,
  atalhoBusca: (v) => typeof v === 'string' && v.length <= 40,
  atalhoPainel: (v) => typeof v === 'string' && v.length <= 40,
};

function salvarConfigParcial(parcial) {
  const anterior = { ...config };
  const ignorados = [];
  for (let [k, v] of Object.entries(parcial || {})) {
    if (k === 'restaurar') continue;
    if (k === 'jogosExtras' || k === 'naoJogos' || k === 'appsComAbas') v = Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim().toLowerCase()))] : v;
    if (VALIDADORES[k]?.(v)) config[k] = v; else ignorados.push(k);
  }
  if (parcial?.restaurar) config = { ...CONFIG_PADRAO, iniciarComWindows: config.iniciarComWindows };
  let erros = {};
  const mudouAtalho = ['atalhoVoz', 'atalhoMostrar', 'atalhoBusca', 'atalhoPainel'].some((k) => config[k] !== anterior[k]);
  if (mudouAtalho) {
    erros = registrarAtalhos();
    // atalho recusado: volta ao anterior
    for (const k of ['atalhoVoz', 'atalhoMostrar', 'atalhoBusca', 'atalhoPainel']) {
      if (erros[k] && config[k] !== anterior[k]) config[k] = anterior[k];
    }
    if (Object.keys(erros).length) registrarAtalhos();
  }
  if (config.iniciarComWindows !== anterior.iniciarComWindows) aplicarInicioAutomatico();
  if (JSON.stringify(config.agendasIcs) !== JSON.stringify(anterior.agendasIcs)) janela?.webContents.send('agendas:recarregar');
  salvarConfig();
  janelaConfig?.webContents.send('config', config);
  atualizarMenuBandeja();
  return { ok: true, config, erros, ignorados, atalhoBuscaAtivo };
}

// ---------------------------------------------------------------------------
// Atualização automática (só no app instalado): baixa do GitHub e instala ao fechar
// ---------------------------------------------------------------------------
let atualizador = null;
let atualizacaoPronta = null; // versão baixada esperando para instalar
function iniciarAtualizacoes() {
  if (!app.isPackaged) return; // na versão de desenvolvimento não há o que atualizar
  try { ({ autoUpdater: atualizador } = require('electron-updater')); } catch (e) { log('Atualizador indisponível:', e.message); return; }
  atualizador.autoDownload = true;
  atualizador.autoInstallOnAppQuit = true;
  atualizador.on('update-available', (i) => {
    log('Nova versão encontrada:', i.version, '— baixando');
    janela?.webContents.send('atualizacao', { fase: 'baixando', versao: i.version, notas: notasDe(i.releaseNotes) });
  });
  atualizador.on('update-downloaded', (i) => {
    atualizacaoPronta = i.version;
    log('Nova versão pronta para instalar:', i.version);
    janela?.webContents.send('atualizacao', { fase: 'pronta', versao: i.version, notas: notasDe(i.releaseNotes) });
    atualizarMenuBandeja();
  });
  atualizador.on('error', (e) => log('Atualização: falhou ao verificar/baixar —', String(e?.message || e).slice(0, 200)));
  const verificar = () => atualizador.checkForUpdates().catch(() => {});
  setTimeout(verificar, 15000);
  setInterval(verificar, 4 * 60 * 60 * 1000);
}
// Notas da versão (texto/HTML do GitHub) -> lista de itens curtos
function notasDe(texto) {
  if (Array.isArray(texto)) texto = texto.map((n) => n?.note || '').join('\n');
  return String(texto || '')
    .replace(/<\/(li|p|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .split(/\r?\n/).map((l) => l.replace(/^[\s*•-]+/, '').trim())
    .filter((l) => l && !/^#/.test(l)).slice(0, 8);
}

// Primeira vez abrindo uma versão nova: avisa na ilha com o que mudou
function avisarSeAtualizou() {
  const atual = app.getVersion();
  const anterior = dados.versaoAnterior;
  if (anterior === atual) return;
  salvarDados('versaoAnterior', atual);
  // sem versão anterior registrada: só é atualização se a ilha já tinha sido usada (versões até 4.1.1)
  if (!anterior && dados.paginaAtual === undefined) return;
  let notas = [];
  try { notas = notasDe(fs.readFileSync(path.join(__dirname, '..', 'build', 'release-notes.md'), 'utf8')); } catch { /* sem notas */ }
  log(`Atualizada de ${anterior} para ${atual}`);
  setTimeout(() => janela?.webContents.send('atualizado', { versao: atual, notas }), 4000);
}

function instalarAtualizacaoAgora() {
  if (!atualizador || !atualizacaoPronta) return;
  log('Instalando a versão', atualizacaoPronta);
  encerrando = true;
  atualizador.quitAndInstall(true, true); // silencioso e reabre depois
}

// ---------------------------------------------------------------------------
// Bandeja (ícone perto do relógio)
// ---------------------------------------------------------------------------
function atualizarMenuBandeja() {
  if (!bandeja) return;
  const alternar = (chave) => () => {
    config[chave] = !config[chave];
    if (chave === 'iniciarComWindows') aplicarInicioAutomatico();
    salvarConfig();
    atualizarMenuBandeja();
  };
  bandeja.setContextMenu(Menu.buildFromTemplate([
    ...(atualizacaoPronta ? [{ label: `⬆ Atualizar para a versão ${atualizacaoPronta} agora`, click: instalarAtualizacaoAgora }, { type: 'separator' }] : []),
    { label: visivel ? 'Esconder ilha' : 'Mostrar ilha', click: () => alternarVisibilidade() },
    { label: 'Abrir o painel', click: alternarPainel },
    { label: 'Falar comando  (Ctrl+Alt+Espaço)', click: () => janela?.webContents.send('voz:ativar') },
    { label: `Buscar  (${atalhoBuscaAtivo || 'sem atalho'})`, click: abrirLancador },
    { type: 'separator' },
    { label: 'Escuta contínua ("ilha, ...")', type: 'checkbox', checked: config.escutaContinua, click: alternar('escutaContinua') },
    { label: 'Responder em voz', type: 'checkbox', checked: config.respostaFalada, click: alternar('respostaFalada') },
    { label: 'Iniciar com o Windows', type: 'checkbox', checked: config.iniciarComWindows, click: alternar('iniciarComWindows') },
    { type: 'separator' },
    { label: 'Sumir durante jogos', type: 'checkbox', checked: config.esconderEmJogos !== false, click: alternar('esconderEmJogos') },
    ...menuJogos(),
    ...menuAbas(),
    { type: 'separator' },
    { label: 'Configurações…', click: abrirConfiguracoes },
    { label: 'Abrir pasta de dados', click: () => shell.openPath(DIR_DADOS) },
    { label: 'Sair', click: () => app.quit() },
  ]));
}

function menuJogos() {
  const itens = [];
  const nome = ultimoAppGrande;
  if (!nome || config.esconderEmJogos === false) return itens;
  const ehExtra = (config.jogosExtras || []).includes(nome.toLowerCase());
  const ehNao = (config.naoJogos || []).includes(nome.toLowerCase());
  if (ocultaPorJogo && !ehExtra) {
    itens.push({ label: `"${nome}" não é jogo (mostrar a ilha)`, click: () => marcarJogo(nome, false) });
  } else if (!ocultaPorJogo && !ehNao) {
    itens.push({ label: `Tratar "${nome}" como jogo`, click: () => marcarJogo(nome, true) });
  }
  if (ehExtra || ehNao) {
    itens.push({ label: `Desfazer marcação de "${nome}"`, click: () => marcarJogo(nome, null) });
  }
  return itens;
}

function menuAbas() {
  const nome = ultimoAppGrande;
  if (!nome || config.modoDiscreto !== 'abas') return [];
  const n = nome.toLowerCase();
  const tem = (config.appsComAbas || []).includes(n);
  return [{
    label: tem ? `"${nome}": ilha normal (sem modo discreto)` : `"${nome}" tem abas no topo: modo discreto`,
    click: () => {
      config.appsComAbas = tem ? config.appsComAbas.filter((x) => x !== n) : [...(config.appsComAbas || []), n];
      log('Apps com abas:', tem ? `removido ${n}` : `adicionado ${n}`);
      salvarConfig();
      janelaConfig?.webContents.send('config', config);
      atualizarMenuBandeja();
    },
  }];
}

function marcarJogo(nome, ehJogo) {
  const n = nome.toLowerCase();
  config.jogosExtras = (config.jogosExtras || []).filter((x) => x !== n);
  config.naoJogos = (config.naoJogos || []).filter((x) => x !== n);
  if (ehJogo === true) config.jogosExtras.push(n);
  if (ehJogo === false) config.naoJogos.push(n);
  log('Marcação de jogo:', n, ehJogo === true ? 'é jogo' : ehJogo === false ? 'não é jogo' : 'removida');
  salvarConfig();
  janelaConfig?.webContents.send('config', config);
  atualizarMenuBandeja();
}

function criarBandeja() {
  bandeja = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  bandeja.setToolTip(`Ilha Dinâmica v${VERSAO}`);
  bandeja.on('click', () => alternarVisibilidade());
  atualizarMenuBandeja();
}

function aplicarInicioAutomatico() {
  if (process.platform !== 'win32') return;
  // Sem instalador, o electron.exe precisa receber a pasta do app como argumento
  const args = app.isPackaged ? [] : [app.getAppPath()];
  app.setLoginItemSettings({ openAtLogin: config.iniciarComWindows, path: process.execPath, args });
}

// ---------------------------------------------------------------------------
// IPC com a interface
// ---------------------------------------------------------------------------
ipcMain.on('interativo', (_e, sim) => {
  janela?.setIgnoreMouseEvents(!sim, { forward: true });
});
ipcMain.handle('acao', (_e, acao) => executarAcao(acao));
ipcMain.handle('lancador:buscar', (_e, texto) => lancador.buscar(texto));
ipcMain.handle('lancador:executar', (_e, id) => {
  const r = lancador.executar(id, enviarSistema, EXTRAS_LANCADOR);
  fecharLancador();
  return r;
});
ipcMain.handle('lancador:icone', (_e, caminho) => lancador.icone(caminho));
ipcMain.on('lancador:fechar', () => fecharLancador());
ipcMain.on('sistema', (_e, cmd) => enviarSistema(cmd));
ipcMain.on('teclado', (_e, sim) => ativarTeclado(!!sim));
ipcMain.on('erro-interface', (_e, msg) => log('[ERRO interface]', String(msg).slice(0, 600)));
ipcMain.handle('agendas', () => servicos.buscarAgendas(config.agendasIcs || []));
ipcMain.handle('apps:listar', () => lancador.listarApps());
ipcMain.on('foco:silenciar', (_e, sim) => silenciarNoFoco(!!sim));
ipcMain.on('atualizar:agora', () => instalarAtualizacaoAgora());
// Arrastar um arquivo da bandeja da ilha para outro app
ipcMain.on('arrastar', async (e, caminho) => {
  caminho = String(caminho || '');
  if (!path.isAbsolute(caminho) || !fs.existsSync(caminho)) return;
  let icone = null;
  try { icone = await app.getFileIcon(caminho, { size: 'normal' }); } catch { /* usa o padrão */ }
  if (!icone || icone.isEmpty()) icone = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  try { e.sender.startDrag({ file: caminho, icon: icone }); } catch (erro) { log('Falha ao arrastar:', erro.message); }
});
ipcMain.handle('dados:ler', () => dados);
ipcMain.handle('dados:salvar', (_e, chave, valor) => salvarDados(chave, valor));
ipcMain.handle('clima', () => buscarClima());
ipcMain.handle('recursos', () => recursos());
ipcMain.on('copiar', (_e, t) => { ultimoCopiado = String(t); clipboard.writeText(String(t)); });
ipcMain.on('copiados:limpar', () => { copiados = []; });
ipcMain.on('configuracoes:abrir', () => abrirConfiguracoes());
ipcMain.handle('config:salvar', (_e, parcial) => salvarConfigParcial(parcial));
ipcMain.handle('config:padrao', () => CONFIG_PADRAO);
ipcMain.handle('tema:alternar', () => alternarTema());
ipcMain.handle('config:ler', () => config);
ipcMain.handle('modelo:garantir', async () => {
  try {
    await garantirModelo();
    return { ok: true, url: `http://127.0.0.1:${PORTA}/modelo/modelo.tar.gz` };
  } catch (erro) {
    return { ok: false, erro: erro.message, pasta: DIR_MODELO };
  }
});

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
app.setAppUserModelId('br.raphael.ilhadinamica');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(async () => {
    // Libera o microfone só para a nossa própria página local
    const origem = `http://127.0.0.1:${PORTA}`;
    session.defaultSession.setPermissionRequestHandler((wc, permissao, callback) => {
      callback(permissao === 'media' && wc.getURL().startsWith(origem));
    });
    session.defaultSession.setPermissionCheckHandler((_wc, permissao, origemReq) =>
      permissao === 'media' && String(origemReq).startsWith(origem));

    try {
      await iniciarServidor();
    } catch (erro) {
      console.error(`Porta ${PORTA} ocupada. Outra cópia já está aberta?`, erro);
      app.quit();
      return;
    }

    log(`==== Ilha Dinâmica v${VERSAO} iniciada ====`);
    criarJanela();
    criarBandeja();
    aplicarInicioAutomatico();
    iniciarAjudanteMidia();

    registrarAtalhos();
    janela.on('blur', () => {
      if (lancadorAberto) fecharLancador();
      if (tecladoAtivo) ativarTeclado(false);
    });
    vigiarCopiados();
    servicos.configurarLog(log);
    iniciarAtualizacoes();
    janela.webContents.once('did-finish-load', avisarSeAtualizou);
    if (dados.silenciouNotif) silenciarNoFoco(false); // a ilha fechou no meio de um foco: devolve as notificações
    servicos.vigiarDownloads((d) => janela?.webContents.send('download', d));
    servicos.vigiarPrivacidade((p) => janela?.webContents.send('privacidade', p));
    lancador.definirCotacoes(servicos.lerCotacoes);
    servicos.atualizarCotacoes();
    setInterval(() => servicos.atualizarCotacoes(), 60 * 60 * 1000);
    lancador.iniciar(log);

    // Manda a posição do mouse para os olhinhos seguirem (só quando muda)
    let ultimoCursor = '';
    setInterval(() => {
      if (!janela || !visivel || (ocultaPorJogo && !mostrarMesmoEmJogo)) return;
      const p = screen.getCursorScreenPoint();
      const b = janela.getBounds();
      const pos = { x: p.x - b.x, y: p.y - b.y, botao: janelasWin.botaoMouseApertado() };
      const chave = pos.x + ',' + pos.y + (pos.botao ? 'b' : '');
      if (chave === ultimoCursor) return;
      ultimoCursor = chave;
      janela.webContents.send('cursor', pos);
    }, 60);

    // Modo da ilha conforme o app em primeiro plano: normal | maximizada | cheia
    if (janelasWin.iniciar(log, janela.getNativeWindowHandle())) {
      let modoAtual = 'normal';
      let jogoDesde = 0;
      let semJogoDesde = 0;
      jogos.carregarGameBar(log);
      setInterval(() => jogos.carregarGameBar(), 10 * 60 * 1000);
      setInterval(() => {
        let info = null;
        try { info = janelasWin.estadoPrimeiroPlano(); } catch (e) { log('Erro no detector:', e.message); }
        if (!info) return;

        // Jogo aberto? Some depois de 0,5 s; volta 1,5 s depois de sair (evita piscar em telas de carregamento)
        const { jogo, motivo } = config.esconderEmJogos === false ? { jogo: false } : jogos.ehJogo(info, config);
        const agora = Date.now();
        if (jogo) {
          semJogoDesde = 0;
          jogoDesde = jogoDesde || agora;
          if (!ocultaPorJogo && agora - jogoDesde >= 500) definirJogo(true, motivo);
        } else {
          jogoDesde = 0;
          semJogoDesde = semJogoDesde || agora;
          if (ocultaPorJogo && agora - semJogoDesde >= 1500) definirJogo(false);
        }
        const nomeApp = info.exe ? path.win32.basename(info.exe) : '';
        if (nomeApp && info.modo !== 'normal' && nomeApp !== ultimoAppGrande) {
          ultimoAppGrande = nomeApp;
          atualizarMenuBandeja();
        }

        // Maximizado + app com abas = modo discreto (tracinho)
        let modo = info.modo;
        if (modo === 'maximizada') {
          const comAbas = (config.appsComAbas || []).includes(nomeApp.toLowerCase());
          if (config.modoDiscreto === 'sempre' || (config.modoDiscreto !== 'nunca' && comAbas)) modo = 'maximizada-abas';
        }
        if (modo === modoAtual) return;
        modoAtual = modo;
        log('Modo:', modo, nomeApp ? `(${nomeApp})` : '');
        janela?.webContents.send('modoApp', modo);
      }, 250);
      janela.webContents.on('did-finish-load', () => janela.webContents.send('modoApp', modoAtual));
    }

    screen.on('display-metrics-changed', posicionarJanela);
    screen.on('display-added', posicionarJanela);
    screen.on('display-removed', posicionarJanela);
  });

  app.on('before-quit', () => {
    encerrando = true;
    if (dados.silenciouNotif) silenciarNoFoco(false);
    globalShortcut.unregisterAll();
    ajudanteMidia?.kill();
    servidor?.close();
  });
  app.on('window-all-closed', () => app.quit());
}
