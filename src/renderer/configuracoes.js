// Janela de configurações da Ilha Dinâmica (todas as mudanças valem na hora)
const api = window.ilhaAPI || {
  // modo navegador (teste visual)
  lerConfig: async () => ({
    corOlhos: '#f5f5f7', corRelogio: '#f5f5f7', corDestaque: '#60a5fa', fundo: 'preto', tamanho: 1, relogio24h: true,
    mostrarSegundos: false, mostrarOlhos: true, formatoOlhos: 'pilula', abrirAoPassar: true, atrasoAbrir: 140, modoNotch: true,
    modoMini: true, widgets: ['inicio', 'agenda', 'tarefas', 'foco', 'dock', 'bandeja', 'notas', 'clima', 'clipboard', 'sistema'], cidade: '', agendasIcs: [], focoSilencia: true,
    focoMin: 25, pausaMin: 5, pausaLongaMin: 15, focoAuto: false, historicoCopiados: true, escutaContinua: false,
    respostaFalada: true, palavraAtivacao: 'ilha', iniciarComWindows: false, esconderEmJogos: true, jogosExtras: ['meujogo.exe'], naoJogos: [], modoDiscreto: 'abas', appsComAbas: ['chrome.exe', 'msedge.exe', 'code.exe'],
    atalhoBusca: 'Alt+Space', atalhoVoz: 'Control+Alt+Space', atalhoMostrar: 'Control+Alt+I',
  }),
  salvarConfig: async (p) => ({ ok: true, config: { ...cfg, ...p }, erros: {} }),
  on() {},
};

const $ = (id) => document.getElementById(id);
let cfg = {};

const PALETAS = {
  corOlhos: ['#f5f5f7', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#f87171', '#22d3ee'],
  corRelogio: ['#f5f5f7', '#a1a1aa', '#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c'],
  corDestaque: ['#60a5fa', '#34d399', '#a78bfa', '#f472b6', '#fb923c', '#fbbf24', '#22d3ee', '#d97757'],
};
const WIDGETS = {
  inicio: ['🏠', 'Início (mídia e controles)'], agenda: ['📅', 'Agenda e calendário'], tarefas: ['✓', 'Tarefas'],
  foco: ['🍅', 'Foco (Pomodoro)'], notas: ['📝', 'Notas rápidas'], clima: ['⛅', 'Clima'],
  clipboard: ['📋', 'Textos copiados'], sistema: ['📊', 'Sistema (CPU, memória, disco)'],
  dock: ['⭐', 'Favoritos (apps com um clique)'], bandeja: ['📥', 'Bandeja de arquivos'],
};
const TODOS_WIDGETS = Object.keys(WIDGETS);

function toast(msg, erro = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast ver' + (erro ? ' erro' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'toast'; }, 2400);
}

async function salvar(parcial, msg) {
  const r = await api.salvarConfig(parcial);
  if (r?.config) cfg = r.config;
  const erros = Object.values(r?.erros || {});
  if (erros.length) toast(erros[0], true);
  else if (msg) toast(msg);
  desenhar();
  return r;
}

// ---------------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------------
$('abas').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  document.querySelectorAll('.abas button').forEach((x) => x.classList.toggle('ativa', x === b));
  document.querySelectorAll('section').forEach((s) => s.classList.toggle('ativo', s.dataset.painel === b.dataset.aba));
});

// ---------------------------------------------------------------------------
// Cores
// ---------------------------------------------------------------------------
document.querySelectorAll('.cores').forEach((box) => {
  const chave = box.dataset.chave;
  for (const cor of PALETAS[chave]) {
    const b = document.createElement('button');
    b.style.background = cor;
    b.dataset.cor = cor;
    b.title = cor;
    b.addEventListener('click', () => salvar({ [chave]: cor }));
    box.appendChild(b);
  }
  const livre = document.createElement('input');
  livre.type = 'color';
  livre.title = 'Escolher outra cor';
  livre.addEventListener('input', () => {
    document.documentElement.style.setProperty(chave === 'corOlhos' ? '--olhos' : chave === 'corRelogio' ? '--relogio' : '--destaque', livre.value);
  });
  livre.addEventListener('change', () => salvar({ [chave]: livre.value }));
  box.appendChild(livre);
});

// Botões de opção (fundo, formato dos olhos)
document.querySelectorAll('.opcoes').forEach((box) => {
  box.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) salvar({ [box.dataset.chave]: b.dataset.valor });
  });
});

// Interruptores
document.querySelectorAll('.chave input[data-chave]').forEach((el) => {
  el.addEventListener('change', () => salvar({ [el.dataset.chave]: el.checked }));
});

