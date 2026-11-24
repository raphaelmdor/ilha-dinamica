// Olhinhos da ilha: seguem o mouse, piscam e mudam de humor.
// Humores: normal, feliz, confuso, ouvindo, pensando, musica, surpreso, dormindo
// Gestos de mascote: carinho, piscadela, desconfiado, pulinho, espreguicar, bocejo, atchim, curioso, tonto

const SONO_MS = 2 * 60 * 1000; // sem mexer o mouse por 2 min: dorme

export class Olhos {
  constructor() {
    this.grupos = [...document.querySelectorAll('.olhos')];
    this.base = 'normal';       // humor "de fundo" (música, ouvindo...)
    this.temporario = null;     // humor passageiro (feliz, confuso...)
    this.timeoutTemp = null;
    this.ultimoMovimento = Date.now();
    this.cursor = null;
    this.dormindo = false;
    this.agendarPiscada();
    setInterval(() => this.vigiarSono(), 5000);
    setInterval(() => this.vaguear(), 2600);
    this.iniciarPersonalidade();
  }

  // ---------- Personalidade de mascote ----------
  iniciarPersonalidade() {
    this.cutucadas = [];
    this.rastro = [];
    this.ultTonto = 0;
    this.ultCarinho = 0;
    this.olhandoAte = 0;
    this.bocejou = false;
    this.conferirNoite();
    setInterval(() => this.conferirNoite(), 60 * 1000);
    setTimeout(() => this.agendarGesto(), 9000);
  }

  /** Nada mais importante acontecendo: pode fazer graça */
  livre() {
    return !this.temporario && !this.dormindo && !this.emChamada && this.base === 'normal' && document.visibilityState !== 'hidden';
  }

  /** De madrugada (23h–6h) fica de olhinho meio fechado, com soninho */
  conferirNoite() {
    const h = new Date().getHours();
    const noite = h >= 23 || h < 6;
    for (const g of this.grupos) g.classList.toggle('noite', noite);
    this.noite = noite;
  }

  /** De tempos em tempos, quando ninguém está mexendo, faz um gestinho espontâneo */
  agendarGesto() {
    const espera = (this.noite ? 10000 : 14000) + Math.random() * 18000;
    setTimeout(() => { try { this.gestoEspontaneo(); } finally { this.agendarGesto(); } }, espera);
  }

  gestoEspontaneo() {
    const parado = Date.now() - this.ultimoMovimento;
    if (!this.livre() || parado < 5000) return;
    // quase pegando no sono: um bocejo antes de dormir
    if (!this.bocejou && parado > SONO_MS - 40000) { this.bocejou = true; this.fazer('bocejo'); return; }
    const opcoes = this.noite
      ? [['bocejo', 4], ['piscadela', 1], ['espreguicar', 2], ['curioso', 1]]
      : [['piscadela', 3], ['desconfiado', 2], ['pulinho', 3], ['curioso', 3], ['espreguicar', 1.5], ['bocejo', 1], ['atchim', 0.7]];
    let r = Math.random() * opcoes.reduce((t, o) => t + o[1], 0);
    for (const [nome, peso] of opcoes) { if ((r -= peso) <= 0) return this.fazer(nome); }
  }

  /** Executa um gesto (com o olhar combinando quando precisa) */
  fazer(nome) {
    const dur = { piscadela: 1000, desconfiado: 2400, pulinho: 950, espreguicar: 1800, bocejo: 2300, atchim: 1400, curioso: 2300, tonto: 2200, carinho: 2000 }[nome] || 1500;
    this.reagir(nome, dur);
    const lado = Math.random() < 0.5 ? -1 : 1;
    const olharLado = (l) => {
      const r = this.grupos.find((g) => g.getBoundingClientRect().width)?.getBoundingClientRect();
      if (r) this.olharPara(r.left + r.width / 2 + l * 400, r.top + r.height / 2 + 10);
    };
    this.olhandoAte = Date.now() + dur;
    if (nome === 'desconfiado') { olharLado(lado); setTimeout(() => this.temporario === nome && olharLado(-lado), 1200); }
    if (nome === 'curioso') {
      olharLado(lado);
      setTimeout(() => this.temporario === nome && olharLado(-lado), 800);
      setTimeout(() => this.temporario === nome && this.olharPara(window.innerWidth / 2, 400), 1600);
    }
  }

