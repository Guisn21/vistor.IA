// Vistorias CAIXA — PWA offline-first.
// Todos os dados ficam no aparelho (IndexedDB). O app não usa internet nem IA:
// o envio para outras plataformas é feito pelo usuário com o ZIP gerado.

const APP_VERSION = '0.7.3';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');

// ---------- Banco local (IndexedDB) ----------
// Arquivos são guardados como ArrayBuffer + tipo (mais estável no Safari do que Blob).
const DB_NAME = 'vistorias2', DB_VER = 1;
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('ops', { keyPath: 'id' });
      d.createObjectStore('vists', { keyPath: 'id' }).createIndex('opId', 'opId');
      d.createObjectStore('fotos', { keyPath: 'id' }).createIndex('vistId', 'vistId');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function store(name, mode = 'readonly') { return (await db()).transaction(name, mode).objectStore(name); }
const put = async (s, obj) => req((await store(s, 'readwrite')).put(obj));
const get = async (s, id) => req((await store(s)).get(id));
const del = async (s, id) => req((await store(s, 'readwrite')).delete(id));
const all = async s => req((await store(s)).getAll());
const byIndex = async (s, idx, key) => req((await store(s)).index(idx).getAll(key));
const fotosDe = async vistId => (await byIndex('fotos', 'vistId', vistId)).sort((a, b) => a.seq - b.seq);

// ---------- Utilidades ----------
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = iso => iso ? iso.split('-').reverse().join('/') : '';
const fmtTime = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const fmtDT = ms => new Date(ms).toLocaleString('pt-BR');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const toBlob = f => f ? new Blob([f.buf], { type: f.type }) : null;
const fmtDur = s => `${Math.floor(s / 60)}:${pad(Math.round(s % 60))}`;

// Numeração padronizada: Operação (nº) → Vistoria Vnn → Foto Fnnn → Áudio -A / Texto -T
const codVist = v => 'V' + pad(v.seq);
const codFoto = (v, f) => `${codVist(v)}-F${pad(f.seq, 3)}`;
// Nome de arquivo: "ddmmaaaa-hhmmss"
function stamp(ms) {
  const d = new Date(ms);
  return `${pad(d.getDate())}${pad(d.getMonth() + 1)}${d.getFullYear()}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function fileNames(fotos) {
  // "pic-ddmmaaaa-hhmmss.jpeg"; fotos tiradas no mesmo segundo recebem " (2)", " (3)"…
  const seen = {}, out = {};
  for (const f of fotos) {
    const b = stamp(f.tiradaEm); seen[b] = (seen[b] || 0) + 1;
    const base = seen[b] > 1 ? `${b} (${seen[b]})` : b;
    out[f.id] = { foto: `pic-${base}.jpeg`, audio: f.audio ? `aud-${base}.${audioExt(f.audio.type)}` : '' };
  }
  return out;
}

// Tamanho e qualidade fixos das fotos (limitam o tamanho do ZIP).
const FOTO = { maxSide: 3000, jpegQuality: 0.9 };

// ---------- UI base ----------
function toast(msg, ms = 3000) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
function setHeader(title, back, action) {
  $('#title').textContent = title;
  const b = $('#back');
  b.classList.toggle('hidden', !back);
  b.onclick = typeof back === 'function' ? back : () => { location.hash = back; };
  // Casa: em todas as telas, exceto a principal, volta direto para a tela principal.
  $('#home').classList.toggle('hidden', !back);
  const a = $('#hdrAction');
  a.classList.toggle('hidden', !action);
  if (action) { a.textContent = action.label; a.onclick = action.onClick; }
  document.body.classList.remove('capture');
}
$('#home').onclick = () => {
  if (recorder) return;
  // Na tela da foto, a vistoria fica pausada (tudo já está salvo no celular).
  if (document.body.classList.contains('capture')) toast('Vistoria pausada. Continue depois em "Continuar vistoria pausada".', 3500);
  location.hash = '#/';
};
const objURLs = [];
function url(blob) { const u = URL.createObjectURL(blob); objURLs.push(u); return u; }
function clearURLs() { while (objURLs.length) URL.revokeObjectURL(objURLs.pop()); }

// Janela flutuante. buttons: [{label, value, cls}]. Resolve com o value escolhido.
function dialog({ title, html = '', buttons }) {
  return new Promise(resolve => {
    const ov = document.createElement('div'); ov.className = 'overlay';
    ov.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><h3>${esc(title)}</h3><div>${html}</div>
      <div class="btns">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div></div>`;
    document.body.appendChild(ov);
    ov.querySelectorAll('[data-i]').forEach(el => el.onclick = () => {
      const b = buttons[+el.dataset.i];
      const fields = {}; ov.querySelectorAll('[data-field]').forEach(i => { fields[i.dataset.field] = i.value; });
      ov.remove(); resolve(typeof b.value === 'function' ? b.value(fields) : b.value);
    });
    setTimeout(() => ov.querySelector('input,textarea')?.focus(), 50);
  });
}
const NOTICE_LOCAL = 'Os dados das vistorias e as fotos ficam <b>somente neste celular</b>. O envio para outras plataformas (OneDrive, e-mail etc.) depende de você enviar manualmente o ZIP gerado.';

// Marca copiada do Curv.IA Generator (mesmo desenho e cores).
const LOGO = (size = 48) => `<svg width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
  <rect x="1" y="1" width="38" height="38" rx="9" fill="#005ca9"/>
  <rect x="7" y="15" width="6" height="15" rx="1.2" fill="#fff" fill-opacity=".95"/>
  <rect x="17" y="20" width="6" height="10" rx="1.2" fill="#fff" fill-opacity=".78"/>
  <rect x="27" y="24" width="6" height="6" rx="1.2" fill="#fff" fill-opacity=".6"/>
  <path d="M4,29 C12,24 18,14 30,8" fill="none" stroke="#f0b429" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M36.01,5.27 L29.6,11.48 L27.12,6.01 Z" fill="#f0b429"/></svg>`;
const ICON = {
  lupa: '<svg width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21"/></svg>',
  mic: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  lixeira: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  texto: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>',
  micP: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-label="áudio"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
  textoP: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-label="observação"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/></svg>',
  lapis: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>',
  baixar: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
};

// Ícones brancos sobre fundo preto nas miniaturas: áudio e observação escrita.
const tagsMiniatura = f => f.audio || f.obs ? `<span class="tags">${f.audio ? ICON.micP : ''}${f.obs ? ICON.textoP : ''}</span>` : '';

// ---------- Geolocalização ----------
// Um "watch" fica ativo enquanto a operação/vistoria está aberta, para a posição
// já estar pronta quando a foto voltar da câmera.
let geoWatch = null, lastFix = null, geoErr = null;
function startGeo() {
  if (!('geolocation' in navigator) || geoWatch !== null) return;
  geoWatch = navigator.geolocation.watchPosition(
    p => { lastFix = p; geoErr = null; },
    e => { geoErr = e; },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function stopGeo() { if (geoWatch !== null) navigator.geolocation.clearWatch(geoWatch); geoWatch = null; }
const freshFix = () => lastFix && Date.now() - lastFix.timestamp < 30000 ? lastFix : null;
function getPosition(timeout = 20000) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej({ code: 99 });
    navigator.geolocation.getCurrentPosition(p => { lastFix = p; res(p); }, rej, { enableHighAccuracy: true, maximumAge: 5000, timeout });
  });
}
function geoHelp(err) {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  if (!window.isSecureContext) return 'O app precisa ser aberto por um endereço https para usar a localização.';
  if (err?.code === 99) return 'Este navegador não oferece localização.';
  if (err?.code === 1) return ios
    ? 'A permissão de localização foi negada. No iPhone: Ajustes → Privacidade e Segurança → Serviços de Localização → ative e permita para o Safari (ou "Sites do Safari") com <b>Localização Precisa</b>. Depois toque em "Tentar novamente".'
    : 'A permissão de localização foi negada. No Android: toque no cadeado ao lado do endereço (ou em Configurações do site no Chrome) → Permissões → Localização → Permitir. Depois toque em "Tentar novamente".';
  if (err?.code === 2) return ios
    ? 'A localização do aparelho parece desligada. Ative em Ajustes → Privacidade e Segurança → Serviços de Localização.'
    : 'A localização do aparelho parece desligada. Puxe a barra de notificações e ative "Localização".';
  return 'Não foi possível obter a posição a tempo. Se estiver em local fechado, aproxime-se de uma janela ou área aberta e tente novamente.';
}
// Procura uma posição antes de abrir a câmera. Sem sinal, avisa que a foto vai sem coordenadas.
// Retorna 'ok' (com posição), 'semgps' (usuário escolheu continuar sem) ou false (voltou).
let ultimaFalhaGps = 0;
async function ensureGeo() {
  if (freshFix()) return 'ok';
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = '<div class="dialog"><h3>Verificando localização…</h3><p class="muted">Aguarde o GPS.</p></div>';
  document.body.appendChild(ov);
  // Se a última tentativa falhou há pouco (ex.: subsolo), espera menos antes de avisar.
  const espera = Date.now() - ultimaFalhaGps < 120000 ? 5000 : 12000;
  try { await getPosition(espera); ov.remove(); return 'ok'; }
  catch (err) {
    ov.remove(); ultimaFalhaGps = Date.now();
    const r = await dialog({ title: 'Sem sinal de GPS', html: `<p>A próxima foto será tirada <b>sem coordenadas</b>, porque não há sinal de GPS.</p><p class="muted small">${geoHelp(err)}</p>`,
      buttons: [{ label: 'Continuar', value: 'semgps' }, { label: 'Voltar', value: false, cls: 'sec' }] });
    return r;
  }
}
function posToMeta(p) {
  const c = p.coords;
  return { lat: c.latitude, lon: c.longitude, precisao: c.accuracy, altitude: c.altitude, obtidoEm: p.timestamp };
}

