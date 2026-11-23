# 🏝️ Ilha Dinâmica para Windows 11

Uma "Dynamic Island" no topo da tela do Windows, no estilo do iPhone: música, controles do sistema, widgets de
produtividade, busca e comandos de voz em português (offline).

**Baixar:** pegue o instalador mais recente em [Releases](https://github.com/raphaelmdor/ilha-dinamica/releases/latest).
Depois de instalada, a ilha se atualiza sozinha.

> O instalador não tem assinatura digital paga. Se o Windows mostrar "O Windows protegeu o computador",
> clique em **Mais informações › Executar assim mesmo**.

---


Uma "Dynamic Island" no topo da tela do Windows, no estilo do iPhone, que também funciona por **comandos de voz em português, offline**.

- **Compacta:** pílula com a hora, ou a música tocando (capa + equalizador), ou a contagem de um timer.
- **Expandida (passe o mouse ou clique para fixar):** capa, título e artista, controles ⏮ ⏯ ⏭, data, bateria (em notebooks), timer e botão de microfone.
- **Ouvindo:** onda animada que reage à sua voz e mostra a transcrição ao vivo.
- **Avisos:** confirmação de cada comando, fim de timer (com bipe e pulso), ajuda.
- **Responsiva:** acompanha a resolução e a escala da tela. Se a resolução ou o monitor mudarem, ela se reposiciona sozinha. O clique "atravessa" a área vazia em volta, então ela não atrapalha o que está atrás.

## Requisitos

- Windows 10 ou 11
- [Node.js](https://nodejs.org) 20 ou mais novo
- Microfone (para a voz)

## Como rodar

```bash
npm install
npm start
```

Na **primeira execução** o app baixa o modelo de voz em português (`vosk-model-small-pt-0.3`, ~31 MB) e guarda tudo na pasta de dados. Depois disso a voz funciona **sem internet**, e o áudio nunca sai do PC.

### Gerar o instalador (.exe)

```bash
npm run dist
```

O instalador vai para a pasta `dist/`.

## Atalhos

| Atalho | Ação |
|---|---|
| `Ctrl + Alt + Espaço` | Falar um comando (aperte de novo para cancelar) |
| `Ctrl + Alt + I` | Mostrar ou esconder a ilha |
| Clique na ilha | Fixar ou soltar a vista expandida |
| Ícone na bandeja | Menu com as opções |

## Comandos de voz

| Diga… | O que acontece |
|---|---|
| pausar · continuar · tocar | Play/pause na música ou vídeo atual |
| próxima · pular / anterior · voltar | Troca de faixa |
| aumentar volume · abaixa o volume em dez · mudo | Volume do Windows |
| timer de cinco minutos · me avisa em uma hora e meia | Timer com aviso na ilha + bipe + voz |
| cancelar timer | Cancela o timer |
| que horas são · que dia é hoje · bateria | Resposta na ilha e em voz |
| qual música está tocando | Diz o título e o artista |
| abrir calculadora / bloco de notas / navegador / spotify / configurações / gerenciador de tarefas… | Abre o app |
| pesquisar receita de bolo | Pesquisa no Google |
| tocar lo-fi no youtube | Pesquisa no YouTube |
| bloquear computador · tirar print | Bloqueia a tela / abre o recorte |
| esconder | Esconde a ilha (volta com Ctrl+Alt+I) |
| ajuda | Mostra a lista de comandos |

### Escuta contínua ("ilha, ...")

No menu da bandeja, ative **Escuta contínua**. Aí é só falar **"ilha, pausar"**, **"ilha, timer de dez minutos"**, ou só **"ilha"** e esperar a onda aparecer. O microfone fica aberto o tempo todo (o ícone de microfone do Windows aparece na barra), mas o processamento continua 100% local.

## Novidades da versão 3

### Painel com widgets (passe o mouse na ilha)
Deslize para os lados com as setas ‹ ›, as bolinhas, o touchpad ou a roda do mouse em cima do cabeçalho.

| Widget | O que faz |
|---|---|
| Início | Música, Wi-Fi, Bluetooth, mudo, modo escuro, volume, brilho e um resumo do dia |
| Agenda | Calendário com feriados nacionais. Clique num dia e digite "14:30 Dentista". Avisa 10 min antes e na hora |
| Tarefas | Lista de tarefas com check, salva sozinha |
| Foco | Pomodoro 25/5 com pausa longa a cada 4 sessões e contador do dia |
| Notas | Bloco de notas que salva sozinho |
| Clima | Agora e próximos 4 dias (Open-Meteo, sem cadastro) |
| Copiados | Histórico dos últimos textos copiados (só na memória) |
| Sistema | CPU, memória, disco C: e tempo ligado |

**Atividades ao vivo:** com o Pomodoro rodando ou um compromisso a menos de 15 min, a pílula mostra a contagem.

### Barra de busca — `Alt+Espaço`
Apps, arquivos, configurações do Windows, contas, sites e comandos ("volume 40", "brilho 70", desligar…).

### Configurações (engrenagem no painel ou menu do ícone)
Cores dos olhinhos, do relógio e de destaque; fundo; tamanho; formato dos olhos; relógio 12/24h e segundos;
abrir ao passar o mouse; modo notch e mini; atalhos (grave apertando as teclas); widgets ligados e ordem;
cidade do clima; tempos do Pomodoro; voz.

### Voz (novos comandos)
"nova tarefa comprar pão" · "anotar ligar pro João" · "marcar quinze horas reunião" · "começar foco" ·
"abrir agenda" · "volume em cinquenta" · "brilho setenta" · "ligar Wi-Fi" · "modo escuro"

Dados ficam em `%APPDATA%\ilha-dinamica\dados.json` (tarefas, agenda, notas).

## Novidades da versão 4

- **Volume e brilho no estilo iPhone:** ao mudar pelo teclado, a ilha mostra uma barrinha com a porcentagem.
- **Bandeja de arquivos:** arraste arquivos para a ilha (ela abre sozinha) e depois arraste de volta para qualquer app.
- **Download concluído:** aviso com Abrir, Pasta e Guardar na bandeja.
- **Privacidade:** pontinho laranja = algum app usando o microfone; verde = câmera.
- **Fone conectado:** aviso quando a saída de áudio muda para um fone.
- **Bateria (notebook):** avisos de carregador e bateria fraca (20%, 10%, 5%).
- **Música:** barra de progresso com tempo; clique na barra para pular.
- **Google Agenda:** cole o "Endereço secreto no formato iCal" em Configurações › Widgets.
- **Foco sem notificações:** o Pomodoro pausa os banners do Windows e devolve na pausa.
- **Favoritos:** página com até 8 apps de um clique.
- **Busca:** "100 dólares em reais", "50 euros", "10 km em milhas", "30 c em f", "1 gb em mb"…

## Gerar o instalador (.exe)

Dê duplo clique em `gerar-instalador.bat`. O instalador aparece na pasta `dist`. Instale, e a ilha passa a
abrir pelo atalho do Menu Iniciar/Área de Trabalho (o atalho antigo é substituído). Seus dados são mantidos.

## Personalizar

- **Novos comandos:** `src/renderer/intents.js` (o que reconhecer) e `executarFrase()` em `src/renderer/app.js` (o que fazer).
- **Novos apps para abrir:** acrescente na lista `APPS` de `src/main.js` **e** na de `intents.js`.
- **Visual (tamanhos, cores, animação):** `src/renderer/style.css`. A curva `--mola` controla o "quique" da animação.
- **Atalhos e palavra de ativação:** `config.json` na pasta de dados (menu da bandeja › *Abrir pasta de dados*). Reinicie o app depois de editar.

## Estrutura

```
src/
  main.js          janela transparente, bandeja, atalhos, servidor local, download do modelo
  preload.js       ponte segura entre a interface e o Electron
  media.ps1        lê a mídia tocando no Windows e envia play/pause/volume
  renderer/
    index.html     estrutura da ilha
    style.css      visual e animações
    app.js         estados da ilha, timer, bateria, execução dos comandos
    voice.js       microfone + reconhecimento Vosk + resposta falada
    intents.js     interpreta a frase falada
```

## Problemas comuns

- **"Microfone indisponível":** Configurações › Privacidade e segurança › Microfone › ative *Permitir que aplicativos da área de trabalho acessem o microfone*.
- **A voz não baixa (sem internet ou rede bloqueada):** baixe `vosk-model-small-pt-0.3.zip` em https://alphacephei.com/vosk/models e coloque o arquivo **sem descompactar** em `%APPDATA%\ilha-dinamica\modelo\`. Depois reabra o app.
- **Ela não reconhece bem:** fale perto do microfone e de forma natural. O modelo pequeno tem ~31 MB e erra mais em ambiente barulhento. Os comandos aceitam variações ("abaixa", "diminui", "mais baixo"…).
- **Não mostra a música:** o app usa o controle de mídia do Windows (o mesmo do painel de volume). Spotify, YouTube no Chrome/Edge e Media Player aparecem; alguns players antigos não.
- **Sem resposta em voz:** instale uma voz em português em Configurações › Hora e idioma › Fala. Ou desligue *Responder em voz* na bandeja.
- **Testar o visual no navegador:** sirva `src/renderer` em `http://127.0.0.1:41789` e, no console, use `testar("timer de dez segundos")`.
