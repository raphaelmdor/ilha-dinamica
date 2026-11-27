import { Voz, falar } from './voice.js';
import { interpretar, LISTA_AJUDA, frasesDeComando, acharApp, escolherIntencao, fraseMaisParecida, mesmoComando, normalizar } from './intents.js';
import { Olhos } from './olhos.js';
import { iniciarWidgets } from './widgets.js';

const $ = (id) => document.getElementById(id);
document.getElementById('ilha')?.classList.add('colada'); // nasce já como notch
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
  // recolheu: se ficar recolhido por 5 s, na próxima vez o painel abre no Início
  // (reabrindo antes disso, continua no widget onde estava)
  if (vista === 'compacta' && estado.vista && estado.vista !== 'compacta') {
    clearTimeout(estado.timeoutInicio);
    estado.timeoutInicio = setTimeout(() => { if (estado.vista === 'compacta') estado.voltarAoInicio = true; }, 5000);
  } else if (vista === 'expandida') {
    clearTimeout(estado.timeoutInicio);
  }
  estado.vista = vista;
  ilha.dataset.estado = vista;
  if (vista !== 'aviso') ilha.classList.remove('alto', 'com-botoes', 'cartao-agenda', 'resumo');
}

// Clique "atravessa" a janela fora da ilha. Guarda o estado e, com o mouse em cima da ilha,
// garante que ela está clicável (se um evento se perder, o próximo movimento conserta)
let interativoAgora = null;
function definirInterativo(sim) {
  sim = !!sim;
  interativoAgora = sim;
  api.interativo(sim);
}

function vistaPadrao() {
  if (voz.escutandoComando) return 'escuta';
  if (estado.esperarSair) return 'compacta'; // acabou de fechar um aviso: fica no notch
  return estado.hover || estado.fixada ? 'expandida' : 'compacta';
}

function voltarAoPadrao() {
  clearTimeout(timeoutAviso);
  mostrar(vistaPadrao());
}
// Fechou um aviso com o mouse em cima: volta ao notch e só abre o painel de novo
// depois que o mouse sair de perto da ilha (senão "fechar" abria o painel)
function fecharAvisoPeloUsuario() {
  estado.esperarSair = true;
  clearTimeout(timeoutRecolher);
  voltarAoPadrao();
}

