// Buscador da ilha: apps instalados, arquivos, configurações do Windows e comandos.
const { app, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

let apps = [];          // { nome, appId, lnk? }
let arquivos = [];      // { nome, caminho, pasta }
const icones = new Map(); // caminho -> dataURL
let log = () => {};
let estadoSistema = {};

const norm = (t) => String(t || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------------------
// Índices
// ---------------------------------------------------------------------------
function indexarApps() {
  if (process.platform !== 'win32') return;
  const cmd = '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { windowsHide: true, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (erro, saida) => {
      if (erro) { log('Falha ao listar apps:', erro.message); return; }
      try {
        let lista = JSON.parse(saida.trim() || '[]');
        if (!Array.isArray(lista)) lista = [lista];
        const lnks = atalhosDoMenuIniciar();
        apps = lista
          .filter((a) => a && a.Name && a.AppID)
          .filter((a) => !/^(uninstall|desinstalar)/i.test(a.Name))
          .map((a) => {
            const lnk = lnks.get(norm(a.Name)) || null;
            return { nome: a.Name, appId: a.AppID, lnk, ic: lnk, n: norm(a.Name) };
          });
        log(`Apps indexados: ${apps.length}`);
        iconesDaLoja();
      } catch (e) { log('Lista de apps inválida:', e.message); }
    });
}

// Apps da Microsoft Store (WhatsApp, Spotify da Store...) não têm atalho .lnk:
// o ícone vem do logo declarado no pacote do app
function iconesDaLoja() {
  const semIcone = apps.filter((a) => !a.ic && a.appId.includes('!'));
  if (!semIcone.length) return;
  const script = [
    '[Console]::OutputEncoding=[Text.Encoding]::UTF8',
    '$r=@{}',
    'foreach($p in Get-AppxPackage){ try {',
    '  $m=[xml](Get-Content (Join-Path $p.InstallLocation "AppxManifest.xml") -Raw -ErrorAction Stop)',
    '  foreach($a in @($m.Package.Applications.Application)){',
    '    $ve=$a.VisualElements; $logo=$ve.Square44x44Logo; if(-not $logo){$logo=$ve.Square150x150Logo}; if(-not $logo){continue}',
    '    $base=Join-Path $p.InstallLocation $logo; $dir=Split-Path $base',
    '    $nome=[IO.Path]::GetFileNameWithoutExtension($base); $ext=[IO.Path]::GetExtension($base)',
    '    $cands=@(Get-ChildItem -LiteralPath $dir -Filter "$nome*$ext" -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch "contrast|unplated_light|lightunplated" })',
    '    $c=($cands | Where-Object { $_.Name -match "targetsize-48" } | Select-Object -First 1)',
    '    if(-not $c){ $c=($cands | Sort-Object Length -Descending | Select-Object -First 1) }',
    '    if(-not $c -and (Test-Path -LiteralPath $base)){ $c=Get-Item -LiteralPath $base }',
    '    if($c){ $r["$($p.PackageFamilyName)!$($a.Id)"]=$c.FullName }',
    '  } } catch {} }',
    '$r | ConvertTo-Json -Compress',
  ].join('\n');
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8', timeout: 60000 }, (erro, saida) => {
      if (erro) { log('Ícones da Loja: falhou', erro.message); return; }
      try {
        const mapa = JSON.parse(saida.trim() || '{}');
        let n = 0;
        for (const a of apps) {
          if (!a.ic && mapa[a.appId]) { a.ic = mapa[a.appId]; n++; }
        }
        log(`Ícones da Loja: ${n} apps`);
      } catch (e) { log('Ícones da Loja: resposta inválida', e.message); }
    });
}

function atalhosDoMenuIniciar() {
  const mapa = new Map();
  const raizes = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft\\Windows\\Start Menu\\Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft\\Windows\\Start Menu\\Programs'),
  ];
  const andar = (dir, nivel) => {
    if (nivel > 4) return;
    let itens = [];
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) andar(p, nivel + 1);
      else if (it.name.toLowerCase().endsWith('.lnk')) mapa.set(norm(it.name.slice(0, -4)), p);
    }
  };
  raizes.forEach((r) => andar(r, 0));
  return mapa;
}

