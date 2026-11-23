// Olhinhos da ilha: seguem o mouse, piscam e mudam de humor.
// Humores: normal, feliz, confuso, ouvindo, pensando, musica, surpreso, dormindo

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
  }

  aplicar() {
    const humor = this.temporario || (this.dormindo ? 'dormindo' : this.base);
    for (const g of this.grupos) g.dataset.humor = humor;
  }

  /**
   * Nível do som que está tocando (0–1, ~12x por segundo): a cabecinha balança devagar
   * de um lado pro outro a cada batida e dá um "sim" suave com a cabeça, como quem curte a música.
   */
  nivelMusica(v) {
    const agora = Date.now();
    this.media = this.media == null ? v : this.media * 0.92 + v * 0.08;
    const subiu = v - (this.anterior || 0);
    this.anterior = v;
    // batida: subida forte acima da média, no máximo ~3 por segundo
    if (v > 0.1 && subiu > 0.06 && v > this.media * 1.2 && agora - (this.ultimoPulo || 0) > 330) {
      this.ultimoPulo = agora;
      this.lado = -(this.lado || 1);
      this.impulso = Math.min(1, 0.55 + v);
      for (const g of this.grupos) g.style.setProperty('--giro', (this.lado * 5) + 'deg');
    }
    if (!this.ritmoLigado) {
      this.ritmoLigado = true;
      for (const g of this.grupos) g.classList.add('com-ritmo');
      const passo = () => {
        if (!this.ritmoLigado) return;
        this.impulso = (this.impulso || 0) * 0.86; // o "sim" volta suave
        const bob = (this.impulso || 0).toFixed(3);
        for (const g of this.grupos) g.style.setProperty('--bob', bob);
        requestAnimationFrame(passo);
      };
      requestAnimationFrame(passo);
    }
    clearTimeout(this.semRitmo);
    this.semRitmo = setTimeout(() => {
      this.ritmoLigado = false;
      for (const g of this.grupos) {
        g.classList.remove('com-ritmo');
        g.style.removeProperty('--bob');
        g.style.removeProperty('--giro');
      }
    }, 1500);
  }

  /** Humor de fundo: continua até ser trocado */
  definirBase(humor) {
    this.base = humor;
    this.aplicar();
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
    if (this.dormindo) this.acordar(true);
    this.olharPara(pos.x, pos.y);
  }

  olharPara(x, y) {
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
    if (this.dormindo || Date.now() - this.ultimoMovimento < 4000) return;
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
      this.aplicar();
    }
  }

  acordar(comSusto) {
    if (!this.dormindo) return;
    this.dormindo = false;
    this.ultimoMovimento = Date.now();
    if (comSusto) this.reagir('surpreso', 700);
    else this.aplicar();
  }
}
