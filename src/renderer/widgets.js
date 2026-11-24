// Widgets de produtividade do painel expandido:
// Início, Agenda (com feriados), Tarefas, Foco (Pomodoro), Notas, Clima, Copiados e Sistema.

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const dataISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function iniciarWidgets(ctx) {
  const { api, aviso, olhos, falar, bipar, pedirTeclado } = ctx;
  let config = {};

  // -------------------------------------------------------------------------
  // Dados salvos (tarefas, notas, eventos...)
  // -------------------------------------------------------------------------
  const dados = { tarefas: [], eventos: [], notas: '', foco: { data: '', sessoes: 0, minutos: 0 }, bandeja: [], dock: [] };
  let externos = []; // compromissos da Google Agenda (só leitura)
  const todosEventos = () => [...dados.eventos, ...externos];
  const salvar = (chave) => api.salvarDados(chave, dados[chave]);

  // Teclado: a ilha só aceita digitação quando você clica num campo
  document.querySelectorAll('.entrada, .notas').forEach((el) => {
    el.addEventListener('pointerdown', () => {
      pedirTeclado(true);
      setTimeout(() => el.focus(), 40);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Escape') { el.blur(); pedirTeclado(false); } });
  });

  // -------------------------------------------------------------------------
  // Carrossel
  // -------------------------------------------------------------------------
  const trilho = $('trilho');
  const todas = [...trilho.querySelectorAll('.pagina')];
  let paginas = todas;
  let atual = 0;

  function montarCarrossel() {
    const ordem = Array.isArray(config.widgets) && config.widgets.length
      ? config.widgets : todas.map((p) => p.dataset.widget);
    paginas = [];
    for (const nome of ordem) {
      const p = todas.find((x) => x.dataset.widget === nome);
      if (p) { trilho.appendChild(p); p.hidden = false; paginas.push(p); }
    }
    todas.filter((p) => !paginas.includes(p)).forEach((p) => { p.hidden = true; });
    if (!paginas.length) { todas[0].hidden = false; paginas = [todas[0]]; }
    const pontos = $('pontos');
    pontos.innerHTML = '';
    paginas.forEach((p, i) => {
      const b = document.createElement('button');
      b.title = p.dataset.titulo;
      b.setAttribute('aria-label', p.dataset.titulo);
      b.addEventListener('click', () => irPara(i));
      pontos.appendChild(b);
    });
    irPara(Math.min(atual, paginas.length - 1), false);
  }

  function irPara(i, animar = true) {
    atual = Math.max(0, Math.min(paginas.length - 1, i));
    trilho.style.transition = animar ? '' : 'none';
    trilho.style.setProperty('--pagina', atual);
    if (!animar) requestAnimationFrame(() => { trilho.style.transition = ''; });
    paginas.forEach((p, k) => p.classList.toggle('atual', k === atual));
    [...$('pontos').children].forEach((b, k) => b.classList.toggle('ativo', k === atual));
    $('nomePagina').textContent = paginas[atual]?.dataset.titulo || '';
    $('setaEsq').disabled = atual === 0;
    $('setaDir').disabled = atual === paginas.length - 1;
    aoMostrar(paginas[atual]?.dataset.widget);
    api.salvarDados('paginaAtual', atual);
  }

  document.querySelector('.exp-hora').addEventListener('click', () => irParaNome('agenda'));
  document.querySelector('.exp-hora').title = 'Abrir a agenda';
  $('chipBateria').addEventListener('click', () => api.acao({ tipo: 'abrir', app: 'energia' }));
  $('chipBateria').title = 'Opções de energia e bateria';
  $('setaEsq').addEventListener('click', () => irPara(atual - 1));
  $('setaDir').addEventListener('click', () => irPara(atual + 1));

  // Touchpad (deslizar de lado) e roda do mouse em cima do cabeçalho
  let acumulado = 0;
  let travado = false;
  const rolar = (delta) => {
    if (travado) return;
    acumulado += delta;
    if (Math.abs(acumulado) >= 50) {
      irPara(atual + (acumulado > 0 ? 1 : -1));
      acumulado = 0;
      travado = true;
      setTimeout(() => { travado = false; }, 420);
    }
  };
  // Pode rolar a lista/nota embaixo do mouse nessa direção? Então deixa ela rolar.
  const podeRolar = (alvo, dy) => {
    for (let el = alvo; el && el !== trilho; el = el.parentElement) {
      const st = getComputedStyle(el);
      if (!/(auto|scroll)/.test(st.overflowY) || el.scrollHeight <= el.clientHeight + 1) continue;
      if (dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) return true;
      if (dy < 0 && el.scrollTop > 0) return true;
    }
    return false;
  };
  const aoRolar = (e) => {
    if (e.target.closest('input[type="range"]')) return; // a barra de volume/brilho usa a roda
    const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
    const delta = horizontal ? e.deltaX : e.deltaY;
    if (!horizontal && podeRolar(e.target, e.deltaY)) return;
    // Dentro de uma lista que rola (ex.: escolher app favorito), a roda só rola a lista,
    // mesmo chegando no fim: nunca passa o widget para o lado sem querer
    if (!horizontal) {
      const lista = e.target.closest('#dockBusca, .lista, .notas');
      if (lista && (lista.id === 'dockBusca' || lista.scrollHeight > lista.clientHeight + 1)) { e.preventDefault(); return; }
    }
    e.preventDefault();
    rolar(delta);
  };
  $('carrossel').addEventListener('wheel', aoRolar, { passive: false });
  document.querySelector('.exp-topo').addEventListener('wheel', (e) => { e.preventDefault(); rolar(e.deltaY || e.deltaX); }, { passive: false });

  function aoMostrar(nome) {
    if (nome === 'sistema') atualizarRecursos();
    if (nome === 'clima') { climaDia = null; atualizarClima(); }
    if (nome === 'agenda') desenharCalendario();
  }

  // -------------------------------------------------------------------------
  // Agenda + feriados nacionais
  // -------------------------------------------------------------------------
  function pascoa(ano) {
    const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
    const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(ano, mes - 1, dia);
  }
  const cacheFeriados = new Map();
  function feriados(ano) {
    if (cacheFeriados.has(ano)) return cacheFeriados.get(ano);
    const f = new Map([
      [`${ano}-01-01`, 'Confraternização Universal'], [`${ano}-04-21`, 'Tiradentes'],
      [`${ano}-05-01`, 'Dia do Trabalho'], [`${ano}-09-07`, 'Independência do Brasil'],
      [`${ano}-10-12`, 'Nossa Senhora Aparecida'], [`${ano}-11-02`, 'Finados'],
      [`${ano}-11-15`, 'Proclamação da República'], [`${ano}-11-20`, 'Dia da Consciência Negra'],
      [`${ano}-12-25`, 'Natal'],
    ]);
    const p = pascoa(ano);
    const soma = (dias) => { const d = new Date(p); d.setDate(d.getDate() + dias); return dataISO(d); };
    f.set(soma(-48), 'Carnaval (ponto facultativo)');
    f.set(soma(-47), 'Carnaval (ponto facultativo)');
    f.set(soma(-2), 'Sexta-feira Santa');
    f.set(soma(0), 'Páscoa');
    f.set(soma(60), 'Corpus Christi (ponto facultativo)');
    cacheFeriados.set(ano, f);
    return f;
  }

  let mesVisto = new Date(); mesVisto.setDate(1);
  let diaSel = dataISO(new Date());
  const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  const fmtDiaLongo = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  function desenharCalendario() {
    const mes = fmtMes.format(mesVisto);
    $('calMes').textContent = mes.charAt(0).toUpperCase() + mes.slice(1);
    const dias = $('calDias');
    dias.innerHTML = '';
    const hoje = dataISO(new Date());
    const inicio = new Date(mesVisto);
    inicio.setDate(1 - inicio.getDay());
    const comEvento = new Set(dados.eventos.map((e) => e.data));
    const comGoogle = new Set(externos.map((e) => e.data));
    for (let k = 0; k < 42; k++) {
      const d = new Date(inicio); d.setDate(inicio.getDate() + k);
      const iso = dataISO(d);
      const b = document.createElement('button');
      b.textContent = d.getDate();
      if (d.getMonth() !== mesVisto.getMonth()) b.classList.add('fora');
      if (d.getDay() === 0 || d.getDay() === 6) b.classList.add('fds');
      const fer = feriados(d.getFullYear()).get(iso);
      if (fer) { b.classList.add('feriado'); b.title = fer; }
      if (iso === hoje) b.classList.add('hoje');
      if (iso === diaSel) b.classList.add('sel');
      if (comEvento.has(iso)) b.classList.add('tem');
      else if (comGoogle.has(iso)) b.classList.add('tem', 'tem-google');
      b.addEventListener('click', () => { diaSel = iso; desenharCalendario(); });
      dias.appendChild(b);
    }
    desenharDia();
  }

  function desenharDia() {
    const [a, m, d] = diaSel.split('-').map(Number);
    const data = new Date(a, m - 1, d);
    const hoje = dataISO(new Date()) === diaSel;
    const longo = fmtDiaLongo.format(data);
    $('diaTitulo').textContent = hoje ? 'Hoje' : longo.charAt(0).toUpperCase() + longo.slice(1);
    $('diaFeriado').textContent = feriados(a).get(diaSel) ? '★ ' + feriados(a).get(diaSel) : '';
    const lista = $('listaEventos');
    lista.innerHTML = '';
    const evs = todosEventos().filter((e) => e.data === diaSel).sort((x, y) => (x.hora || '00').localeCompare(y.hora || '00'));
    if (!evs.length) {
      const li = document.createElement('li');
      li.className = 'vazio';
      li.textContent = 'Nada marcado';
      lista.appendChild(li);
    }
    for (const ev of evs) {
      const li = document.createElement('li');
      const h = document.createElement('span'); h.className = 'hora-ev'; h.textContent = ev.hora || 'dia';
      const t = document.createElement('span'); t.className = 'txt'; t.textContent = ev.titulo; t.title = ev.titulo;
      li.append(h, t);
      if (ev.origem === 'google') {
        li.classList.add('google');
        li.title = 'Da sua Google Agenda (edite por lá)';
      } else {
        const x = document.createElement('button'); x.className = 'apagar'; x.textContent = '✕'; x.title = 'Apagar';
        x.addEventListener('click', () => {
          dados.eventos = dados.eventos.filter((e) => e.id !== ev.id);
          salvar('eventos'); desenharCalendario();
        });
        li.append(x);
      }
      lista.appendChild(li);
    }
  }

  // "14:30 Dentista", "14h Reunião", "9h15 Aula", "Aniversário da mãe"
  function lerEvento(texto) {
    const m = texto.trim().match(/^(\d{1,2})(?:[:h](\d{2})?)\s*h?\s+(.+)$/i);
    if (m && +m[1] < 24 && (!m[2] || +m[2] < 60)) return { hora: `${pad(+m[1])}:${pad(+(m[2] || 0))}`, titulo: m[3].trim() };
    return { hora: null, titulo: texto.trim() };
  }

  $('novoEvento').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const { hora, titulo } = lerEvento(e.target.value);
    dados.eventos.push({ id: uid(), data: diaSel, hora, titulo, avisos: [] });
    salvar('eventos');
    e.target.value = '';
    desenharCalendario();
    olhos.reagir('feliz', 1000);
  });
  $('calAnt').addEventListener('click', () => { mesVisto.setMonth(mesVisto.getMonth() - 1); desenharCalendario(); });
  $('calProx').addEventListener('click', () => { mesVisto.setMonth(mesVisto.getMonth() + 1); desenharCalendario(); });

  // Lembretes: 10 min antes e na hora
  function inicioEvento(ev) {
    if (!ev.hora) return null;
    const [a, m, d] = ev.data.split('-').map(Number);
    const [hh, mm] = ev.hora.split(':').map(Number);
    return new Date(a, m - 1, d, hh, mm).getTime();
  }
  function verificarLembretes() {
    const agora = Date.now();
    let mudou = false;
    for (const ev of todosEventos()) {
      const t = inicioEvento(ev);
      if (!t) continue;
      ev.avisos = ev.avisos || [];
      if (agora >= t - 10 * 60000 && agora < t && !ev.avisos.includes('10')) {
        ev.avisos.push('10'); mudou = true;
        aviso('Daqui a 10 minutos', `${ev.hora} · ${ev.titulo}`, { icone: '📅', tipo: 'timer', ms: 8000 });
        olhos.reagir('surpreso', 1500);
        bipar(2);
      }
      if (agora >= t && agora < t + 5 * 60000 && !ev.avisos.includes('0')) {
        ev.avisos.push('0'); mudou = true;
        aviso('Agora: ' + ev.titulo, ev.hora, { icone: '📅', tipo: 'timer', ms: 10000 });
        olhos.reagir('surpreso', 3000);
        bipar();
        falar('Lembrete: ' + ev.titulo);
      }
    }
    if (mudou) salvar('eventos');
  }
  setInterval(verificarLembretes, 15000);

  function proximoEvento() {
    const agora = Date.now();
    return todosEventos()
      .map((e) => ({ e, t: inicioEvento(e) }))
      .filter((x) => x.t && x.t > agora - 60000)
      .sort((a, b) => a.t - b.t)[0] || null;
  }

  // -------------------------------------------------------------------------
  // Tarefas
  // -------------------------------------------------------------------------
  function desenharTarefas(novaId) {
    const lista = $('listaTarefas');
    lista.innerHTML = '';
    const pendentes = dados.tarefas.filter((t) => !t.feita).length;
    $('contaTarefas').textContent = dados.tarefas.length
      ? `${pendentes} pendente${pendentes === 1 ? '' : 's'} de ${dados.tarefas.length}` : 'Nenhuma tarefa';
    if (!dados.tarefas.length) {
      const li = document.createElement('li'); li.className = 'vazio'; li.textContent = 'Tudo em dia ✨';
      lista.appendChild(li);
    }
    for (const t of dados.tarefas) {
      const li = document.createElement('li');
      li.className = (t.feita ? 'feita' : '') + (t.id === novaId ? ' nova' : '');
      const c = document.createElement('span'); c.className = 'caixa'; c.textContent = t.feita ? '✓' : '';
      const x = document.createElement('span'); x.className = 'txt'; x.textContent = t.texto; x.title = t.texto;
      const ap = document.createElement('button'); ap.className = 'apagar'; ap.textContent = '✕'; ap.title = 'Apagar';
      li.append(c, x, ap);
      li.addEventListener('click', (e) => {
        if (e.target === ap) {
          dados.tarefas = dados.tarefas.filter((y) => y.id !== t.id);
        } else {
          t.feita = !t.feita;
          if (t.feita) olhos.reagir('feliz', 1000);
        }
        salvar('tarefas'); desenharTarefas(); atualizarResumo();
      });
      lista.appendChild(li);
    }
  }
  $('novaTarefa').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const t = { id: uid(), texto: e.target.value.trim(), feita: false };
    dados.tarefas.unshift(t);
    e.target.value = '';
    salvar('tarefas'); desenharTarefas(t.id); atualizarResumo();
  });
  $('limparFeitas').addEventListener('click', () => {
    dados.tarefas = dados.tarefas.filter((t) => !t.feita);
    salvar('tarefas'); desenharTarefas(); atualizarResumo();
  });

  // -------------------------------------------------------------------------
  // Foco (Pomodoro)
  // -------------------------------------------------------------------------
  const foco = { fase: 'foco', rodando: false, fim: 0, resta: 0, ciclo: 0 };
  const minutos = (fase) => (fase === 'foco' ? config.focoMin || 25 : fase === 'longa' ? config.pausaLongaMin || 15 : config.pausaMin || 5);
  const nomesFase = { foco: 'Foco', curta: 'Pausa', longa: 'Pausa longa' };

  function resetarFase(fase) {
    foco.fase = fase;
    foco.rodando = false;
    foco.resta = minutos(fase) * 60;
    desenharFoco();
  }

  function hojeFoco() {
    const hoje = dataISO(new Date());
    if (dados.foco.data !== hoje) dados.foco = { data: hoje, sessoes: 0, minutos: 0 };
    return dados.foco;
  }

  // Durante o foco, pausa os banners de notificação do Windows (se ligado nas configurações)
  let silenciado = false;
  function sincronizarSilencio() {
    const deve = foco.rodando && foco.fase === 'foco' && config.focoSilencia !== false;
    if (deve !== silenciado) { silenciado = deve; api.silenciarFoco(deve); }
  }

  function desenharFoco() {
    sincronizarSilencio();
    const total = minutos(foco.fase) * 60;
    const resta = foco.rodando ? Math.max(0, (foco.fim - Date.now()) / 1000) : foco.resta;
    $('focoTempo').textContent = `${pad(Math.floor(resta / 60))}:${pad(Math.floor(resta % 60))}`;
    $('focoFase').textContent = nomesFase[foco.fase];
    $('anelFoco').style.strokeDashoffset = (326.7 * (1 - resta / total)).toFixed(1);
    document.querySelector('.foco').classList.toggle('pausa', foco.fase !== 'foco');
    $('focoPlay').textContent = foco.rodando ? 'Pausar' : (resta < total ? 'Continuar' : 'Começar');
    const h = hojeFoco();
    $('focoSessoes').innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('i');
      if (i < foco.ciclo % 4 || (foco.ciclo % 4 === 0 && foco.ciclo > 0 && foco.fase === 'longa')) b.className = 'feita';
      $('focoSessoes').appendChild(b);
    }
    $('focoTotal').textContent = h.sessoes
      ? `Hoje: ${h.sessoes} sessão${h.sessoes === 1 ? '' : 'ões'} · ${h.minutos} min de foco` : 'Nenhuma sessão hoje ainda';
  }

  function fimDaFase() {
    foco.rodando = false;
    bipar();
    if (foco.fase === 'foco') {
      foco.ciclo += 1;
      const h = hojeFoco(); h.sessoes += 1; h.minutos += minutos('foco'); salvar('foco');
      const longa = foco.ciclo % 4 === 0;
      resetarFase(longa ? 'longa' : 'curta');
      aviso('Sessão de foco concluída! 🍅', longa ? 'Hora de uma pausa longa' : 'Hora de uma pausa curta', { icone: '🍅', tipo: 'timer', ms: 7000 });
      falar(longa ? 'Muito bem! Hora de uma pausa longa.' : 'Sessão concluída. Hora de uma pausa.');
      olhos.reagir('feliz', 3000);
      if (config.focoAuto) alternarFoco();
    } else {
      resetarFase('foco');
      aviso('Pausa encerrada', 'Bora focar de novo?', { icone: '🍅', tipo: 'timer', ms: 6000 });
      falar('Pausa encerrada. Vamos voltar ao foco.');
      olhos.reagir('surpreso', 1500);
      if (config.focoAuto) alternarFoco();
    }
  }

  function alternarFoco() {
    if (foco.rodando) {
      foco.resta = Math.max(0, (foco.fim - Date.now()) / 1000);
      foco.rodando = false;
    } else {
      foco.fim = Date.now() + foco.resta * 1000;
      foco.rodando = true;
      olhos.reagir('feliz', 900);
    }
    desenharFoco();
  }
  $('focoPlay').addEventListener('click', alternarFoco);
  document.querySelector('.anel').addEventListener('click', alternarFoco);
  document.querySelector('.anel').title = 'Clique para começar ou pausar';
  $('focoPular').addEventListener('click', () => { foco.rodando = true; foco.fim = Date.now(); });
  $('focoZerar').addEventListener('click', () => { foco.ciclo = 0; resetarFase('foco'); });

  setInterval(() => {
    if (!foco.rodando) return;
    if (Date.now() >= foco.fim) fimDaFase();
    else if (paginas[atual]?.dataset.widget === 'foco') desenharFoco();
  }, 500);

  // -------------------------------------------------------------------------
  // Notas (salva sozinho)
  // -------------------------------------------------------------------------
  let tNotas = null;
  $('notas').addEventListener('input', (e) => {
    dados.notas = e.target.value;
    clearTimeout(tNotas);
    tNotas = setTimeout(() => salvar('notas'), 500);
  });

  // -------------------------------------------------------------------------
  // Clima (Open-Meteo, sem chave)
  // -------------------------------------------------------------------------
  const TEMPO = {
    0: ['☀️', 'Céu limpo'], 1: ['🌤️', 'Quase limpo'], 2: ['⛅', 'Parcialmente nublado'], 3: ['☁️', 'Nublado'],
    45: ['🌫️', 'Neblina'], 48: ['🌫️', 'Neblina'], 51: ['🌦️', 'Garoa fraca'], 53: ['🌦️', 'Garoa'], 55: ['🌧️', 'Garoa forte'],
    61: ['🌦️', 'Chuva fraca'], 63: ['🌧️', 'Chuva'], 65: ['🌧️', 'Chuva forte'], 66: ['🌧️', 'Chuva congelante'], 67: ['🌧️', 'Chuva congelante'],
    71: ['🌨️', 'Neve fraca'], 73: ['🌨️', 'Neve'], 75: ['❄️', 'Neve forte'], 80: ['🌦️', 'Pancadas fracas'], 81: ['🌧️', 'Pancadas de chuva'],
    82: ['⛈️', 'Pancadas fortes'], 95: ['⛈️', 'Trovoadas'], 96: ['⛈️', 'Trovoadas com granizo'], 99: ['⛈️', 'Trovoadas com granizo'],
  };
  const tempo = (c) => TEMPO[c] || ['🌡️', '—'];
  let ultimoClima = 0;
  let clima = null;

  async function atualizarClima(forcar = false) {
    if (!forcar && clima && Date.now() - ultimoClima < 20 * 60000) return desenharClima();
    const r = await api.clima();
    if (r?.ok) { clima = r; ultimoClima = Date.now(); }
    desenharClima(r);
  }

  let climaDia = null; // null = visão geral; número = índice do dia aberto

  const el = (tag, classe, texto) => {
    const e = document.createElement(tag);
    if (classe) e.className = classe;
    if (texto !== undefined) e.textContent = texto;
    return e;
  };
  const hhmm = (iso) => iso.slice(11, 16);
  const nivelUV = (uv) => (uv >= 11 ? 'extremo' : uv >= 8 ? 'muito alto' : uv >= 6 ? 'alto' : uv >= 3 ? 'moderado' : 'baixo');
  const iconeHora = (codigo, dia) => (!dia && codigo <= 1 ? '🌙' : !dia && codigo === 2 ? '☁️' : tempo(codigo)[0]);
  const fmtDiaSemana = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
  const fmtDiaCompleto = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
  const dataDe = (iso) => { const [a, m, d] = iso.split('-').map(Number); return new Date(a, m - 1, d); };

  // Horas do dia escolhido (hoje: só a partir de agora)
  function horasDoDia(iDia) {
    const h = clima.horario;
    if (!h) return [];
    const dia = clima.diario.time[iDia];
    const horaAgora = new Date().getHours();
    const lista = [];
    h.time.forEach((t, k) => {
      if (!t.startsWith(dia)) return;
      if (iDia === 0 && Number(t.slice(11, 13)) < horaAgora) return; // hoje: só daqui pra frente
      lista.push({
        t, temp: h.temperature_2m[k], sens: h.apparent_temperature?.[k], chuva: h.precipitation_probability?.[k] ?? 0,
        mm: h.precipitation?.[k] ?? 0, codigo: h.weather_code[k], vento: h.wind_speed_10m?.[k], dia: h.is_day?.[k] !== 0,
      });
    });
    return lista;
  }

  // "Chuva mais provável entre 15h e 19h (até 80%)"
  function resumoChuva(horas) {
    const molhadas = horas.filter((x) => x.chuva >= 40);
    if (!molhadas.length) return horas.length ? 'Sem chuva prevista' : '';
    const max = Math.max(...molhadas.map((x) => x.chuva));
    const ini = Number(molhadas[0].t.slice(11, 13));
    const fim = Number(molhadas[molhadas.length - 1].t.slice(11, 13));
    return ini === fim ? `☂ Chuva provável às ${ini}h (${max}%)` : `☂ Chuva mais provável entre ${ini}h e ${fim + 1}h (até ${max}%)`;
  }

  // Rolagem lateral com a roda do mouse (sem trocar de widget)
  function rolagemLateral(box) {
    box.addEventListener('wheel', (e) => {
      if (box.scrollWidth <= box.clientWidth) return;
      e.preventDefault();
      e.stopPropagation();
      box.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY);
    }, { passive: false });
  }

  function desenharClima(r = { ok: true }) {
    const box = $('clima');
    box.innerHTML = '';
    if (!clima) {
      box.appendChild(el('div', 'vazio', r?.erro ? `Clima indisponível: ${r.erro}` : 'Carregando o clima…'));
      return;
    }
    if (climaDia !== null && clima.diario.time[climaDia]) desenharDiaClima(box, climaDia);
    else desenharGeralClima(box);
  }

  function desenharGeralClima(box) {
    const c = clima.atual;
    const d = clima.diario;
    const [ic, desc] = tempo(c.weather_code);
    const agora = el('div', 'clima-agora');
    agora.append(el('div', 'clima-icone', ic), el('div', 'clima-temp', `${Math.round(c.temperature_2m)}°`));
    const info = el('div', 'clima-info');
    info.append(el('b', '', `${clima.automatico ? '📍 ' : ''}${clima.cidade}${clima.aproximado ? ' (aprox.)' : ''} · ${desc}`), document.createElement('br'),
      `Sensação ${Math.round(c.apparent_temperature)}° · Umidade ${c.relative_humidity_2m}% · Vento ${Math.round(c.wind_speed_10m)} km/h`,
      document.createElement('br'), el('span', 'clima-chuva', resumoChuva(horasDoDia(0))));
    agora.appendChild(info);

    const dias = el('div', 'clima-dias');
    rolagemLateral(dias);
    for (let i = 0; i < d.time.length; i++) {
      const b = el('button', 'clima-dia');
      b.title = 'Ver a previsão hora a hora';
      b.append(
        el('span', 'cd-nome', i === 0 ? 'Hoje' : fmtDiaSemana.format(dataDe(d.time[i])).replace('.', '')),
        el('span', 'cd-icone', tempo(d.weather_code[i])[0]),
        el('span', 'cd-temp', `${Math.round(d.temperature_2m_max[i])}° ${Math.round(d.temperature_2m_min[i])}°`),
        el('span', 'cd-chuva' + ((d.precipitation_probability_max?.[i] ?? 0) >= 50 ? ' alta' : ''), `☂ ${d.precipitation_probability_max?.[i] ?? 0}%`),
      );
      b.addEventListener('click', () => { climaDia = i; desenharClima(); });
      dias.appendChild(b);
    }
    box.append(agora, dias);
  }

  function desenharDiaClima(box, i) {
    const d = clima.diario;
    const horas = horasDoDia(i);
    const nomeDia = i === 0 ? 'Hoje' : fmtDiaCompleto.format(dataDe(d.time[i]));

    const topo = el('div', 'cd-topo');
    const voltar = el('button', 'mini-bt', '‹');
    voltar.title = 'Voltar';
    voltar.addEventListener('click', () => { climaDia = null; desenharClima(); });
    const titulo = el('div', 'cd-titulo');
    titulo.append(el('b', '', nomeDia.charAt(0).toUpperCase() + nomeDia.slice(1)),
      el('span', '', ` · ${tempo(d.weather_code[i])[1]} · ${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°`));
    // navegar entre dias sem voltar
    const ant = el('button', 'mini-bt', '‹'); ant.title = 'Dia anterior'; ant.disabled = i === 0;
    const prox = el('button', 'mini-bt', '›'); prox.title = 'Próximo dia'; prox.disabled = i === d.time.length - 1;
    ant.addEventListener('click', () => { climaDia = i - 1; desenharClima(); });
    prox.addEventListener('click', () => { climaDia = i + 1; desenharClima(); });
    const navs = el('div', 'cd-navs'); navs.append(ant, prox);
    topo.append(voltar, titulo, navs);

    const extra = el('div', 'cd-extra');
    const uv = d.uv_index_max?.[i];
    extra.append(
      el('span', '', `🌅 ${hhmm(d.sunrise[i])}`), el('span', '', `🌇 ${hhmm(d.sunset[i])}`),
      el('span', '', `☂ ${d.precipitation_probability_max?.[i] ?? 0}% · ${(d.precipitation_sum?.[i] ?? 0).toFixed(1).replace('.', ',')} mm`),
      el('span', '', `💨 até ${Math.round(d.wind_speed_10m_max?.[i] ?? 0)} km/h`),
    );
    if (uv != null) extra.append(el('span', uv >= 8 ? 'uv-alto' : '', `UV ${Math.round(uv)} · ${nivelUV(uv)}`));

    const resumo = el('div', 'clima-chuva', resumoChuva(horas));

    const faixa = el('div', 'horas');
    rolagemLateral(faixa);
    if (!horas.length) faixa.appendChild(el('div', 'vazio', 'Sem previsão por hora para este dia'));
    for (const h of horas) {
      const card = el('div', 'hora' + (h.chuva >= 50 ? ' molhada' : ''));
      card.title = `${hhmm(h.t)} · ${tempo(h.codigo)[1]} · sensação ${Math.round(h.sens ?? h.temp)}° · vento ${Math.round(h.vento ?? 0)} km/h`;
      const barra = el('div', 'barra-chuva');
      const enche = el('i'); enche.style.height = Math.max(4, h.chuva) + '%';
      barra.appendChild(enche);
      card.append(
        el('span', 'h-hora', `${Number(h.t.slice(11, 13))}h`),
        el('span', 'h-icone', iconeHora(h.codigo, h.dia)),
        el('span', 'h-temp', `${Math.round(h.temp)}°`),
        barra,
        el('span', 'h-chuva', `${h.chuva}%`),
        el('span', 'h-mm', h.mm > 0 ? `${h.mm.toFixed(1).replace('.', ',')}mm` : ''),
      );
      faixa.appendChild(card);
    }
    box.append(topo, extra, resumo, faixa);
    // Já mostra a parte que interessa: a primeira hora de chuva, ou o começo da manhã
    requestAnimationFrame(() => {
      const cards = [...faixa.querySelectorAll('.hora')];
      const alvo = cards.find((c) => c.classList.contains('molhada'))
        || (i > 0 ? cards.find((c) => c.querySelector('.h-hora').textContent === '6h') : null);
      if (alvo) {
        faixa.style.scrollBehavior = 'auto';
        faixa.scrollLeft = Math.max(0, alvo.offsetLeft - faixa.offsetLeft - 4);
        faixa.style.scrollBehavior = '';
      }
    });
  }

  setInterval(() => atualizarClima(true), 30 * 60000);

  // -------------------------------------------------------------------------
  // Copiados (histórico da área de transferência; só na memória)
  // -------------------------------------------------------------------------
  function desenharClips(lista = []) {
    const ul = $('listaClips');
    ul.innerHTML = '';
    if (!lista.length) {
      const li = document.createElement('li'); li.className = 'vazio';
      li.textContent = config.historicoCopiados === false ? 'Histórico desligado nas configurações' : 'Copie algum texto (Ctrl+C) e ele aparece aqui';
      ul.appendChild(li);
      return;
    }
    for (const texto of lista) {
      const li = document.createElement('li');
      const t = document.createElement('span'); t.className = 'txt';
      t.textContent = texto.replace(/\s+/g, ' ').slice(0, 140);
      t.title = texto.slice(0, 600);
      li.appendChild(t);
      li.addEventListener('click', () => {
        api.copiar(texto);
        aviso('Copiado de novo', texto.replace(/\s+/g, ' ').slice(0, 50), { icone: '📋', ms: 1400 });
      });
      ul.appendChild(li);
    }
  }
  api.on('copiados', desenharClips);
  $('limparClip').addEventListener('click', () => { api.limparCopiados(); desenharClips([]); });

  // -------------------------------------------------------------------------
  // Sistema (CPU, memória, disco, tempo ligado)
  // -------------------------------------------------------------------------
  function medidor(nome, pct, valor, detalhe, colorir = true, abrir = null) {
    const div = document.createElement(abrir ? 'button' : 'div');
    div.className = 'medidor' + (abrir ? ' clicavel' : '');
    if (abrir) {
      div.title = abrir.titulo;
      div.addEventListener('click', () => api.acao(abrir.acao));
    }
    const classe = !colorir ? '' : pct >= 90 ? 'critico' : pct >= 75 ? 'alto' : '';
    div.innerHTML = `<div class="roda"><svg viewBox="0 0 80 80"><circle class="fundo" cx="40" cy="40" r="32"/><circle class="valor ${classe}" cx="40" cy="40" r="32"/></svg><div class="num"></div></div><div class="det"></div>`;
    // (a página não aceita style escrito no HTML: o valor do anel vai pelo JavaScript)
    div.querySelector('.valor').style.strokeDashoffset = (201 * (1 - Math.min(100, Math.max(0, pct)) / 100)).toFixed(1) + 'px';
    div.querySelector('.num').textContent = valor;
    const det = div.querySelector('.det');
    det.append(nome, document.createElement('br'), detalhe);
    return div;
  }
  const gb = (b) => (b / 1024 ** 3).toFixed(b > 100 * 1024 ** 3 ? 0 : 1);
  async function atualizarRecursos() {
    const r = await api.recursos();
    if (!r) return;
    const box = $('medidores');
    box.innerHTML = '';
    const tarefas = { titulo: 'Abrir o Gerenciador de Tarefas', acao: { tipo: 'abrir', app: 'gerenciador de tarefas' } };
    const graus = (t) => (Number.isFinite(t) && t > 0 && t < 130 ? `${Math.round(t)}°C` : null);
    const tCpu = graus(r.cpuTemp);
    const tGpu = graus(r.gpuTemp);
    const temGpu = Number.isFinite(r.gpuUso);
    const quente = (t) => (t >= 85 ? ' 🔥' : '');
    box.classList.remove('cinco');
    desenharDiscos(r.discos || [{ letra: 'C', total: r.discoTotal, usado: r.discoUsado }]);
    box.append(
      medidor('CPU', r.cpu, `${r.cpu}%`, tCpu ? `${tCpu}${quente(r.cpuTemp)}` : `${r.nucleos} núcleos`, true, tarefas),
      ...(temGpu ? [medidor('GPU', r.gpuUso, `${Math.round(r.gpuUso)}%`, tGpu ? `${tGpu}${quente(r.gpuTemp)}` : (r.gpuNome || 'placa de vídeo'), true, tarefas)] : []),
      medidor('Memória', (r.ramUsada / r.ramTotal) * 100, `${Math.round((r.ramUsada / r.ramTotal) * 100)}%`, `${gb(r.ramUsada)} de ${gb(r.ramTotal)} GB`, true, tarefas),
      medidor('Ligado há', Math.min(100, (r.uptime / 86400) * 100), r.uptime >= 86400 ? `${Math.floor(r.uptime / 86400)}d` : `${Math.floor(r.uptime / 3600)}h`, `${Math.floor((r.uptime % 3600) / 60)} min`, false),
    );
  }
  function desenharDiscos(discos = []) {
    const box = $('discos');
    if (!box) return;
    box.innerHTML = '';
    for (const d of discos) {
      const pct = d.total ? (d.usado / d.total) * 100 : 0;
      const b = document.createElement('button');
      b.className = 'disco' + (pct >= 90 ? ' critico' : pct >= 75 ? ' alto' : '');
      b.title = `Abrir o disco ${d.letra}:`;
      const nome = document.createElement('b'); nome.textContent = d.letra + ':';
      const barra = document.createElement('span'); barra.className = 'barra';
      const cheio = document.createElement('i'); cheio.style.width = pct.toFixed(1) + '%';
      barra.appendChild(cheio);
      const livre = document.createElement('small'); livre.textContent = `${gb(d.total - d.usado)} GB livres`;
      b.append(nome, barra, livre);
      b.addEventListener('click', () => api.acao({ tipo: 'abrirDisco', letra: d.letra }));
      box.appendChild(b);
    }
  }
  setInterval(() => {
    const painelAberto = document.getElementById('ilha').dataset.estado === 'expandida';
    if (painelAberto && paginas[atual]?.dataset.widget === 'sistema') atualizarRecursos();
  }, 2000);

  // -------------------------------------------------------------------------
  // Favoritos: apps com um clique
  // -------------------------------------------------------------------------
  let appsInstalados = null;
  const iconeDe = (caminho, alvo, reserva) => {
    alvo.textContent = reserva;
    if (!caminho) return;
    api.iconeArquivo(caminho).then((url) => {
      if (!url) return;
      const img = document.createElement('img'); img.src = url; img.alt = '';
      alvo.textContent = ''; alvo.appendChild(img);
    });
  };
  function desenharDock() {
    const box = $('dock');
    box.innerHTML = '';
    dados.dock.forEach((a, i) => {
      const b = document.createElement('button');
      b.className = 'dock-app';
      b.title = a.nome;
      const ic = document.createElement('span'); ic.className = 'ic'; iconeDe(a.lnk, ic, '▢');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = a.nome;
      const x = document.createElement('button'); x.className = 'tirar'; x.textContent = '✕'; x.title = 'Tirar dos favoritos';
      x.addEventListener('click', (e) => { e.stopPropagation(); dados.dock.splice(i, 1); salvar('dock'); desenharDock(); });
      b.append(ic, nm, x);
      b.addEventListener('click', () => { api.acao({ tipo: 'abrirApp', appId: a.appId }); olhos.reagir('feliz', 900); aviso('Abrindo ' + a.nome, '', { icone: '↗', ms: 1200 }); });
      box.appendChild(b);
    });
    if (dados.dock.length < 8) {
      const add = document.createElement('button');
      add.className = 'dock-app dock-add';
      add.innerHTML = '<span class="ic">＋</span><span class="nm">Adicionar</span>';
      add.addEventListener('click', abrirBuscaDock);
      box.appendChild(add);
    }
  }
  async function abrirBuscaDock() {
    $('dock').hidden = true;
    $('dockBusca').hidden = false;
    appsInstalados = appsInstalados || await api.listarApps();
    const campo = $('dockCampo');
    campo.value = '';
    pedirTeclado(true);
    campo.focus();
    setTimeout(() => campo.focus(), 60);
    sugerirDock('');
  }
  function fecharBuscaDock() {
    $('dockBusca').hidden = true;
    $('dock').hidden = false;
    pedirTeclado(false);
    desenharDock();
  }
  function sugerirDock(texto) {
    const q = texto.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const ul = $('dockSugestoes');
    ul.innerHTML = '';
    const lista = (appsInstalados || [])
      .filter((a) => !dados.dock.some((d) => d.appId === a.appId))
      .filter((a) => !q || a.nome.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(q))
      .slice(0, 80);
    if (!lista.length) { const li = document.createElement('li'); li.className = 'vazio'; li.textContent = 'Nenhum app encontrado'; ul.appendChild(li); }
    for (const a of lista) {
      const li = document.createElement('li');
      const ic = document.createElement('span'); ic.className = 'hora-ev'; iconeDe(a.lnk, ic, '▢');
      const t = document.createElement('span'); t.className = 'txt'; t.textContent = a.nome;
      li.append(ic, t);
      li.addEventListener('click', () => {
        dados.dock.push(a);
        salvar('dock');
        fecharBuscaDock();
        olhos.reagir('feliz', 900);
      });
      ul.appendChild(li);
    }
  }
  $('dockCampo').addEventListener('input', (e) => sugerirDock(e.target.value));
  $('dockCampo').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharBuscaDock();
    if (e.key === 'Enter') $('dockSugestoes').querySelector('li:not(.vazio)')?.click();
  });
  $('dockCampo').addEventListener('pointerdown', () => { pedirTeclado(true); setTimeout(() => $('dockCampo').focus(), 40); });

  // -------------------------------------------------------------------------
  // Bandeja: arraste arquivos para cá e depois arraste para onde quiser
  // -------------------------------------------------------------------------
  function desenharBandeja() {
    const box = $('bandeja');
    box.innerHTML = '';
    box.classList.toggle('vazia', !dados.bandeja.length);
    $('bandejaInfo').textContent = dados.bandeja.length
      ? `${dados.bandeja.length} arquivo${dados.bandeja.length === 1 ? '' : 's'} · arraste para fora para usar`
      : 'Arraste arquivos para cá';
    if (!dados.bandeja.length) {
      box.textContent = '📥 Solte arquivos aqui para guardar por um tempo e arrastar depois para outro lugar';
      return;
    }
    dados.bandeja.forEach((caminho, i) => {
      const div = document.createElement('div');
      div.className = 'arquivo';
      div.draggable = true;
      const nome = caminho.split(/[\\/]/).pop();
      div.title = caminho + '\nArraste para usar · clique para abrir';
      const ic = document.createElement('span'); iconeDe(caminho, ic, '📄');
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = nome;
      const x = document.createElement('button'); x.className = 'tirar'; x.textContent = '✕'; x.title = 'Tirar da bandeja (o arquivo continua no lugar)';
      x.addEventListener('click', (e) => { e.stopPropagation(); dados.bandeja.splice(i, 1); salvar('bandeja'); desenharBandeja(); });
      div.append(ic, nm, x);
      div.addEventListener('dragstart', (e) => { e.preventDefault(); api.arrastar(caminho); });
      div.addEventListener('click', () => api.acao({ tipo: 'abrirArquivo', caminho }));
      box.appendChild(div);
    });
  }
  function guardarNaBandeja(caminhos) {
    for (const c of caminhos) if (!dados.bandeja.includes(c)) dados.bandeja.push(c);
    dados.bandeja = dados.bandeja.slice(-24);
    salvar('bandeja');
    desenharBandeja();
  }
  $('limparBandeja').addEventListener('click', () => { dados.bandeja = []; salvar('bandeja'); desenharBandeja(); });

  // -------------------------------------------------------------------------
  // Google Agenda (link iCal configurado nas configurações)
  // -------------------------------------------------------------------------
  async function carregarAgendasExternas() {
    if (!(config.agendasIcs || []).length) { externos = []; desenharCalendario(); atualizarResumo(); return; }
    const r = await api.agendas();
    externos = (r?.eventos || []).map((e) => ({ ...e, avisos: (externos.find((x) => x.id === e.id)?.avisos) || [] }));
    desenharCalendario();
    atualizarResumo();
  }
  api.on('agendas:recarregar', carregarAgendasExternas);
  setInterval(carregarAgendasExternas, 15 * 60000);

  // -------------------------------------------------------------------------
  // Resumo na página Início
  // -------------------------------------------------------------------------
  function irParaNome(nome) {
    const i = paginas.findIndex((p) => p.dataset.widget === nome);
    if (i >= 0) irPara(i);
  }

  function atualizarResumo() {
    const el = $('resumoInicio');
    el.innerHTML = '';
    const partes = [];
    const prox = proximoEvento();
    if (prox) {
      const hojeIso = dataISO(new Date());
      const quando = prox.e.data === hojeIso ? prox.e.hora : `${prox.e.data.slice(8)}/${prox.e.data.slice(5, 7)} ${prox.e.hora}`;
      partes.push(['📅 ', quando + ' ' + prox.e.titulo, 'agenda']);
    }
    const pend = dados.tarefas.filter((t) => !t.feita).length;
    if (pend) partes.push(['✓ ', `${pend} tarefa${pend === 1 ? '' : 's'}`, 'tarefas']);
    if (clima) partes.push(['', `${tempo(clima.atual.weather_code)[0]} ${Math.round(clima.atual.temperature_2m)}°`, 'clima']);
    if (!partes.length) { el.textContent = 'Deslize para os lados para ver os widgets →'; return; }
    partes.forEach(([ic, txt, destino], i) => {
      if (i) el.append(' · ');
      const b = document.createElement('button');
      b.className = 'link-resumo';
      b.textContent = ic + txt;
      b.title = 'Abrir ' + destino;
      b.addEventListener('click', () => irParaNome(destino));
      el.append(b);
    });
  }
  setInterval(atualizarResumo, 30000);

  // -------------------------------------------------------------------------
  // Atividade ao vivo para a pílula compacta
  // -------------------------------------------------------------------------
  function atividade() {
    if (foco.rodando) {
      const resta = Math.max(0, (foco.fim - Date.now()) / 1000);
      return { classe: foco.fase === 'foco' ? 'foco' : 'pausa', texto: `${foco.fase === 'foco' ? '🍅' : '☕'} ${pad(Math.floor(resta / 60))}:${pad(Math.floor(resta % 60))}` };
    }
    const prox = proximoEvento();
    if (prox) {
      const falta = (prox.t - Date.now()) / 60000;
      if (falta <= 15 && falta > -1) {
        return { classe: 'evento', texto: falta < 1 ? `📅 Agora · ${prox.e.titulo}` : `📅 ${Math.ceil(falta)} min · ${prox.e.titulo}` };
      }
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Início
  // -------------------------------------------------------------------------
  async function carregar() {
    const salvos = await api.lerDados();
    Object.assign(dados, {
      tarefas: salvos.tarefas || [],
      eventos: salvos.eventos || [],
      notas: salvos.notas || '',
      foco: salvos.foco || dados.foco,
      bandeja: salvos.bandeja || [],
      dock: salvos.dock || [],
    });
    atual = Number(salvos.paginaAtual) || 0;
    $('notas').value = dados.notas;
    montarCarrossel();
    desenharTarefas();
    desenharCalendario();
    resetarFase('foco');
    atualizarResumo();
    atualizarClima();
    desenharClips([]);
    desenharDock();
    desenharBandeja();
    carregarAgendasExternas();
    verificarLembretes();
  }

  function aplicarConfig(c) {
    const antes = JSON.stringify(config.widgets);
    const cidadeAntes = config.cidade;
    config = c || {};
    if (JSON.stringify(config.widgets) !== antes) montarCarrossel();
    if (config.cidade !== cidadeAntes && cidadeAntes !== undefined) { clima = null; atualizarClima(true); }
    if (!foco.rodando) resetarFase(foco.fase);
  }

  return {
    carregar,
    guardarNaBandeja,
    aplicarConfig,
    atividade,
    aoAbrirPainel: () => aoMostrar(paginas[atual]?.dataset.widget),
    paginaAtual: () => paginas[atual]?.dataset.widget,
    irParaInicio: () => irPara(0, false),
    irParaWidget: (nome) => { const i = paginas.findIndex((p) => p.dataset.widget === nome); if (i >= 0) irPara(i); return i >= 0; },
    alternarFoco,
    novaTarefa: (texto) => { const t = { id: uid(), texto, feita: false }; dados.tarefas.unshift(t); salvar('tarefas'); desenharTarefas(t.id); atualizarResumo(); },
    novoEvento: (texto, iso = dataISO(new Date())) => { const { hora, titulo } = lerEvento(texto); dados.eventos.push({ id: uid(), data: iso, hora, titulo, avisos: [] }); salvar('eventos'); desenharCalendario(); atualizarResumo(); },
    nota: (texto) => { dados.notas = (dados.notas ? dados.notas + '\n' : '') + texto; $('notas').value = dados.notas; salvar('notas'); },
  };
}