  /** Clique nos olhinhos: carinho; vários cliques seguidos deixam ele tonto */
  cutucar() {
    const agora = Date.now();
    this.cutucadas = this.cutucadas.filter((t) => agora - t < 1600);
    this.cutucadas.push(agora);
    if (this.cutucadas.length >= 3) { this.cutucadas = []; this.ficarTonto(); }
    else this.fazer('carinho');
  }

  ficarTonto() {
    if (Date.now() - this.ultTonto < 4000 || this.emChamada) return;
    this.ultTonto = Date.now();
    this.fazer('tonto');
  }

  /** Mouse parado em cima dos olhinhos: ele gosta do carinho (^ ^ e bochechinhas) */
  conferirCarinho(pos) {
    const perto = (p) => p && this.grupos.some((g) => {
      const r = g.getBoundingClientRect();
      return r.width && p.x > r.left - 6 && p.x < r.right + 6 && p.y > r.top - 6 && p.y < r.bottom + 6;
    });
    if (!perto(pos)) { clearTimeout(this.timerCarinho); this.timerCarinho = null; return; }
    if (this.timerCarinho) return;
    this.timerCarinho = setTimeout(() => {
      this.timerCarinho = null;
      const ok = perto(this.cursor) && Date.now() - this.ultCarinho > 5000 && !this.emChamada && this.base !== 'ouvindo'
        && (!this.temporario || this.temporario === 'feliz');
      if (ok) { this.ultCarinho = Date.now(); this.fazer('carinho'); }
    }, 650);
  }

  /** Sacudir o mouse de um lado pro outro bem rápido deixa ele tonto */
  conferirSacudida(pos) {
    const agora = Date.now();
    this.rastro.push({ x: pos.x, t: agora });
    this.rastro = this.rastro.filter((p) => agora - p.t < 900);
    if (pos.botao || this.rastro.length < 6) return;
    let viradas = 0, sentido = 0, andou = 0;
    for (let i = 1; i < this.rastro.length; i++) {
      const dx = this.rastro[i].x - this.rastro[i - 1].x;
      andou += Math.abs(dx);
      if (Math.abs(dx) < 12) continue;
      const s = Math.sign(dx);
      if (sentido && s !== sentido) viradas++;
      sentido = s;
    }
    if (viradas >= 4 && andou > 900) { this.rastro = []; this.ficarTonto(); }
  }

  aplicar() {
    // em chamada: fone na cabeça e "falando", acima de música (mas a escuta da voz vem primeiro)
    const base = this.emChamada && this.base !== 'ouvindo' ? 'chamada' : this.base;
    const humor = this.temporario || (this.dormindo && !this.emChamada ? 'dormindo' : base);
    for (const g of this.grupos) g.dataset.humor = humor;
  }