// ---------- Bússola ----------
// Direção para onde a câmera traseira aponta, em graus a partir do norte magnético (sentido horário).
let heading = null, headingEm = 0, bussolaOn = false;
// Matriz de rotação do aparelho (W3C: Z-X'-Y''); a câmera traseira aponta para -Z do aparelho.
function headingDe(alpha, beta, gamma) {
  const r = Math.PI / 180, a = alpha * r, b = beta * r, g = gamma * r;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  const leste = -ca * sg - sa * sb * cg, norte = -sa * sg + ca * sb * cg;
  if (Math.hypot(leste, norte) < 0.3) return null; // câmera apontada quase na vertical: direção indefinida
  return (Math.atan2(leste, norte) / r + 360) % 360;
}
function onOrientacao(e) {
  let alpha = e.alpha;
  if (typeof e.webkitCompassHeading === 'number') alpha = 360 - e.webkitCompassHeading; // iPhone (não verificado em aparelho)
  else if (!e.absolute && e.type !== 'deviceorientationabsolute') return;
  if (alpha == null || e.beta == null || e.gamma == null) return;
  heading = headingDe(alpha, e.beta, e.gamma); headingEm = Date.now();
}
// No iPhone a permissão precisa ser pedida durante um toque; por isso é chamada no início dos botões.
function pedirBussola() {
  if (bussolaOn) return;
  const ligar = () => {
    if (bussolaOn) return; bussolaOn = true;
    if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientacao);
    else window.addEventListener('deviceorientation', onOrientacao);
  };
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    DeviceOrientationEvent.requestPermission().then(r => { if (r === 'granted') ligar(); }).catch(() => {});
  else ligar();
}
const headingAtual = () => heading !== null && Date.now() - headingEm < 3000 ? Math.round(heading) : null;
const PONTOS = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
const fmtDirecao = h => h == null ? '—' : `${PONTOS[Math.round(h / 45) % 8]} ${Math.round(h)}°`;

// ---------- Câmera ----------
// A câmera roda dentro do app: um toque no disparador salva a foto e abre a tela da foto.
// O botão "Câmera do celular" usa o seletor do sistema (mais recursos, mas com a tela de aceitar).
let pendingVistId = null, pendingSemGps = false;
function openCameraNow(vistId, semGps = false) {
  pedirBussola();
  location.hash = `#/camera/${vistId}${semGps ? '?semgps=1' : ''}`;
}
async function requestCamera(vistId) {
  pedirBussola();
  if (freshFix()) { openCameraNow(vistId); return true; }
  const g = await ensureGeo();
  if (!g) return false;
  openCameraNow(vistId, g === 'semgps');
  return true;
}
function cameraDoCelular(vistId, semGps) {
  pendingVistId = vistId; pendingSemGps = semGps;
  const inp = $('#camInput'); inp.value = ''; inp.click();
}
$('#camInput').onchange = async e => {
  const file = e.target.files[0], vistId = pendingVistId;
  if (!file || !vistId) return;
  // Direção não registrada: a bússola só seria lida depois que a foto volta do app da câmera.
  const tiradaEm = Date.now(), dir = null;
  // Posição no momento em que a foto voltou da câmera. Sem sinal, é salva sem coordenadas.
  let pos = freshFix();
  if (!pos && !pendingSemGps) {
    try { pos = await getPosition(8000); }
    catch (err) {
      const r = await dialog({ title: 'Sem sinal de GPS', html: `<p>Não há sinal de GPS agora. A foto será salva <b>sem coordenadas</b>.</p>`,
        buttons: [{ label: 'Salvar sem coordenadas', value: 'ok' }, { label: 'Descartar foto', value: 'discard', cls: 'danger' }] });
      if (r === 'discard') return;
    }
  }
  toast('Salvando foto…', 1500);
  try {
    const foto = await savePhoto(file, vistId, pos ? posToMeta(pos) : null, tiradaEm, dir);
    location.replace(`#/foto/${foto.id}`);
  } catch (err) { toast('Erro ao salvar a foto: ' + err.message, 6000); }
};