// Sliders
$('tamanho').addEventListener('input', (e) => { $('tamanhoValor').textContent = Math.round(e.target.value * 100) + '%'; });
$('tamanho').addEventListener('change', (e) => salvar({ tamanho: Number(e.target.value) }));
$('atrasoAbrir').addEventListener('input', (e) => { $('atrasoValor').textContent = e.target.value + ' ms'; });
$('atrasoAbrir').addEventListener('change', (e) => salvar({ atrasoAbrir: Number(e.target.value) }));

// Textos
$('cidade').addEventListener('change', (e) => {
  const cidade = e.target.value.trim();
  salvar({ cidade }, cidade ? 'Cidade do clima atualizada' : 'Clima: cidade automática');
});
$('cidadeAuto').addEventListener('click', () => { $('cidade').value = ''; salvar({ cidade: '' }, 'Clima: cidade automática'); });
$('palavraAtivacao').addEventListener('change', (e) => {
  const v = e.target.value.trim().toLowerCase();
  if (!/^[a-zà-ú]{2,20}$/.test(v)) { toast('Use uma palavra só, sem números', true); e.target.value = cfg.palavraAtivacao; return; }
  salvar({ palavraAtivacao: v }, `Palavra de ativação: "${v}"`);
});
document.querySelectorAll('[data-num]').forEach((el) => {
  el.addEventListener('change', () => {
    const v = Math.round(Number(el.value));
    if (!(v >= Number(el.min) && v <= Number(el.max))) { el.value = cfg[el.dataset.num]; toast('Valor fora do limite', true); return; }
    salvar({ [el.dataset.num]: v });
  });
});

$('restaurar').addEventListener('click', async () => {
  if ($('restaurar').dataset.confirma !== '1') {
    $('restaurar').dataset.confirma = '1';
    $('restaurar').textContent = 'Clique de novo para confirmar';
    setTimeout(() => { $('restaurar').dataset.confirma = ''; $('restaurar').textContent = 'Restaurar tudo ao padrão'; }, 3000);
    return;
  }
  $('restaurar').dataset.confirma = '';
  $('restaurar').textContent = 'Restaurar tudo ao padrão';
  await salvar({ restaurar: true }, 'Configurações restauradas');
});

// ---------------------------------------------------------------------------
// Gravador de atalhos
// ---------------------------------------------------------------------------
const NOMES_TECLAS = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert' };
const bonito = (a) => String(a || 'nenhum').replace('Control', 'Ctrl').replace('Space', 'Espaço').replace(/\+/g, ' + ');

document.querySelectorAll('[data-atalho]').forEach((el) => {
  const chave = el.dataset.atalho;
  const erro = el.nextElementSibling;
  el.addEventListener('focus', () => { el.classList.add('gravando'); el.value = 'Aperte as teclas…'; erro.textContent = ''; });
  el.addEventListener('blur', () => { el.classList.remove('gravando'); el.value = bonito(cfg[chave]); });
  el.addEventListener('keydown', async (e) => {
    e.preventDefault();
    if (e.key === 'Escape') { el.blur(); return; }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return; // espera a tecla principal
    if (e.key === 'Backspace' && chave === 'atalhoPainel' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      await salvar({ atalhoPainel: '' }, 'Atalho do painel removido');
      el.blur();
      return;
    }
    let tecla = NOMES_TECLAS[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : null);
    if (/^F\d{1,2}$/.test(e.key)) tecla = e.key;
    if (!tecla) { erro.textContent = 'Tecla não suportada'; return; }
    const mods = [];
    if (e.ctrlKey) mods.push('Control');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    if (!mods.length && !/^F\d/.test(tecla)) { erro.textContent = 'Use pelo menos Ctrl, Alt ou Shift junto'; return; }
    const atalho = [...mods, tecla].join('+');
    const outros = ['atalhoBusca', 'atalhoVoz', 'atalhoMostrar', 'atalhoPainel'].filter((k) => k !== chave);
    if (outros.some((k) => cfg[k] === atalho)) { erro.textContent = 'Esse atalho já está em uso por outra função da ilha'; return; }
    const r = await salvar({ [chave]: atalho });
    if (r?.erros?.[chave]) erro.textContent = r.erros[chave];
    else toast(`Atalho salvo: ${bonito(atalho)}`);
    el.blur();
  });
});

