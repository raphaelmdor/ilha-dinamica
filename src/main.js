// Ilha Dinâmica — processo principal (Electron)
const {
  app, BrowserWindow, screen, ipcMain, globalShortcut, Tray, Menu,
  nativeImage, shell, session, net, clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
// Medidor de desempenho: conta quantos programas a ilha abre (antes de qualquer módulo pegar as funções)
const processosAbertos = {};
{
  const cp = require('child_process');
  for (const nome of ['spawn', 'execFile', 'execFileSync']) {
    const original = cp[nome];
    cp[nome] = function (cmd, ...resto) {
      const exe = path.basename(String(cmd)).toLowerCase();
      processosAbertos[exe] = (processosAbertos[exe] || 0) + 1;
      return original.call(this, cmd, ...resto);
    };
  }
}
const { spawn, execFile, execFileSync } = require('child_process');
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
  tamanho: 1,                     // 0.8 a 2 (80% a 200%)
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
  cidade: '',                     // vazio = descobre a cidade sozinho (pela internet)
  focoMin: 25,
  pausaMin: 5,
  pausaLongaMin: 15,
  focoAuto: false,
  historicoCopiados: true,
  alertaAgenda: 'padrao',         // modelo de alerta dos compromissos: tranquilo | padrao | precavido | pontual
  resumoDoDia: true,              // "Bom dia! Hoje você tem…" no primeiro uso do dia
  // Jogos
  esconderEmJogos: true,
  agendasIcs: [],                 // links iCal da Google Agenda, Apple (iCloud) ou Outlook — só leitura
  focoSilencia: true,             // pausa as notificações do Windows durante o Pomodoro
  // Apps com abas no topo (navegador, VS Code...): a ilha vira um tracinho que não bloqueia cliques
  modoDiscreto: 'abas',           // abas | sempre (todo app maximizado) | nunca
  semDiscreto: ['WhatsApp'],          // títulos de janela que nunca usam o modo discreto
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

// Um erro inesperado não pode virar janela de erro na cara do usuário: registra e segue
process.on('uncaughtException', (e) => log('Erro inesperado (ignorado):', e?.stack || e));
process.on('unhandledRejection', (e) => log('Promessa rejeitada (ignorada):', e?.stack || e));

let config = carregarConfig();
let janela = null;
let bandeja = null;
let servidor = null;
let ajudanteMidia = null;
let visivel = true;
let atalhoBuscaAtivo = null;
let ocultaPorJogo = false;      // sumiu porque um jogo está aberto
let vozEmJogo = false;           // Ctrl+Alt+Espaço durante o jogo: aparece só para o comando de voz
let mostrarMesmoEmJogo = false; // você pediu para mostrar (Ctrl+Alt+I) durante o jogo
let jogoAtual = '';             // motivo/nome do jogo detectado
let ultimoAppGrande = '';       // último app maximizado/tela cheia (para marcar como jogo pelo menu)
let encerrando = false;
let ultimoSons = '';
// Microfone/câmera em uso: o ajudante lê o registro a cada 2 s (antes abria dois reg.exe a cada 2 s)
let ultimaPrivacidade = '';
const IGNORAR_PRIVACIDADE = [path.basename(process.execPath).toLowerCase()]; // a própria ilha (voz) não conta
setInterval(() => { if (ajudanteMidia && !encerrando) escreverAjudante('privacidade'); }, 2000);
// A cada 3 s: quem está tocando som e quem está usando o microfone (para reconhecer chamadas)
setInterval(() => { if (ajudanteMidia && !encerrando) escreverAjudante('sons'); }, 3000);

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
    // 4.4: a cidade antiga padrão vira "automático" (quem digitou outra cidade continua com ela)
    if (!c.migrouLocal) {
      if (c.cidade === 'Niterói') c.cidade = '';
      c.migrouLocal = true;
    }
    return c;
  } catch {
    return { ...CONFIG_PADRAO, migrouV4: true, migrouLocal: true };
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
// Whisper (reconhecimento de voz preciso, offline e grátis): o Vosk percebe quando
// você fala; o áudio do comando vai para o Whisper, que entende muito melhor.
// O programa vem no instalador; o modelo (190 MB) é baixado uma vez.
// ---------------------------------------------------------------------------
const WHISPER_MODELO = 'ggml-small-q5_1.bin';
const WHISPER_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODELO}`;
// O whisper-cli não abre arquivos em caminhos com acento ("Ilha Dinâmica"): fica numa pasta sem acento
const DIR_WHISPER = path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'IlhaDinamica', 'whisper');
const ARQ_WHISPER = path.join(DIR_WHISPER, WHISPER_MODELO);
try {
  const antigo = path.join(DIR_MODELO, WHISPER_MODELO);
  if (fs.existsSync(antigo) && !fs.existsSync(ARQ_WHISPER)) {
    fs.mkdirSync(DIR_WHISPER, { recursive: true });
    fs.renameSync(antigo, ARQ_WHISPER);
  }
} catch { /* baixa de novo se precisar */ }
function exeWhisper() {
  const opcoes = [
    path.join(process.resourcesPath || '', 'whisper', 'whisper-cli.exe'),
    path.join(__dirname, '..', 'build', 'whisper', 'whisper-cli.exe'),
  ];
  return opcoes.find((p) => fs.existsSync(p)) || null;
}
let whisperPronto = false;
let promessaWhisper = null;
function garantirWhisper() {
  if (whisperPronto) return Promise.resolve(true);
  if (process.platform !== 'win32' || !exeWhisper()) return Promise.resolve(false);
  try { if (fs.statSync(ARQ_WHISPER).size > 100 * 1024 * 1024) { whisperPronto = true; return Promise.resolve(true); } } catch { /* baixa */ }
  if (!promessaWhisper) {
    promessaWhisper = (async () => {
      fs.mkdirSync(DIR_WHISPER, { recursive: true });
      log('Whisper: baixando o modelo', WHISPER_MODELO);
      janela?.webContents.send('whisper:status', { fase: 'baixando', progresso: 0 });
      const resp = await net.fetch(WHISPER_URL);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const total = Number(resp.headers.get('content-length')) || 0;
      const parcial = ARQ_WHISPER + '.parcial';
      const saida = fs.createWriteStream(parcial);
      const leitor = resp.body.getReader();
      let recebido = 0; let ultimo = 0;
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        recebido += value.length;
        if (!saida.write(Buffer.from(value))) await new Promise((r) => saida.once('drain', r));
        if (total && Date.now() - ultimo > 1000) {
          ultimo = Date.now();
          janela?.webContents.send('whisper:status', { fase: 'baixando', progresso: recebido / total });
        }
      }
      await new Promise((r, j) => saida.end((e) => (e ? j(e) : r())));
      fs.renameSync(parcial, ARQ_WHISPER);
      whisperPronto = true;
      log('Whisper: modelo pronto');
      janela?.webContents.send('whisper:status', { fase: 'pronto' });
      return true;
    })().catch((e) => {
      log('Whisper: falha ao baixar o modelo', e.message);
      promessaWhisper = null;
      janela?.webContents.send('whisper:status', { fase: 'erro' });
      return false;
    });
  }
  return promessaWhisper;
}

// Dica de vocabulário para o Whisper: comandos e nomes dos apps instalados
function dicaWhisper() {
  const apps = lancador.listarApps().map((a) => a.nome)
    .filter((n) => n.length <= 24 && !/(help|ajuda|uninstall|desinstal|odbc|config|legal|error|reporter|recovery|documents)/i.test(n)).slice(0, 40);
  // O Whisper imita o estilo do texto de contexto: frases curtas de comando, do jeito que se fala
  return 'Ilha, abrir o Google Chrome. Passar a música. Próxima música. Voltar a música. Pausar. Tocar. '
    + 'Aumentar o volume. Volume 50. Brilho 70. Ligar o Wi-Fi. Desligar o Bluetooth. Modo escuro. '
    + 'Timer de 5 minutos. Nova tarefa comprar pão. Anotar ligar pro João. Marcar 14:30 dentista. '
    + 'Pesquisar receita de bolo. Tocar lo-fi no YouTube. Que horas são? Abrir ' + apps.join(', abrir ') + '.';
}

// ---------------------------------------------------------------------------
// Whisper como servidor: fica aberto com o modelo carregado (não recarrega 190 MB a cada comando),
// usa a placa de vídeo quando dá (Vulkan) e processa só o tamanho da frase (não 30 s fixos).
// Liga quando você começa a falar e desliga sozinho depois de 10 min sem uso.
// ---------------------------------------------------------------------------
let servidorWhisper = null; // { proc, porta, tipo: 'gpu'|'cpu', pronto: Promise<boolean> }
let timerDesligarWhisper = null;
let gpuFalhou = false;
function exeServidorWhisper(tipo) {
  const sub = tipo === 'gpu' ? ['gpu', 'whisper-server.exe'] : ['whisper-server.exe'];
  const opcoes = [
    path.join(process.resourcesPath || '', 'whisper', ...sub),
    path.join(__dirname, '..', 'build', 'whisper', ...sub),
  ];
  return opcoes.find((p) => fs.existsSync(p)) || null;
}
function portaLivre() {
  return new Promise((resolve) => {
    const srv = require('net').createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', () => resolve(41790 + Math.floor(Math.random() * 100)));
  });
}
function desligarServidorWhisper() {
  clearTimeout(timerDesligarWhisper);
  const s = servidorWhisper;
  servidorWhisper = null;
  try { s?.proc.kill(); } catch { /* ignora */ }
}
function adiarDesligarWhisper() {
  clearTimeout(timerDesligarWhisper);
  timerDesligarWhisper = setTimeout(() => { log('Whisper: servidor desligado (10 min sem uso)'); desligarServidorWhisper(); }, 10 * 60 * 1000);
}
async function iniciarServidor(tipo) {
  const exe = exeServidorWhisper(tipo);
  if (!exe) return null;
  const porta = await portaLivre();
  const fios = Math.max(2, Math.min(8, os.cpus().length - 1));
  const args = ['-m', ARQ_WHISPER, '-l', 'pt', '-t', String(fios), '-nt', '--host', '127.0.0.1', '--port', String(porta)];
  if (tipo === 'gpu') args.push('-fa'); else args.push('-ng');
  const inicio = Date.now();
  const proc = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let errs = '';
  proc.stderr.on('data', (d) => { errs = (errs + d.toString()).slice(-4000); });
  const s = { proc, porta, tipo, morto: false };
  proc.on('exit', (codigo) => {
    s.morto = true;
    if (servidorWhisper === s) servidorWhisper = null;
    if (!encerrando) log(`Whisper: servidor ${tipo} saiu (código ${codigo})`, errs.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 400));
  });
  proc.on('error', () => { s.morto = true; });
  // pronto quando responde na porta (o modelo já carregou)
  s.pronto = (async () => {
    for (let i = 0; i < 200 && !s.morto; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${porta}/`, { signal: AbortSignal.timeout(800) });
        if (r.ok) {
          const placa = (errs.match(/ggml_vulkan: \d+ = ([^|(\r\n]+)/) || [])[1];
          log(`Whisper: servidor ${tipo === 'gpu' ? 'com placa de vídeo' + (placa ? ' (' + placa.trim() + ')' : '') : 'no processador'} pronto em ${Date.now() - inicio} ms`);
          return true;
        }
      } catch { /* ainda carregando */ }
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  })();
  return s;
}
async function garantirServidorWhisper() {
  if (!whisperPronto) return null;
  if (servidorWhisper && !servidorWhisper.morto) { adiarDesligarWhisper(); return (await servidorWhisper.pronto) ? servidorWhisper : null; }
  // 1º tenta com a placa de vídeo; se não abrir (sem Vulkan, driver antigo), usa o processador
  for (const tipo of gpuFalhou ? ['cpu'] : ['gpu', 'cpu']) {
    const s = await iniciarServidor(tipo);
    if (!s) continue;
    servidorWhisper = s;
    if (await s.pronto) { adiarDesligarWhisper(); return s; }
    try { s.proc.kill(); } catch { /* ignora */ }
    servidorWhisper = null;
    if (tipo === 'gpu') { gpuFalhou = true; log('Whisper: placa de vídeo indisponível, usando o processador'); }
  }
  return null;
}
// Tamanho do trecho a processar: ~50 por segundo de fala (+ folga). 1500 = os 30 s inteiros.
function contextoDoAudio(wav) {
  const seg = Math.max(0, (wav.length - 44) / 32000);
  if (seg > 9) return 1500;
  return Math.min(1500, Math.max(512, Math.ceil(seg * 50) + 96));
}
async function transcreverNoServidor(wav) {
  const s = await garantirServidorWhisper();
  if (!s) return null;
  const inicio = Date.now();
  const form = new FormData();
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'voz.wav');
  form.append('language', 'pt');
  form.append('response_format', 'json');
  form.append('temperature', '0');
  form.append('no_timestamps', 'true');
  form.append('beam_size', '3');
  form.append('audio_ctx', String(contextoDoAudio(wav)));
  form.append('prompt', dicaWhisper());
  try {
    const r = await fetch(`http://127.0.0.1:${s.porta}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const texto = String(j.text || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
    log(`Whisper ${s.tipo === 'gpu' ? 'placa de vídeo' : 'processador'} (${Date.now() - inicio} ms, ${((wav.length - 44) / 32000).toFixed(1)} s de fala): "${texto}"`);
    if (j.error) { log('Whisper: erro do servidor', String(j.error).slice(0, 200)); return null; }
    return { ok: !!texto, texto };
  } catch (e) {
    log('Whisper: servidor não respondeu', e.message);
    if (s.tipo === 'gpu') { gpuFalhou = true; desligarServidorWhisper(); }
    return null;
  }
}

async function transcreverWhisper(wav) {
  // ainda baixando o modelo: não espera (o reconhecimento rápido resolve enquanto isso)
  if (!whisperPronto) { garantirWhisper(); return { ok: false, motivo: 'indisponível' }; }
  const doServidor = await transcreverNoServidor(wav);
  if (doServidor) return doServidor;
  // reserva: o programa de linha de comando (mais lento, carrega o modelo a cada vez)
  const exe = exeWhisper();
  const tmp = path.join(DIR_WHISPER, `voz-${Date.now()}.wav`);
  fs.writeFileSync(tmp, wav);
  const fios = Math.max(2, Math.min(8, os.cpus().length - 1));
  const inicio = Date.now();
  return new Promise((resolve) => {
    execFile(exe, ['-m', ARQ_WHISPER, '-f', tmp, '-l', 'pt', '-nt', '-np', '-t', String(fios), '-ac', String(contextoDoAudio(wav)), '--prompt', dicaWhisper()],
      { windowsHide: true, timeout: 25000, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (erro, saida, errs) => {
        fs.rm(tmp, { force: true }, () => {});
        if (erro) { log('Whisper: falhou (código', erro.code, ')', String(errs || '').trim().split(/\r?\n/).slice(-6).join(' | ').slice(0, 700)); resolve({ ok: false }); return; }
        const texto = String(saida || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
        log(`Whisper (${Date.now() - inicio} ms): "${texto}"`);
        resolve({ ok: !!texto, texto });
      });
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
let capaGuardada = { chave: '', capa: null };
let ultimaMidia = null;
const capasWeb = new Map(); // "titulo|artista" -> data URL (ou null se não achou)
async function buscarCapaWeb(titulo, artista) {
  const chave = `${titulo}|${artista}`;
  if (capasWeb.has(chave)) return capasWeb.get(chave);
  capasWeb.set(chave, null); // evita buscar de novo enquanto a primeira busca anda
  try {
    const termo = `${artista || ''} ${String(titulo || '').replace(/\(.*?\)|\[.*?\]|official.*|video.*|lyrics.*/gi, '')}`.trim();
    if (termo.length < 3) return null;
    const r = await (await net.fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=3&term=${encodeURIComponent(termo)}`)).json();
    const item = (r.results || [])[0];
    if (!item?.artworkUrl100) return null;
    const img = await net.fetch(item.artworkUrl100.replace('100x100bb', '300x300bb'));
    if (!img.ok) return null;
    const url = 'data:image/jpeg;base64,' + Buffer.from(await img.arrayBuffer()).toString('base64');
    capasWeb.set(chave, url);
    log('Capa da internet:', titulo);
    return url;
  } catch { return null; }
}
let medidorAvisado = false;
let ultimoResumoMidia = '';

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
        if (dados.tipo === 'log') { log('[mídia]', String(dados.msg).slice(0, 1500)); continue; }
        if (dados.tipo === 'privacidade') {
          const p = { mic: servicos.nomesEmUso(dados.mic, IGNORAR_PRIVACIDADE), cam: servicos.nomesEmUso(dados.cam, IGNORAR_PRIVACIDADE) };
          const atual = JSON.stringify(p);
          if (atual !== ultimaPrivacidade) {
            ultimaPrivacidade = atual;
            log('Microfone/câmera em uso:', atual);
            janela?.webContents.send('privacidade', p);
          }
          continue;
        }
        if (dados.tipo === 'sons') {
          const r = JSON.stringify([dados.apps || [], dados.captura || []]);
          if (r !== ultimoSons) { ultimoSons = r; log('Áudio ativo — tocando:', JSON.stringify(dados.apps || []), '| microfone:', JSON.stringify(dados.captura || [])); }
          janela?.webContents.send('sons', { tocando: dados.apps || [], captura: dados.captura || [] });
          continue;
        }
        if (dados.tipo === 'toque') { log('Toque de ligação:', dados.titulo); janela?.webContents.send('toque', dados); continue; }
        if (dados.tipo === 'dispositivos') { janela?.webContents.send('dispositivos', dados); continue; }
        if (dados.tipo === 'hw') {
          hw = { ...hw, cpuTemp: dados.cpuTemp, cpuFonte: dados.cpuFonte, ...(dados.gpuUso != null ? { gpuUso: dados.gpuUso } : {}) };
          continue;
        }
        if (dados.tipo === 'nivel') {
          if (!medidorAvisado && dados.v > 0) { medidorAvisado = true; log('Medidor de som funcionando (olhinhos no ritmo)'); }
          if (visivel && !ocultaPorJogo) janela?.webContents.send('nivel', dados.v);
          continue;
        }
        if (dados.tipo === 'osd' || dados.tipo === 'saida') {
          janela?.webContents.send(dados.tipo, dados);
        } else if (dados.tipo === 'sistema') {
          dados.escuro = temaEscuro();
          lancador.atualizarEstadoSistema(dados);
          janela?.webContents.send('sistema', dados);
        } else {
          // guarda a capa da música atual e manda junto sempre (a interface pode ter recarregado)
          if (dados.ativo) {
            const chave = `${dados.titulo}|${dados.artista}`;
            // capa "de mentira": o Chrome/Edge às vezes manda o próprio ícone (pequeno) no lugar da capa
            const pequena = dados.capa && dados.capa.length < 9000 && /chrome|msedge|edge|firefox|opera|brave/i.test(dados.app || '');
            if (dados.capa && !pequena) { if (capaGuardada.chave !== chave) log('Capa recebida:', dados.titulo, `(${Math.round(dados.capa.length / 1024)} KB)`); capaGuardada = { chave, capa: dados.capa }; }
            else if (capaGuardada.chave === chave && capaGuardada.capa) dados.capa = capaGuardada.capa;
            else {
              // sem capa boa: procura a capa da música na internet (iTunes, grátis) e manda quando chegar
              if (pequena) delete dados.capa;
              buscarCapaWeb(dados.titulo, dados.artista).then((url) => {
                if (!url || capaGuardada.chave === chave) return;
                capaGuardada = { chave, capa: url };
                if (ultimaMidia && `${ultimaMidia.titulo}|${ultimaMidia.artista}` === chave) {
                  janela?.webContents.send('midia', { ...ultimaMidia, capa: url });
                }
              });
            }
          }
          const resumo = `${dados.ativo ? 'ativo' : 'nada'} ${dados.status || ''} '${dados.titulo || ''}' capa=${dados.capa ? 'sim' : 'não'}`;
          if (resumo.replace(/ capa=.*/, '') !== ultimoResumoMidia) { ultimoResumoMidia = resumo.replace(/ capa=.*/, ''); log('Mídia mostrada:', resumo); }
          ultimaMidia = dados;
          janela?.webContents.send('midia', dados);
        }
        tentativasMidia = 0;
      } catch { /* linha incompleta ou inválida */ }
    }
  });
  log('Ajudante de mídia iniciado:', caminhoScriptMidia());
  ajudanteMidia.stderr.on('data', (d) => log('[ajudante ERRO]', String(d).trim().slice(0, 800)));
  ajudanteMidia.on('error', (e) => log('[ajudante falhou ao abrir]', e.message));
  // Se o PowerShell fechar, escrever nele dá EPIPE: só registra, o ajudante é reaberto no 'exit'
  ajudanteMidia.stdin.on('error', (e) => log('Ajudante: entrada fechada', e.code || e.message));
  const este = ajudanteMidia;
  ajudanteMidia.on('exit', (codigo) => {
    log('Ajudante de mídia encerrou, código', codigo);
    if (ajudanteMidia !== este) return;
    ajudanteMidia = null;
    if (encerrando) return;
    tentativasMidia += 1;
    const espera = Math.min(30000, 1000 * 2 ** tentativasMidia);
    setTimeout(iniciarAjudanteMidia, espera);
  });
}