const cam = { stream: null, devices: [], idx: -1, semGps: false, vistId: null, ocupado: false };
function fecharCamera() {
  cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null;
}
async function abrirStream() {
  cam.stream?.getTracks().forEach(t => t.stop()); cam.stream = null;
  const dev = cam.devices[cam.idx];
  const video = { width: { ideal: 4096 }, height: { ideal: 3072 } };
  if (dev) video.deviceId = { exact: dev.deviceId }; else video.facingMode = { ideal: 'environment' };
  cam.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const v = $('#camVideo'); if (!v) return fecharCamera();
  v.srcObject = cam.stream; await v.play().catch(() => {});
  if (!cam.devices.length) {
    // Só depois da permissão os nomes das câmeras aparecem. Câmeras frontais ficam de fora.
    const todas = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    cam.devices = todas.filter(d => !/front|frontal|user|facetime|selfie/i.test(d.label));
    if (!cam.devices.length) cam.devices = todas;
    const atual = cam.stream.getVideoTracks()[0]?.getSettings().deviceId;
    cam.idx = Math.max(0, cam.devices.findIndex(d => d.deviceId === atual));
  }
  atualizarLente();
}
function atualizarLente() {
  const b = $('#camLente'); if (!b) return;
  b.classList.toggle('hidden', cam.devices.length < 2);
  const d = cam.devices[cam.idx];
  b.innerHTML = `Lente ${cam.idx + 1}/${cam.devices.length}${d?.label ? `<small>${esc(d.label.slice(0, 28))}</small>` : ''}`;
}
async function renderCamera(vistId, params) {
  const vist = await get('vists', vistId); if (!vist) return location.replace('#/');
  if (vist.status !== 'aberta') return location.replace('#/vistoria/' + vistId);
  const op = await get('ops', vist.opId), fotos = await fotosDe(vistId);
  if (cam.vistId !== vistId) { cam.semGps = false; cam.vistId = vistId; }
  if (params.get('semgps')) cam.semGps = true;
  const sair = async () => {
    const v = await get('vists', vistId), fs = await fotosDe(vistId);
    if (fs.length) return location.replace('#/foto/' + (fs.some(f => f.id === v.ultimaFotoId) ? v.ultimaFotoId : fs[fs.length - 1].id));
    if (!v.teveFotos) { await del('vists', vistId); toast('Vistoria sem fotos descartada.'); }
    location.replace('#/op/' + op.id);
  };
  setHeader(`${op.numero} · ${codVist(vist)}`, sair);
  document.body.classList.add('capture');
  startGeo();
  view.innerHTML = `<div class="cam">
    <div class="cam-top"><span id="camGps">GPS…</span><span id="camDir">🧭 —</span><button id="camLente" class="hidden"></button></div>
    <div class="cam-view"><video id="camVideo" playsinline muted autoplay></video><div class="cam-flash" id="camFlash"></div>
      <div class="cam-erro hidden" id="camErro"></div></div>
    <div class="cam-bottom">
      <div class="cam-row">
        <button class="cam-side" id="camNativa">Câmera do<br>celular</button>
        <button class="shutter" id="shutter" aria-label="Disparar"><span></span></button>
        <button class="cam-side" id="camGrade" ${fotos.length ? '' : 'disabled'}>▦ ${fotos.length}<br><small>fotos</small></button>
      </div></div></div>`;
  $('#camLente').onclick = async () => { cam.idx = (cam.idx + 1) % cam.devices.length; await iniciar(); };
  $('#camNativa').onclick = () => { pedirBussola(); cameraDoCelular(vistId, cam.semGps); };
  $('#camGrade').onclick = () => { location.hash = '#/grade/' + vistId; };
  $('#shutter').onclick = () => dispararFoto(vistId);
  // Indicadores de GPS e bússola
  const tick = setInterval(() => {
    if (!$('#camGps')) return clearInterval(tick);
    const f = freshFix();
    $('#camGps').textContent = f ? `GPS ±${Math.round(f.coords.accuracy)} m` : 'Sem sinal de GPS';
    $('#camGps').classList.toggle('sem', !f);
    $('#camDir').textContent = '🧭 ' + fmtDirecao(headingAtual());
  }, 500);
  async function iniciar() {
    try { $('#camErro').classList.add('hidden'); await abrirStream(); }
    catch (err) {
      const e = $('#camErro'); if (!e) return;
      e.classList.remove('hidden');
      e.innerHTML = `<p>Não foi possível abrir a câmera dentro do app.</p><p class="small">${esc(err.message || err.name)}</p>
        <p class="small">Permita o uso da câmera para este site nas configurações do navegador, ou use o botão "Câmera do celular".</p>`;
    }
  }
  await iniciar();
}
// Sem sinal de GPS no disparo: avisa uma vez; "Continuar" vale até o fim desta vistoria.
async function confirmarSemGps() {
  if (freshFix() || cam.semGps) return true;
  const r = await dialog({ title: 'Sem sinal de GPS', html: '<p>A próxima foto será tirada <b>sem coordenadas</b>, porque não há sinal de GPS.</p>',
    buttons: [{ label: 'Continuar', value: true }, { label: 'Voltar', value: false, cls: 'sec' }] });
  if (r) cam.semGps = true;
  return r;
}
function quadroAtual() {
  const v = $('#camVideo'); const c = document.createElement('canvas');
  c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0);
  return c;
}
async function dispararFoto(vistId) {
  if (cam.ocupado || !cam.stream) return;
  if (!(await confirmarSemGps())) return;
  cam.ocupado = true;
  const tiradaEm = Date.now(), pos = freshFix(), dir = headingAtual();
  const fl = $('#camFlash'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on');
  try {
    let blob = null;
    const track = cam.stream.getVideoTracks()[0];
    // Chrome/Android: ImageCapture tira a foto na resolução do sensor. Outros: quadro do vídeo.
    if ('ImageCapture' in window) { try { blob = await new ImageCapture(track).takePhoto(); } catch { blob = null; } }
    if (!blob) blob = await new Promise(res => quadroAtual().toBlob(res, 'image/jpeg', 0.95));
    const foto = await savePhoto(blob, vistId, pos ? posToMeta(pos) : null, tiradaEm, dir);
    location.replace('#/foto/' + foto.id);
  } catch (err) { toast('Erro ao salvar a foto: ' + err.message, 6000); }
  finally { cam.ocupado = false; }
}
// ---------- Imagem + EXIF ----------
function dataURLToBuf(d) {
  const bin = atob(d.split(',')[1]); const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a.buffer;
}
function bufToB64(buf) {
  const a = new Uint8Array(buf); let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
async function normalizeImage(file) {
  // Reencoda em JPEG com a orientação já aplicada e limita o lado maior
  // (o Safari do iOS limita o tamanho do canvas).
  const c = FOTO, img = new Image(), u = URL.createObjectURL(file);
  try {
    img.src = u; await img.decode();
    let w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, c.maxSide / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    const jpg = cv.toDataURL('image/jpeg', c.jpegQuality);
    const tk = Math.min(1, 320 / Math.max(w, h));
    const tc = document.createElement('canvas'); tc.width = Math.round(w * tk); tc.height = Math.round(h * tk);
    tc.getContext('2d').drawImage(cv, 0, 0, tc.width, tc.height);
    return { jpg, thumb: tc.toDataURL('image/jpeg', 0.75), w, h };
  } finally { URL.revokeObjectURL(u); }
}
async function savePhoto(file, vistId, geo, tiradaEm, direcao = null) {
  const fotos = await fotosDe(vistId);
  const seq = fotos.reduce((m, f) => Math.max(m, f.seq), 0) + 1;
  const { jpg, thumb, w, h } = await normalizeImage(file);
  const foto = { id: uid(), vistId, seq, tiradaEm, geo, direcao, largura: w, altura: h,
    jpg: { buf: dataURLToBuf(jpg), type: 'image/jpeg' }, thumb: { buf: dataURLToBuf(thumb), type: 'image/jpeg' },
    obs: '', audio: null };
  await put('fotos', foto);
  const v = await get('vists', vistId); Object.assign(v, { ultimaFotoId: foto.id, atualizadoEm: Date.now(), teveFotos: true }); await put('vists', v);
  return foto;
}
const toAscii = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, ' ');
function ucs2Bytes(s) { const o = []; for (const ch of String(s || '')) { const c = ch.charCodeAt(0); o.push(c & 255, c >> 8); } o.push(0, 0); return o; }
function deg2dms(x) { x = Math.abs(x); const d = Math.floor(x), mf = (x - d) * 60, m = Math.floor(mf); return [[d, 1], [m, 1], [Math.round((mf - m) * 60 * 10000), 10000]]; }
function exifDate(ms) { const d = new Date(ms); return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
// JPEG final com GPS, data/hora, código e observação gravados no EXIF.
function jpegWithExif(foto, op, vist) {
  const z = {}, ex = {}, gps = {}, G = piexif.GPSIFD, g = foto.geo;
  const desc = [`Operacao ${op.numero}`, op.empreendimento, `${codFoto(vist, foto)}`, `Vistoria ${fmtDate(vist.data)}`, foto.obs].filter(Boolean).join(' | ');
  z[piexif.ImageIFD.ImageDescription] = toAscii(desc).slice(0, 1800);
  z[piexif.ImageIFD.Software] = 'Vistor.IA Generator ' + APP_VERSION;
  z[piexif.ImageIFD.XPComment] = ucs2Bytes(desc.slice(0, 4000));
  ex[piexif.ExifIFD.DateTimeOriginal] = exifDate(foto.tiradaEm);
  ex[piexif.ExifIFD.DateTimeDigitized] = exifDate(foto.tiradaEm);
  gps[G.GPSVersionID] = [2, 3, 0, 0];
  if (foto.direcao != null) { gps[G.GPSImgDirectionRef] = 'M'; gps[G.GPSImgDirection] = [Math.round(foto.direcao * 100), 100]; }
  if (!g) return dataURLToBuf(piexif.insert(piexif.dump({ '0th': z, Exif: ex, ...(foto.direcao != null ? { GPS: gps } : {}) }), 'data:image/jpeg;base64,' + bufToB64(foto.jpg.buf)));
  gps[G.GPSLatitudeRef] = g.lat < 0 ? 'S' : 'N'; gps[G.GPSLatitude] = deg2dms(g.lat);
  gps[G.GPSLongitudeRef] = g.lon < 0 ? 'W' : 'E'; gps[G.GPSLongitude] = deg2dms(g.lon);
  if (typeof g.altitude === 'number') { gps[G.GPSAltitudeRef] = g.altitude < 0 ? 1 : 0; gps[G.GPSAltitude] = [Math.round(Math.abs(g.altitude) * 100), 100]; }
  if (typeof g.precisao === 'number') gps[G.GPSHPositioningError] = [Math.round(g.precisao * 100), 100];
  const t = new Date(g.obtidoEm || foto.tiradaEm);
  gps[G.GPSDateStamp] = `${t.getUTCFullYear()}:${pad(t.getUTCMonth() + 1)}:${pad(t.getUTCDate())}`;
  gps[G.GPSTimeStamp] = [[t.getUTCHours(), 1], [t.getUTCMinutes(), 1], [t.getUTCSeconds(), 1]];
  gps[G.GPSMapDatum] = 'WGS-84';
  const out = piexif.insert(piexif.dump({ '0th': z, Exif: ex, GPS: gps }), 'data:image/jpeg;base64,' + bufToB64(foto.jpg.buf));
  return dataURLToBuf(out);
}

// ---------- Áudio ----------
function pickAudioType() {
  if (!window.MediaRecorder) return null;
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
}
const audioExt = type => /mp4|m4a|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
let recorder = null;

// Abre o gravador e já começa a gravar (chamado no toque do microfone).
async function recordFor(foto) {
  const type = pickAudioType();
  if (type === null) return toast('Este navegador não grava áudio.', 5000);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (err) { return dialog({ title: 'Microfone indisponível', html: `<p class="muted">Permita o uso do microfone para este app nas configurações do navegador e tente de novo. (${esc(err.message)})</p>`, buttons: [{ label: 'OK', value: 1 }] }); }
  const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = []; const t0 = Date.now(); let keep = false;
  mr.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
  const ov = document.createElement('div'); ov.className = 'rec';
  ov.innerHTML = `<div class="dot"></div><div>Gravando áudio da foto ${pad(foto.seq, 3)}</div><div class="time">0:00</div>
    <button class="btn" id="recOk" style="max-width:320px">CONCLUIR</button>
    <button class="btn sec" id="recNo" style="max-width:320px">Descartar gravação</button>`;
  document.body.appendChild(ov);
  const timer = setInterval(() => { ov.querySelector('.time').textContent = fmtDur((Date.now() - t0) / 1000); }, 250);
  const done = new Promise(res => { mr.onstop = res; });
  ov.querySelector('#recOk').onclick = () => { keep = true; mr.stop(); };
  ov.querySelector('#recNo').onclick = () => { keep = false; mr.stop(); };
  mr.start(1000); recorder = mr;
  await done;
  clearInterval(timer); stream.getTracks().forEach(t => t.stop()); ov.remove(); recorder = null;
  if (!keep) return;
  const blob = new Blob(chunks, { type: mr.mimeType || type || 'audio/webm' });
  const f = await get('fotos', foto.id);
  Object.assign(f, { audio: { buf: await blob.arrayBuffer(), type: blob.type, duracao: (Date.now() - t0) / 1000 } });
  await put('fotos', f);
  toast('Áudio gravado e vinculado à foto.');
}

// ---------- Relatório DOCX e ZIP ----------
let docxLib;
async function buildDocx(op, vist, fotos, names) {
  docxLib ||= await import('./vendor/docx.mjs');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, PageOrientation, ShadingType, BorderStyle } = docxLib;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
  const borders = { top: border, bottom: border, left: border, right: border };
  const P = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text: String(text ?? ''), size: opts.size || 18, bold: opts.bold })], alignment: opts.align });
  const cell = (text, width, opts = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA }, borders,
    shading: opts.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'D9E2F3' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: String(text ?? '').split('\n').map(l => P(l, { bold: opts.head || opts.bold })),
  });
  // A4 paisagem: 16838 x 11906 DXA; margens de 720 → largura útil 15398.
  const W = 15398;
  const geral = [
    ['Operação', op.numero], ['Tomador', op.tomador], ['Empreendimento', op.empreendimento],
    ['Vistoria', `${codVist(vist)}${vist.identificacao ? ' — ' + vist.identificacao : ''}`],
    ['Data da vistoria', fmtDate(vist.data)],
    ['Fotos registradas', String(fotos.length)],
    ['Horário', fotos.length ? `${fmtTime(fotos[0].tiradaEm)} a ${fmtTime(fotos[fotos.length - 1].tiradaEm)}` : '—'],
  ];
  const tGeral = new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [3200, W - 3200],
    rows: geral.map(([k, v]) => new TableRow({ children: [cell(k, 3200, { head: true }), cell(v, W - 3200)] })) });
  const cols = [
    ['Código', 1150], ['Arquivo da foto', 2000], ['Horário', 950], ['Coordenadas (precisão)', 2000],
    ['Direção (bússola)', 1250], ['Áudio', 2300], ['Observação escrita', 0],
  ];
  cols[6][1] = W - cols.slice(0, 6).reduce((s, c) => s + c[1], 0);
  const rows = [new TableRow({ tableHeader: true, children: cols.map(([t, w]) => cell(t, w, { head: true })) })];
  for (const f of fotos) {
    const g = f.geo;
    const vals = [codFoto(vist, f), names[f.id].foto, fmtTime(f.tiradaEm),
      g ? `Lat ${g.lat.toFixed(6)}\nLon ${g.lon.toFixed(6)}\n(±${Math.round(g.precisao)} m)` : 'Sem coordenadas (sem sinal de GPS)',
      fmtDirecao(f.direcao), names[f.id].audio || '—', f.obs || '—'];
    rows.push(new TableRow({ cantSplit: true, children: vals.map((v, i) => cell(v, cols[i][1])) }));
  }
  const tFotos = new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: cols.map(c => c[1]), rows });
  const doc = new Document({
    creator: 'Vistor.IA Generator', styles: { default: { document: { run: { font: 'Arial' } } } }, title: `Relatório de vistoria ${op.numero} ${codVist(vist)}`,
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children: [
        new Paragraph({ children: [new TextRun({ text: 'RELATÓRIO FOTOGRÁFICO DE VISTORIA', bold: true, size: 28 })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }),
        tGeral,
        new Paragraph({ children: [new TextRun({ text: 'Registros fotográficos', bold: true, size: 22 })], spacing: { before: 300, after: 120 } }),
        tFotos,
        new Paragraph({ children: [new TextRun({ text: `Gerado por Vistor.IA Generator ${APP_VERSION} em ${fmtDT(Date.now())}. Coordenadas em WGS-84. Direção da câmera medida pela bússola do celular, em relação ao norte magnético; pode ter erro perto de estruturas metálicas. Os arquivos de foto e áudio citados e o mapa (.kml) estão no mesmo ZIP deste relatório.`, size: 16, italics: true })], spacing: { before: 200 } }),
      ],
    }],
  });
  return Packer.toBlob(doc);
}
// "1095345-v01-ddmmaaaa-Identificação.zip": operação só com os 7 primeiros dígitos, código da vistoria, data e identificação (se houver).
// Sem acentos: no teste, o Chromium trocou por "download" o nome de arquivo com acento.
const nomeArquivo = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 150);
const zipName = (op, vist) => nomeArquivo([op.numero.replace(/\D/g, '').slice(0, 7), codVist(vist).toLowerCase(),
  stamp(Date.parse(vist.data + 'T12:00')).slice(0, 8), vist.identificacao].filter(Boolean).join('-')) + '.zip';