// ---------------------------------------------------------------------------
// Lista de widgets (ligar, desligar, reordenar)
// ---------------------------------------------------------------------------
function desenharWidgets() {
  const ul = $('listaWidgets');
  ul.innerHTML = '';
  const ligados = cfg.widgets || TODOS_WIDGETS;
  const ordem = [...ligados, ...TODOS_WIDGETS.filter((w) => !ligados.includes(w))];
  ordem.forEach((w) => {
    const on = ligados.includes(w);
    const li = document.createElement('li');
    li.dataset.w = w;
    if (!on) li.className = 'off';
    const alca = document.createElement('span'); alca.className = 'alca'; alca.textContent = '⠿'; alca.title = 'Arraste para mudar a ordem';
    const ic = document.createElement('span'); ic.className = 'ic'; ic.textContent = WIDGETS[w][0];
    const nome = document.createElement('span'); nome.className = 'nome'; nome.textContent = WIDGETS[w][1];
    const chave = document.createElement('label'); chave.className = 'chave';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = on;
    chave.append(cb, document.createElement('span'));
    cb.addEventListener('change', () => {
      const l = cb.checked ? [...ligados, w] : ligados.filter((x) => x !== w);
      if (!l.length) { toast('Deixe pelo menos um widget ligado', true); cb.checked = true; return; }
      salvar({ widgets: l });
    });
    li.append(alca, ic, nome, chave);
    arrastavel(li, ul);
    ul.appendChild(li);
  });
}

// Arrastar para reordenar: a linha segue o mouse e as outras abrem espaço com animação
function arrastavel(li, ul) {
  let arr = null;
  li.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.chave')) return;
    e.preventDefault();
    // (mover a linha no DOM solta o "pointer capture", então os eventos vêm do documento)
    document.addEventListener('pointermove', mover);
    document.addEventListener('pointerup', soltar);
    document.addEventListener('pointercancel', soltar);
    const r = li.getBoundingClientRect();
    arr = { dy: e.clientY - r.top };
    li.classList.add('arrastando');
    ul.classList.add('reordenando');
  });
  const mover = (e) => {
    if (!arr) return;
    const irmaos = [...ul.children].filter((x) => x !== li);
    // posição pelo layout (offsetTop), não pela tela: as outras linhas podem estar no meio da animação
    const y = e.clientY - ul.getBoundingClientRect().top;
    let antes = null;
    for (const x of irmaos) {
      if (y < x.offsetTop + x.offsetHeight / 2) { antes = x; break; }
    }
    if (li.nextElementSibling !== antes && antes !== li) {
      // FLIP: guarda onde as outras estavam, troca de lugar e anima até a posição nova
      const antesTop = new Map(irmaos.map((x) => [x, x.offsetTop]));
      ul.insertBefore(li, antes);
      for (const x of irmaos) {
        const d = antesTop.get(x) - x.offsetTop;
        if (!d) continue;
        x.style.transition = 'none';
        x.style.transform = `translateY(${d}px)`;
        requestAnimationFrame(() => { x.style.transition = ''; x.style.transform = ''; });
      }
    }
    const topoUl = ul.getBoundingClientRect().top;
    li.style.transform = `translateY(${e.clientY - arr.dy - topoUl - li.offsetTop}px)`;
  };
  const soltar = () => {
    document.removeEventListener('pointermove', mover);
    document.removeEventListener('pointerup', soltar);
    document.removeEventListener('pointercancel', soltar);
    if (!arr) return;
    arr = null;
    li.classList.remove('arrastando');
    ul.classList.remove('reordenando');
    li.style.transform = '';
    const ligadosAgora = new Set(cfg.widgets || TODOS_WIDGETS);
    const nova = [...ul.children].map((x) => x.dataset.w).filter((w) => ligadosAgora.has(w));
    if (nova.join() !== (cfg.widgets || TODOS_WIDGETS).join()) salvar({ widgets: nova }, 'Ordem dos widgets atualizada');
  };

}

