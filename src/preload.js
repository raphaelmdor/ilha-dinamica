// Ponte segura entre a interface e o processo principal
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const CANAIS = ['whisper:status', 'nivel', 'config', 'tela', 'midia', 'modelo:status', 'voz:ativar', 'cursor', 'modoApp', 'sistema', 'lancador:abrir', 'lancador:fechar', 'copiados', 'teclado:fim', 'painel:alternar',
  'osd', 'saida', 'download', 'privacidade', 'agendas:recarregar', 'atualizacao', 'atualizado'];

// Qualquer erro da interface vai para o ilha-log.txt
window.addEventListener('error', (e) => ipcRenderer.send('erro-interface', `${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => ipcRenderer.send('erro-interface', `Promessa: ${e.reason?.stack || e.reason}`));

contextBridge.exposeInMainWorld('ilhaAPI', {
  on(canal, callback) {
    if (!CANAIS.includes(canal)) return;
    ipcRenderer.on(canal, (_evento, dados) => callback(dados));
  },
  interativo: (sim) => ipcRenderer.send('interativo', !!sim),
  acao: (acao) => ipcRenderer.invoke('acao', acao),
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  garantirModelo: () => ipcRenderer.invoke('modelo:garantir'),
  garantirWhisper: () => ipcRenderer.invoke('whisper:garantir'),
  transcrever: (wav) => ipcRenderer.invoke('voz:transcrever', wav),
  buscar: (texto) => ipcRenderer.invoke('lancador:buscar', texto),
  executarBusca: (id) => ipcRenderer.invoke('lancador:executar', id),
  iconeArquivo: (caminho) => ipcRenderer.invoke('lancador:icone', caminho),
  fecharBusca: () => ipcRenderer.send('lancador:fechar'),
  sistema: (cmd) => ipcRenderer.send('sistema', cmd),
  alternarTema: () => ipcRenderer.invoke('tema:alternar'),
  teclado: (sim) => ipcRenderer.send('teclado', !!sim),
  lerDados: () => ipcRenderer.invoke('dados:ler'),
  salvarDados: (chave, valor) => ipcRenderer.invoke('dados:salvar', chave, valor),
  clima: () => ipcRenderer.invoke('clima'),
  recursos: () => ipcRenderer.invoke('recursos'),
  copiar: (texto) => ipcRenderer.send('copiar', texto),
  limparCopiados: () => ipcRenderer.send('copiados:limpar'),
  abrirConfiguracoes: () => ipcRenderer.send('configuracoes:abrir'),
  salvarConfig: (parcial) => ipcRenderer.invoke('config:salvar', parcial),
  configPadrao: () => ipcRenderer.invoke('config:padrao'),
  agendas: () => ipcRenderer.invoke('agendas'),
  listarApps: () => ipcRenderer.invoke('apps:listar'),
  silenciarFoco: (sim) => ipcRenderer.send('foco:silenciar', !!sim),
  atualizarAgora: () => ipcRenderer.send('atualizar:agora'),
  arrastar: (caminho) => ipcRenderer.send('arrastar', caminho),
  // caminho real de um arquivo solto na ilha (arrastado do Explorador)
  caminhoDoArquivo: (arquivo) => { try { return webUtils.getPathForFile(arquivo); } catch { return ''; } },
});