// Mapa para o Google Earth: um marcador por foto com coordenadas; seta girada para a direção da câmera.
const xml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function buildKml(op, vist, fotos, names) {
  const marcas = fotos.filter(f => f.geo).map(f => {
    const g = f.geo, dir = f.direcao;
    const estilo = dir != null ? `<Style><IconStyle><heading>${dir}</heading><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/arrow.png</href></Icon></IconStyle></Style>` : '';
    const desc = [`Foto: ${names[f.id].foto}`, `Horário: ${fmtDT(f.tiradaEm)}`, `Precisão: ±${Math.round(g.precisao)} m`,
      `Direção: ${dir != null ? fmtDirecao(dir) + ' (norte magnético)' : 'não registrada'}`, f.audio ? `Áudio: ${names[f.id].audio}` : '', f.obs ? `Observação: ${f.obs}` : ''].filter(Boolean).join('\n');
    return `  <Placemark><name>${xml(codFoto(vist, f))}</name><description>${xml(desc)}</description>${estilo}<Point><coordinates>${g.lon},${g.lat},0</coordinates></Point></Placemark>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <name>${xml(`${op.numero} ${codVist(vist)} ${fmtDate(vist.data)}${vist.identificacao ? ' - ' + vist.identificacao : ''}`)}</name>
  <description>${xml(`${op.empreendimento} | ${op.tomador}. Setas: direção da câmera pela bússola do celular (norte magnético).`)}</description>
${marcas.join('\n')}
</Document></kml>
`;
}
async function buildZip(op, vist, fotos) {
  const names = fileNames(fotos);
  const zip = new JSZip();
  for (const f of fotos) {
    zip.file(names[f.id].foto, jpegWithExif(f, op, vist));
    if (f.audio) zip.file(names[f.id].audio, f.audio.buf);
  }
  const docx = await buildDocx(op, vist, fotos, names);
  zip.file(`Relatorio ${op.numero} ${codVist(vist)}.docx`, docx);
  zip.file(zipName(op, vist).replace(/\.zip$/, '.kml'), buildKml(op, vist, fotos, names));
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  return new File([blob], zipName(op, vist), { type: 'application/zip' });
}
function download(file) {
  // URL própria, liberada só depois de 2 min para não interromper o download.
  const u = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = u; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 120000);
}
async function share(file) {
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: file.name }); return true; }
    catch (e) { if (e.name === 'AbortError') return true; }
  }
  return false;
}

// ---------- Telas ----------
async function renderHome() {
  setHeader('Vistor.IA Generator', null);
  view.innerHTML = `
    <div class="brand">${LOGO(52)}<div><b>Vistor.IA Generator</b><div class="sub">Registro fotográfico de vistorias</div></div></div>
    <button class="btn big" id="cad">CADASTRAR OPERAÇÃO</button>
    <button class="btn big sec" id="sel">SELECIONAR OPERAÇÃO EXISTENTE</button>
    <div class="notice">${NOTICE_LOCAL}</div>
    <p class="muted small">Versão ${APP_VERSION}</p>`;
  $('#cad').onclick = () => { location.hash = '#/cadastro'; };
  $('#sel').onclick = () => { location.hash = '#/selecionar'; };
}

function maskNumero(v) {
  const d = v.replace(/\D/g, '').slice(0, 9);
  let o = d.slice(0, 4);
  if (d.length > 4) o += '.' + d.slice(4, 7);
  if (d.length > 7) o += '-' + d.slice(7, 9);
  return o;
}
// Cadastro de operação; com editId, edita uma operação existente.
async function renderCadastro(editId) {
  const ed = editId ? await get('ops', editId) : null;
  if (editId && !ed) return location.replace('#/');
  setHeader(ed ? 'Editar operação' : 'Cadastrar operação', ed ? '#/op/' + ed.id : '#/');
  view.innerHTML = `<div class="card">
    <label>Tomador *</label><input id="tom" maxlength="256" autocomplete="off" value="${esc(ed?.tomador || '')}">
    <label>Número da operação *</label><input id="num" inputmode="numeric" placeholder="0000.000-00" maxlength="11" autocomplete="off" value="${esc(ed?.numero || '')}">
    <label>Empreendimento *</label><input id="emp" maxlength="256" autocomplete="off" value="${esc(ed?.empreendimento || '')}">
    <div class="stack"><button class="btn" id="salvar">${ed ? 'Salvar alterações' : 'Salvar operação'}</button>${ed ? '<button class="btn sec" id="cancelarEd">Cancelar</button>' : ''}</div></div>
    ${ed ? '<p class="muted small">As alterações valem também para as vistorias já registradas desta operação e para os próximos ZIPs gerados. ZIPs já baixados não mudam.</p>' : ''}`;
  if (ed) $('#cancelarEd').onclick = () => location.replace('#/op/' + ed.id);
  $('#num').addEventListener('input', e => { e.target.value = maskNumero(e.target.value); });
  $('#salvar').onclick = async () => {
    const tomador = $('#tom').value.trim(), numero = $('#num').value, empreendimento = $('#emp').value.trim();
    if (!tomador || !empreendimento) return toast('Preencha tomador e empreendimento.');
    if (!/^\d{4}\.\d{3}-\d{2}$/.test(numero)) return toast('Número da operação incompleto (0000.000-00).');
    if ((await all('ops')).some(o => o.numero === numero && o.id !== ed?.id)) return toast('Já existe uma operação com esse número.', 4000);
    if (ed) { Object.assign(ed, { tomador, numero, empreendimento, atualizadoEm: Date.now() }); await put('ops', ed); toast('Operação atualizada.'); return location.replace('#/op/' + ed.id); }
    const op = { id: uid(), tomador, numero, empreendimento, vistSeq: 0, criadoEm: Date.now() };
    await put('ops', op);
    location.replace('#/op/' + op.id);
  };
}