// ---------------------------------------------------------------------------
// Jogos: listas manuais
// ---------------------------------------------------------------------------
function desenharTags(idLista, chave) {
  const ul = $(idLista);
  ul.innerHTML = '';
  const lista = cfg[chave] || [];
  if (!lista.length) {
    const li = document.createElement('li'); li.className = 'vazio'; li.textContent = 'nenhum';
    ul.appendChild(li);
  }
  lista.forEach((nome) => {
    const li = document.createElement('li');
    li.append(nome);
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remover';
    x.addEventListener('click', () => salvar({ [chave]: lista.filter((n) => n !== nome) }));
    li.appendChild(x);
    ul.appendChild(li);
  });
}
function ligarAdicionar(idCampo, idBotao, chave, outra) {
  const add = () => {
    let v = $(idCampo).value.trim().toLowerCase().split(/[\\/]/).pop();
    if (!v) return;
    if (!v.endsWith('.exe')) v += '.exe';
    if (!/^[^\\/:*?"<>|]{1,80}\.exe$/.test(v)) { toast('Nome de arquivo inválido', true); return; }
    $(idCampo).value = '';
    const parcial = { [chave]: [...(cfg[chave] || []), v] };
    if (outra) parcial[outra] = (cfg[outra] || []).filter((n) => n !== v);
    salvar(parcial, `${v} adicionado`);
  };
  $(idBotao).addEventListener('click', add);
  $(idCampo).addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
}
ligarAdicionar('novoJogo', 'addJogo', 'jogosExtras', 'naoJogos');
ligarAdicionar('novoNaoJogo', 'addNaoJogo', 'naoJogos', 'jogosExtras');
ligarAdicionar('novoAppAbas', 'addAppAbas', 'appsComAbas');

// ---------------------------------------------------------------------------
// Google Agenda (links iCal)
// ---------------------------------------------------------------------------
function desenharAgendas() {
  const ul = $('listaIcs');
  ul.innerHTML = '';
  (cfg.agendasIcs || []).forEach((url, i) => {
    const li = document.createElement('li');
    const host = url.replace(/^[a-z]+:\/\//i, '').split('/')[0];
    li.append(`Agenda ${i + 1} · ${host}`);
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remover';
    x.addEventListener('click', () => salvar({ agendasIcs: cfg.agendasIcs.filter((_, k) => k !== i) }, 'Agenda removida'));
    li.appendChild(x);
    ul.appendChild(li);
  });
  if (!(cfg.agendasIcs || []).length) {
    const li = document.createElement('li'); li.className = 'vazio'; li.textContent = 'nenhuma agenda ligada'; ul.appendChild(li);
  }
}
function adicionarAgenda() {
  const v = $('novoIcs').value.trim();
  if (!/^(https|webcal):\/\/.+/i.test(v)) { toast('Cole o "Endereço secreto no formato iCal" (começa com https://)', true); return; }
  if ((cfg.agendasIcs || []).length >= 3) { toast('No máximo 3 agendas', true); return; }
  $('novoIcs').value = '';
  salvar({ agendasIcs: [...(cfg.agendasIcs || []), v] }, 'Agenda ligada! Os compromissos aparecem em instantes');
}
$('addIcs').addEventListener('click', adicionarAgenda);
$('novoIcs').addEventListener('keydown', (e) => { if (e.key === 'Enter') adicionarAgenda(); });

// ---------------------------------------------------------------------------
// Desenha tudo a partir da configuração atual
// ---------------------------------------------------------------------------
function desenhar() {
  const raiz = document.documentElement.style;
  raiz.setProperty('--olhos', cfg.corOlhos);
  raiz.setProperty('--relogio', cfg.corRelogio);
  raiz.setProperty('--destaque', cfg.corDestaque);
  document.querySelectorAll('.cores').forEach((box) => {
    const atual = cfg[box.dataset.chave];
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.cor.toLowerCase() === String(atual).toLowerCase()));
    box.querySelector('input[type="color"]').value = atual;
  });
  document.querySelectorAll('.opcoes').forEach((box) => {
    box.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.valor === cfg[box.dataset.chave]));
  });
  document.querySelectorAll('.chave input[data-chave]').forEach((el) => { el.checked = !!cfg[el.dataset.chave]; });
  $('tamanho').value = cfg.tamanho; $('tamanhoValor').textContent = Math.round(cfg.tamanho * 100) + '%';
  $('atrasoAbrir').value = cfg.atrasoAbrir; $('atrasoValor').textContent = cfg.atrasoAbrir + ' ms';
  if (document.activeElement !== $('cidade')) $('cidade').value = cfg.cidade || '';
  if (document.activeElement !== $('palavraAtivacao')) $('palavraAtivacao').value = cfg.palavraAtivacao || 'ilha';
  document.querySelectorAll('[data-num]').forEach((el) => { if (document.activeElement !== el) el.value = cfg[el.dataset.num]; });
  document.querySelectorAll('[data-atalho]').forEach((el) => { if (document.activeElement !== el) el.value = bonito(cfg[el.dataset.atalho]); });
  desenharWidgets();
  desenharTags('listaJogos', 'jogosExtras');
  desenharTags('listaNaoJogos', 'naoJogos');
  desenharTags('listaAbas', 'appsComAbas');
  desenharAgendas();
  $('campoAbas').style.display = cfg.modoDiscreto === 'abas' ? '' : 'none';

  // prévia
  const ilha = document.querySelector('.previa-ilha');
  ilha.className = 'previa-ilha ' + (cfg.fundo || 'preto');
  ilha.style.transform = `scale(${cfg.tamanho || 1})`;
  const olhos = document.querySelector('.p-olhos');
  olhos.classList.toggle('redondo', cfg.formatoOlhos === 'redondo');
  olhos.classList.toggle('oculto', cfg.mostrarOlhos === false);
  const agora = new Date();
  $('pHora').textContent = agora.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', second: cfg.mostrarSegundos ? '2-digit' : undefined, hour12: cfg.relogio24h === false,
  });
}

(async () => {
  cfg = await api.lerConfig();
  desenhar();
  setInterval(desenhar, 1000 * 30);
  api.on('config', (c) => { cfg = c; desenhar(); });
})();
