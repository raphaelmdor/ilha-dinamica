// Reconhecimento de voz offline (Vosk, modelo pequeno em português)
// O áudio nunca sai do computador.

/* global Vosk */

export class Voz extends EventTarget {
  constructor() {
    super();
    this.modelo = null;
    this.reconhecedor = null;
    this.contexto = null;
    this.microfone = null;
    this.analisador = null;
    this.processador = null;
    this.escutandoComando = false; // modo "fale agora"
    this.continua = false;         // escuta contínua com palavra de ativação
    this.palavraAtivacao = 'ilha';
    this.pronta = false;
    this.timeoutComando = null;
    this.gramatica = null;         // frases de comando conhecidas (melhora muito o acerto)
    this.comandos = null;          // 2º reconhecedor, limitado às frases de comando
    this.ultimoComando = '';
    this.anel = [];          // últimos ~10 s de áudio (modo "ilha …"), para o Whisper ouvir a frase inteira
    this.falaDesde = 0;      // quando começou a frase atual (modo "ilha …")
    this.despertador = null; // 3º reconhecedor: só procura a palavra "ilha" (rápido e certeiro)
    this.captura = null;     // gravando a frase depois do "ilha"
    this.ultimaCaptura = 0;
  }

  /** Reconhecedor que só conhece a palavra de ativação: percebe o "ilha" em fração de segundo */
  criarDespertador() {
    if (this.despertador || !this.modelo || !this.contexto) return;
    try {
      const p = this.palavraAtivacao;
      // palavras "vizinhas" entram na lista para não serem confundidas com o nome
      const vizinhas = ['filha', 'milha', 'trilha', 'ilhas', 'pilha', 'olha', 'ela', 'isso', 'aqui', 'agora'].filter((x) => x !== p);
      this.despertador = new this.modelo.KaldiRecognizer(this.contexto.sampleRate, JSON.stringify([p, ...vizinhas, '[unk]']));
      this.despertador.on('partialresult', (msg) => this.ouviuNome(msg.result.partial || ''));
      this.despertador.on('result', (msg) => this.ouviuNome(msg.result.text || ''));
    } catch (e) { console.warn('Despertador indisponível', e); this.despertador = null; }
  }

  ouviuNome(texto) {
    if (!this.continua || this.escutandoComando || this.captura) return;
    if (!texto.split(' ').includes(this.palavraAtivacao)) return;
    if (performance.now() - this.ultimaCaptura < 1500) return;
    // começou: guarda desde ~1 s antes (o "ilha" já está no áudio) e grava até você parar de falar
    const agora = performance.now();
    const antes = this.anel.filter((p) => p.t >= agora - 1600);
    const energias = this.anel.filter((p) => p.t < agora - 1600).map((p) => p.e).sort((a, b) => a - b);
    const fundo = energias.length ? energias[Math.floor(energias.length / 2)] : 0.004; // barulho de fundo (mediana)
    this.captura = {
      inicio: agora, pedacos: antes.map((p) => p.d), ultimaVoz: agora,
      limiar: Math.max(0.012, fundo * 2.2), falouDepois: false,
    };
    try { this.despertador.reset?.(); } catch { /* ignora */ }
    this.emitir('ativacao');
    this.emitir('ouvindo', true);
    this.emitir('preparar');
  }

  /** Cada pedaço de áudio durante a captura: termina quando você fica ~0,8 s em silêncio (ou 9 s no total) */
  seguirCaptura(dados, energia) {
    const c = this.captura;
    const agora = performance.now();
    c.pedacos.push(dados);
    if (energia > c.limiar) { c.ultimaVoz = agora; if (agora - c.inicio > 500) c.falouDepois = true; }
    const silencio = agora - c.ultimaVoz;
    const total = agora - c.inicio;
    if ((silencio > 850 && total > 900) || total > 9000) this.terminarCaptura();
  }