async function renderSelecionar() {
  setHeader('Selecionar operação', '#/');
  const ops = (await all('ops')).sort((a, b) => a.numero.localeCompare(b.numero));
  view.innerHTML = `<input id="q" type="search" placeholder="Buscar por tomador, número ou empreendimento" autocomplete="off">
    <div id="res" style="margin-top:12px"></div>`;
  const draw = () => {
    const q = norm($('#q').value), qd = $('#q').value.replace(/\D/g, '');
    const list = ops.filter(o => !q || norm(o.tomador).includes(q) || norm(o.empreendimento).includes(q) || o.numero.includes(q) || (qd && o.numero.replace(/\D/g, '').includes(qd)));
    $('#res').innerHTML = list.length ? list.map(o => `<div class="card list-item" data-id="${o.id}">
      <div><b>${esc(o.numero)}</b><div>${esc(o.empreendimento)}</div><div class="muted small">${esc(o.tomador)}</div></div><button class="trash" data-del="${o.id}" aria-label="Excluir">${ICON.lixeira}</button></div>`).join('')
      : `<p class="muted">${ops.length ? 'Nenhuma operação encontrada.' : 'Nenhuma operação cadastrada.'}</p>`;
    $('#res').querySelectorAll('[data-id]').forEach(el => el.onclick = e => {
      if (e.target.closest('[data-del]')) return excluirOperacao(el.dataset.id);
      location.hash = '#/op/' + el.dataset.id;
    });
  };
  $('#q').addEventListener('input', draw); draw();
}