const PASTAS_IGNORADAS = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', '.cache', '.vscode', '__pycache__', 'venv', '.venv']);

async function indexarArquivos() {
  const nomes = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'];
  const raizes = [...new Set(nomes.map((n) => { try { return app.getPath(n); } catch { return null; } }).filter(Boolean))];
  const lista = [];
  const LIMITE = 40000;
  const andar = async (dir, nivel) => {
    if (nivel > 5 || lista.length >= LIMITE) return;
    let itens = [];
    try { itens = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of itens) {
      if (lista.length >= LIMITE) return;
      if (it.name.startsWith('.') || it.name.startsWith('~$')) continue;
      const p = path.join(dir, it.name);
      if (it.isDirectory()) {
        if (PASTAS_IGNORADAS.has(it.name.toLowerCase())) continue;
        lista.push({ nome: it.name, caminho: p, pasta: true, n: norm(it.name) });
        await andar(p, nivel + 1);
      } else if (it.isFile()) {
        lista.push({ nome: it.name, caminho: p, pasta: false, n: norm(it.name) });
      }
    }
  };
  for (const r of raizes) await andar(r, 0);
  arquivos = lista;
  log(`Arquivos indexados: ${arquivos.length}`);
}

function iniciar(funcaoLog, emJogo = () => false) {
  log = funcaoLog || log;
  indexarApps();
  indexarArquivos();
  // durante um jogo não reindexa (abrir o PowerShell no meio do jogo pode fazer o ponteiro aparecer)
  setInterval(() => { if (!emJogo()) indexarApps(); }, 10 * 60 * 1000);
  setInterval(() => { if (!emJogo()) indexarArquivos(); }, 15 * 60 * 1000);
}

function atualizarEstadoSistema(e) { estadoSistema = { ...estadoSistema, ...e }; }

// ---------------------------------------------------------------------------
// Comandos fixos (configurações e ações do Windows)
// ---------------------------------------------------------------------------
const CONFIG = (titulo, uri, palavras, icone = '⚙') => ({ titulo, sub: 'Configurações do Windows', icone, palavras, acao: { tipo: 'uri', uri } });