  terminarCaptura() {
    const c = this.captura;
    if (!c) return;
    this.captura = null;
    this.ultimaCaptura = performance.now();
    this.anel = [];
    this.falaDesde = 0;
    this.emitir('ouvindo', false);
    const taxa = this.contexto?.sampleRate || 48000;
    const audio = this.wav16k(c.pedacos, taxa);
    const vosk = this.ultimoParcialLivre || '';
    this.ultimoParcialLivre = '';
    const p = this.palavraAtivacao;
    const resto = vosk.split(' ').slice(Math.max(0, vosk.split(' ').indexOf(p) + 1)).join(' ').trim();
    this.palpiteComandos(c.pedacos).then((alternativa) => {
      this.emitir('comando', { texto: resto, alternativa, audio, ativacao: true, soNome: !c.falouDepois });
    });
  }

  /** Lista de frases que o reconhecedor de comandos aceita (comandos + nomes dos apps) */
  definirGramatica(frases) {
    this.gramatica = JSON.stringify([...new Set(frases)].concat('[unk]'));
    if (this.comandos) { try { this.comandos.remove(); } catch { /* ignora */ } this.comandos = null; }
    if (this.contexto) this.criarReconhecedorComandos();
  }

  criarReconhecedorComandos() {
    if (!this.gramatica || this.comandos || !this.contexto) return;
    try {
      this.comandos = new this.modelo.KaldiRecognizer(this.contexto.sampleRate, this.gramatica);
      this.comandos.on('partialresult', (msg) => { if (msg.result.partial) this.ultimoComando = msg.result.partial; });
      this.comandos.on('result', (msg) => {
        if (msg.result.text) this.ultimoComando = msg.result.text;
        if (this.esperaPalpite) this.esperaPalpite(msg.result.text || '');
      });
    } catch (e) { console.warn('Reconhecedor de comandos indisponível', e); this.comandos = null; }
  }

  emitir(tipo, detail) {
    this.dispatchEvent(new CustomEvent(tipo, { detail }));
  }

  async carregar(urlModelo) {
    this.emitir('status', { fase: 'carregando' });
    // 1ª vez: descompacta e guarda em cache (IndexedDB). Depois abre rápido.
    this.modelo = await Vosk.createModel(urlModelo);
    this.pronta = true;
    this.emitir('status', { fase: 'pronta' });
  }

  async abrirMicrofone() {
    if (this.microfone) return;
    this.microfone = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    this.contexto = new AudioContext();
    const fonte = this.contexto.createMediaStreamSource(this.microfone);

    this.reconhecedor = new this.modelo.KaldiRecognizer(this.contexto.sampleRate);
    this.reconhecedor.on('partialresult', (msg) => {
      const parcial = msg.result.partial;
      if (parcial && this.escutandoComando) this.emitir('parcial', parcial);
      if (parcial && this.captura) this.ultimoParcialLivre = parcial;
      // modo "ilha …": marca quando a frase começou e, se ela começa com "ilha", já liga o Whisper
      if (parcial && this.continua && !this.escutandoComando) {
        if (!this.falaDesde) this.falaDesde = performance.now();
        if (parcial.split(' ').slice(0, 3).includes(this.palavraAtivacao)) {
          if (!this.avisouPreparo) { this.avisouPreparo = true; this.emitir('preparar'); }
          this.emitir('parcial-ativacao', parcial);
        }
      }
    });
    this.reconhecedor.on('result', (msg) => this.aoResultado(msg.result.text || ''));
    this.criarReconhecedorComandos();
    this.criarDespertador();

    this.analisador = this.contexto.createAnalyser();
    this.analisador.fftSize = 256;
    fonte.connect(this.analisador);

    // ScriptProcessor é antigo, mas é o que o vosk-browser aceita direto
    this.processador = this.contexto.createScriptProcessor(4096, 1, 1);
    this.processador.onaudioprocess = (e) => {
      if (this.escutandoComando || this.continua) {
        try { this.reconhecedor.acceptWaveform(e.inputBuffer); } catch { /* ignora */ }
        // modo "ilha …": guarda os últimos ~10 s, procura o nome e, depois dele, grava a frase
        if (this.continua && !this.escutandoComando) {
          const dados = new Float32Array(e.inputBuffer.getChannelData(0));
          let soma = 0; for (let i = 0; i < dados.length; i++) soma += dados[i] * dados[i];
          const energia = Math.sqrt(soma / dados.length);
          if (this.captura) {
            this.seguirCaptura(dados, energia);
          } else {
            this.anel.push({ t: performance.now(), d: dados, e: energia });
            const limite = Math.ceil((10 * (this.contexto?.sampleRate || 48000)) / 4096);
            if (this.anel.length > limite) this.anel.splice(0, this.anel.length - limite);
            try { this.despertador?.acceptWaveform(e.inputBuffer); } catch { /* ignora */ }
          }
        }
        // guarda o áudio do comando para o Whisper (no máximo ~12 s)
        if (this.escutandoComando && this.gravacao && this.gravacao.length < 150) {
          this.gravacao.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        }
        if (this.escutandoComando && this.comandos) {
          try { this.comandos.acceptWaveform(e.inputBuffer); } catch { /* ignora */ }
        }
      }
    };
    fonte.connect(this.processador);
    this.processador.connect(this.contexto.destination);
  }