async function novaVistoria(op) {
  op = await get('ops', op.id);
  op.vistSeq = (op.vistSeq || 0) + 1; await put('ops', op);
  const v = { id: uid(), opId: op.id, seq: op.vistSeq, data: todayISO(), status: 'aberta', identificacao: '', criadoEm: Date.now(), atualizadoEm: Date.now() };
  await put('vists', v);
  return v;
}
async function renderOp(id) {
  const op = await get('ops', id); if (!op) return location.replace('#/');
  setHeader(op.numero, '#/selecionar');
  startGeo();
  const abertas = (await byIndex('vists', 'opId', id)).filter(v => v.status === 'aberta');
  view.innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div><b>${esc(op.numero)}</b><div>${esc(op.empreendimento)}</div><div class="muted small">${esc(op.tomador)}</div></div>
      <button class="edit" id="editarOp" aria-label="Editar operação">${ICON.lapis}</button></div>
    <button class="btn big" id="rapido">📷 INICIAR VISTORIA</button>
    <button class="btn big sec" id="pausada">CONTINUAR VISTORIA PAUSADA${abertas.length ? ` (${abertas.length})` : ''}</button>
    <button class="btn big sec" id="consultar">CONSULTAR VISTORIAS</button>`;
  $('#editarOp').onclick = () => { location.hash = '#/cadastro/' + op.id; };
  $('#rapido').onclick = async () => {
    pedirBussola();
    // Com posição recente, a câmera abre no mesmo toque.
    if (freshFix()) { const v = await novaVistoria(op); return openCameraNow(v.id); }
    const g = await ensureGeo();
    if (!g) return;
    const v = await novaVistoria(op);
    if (g === 'semgps') return openCameraNow(v.id, true);
    const opened = await requestCamera(v.id);
    if (!opened) { await del('vists', v.id); }
  };
  $('#pausada').onclick = async () => {
    if (!abertas.length) return toast('Não há vistorias pausadas nesta operação.');
    location.hash = '#/pausadas/' + id;
  };
  $('#consultar').onclick = () => { location.hash = '#/consulta/' + op.id; };
}

// Grade das fotos já tiradas durante a vistoria. Tocar numa foto volta à tela da foto, onde ela pode ser editada.
async function renderGrade(vistId) {
  const vist = await get('vists', vistId); if (!vist) return location.replace('#/');
  if (vist.status !== 'aberta') return location.replace('#/vistoria/' + vistId);
  const op = await get('ops', vist.opId), fotos = await fotosDe(vistId);
  const voltar = () => { location.hash = '#/foto/' + (vist.ultimaFotoId && fotos.some(f => f.id === vist.ultimaFotoId) ? vist.ultimaFotoId : fotos[fotos.length - 1]?.id); };
  setHeader(`${op.numero} · ${codVist(vist)} · fotos`, fotos.length ? voltar : '#/op/' + op.id);
  startGeo();
  view.innerHTML = `<p class="muted small">${fotos.length} foto(s) já tirada(s). Toque numa foto para abrir e editar a observação ou o áudio, ou para descartá-la.</p>
    <div class="grid">${fotos.map(f => `<button class="thumb" data-foto="${f.id}" aria-label="${codFoto(vist, f)}"><img src="${url(toBlob(f.thumb))}" alt="">
      ${tagsMiniatura(f)}<span class="cod">F${pad(f.seq, 3)}</span></button>`).join('')}</div>
    <div class="stack" style="margin-top:12px"><button class="btn" id="tirar">📷 PRÓXIMA FOTO</button>
      <button class="btn sec" id="gConcluir">CONCLUIR VISTORIA</button>
      <button class="btn danger" id="gCancelar">CANCELAR VISTORIA</button></div>`;
  view.querySelectorAll('[data-foto]').forEach(el => el.onclick = () => { location.hash = '#/foto/' + el.dataset.foto; });
  $('#tirar').onclick = () => requestCamera(vistId);
  $('#gConcluir').onclick = () => concluirVistoria(vistId);
  $('#gCancelar').onclick = () => cancelarVistoria(vist, op);
}
async function renderPausadas(opId) {
  const op = await get('ops', opId);
  setHeader('Vistorias pausadas', '#/op/' + opId);
  const abertas = (await byIndex('vists', 'opId', opId)).filter(v => v.status === 'aberta').sort((a, b) => b.atualizadoEm - a.atualizadoEm);
  const counts = await Promise.all(abertas.map(async v => (await byIndex('fotos', 'vistId', v.id)).length));
  view.innerHTML = abertas.length ? abertas.map((v, i) => `<div class="card list-item" data-id="${v.id}">
      <div><b>${codVist(v)} · ${fmtDate(v.data)}</b><div class="muted small">${counts[i]} foto(s) · última alteração ${fmtDT(v.atualizadoEm)}</div></div><span>›</span></div>`).join('')
    : '<p class="muted">Nenhuma vistoria pausada.</p>';
  view.querySelectorAll('[data-id]').forEach(el => el.onclick = () => continuarVistoria(el.dataset.id));
}
async function continuarVistoria(vistId) {
  const v = await get('vists', vistId);
  const fotos = await fotosDe(vistId);
  if (fotos.length) location.hash = '#/foto/' + (v.ultimaFotoId && fotos.some(f => f.id === v.ultimaFotoId) ? v.ultimaFotoId : fotos[fotos.length - 1].id);
  else requestCamera(vistId);
}

// --- Tela da foto (quadrantes) ---
async function renderFoto(id) {
  const foto = await get('fotos', id); if (!foto) return location.replace('#/');
  const vist = await get('vists', foto.vistId), op = await get('ops', vist.opId);
  const fotos = await fotosDe(vist.id);
  const idx = fotos.findIndex(f => f.id === id);
  if (vist.status !== 'aberta') return location.replace('#/vistoria/' + vist.id);
  setHeader(`${op.numero} · ${codVist(vist)}`, () => pausar(op), { label: 'Pausar', onClick: () => pausar(op) });
  document.body.classList.add('capture');
  startGeo();
  vist.ultimaFotoId = id; await put('vists', vist);
  view.innerHTML = `<div class="cap">
    <div class="cap-top">
      <button id="prev" ${idx <= 0 ? 'disabled style="opacity:.3"' : ''} aria-label="Foto anterior">‹</button>
      <span>${codFoto(vist, foto)} · ${fmtTime(foto.tiradaEm)} · ${foto.geo ? `±${Math.round(foto.geo.precisao)}&nbsp;m` : 'sem GPS'}</span>
      <button id="grade" class="grade-btn" aria-label="Ver fotos já tiradas">▦ ${fotos.length}</button>
      <button id="next" ${idx >= fotos.length - 1 ? 'disabled style="opacity:.3"' : ''} aria-label="Próxima foto já tirada">›</button>
    </div>
    <div class="cap-mid" id="mid"><div class="stage" id="stage">
      <img src="${url(toBlob(foto.jpg))}" alt="">
      <div class="zones" id="zones"></div>
    </div></div>
    <div class="cap-bar">
      <button class="btn proxima" id="proxima">📷 PRÓXIMA FOTO</button>
      <button class="btn danger" id="cancelar">CANCELAR VISTORIA</button>
      <button class="btn warn" id="descartar">DESCARTAR FOTO</button>
      <button class="btn sec" id="concluir">CONCLUIR VISTORIA</button>
    </div></div>`;
  fitStage(foto);
  await refreshZones(id);
  $('#prev').onclick = () => { if (idx > 0) location.replace('#/foto/' + fotos[idx - 1].id); };
  $('#next').onclick = () => { if (idx < fotos.length - 1) location.replace('#/foto/' + fotos[idx + 1].id); };
  $('#proxima').onclick = () => requestCamera(vist.id);
  $('#cancelar').onclick = () => cancelarVistoria(vist, op);
  $('#descartar').onclick = () => descartarFoto(foto, vist, op);
  $('#grade').onclick = () => { location.hash = '#/grade/' + vist.id; };
  $('#concluir').onclick = () => concluirVistoria(vist.id);
}
function fitStage(foto) {
  const mid = $('#mid'), st = $('#stage'); if (!mid || !st) return;
  const r = foto.largura / foto.altura, W = mid.clientWidth, H = mid.clientHeight;
  let w = W, h = W / r; if (h > H) { h = H; w = H * r; }
  st.style.width = w + 'px'; st.style.height = h + 'px';
}
window.addEventListener('resize', () => { if (currentFoto) fitStage(currentFoto); });
let currentFoto = null;
async function refreshZones(id) {
  const zones = $('#zones'); if (!zones) return;
  const f = await get('fotos', id); currentFoto = f;
  zones.innerHTML = `
    <div class="zone top" id="zLupa">${ICON.lupa}<span>Ampliar</span></div>
    <div class="zone ${f.audio ? 'done' : ''}" id="zMic">${ICON.mic}
      <span>${f.audio ? `Áudio ${fmtDur(f.audio.duracao || 0)} ✓<br><small>toque para opções</small>` : 'Gravar áudio'}</span>
      ${f.audio ? '<button class="play" id="play" aria-label="Ouvir">▶</button>' : ''}</div>
    <div class="zone ${f.obs ? 'done' : ''}" id="zTxt">${ICON.texto}<span>${f.obs ? 'Observação ✓<br><small>toque para editar</small>' : 'Observação'}</span></div>`;
  $('#zLupa').onclick = () => fullscreen(f);
  $('#zMic').onclick = async e => {
    if (e.target.closest('#play')) return;
    if (!f.audio) { await recordFor(f); return refreshZones(id); }
    // Já existe áudio: ouvir, gravar um novo (substitui o atual) ou excluir.
    const vist = await get('vists', f.vistId);
    const op = await dialog({ title: `Áudio — ${codFoto(vist, f)}`,
      html: `<p class="muted">Duração ${fmtDur(f.audio.duracao || 0)}</p><audio controls src="${url(toBlob(f.audio))}" style="width:100%"></audio>`,
      buttons: [{ label: '🎙 Gravar novo (substitui o atual)', value: 'novo' }, { label: 'Excluir áudio', value: 'excluir', cls: 'danger' }, { label: 'Voltar', value: null, cls: 'sec' }] });
    if (op === 'novo') { await recordFor(f); return refreshZones(id); }
    if (op === 'excluir') {
      const ok = await dialog({ title: 'Excluir áudio?', html: '<p>O áudio gravado para esta foto será apagado. A foto e a observação escrita continuam.</p>',
        buttons: [{ label: 'Excluir áudio', value: true, cls: 'danger' }, { label: 'Cancelar', value: false, cls: 'sec' }] });
      if (!ok) return;
      const g = await get('fotos', id); g.audio = null; await put('fotos', g);
      toast('Áudio excluído.'); refreshZones(id);
    }
  };
  $('#play')?.addEventListener('click', e => {
    e.stopPropagation();
    const a = new Audio(url(toBlob(f.audio))); a.play().catch(err => toast('Não foi possível tocar: ' + err.message));
  });
  $('#zTxt').onclick = async () => {
    const txt = await dialog({ title: `Observação — ${codFoto(await get('vists', f.vistId), f)}`,
      html: `<textarea data-field="obs" placeholder="Escreva observações sobre esta foto…">${esc(f.obs)}</textarea>`,
      buttons: [{ label: 'Salvar', value: x => x.obs }, { label: 'Cancelar', value: null, cls: 'sec' }] });
    if (txt === null) return;
    const g = await get('fotos', id); g.obs = txt.trim(); await put('fotos', g); refreshZones(id);
  };
}
// Tela cheia: qualquer toque volta; pinça para zoom.
function fullscreen(f) {
  const ov = document.createElement('div'); ov.className = 'full';
  ov.innerHTML = `<img src="${url(toBlob(f.jpg))}" alt="">`;
  document.body.appendChild(ov);
  const img = ov.firstElementChild;
  const pts = new Map(); let scale = 1, tx = 0, ty = 0, startDist = 0, startScale = 1, moved = false, last = null;
  const apply = () => { img.style.transform = `translate(${tx}px,${ty}px) scale(${scale})`; };
  ov.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); last = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; startDist = Math.hypot(a.x - b.x, a.y - b.y); startScale = scale; } });
  ov.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    const p = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) {
      pts.set(e.pointerId, p); const [a, b] = [...pts.values()];
      scale = Math.min(6, Math.max(1, startScale * Math.hypot(a.x - b.x, a.y - b.y) / startDist)); moved = true;
      if (scale === 1) { tx = 0; ty = 0; }
      apply();
    } else if (scale > 1) {
      tx += p.x - last.x; ty += p.y - last.y; if (Math.abs(p.x - last.x) + Math.abs(p.y - last.y) > 2) moved = true; apply();
      pts.set(e.pointerId, p);
    }
    last = p;
  });
  // Fecha no "click" (não no pointerup): se a tela cheia sumisse no pointerup, o
  // click seguinte cairia nas áreas de áudio/observação que ficam por baixo.
  let fechar = false;
  const up = e => {
    pts.delete(e.pointerId);
    if (pts.size === 0) { fechar = !moved; moved = false; }
  };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', e => pts.delete(e.pointerId));
  ov.addEventListener('click', e => { e.stopPropagation(); e.preventDefault(); if (fechar) ov.remove(); fechar = false; });
}
async function pausar(op) {
  if (recorder) return;
  toast('Vistoria pausada. Continue depois em "Continuar vistoria pausada".', 3500);
  location.hash = '#/op/' + op.id;
}
// Apaga só esta foto (com áudio e observação) e renumera as seguintes para não deixar lacuna.
async function descartarFoto(foto, vist, op) {
  if (recorder) return;
  const ok = await dialog({ title: `Descartar foto ${codFoto(vist, foto)}?`,
    html: '<p>Esta foto será apagada, junto com o áudio e a observação dela. As outras fotos da vistoria continuam.</p>',
    buttons: [{ label: 'SIM, DESCARTAR FOTO', value: true, cls: 'danger' }, { label: 'NÃO', value: false, cls: 'sec' }] });
  if (!ok) return;
  await del('fotos', foto.id);
  const resto = await fotosDe(vist.id);
  for (const f of resto) if (f.seq > foto.seq) { f.seq -= 1; await put('fotos', f); }
  const v = await get('vists', vist.id); v.atualizadoEm = Date.now();
  const alvo = resto.filter(f => f.seq < foto.seq).pop() || resto[0];
  v.ultimaFotoId = alvo ? alvo.id : null; await put('vists', v);
  toast('Foto descartada.');
  if (alvo) return location.replace('#/foto/' + alvo.id);
  // Era a única foto: a vistoria continua aberta, sem fotos.
  const r = await dialog({ title: 'Vistoria sem fotos', html: '<p>Esta vistoria não tem mais fotos. Ela continua aberta.</p>',
    buttons: [{ label: '📷 Tirar nova foto', value: 'foto' }, { label: 'Voltar para a operação', value: 'op', cls: 'sec' }] });
  if (r === 'foto' && freshFix()) return openCameraNow(vist.id);
  location.replace('#/op/' + op.id);
  if (r === 'foto') requestCamera(vist.id);
}
async function cancelarVistoria(vist, op) {
  const a = await dialog({ title: 'Cancelar vistoria?', html: '<p>Deseja cancelar a vistoria em andamento?</p>',
    buttons: [{ label: 'SIM', value: true, cls: 'danger' }, { label: 'NÃO', value: false, cls: 'sec' }] });
  if (!a) return;
  const n = (await byIndex('fotos', 'vistId', vist.id)).length;
  const b = await dialog({ title: 'Atenção', html: `<p>Todas as <b>${n} foto(s)</b> já tiradas nesta vistoria, com seus áudios e observações, serão perdidas. Confirma?</p>`,
    buttons: [{ label: 'SIM, CANCELAR VISTORIA', value: true, cls: 'danger' }, { label: 'NÃO', value: false, cls: 'sec' }] });
  if (!b) return;
  for (const f of await byIndex('fotos', 'vistId', vist.id)) await del('fotos', f.id);
  await del('vists', vist.id);
  toast('Vistoria cancelada.');
  location.replace('#/op/' + op.id);
}
async function concluirVistoria(vistId) {
  const vist = await get('vists', vistId); const op = await get('ops', vist.opId);
  const fotos = await fotosDe(vistId);
  if (!fotos.length) return toast('Nenhuma foto registrada.');
  const ident = await dialog({ title: 'Concluir vistoria',
    html: `<p><b>Empreendimento:</b> ${esc(op.empreendimento)}<br><b>Data da vistoria:</b> ${fmtDate(vist.data)}<br><b>${fotos.length}</b> foto(s) registrada(s)</p>
      <label>Identificação da vistoria (opcional)</label>
      <input data-field="ident" maxlength="256" placeholder="ex.: Medição 3, boletim 9, liberação de glosa" value="${esc(vist.identificacao)}">`,
    buttons: [{ label: 'CONFIRMAR CONCLUSÃO', value: x => x.ident }, { label: 'VOLTAR', value: null, cls: 'sec' }] });
  if (ident === null) return;
  Object.assign(vist, { identificacao: ident.trim(), status: 'concluida', concluidoEm: Date.now() }); await put('vists', vist);
  toast('Vistoria concluída. Baixe o ZIP quando quiser.', 3500);
  location.replace('#/vistoria/' + vistId);
}
// --- Consulta ---
// Consulta das vistorias de uma operação (aberta a partir da tela da operação): filtro só por data.
async function renderConsulta(opId) {
  const op = await get('ops', opId); if (!op) return location.replace('#/');
  setHeader('Consultar vistorias', '#/op/' + opId);
  const vists = await byIndex('vists', 'opId', opId);
  view.innerHTML = `<div class="card"><b>${esc(op.numero)}</b><div>${esc(op.empreendimento)}</div><div class="muted small">${esc(op.tomador)}</div></div>
    <div class="card">
      <div class="row2"><div><label>Data (de)</label><input id="fDe" type="date"></div><div><label>Data (até)</label><input id="fAte" type="date"></div></div>
      <div class="stack"><button class="btn sec" id="limpar">Limpar filtros</button></div></div>
    <div id="lista"></div>`;
  const draw = () => {
    const de = $('#fDe').value, ate = $('#fAte').value;
    const list = vists.filter(v => (!de || v.data >= de) && (!ate || v.data <= ate))
      .sort((a, b) => b.data.localeCompare(a.data) || b.criadoEm - a.criadoEm);
    $('#lista').innerHTML = list.length ? list.map(v => { return `<div class="card list-item" data-id="${v.id}">
      <div><b>${fmtDate(v.data)} · ${codVist(v)}</b>${v.identificacao ? `<div>${esc(v.identificacao)}</div>` : ''}</div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">${statusBadge(v)}<div style="display:flex;gap:8px">${v.status === 'concluida' && !v.dadosExcluidosEm ? `<button class="dl" data-dl="${v.id}" aria-label="Baixar ZIP">${ICON.baixar}</button>` : ''}<button class="trash" data-del="${v.id}" aria-label="Excluir">${ICON.lixeira}</button></div></div></div>`; }).join('') : '<p class="muted">Nenhuma vistoria encontrada.</p>';
    $('#lista').querySelectorAll('[data-id]').forEach(el => el.onclick = async e => {
      const v = vists.find(x => x.id === el.dataset.id);
      if (e.target.closest('[data-dl]')) return gerarZip(v.id);
      if (e.target.closest('[data-del]')) {
        if (await excluirVistoria(v.id)) { vists.splice(vists.indexOf(v), 1); draw(); }
        return;
      }
      if (v.dadosExcluidosEm) return avisoDadosExcluidos(v);
      location.hash = '#/vistoria/' + v.id;
    });
  };
  view.querySelectorAll('input').forEach(i => i.addEventListener('input', draw));
  $('#limpar').onclick = () => { view.querySelectorAll('.card input').forEach(i => { i.value = ''; }); draw(); };
  draw();
}
const statusBadge = v => v.status === 'aberta' ? '<span class="badge warn">pausada</span>'
  : v.dadosExcluidosEm ? '<span class="badge">dados excluídos</span>' : '<span class="badge ok">concluída</span>';