// Manda um comando ao ajudante sem derrubar o app se ele tiver acabado de fechar
function escreverAjudante(linha) {
  const entrada = ajudanteMidia?.stdin;
  if (!entrada || entrada.destroyed || !entrada.writable) return false;
  try { entrada.write(linha + '\n'); return true; } catch (e) { log('Ajudante indisponível:', e.message); return false; }
}

function comandoMidia(cmd, vezes = 1) {
  const validos = ['toggle', 'next', 'prev', 'volup', 'voldown', 'mute'];
  if (!validos.includes(cmd) || !ajudanteMidia) return false;
  for (let i = 0; i < Math.min(vezes, 20); i++) escreverAjudante(cmd);
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
          escreverAjudante(pendentes[tipo]);
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
  return escreverAjudante(cmd);
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
        escreverAjudante(`seek ${seg.toFixed(1)}`);
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
    case 'abrirDisco': {
      const letra = String(acao.letra || '').toUpperCase();
      if (!/^[A-Z]$/.test(letra)) return false;
      shell.openPath(letra + ':\\');
      return true;
    }
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
  // a janela cresce junto com o tamanho escolhido (até 200%), sem passar da tela
  const fator = Math.max(1, Number(config?.tamanho) || 1);
  const largura = Math.round(Math.min(JANELA.largura * fator, area.width * 0.95));
  const alturaJanela = Math.round(Math.min(JANELA.altura * fator, area.height * 0.9));
  const x = Math.round(area.x + (area.width - largura) / 2);
  const y = tela.bounds.y;
  // só mexe na janela se a posição mudou de verdade (mexer no meio de um clique cancela o clique)
  const b = janela.getBounds();
  if (b.x !== x || b.y !== y || b.width !== largura || b.height !== alturaJanela) {
    janela.setBounds({ x, y, width: largura, height: alturaJanela });
  }
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
  // Depois de fechada, nenhum timer pode mexer na janela ("Object has been destroyed")
  janela.on('closed', () => { janela = null; });

  janela.setAlwaysOnTop(true, 'screen-saver');
  janela.setVisibleOnAllWorkspaces(true);
  janela.setIgnoreMouseEvents(true, { forward: true });
  janela.loadURL(`http://127.0.0.1:${PORTA}/`);
  janela.once('ready-to-show', () => {
    posicionarJanela();
    janela.showInactive(); semBarraDeTarefas();
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
    // Ctrl+Alt+I durante o jogo: mostra a ilha JÁ com o painel aberto e pegando o mouse/teclado
    // (o jogo solta o cursor quando perde o foco). De novo, Esc ou clicar no jogo: some e o foco volta ao jogo.
    if (!mostrarMesmoEmJogo) entrarNaIlhaNoJogo(); else sairDaIlhaNoJogo();
    return;
  }
  visivel = typeof forcar === 'boolean' ? forcar : !visivel;
  aplicarVisibilidadeReal();
  atualizarMenuBandeja();
}

let jogoInterativo = false;
let janelaDoJogo = 0;
let ultimaTrocaJogo = 0;
let entrouNoJogoEm = 0;
let refocosNoJogo = 0;
// Jogo em tela cheia EXCLUSIVA: o Windows não deixa nenhuma janela aparecer por cima
// (se a ilha pegasse o foco, o jogo seria minimizado). Nesse caso a ilha não abre por cima
// e, quando o jogo fechar, explica como trocar o modo de tela.
let avisarModoDeTela = false;
function jogoEmTelaCheiaExclusiva() {
  try { return !!janelasWin.telaCheiaExclusiva?.(); } catch { return false; }
}
function entrarNaIlhaNoJogo() {
  if (Date.now() - ultimaTrocaJogo < 600) return; // atalho repetido sem querer
  if (jogoEmTelaCheiaExclusiva()) {
    if (!avisarModoDeTela) log('Jogo em tela cheia exclusiva: a ilha não abre por cima (o jogo seria minimizado)');
    avisarModoDeTela = true;
    return;
  }
  ultimaTrocaJogo = Date.now();
  entrouNoJogoEm = Date.now();
  refocosNoJogo = 0;
  janelaDoJogo = janelasWin.janelaDaFrente();
  mostrarMesmoEmJogo = true;
  jogoInterativo = true;
  aplicarVisibilidadeReal();
  janela.setFocusable(true); semBarraDeTarefas();
  janela.setIgnoreMouseEvents(false);
  janelasWin.trazerParaFrente(janela.getNativeWindowHandle());
  janela.focus();
  janela.webContents.focus();
  janela.webContents.send('jogo:interagir', true);
  log('Jogo: ilha aberta por cima');
}
function sairDaIlhaNoJogo() {
  if (!jogoInterativo && !mostrarMesmoEmJogo) return;
  ultimaTrocaJogo = Date.now();
  jogoInterativo = false;
  mostrarMesmoEmJogo = false;
  janela.webContents.send('jogo:interagir', false);
  janela.setIgnoreMouseEvents(true, { forward: true });
  janela.setFocusable(false); semBarraDeTarefas();
  aplicarVisibilidadeReal();
  if (janelaDoJogo) janelasWin.focarJanela(janelaDoJogo); // devolve o foco (e o mouse) ao jogo
  log('Jogo: ilha fechada, foco de volta ao jogo');
}

function aplicarVisibilidadeReal() {
  if (!janela) return;
  const mostrar = visivel && (!ocultaPorJogo || mostrarMesmoEmJogo || vozEmJogo);
  if (mostrar) {
    const estavaEscondida = !janela.isVisible();
    if (estavaEscondida) janela.webContents.send('janela:pausar', false);
    janela.showInactive(); semBarraDeTarefas();
    janela.setAlwaysOnTop(true, 'screen-saver');
    if (estavaEscondida) {
      // voltando (ex.: depois de um jogo): o Windows às vezes "esquece" o modo de clique da janela.
      // Recomeça do zero: clicável só com o mouse em cima, e a interface volta ao estado normal.
      janela.setIgnoreMouseEvents(false);
      janela.setIgnoreMouseEvents(true, { forward: true });
      janela.setFocusable(false); semBarraDeTarefas();
      janela.webContents.send('janela:reexibida');
      log('Ilha reexibida: modo de clique reiniciado');
      ligarDiagClique();
    }
  } else {
    if (lancadorAberto) fecharLancador();
    janela.hide();
    // Desliga o "gancho" de mouse do Windows que repassa os movimentos para os olhinhos:
    // com a ilha escondida ele não serve para nada, e ganchos de mouse atrapalham jogos
    // (faziam o ponteiro piscar no PUBG). Ao reaparecer, o modo de clique é refeito do zero.
    try { janela.setIgnoreMouseEvents(true); } catch { /* ignora */ }
    janela.webContents.send('janela:pausar', true);
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
  if (!ativo) { mostrarMesmoEmJogo = false; vozEmJogo = false; jogoInterativo = false; }
  log(ativo ? `Jogo detectado: ${motivo} — ilha escondida` : 'Jogo fechado — ilha de volta');
  aplicarVisibilidadeReal();
  if (!ativo && avisarModoDeTela) {
    avisarModoDeTela = false;
    setTimeout(() => janela?.webContents.send('aviso:mostrar', {
      titulo: 'Para abrir a ilha dentro do jogo',
      sub: ['O jogo estava em tela cheia exclusiva: nesse modo o Windows minimiza o jogo se algo aparecer por cima.',
        'Nas configurações de vídeo do jogo, troque o modo de tela para "Tela cheia (janela)" ou "Janela sem bordas".',
        'Depois disso, o atalho abre a ilha por cima do jogo normalmente.'],
      icone: '🎮', tipo: 'info', ms: 20000, alto: true,
    }), 1500);
  }
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
  janela.setFocusable(true); semBarraDeTarefas();
  janela.setIgnoreMouseEvents(false);
  janela.show(); semBarraDeTarefas();
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
  janela.setFocusable(false); semBarraDeTarefas();
  janela.setIgnoreMouseEvents(true, { forward: true });
  janela.blur();
  janela.setAlwaysOnTop(true, 'screen-saver');
}

// ---------------------------------------------------------------------------
// Atalhos de teclado (podem ser trocados nas configurações)
// ---------------------------------------------------------------------------
let timerVozEmJogo = null;
function encerrarVozEmJogo() {
  clearTimeout(timerVozEmJogo);
  if (!vozEmJogo) return;
  vozEmJogo = false;
  aplicarVisibilidadeReal();
}
ipcMain.on('voz:fim', () => {
  if (!vozEmJogo) return;
  clearTimeout(timerVozEmJogo);
  timerVozEmJogo = setTimeout(encerrarVozEmJogo, 3000); // dá tempo de ver a resposta
});

// Atalhos com tecla de pontuação (ex.: Shift+| no teclado ABNT2) são gravados pela POSIÇÃO da tecla
// ("Shift+|@IntlBackslash"): o Electron só conhece as teclas do teclado americano, então esses a ilha
// vigia ela mesma (sem abrir nada, só lendo o estado das teclas a cada 35 ms).
let atalhosPorPosicao = [];
let timerPosicao = null;
function registrarPorPosicao(atalho, acao) {
  const [mods, codigo] = atalho.split('@');
  if (!janelasWin.posicaoConhecida(codigo)) return false;
  const partes = mods.split('+');
  // a tecla é descoberta na primeira conferência (o leitor de teclado pode ainda não estar pronto agora)
  atalhosPorPosicao.push({ codigo, vk: 0, ctrl: partes.includes('Control'), alt: partes.includes('Alt'), shift: partes.includes('Shift'), win: partes.includes('Super'), acao, antes: true });
  if (!timerPosicao) {
    timerPosicao = setInterval(() => {
      if (!atalhosPorPosicao.length) return;
      const k = janelasWin.teclaApertada;
      const ctrl = k(0x11), alt = k(0x12), shift = k(0x10), win = k(0x5B) || k(0x5C);
      for (const a of atalhosPorPosicao) {
        if (!a.vk) { a.vk = janelasWin.vkDaPosicao(a.codigo); if (!a.vk) continue; }
        const agora = k(a.vk);
        if (agora && !a.antes && a.ctrl === ctrl && a.alt === alt && a.shift === shift && a.win === win) {
          try { a.acao(); } catch (e) { log('Erro no atalho:', e.message); }
        }
        a.antes = agora;
      }
    }, 35);
  }
  return true;
}

function registrarAtalhos() {
  globalShortcut.unregisterAll();
  atalhosPorPosicao = [];
  const erros = {};
  const tentar = (nome, atalho, acao) => {
    if (!atalho) return null;
    if (atalho.includes('@')) {
      if (registrarPorPosicao(atalho, acao)) return atalho;
      erros[nome] = `"${atalho.split('@')[0]}" não pôde ser usado neste teclado`;
      return null;
    }
    // atalhos com | ou \ gravados antes de existir a posição física: também vale a tecla "\|" do teclado ABNT2
    if (/\+[|\\]$/.test(atalho)) registrarPorPosicao(atalho.slice(0, -1) + '|@IntlBackslash', acao);
    try {
      if (globalShortcut.register(atalho, acao)) return atalho;
    } catch { /* formato inválido */ }
    erros[nome] = `"${atalho}" já está em uso por outro programa ou é inválido`;
    return null;
  };
  const foraDeJogo = (fn) => () => { if (!ocultaPorJogo || mostrarMesmoEmJogo) fn(); };
  // Voz funciona até no jogo: a ilha aparece só enquanto ouve e responde, sem tirar o foco do jogo
  tentar('atalhoVoz', config.atalhoVoz, () => {
    if (ocultaPorJogo && !mostrarMesmoEmJogo) {
      if (jogoEmTelaCheiaExclusiva()) {
        // tela cheia exclusiva: ouve e responde falando, sem aparecer (aparecer minimizaria o jogo)
        log('Voz durante o jogo (sem aparecer: tela cheia exclusiva)');
      } else {
        vozEmJogo = true;
        clearTimeout(timerVozEmJogo);
        timerVozEmJogo = setTimeout(encerrarVozEmJogo, 30000); // segurança
        aplicarVisibilidadeReal();
        log('Voz durante o jogo');
      }
    }
    janela?.webContents.send('voz:ativar');
  });
  tentar('atalhoMostrar', config.atalhoMostrar, () => alternarVisibilidade());
  atalhoBuscaAtivo = tentar('atalhoBusca', config.atalhoBusca, foraDeJogo(abrirLancador));
  // O atalho do painel funciona também no jogo: abre a ilha por cima (como o Ctrl+Alt+I) e, apertando de novo, devolve o jogo
  tentar('atalhoPainel', config.atalhoPainel, () => {
    if (ocultaPorJogo) {
      if (jogoInterativo) sairDaIlhaNoJogo();
      else entrarNaIlhaNoJogo();
      return;
    }
    alternarPainel();
  });
  if (!atalhoBuscaAtivo && config.atalhoBusca === CONFIG_PADRAO.atalhoBusca) {
    atalhoBuscaAtivo = tentar('atalhoBusca2', 'Control+Alt+P', foraDeJogo(abrirLancador));
    if (atalhoBuscaAtivo) delete erros.atalhoBusca;
  }
  log('Atalhos:', config.atalhoVoz, '|', config.atalhoMostrar, '| busca:', atalhoBuscaAtivo || 'nenhum', '| painel:', config.atalhoPainel || 'nenhum', Object.keys(erros).length ? JSON.stringify(erros) : '');
  atualizarMenuBandeja();
  return erros;
}

// ---------------------------------------------------------------------------
// Teclado sob demanda: a ilha só "pega" o teclado quando você clica num campo
// ---------------------------------------------------------------------------
let tecladoAtivo = false;
let tecladoDesde = 0;
function ativarTeclado(sim) {
  if (!janela) return;
  if (sim) {
    tecladoAtivo = true;
    tecladoDesde = Date.now();
    log('Teclado: ligado');
    janela.setFocusable(true); semBarraDeTarefas();
    janela.setIgnoreMouseEvents(false);
    // sem isso o Windows não deixa a ilha pegar o teclado e o que você digita vai para o outro app
    janelasWin.trazerParaFrente(janela.getNativeWindowHandle());
    janela.focus();
    janela.webContents.focus();
    setTimeout(() => {
      if (tecladoAtivo && janela && !janela.isDestroyed() && !janela.isFocused()) {
        janelasWin.trazerParaFrente(janela.getNativeWindowHandle());
        janela.focus();
        janela.webContents.focus();
      }
    }, 120);
  } else if (tecladoAtivo) {
    tecladoAtivo = false;
    janela.webContents.send('teclado:fim');
    if (!lancadorAberto) {
      janela.setFocusable(false); semBarraDeTarefas();
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
// Posição pela localização do Windows (Wi-Fi/GPS, precisa estar ligada em
// Configurações > Privacidade > Localização > "Permitir que aplicativos da área de trabalho...")
function localizacaoDoWindows() {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const script = [
    'Add-Type -AssemblyName System.Device',
    "$w = New-Object System.Device.Location.GeoCoordinateWatcher('High')",
    '$w.Start()',
    '$fim = (Get-Date).AddSeconds(12)',
    "while ((Get-Date) -lt $fim -and $w.Status -ne 'Ready' -and $w.Permission -ne 'Denied') { Start-Sleep -Milliseconds 200 }",
    '$c = $w.Position.Location',
    "if ($w.Status -eq 'Ready' -and -not $c.IsUnknown) { '{0};{1};{2}' -f $c.Latitude.ToString([Globalization.CultureInfo]::InvariantCulture), $c.Longitude.ToString([Globalization.CultureInfo]::InvariantCulture), [int]$c.HorizontalAccuracy } else { 'sem;' + $w.Status + ';' + $w.Permission }",
    '$w.Stop()',
  ].join('; ');
  return new Promise((resolve) => {
    let saida = '';
    const p = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    const limite = setTimeout(() => { try { p.kill(); } catch { /* ignora */ } resolve(null); }, 20000);
    p.stdout.on('data', (d) => { saida += d; });
    p.on('error', () => { clearTimeout(limite); resolve(null); });
    p.on('exit', () => {
      clearTimeout(limite);
      const [la, lo, prec] = saida.trim().split(';');
      if (la === 'sem' || !la) { log('Localização do Windows indisponível:', saida.trim()); resolve(null); return; }
      const lat = Number(la); const lon = Number(lo);
      resolve(Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon, precisao: Number(prec) } : null);
    });
  });
}

// Nome do MUNICÍPIO a partir das coordenadas (não a região metropolitana nem o estado)
async function nomeDoMunicipio(lat, lon) {
  try {
    const j = await (await net.fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=pt`)).json();
    const adm = j?.localityInfo?.administrative || [];
    const municipio = adm.find((x) => x.adminLevel === 8)?.name || j.locality || j.city;
    const uf = String(j.principalSubdivisionCode || '').replace(/^BR-/, '');
    return municipio ? (uf && uf.length <= 3 ? `${municipio}, ${uf}` : municipio) : null;
  } catch { return null; }
}

// Localização automática: 1º a do Windows (precisa), senão pela internet (aproximada)
let localAuto = null; // { lat, lon, nome, quando, fonte }
async function descobrirLocal() {
  if (localAuto && Date.now() - localAuto.quando < 60 * 60 * 1000) return localAuto;
  let pos = await localizacaoDoWindows();
  let fonte = 'windows';
  if (!pos) {
    fonte = 'internet';
    const fontes = [
      async () => {
        const j = await (await net.fetch('https://ipwho.is/?fields=success,latitude,longitude')).json();
        if (!j.success) throw new Error('falhou');
        return { lat: +j.latitude, lon: +j.longitude };
      },
      async () => {
        const j = await (await net.fetch('https://get.geojs.io/v1/ip/geo.json')).json();
        return { lat: +j.latitude, lon: +j.longitude };
      },
    ];
    for (const f of fontes) {
      try {
        const l = await f();
        if (Number.isFinite(l.lat) && Number.isFinite(l.lon)) { pos = l; break; }
      } catch { /* tenta a próxima */ }
    }
  }
  if (!pos) return localAuto; // a última conhecida, se houver
  const nome = (await nomeDoMunicipio(pos.lat, pos.lon)) || 'Sua região';
  localAuto = { lat: pos.lat, lon: pos.lon, nome, fonte, quando: Date.now() };
  log('Localização automática:', nome, `(${fonte}${pos.precisao ? `, ±${pos.precisao} m` : ''})`);
  return localAuto;
}

async function buscarClima() {
  try {
    const nome = String(config.cidade || '').trim();
    let local = null;
    if (!nome) {
      local = await descobrirLocal();
      if (!local) return { ok: false, erro: 'não consegui descobrir sua cidade (digite-a nas configurações)' };
    } else {
      local = cacheCidades.get(nome);
    }
    if (!local) {
      // procura o município primeiro no Brasil; se não achar, no mundo
      const busca = (extra) => net.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=5&language=pt&name=${encodeURIComponent(nome)}${extra}`).then((r) => r.json());
      let g = await busca('&countryCode=BR');
      if (!g?.results?.length) g = await busca('');
      // prefere lugares que são cidades/municípios (PPL*), não estados ou regiões (ADM1)
      const r = (g?.results || []).find((x) => /^PPL/.test(x.feature_code || '')) || g?.results?.[0];
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
    return { ok: true, cidade: local.nome, automatico: !nome, aproximado: !nome && local.fonte === 'internet', atual: f.current, diario: f.daily, horario: f.hourly };
  } catch (e) {
    return { ok: false, erro: 'sem internet' };
  }
}

// ---------------------------------------------------------------------------
// Histórico da área de transferência (só na memória, nunca salvo em disco)
// ---------------------------------------------------------------------------
let copiados = [];
let ultimoCopiado = '';
let ultimaSeqCopia = -2;
function vigiarCopiados() {
  setInterval(() => {
    if (config.historicoCopiados === false) return;
    // nada novo copiado: nem lê a área de transferência
    const seq = janelasWin.seqAreaTransferencia();
    if (seq !== -1 && seq === ultimaSeqCopia) return;
    ultimaSeqCopia = seq;
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
// GPU e temperaturas: NVIDIA pelo nvidia-smi (uso + temperatura); o resto pelo ajudante do PowerShell
let hw = {};
let hwPedido = 0;
let temNvidia = null; // null = ainda não sei
function atualizarHardware() {
  if (process.platform !== 'win32' || Date.now() - hwPedido < 2500) return;
  hwPedido = Date.now();
  const depois = () => escreverAjudante(temNvidia ? 'hw semgpu' : 'hw');
  if (temNvidia === false) { depois(); return; }
  execFile('nvidia-smi', ['--query-gpu=utilization.gpu,temperature.gpu,name', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 4000 }, (erro, saida) => {
      if (erro) { temNvidia = false; depois(); return; }
      const [uso, temp, ...nome] = String(saida).split(/\r?\n/)[0].split(',').map((x) => x.trim());
      temNvidia = true;
      hw = { ...hw, gpuUso: Number(uso), gpuTemp: Number(temp), gpuNome: nome.join(',').replace(/^NVIDIA (GeForce )?/i, '') };
      depois();
    });
}

// Todos os discos do computador (C:, D:, pendrive...), com espaço usado e livre
let discosCache = { quando: 0, letras: [] };
function listarDiscos() {
  if (process.platform !== 'win32') {
    try { const st = fs.statfsSync('/'); const t = st.blocks * st.bsize; return [{ letra: '/', total: t, usado: t - st.bavail * st.bsize }]; } catch { return []; }
  }
  // quais letras existem: confere a cada 20 s (pendrive entra e sai)
  if (Date.now() - discosCache.quando > 20000) {
    discosCache = { quando: Date.now(), letras: 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => { try { return fs.existsSync(l + ':\\'); } catch { return false; } }) };
  }
  const lista = [];
  for (const letra of discosCache.letras) {
    try {
      const st = fs.statfsSync(letra + ':\\');
      const total = st.blocks * st.bsize;
      if (total > 0) lista.push({ letra, total, usado: total - st.bavail * st.bsize });
    } catch { /* drive sem mídia */ }
  }
  return lista;
}

function recursos() {
  atualizarHardware();
  const agora = os.cpus();
  let ocioso = 0; let total = 0;
  agora.forEach((c, i) => {
    const a = cpuAnterior[i]?.times || c.times;
    const t = c.times;
    const tt = (t.user - a.user) + (t.nice - a.nice) + (t.sys - a.sys) + (t.irq - a.irq) + (t.idle - a.idle);
    total += tt; ocioso += t.idle - a.idle;
  });
  cpuAnterior = agora;
  const discos = listarDiscos();
  const c = discos.find((d) => d.letra === 'C') || discos[0] || { total: 0, usado: 0 };
  const discoTotal = c.total; const discoUsado = c.usado;
  return {
    cpu: total ? Math.round(100 * (1 - ocioso / total)) : 0,
    nucleos: agora.length,
    ramTotal: os.totalmem(),
    ramUsada: os.totalmem() - os.freemem(),
    discoTotal,
    discoUsado,
    discos,
    uptime: os.uptime(),
    ...hw,
  };
}

// ---------------------------------------------------------------------------
// Janela de configurações
// ---------------------------------------------------------------------------
let janelaConfig = null;
// O Windows não deixa um app "de fundo" (a ilha não pega o foco) jogar uma janela para a frente:
// ela abria ATRÁS do programa aberto e parecia que não tinha aberto. Fica por cima um instante e pega o foco.
function trazerParaFrente(j) {
  if (!j || j.isDestroyed()) return;
  if (j.isMinimized()) j.restore();
  j.setAlwaysOnTop(true, 'pop-up-menu');
  j.show();
  j.moveTop();
  janelasWin.trazerParaFrente(j.getNativeWindowHandle());
  j.focus();
  j.webContents.focus();
  setTimeout(() => { if (!j.isDestroyed()) j.setAlwaysOnTop(false); }, 1200);
}

function abrirConfiguracoes() {
  log('Abrindo configurações');
  if (janelaConfig && !janelaConfig.isDestroyed()) {
    // página travada ou em branco: recarrega
    if (janelaConfig.webContents.isCrashed() || !janelaConfig.webContents.getURL()) {
      janelaConfig.loadURL(`http://127.0.0.1:${PORTA}/configuracoes.html`);
    }
    trazerParaFrente(janelaConfig);
    return;
  }
  janelaConfig = new BrowserWindow({
    width: 600,
    height: 720,
    minWidth: 520,
    minHeight: 480,
    show: false,
    title: 'Ilha Dinâmica — Configurações',
    autoHideMenuBar: true,
    backgroundColor: '#0b0b0d',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  const j = janelaConfig;
  // sempre na tela onde está o mouse, centralizada (nunca fora da tela)
  try {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const largura = Math.min(600, area.width - 40);
    const altura = Math.min(720, area.height - 40);
    j.setBounds({ x: Math.round(area.x + (area.width - largura) / 2), y: Math.round(area.y + (area.height - altura) / 2), width: largura, height: altura });
  } catch { /* usa o padrão */ }
  j.loadURL(`http://127.0.0.1:${PORTA}/configuracoes.html`);
  j.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let mostrou = false;
  const mostrar = () => { if (!mostrou) { mostrou = true; trazerParaFrente(j); } };
  j.once('ready-to-show', mostrar);
  setTimeout(mostrar, 1500); // se a página demorar, mostra mesmo assim
  j.webContents.on('did-fail-load', (_e, codigo, desc) => {
    log('Configurações não carregaram:', codigo, desc);
    setTimeout(() => { if (!j.isDestroyed()) j.loadURL(`http://127.0.0.1:${PORTA}/configuracoes.html`); }, 800);
  });
  j.webContents.on('render-process-gone', (_e, d) => log('Configurações travaram:', d.reason));
  j.on('closed', () => { if (janelaConfig === j) janelaConfig = null; });
}

const VALIDADORES = {
  corOlhos: (v) => /^#[0-9a-f]{6}$/i.test(v), corRelogio: (v) => /^#[0-9a-f]{6}$/i.test(v), corDestaque: (v) => /^#[0-9a-f]{6}$/i.test(v),
  fundo: (v) => ['preto', 'grafite', 'translucido'].includes(v),
  tamanho: (v) => typeof v === 'number' && v >= 0.8 && v <= 2,
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
  alertaAgenda: (v) => ['tranquilo', 'padrao', 'precavido', 'pontual'].includes(v),
  resumoDoDia: (v) => typeof v === 'boolean',
  esconderEmJogos: (v) => typeof v === 'boolean',
  agendasIcs: (v) => Array.isArray(v) && v.length <= 5 && v.every((x) => typeof x === 'string' && x.length <= 2000 && /^(https|webcal):\/\//i.test(x)),
  focoSilencia: (v) => typeof v === 'boolean',
  modoDiscreto: (v) => ['abas', 'sempre', 'nunca'].includes(v),
  semDiscreto: (v) => Array.isArray(v) && v.length <= 60 && v.every((x) => typeof x === 'string' && x.trim().length >= 2 && x.length <= 60),
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
  if (config.tamanho !== anterior.tamanho) posicionarJanela();
  if (JSON.stringify(config.agendasIcs) !== JSON.stringify(anterior.agendasIcs)) {
    // espera a tela receber a configuração nova antes de recarregar
    setTimeout(() => janela?.webContents.send('agendas:recarregar'), 300);
  }
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

// Tira do "Iniciar com o Windows" entradas antigas que abrem a cópia de teste (electron.exe da pasta do projeto)
function limparInicioAntigo() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  const chave = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
  let saida = '';
  try { saida = execFileSync('reg.exe', ['query', chave], { encoding: 'utf8', windowsHide: true }); } catch { return; }
  for (const linha of saida.split(/\r?\n/)) {
    const m = linha.match(/^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/);
    if (!m || !/node_modules\\electron\\dist\\electron\.exe/i.test(m[2]) || !/ilha/i.test(m[2])) continue;
    try {
      execFileSync('reg.exe', ['delete', chave, '/v', m[1], '/f'], { windowsHide: true });
      log('Removido do início do Windows (cópia de teste):', m[1]);
    } catch (e) { log('Não consegui remover', m[1], e.message); }
  }
}

let reforcoTopo = 0;
// A ilha nunca aparece na barra de tarefas. O Windows recoloca o ícone quando a janela vira "focável"
// (busca, digitação, interagir no jogo) ou é reexibida, então reafirma depois de cada uma dessas trocas.
function semBarraDeTarefas() {
  try {
    if (!janela || janela.isDestroyed()) return;
    janela.setSkipTaskbar(true);
    // alguns Windows só obedecem na próxima volta do processamento da janela
    setTimeout(() => { try { if (janela && !janela.isDestroyed()) janela.setSkipTaskbar(true); } catch { /* ignora */ } }, 150);
  } catch { /* ignora */ }
}

function reforcarTopo(forcar = false) {
  if (!janela || janela.isDestroyed() || encerrando || !janela.isVisible()) return;
  // Nunca mexe na janela com o mouse em cima dela ou com o botão apertado:
  // tirar e pôr "por cima" no meio de um clique/arrastar faz o Windows cancelar o clique
  try {
    const p = screen.getCursorScreenPoint();
    const b = janela.getBounds();
    const emCima = p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;
    if (emCima || janelasWin.botaoMouseApertado() || tecladoAtivo || lancadorAberto) return;
  } catch { /* segue */ }
  try {
    if (forcar) janela.setAlwaysOnTop(false);
    janela.setAlwaysOnTop(true, 'screen-saver');
    janela.moveTop();
  } catch { /* ignora */ }
}

function aplicarInicioAutomatico() {
  limparInicioAntigo();
  if (process.platform !== 'win32') return;
  // Sem instalador, o electron.exe precisa receber a pasta do app como argumento
  const args = app.isPackaged ? [] : [app.getAppPath()];
  try {
    app.setLoginItemSettings({ openAtLogin: config.iniciarComWindows, path: process.execPath, args, name: 'Ilha Dinâmica' });
    log(`Iniciar com o Windows: ${config.iniciarComWindows ? 'ligado' : 'desligado'}`);
  } catch (e) { log('Iniciar com o Windows: falhou - ' + e.message); }
}

// ---------------------------------------------------------------------------
// IPC com a interface
// ---------------------------------------------------------------------------
ipcMain.on('interativo', (_e, sim) => {
  if (!janela || janela.isDestroyed()) return;
  // escondida: sem o gancho de mouse (ver aplicarVisibilidadeReal)
  if (!janela.isVisible()) { janela.setIgnoreMouseEvents(true); return; }
  janela.setIgnoreMouseEvents(!sim, { forward: true });
  if (diagClique) log('Clique-diag: interativo', !!sim);
});
// Diagnóstico de cliques (por 10 minutos depois de abrir, ou depois de um jogo)
let diagClique = false;
function ligarDiagClique() { diagClique = true; setTimeout(() => { diagClique = false; }, 10 * 60 * 1000); }
ipcMain.on('diag:clique', (_e, msg) => { if (diagClique) log('Clique-diag:', String(msg).slice(0, 300)); });
// Clique físico que não chegou na ilha (ela clicou por você): sempre vai para o log, com o estado da janela,
// e liga o diagnóstico detalhado por 10 min para entender a causa
ipcMain.on('diag:sempre', (_e, msg) => {
  let extra = '';
  try { extra = ` | focavel=${janela?.isFocusable?.()} focada=${janela?.isFocused()} visivel=${janela?.isVisible()} topo=${janela?.isAlwaysOnTop()}`; } catch {}
  log('Clique perdido (socorro):', String(msg).slice(0, 300) + extra);
  if (!diagClique) ligarDiagClique();
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
ipcMain.handle('agendas', () => ((config.agendasIcs || []).length ? servicos.buscarAgendas(config.agendasIcs) : { eventos: [], erros: [] }));
ipcMain.handle('apps:listar', () => lancador.listarApps());
ipcMain.on('foco:silenciar', (_e, sim) => silenciarNoFoco(!!sim));
ipcMain.on('atualizar:agora', () => instalarAtualizacaoAgora());
ipcMain.on('audio:listar', () => escreverAjudante('dispositivos'));
ipcMain.on('audio:sons', () => escreverAjudante('sons'));
ipcMain.on('audio:padrao', (_e, id) => {
  if (typeof id !== 'string' || !/^\{[\w.-]+\}\.\{[0-9a-fA-F-]+\}$/.test(id)) return;
  log('Trocando dispositivo de áudio padrão');
  escreverAjudante('padrao ' + id);
});
ipcMain.on('jogo:sair', () => { if (jogoInterativo) sairDaIlhaNoJogo(); });
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
ipcMain.handle('voz:transcrever', (_e, wav) => {
  if (!(wav instanceof ArrayBuffer || ArrayBuffer.isView(wav)) || wav.byteLength > 8 * 1024 * 1024) return { ok: false };
  return transcreverWhisper(ArrayBuffer.isView(wav) ? Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength) : Buffer.from(wav));
});
ipcMain.handle('whisper:garantir', () => garantirWhisper());
// Você começou a falar: liga o Whisper enquanto isso (quando terminar a frase, ele já está pronto)
ipcMain.on('whisper:preparar', () => { if (whisperPronto) garantirServidorWhisper().catch(() => {}); });
// Registro de cada comando de voz (para medir e melhorar)
ipcMain.on('voz:log', (_e, msg) => log('Voz:', String(msg).slice(0, 400)));
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

// A cópia de desenvolvimento (pasta do projeto) não abre se a versão instalada existir:
// senão ficam duas ilhas uma em cima da outra (setas, cliques e configurações bugam)
const EXES_INSTALADOS = [
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'IlhaDinamica', 'IlhaDinamica.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'Programs', 'IlhaDinamica', 'IlhaDinamica.exe'),
];
const copiaDeTeste = !app.isPackaged && process.platform === 'win32' && !process.env.ILHA_DEV
  && EXES_INSTALADOS.some((p) => fs.existsSync(p));

if (copiaDeTeste) {
  try { app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [app.getAppPath()] }); } catch { /* ignora */ }
  log('Cópia de teste fechada: a versão instalada é a que vale');
  app.quit();
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
// Mede o consumo da ilha e anota no log: a cada minuto nos primeiros 15 min, depois a cada 30 min
function medirDesempenho() {
  let quando = 0;
  const medir = async () => {
    // de dentro da tela: memória do JavaScript, elementos e animações ativas (para achar acúmulos)
    let dentro = '';
    try {
      const r = await Promise.race([
        janela?.webContents.executeJavaScript(`({ js: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576), nos: document.getElementsByTagName('*').length, anim: document.getAnimations().length })`, true),
        new Promise((res) => setTimeout(() => res(null), 2000)),
      ]);
      if (r) dentro = ` | tela por dentro: js ${r.js}MB, ${r.nos} elementos, ${r.anim} animações`;
    } catch { /* janela ocupada */ }
    try {
      const m = app.getAppMetrics();
      const porTipo = {};
      let cpu = 0, mem = 0;
      for (const p of m) {
        const t = p.type === 'Browser' ? 'principal' : p.type === 'Tab' || p.type === 'Renderer' ? 'tela' : p.type === 'GPU' ? 'gpu' : 'outros';
        porTipo[t] = porTipo[t] || { cpu: 0, mem: 0 };
        porTipo[t].cpu += p.cpu?.percentCPUUsage || 0;
        porTipo[t].mem += (p.memory?.workingSetSize || 0) / 1024;
        cpu += p.cpu?.percentCPUUsage || 0;
        mem += (p.memory?.workingSetSize || 0) / 1024;
      }
      const partes = Object.entries(porTipo).map(([t, v]) => `${t} ${v.cpu.toFixed(1)}%/${Math.round(v.mem)}MB`).join(', ');
      const abertos = Object.entries(processosAbertos).map(([k, v]) => `${k}×${v}`).join(' ') || 'nenhum';
      for (const k of Object.keys(processosAbertos)) delete processosAbertos[k];
      log(`Desempenho: CPU ${cpu.toFixed(1)}% | memória ${Math.round(mem)} MB (${partes}) | programas abertos desde a última medição: ${abertos}${dentro}${ocultaPorJogo ? ' | em jogo' : ''}`);
    } catch (e) { log('Desempenho: erro ao medir -', e.message); }
    quando++;
    setTimeout(medir, quando < 15 ? 60 * 1000 : 30 * 60 * 1000);
  };
  app.getAppMetrics(); // a primeira leitura de CPU zera a contagem
  setTimeout(medir, 60 * 1000);
}

  app.whenReady().then(async () => {
    medirDesempenho();
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
    // Abrindo junto com o Windows, a área de trabalho ainda está carregando: reforça o "por cima" depois
    for (const ms of [3000, 10000, 30000]) setTimeout(() => reforcarTopo(true), ms);
    aplicarInicioAutomatico();
    iniciarAjudanteMidia();

    registrarAtalhos();
    // Perdeu o foco: espera um instante. Ao pegar o teclado, o Windows às vezes manda um "blur"
    // de passagem; se a ilha recuperou o foco (ou acabou de pedir), não fecha nada.
    janela.on('blur', () => {
      setTimeout(() => {
        if (!janela || janela.isDestroyed() || janela.isFocused()) return;
        if (tecladoAtivo && Date.now() - tecladoDesde < 700) {
          janelasWin.trazerParaFrente(janela.getNativeWindowHandle());
          janela.focus();
          janela.webContents.focus();
          return;
        }
        if (lancadorAberto) fecharLancador();
        if (tecladoAtivo) { log('Teclado: a ilha perdeu o foco'); ativarTeclado(false); }
        if (jogoInterativo && ocultaPorJogo) {
          // alguns jogos (ex.: PUBG) puxam o foco de volta logo que a ilha abre: pega de volta (até 3 vezes)
          if (Date.now() - entrouNoJogoEm < 2000 && refocosNoJogo < 3) {
            refocosNoJogo++;
            janelasWin.trazerParaFrente(janela.getNativeWindowHandle());
            janela.focus();
            janela.webContents.focus();
            return;
          }
          // depois disso, perder o foco = você clicou de volta no jogo: a ilha some sozinha
          sairDaIlhaNoJogo();
        }
      }, 160);
    });
    vigiarCopiados();
    ligarDiagClique();
    servicos.configurarLog(log);
    iniciarAtualizacoes();
    janela.webContents.once('did-finish-load', avisarSeAtualizou);
    if (dados.silenciouNotif) silenciarNoFoco(false); // a ilha fechou no meio de um foco: devolve as notificações
    servicos.vigiarDownloads((d) => janela?.webContents.send('download', d));
    // (microfone/câmera: lidos pelo ajudante de mídia, sem abrir programas — ver "privacidade")
    lancador.definirCotacoes(servicos.lerCotacoes);
    servicos.atualizarCotacoes();
    setInterval(() => servicos.atualizarCotacoes(), 60 * 60 * 1000);
    lancador.iniciar(log, () => ocultaPorJogo);

    // Manda a posição do mouse para os olhinhos seguirem (só quando muda)
    let ultimoCursor = '';
    setInterval(() => {
      if (!janela || encerrando || janela.isDestroyed() || !visivel || (ocultaPorJogo && !mostrarMesmoEmJogo && !vozEmJogo)) return;
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
      setInterval(() => { if (!ocultaPorJogo) jogos.carregarGameBar(); }, 10 * 60 * 1000);
      setInterval(() => {
        if (encerrando || !janela) return;
        let info = null;
        try { info = janelasWin.estadoPrimeiroPlano(); } catch (e) { log('Erro no detector:', e.message); }
        if (!info) return;

        // Jogo aberto? Some depois de 0,5 s; volta 1,5 s depois de sair (evita piscar em telas de carregamento)
        const { jogo, motivo } = config.esconderEmJogos === false ? { jogo: false } : jogos.ehJogo(info, config);
        const agora = Date.now();
        // a própria ilha na frente (aberta por cima do jogo) não quer dizer que o jogo acabou
        const souEu = info.exe && path.win32.basename(info.exe).toLowerCase() === path.basename(process.execPath).toLowerCase();
        if (ocultaPorJogo && souEu) { semJogoDesde = 0; }
        else if (jogo) {
          semJogoDesde = 0;
          jogoDesde = jogoDesde || agora;
          if (!ocultaPorJogo && agora - jogoDesde >= 500) definirJogo(true, motivo);
        } else {
          jogoDesde = 0;
          semJogoDesde = semJogoDesde || agora;
          // só volta depois de 4 s fora do jogo: telas de carregamento e menus do jogo trocam de janela rapidinho,
          // e cada aparição da ilha por cima faz o Windows mostrar o ponteiro no jogo
          if (ocultaPorJogo && agora - semJogoDesde >= 4000) definirJogo(false);
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
          // exceção pelo título: ex. "WhatsApp" dentro do Chrome fica com a ilha normal
          const tituloJanela = String(info.titulo || '').toLowerCase();
          const excecao = (config.semDiscreto || []).some((t) => t && tituloJanela.includes(String(t).toLowerCase()));
          if (!excecao && (config.modoDiscreto === 'sempre' || (config.modoDiscreto !== 'nunca' && comAbas))) modo = 'maximizada-abas';
        }
        // O Windows às vezes tira o "sempre por cima" (ex.: quando a ilha abre junto com o Windows):
        // reforça ao mudar de modo e, com app maximizado, a cada ~3 s
        reforcoTopo = (reforcoTopo + 1) % 12;
        if (modo !== modoAtual) reforcarTopo(true);
        else if (modo !== 'normal' && reforcoTopo === 0) reforcarTopo(false);
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
    desligarServidorWhisper();
    if (dados.silenciouNotif) silenciarNoFoco(false);
    globalShortcut.unregisterAll();
    ajudanteMidia?.kill();
    servidor?.close();
  });
  app.on('window-all-closed', () => app.quit());
}