  /** Junta os pedaços gravados, reamostra para 16 kHz mono e monta um .wav (PCM 16 bits) */
  wav16k(pedacos, taxa) {
    const totalBruto = pedacos.reduce((n, p) => n + p.length, 0);
    const bruto = new Float32Array(totalBruto);
    let o = 0;
    for (const p of pedacos) { bruto.set(p, o); o += p.length; }
    // corta o silêncio do começo e do fim (o Whisper processa só a fala: mais rápido e sem "alucinar")
    const quadro = Math.round(taxa * 0.02);
    const energias = [];
    for (let i = 0; i + quadro <= totalBruto; i += quadro) {
      let soma = 0; for (let k = i; k < i + quadro; k++) soma += bruto[k] * bruto[k];
      energias.push(Math.sqrt(soma / quadro));
    }
    const pico = Math.max(0.0001, ...energias);
    const limiar = Math.max(0.008, pico * 0.12);
    let ini = energias.findIndex((e) => e > limiar);
    let fim = energias.length - 1 - [...energias].reverse().findIndex((e) => e > limiar);
    if (ini < 0) { ini = 0; fim = energias.length - 1; }
    const folga = Math.round(0.25 / 0.02); // 250 ms de folga de cada lado
    const a = Math.max(0, (ini - folga) * quadro);
    const b = Math.min(totalBruto, (fim + 1 + folga) * quadro);
    const junto = bruto.slice(a, b);
    const total = junto.length;
    // volume: deixa a fala alta e clara para o Whisper (você não precisa gritar)
    let picoAmostra = 0;
    for (let k = 0; k < total; k++) { const v = Math.abs(junto[k]); if (v > picoAmostra) picoAmostra = v; }
    const ganho = picoAmostra > 0.001 ? Math.min(12, 0.9 / picoAmostra) : 1;
    if (ganho > 1.05) for (let k = 0; k < total; k++) junto[k] *= ganho;
    const passo = taxa / 16000;
    const n = Math.floor(total / passo);
    const dados = new DataView(new ArrayBuffer(44 + n * 2));
    const esc = (pos, txt) => { for (let i = 0; i < txt.length; i++) dados.setUint8(pos + i, txt.charCodeAt(i)); };
    esc(0, 'RIFF'); dados.setUint32(4, 36 + n * 2, true); esc(8, 'WAVE'); esc(12, 'fmt ');
    dados.setUint32(16, 16, true); dados.setUint16(20, 1, true); dados.setUint16(22, 1, true);
    dados.setUint32(24, 16000, true); dados.setUint32(28, 32000, true); dados.setUint16(32, 2, true); dados.setUint16(34, 16, true);
    esc(36, 'data'); dados.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      // média do trecho (filtro simples contra chiado ao reduzir a taxa)
      const ini = Math.floor(i * passo); const fim = Math.min(total, Math.floor((i + 1) * passo));
      let soma = 0; for (let k = ini; k < fim; k++) soma += junto[k];
      const v = Math.max(-1, Math.min(1, soma / Math.max(1, fim - ini)));
      dados.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return dados.buffer;
  }