const avisoDadosExcluidos = v => dialog({ title: 'Dados excluídos',
  html: `<p>As fotos e os dados desta vistoria foram excluídos pelo usuário em ${fmtDT(v.dadosExcluidosEm)}.</p><p class="muted">Ficaram registrados apenas a operação, o empreendimento, o tomador, a data e a identificação da vistoria.</p>`,
  buttons: [{ label: 'OK', value: true }] });
async function excluirOperacao(opId) {
  const op = await get('ops', opId);
  const vs = await byIndex('vists', 'opId', opId);
  const ok = await dialog({ title: 'Excluir operação?',
    html: `<p>Deseja mesmo excluir a operação <b>${esc(op.numero)}</b> (${esc(op.empreendimento)}) e todos os seus dados e registros?</p>` +
      `<p><b>Todas as vistorias desta operação (${vs.length}) também serão excluídas</b>, com suas fotos, áudios e observações.</p><p class="muted">ZIPs já gerados e salvos fora do app não são afetados.</p>`,
    buttons: [{ label: 'Excluir operação', value: true, cls: 'danger' }, { label: 'Cancelar', value: false, cls: 'sec' }] });
  if (!ok) return false;
  for (const v of vs) await apagarVistoria(v.id);
  await del('ops', opId);
  toast('Operação excluída.'); route();
  return true;
}
async function excluirVistoria(vistId) {
  const v = await get('vists', vistId), op = await get('ops', v.opId);
  const ok = await dialog({ title: 'Excluir vistoria?',
    html: `<p>Deseja mesmo excluir a vistoria <b>${codVist(v)}</b> de ${fmtDate(v.data)} (${esc(op.numero)}) e todos os seus dados e registros?</p><p class="muted">ZIPs já gerados e salvos fora do app não são afetados.</p>
      ${v.status === 'concluida' && !v.dadosExcluidosEm ? `<div class="notice"><b>Quer só liberar espaço no celular?</b> Entre na vistoria e toque em "Excluir fotos e dados do celular". Assim fica guardado pelo menos o registro de que a vistoria foi realizada.</div>` : ''}`,
    buttons: [{ label: 'Excluir vistoria', value: true, cls: 'danger' }, { label: 'Cancelar', value: false, cls: 'sec' }] });
  if (!ok) return false;
  await apagarVistoria(vistId); toast('Vistoria excluída.');
  return true;
}
async function apagarVistoria(vistId) {
  for (const f of await byIndex('fotos', 'vistId', vistId)) await del('fotos', f.id);
  await del('vists', vistId);
}

