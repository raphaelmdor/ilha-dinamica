// Decide se o app em primeiro plano é um jogo (para a ilha sumir durante a partida).
const path = require('path');
const { execFile } = require('child_process');

// Jogos que a própria Xbox Game Bar do Windows já reconheceu neste PC
let listaGameBar = new Set();

function carregarGameBar(log = () => {}) {
  if (process.platform !== 'win32') return;
  execFile('reg.exe', ['query', 'HKCU\\System\\GameConfigStore\\Children', '/s', '/v', 'MatchedExeFullPath'],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }, (erro, saida) => {
      if (erro && !saida) { log('Lista de jogos da Game Bar indisponível'); return; }
      const nova = new Set();
      for (const linha of String(saida).split(/\r?\n/)) {
        const m = linha.match(/MatchedExeFullPath\s+REG_SZ\s+(.+)$/i);
        if (m) nova.add(m[1].trim().toLowerCase());
      }
      listaGameBar = nova;
      log(`Jogos conhecidos pela Game Bar: ${nova.size}`);
    });
}

// Pastas típicas de lojas e launchers de jogos
const PASTAS_DE_JOGOS = [
  /\\steamapps\\common\\/i, /\\epic games\\/i, /\\riot games\\/i, /\\xboxgames\\/i,
  /\\battle\.net\\/i, /\\blizzard( entertainment)?\\/i, /\\ea games\\/i, /\\electronic arts\\/i,
  /\\ubisoft( game launcher)?\\games\\/i, /\\gog galaxy\\games\\/i, /\\gog games\\/i,
  /\\rockstar games\\/i, /\\program files\\windowsapps\\.*(game|xbox)/i, /\\minecraft/i,
  /\\roblox\\versions\\/i, /\\garena\\/i, /\\wargaming/i, /\\hoyoplay\\games\\/i, /\\genshin impact/i,
];

// Apps que nunca são jogo, mesmo em tela cheia (vídeos, apresentações, navegador...)
const NUNCA_JOGO = new Set([
  'chrome.exe', 'msedge.exe', 'firefox.exe', 'opera.exe', 'opera_gx.exe', 'brave.exe', 'vivaldi.exe',
  'vlc.exe', 'mpc-hc64.exe', 'mpc-be64.exe', 'potplayermini64.exe', 'wmplayer.exe', 'video.ui.exe',
  'microsoft.media.player.exe', 'spotify.exe', 'netflix.exe', 'claude.exe', 'code.exe', 'explorer.exe',
  'powerpnt.exe', 'excel.exe', 'winword.exe', 'acrobat.exe', 'resolve.exe', 'photoshop.exe', 'obs64.exe',
  'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'riotclientux.exe', 'battle.net.exe',
  'eadesktop.exe', 'upc.exe', 'galaxyclient.exe', 'discord.exe', 'whatsapp.exe', 'teams.exe', 'ms-teams.exe',
]);

/**
 * @param {{modo:string, exe:string, protegido:boolean, d3d:boolean}} info
 * @param {{jogosExtras?:string[], naoJogos?:string[]}} config
 * @returns {{jogo:boolean, motivo:string}}
 */
function ehJogo(info, config = {}) {
  if (!info) return { jogo: false, motivo: '' };
  const exe = String(info.exe || '').toLowerCase();
  const nome = exe ? path.win32.basename(exe) : '';
  const extras = (config.jogosExtras || []).map((x) => x.toLowerCase());
  const nao = (config.naoJogos || []).map((x) => x.toLowerCase());

  if (nome && nao.includes(nome)) return { jogo: false, motivo: '' };
  if (nome && extras.includes(nome)) return { jogo: true, motivo: `${nome} (adicionado por você)` };
  if (info.d3d) return { jogo: true, motivo: 'tela cheia exclusiva (DirectX)' };
  if (info.modo !== 'cheia' && info.modo !== 'maximizada') return { jogo: false, motivo: '' };
  if (!exe) {
    // Anti-cheat (Valorant, etc.) bloqueia até a leitura do nome do processo
    return info.protegido && info.modo === 'cheia'
      ? { jogo: true, motivo: 'app em tela cheia protegido (anti-cheat)' }
      : { jogo: false, motivo: '' };
  }
  if (NUNCA_JOGO.has(nome)) return { jogo: false, motivo: '' };
  if (listaGameBar.has(exe)) return { jogo: true, motivo: `${nome} (Game Bar)` };
  if (PASTAS_DE_JOGOS.some((re) => re.test(exe))) return { jogo: true, motivo: `${nome} (pasta de jogos)` };
  return { jogo: false, motivo: '' };
}

module.exports = { carregarGameBar, ehJogo };