  fecharMicrofone() {
    if (!this.microfone || this.continua || this.escutandoComando) return;
    this.processador?.disconnect();
    this.analisador?.disconnect();
    this.microfone.getTracks().forEach((t) => t.stop());
    this.reconhecedor?.remove();
    try { this.comandos?.remove(); } catch { /* ignora */ }
    this.comandos = null;
    try { this.despertador?.remove(); } catch { /* ignora */ }
    this.despertador = null;
    this.captura = null;
    this.contexto?.close();
    this.microfone = this.contexto = this.reconhecedor = this.processador = this.analisador = null;
  }

  /** Nível do microfone (0–1) para a animação de onda */
  nivel() {
    if (!this.analisador) return 0;
    const dados = new Uint8Array(this.analisador.fftSize);
    this.analisador.getByteTimeDomainData(dados);
    let soma = 0;
    for (const v of dados) soma += ((v - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(soma / dados.length) * 4);
  }

  /** Começa a ouvir um comando (atalho, clique ou palavra de ativação) */
  async ouvirComando() {
    if (!this.pronta) throw new Error('O modelo de voz ainda não carregou');
    await this.abrirMicrofone();
    if (this.contexto.state === 'suspended') await this.contexto.resume();
    this.escutandoComando = true;
    this.ultimoComando = '';
    this.gravacao = [];
    this.emitir('ouvindo', true);
    this.emitir('preparar'); // liga o Whisper enquanto você fala
    this.reiniciarTimeout(8000);
  }

  reiniciarTimeout(ms) {
    clearTimeout(this.timeoutComando);
    this.timeoutComando = setTimeout(() => this.pararComando(true), ms);
  }

  pararComando(porTempo = false) {
    clearTimeout(this.timeoutComando);
    if (!this.escutandoComando) return;
    this.escutandoComando = false;
    this.emitir('ouvindo', false);
    if (porTempo) this.emitir('silencio');
    setTimeout(() => this.fecharMicrofone(), 300);
  }

  async definirContinua(ativa, palavra) {
    const nova = (palavra || 'ilha').toLowerCase();
    if (nova !== this.palavraAtivacao && this.despertador) { try { this.despertador.remove(); } catch { /* ignora */ } this.despertador = null; }
    this.palavraAtivacao = nova;
    this.continua = !!ativa;
    if (this.continua && this.pronta) {
      await this.abrirMicrofone();
      this.criarDespertador();
    } else {
      this.fecharMicrofone();
    }
  }

  aoResultado(textoBruto) {
    const texto = textoBruto.trim();
    if (!texto) return;

    if (this.escutandoComando) {
      // para de ouvir já, mas espera um instante o reconhecedor de comandos fechar a frase dele
      clearTimeout(this.timeoutComando);
      this.escutandoComando = false;
      this.emitir('ouvindo', false);
      const comandos = this.comandos;
      const fim = () => {
        const bruto = this.ultimoComando || '';
        const alternativa = /\[unk\]/.test(bruto) ? '' : bruto.trim();
        const audio = this.gravacao?.length ? this.wav16k(this.gravacao, this.contexto?.sampleRate || 48000) : null;
        this.gravacao = null;
        this.emitir('comando', { texto, alternativa, audio });
        this.fecharMicrofone();
      };
      if (comandos) { try { comandos.retrieveFinalResult(); } catch { /* ignora */ } setTimeout(fim, 300); } else fim();
      return;
    }

    // Escuta contínua: só reage se a frase começar com a palavra de ativação
    // (com o despertador ligado, quem cuida disso é ele; aqui é só a reserva)
    if (this.continua && (this.despertador || this.captura || performance.now() - this.ultimaCaptura < 3000)) {
      this.falaDesde = 0;
      return;
    }
    if (this.continua) {
      const desde = this.falaDesde;
      this.falaDesde = 0;
      this.avisouPreparo = false;
      const palavras = texto.split(' ');
      const idx = palavras.findIndex((p) => p === this.palavraAtivacao);
      if (idx === -1 || idx > 1) return; // aceita "ô ilha", "ei ilha"
      const resto = palavras.slice(idx + 1).join(' ').trim();
      if (resto) {
        // a frase inteira ("ilha passar a música") vai para o Whisper, e o reconhecedor de comandos dá um 2º palpite
        const pedacos = this.anel.filter((p) => !desde || p.t >= desde - 900).map((p) => p.d);
        this.anel = [];
        const audio = pedacos.length ? this.wav16k(pedacos, this.contexto?.sampleRate || 48000) : null;
        this.palpiteComandos(pedacos).then((alternativa) => {
          this.emitir('comando', { texto: resto, alternativa, audio, ativacao: true });
        });
      } else {
        this.anel = [];
        this.ouvirComando(); // disse só "ilha": espera o comando
      }
    }
  }

  /** Passa um trecho já gravado pelo reconhecedor de comandos (frases conhecidas) e devolve o palpite dele */
  palpiteComandos(pedacos) {
    return new Promise((resolve) => {
      const rec = this.comandos;
      if (!rec || !pedacos.length || !this.contexto) { resolve(''); return; }
      let feito = false;
      const terminar = (txt) => {
        if (feito) return;
        feito = true;
        this.esperaPalpite = null;
        const limpo = String(txt || '').replace(/\[unk\]/g, ' ').replace(/\s+/g, ' ').trim();
        resolve(limpo);
      };
      // a frase pode chegar em mais de um pedaço (pausa depois do "ilha"): junta todos
      const partes = [];
      let timerJunta = null;
      try {
        this.ultimoComando = '';
        this.esperaPalpite = (txt) => {
          if (txt) partes.push(txt);
          clearTimeout(timerJunta);
          timerJunta = setTimeout(() => terminar(partes.join(' ')), 150);
        };
        for (const d of pedacos) {
          const buf = new AudioBuffer({ length: d.length, sampleRate: this.contexto.sampleRate, numberOfChannels: 1 });
          buf.copyToChannel(d, 0);
          rec.acceptWaveform(buf);
        }
        rec.retrieveFinalResult();
      } catch { terminar(''); }
      setTimeout(() => terminar(partes.join(' ') || this.ultimoComando || ''), 700);
    });
  }
}

// Resposta falada com a voz pt-BR do Windows (Maria, Francisca, Antonio...)
let vozPt = null;
function escolherVoz() {
  const vozes = speechSynthesis.getVoices();
  vozPt = vozes.find((v) => v.lang === 'pt-BR' && /natural|online/i.test(v.name))
    || vozes.find((v) => v.lang === 'pt-BR')
    || vozes.find((v) => v.lang.startsWith('pt'))
    || null;
}
if ('speechSynthesis' in window) {
  escolherVoz();
  speechSynthesis.onvoiceschanged = escolherVoz;
}

export function falar(texto) {
  if (!('speechSynthesis' in window) || !texto) return;
  speechSynthesis.cancel();
  const fala = new SpeechSynthesisUtterance(texto);
  fala.lang = 'pt-BR';
  if (vozPt) fala.voice = vozPt;
  fala.rate = 1.05;
  speechSynthesis.speak(fala);
}