const COMANDOS = [
  // Ações diretas
  { titulo: 'Bloquear o computador', sub: 'Ação', icone: '🔒', palavras: 'bloquear trancar lock', acao: { tipo: 'sistema', id: 'bloquear' } },
  { titulo: 'Suspender', sub: 'Ação', icone: '🌙', palavras: 'suspender dormir sleep hibernar', acao: { tipo: 'sistema', id: 'suspender' }, confirmar: true },
  { titulo: 'Desligar o computador', sub: 'Ação · pede confirmação', icone: '⏻', palavras: 'desligar shutdown', acao: { tipo: 'sistema', id: 'desligar' }, confirmar: true },
  { titulo: 'Reiniciar o computador', sub: 'Ação · pede confirmação', icone: '↻', palavras: 'reiniciar restart reboot', acao: { tipo: 'sistema', id: 'reiniciar' }, confirmar: true },
  { titulo: 'Sair da conta (logoff)', sub: 'Ação · pede confirmação', icone: '⇥', palavras: 'sair logoff deslogar encerrar sessao', acao: { tipo: 'sistema', id: 'logoff' }, confirmar: true },
  { titulo: 'Esvaziar a Lixeira', sub: 'Ação · apaga de vez · pede confirmação', icone: '🗑', palavras: 'esvaziar lixeira limpar lixo', acao: { tipo: 'sistema', id: 'lixeira' }, confirmar: true },
  { titulo: 'Abrir a Lixeira', sub: 'Pasta', icone: '🗑', palavras: 'lixeira recycle', acao: { tipo: 'uri', uri: 'shell:RecycleBinFolder' } },
  { titulo: 'Mostrar a área de trabalho', sub: 'Ação', icone: '▭', palavras: 'area de trabalho desktop minimizar tudo', acao: { tipo: 'sistema', id: 'desktop' } },
  { titulo: 'Recortar a tela (print)', sub: 'Ação', icone: '✂', palavras: 'print captura recorte screenshot', acao: { tipo: 'uri', uri: 'ms-screenclip:' } },
  { titulo: 'Gerenciador de Tarefas', sub: 'App do sistema', icone: '📊', palavras: 'gerenciador tarefas task manager processos', acao: { tipo: 'exe', exe: 'taskmgr' } },
  { titulo: 'Alternar modo escuro / claro', sub: 'Ação', icone: '◐', palavras: 'modo escuro claro dark light tema', acao: { tipo: 'sistema', id: 'tema' } },
  { titulo: 'Ligar/desligar Wi-Fi', sub: 'Controle rápido', icone: '📶', palavras: 'wifi wi-fi internet rede sem fio', acao: { tipo: 'sistema', id: 'wifi' } },
  { titulo: 'Ligar/desligar Bluetooth', sub: 'Controle rápido', icone: 'ᛒ', palavras: 'bluetooth bt fone', acao: { tipo: 'sistema', id: 'bt' } },
  { titulo: 'Ativar/desativar som (mudo)', sub: 'Controle rápido', icone: '🔇', palavras: 'mudo silenciar mute som', acao: { tipo: 'sistema', id: 'mudo' } },
  { titulo: 'Explorador de Arquivos', sub: 'App do sistema', icone: '📁', palavras: 'explorador arquivos pastas explorer', acao: { tipo: 'exe', exe: 'explorer' } },
  { titulo: 'Prompt de Comando', sub: 'App do sistema', icone: '⌨', palavras: 'cmd prompt comando terminal', acao: { tipo: 'exe', exe: 'cmd' } },
  { titulo: 'Painel de Controle', sub: 'App do sistema', icone: '🛠', palavras: 'painel de controle control panel', acao: { tipo: 'exe', exe: 'control' } },

  // Configurações
  CONFIG('Wi-Fi', 'ms-settings:network-wifi', 'wifi wi-fi redes internet', '📶'),
  CONFIG('Rede e Internet', 'ms-settings:network', 'rede internet ethernet cabo ip'),
  CONFIG('Bluetooth e dispositivos', 'ms-settings:bluetooth', 'bluetooth dispositivos parear fone mouse teclado', 'ᛒ'),
  CONFIG('Modo avião', 'ms-settings:network-airplanemode', 'modo aviao airplane', '✈'),
  CONFIG('VPN', 'ms-settings:network-vpn', 'vpn'),
  CONFIG('Hotspot móvel', 'ms-settings:network-mobilehotspot', 'hotspot roteador compartilhar internet'),
  CONFIG('Som', 'ms-settings:sound', 'som audio volume alto falante microfone saida entrada', '🔊'),
  CONFIG('Mixer de volume', 'ms-settings:apps-volume', 'mixer volume por app', '🎚'),
  CONFIG('Tela', 'ms-settings:display', 'tela monitor resolucao escala brilho display', '🖥'),
  CONFIG('Luz noturna', 'ms-settings:nightlight', 'luz noturna night light filtro azul', '🌙'),
  CONFIG('Energia e bateria', 'ms-settings:powersleep', 'energia bateria suspensao desligar tela economia', '🔋'),
  CONFIG('Personalização', 'ms-settings:personalization', 'personalizacao papel de parede wallpaper tema cores', '🎨'),
  CONFIG('Papel de parede', 'ms-settings:personalization-background', 'papel de parede wallpaper fundo', '🖼'),
  CONFIG('Cores e modo escuro', 'ms-settings:colors', 'cores modo escuro claro destaque', '◐'),
  CONFIG('Barra de tarefas', 'ms-settings:taskbar', 'barra de tarefas taskbar'),
  CONFIG('Aplicativos instalados', 'ms-settings:appsfeatures', 'aplicativos programas desinstalar instalados apps'),
  CONFIG('Aplicativos padrão', 'ms-settings:defaultapps', 'aplicativos padrao navegador padrao'),
  CONFIG('Inicialização', 'ms-settings:startupapps', 'inicializacao iniciar com windows startup'),
  CONFIG('Windows Update', 'ms-settings:windowsupdate', 'windows update atualizacao atualizar', '⟳'),
  CONFIG('Armazenamento', 'ms-settings:storagesense', 'armazenamento espaco disco hd ssd limpeza'),
  CONFIG('Sobre o PC', 'ms-settings:about', 'sobre sistema especificacoes nome do pc versao'),
  CONFIG('Data e hora', 'ms-settings:dateandtime', 'data hora relogio fuso'),
  CONFIG('Idioma e teclado', 'ms-settings:regionlanguage', 'idioma teclado regiao lingua'),
  CONFIG('Mouse', 'ms-settings:mousetouchpad', 'mouse ponteiro cursor touchpad'),
  CONFIG('Impressoras', 'ms-settings:printers', 'impressora impressoras scanner', '🖨'),
  CONFIG('Privacidade: microfone', 'ms-settings:privacy-microphone', 'privacidade microfone permissao'),
  CONFIG('Privacidade: câmera', 'ms-settings:privacy-webcam', 'privacidade camera webcam'),
  CONFIG('Notificações', 'ms-settings:notifications', 'notificacoes nao perturbe foco', '🔔'),
  CONFIG('Contas', 'ms-settings:yourinfo', 'conta usuario senha login'),
  CONFIG('Segurança do Windows', 'windowsdefender:', 'seguranca antivirus defender virus', '🛡'),
  CONFIG('Configurações', 'ms-settings:', 'configuracoes ajustes settings'),
].map((c) => ({ ...c, n: norm(c.titulo), p: norm(c.palavras) }));

