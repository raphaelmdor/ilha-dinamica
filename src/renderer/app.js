import { Voz, falar } from './voice.js';
import { interpretar, LISTA_AJUDA, frasesDeComando, acharApp, escolherIntencao } from './intents.js';
import { Olhos } from './olhos.js';
import { iniciarWidgets } from './widgets.js';

const $ = (id) => document.getElementById(id);
const ilha = $('ilha');
const olhos = new Olhos();
// Fora do Electron (abrindo o HTML no navegador para testar o visual) usa um simulador
const api = window.ilhaAPI || {
  on() {}, interativo() {}, acao: async () => true,
  lerConfig: async () => ({}), garantirModelo: async () => ({ ok: false, erro: 'modo navegador' }),
  buscar: async (q) => (q ? [
    { id: 'a', titulo: 'Visual Studio Code', sub: 'Aplicativo', icone: '▢' },
    { id: 'b', titulo: 'Desligar o computador', sub: 'Ação · pede confirmação', icone: '⏻', confirmar: true },
    { id: 'c', titulo: 'curriculo-raphael.pdf', sub: '~\\Documents', icone: '📄' },
    { id: 'd', titulo: `Pesquisar "${q}" no Google`, sub: 'Web', icone: '🔎' },
  ] : [{ id: 'w', titulo: 'Desligar o Wi-Fi', sub: 'Controle rápido', icone: '📶' }, { id: 's', titulo: 'Som', sub: 'Configurações do Windows', icone: '🔊' }]),
  executarBusca: async () => ({ ok: true, aviso: 'Teste' }), iconeArquivo: async () => null,
  fecharBusca() {}, sistema() {}, alternarTema: async () => true,
  teclado() {}, lerDados: async () => ({}), salvarDados: async () => true, recursos: async () => ({ cpu: 23, nucleos: 8, ramTotal: 16e9, ramUsada: 9.4e9, discoTotal: 480e9, discoUsado: 310e9, uptime: 93000 }),
  clima: async () => ({ ok: true, cidade: 'Niterói', atual: { temperature_2m: 27.4, apparent_temperature: 30, relative_humidity_2m: 72, wind_speed_10m: 12, weather_code: 2 }, diario: { time: ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'], weather_code: [2, 61, 3, 0], temperature_2m_max: [29, 26, 27, 31], temperature_2m_min: [21, 20, 20, 22], precipitation_probability_max: [10, 80, 30, 0] } }),
  copiar() {}, limparCopiados() {}, abrirConfiguracoes() {},
};

const estado = {
  vista: 'compacta',
  fixada: false,       // clicou para manter aberta
  hover: false,
  midia: { ativo: false },
  timer: null,         // { fim, total }
  config: {},
  bateria: null,
};

// ---------------------------------------------------------------------------
// Controle das vistas
// ---------------------------------------------------------------------------
let timeoutAviso = null;
let timeoutRecolher = null;

function mostrar(vista) {
  estado.vista = vista;
  ilha.dataset.estado = vista;
  if (vista !== 'aviso') ilha.classList.remove('alto', 'com-botoes');
}

function vistaPadrao() {
  if (voz.escutandoComando) return 'escuta';
  return estado.hover || estado.fixada ? 'expandida' : 'compacta';
}

function voltarAoPadrao() {
  clearTimeout(timeoutAviso);
  mostrar(vistaPadrao());
}

function aviso(titulo, sub = '', { icone = '✓', tipo = '', ms = 2600, alto = false, botoes = [] } = {}) {
  clearTimeout(timeoutAviso);
  const caixa = $('avisoBotoes');
  caixa.innerHTML = '';
  for (const b of botoes) {
    const bt = document.createElement('button');
    bt.textContent = b.texto;
    bt.addEventListener('click', (e) => { e.stopPropagation(); b.acao(); voltarAoPadrao(); });
    caixa.appendChild(bt);
  }
  // avisos com ações (download, atualização, novidades...) ganham um × para fechar
  if (botoes.length || alto) {
    const x = document.createElement('button');
    x.className = 'fechar-aviso';
    x.textContent = '×';
    x.title = 'Fechar';
    x.setAttribute('aria-label', 'Fechar aviso');
    x.addEventListener('click', (e) => { e.stopPropagation(); clearTimeout(timeoutAviso); voltarAoPadrao(); });
    caixa.appendChild(x);
  }
  ilha.classList.toggle('com-botoes', botoes.length > 0 || alto);
  $('avisoTitulo').textContent = titulo;
  $('avisoSub').innerHTML = '';
  if (Array.isArray(sub)) {
    sub.forEach((linha) => {
      const d = document.createElement('div');
      d.textContent = '• ' + linha;
      $('avisoSub').appendChild(d);
    });
  } else {
    $('avisoSub').textContent = sub;
  }
  const ic = $('avisoIcone');
  ic.textContent = icone;
  ic.className = 'aviso-icone ' + tipo;
  mostrar('aviso');
  ilha.classList.toggle('alto', alto);
  // painel alto do tamanho da lista (ajuda, novidades da versão...)
  if (alto && Array.isArray(sub)) {
    const e = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')) || 1;
    ilha.style.setProperty('--altura-aviso', Math.min(window.innerHeight - 10, (62 + sub.length * 21) * e) + 'px');
  } else {
    ilha.style.removeProperty('--altura-aviso');
  }
  // com botões, espera o mouse sair antes de sumir
  const fechar = () => { if (botoes.length && estado.hover) { timeoutAviso = setTimeout(fechar, 1000); return; } voltarAoPadrao(); };
  timeoutAviso = setTimeout(fechar, ms);
}

// Mouse: a janela deixa o clique "atravessar", menos em cima da ilha
ilha.addEventListener('mouseenter', () => {
  if (ilha.classList.contains('discreta') && estado.vista === 'compacta') return; // abre só parando o mouse (veja o cursor)
  estado.hover = true;
  api.interativo(true);
  clearTimeout(timeoutRecolher);
  if (estado.config.abrirAoPassar !== false) {
    timeoutRecolher = setTimeout(() => {
      if (estado.vista === 'compacta') abrirPainel();
    }, estado.config.atrasoAbrir ?? 140);
  }
  if (Math.random() < 0.35) olhos.reagir('surpreso', 500);
});
ilha.addEventListener('mouseleave', () => {
  estado.hover = false;
  estado.fixada = false;
  api.interativo(false);
  clearTimeout(timeoutRecolher);
  timeoutRecolher = setTimeout(() => {
    if (estado.vista === 'expandida' && !estado.fixada && !estado.teclado) mostrar('compacta');
  }, 220);
  if (estado.vista === 'busca' || estado.teclado) api.interativo(true); // continua clicável enquanto digita
});
ilha.addEventListener('click', (e) => {
  if (e.target.closest('button, input, textarea, .resultados, .controles-rapidos, .carrossel')) return;
  if (estado.vista === 'busca') return;
  if (estado.vista === 'aviso') { voltarAoPadrao(); return; }
  if (estado.vista === 'escuta') { voz.pararComando(); return; }
  if (e.target.closest('.olhos')) olhos.reagir('feliz', 1400); // carinho nos olhinhos
  // Clique na pílula abre o painel; ele fecha sozinho quando o mouse sai
  if (estado.vista === 'compacta' && !ilha.classList.contains('discreta')) abrirPainel();
});

function abrirPainel() {
  mostrar('expandida');
  api.sistema('estado');
  widgets?.aoAbrirPainel();
}

// Atalho do painel: abre (fica aberto até você passar o mouse e sair, ou apertar de novo)
let timeoutPainelTeclado = null;
api.on('painel:alternar', () => {
  clearTimeout(timeoutPainelTeclado);
  if (estado.vista === 'expandida') {
    estado.fixada = false;
    mostrar('compacta');
    return;
  }
  if (estado.vista === 'busca' || estado.vista === 'escuta') return;
  clearTimeout(timeoutAviso);
  estado.fixada = true;
  abrirPainel();
  olhos.reagir('surpreso', 600);
  // Se o mouse nem chegar perto em 8 s, recolhe sozinho
  timeoutPainelTeclado = setTimeout(() => {
    if (estado.vista === 'expandida' && !estado.hover && !estado.teclado) {
      estado.fixada = false;
      mostrar('compacta');
    }
  }, 8000);
});

// Quando a ilha devolve o teclado (clicou fora), recolhe se o mouse não está nela
api.on('teclado:fim', () => {
  estado.teclado = false;
  document.activeElement?.blur?.();
  if (!estado.hover) {
    api.interativo(false);
    if (estado.vista === 'expandida' && !estado.fixada) mostrar('compacta');
  }
});

// ---------------------------------------------------------------------------
// Relógio, data, bateria
// ---------------------------------------------------------------------------
let fmtHora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
function montarRelogio(c) {
  fmtHora = new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit',
    second: c.mostrarSegundos ? '2-digit' : undefined,
    hour12: c.relogio24h === false,
  });
}
const fmtData = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });

function atualizarRelogio() {
  const agora = new Date();
  $('horaGrande').textContent = fmtHora.format(agora);
  $('dataGrande').textContent = fmtData.format(agora).replace(/\./g, '');
  atualizarTextoCompacto();
}

function atualizarTextoCompacto() {
  const m = estado.midia;
  $('textoCompacto').textContent = m.ativo && m.status === 'Playing'
    ? m.titulo
    : fmtHora.format(new Date());
}

// Tempo da música (interpola entre as atualizações do Windows)
const fmtTempo = (s) => { s = Math.max(0, Math.floor(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function posicaoMusica() {
  const m = estado.midia;
  if (!m?.ativo || !m.dur) return null;
  let pos = m.pos || 0;
  if (m.status === 'Playing') {
    const base = m.quando && Date.now() - m.quando < 10 * 60000 ? m.quando : m.recebido;
    pos += (Date.now() - base) / 1000;
  }
  return Math.min(m.dur, Math.max(0, pos));
}
function desenharProgresso() {
  const pos = posicaoMusica();
  $('progresso').hidden = pos === null;
  if (pos === null) { ilha.style.setProperty('--prog', 0); return; }
  const dur = estado.midia.dur;
  $('tempoAtual').textContent = fmtTempo(pos);
  $('tempoTotal').textContent = fmtTempo(dur);
  $('preenchimento').style.width = (100 * pos / dur).toFixed(2) + '%';
  ilha.style.setProperty('--prog', (pos / dur).toFixed(4));
}
setInterval(desenharProgresso, 500);
$('trilhaMusica').addEventListener('click', (e) => {
  const m = estado.midia;
  if (!m?.dur) return;
  const r = e.currentTarget.getBoundingClientRect();
  const seg = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * m.dur;
  api.acao({ tipo: 'midia', cmd: 'seek', valor: seg });
  m.pos = seg; m.quando = Date.now(); m.recebido = Date.now();
  desenharProgresso();
});

async function iniciarBateria() {
  if (!navigator.getBattery) return;
  const b = await navigator.getBattery();
  const atualizar = () => {
    // PC de mesa: o Chromium informa 100% na tomada para sempre
    const desktop = b.level === 1 && b.charging && b.chargingTime === 0;
    $('chipBateria').hidden = desktop;
    const pct = Math.round(b.level * 100);
    $('nivelBateria').style.width = pct + '%';
    $('nivelBateria').parentElement.classList.toggle('baixa', pct <= 20 && !b.charging);
    $('textoBateria').textContent = pct + '%' + (b.charging ? ' ⚡' : '');
    estado.bateria = { pct, carregando: b.charging, desktop };
  };
  ['levelchange', 'chargingchange', 'chargingtimechange'].forEach((ev) => b.addEventListener(ev, atualizar));
  atualizar();
  const avisados = new Set();
  b.addEventListener('chargingchange', () => {
    if (estado.bateria?.desktop) return;
    const pct = Math.round(b.level * 100);
    if (b.charging) {
      avisados.clear();
      aviso('Carregando', `${pct}% · carregador conectado`, { icone: '⚡', tipo: 'info', ms: 2200 });
      olhos.reagir('feliz', 1500);
    } else {
      aviso('Na bateria', `${pct}% restantes`, { icone: '🔋', tipo: 'info', ms: 2000 });
    }
  });
  b.addEventListener('levelchange', () => {
    if (b.charging || estado.bateria?.desktop) return;
    const pct = Math.round(b.level * 100);
    for (const limite of [20, 10, 5]) {
      if (pct <= limite && !avisados.has(limite)) {
        avisados.add(limite);
        aviso(`Bateria fraca: ${pct}%`, limite <= 10 ? 'Conecte o carregador agora' : 'Hora de procurar o carregador', { icone: '🪫', tipo: 'erro', ms: 6000 });
        olhos.reagir('surpreso', 2000);
        if (limite <= 10) bipar(2);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Mídia
// ---------------------------------------------------------------------------
function atualizarMidia(m) {
  estado.midia = m || { ativo: false };
  const tocando = m.ativo && m.status === 'Playing';
  ilha.classList.toggle('com-midia', !!m.ativo && tocando);
  ilha.classList.toggle('tocando', tocando);
  ilha.classList.toggle('sem-midia', !m.ativo);
  $('titulo').textContent = m.ativo ? m.titulo : 'Nada tocando';
  $('artista').textContent = m.ativo ? (m.artista || nomeApp(m.app)) : 'Diga "ilha, ajuda" para ver os comandos';
  // a capa só chega quando a música muda; mantém a anterior enquanto for a mesma
  const chave = m.ativo ? `${m.titulo}|${m.artista}` : '';
  if (m.ativo && m.capa) {
    $('capaGrande').style.backgroundImage = `url("${m.capa}")`;
    estado.chaveCapa = chave;
  } else if (chave !== estado.chaveCapa) {
    $('capaGrande').style.backgroundImage = '';
    estado.chaveCapa = '';
  }
  estado.midia.recebido = Date.now();
  desenharProgresso();
  if (!voz.escutandoComando) olhos.definirBase(tocando ? 'musica' : 'normal');
  atualizarTextoCompacto();
}

function nomeApp(id = '') {
  const s = id.toLowerCase();
  if (s.includes('spotify')) return 'Spotify';
  if (s.includes('chrome')) return 'Chrome';
  if (s.includes('msedge') || s.includes('edge')) return 'Edge';
  if (s.includes('firefox')) return 'Firefox';
  if (s.includes('zune') || s.includes('media')) return 'Media Player';
  return id.split('!').pop() || '';
}

document.querySelectorAll('[data-midia]').forEach((botao) => {
  botao.addEventListener('click', () => api.acao({ tipo: 'midia', cmd: botao.dataset.midia }));
});

// ---------------------------------------------------------------------------
// Timer
// ---------------------------------------------------------------------------
function formatarDuracao(seg) {
  seg = Math.max(0, Math.ceil(seg));
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return (h ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

function descreverDuracao(seg) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  const partes = [];
  if (h) partes.push(h + (h === 1 ? ' hora' : ' horas'));
  if (m) partes.push(m + (m === 1 ? ' minuto' : ' minutos'));
  if (s) partes.push(s + (s === 1 ? ' segundo' : ' segundos'));
  return partes.join(' e ');
}

function iniciarTimer(segundos) {
  estado.timer = { fim: Date.now() + segundos * 1000, total: segundos };
  ilha.classList.add('com-timer');
  $('chipTimer').hidden = false;
  tickTimer();
}

function cancelarTimer() {
  estado.timer = null;
  ilha.classList.remove('com-timer');
  $('chipTimer').hidden = true;
  $('timerMini').textContent = '';
}

function tickTimer() {
  if (!estado.timer) return;
  const resta = (estado.timer.fim - Date.now()) / 1000;
  if (resta <= 0) {
    const total = estado.timer.total;
    cancelarTimer();
    timerConcluido(total);
    return;
  }
  const txt = formatarDuracao(resta);
  $('timerMini').textContent = txt;
  $('timerGrande').textContent = '⏱ ' + txt;
}

function timerConcluido(total) {
  aviso('Timer concluído', descreverDuracao(total), { icone: '⏱', tipo: 'timer', ms: 7000 });
  ilha.classList.add('pulsar');
  olhos.reagir('surpreso', 3500);
  setTimeout(() => ilha.classList.remove('pulsar'), 3700);
  bipar();
  responder('O timer de ' + descreverDuracao(total) + ' terminou.');
}

function bipar(vezes = 6) {
  const ctx = new AudioContext();
  [0, 0.25, 0.5, 1.0, 1.25, 1.5].slice(0, vezes).forEach((t) => {
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.frequency.value = 880;
    ganho.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    ganho.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
    osc.connect(ganho).connect(ctx.destination);
    osc.start(ctx.currentTime + t);
    osc.stop(ctx.currentTime + t + 0.2);
  });
  setTimeout(() => ctx.close(), 2500);
}

$('cancelarTimer').addEventListener('click', () => {
  cancelarTimer();
  aviso('Timer cancelado', '', { icone: '✕', tipo: 'info', ms: 1600 });
});

// ---------------------------------------------------------------------------
// Voz
// ---------------------------------------------------------------------------
const voz = new Voz();
let animacaoOnda = null;

function responder(texto) {
  if (estado.config.respostaFalada) falar(texto);
}

function animarOnda() {
  const barras = [...$('onda').children];
  const passo = () => {
    const n = voz.nivel();
    barras.forEach((b, i) => {
      const fator = 0.45 + 0.55 * Math.abs(Math.sin(Date.now() / 140 + i * 0.9));
      b.style.height = Math.max(14, Math.min(100, n * 100 * fator + 14)) + '%';
    });
    animacaoOnda = requestAnimationFrame(passo);
  };
  cancelAnimationFrame(animacaoOnda);
  passo();
}

voz.addEventListener('ouvindo', (e) => {
  olhos.definirBase(e.detail ? 'ouvindo' : (estado.midia.status === 'Playing' ? 'musica' : 'normal'));
  if (e.detail) {
    clearTimeout(timeoutAviso);
    $('transcricao').textContent = 'Ouvindo…';
    $('transcricao').classList.add('vazia');
    mostrar('escuta');
    animarOnda();
  } else {
    cancelAnimationFrame(animacaoOnda);
    if (estado.vista === 'escuta') mostrar(vistaPadrao());
  }
});
voz.addEventListener('parcial', (e) => {
  $('transcricao').textContent = e.detail;
  $('transcricao').classList.remove('vazia');
  voz.reiniciarTimeout(4000); // ainda falando: dá mais tempo
});
voz.addEventListener('silencio', () => {
  olhos.reagir('confuso', 1800);
  aviso('Não ouvi nada', 'Tente de novo: Ctrl+Alt+Espaço', { icone: '…', tipo: 'info', ms: 2000 });
});
voz.addEventListener('comando', (e) => {
  const d = e.detail;
  if (typeof d === 'string') executarFrase(d);
  else executarFrase(d.texto, d.alternativa);
});

// Ensina ao reconhecimento os comandos e os nomes dos apps instalados (acerta muito mais "abrir X")
let appsParaVoz = [];
async function prepararVocabulario() {
  try { appsParaVoz = (await api.listarApps()) || []; } catch { appsParaVoz = []; }
  try { voz.definirGramatica(frasesDeComando(appsParaVoz.map((a) => a.nome))); } catch (e) { console.warn(e); }
}

async function ativarVoz() {
  if (voz.escutandoComando) { voz.pararComando(); return; }
  if (!voz.pronta) {
    aviso('Voz ainda carregando', 'Aguarde alguns segundos', { icone: '…', tipo: 'info' });
    return;
  }
  try {
    await voz.ouvirComando();
  } catch (erro) {
    aviso('Microfone indisponível', 'Configurações › Privacidade › Microfone', { icone: '!', tipo: 'erro', ms: 4500 });
    console.error(erro);
  }
}

$('botaoMic').addEventListener('click', ativarVoz);
api.on('voz:ativar', ativarVoz);

async function iniciarVoz() {
  const r = await api.garantirModelo();
  if (!r.ok) {
    ilha.classList.add('voz-indisponivel');
    if (window.ilhaAPI) {
      aviso('Voz indisponível', 'Sem internet para baixar o modelo? Veja o LEIA-ME', { icone: '!', tipo: 'erro', ms: 6000 });
    }
    console.error('Modelo de voz:', r);
    return;
  }
  try {
    await voz.carregar(r.url);
    ilha.classList.remove('voz-indisponivel');
    await prepararVocabulario();
    await voz.definirContinua(estado.config.escutaContinua, estado.config.palavraAtivacao);
    aviso('Voz pronta', 'Ctrl+Alt+Espaço e fale um comando', { icone: '🎙', tipo: 'info', ms: 3000 });
  } catch (erro) {
    ilha.classList.add('voz-indisponivel');
    aviso('Erro ao carregar a voz', String(erro.message || erro), { icone: '!', tipo: 'erro', ms: 6000 });
    console.error(erro);
  }
}

api.on('modelo:status', (s) => {
  if (s.fase === 'baixando') {
    clearTimeout(timeoutAviso);
    $('avisoTitulo').textContent = 'Baixando voz em português';
    $('avisoSub').textContent = `${Math.round((s.progresso || 0) * 100)}% · só na primeira vez`;
    $('avisoIcone').textContent = '↓';
    $('avisoIcone').className = 'aviso-icone info';
    mostrar('aviso');
  } else if (s.fase === 'preparando') {
    aviso('Preparando a voz…', '', { icone: '…', tipo: 'info', ms: 60000 });
  }
});

// ---------------------------------------------------------------------------
// Busca (Alt+Espaço): apps, arquivos, configurações e comandos
// ---------------------------------------------------------------------------
const campo = $('campoBusca');
const listaRes = $('resultados');
const busca = { itens: [], ativo: 0, confirmando: null, seq: 0 };

function abrirBusca() {
  clearTimeout(timeoutAviso);
  mostrar('busca');
  api.interativo(true);
  campo.value = '';
  busca.confirmando = null;
  atualizarBusca();
  setTimeout(() => campo.focus(), 30);
}

function fecharBusca(avisar = true) {
  if (estado.vista !== 'busca') return;
  campo.blur();
  ilha.style.removeProperty('--altura-busca');
  mostrar(vistaPadrao());
  if (!estado.hover) api.interativo(false);
  if (avisar) api.fecharBusca();
}

function ajustarAlturaBusca() {
  const e = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')) || 1;
  const linhas = Math.min(busca.itens.length, 7);
  const altura = 52 * e + (linhas ? linhas * 42 * e + 8 : 0);
  ilha.style.setProperty('--altura-busca', Math.min(window.innerHeight - 12, altura) + 'px');
}

async function atualizarBusca() {
  const seq = ++busca.seq;
  const itens = await api.buscar(campo.value);
  if (seq !== busca.seq) return; // chegou resposta velha
  busca.itens = itens || [];
  busca.ativo = 0;
  busca.confirmando = null;
  desenharResultados();
}

function desenharResultados() {
  listaRes.innerHTML = '';
  busca.itens.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'resultado' + (i === busca.ativo ? ' ativo' : '') + (busca.confirmando === r.id ? ' confirmando' : '');
    li.setAttribute('role', 'option');
    const ic = document.createElement('div');
    ic.className = 'res-icone';
    ic.textContent = r.icone || '•';
    if (r.iconeArquivo) {
      api.iconeArquivo(r.iconeArquivo).then((url) => {
        if (!url) return;
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        ic.textContent = '';
        ic.appendChild(img);
      });
    }
    const tx = document.createElement('div');
    tx.className = 'res-texto';
    const t = document.createElement('div');
    t.className = 'res-titulo';
    t.textContent = r.titulo;
    const sub = document.createElement('div');
    sub.className = 'res-sub';
    sub.textContent = r.sub || '';
    tx.append(t, sub);
    const en = document.createElement('span');
    en.className = 'res-enter';
    en.textContent = busca.confirmando === r.id ? 'Enter de novo para confirmar' : '↵';
    li.append(ic, tx, en);
    li.addEventListener('mousemove', () => { if (busca.ativo !== i) { busca.ativo = i; marcarAtivo(); } });
    li.addEventListener('click', () => { busca.ativo = i; escolher(); });
    listaRes.appendChild(li);
  });
  ajustarAlturaBusca();
}

function marcarAtivo() {
  [...listaRes.children].forEach((li, i) => li.classList.toggle('ativo', i === busca.ativo));
  listaRes.children[busca.ativo]?.scrollIntoView({ block: 'nearest' });
}

async function escolher() {
  const r = busca.itens[busca.ativo];
  if (!r) return;
  // Ações sérias (desligar, reiniciar, esvaziar lixeira...) pedem Enter duas vezes
  if (r.confirmar && busca.confirmando !== r.id) {
    busca.confirmando = r.id;
    desenharResultados();
    olhos.reagir('surpreso', 900);
    return;
  }
  const res = await api.executarBusca(r.id);
  fecharBusca(false);
  if (res?.ok) {
    olhos.reagir('feliz', 1300);
    if (res.aviso) aviso(res.aviso, '', { icone: r.icone || '✓', ms: 1600 });
  } else {
    aviso('Não consegui abrir', r.titulo, { icone: '!', tipo: 'erro' });
  }
}

let timeoutDigitacao = null;
campo.addEventListener('input', () => {
  clearTimeout(timeoutDigitacao);
  timeoutDigitacao = setTimeout(atualizarBusca, 70);
});
campo.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); busca.ativo = (busca.ativo + 1) % Math.max(1, busca.itens.length); busca.confirmando = null; desenharResultados(); marcarAtivo(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); busca.ativo = (busca.ativo - 1 + busca.itens.length) % Math.max(1, busca.itens.length); busca.confirmando = null; desenharResultados(); marcarAtivo(); }
  else if (e.key === 'Enter') { e.preventDefault(); escolher(); }
  else if (e.key === 'Escape') { e.preventDefault(); fecharBusca(); }
});
api.on('lancador:abrir', abrirBusca);
api.on('lancador:fechar', () => fecharBusca(false));
$('botaoBusca').addEventListener('click', () => api.acao({ tipo: 'abrirBusca' }));

// ---------------------------------------------------------------------------
// Controles rápidos: Wi-Fi, Bluetooth, mudo, modo escuro, volume e brilho
// ---------------------------------------------------------------------------
const sistema = { volume: null, mudo: null, brilho: null, wifi: null, bt: null, escuro: null };
const slVolume = $('slVolume');
const SVG_SOL = '<svg viewBox="0 0 24 24"><path d="M12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM11 1h2v3h-2zm0 19h2v3h-2zM1 11h3v2H1zm19 0h3v2h-3zM4.2 5.6l1.4-1.4 2.1 2.1-1.4 1.4zm12.1 12.1 1.4-1.4 2.1 2.1-1.4 1.4zM4.2 18.4l2.1-2.1 1.4 1.4-2.1 2.1zM16.3 6.3l2.1-2.1 1.4 1.4-2.1 2.1z"/></svg>';
let arrastando = null;
const ultimoToque = { vol: 0 };  // ignora o estado vindo do Windows logo após mexer (por barra)
let assinaturaTelas = '';

// Pinta a barra e mostra a porcentagem ao lado
function pintarSlider(el) {
  el.style.setProperty('--v', el.value + '%');
  const pct = el.parentElement?.querySelector('.pct');
  if (!pct) return;
  if (el.disabled) pct.textContent = '—';
  else if (el === slVolume && sistema.mudo) pct.textContent = 'mudo';
  else pct.textContent = el.value + '%';
  pct.classList.toggle('mudo', el === slVolume && !!sistema.mudo);
}

function atualizarControles(e) {
  Object.assign(sistema, e);
  const marcar = (id, valor) => {
    const b = $(id);
    b.classList.toggle('indisponivel', valor === null || valor === undefined);
    b.classList.toggle('ligado', !!valor);
  };
  marcar('tgWifi', sistema.wifi);
  marcar('tgBt', sistema.bt);
  marcar('tgMudo', sistema.mudo);
  marcar('tgTema', sistema.escuro);
  $('tgWifi').title = sistema.wifi === null ? 'Wi-Fi indisponível' : sistema.wifi ? 'Wi-Fi ligado' : 'Wi-Fi desligado';
  $('tgBt').title = sistema.bt === null ? 'Bluetooth indisponível' : sistema.bt ? 'Bluetooth ligado' : 'Bluetooth desligado';
  if (sistema.volume != null && arrastando !== slVolume && Date.now() - ultimoToque.vol > 1200) { slVolume.value = sistema.volume; pintarSlider(slVolume); }
  else pintarSlider(slVolume);
  desenharBrilhos(sistema.monitores || []);
}
api.on('sistema', atualizarControles);

function limitador(fn, ms) {
  let ultimo = 0; let pendente = null;
  return (v) => {
    const agora = Date.now();
    clearTimeout(pendente);
    if (agora - ultimo >= ms) { ultimo = agora; fn(v); }
    else pendente = setTimeout(() => { ultimo = Date.now(); fn(v); }, ms);
  };
}
const enviarVolume = (v) => { ultimoToque.vol = Date.now(); api.sistema(`vol ${v}`); };

// Uma barra de brilho por tela (a principal primeiro). Só refaz as barras se as telas mudarem.
function desenharBrilhos(telas) {
  const box = $('brilhos');
  const assinatura = telas.map((t) => t.id).join(',');
  if (assinatura !== assinaturaTelas) {
    assinaturaTelas = assinatura;
    box.innerHTML = '';
    const lista = telas.length ? telas : [null];
    lista.forEach((t, i) => {
      const rot = document.createElement('label');
      rot.className = 'slider' + (t ? '' : ' indisponivel');
      rot.innerHTML = SVG_SOL;
      if (telas.length > 1) {
        const n = document.createElement('span');
        n.className = 'num-tela';
        n.textContent = i + 1;
        rot.appendChild(n);
      }
      const el = document.createElement('input');
      el.type = 'range'; el.min = 0; el.max = 100; el.value = t?.brilho ?? 50;
      el.disabled = !t;
      el.dataset.id = t?.id || '';
      el.setAttribute('aria-label', t ? `Brilho: ${t.nome}` : 'Brilho');
      rot.title = t ? `${t.nome}${telas.length > 1 && t.principal ? ' (onde a ilha está)' : ''}` : 'Seu monitor não aceita ajuste de brilho pelo Windows (ative DDC/CI no menu do monitor)';
      rot.appendChild(el);
      const pct = document.createElement('span');
      pct.className = 'pct';
      rot.appendChild(pct);
      box.appendChild(rot);
      if (t) ligarSlider(el, (v) => { ultimoToque['b' + t.id] = Date.now(); api.sistema(`brilho ${t.id} ${v}`); });
      pintarSlider(el);
    });
    box.classList.toggle('varias', telas.length > 1);
  }
  // atualiza valores sem atrapalhar quem está mexendo
  box.querySelectorAll('input').forEach((el) => {
    const t = telas.find((x) => x.id === el.dataset.id);
    if (!t || arrastando === el || Date.now() - (ultimoToque['b' + t.id] || 0) < 1500) return;
    el.value = t.brilho; pintarSlider(el);
  });
}

function ligarSlider(el, enviar) {
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (el.disabled) return;
    el.value = Math.max(0, Math.min(100, Number(el.value) + (e.deltaY < 0 ? 4 : -4)));
    pintarSlider(el);
    enviar(el.value);
  }, { passive: false });
  el.addEventListener('pointerdown', () => { arrastando = el; });
  el.addEventListener('pointerup', () => { arrastando = null; });
  el.addEventListener('input', () => { pintarSlider(el); enviar(el.value); });
  el.addEventListener('change', () => { arrastando = null; enviar(el.value); });
}
ligarSlider(slVolume, enviarVolume);
$('tgWifi').addEventListener('click', () => api.sistema('wifi toggle'));
$('tgBt').addEventListener('click', () => api.sistema('bt toggle'));
$('tgMudo').addEventListener('click', () => api.sistema('mudo toggle'));
$('tgTema').addEventListener('click', async () => {
  const escuro = await api.alternarTema();
  atualizarControles({ escuro });
});

// Atualiza os controles enquanto o painel estiver aberto
setInterval(() => { if (estado.vista === 'expandida') api.sistema('estado'); }, 4000);

// ---------------------------------------------------------------------------
// Execução dos comandos
// ---------------------------------------------------------------------------
async function executarFrase(textoOuvido, alternativa = '') {
  const { intencao, frase } = escolherIntencao(textoOuvido, alternativa);
  if (!intencao) return;
  const agora = new Date();
  if (intencao.tipo === 'nao-entendi') olhos.reagir('confuso', 2400);
  else if (intencao.tipo !== 'cancelar' && intencao.tipo !== 'abrir-instalado') olhos.reagir('feliz', 1500);

  switch (intencao.tipo) {
    case 'midia': {
      await api.acao(intencao);
      const nomes = {
        toggle: estado.midia.status === 'Playing' ? 'Pausado' : 'Tocando',
        next: 'Próxima', prev: 'Anterior', volup: 'Volume +', voldown: 'Volume −', mute: 'Mudo alternado',
      };
      const icones = { toggle: '⏯', next: '⏭', prev: '⏮', volup: '🔊', voldown: '🔉', mute: '🔇' };
      aviso(nomes[intencao.cmd], `"${frase}"`, { icone: icones[intencao.cmd], ms: 1800 });
      break;
    }
    case 'timer':
      iniciarTimer(intencao.segundos);
      aviso('Timer iniciado', descreverDuracao(intencao.segundos), { icone: '⏱', tipo: 'timer' });
      responder('Timer de ' + descreverDuracao(intencao.segundos));
      break;
    case 'timer-cancelar':
      if (estado.timer) {
        cancelarTimer();
        aviso('Timer cancelado', '', { icone: '✕', tipo: 'info' });
      } else {
        aviso('Nenhum timer ativo', '', { icone: '…', tipo: 'info' });
      }
      break;
    case 'hora': {
      const h = fmtHora.format(agora);
      aviso('São ' + h, '', { icone: '🕐', tipo: 'info' });
      responder('São ' + h.replace(':', ' e '));
      break;
    }
    case 'data': {
      const d = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
      aviso(d.charAt(0).toUpperCase() + d.slice(1), '', { icone: '📅', tipo: 'info' });
      responder('Hoje é ' + d);
      break;
    }
    case 'bateria': {
      const b = estado.bateria;
      if (!b || b.desktop) {
        aviso('Sem bateria', 'Este PC está ligado direto na tomada', { icone: '🔌', tipo: 'info' });
        responder('Este computador não tem bateria.');
      } else {
        aviso(`Bateria em ${b.pct}%`, b.carregando ? 'Carregando' : 'Na bateria', { icone: '🔋', tipo: 'info' });
        responder(`Bateria em ${b.pct} por cento${b.carregando ? ', carregando' : ''}`);
      }
      break;
    }
    case 'tocando': {
      const m = estado.midia;
      if (m.ativo) {
        aviso(m.titulo, m.artista || nomeApp(m.app), { icone: '♪', tipo: 'info', ms: 3500 });
        responder(m.titulo + (m.artista ? ', de ' + m.artista : ''));
      } else {
        aviso('Nada tocando agora', '', { icone: '♪', tipo: 'info' });
      }
      break;
    }
    case 'abrir':
      await api.acao(intencao);
      aviso('Abrindo ' + intencao.app, '', { icone: '↗' });
      break;
    case 'abrir-instalado': {
      if (!appsParaVoz.length) await prepararVocabulario();
      const achado = acharApp(intencao.nome, appsParaVoz);
      if (achado) {
        await api.acao({ tipo: 'abrirApp', appId: achado.appId });
        olhos.reagir('feliz', 1500);
        aviso('Abrindo ' + achado.nome, `"${frase}"`, { icone: '↗' });
      } else {
        olhos.reagir('confuso', 2400);
        aviso('Não achei esse app', `Ouvi: "${frase}"`, { icone: '?', tipo: 'info', ms: 4000 });
      }
      break;
    }
    case 'pesquisar':
      await api.acao(intencao);
      aviso('Pesquisando', intencao.termo, { icone: '🔎' });
      break;
    case 'youtube':
      await api.acao(intencao);
      aviso('Procurando no YouTube', intencao.termo, { icone: '▶' });
      break;
    case 'bloquear':
      aviso('Bloqueando…', '', { icone: '🔒', ms: 1200 });
      setTimeout(() => api.acao(intencao), 600);
      break;
    case 'captura':
      await api.acao(intencao);
      aviso('Recorte de tela', 'Selecione a área', { icone: '✂' });
      break;
    case 'esconder':
      estado.fixada = false;
      mostrar('compacta');
      await api.acao(intencao);
      break;
    case 'ajuda':
      aviso('Experimente dizer:', LISTA_AJUDA, { icone: '?', tipo: 'info', ms: 9000, alto: true });
      break;
    case 'cancelar':
      voltarAoPadrao();
      break;
    case 'sistema': {
      await api.acao(intencao);
      const textos = {
        vol: `Volume em ${intencao.valor}%`, brilho: `Brilho em ${intencao.valor}%`,
        wifi: 'Wi-Fi', bt: 'Bluetooth', tema: 'Tema alternado', mudo: 'Som alternado',
      };
      aviso(textos[intencao.id] || 'Feito', `"${frase}"`, { icone: '⚙', ms: 1800 });
      break;
    }
    case 'busca':
      api.acao({ tipo: 'abrirBusca' });
      break;
    case 'tarefa':
      widgets.novaTarefa(intencao.texto);
      aviso('Tarefa anotada', intencao.texto, { icone: '✓' });
      break;
    case 'nota':
      widgets.nota(intencao.texto);
      aviso('Anotado', intencao.texto, { icone: '📝' });
      break;
    case 'evento':
      widgets.novoEvento(intencao.texto);
      aviso('Na agenda de hoje', intencao.texto, { icone: '📅' });
      break;
    case 'foco':
      widgets.alternarFoco();
      aviso('Foco', 'Pomodoro iniciado/pausado', { icone: '🍅', ms: 1600 });
      break;
    case 'widget':
      estado.fixada = true;
      abrirPainel();
      widgets.irParaWidget(intencao.nome);
      setTimeout(() => { estado.fixada = false; }, 10000);
      break;
    case 'claude':
      await api.acao(intencao);
      aviso('Abrindo no Claude', intencao.texto, { icone: '✳', tipo: 'info', ms: 3000 });
      break;
    default:
      aviso('Não entendi', intencao.dica || `"${frase}" · diga "ajuda"`, { icone: '?', tipo: 'erro', ms: 3200 });
  }
}

// ---------------------------------------------------------------------------
// Widgets e atividades ao vivo
// ---------------------------------------------------------------------------
// Atenção: o objeto api vem congelado do Electron — nunca alterar, só chamar.
estado.teclado = false;
function pedirTeclado(sim) {
  estado.teclado = !!sim;
  api.teclado(sim);
}
const widgets = iniciarWidgets({
  api, aviso, olhos, bipar, pedirTeclado,
  falar: (t) => responder(t),
});

$('botaoConfig').addEventListener('click', () => api.abrirConfiguracoes());

// Na pílula compacta: Pomodoro rodando ou compromisso chegando
setInterval(() => {
  const a = widgets.atividade();
  const el = $('ativ');
  ilha.classList.toggle('com-ativ', !!a);
  if (a) { el.textContent = a.texto; el.className = 'ativ ' + a.classe; }
}, 500);

// Aparência configurável
let escalaTela = 1;
function aplicarAparencia(c) {
  const raiz = document.documentElement.style;
  raiz.setProperty('--cor-olhos', c.corOlhos || '#f5f5f7');
  raiz.setProperty('--cor-relogio', c.corRelogio || '#f5f5f7');
  raiz.setProperty('--destaque', c.corDestaque || '#60a5fa');
  raiz.setProperty('--escala', (escalaTela * (c.tamanho || 1)).toFixed(3));
  document.body.classList.toggle('fundo-grafite', c.fundo === 'grafite');
  document.body.classList.toggle('fundo-translucido', c.fundo === 'translucido');
  document.body.classList.toggle('olhos-redondos', c.formatoOlhos === 'redondo');
  document.body.classList.toggle('sem-olhos', c.mostrarOlhos === false);
  montarRelogio(c);
  atualizarRelogio();
  ultimoModoApp && aplicarModoApp(ultimoModoApp);
}

// ---------------------------------------------------------------------------
// Volume/brilho mudados pelo teclado: barrinha no estilo iPhone
// ---------------------------------------------------------------------------
let timeoutOsd = null;
api.on('osd', (o) => {
  if (!o.externo) return; // mudou pela própria ilha: o painel já mostra
  if (!['compacta', 'osd'].includes(estado.vista)) return;
  const vol = o.o === 'volume';
  const mudo = vol && o.mudo;
  $('osdIcone').textContent = vol ? (mudo || o.valor === 0 ? '🔇' : o.valor < 34 ? '🔈' : o.valor < 67 ? '🔉' : '🔊') : '☀️';
  $('osdNivel').style.width = (mudo ? 0 : o.valor) + '%';
  $('osdValor').textContent = mudo ? 'mudo' : o.valor + '%';
  document.querySelector('.vista-osd').classList.toggle('mudo', !!mudo);
  mostrar('osd');
  clearTimeout(timeoutOsd);
  timeoutOsd = setTimeout(() => { if (estado.vista === 'osd') voltarAoPadrao(); }, 1600);
});

// Nova versão da ilha (atualização automática pelo GitHub)
$('botaoAtualizar').addEventListener('click', () => api.atualizarAgora());
api.on('atualizacao', ({ fase, versao, notas }) => {
  if (fase === 'baixando') {
    aviso('Atualização encontrada', `Versão ${versao} · baixando…`, { icone: '⬇', tipo: 'info', ms: 4000 });
    olhos.reagir('surpreso', 1200);
  } else if (fase === 'pronta') {
    $('botaoAtualizar').hidden = false;
    $('botaoAtualizar').title = `Instalar a versão ${versao} agora`;
    const primeira = (notas || [])[0];
    aviso(`Versão ${versao} pronta`, primeira || 'Instala sozinha quando a ilha fechar', {
      icone: '⬆', tipo: 'info', ms: 12000,
      botoes: [{ texto: 'Atualizar agora', acao: () => api.atualizarAgora() }, { texto: 'Depois', acao: () => {} }],
    });
    olhos.reagir('feliz', 2000);
    bipar(1);
  }
});
// Acabou de atualizar: mostra o que mudou
api.on('atualizado', ({ versao, notas }) => {
  const lista = (notas || []).slice(0, 7);
  aviso(`✨ Ilha atualizada para a versão ${versao}`, lista.length ? lista : 'Tudo pronto!', {
    icone: '🎉', tipo: 'info', ms: lista.length ? 11000 : 4000, alto: lista.length > 0,
  });
  olhos.reagir('feliz', 3000);
});

// Fone/caixa de som conectado (o Windows troca a saída de áudio)
api.on('saida', ({ nome }) => {
  const fone = /fone|headset|headphone|buds|airpods|bluetooth|hands-free|jbl|sony|wh-|wf-|qcy|edifier|haylou|galaxy|soundcore|beats/i.test(nome);
  aviso(fone ? 'Fone conectado' : 'Saída de áudio', nome, { icone: fone ? '🎧' : '🔈', tipo: 'info', ms: 3000 });
  olhos.reagir('feliz', 1500);
});

// Download concluído
const ICONES_ARQ = { pdf: '📕', zip: '🗜', rar: '🗜', '7z': '🗜', exe: '⚙', msi: '⚙', png: '🖼', jpg: '🖼', jpeg: '🖼', webp: '🖼', gif: '🖼', mp4: '🎬', mkv: '🎬', mov: '🎬', mp3: '🎵', wav: '🎵', docx: '📄', xlsx: '📊', pptx: '📽', psd: '🎨', ai: '🎨' };
const tamanhoBonito = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB');
api.on('download', ({ nome, caminho, tamanho }) => {
  const ext = nome.split('.').pop().toLowerCase();
  aviso('Download concluído', `${nome} · ${tamanhoBonito(tamanho)}`, {
    icone: ICONES_ARQ[ext] || '⬇', tipo: 'info', ms: 7000,
    botoes: [
      { texto: 'Abrir', acao: () => api.acao({ tipo: 'abrirArquivo', caminho }) },
      { texto: 'Pasta', acao: () => api.acao({ tipo: 'mostrarNaPasta', caminho }) },
      { texto: 'Bandeja', acao: () => { widgets.guardarNaBandeja([caminho]); aviso('Guardado na bandeja', nome, { icone: '📥', ms: 1500 }); } },
    ],
  });
  olhos.reagir('feliz', 1500);
});

// Privacidade: pontinho laranja (microfone) ou verde (câmera)
let usandoAntes = { mic: [], cam: [] };
api.on('privacidade', ({ mic, cam }) => {
  ilha.classList.toggle('priv-mic', mic.length > 0 && cam.length === 0);
  ilha.classList.toggle('priv-cam', cam.length > 0);
  ilha.title = [cam.length ? `📷 Câmera: ${cam.join(', ')}` : '', mic.length ? `🎙 Microfone: ${mic.join(', ')}` : ''].filter(Boolean).join('\n');
  const novosCam = cam.filter((x) => !usandoAntes.cam.includes(x));
  const novosMic = mic.filter((x) => !usandoAntes.mic.includes(x));
  if (novosCam.length) aviso('Câmera ligada', `${novosCam.join(', ')} está usando a câmera`, { icone: '📷', tipo: 'info', ms: 3500 });
  else if (novosMic.length) aviso('Microfone em uso', `${novosMic.join(', ')} está ouvindo`, { icone: '🎙', tipo: 'info', ms: 3500 });
  usandoAntes = { mic, cam };
});

// ---------------------------------------------------------------------------
// Arrastar arquivos para a ilha (bandeja)
// ---------------------------------------------------------------------------
let apertou = null; // onde o botão do mouse foi apertado: { y, dentro } — clique dentro da ilha nunca é "arrastar arquivo"
document.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragenter', () => ilha.classList.add('arrastando'));
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) ilha.classList.remove('arrastando'); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  ilha.classList.remove('arrastando');
  const caminhos = [...(e.dataTransfer?.files || [])].map((f) => api.caminhoDoArquivo(f)).filter(Boolean);
  if (!caminhos.length) return;
  widgets.guardarNaBandeja(caminhos);
  olhos.reagir('feliz', 1500);
});
api.on('cursor', (pos) => {
  if (!pos.botao) { apertou = null; return; }
  const r = ilha.getBoundingClientRect();
  if (apertou === null) {
    const dentro = pos.x >= r.left - 10 && pos.x <= r.right + 10 && pos.y >= -4 && pos.y <= r.bottom + 10;
    apertou = { y: pos.y, dentro };
  }
  // Clique dentro da ilha (setas, botões, barras...) é só um clique
  if (apertou.dentro) return;
  if (apertou.y < 140) return; // começou perto do topo: provavelmente arrastando uma aba, não um arquivo
  const perto = pos.x >= r.left - 40 && pos.x <= r.right + 40 && pos.y >= -4 && pos.y <= r.bottom + 30;
  if (!perto) return;
  api.interativo(true);
  estado.hover = true;
  if (estado.vista !== 'expandida' && estado.vista !== 'busca') {
    estado.fixada = true;
    abrirPainel();
    setTimeout(() => { estado.fixada = false; }, 4000);
  }
  if (widgets.paginaAtual() !== 'bandeja') widgets.irParaWidget('bandeja');
  ilha.classList.add('arrastando');
});

