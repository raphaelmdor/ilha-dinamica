// Serviços de "atividades ao vivo" e produtividade da ilha (processo principal)
const { app, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, execFileSync } = require('child_process');

let log = () => {};
function configurarLog(fn) { log = fn || log; }

// ---------------------------------------------------------------------------
// Downloads concluídos
// ---------------------------------------------------------------------------
const TEMPORARIOS = /\.(crdownload|part|partial|tmp|download|opdownload|!ut|aria2)$/i;

function vigiarDownloads(aoConcluir) {
  let pasta;
  try { pasta = app.getPath('downloads'); } catch { return; }
  const avisados = new Set();
  const pendentes = new Map();
  const conferir = (nome) => {
    if (!nome || nome.startsWith('.') || nome.startsWith('~') || TEMPORARIOS.test(nome) || /^desktop\.ini$/i.test(nome)) return;
    const caminho = path.join(pasta, nome);
    if (avisados.has(caminho)) return;
    clearTimeout(pendentes.get(caminho));
    // espera o tamanho parar de mudar (o arquivo terminou de ser gravado)
    let tamanhoAnterior = -1;
    const checar = () => {
      fs.stat(caminho, (erro, st) => {
        if (erro || !st.isFile()) { pendentes.delete(caminho); return; }
        if (st.size > 0 && st.size === tamanhoAnterior && Date.now() - st.mtimeMs < 10 * 60000) {
          pendentes.delete(caminho);
          avisados.add(caminho);
          aoConcluir({ nome, caminho, tamanho: st.size });
          return;
        }
        tamanhoAnterior = st.size;
        pendentes.set(caminho, setTimeout(checar, 1200));
      });
    };
    pendentes.set(caminho, setTimeout(checar, 800));
  };
  try {
    fs.watch(pasta, (_tipo, nome) => conferir(nome ? String(nome) : ''));
    log('Vigiando a pasta Downloads');
  } catch (e) { log('Não consegui vigiar Downloads:', e.message); }
}

// ---------------------------------------------------------------------------
// Privacidade: microfone e câmera em uso (o Windows registra quem está usando)
// ---------------------------------------------------------------------------
const BASE_CONSENT = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\';

