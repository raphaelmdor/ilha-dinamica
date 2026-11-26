## Novidades da 5.9.0: comando de voz muito mais rápido e esperto

- **"Ilha, …" agora usa o Whisper:** no modo da palavra de ativação, a frase inteira vai para o reconhecimento preciso. Antes só o reconhecimento rápido, bem mais fraco, ouvia esses comandos.
- **Whisper sempre pronto:** ele liga assim que você começa a falar e fica com o modelo carregado. Antes recarregava 190 MB a cada comando.
- **Placa de vídeo:** quando o PC tem uma (NVIDIA, AMD ou Intel), o Whisper usa ela. Se não der, usa o processador sozinho.
- **Só a sua fala:** a ilha corta o silêncio do começo e do fim e processa só o tamanho da frase, não 30 segundos fixos.
- **Na hora:** comandos simples ("passar música", "pausar", "volume 50"…) que os dois reconhecedores rápidos entendem igual são executados sem esperar o Whisper.
- **Mais tolerante:** entende "passarmos", "pula essa", "pausei", "istim" (Steam), "zap" (WhatsApp), "insta" e outros jeitos de falar. Quando o Whisper ouve algo torto, a ilha procura o comando com o som mais parecido.
- **"Tlin":** um som baixinho avisa que a ilha começou a te ouvir.
- O log registra cada comando de voz com o tempo que levou.