// ---------------------------------------------------------------------------
// Configuração e responsividade
// ---------------------------------------------------------------------------
api.on('config', async (c) => {
  const antes = estado.config;
  estado.config = c || {};
  aplicarAparencia(estado.config);
  widgets.aplicarConfig(estado.config);
  if (voz.pronta && (antes.escutaContinua !== c.escutaContinua || antes.palavraAtivacao !== c.palavraAtivacao)) {
    try {
      await voz.definirContinua(c.escutaContinua, c.palavraAtivacao);
      aviso(c.escutaContinua ? 'Escuta contínua ligada' : 'Escuta contínua desligada',
        c.escutaContinua ? `Diga "${c.palavraAtivacao}, pausar"` : 'Use Ctrl+Alt+Espaço', { icone: '🎙', tipo: 'info' });
    } catch {
      aviso('Microfone indisponível', '', { icone: '!', tipo: 'erro' });
    }
  }
});

api.on('tela', ({ largura }) => {
  // Telas menores ganham uma ilha um pouco menor; telas grandes, um pouco maior
  escalaTela = largura < 1300 ? 0.9 : largura > 2400 ? 1.12 : 1;
  aplicarAparencia(estado.config);
});

api.on('midia', atualizarMidia);
// Tracinho do modo discreto: depois de meio segundo parado, abre o painel e passa a aceitar cliques
let ultimoCursor = { x: -1, y: -1, botao: false };
function verificarParado() {
  if (!parado || !ilha.classList.contains('discreta') || estado.vista !== 'compacta') return;
  if (ultimoCursor.botao || Date.now() - parado.desde < 500) return;
  if (Math.abs(ultimoCursor.x - parado.x) + Math.abs(ultimoCursor.y - parado.y) > 8) return;
  parado = null;
  estado.hover = true;
  api.interativo(true);
  abrirPainel();
  olhos.reagir('surpreso', 500);
}
api.on('cursor', (pos) => { ultimoCursor = pos; });