// ---- Cartão de compromisso (alertas da agenda) ----
const CORES_AGENDA = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb923c', '#22d3ee'];
function corDaAgenda(fonte) {
  if (!fonte) return getComputedStyle(document.documentElement).getPropertyValue('--destaque').trim() || '#60a5fa';
  let h = 0;
  for (const c of String(fonte)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CORES_AGENDA[h % CORES_AGENDA.length];
}
const MESES_CURTOS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const DIAS_CURTOS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto != null) e.textContent = texto;
  return e;
}
// folhinha de calendário: faixa colorida com o mês e o dia grandão
function folhinha(data, comSino) {
  const f = el('div', 'ac-selo ac-folha');
  const topo = el('div', 'ac-mes', MESES_CURTOS[data.getMonth()]);
  const dia = el('div', 'ac-dia', String(data.getDate()));
  const sem = el('div', 'ac-semana', DIAS_CURTOS[data.getDay()]);
  f.append(topo, dia, sem);
  if (comSino) f.append(el('span', 'ac-sino', '🔔'));
  return f;
}
// anel da contagem regressiva (o arco é o tempo que falta dentro da última hora)
const SVG_NS = 'http://www.w3.org/2000/svg';
function anel() {
  const a = el('div', 'ac-selo ac-anel');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 50 50');
  for (const classe of ['ac-trilho', 'ac-arco']) {
    const c = document.createElementNS(SVG_NS, 'circle');
    c.setAttribute('cx', '25'); c.setAttribute('cy', '25'); c.setAttribute('r', '21');
    c.setAttribute('pathLength', '100'); c.setAttribute('class', classe);
    svg.appendChild(c);
  }
  const num = el('div', 'ac-num');
  const un = el('div', 'ac-un');
  a.append(svg, el('div', 'ac-rotulo'));
  a.lastChild.append(num, un);
  return a;
}
function faltaTexto(ms) {
  const seg = Math.max(0, Math.round(ms / 1000));
  if (seg >= 3540) { // perto de 1 hora ou mais: em horas
    const min = Math.round(seg / 60); const h = Math.floor(min / 60); const m = min % 60;
    return [m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`, m ? '' : (h === 1 ? 'hora' : 'horas')];
  }
  if (seg >= 600) return [String(Math.ceil(seg / 60)), 'min']; // mais de 10 min: só os minutos
  return [`${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, '0')}`, 'min'];
}
let relogioCartao = null;
function montarCartao(c) {
  clearInterval(relogioCartao);
  const caixa = $('avisoCartao');
  caixa.innerHTML = '';
  if (!c) return;
  const cor = corDaAgenda(c.fonte);
  ilha.style.setProperty('--cor-ag', cor);
  caixa.dataset.modo = c.modo;
  caixa.append(el('div', 'ac-aura'));
  const inicio = c.inicio ? new Date(c.inicio) : new Date();

  if (c.modo === 'resumo') {
    const topo = el('div', 'ac-topo');
    const textos = el('div', 'ac-corpo');
    textos.append(el('div', 'ac-chamada', c.chamada), el('div', 'ac-titulo', c.titulo));
    topo.append(folhinha(new Date(), false), textos);
    const lista = el('div', 'ac-linhas');
    const agora = Date.now();
    let marcouProximo = false;
    c.itens.forEach((it, i) => {
      const linha = el('div', 'ac-linha');
      linha.style.setProperty('--i', i);
      linha.style.setProperty('--cor-ag', corDaAgenda(it.fonte));
      if (!marcouProximo && it.inicio && it.inicio > agora) { linha.classList.add('proximo'); marcouProximo = true; }
      const corpo = el('div', 'ac-lt');
      corpo.append(el('span', 'ac-lt-titulo', it.titulo));
      if (it.fonte || it.local) corpo.append(el('span', 'ac-lt-fonte', [it.local, it.fonte].filter(Boolean).join(' · ')));
      linha.append(el('div', 'ac-lh', it.hora || 'dia todo'), el('i', 'ac-no'), corpo);
      lista.appendChild(linha);
    });
    caixa.append(topo, lista);
    const e = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')) || 1;
    ilha.style.setProperty('--altura-aviso', Math.min(window.innerHeight - 10, (84 + c.itens.length * 34) * e) + 'px');
    return;
  }

  const selo = c.modo === 'antes' ? anel() : folhinha(inicio, c.modo === 'agora' || c.modo === 'adiado');
  const corpo = el('div', 'ac-corpo');
  const chamada = el('div', 'ac-chamada', c.chamada);
  const titulo = el('div', 'ac-titulo', c.titulo);
  titulo.title = c.titulo;
  const info = el('div', 'ac-info');
  info.append(el('i', 'ac-ponto'));
  const quando = c.hora ? (c.fim ? `${c.hora} – ${c.fim}` : c.hora) : 'Dia inteiro';
  info.append(el('span', 'ac-quando', quando));
  if (c.local) info.append(el('span', 'ac-local', '📍 ' + c.local));
  if (c.fonte) info.append(el('span', 'ac-fonte', c.fonte));
  corpo.append(chamada, titulo, info);
  caixa.append(selo, corpo);

  if (c.modo === 'antes' && c.inicio) {
    const arco = selo.querySelector('.ac-arco');
    const [num, un] = [selo.querySelector('.ac-num'), selo.querySelector('.ac-un')];
    const tique = () => {
      if (estado.vista !== 'aviso' || !caixa.isConnected) { clearInterval(relogioCartao); return; }
      const falta = c.inicio - Date.now();
      const [n, u] = faltaTexto(falta);
      num.textContent = n; un.textContent = u;
      const janela = falta > 3600000 ? 86400000 : 3600000;
      arco.style.strokeDasharray = `${Math.max(0.5, Math.min(100, (falta / janela) * 100)).toFixed(2)} 100`;
      selo.classList.toggle('ultimo-minuto', falta < 60000);
    };
    arco.style.strokeDasharray = '0 100';
    requestAnimationFrame(() => requestAnimationFrame(tique));
    relogioCartao = setInterval(tique, 1000);
  }
}

function aviso(titulo, sub = '', { icone = '✓', tipo = '', ms = 2600, alto = false, botoes = [], cartao = null } = {}) {
  clearTimeout(timeoutAviso);
  const caixa = $('avisoBotoes');
  caixa.innerHTML = '';
  for (const b of botoes) {
    const bt = document.createElement('button');
    bt.textContent = b.texto;
    bt.addEventListener('click', (e) => { e.stopPropagation(); b.acao(); fecharAvisoPeloUsuario(); });
    caixa.appendChild(bt);
  }
  // avisos com ações (download, atualização, novidades...) ganham um × para fechar
  if ((botoes.length || alto) && !(cartao && botoes.length)) {
    const x = document.createElement('button');
    x.className = 'fechar-aviso';
    x.textContent = '×';
    x.title = 'Fechar';
    x.setAttribute('aria-label', 'Fechar aviso');
    x.addEventListener('click', (e) => { e.stopPropagation(); fecharAvisoPeloUsuario(); });
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
  ilha.classList.toggle('cartao-agenda', !!cartao);
  ilha.classList.toggle('resumo', cartao?.modo === 'resumo');
  // painel alto do tamanho da lista (ajuda, novidades da versão...)
  if (alto && Array.isArray(sub)) {
    const e = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--escala')) || 1;
    ilha.style.setProperty('--altura-aviso', Math.min(window.innerHeight - 10, (62 + sub.length * 21) * e) + 'px');
  } else {
    ilha.style.removeProperty('--altura-aviso');
  }
  montarCartao(cartao);
  // com botões, espera o mouse sair antes de sumir
  const fechar = () => {
    if (botoes.length && estado.hover) { timeoutAviso = setTimeout(fechar, 1000); return; }
    // aviso sumindo com o mouse em cima: volta ao notch, não abre o painel
    if (estado.hover && !estado.fixada) estado.esperarSair = true;
    voltarAoPadrao();
  };
  timeoutAviso = setTimeout(fechar, ms);
}

// Mouse: a janela deixa o clique "atravessar", menos em cima da ilha
ilha.addEventListener('mouseenter', () => {
  if (ilha.classList.contains('discreta') && estado.vista === 'compacta') return; // abre só parando o mouse (veja o cursor)
  estado.hover = true;
  definirInterativo(true);
  clearTimeout(timeoutRecolher);
  if (estado.config.abrirAoPassar !== false) {
    timeoutRecolher = setTimeout(() => {
      if (estado.vista === 'compacta' && !estado.esperarSair) abrirPainel();
    }, estado.config.atrasoAbrir ?? 140);
  }
  if (Math.random() < 0.35) olhos.reagir('surpreso', 500);
});
// volta depois de um jogo: estado limpo (nada "preso" de antes de esconder)
// ---- Saída de áudio e microfone ----
function desenharDispositivos(lista, caixa, vazio) {
  caixa.innerHTML = '';
  if (!lista?.length) { const p = document.createElement('div'); p.className = 'vazio'; p.textContent = vazio; caixa.appendChild(p); return; }
  for (const d of lista) {
    const b = document.createElement('button');
    b.textContent = d.nome || 'Dispositivo';
    b.title = d.nome || '';
    if (d.padrao) b.className = 'ativo';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (d.padrao) return;
      caixa.querySelectorAll('button').forEach((x) => x.classList.toggle('ativo', x === b));
      api.definirAudio(d.id);
      aviso(d.nome, caixa.id === 'listaSaidas' ? 'Saída de áudio' : 'Microfone', { icone: caixa.id === 'listaSaidas' ? '🔊' : '🎙', tipo: 'info', ms: 2200 });
    });
    caixa.appendChild(b);
  }
}
api.on('dispositivos', (d) => {
  desenharDispositivos(d.saidas, $('listaSaidas'), 'Nenhuma saída de áudio');
  desenharDispositivos(d.entradas, $('listaEntradas'), 'Nenhum microfone');
});
$('tgAudio').addEventListener('click', (e) => {
  e.stopPropagation();
  const p = $('painelAudio');
  p.hidden = !p.hidden;
  if (!p.hidden) {
    if (!$('listaSaidas').children.length) { $('listaSaidas').innerHTML = '<div class="vazio">Carregando…</div>'; $('listaEntradas').innerHTML = '<div class="vazio">Carregando…</div>'; }
    api.listarAudio?.();
  }
});
$('fecharAudio').addEventListener('click', (e) => { e.stopPropagation(); $('painelAudio').hidden = true; });

api.on('janela:reexibida', () => {
  estado.hover = false;
  estado.fixada = false;
  estado.jogo = false;
  estado.esperarSair = false;
  apertou = null;
  interativoAgora = null;
  definirInterativo(false);
  if (estado.vista === 'expandida') mostrar('compacta');
  $('painelAudio').hidden = true;
});
// diagnóstico: o que acontece com cada clique (vai para o log por alguns minutos)
for (const tipo of ['pointerdown', 'pointerup', 'click']) {
  document.addEventListener(tipo, (e) => {
    const alvo = e.target?.id || e.target?.className?.toString?.().slice(0, 30) || e.target?.tagName;
    api.diagClique?.(`${tipo} em ${alvo} | vista=${estado.vista} hover=${estado.hover} interativo=${interativoAgora} botoes=${e.buttons} tipo=${e.pointerType || ''}`);
  }, true);
}
document.addEventListener('mouseleave', () => api.diagClique?.(`saiu da janela | vista=${estado.vista}`));
ilha.addEventListener('mousemove', () => {
  if (interativoAgora === false && !(ilha.classList.contains('discreta') && estado.vista === 'compacta')) {
    estado.hover = true;
    definirInterativo(true);
  }
});
ilha.addEventListener('mouseleave', () => {
  if (estado.jogo) return; // aberta por cima do jogo: só fecha com Esc, Ctrl+Alt+I ou clicando no jogo
  estado.hover = false;
  estado.fixada = false;
  definirInterativo(false);
  clearTimeout(timeoutRecolher);
  timeoutRecolher = setTimeout(() => {
    if (estado.vista === 'expandida' && !estado.fixada && !estado.teclado) mostrar('compacta');
  }, 220);
  if (estado.vista === 'busca' || estado.teclado) definirInterativo(true); // continua clicável enquanto digita
});
ilha.addEventListener('click', (e) => {
  if (e.target.closest('button, input, textarea, .resultados, .controles-rapidos, .carrossel')) return;
  if (estado.vista === 'busca') return;
  if (estado.vista === 'aviso') { fecharAvisoPeloUsuario(); return; }
  if (estado.vista === 'escuta') { voz.pararComando(); return; }
  if (e.target.closest('.olhos')) olhos.cutucar(); // carinho (e cutucar demais deixa tonto)
  // Clique na pílula abre o painel; ele fecha sozinho quando o mouse sai
  if (estado.vista === 'compacta' && !ilha.classList.contains('discreta')) abrirPainel();
});

function abrirPainel() {
  if (estado.voltarAoInicio) {
    estado.voltarAoInicio = false;
    widgets?.irParaInicio?.();
    const pa = document.getElementById('painelAudio');
    if (pa) pa.hidden = true;
  }
  mostrar('expandida');
  api.sistema('estado');
  widgets?.aoAbrirPainel();
}

// Atalho do painel: abre (fica aberto até você passar o mouse e sair, ou apertar de novo)
let timeoutPainelTeclado = null;
// Ctrl+Alt+I durante um jogo: painel aberto e pegando mouse e teclado até você sair
// Ilha escondida (jogo, ou escondida pelo atalho): pausa todas as animações e os gestos;
// volta exatamente de onde parou quando reaparece
// barra do minuto: recomeça a animação no ponto certo do minuto atual
function sincronizarBarraMinuto(barra, agora = new Date()) {
  const seg = agora.getSeconds() + agora.getMilliseconds() / 1000;
  for (const parte of barra.children) {
    parte.style.animation = 'none';
    void parte.offsetWidth;
    parte.style.animation = '';
    parte.style.animationDelay = `-${seg.toFixed(3)}s`;
  }
  barra.__sinc = true;
}
api.on('janela:pausar', (sim) => {
  document.documentElement.classList.toggle('pausada', !!sim);
  olhos.pausar?.(sim);
  // voltou a aparecer: a barra ficou parada enquanto escondida, acerta com o relógio
  const barraMin = !sim && $('relogioNotch')?.querySelector('.minuto');
  if (barraMin) sincronizarBarraMinuto(barraMin);
});

// Faxina de memória (a cada 10 min e ao entrar num jogo): solta imagens e caches que não estão em uso
api.on('memoria:liberar', () => api.liberarMemoria?.());

// Avisos pedidos pelo processo principal
api.on('aviso:mostrar', (d) => {
  if (!d) return;
  aviso(d.titulo || '', d.sub || '', { icone: d.icone || 'ℹ️', tipo: d.tipo || 'info', ms: d.ms || 9000, alto: !!d.alto });
});

api.on('jogo:interagir', (sim) => {
  estado.jogo = !!sim;
  if (sim) {
    estado.hover = true;
    estado.fixada = true;
    abrirPainel();
  } else {
    estado.fixada = false;
    estado.hover = false;
    mostrar('compacta');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && estado.jogo && estado.vista !== 'busca') { e.preventDefault(); api.sairDoJogo?.(); }
});
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
    definirInterativo(false);
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

// Relógio do topo: números que rolam como odômetro, dois-pontos pulsando e um mini relógio de ponteiros
// cuja cor acompanha a hora do dia (madrugada, manhã, tarde, pôr do sol, noite)
const giro = { h: null, m: null, s: null }; // graus acumulados (o ponteiro nunca "volta" de 359° para 0°)
function rolarPara(fita, n) { fita.style.transform = `translateY(${(-n * 1.3).toFixed(2)}em)`; } // 1,3em por dígito (com folga, sem aparecer o vizinho)
// O ":" fica naturalmente mais baixo que o meio dos números (e quanto, depende da fonte de cada PC).
// Mede na própria fonte da ilha onde está o meio de "0" e o de ":" e sobe o ":" exatamente a diferença.
const reguaTexto = document.createElement('canvas').getContext('2d');
function centralizarDoisPontos(caixa) {
  for (const sep of caixa.querySelectorAll('.sep')) {
    const cs = getComputedStyle(sep);
    reguaTexto.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const meio = (t) => { const m = reguaTexto.measureText(t); return (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2; };
    const tamanho = parseFloat(cs.fontSize) || 12;
    const sobe = (meio('0') - meio(':')) / tamanho; // em "em": vale para qualquer tamanho da ilha
    if (Number.isFinite(sobe)) sep.style.translate = `0 ${(-sobe).toFixed(3)}em`;
  }
}
function desenharDigitos(texto, caixa = $('horaGrande'), olhinhos = false) {
  const forma = texto.replace(/\d/g, '0');
  if (forma !== caixa.dataset.molde) {
    caixa.dataset.molde = forma;
    caixa.replaceChildren();
    for (const ch of texto) {
      if (/\d/.test(ch)) {
        const rolo = document.createElement('span'); rolo.className = 'rolo';
        const fita = document.createElement('span'); fita.className = 'fita';
        for (let d = 0; d <= 9; d++) { const i = document.createElement('i'); i.textContent = d; fita.append(i); }
        rolo.append(fita); caixa.append(rolo);
      } else {
        const sep = document.createElement('span');
        sep.className = ch === ':' ? 'sep' : 'letra';
        // no notch, os dois-pontos são dois olhinhos que piscam
        // no notch, os dois-pontos são "olhinhos" que piscam (o próprio ":" da fonte: sempre alinhado com os números)
        if (ch === ':' && olhinhos) sep.classList.add('olhinhos');
        sep.textContent = ch;
        caixa.append(sep);
      }
    }
    requestAnimationFrame(() => centralizarDoisPontos(caixa));
  }
  let k = 0;
  for (const ch of texto) {
    const el = caixa.children[k++];
    if (!el?.classList.contains('rolo')) continue;
    // o dígito que muda rola com um leve desfoque de movimento, como um mecanismo de verdade
    if (el.dataset.n !== undefined && el.dataset.n !== ch) {
      el.classList.add('rolando');
      clearTimeout(el.__timerRolo);
      el.__timerRolo = setTimeout(() => el.classList.remove('rolando'), 650);
    }
    el.dataset.n = ch;
    rolarPara(el.firstChild, Number(ch));
  }
}
function girarPonteiro(id, chave, graus) {
  const el = $(id);
  if (!el) return;
  if (giro[chave] === null) giro[chave] = graus;
  else {
    let delta = graus - (giro[chave] % 360 + 360) % 360;
    if (delta < -180) delta += 360;
    if (delta > 180) delta -= 360;
    giro[chave] += delta;
  }
  el.style.transform = `rotate(${giro[chave]}deg)`;
}
function periodoDoDia(h) {
  if (h < 5) return 'madrugada';
  if (h < 11) return 'manha';
  if (h < 17) return 'tarde';
  if (h < 19) return 'por-do-sol';
  return 'noite';
}
const fmtDataLonga = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
let ultimaHoraCheia = -1;
let ultimoMinuto = -1;
// O minuto virou: o mascote dá uma espiadinha no relógio do notch enquanto os números rolam
function espiarRelogio(horaCheia) {
  const caixa = $('textoCompacto');
  if (estado.vista !== 'compacta' || caixa?.dataset.modo !== 'relogio' || document.documentElement.classList.contains('pausada')) return;
  // minuto novo: uma faixa de luz passa pelos números
  const rn = $('relogioNotch');
  if (rn) { rn.classList.remove('brilho'); void rn.offsetWidth; rn.classList.add('brilho'); }
  if (horaCheia) {
    caixa.classList.remove('hora-cheia'); void caixa.offsetWidth; caixa.classList.add('hora-cheia');
    olhos.fazer?.('pulinho');
  }
  if (olhos.livre && !olhos.livre()) return;
  const r = caixa.getBoundingClientRect();
  if (!r.width) return;
  olhos.olhandoAte = Date.now() + 1500;
  olhos.olharPara(r.left + r.width / 2, r.top + r.height / 2);
  setTimeout(() => { if (olhos.cursor) olhos.olharPara(olhos.cursor.x, olhos.cursor.y); }, 1500);
}
function atualizarRelogio() {
  const agora = new Date();
  desenharDigitos(fmtHora.format(agora));
  const dataCurta = fmtData.format(agora).replace(/\./g, '');
  $('dataGrande').textContent = dataCurta.charAt(0).toUpperCase() + dataCurta.slice(1);
  const h = agora.getHours(), m = agora.getMinutes(), s = agora.getSeconds();
  girarPonteiro('ponteiroH', 'h', (h % 12) * 30 + m * 0.5);
  girarPonteiro('ponteiroM', 'm', m * 6 + s * 0.1);
  girarPonteiro('ponteiroS', 's', s * 6);
  const relogio = $('relogioTopo');
  if (relogio) {
    relogio.dataset.periodo = periodoDoDia(h);
    const longa = fmtDataLonga.format(agora);
    relogio.title = longa.charAt(0).toUpperCase() + longa.slice(1);
    // hora cheia: os números fazem uma ondinha
    if (m === 0 && s < 2 && ultimaHoraCheia !== h) {
      ultimaHoraCheia = h;
      relogio.classList.remove('hora-cheia'); void relogio.offsetWidth; relogio.classList.add('hora-cheia');
    }
  }
  $('textoCompacto').dataset.periodo = periodoDoDia(h);
  atualizarTextoCompacto();
  // barra do minuto (anda 1 s por vez, suave; no segundo 0 volta ao começo sem animação)
  // a barra anda sozinha (animação contínua de 60 s); aqui só acerta com o relógio na virada do minuto
  const barraMin = $('relogioNotch')?.querySelector('.minuto');
  if (barraMin && (s === 0 || !barraMin.__sinc)) sincronizarBarraMinuto(barraMin, agora);
  if (ultimoMinuto !== -1 && ultimoMinuto !== m) espiarRelogio(m === 0);
  ultimoMinuto = m;
}

function atualizarTextoCompacto() {
  const m = estado.midia;
  const tocando = m.ativo && m.status === 'Playing';
  const texto = tocando ? m.titulo : fmtHora.format(new Date());
  const caixa = $('textoCompacto');
  // sem música: o relógio do notch (números que rolam e dois-pontos que piscam)
  if (!tocando) {
    if (caixa.dataset.modo !== 'relogio') {
      caixa.dataset.modo = 'relogio';
      caixa.dataset.texto = '';
      caixa.classList.remove('rolando');
      const embrulho = document.createElement('span'); embrulho.className = 'relogio-caixa'; embrulho.id = 'relogioNotch';
      const d = document.createElement('span'); d.className = 'digitos relogio-notch';
      // fio de luz embaixo da hora: enche ao longo do minuto, com uma "cabeça" de cometa
      const barra = document.createElement('span'); barra.className = 'minuto'; barra.append(document.createElement('i'), document.createElement('b'));
      embrulho.append(d, barra);
      caixa.replaceChildren(embrulho);
    }
    desenharDigitos(texto, $('relogioNotch').firstElementChild, true);
    return;
  }
  caixa.dataset.modo = 'texto';
  if (caixa.dataset.texto === texto) { conferirLetreiro(); return; }
  caixa.dataset.texto = texto;
  caixa.classList.remove('rolando');
  caixa.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = texto;
  caixa.appendChild(span);
  requestAnimationFrame(conferirLetreiro);
}

// Nome grande demais: passa em looping (letreiro), sem cortar com "..."
function conferirLetreiro() {
  const caixa = $('textoCompacto');
  if (caixa.dataset.modo === 'relogio') return;
  const span = caixa.firstElementChild;
  if (!span || !caixa.clientWidth) return;
  // largura do nome sozinho (guardada antes de duplicar o texto para o letreiro)
  if (!caixa.classList.contains('rolando')) caixa.dataset.largura = span.offsetWidth;
  const precisa = Number(caixa.dataset.largura) > caixa.clientWidth + 2;
  if (precisa && !caixa.classList.contains('rolando')) {
    const texto = caixa.dataset.texto;
    span.textContent = `${texto}\u2003•\u2003${texto}\u2003•\u2003`;
    // velocidade constante (~28 px por segundo), qualquer que seja o tamanho do nome
    span.style.animationDuration = `${Math.max(6, (span.offsetWidth / 2) / 28)}s`;
    caixa.classList.add('rolando');
  } else if (!precisa && caixa.classList.contains('rolando')) {
    span.textContent = caixa.dataset.texto;
    caixa.classList.remove('rolando');
  }
}
window.addEventListener('resize', () => requestAnimationFrame(conferirLetreiro));
// a ilha muda de largura com animação: mede de novo quando ela termina de crescer/encolher
document.getElementById('ilha').addEventListener('transitionend', (e) => { if (e.propertyName === 'width') conferirLetreiro(); });

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
let timerLiberarMemoria = null;
function atualizarMidia(m) {
  m = m || { ativo: false };
  // Música nova: alguns players (Spotify) mandam o tempo da música anterior por um tempinho.
  // Enquanto o tempo for "velho", conta do zero a partir da troca.
  const chaveFaixa = m.ativo ? `${m.titulo}|${m.artista}` : '';
  const antes = estado.midia;
  if (chaveFaixa !== estado.chaveFaixa) {
    if (estado.chaveFaixa !== undefined && m.ativo) {
      estado.inicioFaixa = Date.now();
      estado.quandoVelho = antes?.quando;
    } else {
      estado.inicioFaixa = 0;
    }
    estado.chaveFaixa = chaveFaixa;
    ilha.classList.remove('trocando-faixa');
    clearTimeout(estado.timeoutTroca);
  }
  if (estado.inicioFaixa && m.dur && m.quando
      && (m.quando === estado.quandoVelho || m.quando < estado.inicioFaixa - 1500)) {
    m.pos = 0;
    m.quando = estado.inicioFaixa;
  } else if (m.quando && m.quando !== estado.quandoVelho) {
    estado.inicioFaixa = 0; // o player já mandou o tempo certo da música nova
  }
  estado.midia = m;
  const tocando = m.ativo && m.status === 'Playing';
  ilha.classList.toggle('com-midia', !!m.ativo && tocando);
  ilha.classList.toggle('tocando', tocando);
  ilha.classList.toggle('sem-midia', !m.ativo);
  $('titulo').textContent = m.ativo ? m.titulo : 'Nada tocando';
  $('artista').textContent = m.ativo ? (m.artista || nomeApp(m.app)) : 'Diga "ilha, ajuda" para ver os comandos';
  // a capa só chega quando a música muda; mantém a anterior enquanto for a mesma
  const chave = m.ativo ? `${m.titulo}|${m.artista}` : '';
  if (m.ativo && m.capa) {
    if (m.capa !== estado.capaUrl) {
      estado.capaUrl = m.capa;
      $('capaGrande').style.backgroundImage = `url("${m.capa}")`;
      $('capaMini').style.backgroundImage = `url("${m.capa}")`;
      // a capa anterior (às vezes 250 KB) não fica guardada no cache de imagens
      clearTimeout(timerLiberarMemoria);
      timerLiberarMemoria = setTimeout(() => api.liberarMemoria?.(), 4000);
    }
    ilha.classList.add('com-capa');
    estado.chaveCapa = chave;
  } else if (chave !== estado.chaveCapa) {
    $('capaGrande').style.backgroundImage = '';
    $('capaMini').style.backgroundImage = '';
    estado.capaUrl = '';
    ilha.classList.remove('com-capa');
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
  botao.addEventListener('click', () => {
    const cmd = botao.dataset.midia;
    api.acao({ tipo: 'midia', cmd });
    if (cmd === 'next' || cmd === 'prev') {
      // apaga o nome um instante até a música nova chegar (sem mostrar a antiga como se fosse a atual)
      ilha.classList.add('trocando-faixa');
      clearTimeout(estado.timeoutTroca);
      estado.timeoutTroca = setTimeout(() => ilha.classList.remove('trocando-faixa'), 3500);
    }
  });
});
api.on('nivel', (v) => { if (estado.midia?.status === 'Playing') olhos.nivelMusica(Number(v) || 0); });

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

let vozSuave = 0;
function animarOnda() {
  const palco = $('vistaEscuta');
  const passo = () => {
    const n = Math.min(1, voz.nivel() * 1.6);
    // sobe rápido, desce macio (parece que o mascote "escuta" cada sílaba)
    vozSuave = n > vozSuave ? vozSuave + (n - vozSuave) * 0.55 : vozSuave + (n - vozSuave) * 0.12;
    palco?.style.setProperty('--voz', vozSuave.toFixed(3));
    animacaoOnda = requestAnimationFrame(passo);
  };
  cancelAnimationFrame(animacaoOnda);
  passo();
}

// Palco da voz: ouvindo → pensando → entendeu / confuso (sem texto: o mascote mostra tudo)
let timerPalco = null;
function palco(estadoNovo, icone = '') {
  const el = $('vistaEscuta');
  if (!el) return;
  el.classList.remove('ouvindo', 'pensando', 'entendeu', 'confuso', 'sim', 'acordou');
  void el.offsetWidth; // reinicia as animações
  if (estadoNovo) el.classList.add(estadoNovo);
  $('estalo').textContent = icone;
}
const ICONES_ACAO = {
  next: '⏭', prev: '⏮', toggle: '⏯', mute: '🔇', volup: '🔊', voldown: '🔉',
  abrir: '🚀', 'abrir-instalado': '🚀', timer: '⏱', 'timer-cancelar': '🛑', tarefa: '✅', nota: '📝', evento: '📅',
  pesquisar: '🔎', youtube: '▶', claude: '✨', hora: '🕐', data: '📆', bateria: '🔋', tocando: '🎵', sistema: '⚙',
  bloquear: '🔒', captura: '📸', esconder: '👋', cancelar: '👌', widget: '🗂', busca: '🔎', ajuda: '💡', foco: '🍅',
};
function iconeDaAcao(i) { return (i?.tipo === 'midia' ? ICONES_ACAO[i.cmd] : ICONES_ACAO[i?.tipo]) || '✨'; }
/** Reação do mascote antes de executar: entendeu (ícone saltando) ou confuso ("?") */
function reagirAoComando(intencao) {
  clearTimeout(timerPalco);
  if (estado.vista !== 'escuta') mostrar('escuta');
  if (!intencao || intencao.tipo === 'nao-entendi') {
    palco('confuso', '❓');
    return new Promise((r) => setTimeout(r, 1100));
  }
  palco('entendeu', iconeDaAcao(intencao));
  return new Promise((r) => setTimeout(r, 650));
}

// "Tlin": dois tons suaves quando a ilha começa a ouvir (dá para saber que pode falar sem olhar)
let ctxTlin = null;
let ultimoTlin = 0;
function tlin() {
  if (Date.now() - ultimoTlin < 1500) return;
  ultimoTlin = Date.now();
  try {
    ctxTlin ||= new AudioContext();
    const t = ctxTlin.currentTime;
    [[880, 0], [1320, 0.09]].forEach(([f, atraso]) => {
      const o = ctxTlin.createOscillator(); const g = ctxTlin.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, t + atraso);
      g.gain.linearRampToValueAtTime(0.05, t + atraso + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + atraso + 0.22);
      o.connect(g).connect(ctxTlin.destination);
      o.start(t + atraso); o.stop(t + atraso + 0.25);
    });
  } catch { /* sem som */ }
}
voz.addEventListener('ouvindo', (e) => {
  olhos.definirBase(e.detail ? 'ouvindo' : (estado.midia.status === 'Playing' ? 'musica' : 'normal'));
  if (e.detail) {
    tlin();
    clearTimeout(timeoutAviso);
    clearTimeout(timerPalco);
    mostrar('escuta');
    palco('ouvindo');
    animarOnda();
  } else {
    cancelAnimationFrame(animacaoOnda);
    $('vistaEscuta')?.style.setProperty('--voz', '0');
    // terminou de falar: pensa (se nenhum comando chegar, volta ao normal)
    if (estado.vista === 'escuta') {
      palco('pensando');
      clearTimeout(timerPalco);
      timerPalco = setTimeout(() => { if (estado.vista === 'escuta') mostrar(vistaPadrao()); }, 2500);
    }
  }
});
voz.addEventListener('parcial', () => {
  voz.reiniciarTimeout(4000); // ainda falando: dá mais tempo (o que você fala não aparece escrito)
});
// "Ilha!": acorda num pulinho, antes de qualquer outra coisa
voz.addEventListener('ativacao', () => {
  clearTimeout(timerPalco);
  mostrar('escuta');
  palco('acordou');
  setTimeout(() => { if (voz.captura) palco('ouvindo'); }, 450);
});
voz.addEventListener('silencio', () => {
  api.vozFim?.();
  olhos.reagir('confuso', 1800);
  aviso('Não ouvi nada', 'Tente de novo: Ctrl+Alt+Espaço', { icone: '…', tipo: 'info', ms: 2000 });
});
voz.addEventListener('comando', async (e) => {
  try { await tratarComando(e.detail); } finally { api.vozFim?.(); } // no jogo, a ilha some de novo depois
});
// Tira a palavra de ativação do começo ("Ilha, passar a música" -> "passar a música")
function semAtivacao(texto) {
  const palavra = normalizar(estado.config.palavraAtivacao || 'ilha');
  const partes = String(texto).trim().split(/\s+/);
  let i = partes.slice(0, 3).findIndex((p) => normalizar(p) === palavra);
  // o nome escrito errado na 1ª palavra ("Ile", "Ilia", "Or", "Ela", "Ia"): também sai
  if (i < 0 && partes.length > 1) {
    const p0 = normalizar(partes[0]);
    const parecida = p0.length <= 4 || p0.startsWith(palavra.slice(0, 2)) || /^(e|o|oi|ei|ou|ah|ai|ia|ela|ele|olha|ilia|ilya|ile|ila|ira)$/.test(p0);
    if (parecida && escolherIntencao(partes.slice(1).join(' '), '').intencao?.tipo !== 'nao-entendi') i = 0;
  }
  return (i >= 0 ? partes.slice(i + 1) : partes).join(' ').replace(/^[,.!?\s]+/, '').trim();
}
let frasesConhecidas = [];
async function tratarComando(d) {
  if (typeof d === 'string') { await executarFrase(d); return; }
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const livre = interpretar(d.texto);
  const daGramatica = d.alternativa ? interpretar(d.alternativa) : null;

  // 1) Os dois reconhecedores rápidos concordam num comando simples: executa NA HORA
  clearTimeout(timerPalco);
  if (mesmoComando(livre, daGramatica)) {
    api.logVoz?.(`na hora: "${d.texto}" = "${d.alternativa}" → ${livre.tipo}${livre.cmd ? ' ' + livre.cmd : ''} (${ms()} ms)`);
    await reagirAoComando(livre);
    await executarFrase(d.alternativa);
    return;
  }

  // 2) Whisper (entende muito melhor; o servidor já foi ligado enquanto você falava)
  if (d.audio && api.transcrever && estado.whisper !== false) {
    if (estado.vista !== 'escuta') mostrar('escuta');
    palco('pensando');
    olhos.reagir('pensando', 4000);
    try {
      const r = await api.transcrever(d.audio);
      if (r?.ok && r.texto) {
        // O ouvido dedicado já reconheceu o nome: o Whisper às vezes escreve "ilha" errado ("Ile", "Or", "Ela"…),
        // então a 1ª palavra parecida com o nome é descartada e o resto vira o comando
        const ouvido = d.ativacao ? semAtivacao(r.texto) : r.texto;
        const comandoDoWhisper = escolherIntencao(ouvido, '').intencao;
        if (d.ativacao && normalizar(ouvido) && comandoDoWhisper?.tipo === 'nao-entendi' && !d.alternativa && !normalizar(d.texto)) {
          // nada parecido com comando e nenhum palpite dos reconhecedores rápidos: provavelmente não era comigo
          api.logVoz?.(`ignorado (não era comigo): "${r.texto}" (${ms()} ms)`);
          mostrar(vistaPadrao());
          return;
        }
        if (d.ativacao && !normalizar(ouvido)) {
          // chamou só o nome: "Sim?" (pisca duas vezes) e escuta o comando
          api.logVoz?.(`só o nome (${ms()} ms): esperando o comando`);
          palco('sim');
          setTimeout(() => ativarVoz(), 350);
          return;
        }
        const doWhisper = escolherIntencao(ouvido, '').intencao;
        if (doWhisper && doWhisper.tipo !== 'nao-entendi') {
          api.logVoz?.(`whisper: "${r.texto}" → ${doWhisper.tipo}${doWhisper.cmd ? ' ' + doWhisper.cmd : ''} (${ms()} ms; rápido ouviu "${d.texto}")`);
          await reagirAoComando(doWhisper);
          await executarFrase(ouvido);
          return;
        }
        // 3) Whisper ouviu algo torto: procura o comando conhecido com o som mais parecido
        const parecida = fraseMaisParecida(ouvido, frasesConhecidas);
        if (parecida) {
          api.logVoz?.(`whisper: "${r.texto}" ≈ "${parecida}" (${ms()} ms)`);
          await reagirAoComando(interpretar(parecida));
          await executarFrase(parecida);
          return;
        }
        const rapido = escolherIntencao(d.texto, d.alternativa).intencao;
        if (rapido && rapido.tipo !== 'nao-entendi') {
          api.logVoz?.(`whisper não entendeu "${r.texto}"; usou o rápido "${d.texto}" (${ms()} ms)`);
          await reagirAoComando(rapido);
          await executarFrase(d.texto, d.alternativa);
          return;
        }
        api.logVoz?.(`não entendi: whisper "${r.texto}", rápido "${d.texto}" (${ms()} ms)`);
        await reagirAoComando(null);
        await executarFrase(ouvido);
        return;
      }
    } catch { /* usa o rápido */ }
  }
  api.logVoz?.(`só o rápido: "${d.texto}" / "${d.alternativa}" (${ms()} ms)`);
  await reagirAoComando(escolherIntencao(d.texto, d.alternativa).intencao);
  await executarFrase(d.texto, d.alternativa);
}
// Começou a falar: liga o Whisper enquanto isso
voz.addEventListener('preparar', () => api.prepararWhisper?.());
// "Ilha, …": a ilha já mostra que ouviu o próprio nome
let ultimoAcenoAtivacao = 0;
voz.addEventListener('parcial-ativacao', () => {
  if (Date.now() - ultimoAcenoAtivacao < 2500) return;
  ultimoAcenoAtivacao = Date.now();
  olhos.reagir('ouvindo', 2200);
  tlin();
});
api.on('whisper:status', (s) => {
  if (s.fase === 'baixando') {
    estado.whisperBaixando = Math.round((s.progresso || 0) * 100);
    if (s.progresso === 0) aviso('Baixando voz aprimorada', 'Whisper · 190 MB · só na primeira vez', { icone: '↓', tipo: 'info', ms: 5000 });
  } else if (s.fase === 'pronto') {
    aviso('Voz aprimorada pronta', 'Agora a ilha entende bem melhor o que você fala', { icone: '🎙', tipo: 'info', ms: 4000 });
  }
});

// Ensina ao reconhecimento os comandos e os nomes dos apps instalados (acerta muito mais "abrir X")
let appsParaVoz = [];
async function prepararVocabulario() {
  try { appsParaVoz = (await api.listarApps()) || []; } catch { appsParaVoz = []; }
  try {
    frasesConhecidas = frasesDeComando(appsParaVoz.map((a) => a.nome));
    voz.definirGramatica(frasesConhecidas);
  } catch (e) { console.warn(e); }
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
    api.garantirWhisper?.().then((ok) => { estado.whisper = ok; });
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
  definirInterativo(true);
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
  if (!estado.hover) definirInterativo(false);
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
  // Arrastar feito à mão: a janela da ilha nunca pega o foco e, no Windows, o arrastar
  // nativo da barra se perde. Aqui a barra segue o mouse com "pointer capture".
  const valorDoMouse = (e) => {
    const r = el.getBoundingClientRect();
    const min = Number(el.min || 0); const max = Number(el.max || 100);
    const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return Math.round(min + pct * (max - min));
  };
  const aplicar = (v) => {
    if (String(v) === el.value) return;
    el.value = v;
    pintarSlider(el);
    enviar(el.value);
  };
  el.addEventListener('pointerdown', (e) => {
    if (el.disabled || e.button !== 0) return;
    e.preventDefault();
    arrastando = el;
    definirInterativo(true);
    try { el.setPointerCapture(e.pointerId); } catch { /* ignora */ }
    aplicar(valorDoMouse(e));
  });
  el.addEventListener('pointermove', (e) => { if (arrastando === el) aplicar(valorDoMouse(e)); });
  const soltar = (e) => {
    if (arrastando !== el) return;
    arrastando = null;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignora */ }
    enviar(el.value);
  };
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
  el.addEventListener('lostpointercapture', () => { if (arrastando === el) arrastando = null; });
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
      aviso(nomes[intencao.cmd], '', { icone: icones[intencao.cmd], ms: 1800 });
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
        aviso('Abrindo ' + achado.nome, '', { icone: '↗' });
      } else {
        olhos.reagir('confuso', 2400);
        aviso('Não achei esse app', 'Tente falar o nome de outro jeito', { icone: '?', tipo: 'info', ms: 3500 });
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
      aviso(textos[intencao.id] || 'Feito', '', { icone: '⚙', ms: 1800 });
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
      aviso('Não entendi', intencao.dica || 'Diga "ilha, ajuda" para ver os comandos', { icone: '?', tipo: 'erro', ms: 3000 });
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
// ---- Chamadas: app de conversa usando o microfone ----
const APPS_CHAMADA = [
  [/discord/i, 'Discord'], [/teams/i, 'Teams'], [/zoom/i, 'Zoom'], [/whatsapp/i, 'WhatsApp'], [/skype/i, 'Skype'],
  [/slack/i, 'Slack'], [/telegram/i, 'Telegram'], [/signal/i, 'Signal'], [/webex/i, 'Webex'], [/messenger/i, 'Messenger'],
  [/phonelink|yourphone|vínculo/i, 'Celular'], [/steam/i, 'Steam'], [/^chrome$/i, 'Chrome'], [/msedge|edge/i, 'Edge'],
  [/firefox/i, 'Firefox'], [/opera/i, 'Opera'], [/brave/i, 'Brave'], [/googlemeet|meet/i, 'Google Meet'],
];
// Nome bonito do app; WebView2 (usado por dentro do WhatsApp, Teams novo...) não diz qual app é
const nomeDoApp = (a) => {
  if (/webview|applicationframehost|runtimebroker/i.test(a)) return 'Chamada';
  for (const [re, n] of APPS_CHAMADA) if (re.test(a)) return n;
  return String(a).replace(/[-_.]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};
// Qualquer programa usando o microfone é candidato; vira chamada se também estiver tocando som
const nomeChamada = (apps) => (apps.length ? nomeDoApp(apps[0]) : null);
let relogioChamada = null;
// Compara "WhatsAppDesktop" (microfone) com "WhatsApp" (processo tocando som) e afins
const raiz = (x) => String(x).toLowerCase().replace(/[^a-z]/g, '').replace(/desktop|root|app$/g, '').slice(0, 6);
const HOSPEDEIROS = /webview|applicationframehost|whatsapp|teams/i;
const mesmoApp = (a, b) => {
  if (HOSPEDEIROS.test(a) && HOSPEDEIROS.test(b)) return true; // o som e o microfone podem vir de processos diferentes do mesmo app
  const x = raiz(a); const y = raiz(b);
  return x.length >= 3 && y.length >= 3 && (x.startsWith(y) || y.startsWith(x));
};
let micAgora = { mic: [], cam: [] };
// Apps de voz: com o áudio de chamada aberto por um tempo, é chamada mesmo com o microfone mutado
const APPS_VOZ = /discord|teams|zoom|skype|slack|teamspeak|ts3client|mumble|webex|guilded/i; // (WhatsApp/Telegram tocam áudios longos: só pelo microfone)
const vistoDesde = new Map(); // "tipo:app" -> desde quando aparece sem parar
// Programas que usam o microfone para outras coisas além de chamada (gravar mensagem de voz, ditado...)
const MULTIUSO = /chrome|msedge|edge|firefox|opera|brave|vivaldi|whatsapp|telegram|webview|applicationframehost/i;
function continuo(chave, presente, agora) {
  if (!presente) { vistoDesde.delete(chave); return 0; }
  if (!vistoDesde.has(chave)) vistoDesde.set(chave, agora);
  return agora - vistoDesde.get(chave);
}
let semChamadaDesde = 0;
// Chamada = (algum app usando o microfone E tocando som) OU (app de voz com áudio aberto por 8 s) OU (ligação que tocou e foi atendida)
function avaliarChamada(tocando, captura) {
  const agora = Date.now();
  const mic = [...new Set([...(micAgora.mic || []), ...captura])].filter((x) => !/ilhadinamica|electron/i.test(x));
  let achado = null;
  for (const m of mic) {
    const t = tocando.find((x) => mesmoApp(m, x));
    const tempoMic = continuo('mic:' + m, true, agora);
    const tempoSom = continuo('som:' + m, !!t, agora);
    if (!t) continue;
    // Navegadores e WhatsApp/Telegram também gravam áudio (mensagem de voz) enquanto tocam outras coisas
    // (avisos, vídeos em outra aba): para eles, só é chamada com microfone E som juntos por 30 s seguidos.
    // Ligação recebida continua sendo reconhecida na hora, pelo toque.
    const multiuso = MULTIUSO.test(m) || MULTIUSO.test(t);
    const precisa = multiuso ? 30000 : 2400;
    if (tempoMic >= precisa && tempoSom >= precisa) { achado = { m, t }; break; }
  }
  for (const k of [...vistoDesde.keys()]) {
    if ((k.startsWith('mic:') || k.startsWith('som:')) && !mic.includes(k.slice(4))) vistoDesde.delete(k);
  }
  if (!achado) {
    for (const t of tocando) {
      const voz = APPS_VOZ.test(t) || /webview/i.test(t) && mic.length;
      if (continuo('voz:' + t, voz, agora) >= 8000) { achado = { m: t, t }; break; }
    }
    for (const k of [...vistoDesde.keys()]) if (k.startsWith('voz:') && !tocando.includes(k.slice(4))) vistoDesde.delete(k);
  }
  if (!achado && mic.length && agora - (estado.toqueEm || 0) < 90000) achado = { m: mic[0], t: mic[0], quem: estado.toqueDe };
  if (achado) {
    semChamadaDesde = 0;
    if (!estado.chamada) {
      let nome = achado.quem || nomeDoApp(achado.m);
      if (nome === 'Chamada') { const n2 = nomeDoApp(achado.t); if (n2 !== 'Chamada') nome = n2; }
      iniciarChamada(nome, micAgora.cam.length > 0, agora - 2000);
    }
  } else if (estado.chamada) {
    if (!semChamadaDesde) semChamadaDesde = agora;
    if (agora - semChamadaDesde > 5000) { semChamadaDesde = 0; encerrarChamada(); } // 5 s sem sinais: acabou
  }
}
function atualizarChamada(mic, cam) { micAgora = { mic, cam }; }
// Ligação tocando (o WhatsApp Web avisa o Windows como se fosse uma "música" com esse título)
api.on('toque', ({ titulo }) => {
  if (estado.chamada) return;
  const primeira = Date.now() - (estado.toqueEm || 0) > 8000;
  estado.toqueEm = Date.now();
  const m = String(titulo).match(/recebida de\s+(.+)$/i) || String(titulo).match(/.*\b(?:de|from)\s+(.+)$/i);
  estado.toqueDe = m ? m[1].trim() : '';
  const video = /v[íi]deo|video/i.test(titulo);
  ilha.classList.add('chamando');
  clearTimeout(estado.timeoutToque);
  estado.timeoutToque = setTimeout(() => ilha.classList.remove('chamando'), 5000);
  if (primeira) {
    olhos.reagir('surpreso', 2500);
    aviso(video ? 'Chamada de vídeo recebida' : 'Ligação recebida', estado.toqueDe || 'WhatsApp', { icone: '📞', tipo: 'info', ms: 5000 });
  }
});
api.on('sons', (d) => {
  const { tocando = [], captura = [] } = Array.isArray(d) ? { tocando: d } : (d || {});
  avaliarChamada(tocando, captura);
});
function iniciarChamada(app, video, desde) {
  ilha.classList.remove('chamando');
  estado.toqueEm = 0;
  estado.chamada = { app, desde, video };
  ilha.classList.add('em-chamada');
  olhos.definirChamada(true);
  $('chamadaMini').title = `Em chamada · ${app}`;
  aviso(video ? 'Chamada de vídeo' : 'Em chamada', app, { icone: '📞', tipo: 'info', ms: 3000 });
  const tic = () => { if (estado.chamada) $('chamadaTempo').textContent = fmtTempo((Date.now() - estado.chamada.desde) / 1000); };
  tic();
  clearInterval(relogioChamada);
  relogioChamada = setInterval(tic, 1000);
}
function encerrarChamada() {
  const antes = estado.chamada;
  const duracao = fmtTempo((Date.now() - antes.desde) / 1000);
  estado.chamada = null;
  clearInterval(relogioChamada);
  ilha.classList.remove('em-chamada');
  olhos.definirChamada(false);
  olhos.reagir('feliz', 1800);
  aviso('Chamada encerrada', `${antes.app} · ${duracao}`, { icone: '📞', tipo: 'info', ms: 3000 });
}

api.on('privacidade', ({ mic, cam }) => {
  atualizarChamada(mic, cam);
  ilha.classList.toggle('priv-mic', mic.length > 0 && cam.length === 0);
  ilha.classList.toggle('priv-cam', cam.length > 0);
  ilha.title = [cam.length ? `📷 Câmera: ${cam.join(', ')}` : '', mic.length ? `🎙 Microfone: ${mic.join(', ')}` : ''].filter(Boolean).join('\n');
  const novosCam = cam.filter((x) => !usandoAntes.cam.includes(x));
  const novosMic = mic.filter((x) => !usandoAntes.mic.includes(x));
  if (novosCam.length) aviso('Câmera ligada', `${novosCam.join(', ')} está usando a câmera`, { icone: '📷', tipo: 'info', ms: 3500 });
  else if (novosMic.length && !estado.chamada) aviso('Microfone em uso', `${novosMic.join(', ')} está ouvindo`, { icone: '🎙', tipo: 'info', ms: 3500 });
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
  definirInterativo(true);
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
  if (!parado || !ilha.classList.contains('discreta') || estado.vista !== 'compacta' || estado.esperarSair) return;
  if (ultimoCursor.botao || Date.now() - parado.desde < 500) return;
  if (Math.abs(ultimoCursor.x - parado.x) + Math.abs(ultimoCursor.y - parado.y) > 8) return;
  parado = null;
  estado.hover = true;
  definirInterativo(true);
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
  if (estado.esperarSair) {
    const perto = pos.x >= r.left - 24 && pos.x <= r.right + 24 && pos.y >= -6 && pos.y <= r.bottom + 24;
    if (!perto) estado.esperarSair = false;
  }

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
        definirInterativo(false);
        mostrar('compacta');
      }
    }, 260);
  }
});
// ---------------------------------------------------------------------------
// Clique à prova de falhas
// Às vezes o Windows para de entregar o clique físico para a ilha (só a rodinha chega). A decisão de
// "clicável" passa a usar a posição REAL do mouse (vem do Windows a cada 60 ms, com o estado do botão):
// mouse em cima da ilha = clicável, reafirmado de tempos em tempos. E se o botão desceu em cima da ilha
// e o clique não chegou na página, a própria ilha clica (ou arrasta o volume/brilho) por você.
// ---------------------------------------------------------------------------
let ultimoReforco = 0;
let pressao = null; // { x, y, t, alvo, faixa } enquanto o botão está apertado em cima da ilha
let ultimoPointerdown = 0;
document.addEventListener('pointerdown', (e) => { if (e.isTrusted) ultimoPointerdown = Date.now(); }, true);
function sobreAIlha(pos, folga = 2) {
  const r = ilha.getBoundingClientRect();
  return r.width > 0 && pos.x >= r.left - folga && pos.x <= r.right + folga && pos.y >= r.top - folga && pos.y <= r.bottom + folga;
}
function moverFaixa(input, x) {
  const r = input.getBoundingClientRect();
  const min = Number(input.min || 0), max = Number(input.max || 100), passo = Number(input.step) || 1;
  const t = Math.max(0, Math.min(1, (x - r.left) / (r.width || 1)));
  const v = String(Math.round((min + t * (max - min)) / passo) * passo);
  if (input.value === v) return;
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function eventoDeMouse(alvo, tipo, x, y) {
  const C = tipo.startsWith('pointer') ? PointerEvent : MouseEvent;
  alvo.dispatchEvent(new C(tipo, { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y,
    button: 0, buttons: tipo.endsWith('down') ? 1 : 0, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
}
const cliqueChegou = (p) => ultimoPointerdown > p.t - 400;
api.on('cursor', (pos) => {
  // no tracinho do modo discreto a ilha só pega o mouse depois de meio segundo parado (não rouba cliques das abas)
  const podeClicar = !(ilha.classList.contains('discreta') && estado.vista === 'compacta');
  const sobre = podeClicar && sobreAIlha(pos);
  if (sobre && !pos.botao) {
    const agora = Date.now();
    if (interativoAgora !== true) { definirInterativo(true); ultimoReforco = agora; }
    else if (agora - ultimoReforco > 1500) { ultimoReforco = agora; api.interativo(true); } // reafirma pro Windows
  }
  // saiu de perto do notch e o "mouseleave" se perdeu: devolve os cliques para o que está embaixo
  if (!pressao && !pos.botao && estado.vista === 'compacta' && interativoAgora === true && !estado.teclado && !sobreAIlha(pos, 10)) {
    definirInterativo(false);
  }
  if (pos.botao && !pressao && sobre) {
    pressao = { x: pos.x, y: pos.y, t: Date.now(), alvo: document.elementFromPoint(pos.x, pos.y) };
    return;
  }
  if (!pressao) return;
  // segurando o botão num controle deslizante e o clique não chegou: arrasta junto com o mouse
  if (pos.botao) {
    if (Date.now() - pressao.t > 150 && !cliqueChegou(pressao)) {
      const faixa = pressao.faixa || pressao.alvo?.closest?.('input[type="range"]:not([disabled])');
      if (faixa) { pressao.faixa = faixa; pressao.xFinal = pos.x; moverFaixa(faixa, pos.x); }
    }
    return;
  }
  // soltou: se o clique de verdade não chegou, clica por você
  const p = pressao;
  pressao = null;
  setTimeout(() => {
    if (cliqueChegou(p)) return;
    const alvo = p.alvo && document.contains(p.alvo) ? p.alvo : document.elementFromPoint(p.x, p.y);
    if (!alvo || !ilha.contains(alvo)) return;
    const nome = alvo.id || alvo.className?.toString?.().slice(0, 30) || alvo.tagName || '?';
    api.diagSempre?.(`em ${nome} | vista=${estado.vista} interativo=${interativoAgora} discreta=${ilha.classList.contains('discreta')} foco=${document.hasFocus()}`);
    // destrava o modo de clique da janela (desliga e liga de novo)
    api.interativo(false);
    definirInterativo(true);
    estado.hover = true;
    if (p.faixa) { moverFaixa(p.faixa, p.xFinal ?? p.x); p.faixa.dispatchEvent(new Event('change', { bubbles: true })); return; }
    if (alvo.matches('input[type="range"]')) { moverFaixa(alvo, p.x); alvo.dispatchEvent(new Event('change', { bubbles: true })); return; }
    const campo = alvo.closest('input, textarea');
    if (campo) { campo.focus(); campo.click(); return; }
    eventoDeMouse(alvo, 'pointerdown', p.x, p.y);
    eventoDeMouse(alvo, 'mousedown', p.x, p.y);
    eventoDeMouse(alvo, 'pointerup', p.x, p.y);
    eventoDeMouse(alvo, 'mouseup', p.x, p.y);
    eventoDeMouse(alvo, 'click', p.x, p.y);
  }, 120);
});

// Reage ao app em primeiro plano:
//   maximizada -> gruda no topo (formato "notch")
//   cheia      -> encolhe para o modo mini (vídeo, jogo, F11)
let ultimoModoApp = null;
function aplicarModoApp(modo) {
  ultimoModoApp = modo;
  // Sempre notch colado no topo; a única troca é para o modo discreto (só os olhinhos)
  const discreta = modo === 'maximizada-abas';
  ilha.classList.toggle('discreta', discreta);
  if (discreta && estado.vista === 'compacta') definirInterativo(false); // nunca rouba cliques das abas
  ilha.classList.add('colada');
  ilha.classList.remove('mini');
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
  estado.voltarAoInicio = true; // ao abrir a ilha, o painel também começa no Início
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
