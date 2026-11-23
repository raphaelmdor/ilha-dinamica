// Interpreta a frase reconhecida e devolve uma intenção.
// Funciona com texto livre: procura palavras-chave, não frases exatas.

export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNIDADES = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13,
  catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, meia: 0.5, meio: 0.5,
};

// "vinte e cinco" -> 25, "12" -> 12, "uma e meia" -> 1.5
export function lerNumero(palavras) {
  let total = null;
  for (const p of palavras) {
    if (/^\d+$/.test(p)) { total = (total || 0) + Number(p); continue; }
    if (p === 'e' && total !== null) continue;
    if (p in UNIDADES) { total = (total || 0) + UNIDADES[p]; continue; }
    if (total !== null) break;
  }
  return total;
}

const UNIDADES_TEMPO = [
  { re: /^(segundo|segundos|seg)$/, fator: 1 },
  { re: /^(minuto|minutos|min)$/, fator: 60 },
  { re: /^(hora|horas)$/, fator: 3600 },
];

// "cinco minutos e trinta segundos" -> 330
export function lerDuracao(texto) {
  const palavras = texto.split(' ');
  let total = 0;
  let numero = [];
  let ultimoFator = 0;
  for (const p of palavras) {
    const unidade = UNIDADES_TEMPO.find((u) => u.re.test(p));
    if (unidade) {
      const n = lerNumero(numero);
      total += (n === null ? 1 : n) * unidade.fator;
      ultimoFator = unidade.fator;
      numero = [];
    } else if ((p === 'meia' || p === 'meio') && ultimoFator && numero.every((x) => x === 'e')) {
      total += ultimoFator / 2; // "uma hora e meia"
      ultimoFator = 0;
      numero = [];
    } else if (/^\d+$/.test(p) || p in UNIDADES || p === 'e') {
      numero.push(p);
    } else {
      numero = [];
    }
  }
  return total > 0 ? Math.round(total) : null;
}

const APPS = [
  ['gerenciador de tarefas', 'gerenciador de tarefas'],
  ['bloco de notas', 'bloco de notas'],
  ['calculadora', 'calculadora'],
  ['explorador', 'explorador'],
  ['arquivos', 'arquivos'],
  ['pastas', 'pastas'],
  ['configuracoes', 'configuracoes'],
  ['configuracao', 'configuracoes'],
  ['terminal', 'terminal'],
  ['paint', 'paint'],
  ['spotify', 'spotify'],
  ['whatsapp', 'whatsapp'],
  ['navegador', 'navegador'],
  ['internet', 'navegador'],
  ['google', 'navegador'],
  ['chrome', 'chrome'],
  ['edge', 'edge'],
  ['youtube', 'youtube'],
  ['email', 'email'],
  ['notas', 'notas'],
];

const tem = (t, ...termos) => termos.some((x) => new RegExp(`(^| )${x}( |$)`).test(t));

/**
 * @returns {{tipo: string, [k: string]: any} | null}
 */