// ---------------------------------------------------------------------------
// Pontuação
// ---------------------------------------------------------------------------
function pontuar(q, nome, extra = '') {
  if (!q) return 0;
  if (nome === q) return 1000;
  if (nome.startsWith(q)) return 800 - Math.min(nome.length, 100);
  const palavras = nome.split(/[\s\-_.()]+/);
  if (palavras.some((p) => p.startsWith(q))) return 600 - Math.min(nome.length, 100);
  // iniciais: "vsc" -> "Visual Studio Code"
  const iniciais = palavras.map((p) => p[0] || '').join('');
  if (q.length >= 2 && iniciais.startsWith(q)) return 550;
  if (nome.includes(q)) return 400 - Math.min(nome.length, 100);
  if (extra && extra.split(' ').some((p) => p.startsWith(q))) return 350;
  if (extra && extra.includes(q)) return 250;
  // todas as palavras da busca aparecem
  const termos = q.split(' ');
  if (termos.length > 1 && termos.every((t) => nome.includes(t) || extra.includes(t))) return 300;
  return 0;
}

// Calculadora simples e segura (sem eval)
function calcular(expr) {
  const e = expr.replace(/,/g, '.').replace(/x/gi, '*').replace(/\s+/g, '');
  if (!/^[\d+\-*/().%^]+$/.test(e) || !/[+\-*/%^]/.test(e) || !/\d/.test(e)) return null;
  let i = 0;
  const ver = () => e[i];
  const numero = () => {
    if (ver() === '(') { i++; const v = soma(); if (ver() !== ')') throw 0; i++; return v; }
    if (ver() === '-') { i++; return -numero(); }
    const m = e.slice(i).match(/^\d+(\.\d+)?/);
    if (!m) throw 0;
    i += m[0].length;
    let v = Number(m[0]);
    if (ver() === '%') { i++; v /= 100; }
    return v;
  };
  const potencia = () => { const b = numero(); if (ver() === '^') { i++; return b ** potencia(); } return b; };
  const produto = () => {
    let v = potencia();
    while (ver() === '*' || ver() === '/') { const op = e[i++]; const d = potencia(); v = op === '*' ? v * d : v / d; }
    return v;
  };
  const soma = () => {
    let v = produto();
    while (ver() === '+' || ver() === '-') { const op = e[i++]; const d = produto(); v = op === '+' ? v + d : v - d; }
    return v;
  };
  try {
    const r = soma();
    if (i !== e.length || !Number.isFinite(r)) return null;
    return Math.round(r * 1e10) / 1e10;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Conversões: moedas (cotação do dia) e unidades
// ---------------------------------------------------------------------------
let lerCotacoes = () => null;
function definirCotacoes(fn) { lerCotacoes = fn; }

const MOEDAS = {
  usd: 'USD', dolar: 'USD', dolares: 'USD', 'us$': 'USD', $: 'USD',
  brl: 'BRL', real: 'BRL', reais: 'BRL', 'r$': 'BRL',
  eur: 'EUR', euro: 'EUR', euros: 'EUR', '€': 'EUR',
  gbp: 'GBP', libra: 'GBP', libras: 'GBP', '£': 'GBP',
  jpy: 'JPY', iene: 'JPY', ienes: 'JPY', ars: 'ARS', 'peso argentino': 'ARS', 'pesos argentinos': 'ARS',
  cad: 'CAD', 'dolar canadense': 'CAD', 'dolares canadenses': 'CAD', cny: 'CNY', yuan: 'CNY',
  chf: 'CHF', 'franco suico': 'CHF', clp: 'CLP', 'peso chileno': 'CLP', mxn: 'MXN', 'peso mexicano': 'MXN',
};
const NOME_MOEDA = { USD: 'dólares', BRL: 'reais', EUR: 'euros', GBP: 'libras', JPY: 'ienes', ARS: 'pesos argentinos', CAD: 'dólares canadenses', CNY: 'yuans', CHF: 'francos suíços', CLP: 'pesos chilenos', MXN: 'pesos mexicanos' };

// grandeza, fator para a unidade base
const UNIDADES = {
  km: ['comp', 1000], quilometro: ['comp', 1000], quilometros: ['comp', 1000], m: ['comp', 1], metro: ['comp', 1], metros: ['comp', 1],
  cm: ['comp', 0.01], centimetros: ['comp', 0.01], mm: ['comp', 0.001], mi: ['comp', 1609.344], milha: ['comp', 1609.344], milhas: ['comp', 1609.344],
  ft: ['comp', 0.3048], pe: ['comp', 0.3048], pes: ['comp', 0.3048], in: ['comp', 0.0254], polegada: ['comp', 0.0254], polegadas: ['comp', 0.0254],
  yd: ['comp', 0.9144], jarda: ['comp', 0.9144], jardas: ['comp', 0.9144],
  kg: ['massa', 1], quilo: ['massa', 1], quilos: ['massa', 1], g: ['massa', 0.001], grama: ['massa', 0.001], gramas: ['massa', 0.001],
  mg: ['massa', 1e-6], t: ['massa', 1000], tonelada: ['massa', 1000], toneladas: ['massa', 1000],
  lb: ['massa', 0.45359237], lbs: ['massa', 0.45359237], oz: ['massa', 0.028349523], onca: ['massa', 0.028349523], oncas: ['massa', 0.028349523],
  l: ['vol', 1], litro: ['vol', 1], litros: ['vol', 1], ml: ['vol', 0.001], gal: ['vol', 3.785411784], galao: ['vol', 3.785411784], galoes: ['vol', 3.785411784],
  xicara: ['vol', 0.24], xicaras: ['vol', 0.24],
  'km/h': ['vel', 1], kmh: ['vel', 1], mph: ['vel', 1.609344], 'm/s': ['vel', 3.6],
  b: ['dados', 1], byte: ['dados', 1], bytes: ['dados', 1], kb: ['dados', 1024], mb: ['dados', 1024 ** 2], gb: ['dados', 1024 ** 3], tb: ['dados', 1024 ** 4],
  c: ['temp', 'c'], celsius: ['temp', 'c'], '°c': ['temp', 'c'], f: ['temp', 'f'], fahrenheit: ['temp', 'f'], '°f': ['temp', 'f'], k: ['temp', 'k'], kelvin: ['temp', 'k'],
};

const numeroBR = (t) => {
  let x = String(t).trim();
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, '').replace(',', '.');
  else x = x.replace(',', '.');
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const formatar = (n, casas = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(n) < 1 ? 6 : casas });

function converter(textoNorm) {
  const t = textoNorm.replace(/\s+/g, ' ').trim();
  const m = t.match(/^([\d.,]+)\s*([^\d]+?)(?:\s+(?:em|para|pra|to|in|->|=)\s+(.+))?$/);
  if (!m) return null;
  const valor = numeroBR(m[1]);
  if (valor === null) return null;
  const de = m[2].trim();
  const para = (m[3] || '').trim();

  // moedas
  if (MOEDAS[de] && (!para || MOEDAS[para])) {
    const c = lerCotacoes();
    const A = MOEDAS[de];
    const B = para ? MOEDAS[para] : (A === 'BRL' ? 'USD' : 'BRL');
    if (A === B) return null;
    if (!c?.taxas?.[A] || !c.taxas[B]) return { titulo: `Cotação de ${A} indisponível (sem internet?)`, sub: 'Moedas' };
    const r = (valor / c.taxas[A]) * c.taxas[B];
    const unit = (1 / c.taxas[A]) * c.taxas[B];
    const hora = new Date(c.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return { titulo: `${formatar(valor)} ${NOME_MOEDA[A] || A} = ${formatar(r)} ${NOME_MOEDA[B] || B}`, sub: `1 ${A} = ${formatar(unit, 4)} ${B} · cotação das ${hora} · Enter copia`, copia: formatar(r) };
  }
  // unidades
  const U = UNIDADES[de];
  const V = para ? UNIDADES[para] : null;
  if (!U || !V || U[0] !== V[0]) return null;
  let r;
  if (U[0] === 'temp') {
    const c = U[1] === 'c' ? valor : U[1] === 'f' ? (valor - 32) * 5 / 9 : valor - 273.15;
    r = V[1] === 'c' ? c : V[1] === 'f' ? c * 9 / 5 + 32 : c + 273.15;
  } else {
    r = (valor * U[1]) / V[1];
  }
  return { titulo: `${formatar(valor)} ${de} = ${formatar(r, 4)} ${para}`, sub: 'Conversão · Enter copia', copia: formatar(r, 4) };
}

function listarApps() {
  return apps.map((a) => ({ nome: a.nome, appId: a.appId, lnk: a.ic || a.lnk }));
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------
let resultadosAtuais = new Map();
let contador = 0;

function registrar(r) {
  const id = 'r' + (++contador);
  resultadosAtuais.set(id, r);
  const { acao, ...visivel } = r;
  return { id, ...visivel };
}

function buscar(texto) {
  resultadosAtuais = new Map();
  const bruto = String(texto || '').trim();
  const q = norm(bruto);
  const saida = [];
  if (!q) {
    // Sugestões ao abrir: controles e configurações mais usados
    ['Ligar/desligar Wi-Fi', 'Ligar/desligar Bluetooth', 'Alternar modo escuro / claro', 'Som', 'Tela', 'Bloquear o computador']
      .map((t) => COMANDOS.find((c) => c.titulo === t))
      .filter(Boolean)
      .forEach((c) => saida.push(registrar(comandoVisivel(c))));
    return saida;
  }

  // Comandos com valor: "volume 40", "brilho 70", "vol 0"
  let m = q.match(/^(?:volume|vol|som)\s*(?:em|para|a)?\s*(\d{1,3})\s*%?$/);
  if (m) saida.push(registrar({ titulo: `Volume em ${Math.min(100, +m[1])}%`, sub: 'Enter para aplicar', icone: '🔊', acao: { tipo: 'sistema', id: 'vol', valor: Math.min(100, +m[1]) } }));
  m = q.match(/^(?:brilho|luz|brightness)\s*(?:em|para|a)?\s*(\d{1,3})\s*%?$/);
  if (m) saida.push(registrar({ titulo: `Brilho em ${Math.min(100, +m[1])}%`, sub: 'Enter para aplicar', icone: '☀', acao: { tipo: 'sistema', id: 'brilho', valor: Math.min(100, +m[1]) } }));

  // Conversões (moedas e unidades)
  const conv = converter(q.replace(/\$/g, '$ ').replace(/r\$ /, 'r$'));
  if (conv) saida.push(registrar({ titulo: conv.titulo, sub: conv.sub, icone: '⇄', acao: conv.copia ? { tipo: 'copiar', texto: conv.copia } : { tipo: 'nada' } }));

  // Calculadora
  const conta = calcular(bruto.replace(/^=/, ''));
  if (conta !== null) {
    const valor = conta.toLocaleString('pt-BR', { maximumFractionDigits: 10 });
    saida.push(registrar({ titulo: `= ${valor}`, sub: 'Enter para copiar o resultado', icone: '🧮', acao: { tipo: 'copiar', texto: String(conta).replace('.', ',') } }));
  }

  // Endereço de site
  if (/^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(bruto) && !/\s/.test(bruto) && !/^\d+(\.\d+)+$/.test(bruto)) {
    const url = /^https?:\/\//i.test(bruto) ? bruto : 'https://' + bruto;
    saida.push(registrar({ titulo: `Abrir ${bruto}`, sub: 'Site', icone: '🌐', acao: { tipo: 'url', url } }));
  }

  // Apps, comandos e arquivos, por relevância
  const candidatos = [];
  for (const a of apps) {
    const s = pontuar(q, a.n);
    if (s) candidatos.push({ s: s + 120, r: { titulo: a.nome, sub: 'Aplicativo', tipo: 'app', iconeArquivo: a.ic, icone: '▢', acao: { tipo: 'app', appId: a.appId } } });
  }
  for (const c of COMANDOS) {
    const s = pontuar(q, c.n, c.p);
    if (s) candidatos.push({ s: s + 60, r: comandoVisivel(c) });
  }
  if (q.length >= 2) {
    let achados = 0;
    for (const f of arquivos) {
      const s = pontuar(q, f.n);
      if (!s) continue;
      candidatos.push({ s: s - (f.pasta ? 20 : 40), r: { titulo: f.nome, sub: encurtar(path.dirname(f.caminho)), tipo: 'arquivo', iconeArquivo: f.caminho, icone: f.pasta ? '📁' : '📄', acao: { tipo: 'arquivo', caminho: f.caminho }, caminho: f.caminho } });
      if (++achados > 400) break;
    }
  }
  candidatos.sort((a, b) => b.s - a.s);
  const vistos = new Set();
  for (const c of candidatos) {
    const chave = c.r.titulo + '|' + c.r.sub;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(registrar(c.r));
    if (saida.length >= 7) break;
  }

  // Sempre no fim: pesquisar na web e perguntar ao Claude
  saida.push(registrar({ titulo: `Pesquisar "${bruto}" no Google`, sub: 'Web', icone: '🔎', acao: { tipo: 'url', url: 'https://www.google.com/search?q=' + encodeURIComponent(bruto) } }));
  saida.push(registrar({ titulo: `Perguntar ao Claude: "${bruto}"`, sub: 'Abre o app Claude com a pergunta', icone: '✳', acao: { tipo: 'claude', texto: bruto } }));
  return saida;
}

function comandoVisivel(c) {
  let titulo = c.titulo;
  const id = c.acao.id;
  if (id === 'wifi' && estadoSistema.wifi != null) titulo = estadoSistema.wifi ? 'Desligar o Wi-Fi' : 'Ligar o Wi-Fi';
  if (id === 'bt' && estadoSistema.bt != null) titulo = estadoSistema.bt ? 'Desligar o Bluetooth' : 'Ligar o Bluetooth';
  if (id === 'mudo' && estadoSistema.mudo != null) titulo = estadoSistema.mudo ? 'Ativar o som' : 'Silenciar (mudo)';
  return { titulo, sub: c.sub, icone: c.icone, confirmar: !!c.confirmar, acao: c.acao };
}

function encurtar(dir) {
  const casa = app.getPath('home');
  return dir.startsWith(casa) ? '~' + dir.slice(casa.length) : dir;
}

// Ícones reais de apps e arquivos (carregados sob demanda)
async function icone(caminho) {
  if (!caminho) return null;
  if (icones.has(caminho)) return icones.get(caminho);
  try {
    let img = null;
    if (/\.(png|jpe?g)$/i.test(caminho)) {
      // logo de app da Loja: a própria imagem
      img = nativeImage.createFromPath(caminho);
      if (!img.isEmpty()) img = img.resize({ width: 32, height: 32, quality: 'best' });
    } else {
      // atalho .lnk: o ícone do programa de verdade (o do atalho às vezes vem genérico)
      if (/\.lnk$/i.test(caminho)) {
        try {
          const alvo = shell.readShortcutLink(caminho);
          const origem = alvo.icon && fs.existsSync(alvo.icon) ? alvo.icon : alvo.target;
          if (origem && fs.existsSync(origem)) img = await app.getFileIcon(origem, { size: 'large' });
        } catch { /* usa o do atalho */ }
      }
      if (!img || img.isEmpty()) img = await app.getFileIcon(caminho, { size: 'large' });
    }
    const url = !img || img.isEmpty() ? null : img.toDataURL();
    icones.set(caminho, url);
    return url;
  } catch {
    icones.set(caminho, null);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------
function abrirShell(alvo) {
  spawn('explorer.exe', [alvo], { detached: true, windowsHide: true }).unref();
}

/**
 * @param {string} id resultado escolhido
 * @param {(cmd:string)=>void} sistema envia comandos ao ajudante (volume, brilho, wifi...)
 * @returns {{ok:boolean, aviso?:string}}
 */
function executar(id, sistema, extras) {
  const r = resultadosAtuais.get(id);
  if (!r) return { ok: false };
  const a = r.acao;
  switch (a.tipo) {
    case 'app': abrirShell('shell:AppsFolder\\' + a.appId); return { ok: true, aviso: `Abrindo ${r.titulo}` };
    case 'arquivo': shell.openPath(a.caminho); return { ok: true, aviso: `Abrindo ${r.titulo}` };
    case 'uri': shell.openExternal(a.uri).catch(() => abrirShell(a.uri)); return { ok: true, aviso: r.titulo };
    case 'url': shell.openExternal(a.url); return { ok: true, aviso: 'Abrindo no navegador' };
    case 'exe': spawn('cmd.exe', ['/c', 'start', '""', a.exe], { detached: true, windowsHide: true }).unref(); return { ok: true, aviso: `Abrindo ${r.titulo}` };
    case 'copiar': extras.copiar(a.texto); return { ok: true, aviso: `Copiado: ${a.texto}` };
    case 'claude': extras.claude(a.texto); return { ok: true, aviso: 'Abrindo no Claude' };
    case 'sistema': return executarSistema(a.id, a.valor, sistema, extras);
    case 'nada': return { ok: false };
    default: return { ok: false };
  }
}

function executarSistema(id, valor, sistema, extras) {
  switch (id) {
    case 'vol': sistema(`vol ${valor}`); return { ok: true, aviso: `Volume em ${valor}%` };
    case 'brilho': sistema(`brilho ${valor}`); return { ok: true, aviso: `Brilho em ${valor}%` };
    case 'wifi': sistema('wifi toggle'); return { ok: true, aviso: 'Wi-Fi alternado' };
    case 'bt': sistema('bt toggle'); return { ok: true, aviso: 'Bluetooth alternado' };
    case 'mudo': sistema('mudo toggle'); return { ok: true, aviso: 'Som alternado' };
    case 'tema': return { ok: true, aviso: extras.alternarTema() ? 'Modo escuro ativado' : 'Modo claro ativado' };
    case 'bloquear': spawn('rundll32.exe', ['user32.dll,LockWorkStation'], { detached: true }).unref(); return { ok: true };
    case 'suspender':
      // Suspensão via API do Windows (não hiberna se a hibernação estiver desligada)
      spawn('powershell.exe', ['-NoProfile', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState("Suspend", $false, $false)'], { detached: true, windowsHide: true }).unref();
      return { ok: true };
    case 'desligar': spawn('shutdown.exe', ['/s', '/t', '0'], { detached: true }).unref(); return { ok: true };
    case 'reiniciar': spawn('shutdown.exe', ['/r', '/t', '0'], { detached: true }).unref(); return { ok: true };
    case 'logoff': spawn('shutdown.exe', ['/l'], { detached: true }).unref(); return { ok: true };
    case 'lixeira':
      spawn('powershell.exe', ['-NoProfile', '-Command', 'Clear-RecycleBin -Force -ErrorAction SilentlyContinue'], { detached: true, windowsHide: true }).unref();
      return { ok: true, aviso: 'Lixeira esvaziada' };
    case 'desktop': abrirShell('shell:::{3080F90D-D7AD-11D9-BD98-0000947B0257}'); return { ok: true };
    default: return { ok: false };
  }
}

module.exports = { iniciar, buscar, executar, executarSistema, icone, atualizarEstadoSistema, calcular, converter, definirCotacoes, listarApps };