async function renderVistoria(id, params) {
  const vist = await get('vists', id); if (!vist) return location.replace('#/');
  if (vist.dadosExcluidosEm) { await avisoDadosExcluidos(vist); return history.length > 1 ? history.back() : location.replace('#/'); }
  const op = await get('ops', vist.opId);
  const fotos = await fotosDe(id);
  setHeader(`${op.numero} · ${codVist(vist)}`, () => history.length > 1 ? history.back() : (location.hash = '#/op/' + op.id));
  view.innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>Vistoria ${codVist(vist)} · ${fmtDate(vist.data)}</b>${statusBadge(vist)}</div>
      <div>${esc(op.empreendimento)}</div><div class="muted small">${esc(op.tomador)} · ${esc(op.numero)}</div>
      <div style="margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:8px"><span>${vist.identificacao ? esc(vist.identificacao) : '<span class="muted">Sem identificação</span>'}</span>
        <button class="edit" id="editarIdent" aria-label="Editar identificação">${ICON.lapis}</button></div>
      <div class="muted small" style="margin-top:6px">${fotos.length} foto(s)${vist.concluidoEm ? ' · concluída em ' + fmtDT(vist.concluidoEm) : ''}</div>
    </div>
    <div class="notice">${NOTICE_LOCAL}</div>
    <div class="stack" id="acoes"></div>
    ${fotos.length ? `<h2 style="margin-top:16px">Fotos</h2><p class="muted small" style="margin-top:-6px">Toque numa foto para ver ${vist.status === 'aberta' ? 'e editar ' : ''}a observação e o áudio.</p>
      <div class="grid">${fotos.map(f => `<button class="thumb" data-foto="${f.id}" aria-label="${codFoto(vist, f)}"><img src="${url(toBlob(f.thumb))}" alt="">
        ${tagsMiniatura(f)}<span class="cod">F${pad(f.seq, 3)}</span></button>`).join('')}</div>` : ''}
`;
  view.querySelectorAll('[data-foto]').forEach(el => el.onclick = async () => { await verFoto(vist.id, el.dataset.foto); route(); });
  const acoes = $('#acoes');
  const add = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn ' + cls; b.textContent = label; b.onclick = fn; acoes.appendChild(b); };
  if (vist.status === 'aberta') add('Continuar vistoria', '', () => continuarVistoria(id));
  if (vist.status === 'concluida') {
    add('GERAR ZIP', '', () => gerarZip(vist.id));
    add('Reabrir vistoria para editar', 'sec', () => reabrirVistoria(vist.id));
    add('Excluir fotos e dados do celular', 'danger', () => excluirFotos(vist.id));
  }
  $('#editarIdent').onclick = async () => {
    const ident = await dialog({ title: 'Identificação da vistoria',
      html: `<input data-field="ident" maxlength="256" placeholder="ex.: Medição 3, boletim 9, liberação de glosa" value="${esc(vist.identificacao)}">`,
      buttons: [{ label: 'Salvar', value: x => x.ident }, { label: 'Cancelar', value: null, cls: 'sec' }] });
    if (ident === null) return;
    const v = await get('vists', id); v.identificacao = ident.trim(); v.atualizadoEm = Date.now(); await put('vists', v);
    toast('Identificação salva.'); route();
  };
}
// Detalhe de uma foto na consulta. Vistoria concluída: só leitura.
// Vistoria aberta (pausada): edita a observação e grava áudio (o novo substitui o anterior).
async function verFoto(vistId, fotoId) {
  for (;;) {
    const vist = await get('vists', vistId), f = await get('fotos', fotoId); if (!f) return;
    const editavel = vist.status === 'aberta', g = f.geo;
    const p = dialog({ title: `Foto ${codFoto(vist, f)}`,
      html: `<img class="det-img" src="${url(toBlob(f.jpg))}" alt="">
        <p class="muted small">${fmtDT(f.tiradaEm)} · ${g ? `Lat ${g.lat.toFixed(6)} · Lon ${g.lon.toFixed(6)} (±${Math.round(g.precisao)} m)` : 'Sem coordenadas (sem sinal de GPS)'}<br>Toque na foto para ampliar.${f.direcao != null ? ` · Direção ${fmtDirecao(f.direcao)} (norte magnético)` : ''}</p>
        ${editavel ? '' : '<div class="notice">Vistoria concluída: não é possível editar.</div>'}
        <label>Observação escrita</label>
        ${editavel ? `<textarea data-field="obs" placeholder="Escreva observações sobre esta foto…">${esc(f.obs)}</textarea>`
          : `<p class="det-txt">${f.obs ? esc(f.obs) : '<span class="muted">Sem observação escrita.</span>'}</p>`}
        <label>Áudio</label>
        ${f.audio ? `<audio controls src="${url(toBlob(f.audio))}" style="width:100%"></audio>`
          : '<p class="muted">Sem áudio.</p>'}`,
      buttons: editavel ? [
        { label: 'Salvar observação', value: x => ({ acao: 'salvar', obs: x.obs }) },
        { label: f.audio ? '🎙 Gravar novo áudio (substitui o atual)' : '🎙 Gravar áudio', value: x => ({ acao: 'gravar', obs: x.obs }), cls: 'sec' },
        { label: 'Fechar', value: x => ({ acao: 'fechar', obs: x.obs }), cls: 'sec' }]
        : [{ label: 'Fechar', value: { acao: 'fechar' }, cls: 'sec' }] });
    document.querySelector('.dialog .det-img').onclick = () => fullscreen(f);
    const r = await p;
    if (!r) return;
    let obs = r.obs === undefined ? f.obs || '' : r.obs.trim();
    if (editavel && r.acao === 'fechar' && obs !== (f.obs || '')) {
      const salvar = await dialog({ title: 'Salvar a observação?', html: '<p>Você alterou a observação desta foto.</p>',
        buttons: [{ label: 'Salvar', value: true }, { label: 'Descartar alteração', value: false, cls: 'sec' }] });
      if (!salvar) obs = f.obs || '';
    }
    if (editavel && obs !== (f.obs || '')) {
      const h = await get('fotos', fotoId); h.obs = obs; await put('fotos', h);
      vist.atualizadoEm = Date.now(); await put('vists', vist);
      if (r.acao === 'salvar') toast('Observação salva.');
    }
    if (r.acao === 'gravar') {
      if (f.audio) {
        const ok = await dialog({ title: 'Substituir áudio?', html: '<p>O áudio atual desta foto será apagado quando você concluir a nova gravação.</p>',
          buttons: [{ label: 'Gravar novo áudio', value: true }, { label: 'Cancelar', value: false, cls: 'sec' }] });
        if (!ok) continue;
      }
      await recordFor(f);
      vist.atualizadoEm = Date.now(); await put('vists', vist);
      continue;
    }
    if (r.acao === 'fechar') return;
  }
}
// Volta a vistoria concluída para "aberta" (pausada), para editar, excluir ou incluir fotos.
async function reabrirVistoria(vistId) {
  const ok = await dialog({ title: 'Reabrir vistoria?',
    html: '<p>A vistoria volta a ficar <b>pausada</b>. Você poderá editar observações e áudios, descartar fotos e tirar novas.</p><p class="muted">Ao terminar, conclua de novo e baixe um novo ZIP. ZIPs já baixados não mudam.</p>',
    buttons: [{ label: 'Reabrir vistoria', value: true }, { label: 'Cancelar', value: false, cls: 'sec' }] });
  if (!ok) return;
  const v = await get('vists', vistId);
  Object.assign(v, { status: 'aberta', concluidoEm: null, reabertaEm: Date.now(), atualizadoEm: Date.now() }); await put('vists', v);
  toast('Vistoria reaberta.');
  continuarVistoria(vistId);
}
async function gerarZip(vistId, recemConcluida = false) {
  const vist = await get('vists', vistId), op = await get('ops', vist.opId);
  const ov = document.createElement('div'); ov.className = 'overlay';
  ov.innerHTML = '<div class="dialog"><h3>Gerando ZIP…</h3><p class="muted">Fotos, áudios e relatório .DOCX.</p></div>';
  document.body.appendChild(ov);
  let file;
  try { file = await buildZip(op, vist, await fotosDe(vistId)); }
  catch (e) { ov.remove(); toast('Erro ao gerar o ZIP: ' + e.message, 7000); console.error(e); return null; }
  ov.remove();
  vist.zipGeradoEm = Date.now(); await put('vists', vist);
  const canShare = !!navigator.canShare?.({ files: [file] });
  const r = await dialog({ title: recemConcluida ? 'Vistoria concluída' : 'ZIP pronto',
    html: `<p><b>${esc(file.name)}</b><br>${(file.size / 1048576).toFixed(1)} MB</p><p>O arquivo .ZIP contém as fotos, áudios e comentários gerados, além de um arquivo .kml com a localização e sentido das fotos, e um relatório .DOCX com todas as informações tabeladas.</p>`,
    buttons: [{ label: '⬇︎ Baixar ZIP', value: 'dl' }, ...(canShare ? [{ label: 'Compartilhar / Salvar em…', value: 'share', cls: 'sec' }] : []), { label: 'Fechar', value: 'close', cls: 'sec' }] });
  if (r === 'dl') download(file);
  if (r === 'share') { if (!(await share(file))) download(file); }
  if (recemConcluida) route();
  return file;
}
async function excluirFotos(vistId) {
  const a = await dialog({ title: 'Excluir fotos e dados do celular',
    html: '<p>Antes de excluir, recomendamos <b>baixar o ZIP</b> desta vistoria, caso ainda não tenha guardado uma cópia.</p>',
    buttons: [{ label: 'Baixar ZIP agora', value: 'zip' }, { label: 'Já tenho o ZIP, continuar', value: 'go', cls: 'sec' }, { label: 'Voltar', value: 'no', cls: 'sec' }] });
  if (a === 'no') return;
  if (a === 'zip') { const f = await gerarZip(vistId); if (!f) return; }
  const b = await dialog({ title: 'Confirmar exclusão',
    html: '<p>Serão apagados do celular: fotos, áudios, coordenadas e observações.</p><p>Fica registrado apenas: operação, empreendimento, tomador, data e identificação da vistoria. A vistoria continuará aparecendo na consulta, mas <b>não será mais possível ver os detalhes nem gerar um novo ZIP</b>.</p><p class="muted">ZIPs já gerados e salvos não são afetados.</p>',
    buttons: [{ label: 'Excluir fotos e dados', value: true, cls: 'danger' }, { label: 'Cancelar', value: false, cls: 'sec' }] });
  if (!b) return;
  for (const f of await byIndex('fotos', 'vistId', vistId)) await del('fotos', f.id);
  const v = await get('vists', vistId);
  // Mantém só o vínculo com a operação (número, empreendimento, tomador), o código, a data e a identificação.
  const resto = { id: v.id, opId: v.opId, seq: v.seq, data: v.data, identificacao: v.identificacao || '', status: v.status, criadoEm: v.criadoEm, dadosExcluidosEm: Date.now() };
  await put('vists', resto);
  toast('Fotos e dados excluídos do celular.');
  location.replace('#/consulta/' + v.opId);
}

// ---------- Roteamento ----------
// As telas são desenhadas uma de cada vez, para que duas navegações seguidas não se misturem.
let routing = Promise.resolve();
function route() { routing = routing.then(doRoute, doRoute); return routing; }
async function doRoute() {
  if (recorder) return; // não troca de tela durante a gravação
  clearURLs(); currentFoto = null;
  const [path, qs] = location.hash.slice(1).split('?');
  const [, kind, id] = (path || '/').split('/');
  const params = new URLSearchParams(qs || '');
  if (!['op', 'foto', 'pausadas', 'grade', 'camera'].includes(kind)) stopGeo();
  if (kind !== 'camera') fecharCamera();
  try {
    if (kind === 'cadastro') await renderCadastro(id);
    else if (kind === 'selecionar') await renderSelecionar();
    else if (kind === 'op') await renderOp(id);
    else if (kind === 'pausadas') await renderPausadas(id);
    else if (kind === 'foto') await renderFoto(id);
    else if (kind === 'grade') await renderGrade(id);
    else if (kind === 'camera') await renderCamera(id, params);
    else if (kind === 'consulta') await renderConsulta(id);
    else if (kind === 'vistoria') await renderVistoria(id, params);
    else await renderHome();
  } catch (e) { view.innerHTML = `<div class="card">Erro: ${esc(e.message)}</div>`; console.error(e); }
  if (kind !== 'foto') window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
(async () => {
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  route();
})();