// Posição real do mouse (vem do Windows): segue com os olhos e garante que o painel
// recolha mesmo quando o mouse sai rápido da janela e o evento "mouseleave" se perde
let timeoutForaDoPainel = null;
let parado = null; // { x, y, desde } enquanto o mouse está em cima do tracinho
api.on('cursor', (pos) => {
  olhos.seguir(pos);
  const r = ilha.getBoundingClientRect();

  // Modo discreto: abre só se o mouse ficar meio segundo parado sobre o tracinho, sem botão apertado
  if (ilha.classList.contains('discreta') && estado.vista === 'compacta') {
    const sobre = pos.x >= r.left - 10 && pos.x <= r.right + 10 && pos.y >= -2 && pos.y <= r.bottom + 6;
    if (!sobre || pos.botao) { if (parado) clearTimeout(parado.t); parado = null; return; }
    if (!parado || Math.abs(pos.x - parado.x) + Math.abs(pos.y - parado.y) > 8) {
      if (parado) clearTimeout(parado.t);
      parado = { x: pos.x, y: pos.y, desde: Date.now() };
      parado.t = setTimeout(() => verificarParado(), 520);
    }
    return;
  }
  const dentro = pos.x >= r.left - 6 && pos.x <= r.right + 6 && pos.y >= r.top - 6 && pos.y <= r.bottom + 6;
  if (dentro) {
    clearTimeout(timeoutForaDoPainel);
    timeoutForaDoPainel = null;
    return;
  }
  if (estado.vista === 'expandida' && !estado.teclado && !estado.fixada && !timeoutForaDoPainel) {
    timeoutForaDoPainel = setTimeout(() => {
      timeoutForaDoPainel = null;
      if (estado.vista === 'expandida' && !estado.teclado && !estado.fixada) {
        estado.hover = false;
        api.interativo(false);
        mostrar('compacta');
      }
    }, 260);
  }
});
// Reage ao app em primeiro plano:
//   maximizada -> gruda no topo (formato "notch")
//   cheia      -> encolhe para o modo mini (vídeo, jogo, F11)
let ultimoModoApp = null;
function aplicarModoApp(modo) {
  ultimoModoApp = modo;
  const notch = estado.config.modoNotch !== false;
  const mini = estado.config.modoMini !== false && modo === 'cheia';
  const discreta = modo === 'maximizada-abas';
  ilha.classList.toggle('discreta', discreta);
  if (discreta && estado.vista === 'compacta') api.interativo(false); // nunca rouba cliques das abas
  ilha.classList.toggle('colada', notch && (modo === 'maximizada' || modo === 'maximizada-abas' || modo === 'cheia') || mini || discreta);
  ilha.classList.toggle('mini', mini);
  if (mini && estado.fixada) { estado.fixada = false; voltarAoPadrao(); }
}
api.on('modoApp', aplicarModoApp);

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------
(async function iniciar() {
  estado.config = await api.lerConfig();
  aplicarAparencia(estado.config);
  widgets.aplicarConfig(estado.config);
  await widgets.carregar();
  atualizarRelogio();
  setInterval(atualizarRelogio, 1000);
  setInterval(tickTimer, 250);
  iniciarBateria();
  atualizarMidia({ ativo: false });
  iniciarVoz();
})();

// Para testar no navegador sem Electron: window.testar('timer de dez segundos')
window.testar = executarFrase;
window.abrirBusca = abrirBusca;
window.atualizarControles = atualizarControles;
window.widgets = widgets;
window.abrirPainel = abrirPainel;
window.olhos = olhos;
window.simularMidia = atualizarMidia;
