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
    const ocioso = Date.now() - this.ultimoMovimento > SONO_MS;
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