  /**
   * Nível do som que está tocando (0–1, ~12x por segundo). Os olhinhos viram ^ ^ (curtindo),
   * acenam com a cabeça na batida (com mola, como gente), balançam de um lado pro outro no
   * andamento da música (a ilha estima o BPM) e soltam notinhas musicais nas batidas fortes.
   */
  nivelMusica(v) {
    const agora = performance.now();
    const m = this.musica || (this.musica = { y: 0, vy: 0, fase: 0, periodo: 520, amp: 0, brilho: 0, media: 0.2, ant: 0, ultBatida: 0, ultNota: 0, intervalos: [] });
    m.media = m.media * 0.93 + v * 0.07;
    m.brilho = Math.max(v, m.brilho * 0.85);
    const subiu = v - m.ant;
    m.ant = v;
    m.ultimoNivel = agora;
    if (v > 0.08 && subiu > 0.05 && v > m.media * 1.18 && agora - m.ultBatida > 260) {
      const intervalo = agora - m.ultBatida;
      if (intervalo < 1200) {
        m.intervalos.push(intervalo);
        if (m.intervalos.length > 8) m.intervalos.shift();
        const ord = [...m.intervalos].sort((x, y) => x - y);
        m.periodo = Math.min(900, Math.max(300, ord[Math.floor(ord.length / 2)]));
      }
      m.ultBatida = agora;
      const forca = Math.min(1, 0.4 + v);
      m.vy += 1.9 * forca;           // aceno pra baixo; a mola traz de volta
    }
    if (!this.ritmoLigado) {
      this.ritmoLigado = true;
      for (const g of this.grupos) g.classList.add('com-ritmo');
      let antes = performance.now();
      const passo = (t) => {
        if (!this.ritmoLigado) return;
        const dt = Math.min(50, t - antes); antes = t;
        const k = dt / 16.7;
        // mola amortecida: desce na batida e volta macio, com um leve "quique"
        m.vy = (m.vy - m.y * 0.16 * k) * Math.pow(0.8, k);
        m.y += m.vy * k;
        // balanço: um lado por batida, seguindo o andamento; mais forte quando a música está animada
        m.fase += (dt / m.periodo) * Math.PI;
        const animada = performance.now() - m.ultBatida < 1500 ? 1 : 0.35;
        m.amp += (animada - m.amp) * 0.03 * k;
        m.brilho *= Math.pow(0.97, k);
        const balanco = Math.sin(m.fase);
        for (const g of this.grupos) {
          g.style.setProperty('--y', Math.max(-1, Math.min(3, m.y)).toFixed(2));
          g.style.setProperty('--giro', (balanco * 7 * m.amp).toFixed(2));
          g.style.setProperty('--lado', (balanco * 1.2 * m.amp).toFixed(2));
          g.style.setProperty('--brilho', Math.min(1, m.brilho * 1.4).toFixed(2));
        }
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }
    clearTimeout(this.semRitmo);
    this.semRitmo = setTimeout(() => {
      this.ritmoLigado = false;
      for (const g of this.grupos) {
        g.classList.remove('com-ritmo');
        for (const p of ['--y', '--giro', '--lado', '--brilho']) g.style.removeProperty(p);
      }
    }, 1500);
  }

  /** Uma notinha ♪ sobe e some ao lado dos olhinhos (só nos que estão aparecendo) */
  soltarNota() {
    for (const g of this.grupos) {
      if (!g.getBoundingClientRect().width) continue;
      const n = document.createElement('span');
      n.className = 'nota-musical';
      n.textContent = Math.random() < 0.5 ? '♪' : '♫';
      // no notch (colado no topo) sobe para a esquerda, longe do nome da música; solta, para os lados
      const ilhaEl = g.closest('.ilha');
      const colada = ilhaEl?.classList.contains('colada');
      if (ilhaEl?.classList.contains('discreta')) {
        // notch pequenininho: a notinha pula de um dos olhinhos para o lado, sem sair do notch
        const direita = Math.random() < 0.5;
        n.classList.add('nota-discreta', direita ? 'dir' : 'esq');
        n.style.setProperty('--dx', ((direita ? 1 : -1) * (3 + Math.random() * 2)).toFixed(1) + 'px');
      } else {
        n.style.setProperty('--dx', (colada ? -(5 + Math.random() * 4) : 8 + Math.random() * 10).toFixed(1) + 'px');
      }
      n.style.setProperty('--rot', (Math.random() * 40 - 20).toFixed(0) + 'deg');
      n.addEventListener('animationend', () => n.remove());
      g.appendChild(n);
      setTimeout(() => n.remove(), 2000);
    }
  }

  /** Humor de fundo: continua até ser trocado */
  /** Liga/desliga o jeito "em chamada" dos olhinhos */
  centralizar() {
    for (const g of this.grupos) { g.style.setProperty('--ox', '0px'); g.style.setProperty('--oy', '0px'); }
  }

  definirChamada(sim) {
    this.emChamada = !!sim;
    if (sim) { this.dormindo = false; this.temporario = null; clearTimeout(this.timeoutTemp); this.centralizar(); }
    else if (this.cursor) this.olharPara(this.cursor.x, this.cursor.y);
    this.aplicar();
  }

  definirBase(humor) {
    this.base = humor;
    this.aplicar();
    // Notinhas: saem o tempo todo enquanto toca música, mesmo sem o medidor de som
    // (no ritmo da música quando ele funciona; senão, ~1 por segundo)
    if (humor === 'musica' && !this.timerNotas) {
      const proxima = () => {
        const periodo = this.musica?.periodo || 520;
        const ms = Math.max(650, Math.min(1500, periodo * 2)) * (0.8 + Math.random() * 0.5);
        this.timerNotas = setTimeout(() => {
          if (this.base !== 'musica') { this.timerNotas = null; return; }
          if (!this.temporario && !this.dormindo && !this.emChamada) this.soltarNota();
          proxima();
        }, ms);
      };
      proxima();
    } else if (humor !== 'musica' && this.timerNotas) {
      clearTimeout(this.timerNotas);
      this.timerNotas = null;
    }
  }

  /** Humor passageiro: volta ao de fundo depois de `ms` */
  reagir(humor, ms = 1600) {
    this.acordar(false);
    clearTimeout(this.timeoutTemp);
    this.temporario = humor;
    this.aplicar();
    this.timeoutTemp = setTimeout(() => {
      this.temporario = null;
      this.aplicar();
    }, ms);
  }

  /** Posição do mouse relativa à janela da ilha (vem do processo principal) */
  seguir(pos) {
    const mexeu = !this.cursor || Math.abs(pos.x - this.cursor.x) + Math.abs(pos.y - this.cursor.y) > 2;
    this.cursor = pos;
    if (!mexeu) return;
    this.ultimoMovimento = Date.now();
    this.bocejou = false;
    if (this.dormindo) this.acordar(true);
    this.conferirSacudida(pos);
    this.conferirCarinho(pos);
    if (this.temporario === 'tonto') return; // tonto não consegue seguir nada
    this.olharPara(pos.x, pos.y);
  }

  olharPara(x, y) {
    // em ligação os olhinhos ficam quietinhos dentro do fone (não seguem o mouse)
    if (this.emChamada) { this.centralizar(); return; }
    for (const g of this.grupos) {
      const r = g.getBoundingClientRect();
      if (!r.width) continue; // grupo escondido
      const dx = x - (r.left + r.width / 2);
      const dy = y - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      // Quanto mais perto, mais "vesgo" para o lado do cursor; longe, só a direção
      const forca = Math.min(1, dist / 160);
      g.style.setProperty('--ox', ((dx / dist) * 2.6 * forca).toFixed(2) + 'px');
      g.style.setProperty('--oy', ((dy / dist) * 2.0 * forca).toFixed(2) + 'px');
    }
  }

  /** Parado há um tempo: olha para pontos aleatórios, como quem está distraído */
  vaguear() {
    if (this.dormindo || Date.now() - this.ultimoMovimento < 4000 || Date.now() < this.olhandoAte) return;
    if (Math.random() < 0.45) {
      const x = window.innerWidth * (0.2 + Math.random() * 0.6);
      const y = Math.random() < 0.5 ? 400 : -100;
      this.olharPara(x, y);
    }
  }

  agendarPiscada() {
    const espera = 2200 + Math.random() * 4200;
    setTimeout(() => {
      if (!this.dormindo) {
        this.piscar();
        if (Math.random() < 0.2) setTimeout(() => this.piscar(), 260); // piscada dupla
      }
      this.agendarPiscada();
    }, espera);
  }

  piscar() {
    for (const g of this.grupos) g.classList.add('piscar');
    setTimeout(() => this.grupos.forEach((g) => g.classList.remove('piscar')), 130);
  }

  vigiarSono() {
    // curtindo música ninguém dorme
    const ocioso = Date.now() - this.ultimoMovimento > SONO_MS && this.base !== 'musica';
    const podeDormir = this.base === 'normal' && !this.temporario;
    if (ocioso && podeDormir && !this.dormindo) {
      this.dormindo = true;
      this.dormiuEm = Date.now();
      this.aplicar();
    }
  }

  acordar(comSusto) {
    if (!this.dormindo) return;
    this.dormindo = false;
    this.ultimoMovimento = Date.now();
    // dormiu bastante: acorda se espreguiçando; cochilo curto: acorda num susto
    if (comSusto && Date.now() - (this.dormiuEm || 0) > 10 * 60 * 1000) this.fazer('espreguicar');
    else if (comSusto) this.reagir('surpreso', 700);
    else this.aplicar();
  }
}