export function interpretar(frase) {
  const t = normalizar(frase);
  if (!t) return null;
  let m;

  // "Claude, ..." / "pergunta pro Claude ..." -> abre o app Claude com a pergunta
  const mc = t.match(/^(?:(?:pergunta|pergunte|perguntar|fala|fale|manda|mande|abre o|abrir o) (?:pro|para o|pra o|ao|no|o) )?(?:claude|cloud|clode|claudio|clau) (?:que |se )?(.+)$/);
  if (mc) {
    // devolve o texto original (com acentos), sem as palavras do gatilho
    const n = t.split(' ').length - mc[1].split(' ').length;
    return { tipo: 'claude', texto: String(frase).trim().split(/\s+/).slice(n).join(' ') };
  }

  // Ajuda
  if (tem(t, 'ajuda', 'o que voce faz', 'comandos')) return { tipo: 'ajuda' };

  // Timer
  if (tem(t, 'cancelar timer', 'cancela timer', 'parar timer', 'cancelar temporizador', 'cancelar alarme')) {
    return { tipo: 'timer-cancelar' };
  }
  if (tem(t, 'timer', 'temporizador', 'cronometro', 'alarme', 'me avisa', 'me avise', 'contagem')) {
    const segundos = lerDuracao(t);
    return segundos ? { tipo: 'timer', segundos } : { tipo: 'nao-entendi', dica: 'Diga, por exemplo: "timer de cinco minutos"' };
  }

  // Produtividade
  m = String(frase).trim().match(/^(?:nova tarefa|adicionar tarefa|adiciona tarefa|tarefa|lembrar de|me lembra de)\s+(.+)$/i);
  if (m) return { tipo: 'tarefa', texto: m[1] };
  m = String(frase).trim().match(/^(?:anotar|anota|anote|nota)\s+(?:que\s+)?(.+)$/i);
  if (m) return { tipo: 'nota', texto: m[1] };
  m = String(frase).trim().match(/^(?:marcar|marca|agendar|agenda|compromisso)\s+(?:às\s+|as\s+)?(.+)$/i);
  if (m) {
    let resto = m[1].trim();
    // "quinze horas e trinta reunião" / "15 horas reunião" -> "15:30 reunião"
    const p = resto.split(/\s+/);
    const iHora = p.findIndex((w) => /^horas?$/i.test(w));
    if (iHora > 0) {
      const h = lerNumero(p.slice(0, iHora).map((w) => normalizar(w)));
      let k = iHora + 1;
      let min = 0;
      if (p[k] === 'e') {
        const fim = p.findIndex((w, j) => j > k && !(normalizar(w) in UNIDADES) && w !== 'e' && !/^\d+$/.test(w));
        const n = lerNumero(p.slice(k + 1, fim < 0 ? p.length : fim).map((w) => normalizar(w)));
        if (n !== null) { min = n === 0.5 ? 30 : n; k = fim < 0 ? p.length : fim; }
      }
      if (h !== null && h < 24) resto = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')} ${p.slice(k).join(' ')}`;
    }
    if (/^\d{1,2}([:h]\d{0,2})?\s/.test(resto)) return { tipo: 'evento', texto: resto };
  }
  if (/^(comecar|iniciar|inicia|começa|pausar|parar)? ?(o )?(foco|pomodoro)$/.test(t) || tem(t, 'modo foco', 'comecar foco', 'iniciar pomodoro')) return { tipo: 'foco' };
  const widgetsVoz = { agenda: 'agenda', calendario: 'agenda', tarefas: 'tarefas', clima: 'clima', tempo: 'clima', notas: 'notas', sistema: 'sistema', copiados: 'clipboard', favoritos: 'dock', bandeja: 'bandeja' };
  m = t.match(/^(?:abrir|abre|mostrar|mostra|ver)\s+(?:a |o |as |os )?(agenda|calendario|tarefas|clima|tempo|notas|sistema|copiados|favoritos|bandeja)$/);
  if (m) return { tipo: 'widget', nome: widgetsVoz[m[1]] };

  // Barra de busca
  if (tem(t, 'abrir busca', 'abre a busca', 'buscar no computador', 'procurar no computador')) return { tipo: 'busca' };

  // Pesquisas (texto livre depois do verbo)
  m = t.match(/(?:^| )(?:tocar|toca|toque|colocar|coloca|coloque) (.+?) no youtube$/);
  if (m) return { tipo: 'youtube', termo: m[1] };
  m = t.match(/(?:^| )(?:pesquisar|pesquisa|pesquise|procurar|procura|procure|buscar|busca|busque|google) (?:por |sobre )?(.+)$/);
  if (m) return { tipo: 'pesquisar', termo: m[1] };

  // Abrir apps
  m = t.match(/(?:^| )(?:abrir|abre|abra|iniciar|inicia|inicie|executar|executa|execute) (?:o |a |os |as )?(.+)$/);
  if (m) {
    const resto = m[1];
    const achado = APPS.find(([chave]) => resto.includes(chave));
    if (achado) return { tipo: 'abrir', app: achado[1] };
    return { tipo: 'nao-entendi', dica: `Não sei abrir "${resto}" ainda` };
  }

  // Controles do sistema
  m = t.match(/(?:^| )(?:volume|som)(?: (?:em|para|no|a))? (.+)$/);
  if (m && !/(aumenta|abaixa|diminui|sobe|desce|mais|menos)/.test(t)) {
    const n = lerNumero(m[1].split(' '));
    if (n !== null && n >= 0 && n <= 100) return { tipo: 'sistema', id: 'vol', valor: Math.round(n) };
  }
  m = t.match(/(?:^| )brilho(?: (?:em|para|no|a))? (.+)$/);
  if (m) {
    const n = lerNumero(m[1].split(' '));
    if (n !== null && n >= 0 && n <= 100) return { tipo: 'sistema', id: 'brilho', valor: Math.round(n) };
  }
  const liga = /(^| )(ligar|liga|ligue|ativar|ativa|ative|conectar|conecta)( |$)/.test(t);
  const desliga = /(^| )(desligar|desliga|desligue|desativar|desativa|desative|desconectar|desconecta)( |$)/.test(t);
  if (tem(t, 'wifi', 'wi fi', 'internet sem fio') && (liga || desliga)) return { tipo: 'sistema', id: 'wifi', valor: desliga ? 'off' : 'on' };
  if (tem(t, 'bluetooth', 'blutufe', 'blue tooth') && (liga || desliga)) return { tipo: 'sistema', id: 'bt', valor: desliga ? 'off' : 'on' };
  if (tem(t, 'modo escuro', 'tema escuro', 'modo claro', 'tema claro', 'trocar tema', 'mudar tema')) return { tipo: 'sistema', id: 'tema' };

  // Volume
  if (tem(t, 'mudo', 'silenciar', 'silencio', 'desmutar', 'tirar do mudo', 'mutar')) {
    return { tipo: 'midia', cmd: 'mute' };
  }
  if (tem(t, 'volume', 'som', 'mais alto', 'mais baixo', 'aumenta', 'aumentar', 'abaixa', 'abaixar', 'diminui', 'diminuir')) {
    // Cada passo = 2% no Windows. "um pouco" não conta como número.
    const n = lerNumero(t.split(' '));
    const passos = n >= 2 ? Math.min(20, Math.round(n)) : 5;
    // "baixo" vem antes de "mais": senão "mais baixo" viraria aumentar
    if (tem(t, 'abaixa', 'abaixar', 'abaixe', 'diminui', 'diminuir', 'diminua', 'desce', 'descer', 'mais baixo', 'baixo', 'menos')) {
      return { tipo: 'midia', cmd: 'voldown', vezes: passos };
    }
    if (tem(t, 'aumenta', 'aumentar', 'aumente', 'sobe', 'subir', 'mais alto', 'alto', 'mais')) {
      return { tipo: 'midia', cmd: 'volup', vezes: passos };
    }
  }

  // Mídia
  if (tem(t, 'proxima', 'proximo', 'pular', 'pula', 'avancar', 'avanca', 'passar', 'passa')) {
    return { tipo: 'midia', cmd: 'next' };
  }
  if (tem(t, 'anterior', 'voltar musica', 'volta musica', 'musica anterior', 'voltar')) {
    return { tipo: 'midia', cmd: 'prev' };
  }
  if (tem(t, 'pausar', 'pausa', 'pause', 'parar', 'para', 'continuar', 'continua', 'retomar', 'play', 'tocar', 'toca', 'despausar', 'soltar')) {
    return { tipo: 'midia', cmd: 'toggle' };
  }

  // Informações
  if (tem(t, 'que horas', 'horas sao', 'hora e', 'horario')) return { tipo: 'hora' };
  if (tem(t, 'que dia', 'data', 'dia e hoje', 'dia de hoje')) return { tipo: 'data' };
  if (tem(t, 'bateria', 'carga')) return { tipo: 'bateria' };
  if (tem(t, 'o que esta tocando', 'que musica', 'qual musica', 'quem canta')) return { tipo: 'tocando' };

  // Sistema
  if (tem(t, 'bloquear', 'bloqueia', 'bloqueie', 'trancar')) return { tipo: 'bloquear' };
  if (tem(t, 'print', 'captura', 'capturar', 'recortar', 'recorte', 'printar')) return { tipo: 'captura' };
  if (tem(t, 'esconder', 'esconde', 'sumir', 'some')) return { tipo: 'esconder' };
  if (tem(t, 'cancelar', 'cancela', 'nada', 'deixa', 'esquece')) return { tipo: 'cancelar' };

  return { tipo: 'nao-entendi' };
}

export const LISTA_AJUDA = [
  'pausar / continuar / próxima / anterior',
  'aumentar volume · abaixar volume · mudo',
  'timer de cinco minutos · cancelar timer',
  'que horas são · que dia é hoje · bateria',
  'abrir calculadora / navegador / spotify…',
  'pesquisar receita de bolo',
  'tocar lo-fi no youtube',
  'bloquear computador · tirar print',
  'volume em cinquenta · brilho setenta',
  'ligar wi-fi · desligar bluetooth · modo escuro',
  'nova tarefa comprar pão · anotar ligar pro João',
  'marcar 14:30 dentista · começar foco · abrir agenda',
  'Claude, como fazer arroz soltinho',
];
