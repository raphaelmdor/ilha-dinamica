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
    });
    this.reconhecedor.on('result', (msg) => this.aoResultado(msg.result.text || ''));

    this.analisador = this.contexto.createAnalyser();
    this.analisador.fftSize = 256;
    fonte.connect(this.analisador);

    // ScriptProcessor é antigo, mas é o que o vosk-browser aceita direto
    this.processador = this.contexto.createScriptProcessor(4096, 1, 1);
    this.processador.onaudioprocess = (e) => {
      if (this.escutandoComando || this.continua) {
        try { this.reconhecedor.acceptWaveform(e.inputBuffer); } catch { /* ignora */ }
      }
    };
    fonte.connect(this.processador);
    this.processador.connect(this.contexto.destination);
  }

  fecharMicrofone() {
    if (!this.microfone || this.continua || this.escutandoComando) return;
    this.processador?.disconnect();
    this.analisador?.disconnect();
    this.microfone.getTracks().forEach((t) => t.stop());
    this.reconhecedor?.remove();
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
    this.emitir('ouvindo', true);
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
    this.palavraAtivacao = (palavra || 'ilha').toLowerCase();
    this.continua = !!ativa;
    if (this.continua && this.pronta) {
      await this.abrirMicrofone();
    } else {
      this.fecharMicrofone();
    }
  }

  aoResultado(textoBruto) {
    const texto = textoBruto.trim();
    if (!texto) return;

    if (this.escutandoComando) {
      this.pararComando();
      this.emitir('comando', texto);
      return;
    }

    // Escuta contínua: só reage se a frase começar com a palavra de ativação
    if (this.continua) {
      const palavras = texto.split(' ');
      const idx = palavras.findIndex((p) => p === this.palavraAtivacao);
      if (idx === -1 || idx > 1) return; // aceita "ô ilha", "ei ilha"
      const resto = palavras.slice(idx + 1).join(' ').trim();
      if (resto) {
        this.emitir('comando', resto);
      } else {
        this.ouvirComando(); // disse só "ilha": espera o comando
      }
    }
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