function lerEmUso(recurso, ignorar) {
  return new Promise((resolve) => {
    execFile('reg.exe', ['query', BASE_CONSENT + recurso, '/s'], { windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }, (erro, saida) => {
      if (!saida) { resolve([]); return; }
      const apps = [];
      let chave = null; let inicio = 0; let fim = 0;
      const fechar = () => {
        if (chave && inicio > 0 && fim === 0) {
          const ultimo = chave.split('\\').pop();
          let nome = ultimo;
          if (/\\NonPackaged\\/i.test(chave)) nome = ultimo.split('#').pop();
          else nome = ultimo.split('_')[0].split('.').pop();
          const caminho = ultimo.replace(/#/g, '\\').toLowerCase();
          if (!ignorar.some((x) => caminho.endsWith(x))) apps.push(nome.replace(/\.exe$/i, ''));
        }
      };
      for (const linha of saida.split(/\r?\n/)) {
        if (/^HKEY_/i.test(linha)) { fechar(); chave = linha.trim(); inicio = 0; fim = 0; continue; }
        const m = linha.match(/^\s+LastUsedTime(Start|Stop)\s+REG_QWORD\s+0x([0-9a-f]+)/i);
        if (m) { const v = parseInt(m[2], 16); if (m[1] === 'Start') inicio = v; else fim = v; }
      }
      fechar();
      resolve([...new Set(apps)]);
    });
  });
}

function vigiarPrivacidade(aoMudar) {
  if (process.platform !== 'win32') return;
  // a própria ilha usa o microfone para a voz: não conta
  const ignorar = [path.basename(process.execPath).toLowerCase()];
  let anterior = '';
  setInterval(async () => {
    const [mic, cam] = await Promise.all([lerEmUso('microphone', ignorar), lerEmUso('webcam', ignorar)]);
    const atual = JSON.stringify({ mic, cam });
    if (atual !== anterior) { anterior = atual; aoMudar({ mic, cam }); }
  }, 2000);
}

// ---------------------------------------------------------------------------
// Agendas externas (Google, Apple/iCloud, Outlook): link no formato iCal, só leitura
// ---------------------------------------------------------------------------
function desdobrar(texto) {
  return texto.replace(/\r?\n[ \t]/g, ''); // linhas continuadas do ICS
}

function lerDataICS(valor, params) {
  const v = valor.trim();
  if (/^\d{8}$/.test(v) || /VALUE=DATE(?!-)/i.test(params)) {
    return { data: new Date(+v.slice(0, 4), +v.slice(4, 6) - 1, +v.slice(6, 8)), diaInteiro: true };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  const [, a, mes, d, h, mi, s, z] = m;
  if (z) return { data: new Date(Date.UTC(+a, +mes - 1, +d, +h, +mi, +s)), diaInteiro: false };
  // TZID: o Google usa o fuso da agenda; tratamos como horário local (caso mais comum no Brasil)
  return { data: new Date(+a, +mes - 1, +d, +h, +mi, +s), diaInteiro: false };
}

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function expandirRegra(inicio, regra, limiteFim) {
  const r = Object.fromEntries(regra.split(';').map((p) => p.split('=')));
  const freq = r.FREQ;
  const intervalo = Number(r.INTERVAL || 1);
  const ate = r.UNTIL ? (lerDataICS(r.UNTIL, '')?.data || limiteFim) : limiteFim;
  const max = r.COUNT ? Number(r.COUNT) : 500;
  const dias = r.BYDAY ? r.BYDAY.split(',').map((x) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(x.slice(-2))) : null;
  const datas = [];
  const fim = ate < limiteFim ? ate : limiteFim;
  let cursor = new Date(inicio);
  let n = 0;
  for (let guarda = 0; guarda < 2000 && cursor <= fim && n < max; guarda++) {
    if (freq === 'WEEKLY' && dias) {
      // percorre a semana do cursor
      const domingo = new Date(cursor); domingo.setDate(cursor.getDate() - cursor.getDay());
      for (const dw of dias.sort()) {
        const d = new Date(domingo); d.setDate(domingo.getDate() + dw);
        d.setHours(inicio.getHours(), inicio.getMinutes(), 0, 0);
        if (d >= inicio && d <= fim && n < max) { datas.push(d); n++; }
      }
      cursor.setDate(cursor.getDate() + 7 * intervalo);
    } else {
      datas.push(new Date(cursor)); n++;
      if (freq === 'DAILY') cursor.setDate(cursor.getDate() + intervalo);
      else if (freq === 'WEEKLY') cursor.setDate(cursor.getDate() + 7 * intervalo);
      else if (freq === 'MONTHLY') cursor.setMonth(cursor.getMonth() + intervalo);
      else if (freq === 'YEARLY') cursor.setFullYear(cursor.getFullYear() + intervalo);
      else break;
    }
  }
  return datas;
}

// De qual serviço é o link (para mostrar o nome certo na ilha)
function nomeDaAgenda(url) {
  const u = String(url).toLowerCase();
  if (u.includes('icloud.com')) return 'Apple';
  if (u.includes('google.com')) return 'Google';
  if (u.includes('outlook') || u.includes('office365') || u.includes('live.com')) return 'Outlook';
  return '';
}

function lerICS(texto, origem, fonte = '') {
  const linhas = desdobrar(texto).split(/\r?\n/);
  const eventos = [];
  const hoje = new Date();
  const de = new Date(hoje); de.setDate(de.getDate() - 30);
  const ate = new Date(hoje); ate.setDate(ate.getDate() + 120);
  let ev = null;
  for (const linha of linhas) {
    if (linha === 'BEGIN:VEVENT') { ev = {}; continue; }
    if (linha === 'END:VEVENT') {
      if (ev?.inicio && ev.titulo && ev.status !== 'CANCELLED') {
        const ocorrencias = ev.regra ? expandirRegra(ev.inicio.data, ev.regra, ate) : [ev.inicio.data];
        for (const d of ocorrencias) {
          if (d < de || d > ate) continue;
          eventos.push({
            id: `ics-${origem}-${ev.uid || ev.titulo}-${d.getTime()}`,
            data: iso(d),
            hora: ev.inicio.diaInteiro ? null : `${pad(d.getHours())}:${pad(d.getMinutes())}`,
            titulo: ev.titulo,
            origem: 'google', // compromisso externo, só leitura
            fonte,
          });
        }
      }
      ev = null;
      continue;
    }
    if (!ev) continue;
    const i = linha.indexOf(':');
    if (i < 0) continue;
    const [nome, ...params] = linha.slice(0, i).split(';');
    const valor = linha.slice(i + 1);
    if (nome === 'DTSTART') ev.inicio = lerDataICS(valor, params.join(';'));
    else if (nome === 'SUMMARY') ev.titulo = valor.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ').trim();
    else if (nome === 'RRULE') ev.regra = valor;
    else if (nome === 'UID') ev.uid = valor;
    else if (nome === 'STATUS') ev.status = valor.trim();
  }
  return eventos;
}

async function buscarAgendas(urls = []) {
  const todos = [];
  const erros = [];
  for (const [k, url] of urls.entries()) {
    try {
      const u = String(url).trim().replace(/^webcal:\/\//i, 'https://');
      if (!/^https:\/\//i.test(u)) { erros.push('link inválido'); continue; }
      const resp = await net.fetch(u);
      if (!resp.ok) { erros.push(`HTTP ${resp.status}`); continue; }
      const texto = await resp.text();
      if (!texto.includes('BEGIN:VCALENDAR')) { erros.push('não é um link de agenda (iCal)'); continue; }
      todos.push(...lerICS(texto, k, nomeDaAgenda(u)));
    } catch { erros.push('sem conexão'); }
  }
  log(`Agendas externas: ${todos.length} compromissos${erros.length ? ' | erros: ' + erros.join(', ') : ''}`);
  return { eventos: todos, erros };
}

// ---------------------------------------------------------------------------
// Cotações (para "100 dólares em reais" na busca)
// ---------------------------------------------------------------------------
let cotacoes = null;
async function atualizarCotacoes() {
  try {
    const r = await (await net.fetch('https://open.er-api.com/v6/latest/USD')).json();
    if (r?.rates?.BRL) { cotacoes = { base: 'USD', taxas: r.rates, quando: Date.now() }; log('Cotações atualizadas'); }
  } catch { /* sem internet: tenta de novo depois */ }
}
const lerCotacoes = () => cotacoes;

// ---------------------------------------------------------------------------
// "Não incomodar" durante o foco: pausa os banners de notificação do Windows
// ---------------------------------------------------------------------------
const CHAVE_NOTIF = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications';
function notificacoesLigadas() {
  try {
    const out = execFileSync('reg.exe', ['query', CHAVE_NOTIF, '/v', 'ToastEnabled'], { encoding: 'utf8', windowsHide: true });
    return !/0x0\b/.test(out);
  } catch { return true; } // sem o valor = ligadas
}
function definirNotificacoes(ligadas) {
  try {
    execFileSync('reg.exe', ['add', CHAVE_NOTIF, '/v', 'ToastEnabled', '/t', 'REG_DWORD', '/d', ligadas ? '1' : '0', '/f'], { windowsHide: true });
    log('Notificações do Windows:', ligadas ? 'ligadas' : 'pausadas (foco)');
    return true;
  } catch (e) { log('Não consegui mudar as notificações:', e.message); return false; }
}

module.exports = {
  configurarLog, vigiarDownloads, vigiarPrivacidade, buscarAgendas, lerICS,
  atualizarCotacoes, lerCotacoes, notificacoesLigadas, definirNotificacoes, nomeDaAgenda,
};
