/* Controle de Reentregas · CD Barueri */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = { token: null, user: null, cfg: null, motoristas: [], fatMeta: null, months: [], cache: null, fatStats: null, view: 'dashboard', sessao: [] };
const TIPOS = { REENTREGA: 'Reentrega', NFD: 'NFD', OCORRENCIA: 'Ocorrência', CANCELADA: 'Cancelada' };
const TIPOS_ATIVOS = { REENTREGA: 'Reentrega', NFD: 'NFD', OCORRENCIA: 'Ocorrência' };
const DESCONTOS = ['TOTAL', 'PARCIAL', 'SEM DESCONTO'];
const DESC_LB = { TOTAL: 'Total', PARCIAL: 'Parcial', 'SEM DESCONTO': 'Sem desconto' };
const CANAIS = ['VD', 'VET', 'PROMO'];
const MOTIVO_RECUSA = 'CONFIRMAÇÃO DE ENDEREÇO';
const CANAL_COR = { VD: '#2a78d6', VET: '#eb6834', PROMO: '#1baf7a', 'N/D': '#8a8984' };

// ---------- formatos ----------
const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fD = (iso) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4) : '');
const fMoney = (v) => (v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const fNum = (v, d = 0) => (v == null || v === '' || isNaN(v) ? '' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fPct = (v, d = 1) => (v == null || !isFinite(v) ? '–' : (v * 100).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: d }) + '%');
const fCompact = (v) => { v = Number(v) || 0; if (Math.abs(v) >= 1e6) return 'R$ ' + (v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' mi'; if (Math.abs(v) >= 1e3) return 'R$ ' + (v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil'; return fMoney(v); };
const monthOf = (d) => (d || '').slice(0, 7);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const fMes = (m) => MES[+m.slice(5, 7) - 1] + '/' + m.slice(2, 4);
const strip = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function turnoDe(hm) {
  const t = S.cfg?.turnoHoras || {};
  for (const [k, [a, b]] of Object.entries(t)) {
    if (a < b ? hm >= a && hm < b : hm >= a || hm < b) return k;
  }
  return '';
}

// ---------- API ----------
async function api(path, body, method) {
  const opt = { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json' } };
  if (S.token) opt.headers.Authorization = 'Bearer ' + S.token;
  if (body) opt.body = JSON.stringify(body);
  const r = await fetch('/api/' + path, opt);
  let j = {};
  try { j = await r.json(); } catch { /* */ }
  if (r.status === 401 && path !== 'login') { logout(); throw new Error(j.error || 'Sessão expirada'); }
  if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
  return j;
}
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : '');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), err ? 5000 : 2600);
}
const isAdm = () => S.user?.perfil === 'adm';

// ---------- login ----------
let perfilLogin = 'op';
function initLogin() {
  $$('#perfilSeg button').forEach((b) => b.onclick = () => {
    perfilLogin = b.dataset.v;
    $$('#perfilSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#lgNomeWrap').classList.toggle('hidden', perfilLogin !== 'adm');
    $('#lgSenhaHint').classList.toggle('hidden', perfilLogin === 'adm');
  });
  $('#loginForm').onsubmit = async (e) => {
    e.preventDefault(); $('#lgErr').textContent = '';
    try {
      const j = await api('login', { perfil: perfilLogin, usuario: $('#lgUser').value, senha: $('#lgPass').value, nome: $('#lgNome').value });
      S.token = j.token; localStorage.setItem('reent_tok', j.token);
      await boot();
    } catch (err) { $('#lgErr').textContent = err.message; }
  };
}
function logout() {
  S.token = null; S.user = null; S.cache = null;
  try { localStorage.removeItem('reent_tok'); } catch { /* */ }
  $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
}

async function boot() {
  const j = await api('bootstrap');
  Object.assign(S, { cfg: j.cfg, motoristas: j.motoristas || [], motMeta: j.motMeta, itens: j.itens || [], itensMeta: j.itensMeta, fatMeta: j.fatMeta, months: j.months, user: j.user });
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  $('#whoName').textContent = `${j.user.nome} · ${j.user.perfil === 'adm' ? 'ADM' : 'Operação'}`;
  $$('#nav [data-adm]').forEach((b) => b.classList.toggle('hidden', !isAdm()));
  setPend(j.pendentes);
  go('dashboard');
}
function setPend(n) { const b = $('#pendBadge'); b.textContent = n; b.classList.toggle('hidden', !n); }

function go(v) {
  S.view = v;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  const fn = { registrar: vRegistrar, aprovacoes: vAprovacoes, registros: vRegistros, dashboard: vDashboard, consulta: vConsulta, admin: vAdmin }[v];
  $('#main').innerHTML = ''; $('#main').classList.remove('full');
  fn();
}

// ---------- dados ----------
async function loadAll(force) {
  if (S.cache && !force) return S.cache;
  const b = await api('bootstrap?lite=1'); S.months = b.months; setPend(b.pendentes);
  const out = []; const ms = S.months.slice();
  const groups = []; for (let i = 0; i < ms.length; i += 4) groups.push(ms.slice(i, i + 4));
  await Promise.all(groups.map(async (g) => { const j = await api('list?m=' + g.join(',')); out.push(...j.recs); }));
  S.cache = out;
  return out;
}
function invalidate() { S.cache = null; }

// Conta quantas vezes cada NF voltou como reentrega (todo o histórico, exceto recusadas)
function reentregaCounts(recs) {
  const by = {};
  recs.filter((r) => r.tipo === 'REENTREGA' && r.status !== 'RECUSADO').forEach((r) => (by[r.nf] = by[r.nf] || []).push(r));
  Object.values(by).forEach((a) => a.sort((x, y) => (x.data + (x.hora || '')).localeCompare(y.data + (y.hora || ''))));
  return by;
}

// ---------- campos ----------
function motivosDo(tipo) {
  const c = S.cfg;
  return tipo === 'NFD' ? c.motivosNFD : tipo === 'OCORRENCIA' ? c.motivosOcorrencia : c.motivosReentrega;
}
const opts = (arr, sel, blank = true) => (blank ? '<option value=""></option>' : '') + arr.map((x) => `<option ${x === sel ? 'selected' : ''}>${esc(x)}</option>`).join('');
const motAtivos = () => (S.motoristas || []).filter((m) => m.ativo !== false);
function datalists() {
  const at = motAtivos();
  return `<datalist id="dlMot">${[...new Map(at.map((m) => [m.nome, m])).values()].map((m) => `<option value="${esc(m.nome)}">${esc(at.filter((x) => x.nome === m.nome).map((x) => x.placa).join(', '))} · ${esc(m.transp || '')}</option>`).join('')}</datalist>
  <datalist id="dlPlaca">${at.map((m) => `<option value="${esc(m.placa)}">${esc(m.nome)} · ${esc(m.veiculo || '')}</option>`).join('')}</datalist>
  <datalist id="dlConf">${(S.cfg.conferentes || []).map((c) => `<option value="${esc(c)}">`).join('')}</datalist>`;
}

// ============ REGISTRAR ============
let regTipo = 'REENTREGA';
const FOTOS = { doc: null, avarias: [], desconto: '', itens: [] };
const resetFotos = () => { FOTOS.doc = null; FOTOS.avarias = []; FOTOS.desconto = ''; FOTOS.itens = []; };
const novoItem = () => ({ cod: '', desc: '', peso: null, qtd: '', fotos: [], txt: '' });
function vRegistrar() {
  const m = $('#main');
  m.innerHTML = `
  ${datalists()}
  <div class="tipo-seg" id="tipoSeg">
    ${Object.entries(TIPOS_ATIVOS).map(([k, v]) => `<button data-t="${k}" class="${k === regTipo ? 'on' : ''}">${v}</button>`).join('')}
  </div>
  <div class="grid g2" style="align-items:start">
      <div class="card stack" id="blocoMot">
        <h3 id="blocoTitulo">Recebimento</h3>
        <div class="row">
          <label>Data<input type="date" id="fData" value="${todayISO()}"></label>
          <label>Horário<input type="time" id="fHora" value="${nowHM()}"></label>
          <label>Turno<select id="fTurno">${opts(S.cfg.turnos, turnoDe(nowHM()), false)}</select></label>
        </div>
        <div class="row only-mot">
          <label style="flex:2">Motorista<input id="fMot" list="dlMot" placeholder="Digite o nome" autocomplete="off"></label>
          <label>Placa<input id="fPlaca" list="dlPlaca" placeholder="ABC1D23" autocomplete="off"></label>
        </div>
        <div id="motInfo" class="muted small"></div>
        <div class="row">
          <label class="only-mot">Transportadora<select id="fTransp">${opts(S.cfg.transportadoras, '')}</select></label>
          <label>Conferente<input id="fConf" list="dlConf" value="${esc(S.user.nome)}"></label>
        </div>
      </div>
      <div class="card stack">
        <h3>Nota fiscal</h3>
        <label>Nº da NF <input id="fNF" class="nfbig" inputmode="numeric" placeholder="Digite e tecle Enter" autocomplete="off"></label>
        <div id="nfInfo" class="nfinfo muted">Digite a NF para buscar no consolidado.</div>
        <div id="tipoCampos" class="stack"></div>
        <label>Observação<input id="fObs" placeholder="opcional"></label>
        <button class="btn primary big" id="btnSalvar">Salvar lançamento</button>
        <div class="muted small">Os dados do motorista ficam preenchidos para lançar a próxima nota do mesmo veículo.</div>
      </div>
  </div>
    <div class="card" style="margin-top:12px">
      <div class="row" style="align-items:center;margin-bottom:8px"><h3 style="margin:0">Lançados nesta sessão</h3><span class="spacer"></span><span class="muted small" id="sessCount"></span></div>
      <div id="sessList"></div>
    </div>`;
  $$('#tipoSeg button').forEach((b) => b.onclick = () => { regTipo = b.dataset.t; resetFotos(); $$('#tipoSeg button').forEach((x) => x.classList.toggle('on', x === b)); renderTipoCampos(); });
  $('#fHora').onchange = () => { const t = turnoDe($('#fHora').value); if (t) $('#fTurno').value = t; };
  const setTransp = (t) => { if (!t) return; if (!$$('#fTransp option').some((o) => o.value === t)) $('#fTransp').insertAdjacentHTML('beforeend', `<option>${esc(t)}</option>`); $('#fTransp').value = t; };
  const mostra = (m, n) => { $('#motInfo').textContent = m ? `${m.veiculo || ''}${m.transp ? ' · ' + m.transp : ''}${n > 1 ? ` · ${n} veículos cadastrados para este motorista` : ''}` : ''; };
  $('#fMot').onchange = () => {
    const all = motAtivos().filter((x) => strip(x.nome) === strip($('#fMot').value));
    if (!all.length) { mostra(null); return; }
    $('#fMot').value = all[0].nome;
    if (all.length === 1 || !all.some((x) => x.placa === $('#fPlaca').value.trim().toUpperCase())) $('#fPlaca').value = all[0].placa || '';
    setTransp(all[0].transp); mostra(all[0], all.length);
  };
  $('#fPlaca').onchange = () => {
    const pl = $('#fPlaca').value.replace(/[\s-]/g, '').toUpperCase(); $('#fPlaca').value = pl;
    const m = motAtivos().find((x) => x.placa === pl) || (S.motoristas || []).find((x) => x.placa === pl);
    if (m) { $('#fMot').value = m.nome; setTransp(m.transp); mostra(m, motAtivos().filter((x) => x.nome === m.nome).length); }
  };
  $('#fNF').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupNF(true); } });
  $('#fNF').addEventListener('blur', () => lookupNF(false));
  $('#btnSalvar').onclick = salvarRegistro;
  renderTipoCampos(); renderSessao();
}

function renderTipoCampos() {
  const t = regTipo;
  $('#blocoTitulo').textContent = 'Recebimento do motorista';
  let h = '';
  if (t === 'REENTREGA') h = `
    <label>Motivo do insucesso<select id="fMotivo">${opts(motivosDo(t), '')}</select></label>
    <div class="row"><label>Valor (R$)<input id="fValor" inputmode="decimal" placeholder="auto pelo consolidado"></label><label>Peso (kg)<input id="fPeso" inputmode="decimal" placeholder="auto"></label></div>`;
  if (t === 'NFD') h = `
    <div class="row"><label>Nº da NFD<input id="fNFD" inputmode="numeric"></label><label>Data de emissão<input type="date" id="fEmissao"></label></div>
    <div class="row"><label>Motivo<select id="fMotivo">${opts(motivosDo(t), '')}</select></label><label>Valor da NFD (R$)<input id="fValor" inputmode="decimal"></label></div>`;
  if (t === 'OCORRENCIA') h = `
    <div class="row"><label>Motivo<select id="fMotivo">${opts(motivosDo(t), '')}</select></label><label>Data da entrega<input type="date" id="fEntrega" value="${todayISO()}"></label></div>`;
  if (t === 'OCORRENCIA') h += `
    <div class="fld"><div class="fld-l">Desconto do motorista</div><div class="seg seg-full" id="fDesc">${DESCONTOS.map((d) => `<button type="button" data-d="${d}" class="${FOTOS.desconto === d ? 'on' : ''}">${DESC_LB[d]}</button>`).join('')}</div></div>`;
  if (t === 'OCORRENCIA') h += `<div id="ocBox" class="stack"></div>
    <datalist id="dlItens">${(S.itens || []).map((x) => `<option value="${esc(x[0] + ' — ' + x[1])}">`).join('')}</datalist>`;
  if (t === 'NFD') h += `
    <div class="fld"><div class="fld-l">Foto da NFD</div><div id="fDocBox"></div></div>
    <div class="fld"><div class="fld-l">Fotos de avarias <span class="muted">(opcional · uma descrição por foto)</span></div><div id="fAvBox"></div></div>`;
  $('#tipoCampos').innerHTML = h;
  if (t === 'OCORRENCIA') {
    $$('#fDesc button').forEach((b) => b.onclick = () => {
      FOTOS.desconto = b.dataset.d; $$('#fDesc button').forEach((x) => x.classList.toggle('on', x === b));
      if (FOTOS.desconto === 'PARCIAL' && !FOTOS.itens.length) FOTOS.itens.push(novoItem());
      renderOc();
    });
    renderOc();
  }
  if (t === 'NFD') renderFotos();
  $('#fNF').placeholder = t === 'NFD' ? 'NF referenciada (Enter)' : t === 'OCORRENCIA' ? 'NF de origem (Enter)' : 'Digite e tecle Enter';
  if (S._lastLookup) showNFInfo(S._lastLookup);
}

let lookupSeq = 0;
async function lookupNF(focusNext) {
  const nf = $('#fNF').value.replace(/\D/g, '').replace(/^0+/, '');
  if (!nf) { $('#nfInfo').className = 'nfinfo muted'; $('#nfInfo').textContent = 'Digite a NF para buscar no consolidado.'; S._lastLookup = null; return; }
  if (S._lastLookup?.nf === nf) { if (focusNext) $('#fMotivo, #fOR')?.focus(); return; }
  const seq = ++lookupSeq;
  $('#nfInfo').className = 'nfinfo muted'; $('#nfInfo').textContent = 'Buscando…';
  try {
    const j = await api('lookup?nf=' + nf);
    if (seq !== lookupSeq) return;
    S._lastLookup = j; showNFInfo(j);
    if (focusNext) ($('#fMotivo') || $('#fOR'))?.focus();
  } catch (e) { $('#nfInfo').className = 'nfinfo bad'; $('#nfInfo').textContent = e.message; }
}
function showNFInfo(j) {
  const f = j.fat; const el = $('#nfInfo');
  const reent = j.hist.filter((h) => h.tipo === 'REENTREGA' && h.status !== 'RECUSADO');
  const same = j.hist.filter((h) => h.tipo === regTipo && h.data === $('#fData').value);
  let h = '';
  if (f) {
    h += `<div><span class="dot c-${f[0]}"></span><b>${esc(f[0])}</b> · ${esc(f[1])} · ${esc(f[2] || f[3])}</div>
    <div class="muted small">${esc(f[9] || '')} ${f[10] ? '· ' + esc(f[10]) : ''} · Fat. ${fD(f[5])} · ${fMoney(f[7])} · ${fNum(f[6], 1)} kg · Rep.: ${esc(f[8] || '')}</div>`;
    el.className = 'nfinfo ok';
    if (regTipo === 'REENTREGA') { if (!$('#fValor').value) $('#fValor').placeholder = fNum(f[7], 2); if (!$('#fPeso').value) $('#fPeso').placeholder = fNum(f[6], 1); }
    if (!$('#fTransp').value && S.cfg.transportadoras.includes(f[1])) $('#fTransp').value = f[1];
  } else {
    h += `<div><b>NF ${esc(j.nf)} não encontrada no consolidado.</b></div><div class="muted small">${baseTxt(j.base)} Pode salvar normalmente: o cruzamento é refeito quando o ADM atualizar o consolidado.</div>`;
    el.className = 'nfinfo warn';
  }
  if (reent.length) {
    const n = reent.length;
    h += `<div class="alert ${n >= 2 ? 'crit' : 'warn'}">⚠ Esta NF já voltou ${n}× como reentrega: ${reent.map((r) => fD(r.data) + ' (' + esc(r.motivo || '-') + ')').join(', ')}</div>`;
    if (el.className.includes('ok')) el.className = 'nfinfo warn';
  }
  const outros = j.hist.filter((x) => x.tipo !== 'REENTREGA');
  if (outros.length) h += `<div class="alert info">Também possui: ${outros.map((x) => TIPOS[x.tipo] + ' ' + fD(x.data) + (x.motivo ? ' (' + esc(x.motivo) + ')' : '')).join(', ')}</div>`;
  if (same.length) h += `<div class="alert crit">Já existe ${TIPOS[regTipo]} desta NF lançada nesta data. Confira antes de salvar.</div>`;
  el.innerHTML = h;
}

// ---------- fotos ----------
async function compressImg(file, max = 1600, q = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ko(new Error('Arquivo não é uma imagem válida')); i.src = url; });
    const sc = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', q);
  } finally { URL.revokeObjectURL(url); }
}
// fotos de Blob privado passam pelo app com o login na URL
const fotoSrc = (u) => (u && u.startsWith('/api/foto') ? u + '&t=' + encodeURIComponent(S.token || '') : u);
async function enviarFoto(file) { const data = await compressImg(file); const j = await api('upload', { data }); return j.url; }
function renderFotos() {
  const doc = $('#fDocBox'), av = $('#fAvBox'); if (!av) return;
  if (doc) doc.innerHTML = FOTOS.doc ? `<div class="ph-one"><img src="${esc(fotoSrc(FOTOS.doc))}" class="ph-th" data-full="${esc(fotoSrc(FOTOS.doc))}"><button type="button" class="btn sm" id="fDocDel">Remover</button></div>`
    : `<label class="ph-add"><input type="file" accept="image/*" id="fDocIn" hidden>📷 Tirar / escolher foto</label>`;
  av.innerHTML = `<div class="ph-list">${FOTOS.avarias.map((a, i) => `<div class="ph-item"><img src="${esc(fotoSrc(a.url))}" class="ph-th" data-full="${esc(fotoSrc(a.url))}" data-desc="${esc(a.desc)}">
      <input class="ph-desc" data-i="${i}" placeholder="${$('#ocBox') ? 'Descrição da foto (opcional)' : 'Descreva a avaria (ex.: saco rasgado, 2 un.)'}" value="${esc(a.desc)}"><button type="button" class="btn sm ph-del" data-i="${i}">✕</button></div>`).join('')}</div>
    <label class="ph-add"><input type="file" accept="image/*" multiple id="fAvIn" hidden>${$('#ocBox') ? '📷 Adicionar fotos da ocorrência' : '➕ Adicionar fotos de avaria'}</label>`;
  const up = async (files, onUrl, box) => {
    FOTOS.enviando = (FOTOS.enviando || 0) + files.length; box.insertAdjacentHTML('beforeend', '<div class="muted small ph-wait">Enviando foto(s)…</div>');
    for (const f of files) { try { onUrl(await enviarFoto(f)); } catch (e) { toast('Falha ao enviar foto: ' + e.message, true); } finally { FOTOS.enviando--; } }
    renderFotos();
  };
  FOTOS._up = up;
  $('#fDocIn') && ($('#fDocIn').onchange = (e) => up([...e.target.files].slice(0, 1), (u) => { FOTOS.doc = u; }, doc));
  $('#fDocDel') && ($('#fDocDel').onclick = () => { FOTOS.doc = null; renderFotos(); });
  $('#fAvIn').onchange = (e) => up([...e.target.files].slice(0, 15), (u) => { FOTOS.avarias.push({ url: u, desc: '' }); }, av);
  $$('.ph-desc', av).forEach((i) => i.oninput = () => { FOTOS.avarias[+i.dataset.i].desc = i.value; });
  $$('.ph-del', av).forEach((b) => b.onclick = () => { FOTOS.avarias.splice(+b.dataset.i, 1); renderFotos(); });
}
// ---- ocorrência: Total / Sem desconto = fotos; Parcial = itens (código, qtd, foto) ----
function acharItem(txt) {
  const t = String(txt || '').trim(); if (!t) return null;
  const cod = t.split(' — ')[0].trim().toUpperCase();
  const L = S.itens || []; const T = strip(t);
  return L.find((x) => x[0].toUpperCase() === cod) || L.find((x) => strip(x[0] + ' — ' + x[1]) === T) || L.find((x) => strip(x[1]) === T)
    || (() => { const c = L.filter((x) => strip(x[1]).includes(T) || x[0].toUpperCase().includes(cod)); return c.length === 1 ? c[0] : null; })();
}
function renderOc() {
  const box = $('#ocBox'); if (!box) return;
  const d = FOTOS.desconto;
  if (!d) { box.innerHTML = '<div class="muted small">Escolha o desconto do motorista para continuar.</div>'; return; }
  if (d !== 'PARCIAL') {
    box.innerHTML = `<div class="fld"><div class="fld-l">Fotos da ocorrência ${d === 'TOTAL' ? '<span class="muted">(desconto da ocorrência toda · pelo menos 1 foto)</span>' : '<span class="muted">(opcional)</span>'}</div><div id="fAvBox"></div></div>`;
    renderFotos(); return;
  }
  const kg = FOTOS.itens.reduce((s, it) => s + (Number(it.qtd) || 0) * (it.peso || 0), 0);
  box.innerHTML = `<div class="fld-l">Itens com desconto <span class="muted">(item, quantidade e foto de cada um)</span></div>
    ${FOTOS.itens.map((it, i) => `<div class="it-card ${it.txt && !it.cod ? 'bad' : ''}" data-i="${i}">
      <div class="it-top"><span class="it-n">${i + 1}</span>
        <label class="grow">Item (código ou descrição)<input class="itSel" list="dlItens" value="${esc(it.cod ? it.cod + ' — ' + it.desc : it.txt)}" placeholder="Ex.: 3000-004-PP ou PREMIER FORM" autocomplete="off"></label>
        <label class="it-q">Qtd<input class="itQtd" type="number" min="1" step="1" inputmode="numeric" value="${esc(it.qtd)}"></label>
        <button type="button" class="btn sm itDel" title="Remover item">✕</button></div>
      <div class="muted small">${it.cod ? `${esc(it.desc)}${it.peso ? ` · ${fNum(it.peso, 1)} kg/un${it.qtd ? ` · <b>${fNum(it.peso * it.qtd, 1)} kg</b>` : ''}` : ''}` : (it.txt ? '<span style="color:var(--crit)">Item não encontrado no catálogo</span>' : '')}</div>
      <div class="it-ph">${it.fotos.map((u, k) => `<span class="it-th"><img src="${esc(fotoSrc(u))}" class="ph-th" data-full="${esc(fotoSrc(u))}" data-desc="${esc(it.cod + ' × ' + (it.qtd || '?'))}"><button type="button" class="itPhDel" data-k="${k}" title="Remover foto">✕</button></span>`).join('')}
        <label class="ph-add sm"><input type="file" accept="image/*" multiple class="itPhIn" hidden>📷 ${it.fotos.length ? 'Mais fotos' : 'Foto do item'}</label></div>
    </div>`).join('')}
    <button type="button" class="btn" id="itAdd">➕ Adicionar outro item</button>
    ${FOTOS.itens.length ? `<div class="muted small">${FOTOS.itens.length} item(ns) · ${fNum(FOTOS.itens.reduce((s, it) => s + (Number(it.qtd) || 0), 0))} unidade(s)${kg ? ` · ${fNum(kg, 1)} kg` : ''}</div>` : ''}`;
  $('#itAdd').onclick = () => { FOTOS.itens.push(novoItem()); renderOc(); $$('#ocBox .itSel').pop()?.focus(); };
  $$('#ocBox .it-card').forEach((card) => {
    const it = FOTOS.itens[+card.dataset.i];
    $('.itSel', card).onchange = (e) => { const f = acharItem(e.target.value); it.txt = e.target.value; if (f) { it.cod = f[0]; it.desc = f[1]; it.peso = f[2]; } else { it.cod = ''; it.desc = ''; it.peso = null; } renderOc(); if (f) $$('#ocBox .itQtd')[+card.dataset.i]?.focus(); };
    $('.itQtd', card).oninput = (e) => { it.qtd = e.target.value; };
    $('.itQtd', card).onchange = () => renderOc();
    $('.itDel', card).onclick = () => { FOTOS.itens.splice(+card.dataset.i, 1); renderOc(); };
    $$('.itPhDel', card).forEach((b) => b.onclick = () => { it.fotos.splice(+b.dataset.k, 1); renderOc(); });
    $('.itPhIn', card).onchange = async (e) => {
      const files = [...e.target.files].slice(0, 10); FOTOS.enviando = (FOTOS.enviando || 0) + files.length;
      card.insertAdjacentHTML('beforeend', '<div class="muted small">Enviando foto(s)…</div>');
      for (const f of files) { try { it.fotos.push(await enviarFoto(f)); } catch (err) { toast('Falha ao enviar foto: ' + err.message, true); } finally { FOTOS.enviando--; } }
      renderOc();
    };
  });
}
const nFotos = (r) => (r.fotoDoc ? 1 : 0) + (r.fotosAvaria || []).length + (r.itens || []).reduce((s, it) => s + (it.fotos || []).length, 0);
function itensHTML(r) {
  if (!r.itens || !r.itens.length) return '';
  return `<table class="it-tbl"><thead><tr><th>Código</th><th>Item</th><th class="num">Qtd</th><th class="num">Kg</th></tr></thead><tbody>${r.itens.map((it) => `<tr><td><b>${esc(it.cod)}</b></td><td>${esc(it.desc)}</td><td class="num">${fNum(it.qtd)}</td><td class="num">${it.peso ? fNum(it.peso * it.qtd, 1) : ''}</td></tr>`).join('')}</tbody></table>`;
}
// galeria (miniaturas clicáveis) usada na consulta, edição e detalhes
function galeriaHTML(r) {
  const it = [];
  if (r.fotoDoc) it.push({ url: r.fotoDoc, desc: 'Foto da ' + (r.tipo === 'NFD' ? 'NFD' : 'ocorrência') });
  (r.fotosAvaria || []).forEach((a, i) => it.push({ url: a.url, desc: (r.tipo === 'OCORRENCIA' ? 'Ocorrência ' : 'Avaria ') + (i + 1) + (a.desc ? ': ' + a.desc : '') }));
  (r.itens || []).forEach((x) => (x.fotos || []).forEach((u) => it.push({ url: u, desc: `${x.cod} × ${fNum(x.qtd)}${x.desc ? ' · ' + x.desc : ''}` })));
  if (!it.length) return '';
  return `<div class="gal">${it.map((x) => `<figure><img src="${esc(fotoSrc(x.url))}" class="ph-th" data-full="${esc(fotoSrc(x.url))}" data-desc="${esc(x.desc)}" loading="lazy"><figcaption>${esc(x.desc)}</figcaption></figure>`).join('')}</div>`;
}
document.addEventListener('click', (e) => {
  const im = e.target.closest('img.ph-th'); if (!im) return;
  const lb = document.createElement('div'); lb.className = 'lightbox';
  lb.innerHTML = `<figure><img src="${esc(im.dataset.full)}"><figcaption>${esc(im.dataset.desc || '')}</figcaption></figure><a href="${esc(im.dataset.full)}" target="_blank" class="lb-open" download="foto.jpg">abrir / baixar</a>`;
  lb.onclick = (ev) => { if (ev.target.tagName !== 'A') lb.remove(); }; document.body.appendChild(lb);
});

const numIn = (s) => { if (s == null || s === '') return undefined; s = String(s).replace(/[R$\s]/g, ''); if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : undefined; };

async function salvarRegistro() {
  const nf = $('#fNF').value.replace(/\D/g, '');
  const t = regTipo;
  const rec = {
    tipo: t, nf, data: $('#fData').value, hora: $('#fHora').value, turno: $('#fTurno').value,
    conferente: $('#fConf').value.trim().toUpperCase(), obs: $('#fObs').value.trim(),
    motivo: $('#fMotivo')?.value || ''
  };
  Object.assign(rec, { motorista: $('#fMot').value.trim().toUpperCase(), placa: $('#fPlaca').value.trim().toUpperCase(), transportadora: $('#fTransp').value });
  if (t === 'REENTREGA') Object.assign(rec, { valor: numIn($('#fValor').value), peso: numIn($('#fPeso').value) });
  if (t === 'NFD') Object.assign(rec, { nfd: $('#fNFD').value.replace(/\D/g, ''), dataEmissao: $('#fEmissao').value, valor: numIn($('#fValor').value) });
  if (t === 'OCORRENCIA') Object.assign(rec, { dataEntrega: $('#fEntrega').value, descontoMotorista: FOTOS.desconto });
  if (t === 'NFD' || (t === 'OCORRENCIA' && FOTOS.desconto !== 'PARCIAL')) { if (FOTOS.doc) rec.fotoDoc = FOTOS.doc; if (FOTOS.avarias.length) rec.fotosAvaria = FOTOS.avarias.map((a) => ({ url: a.url, desc: a.desc.trim() })); }
  if (t === 'OCORRENCIA' && FOTOS.desconto === 'PARCIAL') rec.itens = FOTOS.itens.filter((it) => it.cod || it.txt || it.qtd || it.fotos.length).map((it) => ({ cod: it.cod, desc: it.desc, peso: it.peso, qtd: Number(it.qtd) || 0, fotos: it.fotos, _txt: it.txt }));
  const faltando = [];
  if (!nf) faltando.push('NF');
  if (!rec.data) faltando.push('data');
  if (!rec.motivo) faltando.push('motivo');
  if (!rec.motorista) faltando.push('motorista');
  if (t === 'OCORRENCIA' && !rec.descontoMotorista) faltando.push('desconto do motorista');
  if (t === 'OCORRENCIA' && rec.descontoMotorista === 'TOTAL' && !(rec.fotosAvaria || []).length) faltando.push('ao menos 1 foto da ocorrência');
  if (t === 'OCORRENCIA' && rec.descontoMotorista === 'PARCIAL') {
    if (!(rec.itens || []).length) faltando.push('ao menos 1 item');
    (rec.itens || []).forEach((it, i) => { const n = `item ${i + 1}`; if (!it.cod) faltando.push(`${n}: código válido do catálogo`); if (!(it.qtd > 0)) faltando.push(`${n}: quantidade`); if (!it.fotos.length) faltando.push(`${n}: foto`); });
    (rec.itens || []).forEach((it) => delete it._txt);
  }
  if (FOTOS.enviando) return toast('Aguarde o envio das fotos terminar', true);
  if (t === 'NFD' && !rec.nfd) faltando.push('nº da NFD');
  if (faltando.length) return toast('Preencha: ' + faltando.join(', '), true);
  $('#btnSalvar').disabled = true;
  try {
    const j = await api('save', { rec });
    S.sessao.unshift(j.rec); invalidate();
    toast(`${TIPOS[t]} da NF ${nf} salva${j.rec.status === 'PENDENTE' ? ' · aguardando ADM' : ''}`);
    $('#fNF').value = ''; $('#fObs').value = ''; S._lastLookup = null;
    ['#fValor', '#fPeso', '#fNFD', '#fOR'].forEach((s) => { if ($(s)) { $(s).value = ''; $(s).placeholder = s === '#fValor' || s === '#fPeso' ? 'auto' : ''; } });
    if ($('#fMotivo')) $('#fMotivo').value = '';
    resetFotos(); if (t === 'NFD' || t === 'OCORRENCIA') renderTipoCampos();
    $('#nfInfo').className = 'nfinfo muted'; $('#nfInfo').textContent = 'Digite a NF para buscar no consolidado.';
    renderSessao(); $('#fNF').focus();
    if (j.rec.status === 'PENDENTE') { const b = $('#pendBadge'); setPend((+b.textContent || 0) + 1); }
  } catch (e) { toast(e.message, true); } finally { $('#btnSalvar').disabled = false; }
}
function renderSessao() {
  $('#sessCount').textContent = S.sessao.length ? S.sessao.length + ' lançamento(s)' : '';
  $('#sessList').innerHTML = S.sessao.length ? `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Tipo</th><th>NF</th><th>Cliente</th><th>Motivo</th><th>Motorista</th><th>Status</th></tr></thead><tbody>
    ${S.sessao.map((r) => `<tr><td>${TIPOS[r.tipo]}</td><td><b>${esc(r.nf)}</b></td><td class="wrap">${canalTag(r.canal)} ${esc(r.cliente || '—')}</td><td>${esc(r.motivo || '')}</td><td>${esc(r.motorista || '')}</td><td>${pill(r.status)}</td></tr>`).join('')}
  </tbody></table></div>` : '<div class="muted">Nada lançado ainda.</div>';
}
const baseTxt = (b) => (b && b.total ? `A base tem ${fNum(b.total)} NFs${b.de ? `, faturadas de ${fD(b.de)} a ${fD(b.ate)}` : ''}.` : 'Nenhum consolidado foi carregado ainda (Admin → Consolidado).');
const pill = (s) => `<span class="pill ${s}">${s === 'APROVADO' ? '✓ ' : s === 'RECUSADO' ? '✕ ' : '● '}${esc(s)}</span>`;
const canalTag = (c) => `<span class="dot c-${(c || 'ND').replace('/', '')}"></span>`;

// ============ APROVAÇÕES ============
async function vAprovacoes() {
  const m = $('#main');
  m.innerHTML = `<div class="row" style="align-items:center;margin-bottom:12px"><h2 style="margin:0">Aprovações pendentes</h2><span class="spacer"></span>
    <button class="btn" id="apSelAll">Selecionar todos</button>
    <button class="btn bad" id="apRec">Recusar selecionados</button>
    <button class="btn good" id="apOk">Aprovar selecionados</button></div>
    <div class="muted small" style="margin-bottom:8px">Aprovou, está no controle — não precisa mais copiar para as abas PA/VET. O canal (VD/VET) vem do consolidado; corrija na edição se precisar.</div>
    <div id="apList" class="muted">Carregando…</div>`;
  let recs;
  try { recs = (await api('pendentes')).recs; } catch (e) { $('#apList').textContent = e.message; return; }
  if (!$('#apList')) return;
  setPend(recs.length);
  recs.sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));
  const all = await loadAll().catch(() => []);
  const cnt = reentregaCounts(all);
  if (!$('#apList')) return;
  if (!recs.length) { $('#apList').innerHTML = '<div class="card">Nenhuma pendência. 🎉</div>'; return; }
  $('#apList').innerHTML = `<div class="tbl-wrap"><table><thead><tr><th><input type="checkbox" id="apChkAll"></th><th>Tipo</th><th>Data</th><th>Hora</th><th>NF</th><th>Retornos</th><th>Canal</th><th>Cliente</th><th>Motivo</th><th class="num">Valor</th><th>Motorista</th><th>Transp.</th><th>Conferente</th><th>Turno</th><th></th></tr></thead><tbody>
  ${recs.map((r) => { const n = r.tipo === 'REENTREGA' ? (cnt[r.nf] || []).length : 0; return `<tr data-ref="${monthOf(r.data)}|${r.id}">
    <td><input type="checkbox" class="apChk"></td><td>${TIPOS[r.tipo]}</td><td>${fD(r.data)}</td><td>${esc(r.hora || '')}</td><td><b>${esc(r.nf)}</b>${r.nfd ? '<div class="muted small">NFD ' + esc(r.nfd) + '</div>' : ''}</td>
    <td>${n ? `<span class="times t${Math.min(n, 4)}">${n}×</span>` : ''}</td>
    <td>${canalTag(r.canal)}${esc(r.canal)}${r.cruzado ? '' : ' <span class="muted small">(sem consolidado)</span>'}</td>
    <td class="wrap">${esc(r.cliente || '')}</td><td>${esc(r.motivo || '')}</td><td class="num">${fMoney(r.valor)}</td><td>${esc(r.motorista || '')}</td><td>${esc(r.transportadora || '')}</td><td>${esc(r.conferente || '')}</td><td>${esc(r.turno || '')}</td>
    <td><button class="link apEdit">editar</button></td></tr>`; }).join('')}
  </tbody></table></div>`;
  const sel = () => $$('.apChk').filter((c) => c.checked).map((c) => c.closest('tr').dataset.ref);
  $('#apChkAll').onchange = (e) => $$('.apChk').forEach((c) => c.checked = e.target.checked);
  $('#apSelAll').onclick = () => { $$('.apChk').forEach((c) => c.checked = true); $('#apChkAll').checked = true; };
  const act = async (status) => {
    const refs = sel(); if (!refs.length) return toast('Selecione ao menos um', true);
    let motivoRecusa;
    if (status === 'RECUSADO') { motivoRecusa = MOTIVO_RECUSA; if (!confirm(`Recusar ${refs.length} registro(s) por ${MOTIVO_RECUSA}?`)) return; }
    try { await api('status', { refs, status, motivoRecusa }); invalidate(); toast(`${refs.length} registro(s) ${status === 'APROVADO' ? 'aprovado(s)' : 'recusado(s)'}`); vAprovacoes(); } catch (e) { toast(e.message, true); }
  };
  $('#apOk').onclick = () => act('APROVADO'); $('#apRec').onclick = () => act('RECUSADO');
  $$('.apEdit').forEach((b) => b.onclick = () => { const ref = b.closest('tr').dataset.ref; const r = recs.find((x) => monthOf(x.data) + '|' + x.id === ref); editModal(r, vAprovacoes); });
}

// ============ EDIÇÃO ============
const CAMPOS = {
  base: [['data', 'Data', 'date'], ['hora', 'Horário', 'time'], ['nf', 'NF', 'text'], ['canal', 'Canal', 'canal'], ['status', 'Status', 'status'], ['motivo', 'Motivo', 'motivo'], ['turno', 'Turno', 'turno'], ['conferente', 'Conferente', 'text']],
  mot: [['motorista', 'Motorista', 'text'], ['placa', 'Placa', 'text'], ['transportadora', 'Transportadora', 'transp']],
  REENTREGA: [['valor', 'Valor (R$)', 'num'], ['peso', 'Peso (kg)', 'num']],
  NFD: [['nfd', 'Nº NFD', 'text'], ['dataEmissao', 'Data emissão', 'date'], ['valor', 'Valor NFD (R$)', 'num']],
  OCORRENCIA: [['dataEntrega', 'Data da entrega', 'date'], ['descontoMotorista', 'Desconto do motorista', 'desconto']],
  CANCELADA: [['orEntrada', 'OR de entrada', 'text'], ['dataRetornoEstoque', 'Retorno ao estoque', 'date']],
  fim: [['obs', 'Observação', 'text']]
};
function editModal(r, after) {
  const campos = [...CAMPOS.base, ...(r.tipo === 'CANCELADA' ? [] : CAMPOS.mot), ...(CAMPOS[r.tipo] || []), ...CAMPOS.fim];
  const inp = ([k, lb, ty]) => {
    const v = r[k] ?? '';
    if (ty === 'canal') return `<label>${lb}<select data-k="${k}">${opts([...CANAIS, 'N/D'], v, false)}</select></label>`;
    if (ty === 'status') return `<label>${lb}<select data-k="${k}">${opts(['PENDENTE', 'APROVADO', 'RECUSADO'], v, false)}</select></label>`;
    if (ty === 'motivo') { const l = motivosDo(r.tipo); return `<label>${lb}<select data-k="${k}">${opts(l.includes(v) || !v ? l : [v, ...l], v)}</select></label>`; }
    if (ty === 'desconto') return `<label>${lb}<select data-k="${k}">${'<option value=""></option>' + DESCONTOS.map((d) => `<option value="${d}" ${d === v ? 'selected' : ''}>${DESC_LB[d]}</option>`).join('')}</select></label>`;
    if (ty === 'turno') return `<label>${lb}<select data-k="${k}">${opts(S.cfg.turnos, v)}</select></label>`;
    if (ty === 'transp') { const l = S.cfg.transportadoras; return `<label>${lb}<select data-k="${k}">${opts(l.includes(v) || !v ? l : [v, ...l], v)}</select></label>`; }
    return `<label>${lb}<input data-k="${k}" type="${ty === 'num' ? 'text' : ty}" value="${esc(ty === 'num' && v !== '' ? String(v).replace('.', ',') : v)}"></label>`;
  };
  openModal(`<h2>Editar ${TIPOS[r.tipo]} · NF ${esc(r.nf)}</h2>
    <div class="muted small" style="margin-bottom:10px">${r.cruzado ? `Consolidado: ${esc(r.cliente || '')} · canal ${esc(r.canalFat || '')} · ${esc(r.transpFat || '')}` : 'NF sem cruzamento no consolidado'} · criado por ${esc(r.criadoPor || '')} ${r.aprovadoPor ? '· aprovado por ' + esc(r.aprovadoPor) : ''}</div>
    <div class="grid g3">${campos.map(inp).join('')}</div>
    ${itensHTML(r) ? `<div class="fld-l" style="margin-top:12px">Itens com desconto</div>${itensHTML(r)}` : ''}
    ${galeriaHTML(r) ? `<div class="fld-l" style="margin-top:12px">Fotos</div>${galeriaHTML(r)}` : ''}
    <div class="row" style="margin-top:14px"><button class="btn bad" id="mDel">Excluir</button><span class="spacer"></span><button class="btn" id="mCancel">Cancelar</button><button class="btn primary" id="mSave">Salvar</button></div>`);
  $('#mCancel').onclick = closeModal;
  $('#mDel').onclick = async () => {
    if (!confirm(`Excluir ${TIPOS[r.tipo]} da NF ${r.nf}?`)) return;
    try { await api('delete', { id: r.id, m: monthOf(r.data) }); invalidate(); closeModal(); toast('Excluído'); after && after(); } catch (e) { toast(e.message, true); }
  };
  $('#mSave').onclick = async () => {
    const rec = { id: r.id, tipo: r.tipo };
    $$('#modalBox [data-k]').forEach((i) => { const k = i.dataset.k; let v = i.value; if (['valor', 'peso'].includes(k)) v = numIn(v); rec[k] = v; });
    if (rec.canal !== r.canal) rec.canalAuto = false;
    try {
      if (rec.status !== r.status) { /* status via save mantém auditoria simples */ }
      await api('save', { rec, oldMonth: monthOf(r.data) });
      invalidate(); closeModal(); toast('Salvo'); after && after();
    } catch (e) { toast(e.message, true); }
  };
}
function openModal(h) { $('#modalBox').innerHTML = h; $('#modal').classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

// ============ REGISTROS ============
const RF = { de: null, ate: null, tipo: 'REENTREGA', status: '', transp: '', q: '', sort: 'data', dir: -1, lim: {}, fechado: {}, sel: new Set() };
// [chave, rótulo, classe, largura, prioridade] · p2/p3 somem quando a tela fica estreita (continuam no detalhe ao passar o mouse)
const RCOLS = {
  REENTREGA: [['data', 'Data', '', 90], ['hora', 'Hora', '', 54, 'p3'], ['nf', 'NF', '', 76], ['_n', 'Vezes', 'num', 60], ['cliente', 'Cliente', 'wrap'], ['cidade', 'Cidade', 'wrap', 120, 'p3'], ['motivo', 'Motivo', 'wrap', 180], ['valor', 'Valor', 'num', 114], ['motorista', 'Motorista', 'wrap', 130, 'p2'], ['transportadora', 'Transp.', 'wrap', 100, 'p2']],
  NFD: [['data', 'Data', '', 90], ['hora', 'Hora', '', 54, 'p3'], ['nf', 'NF ref.', '', 76], ['nfd', 'Nº NFD', '', 70], ['cliente', 'Cliente', 'wrap'], ['motivo', 'Motivo', 'wrap', 120], ['valor', 'Valor NFD', 'num', 114], ['_fotos', 'Fotos', '', 64], ['motorista', 'Motorista', 'wrap', 130, 'p2'], ['transportadora', 'Transp.', 'wrap', 100, 'p2']],
  OCORRENCIA: [['data', 'Data', '', 90], ['hora', 'Hora', '', 54, 'p3'], ['nf', 'NF origem', '', 80], ['cliente', 'Cliente', 'wrap'], ['cidade', 'Cidade', 'wrap', 120, 'p3'], ['motivo', 'Motivo', 'wrap', 130], ['descontoMotorista', 'Desc. motorista', '', 118], ['_itens', 'Itens', '', 92], ['_fotos', 'Fotos', '', 64], ['motorista', 'Motorista', 'wrap', 130, 'p2'], ['transportadora', 'Transp.', 'wrap', 100, 'p2']],
  CANCELADA: [['data', 'Processamento', '', 108], ['nf', 'NF', '', 76], ['cliente', 'Cliente', 'wrap'], ['cidade', 'Cidade', 'wrap', 120, 'p3'], ['valorNF', 'Valor NF', 'num', 114], ['orEntrada', 'OR entrada', '', 92, 'p2'], ['dataRetornoEstoque', 'Retorno estoque', '', 116]]
};
// informações secundárias: aparecem ao passar o mouse na linha
function detalhesHTML(r) {
  const it = [
    ['Representante', r.rep], ['Pedido', r.pedido], ['Faturamento', fD(r.dtFat)], ['Valor NF', r.tipo !== 'CANCELADA' && r.valorNF != null && fMoney(r.valorNF)],
    ['Hora', r.hora], ['Cidade', r.cidade], ['Motorista', r.motorista], ['Transportadora', r.transportadora], ['OR de entrada', r.orEntrada],
    ['Peso', r.peso != null && fNum(r.peso, 1) + ' kg'], ['Bairro', r.bairro], ['Data emissão NFD', fD(r.dataEmissao)], ['Data da entrega', fD(r.dataEntrega)],
    ['Placa', r.placa], ['Conferente', r.conferente], ['Turno', r.turno], ['Observação', r.obs],
    ['Lançado por', r.criadoPor && (r.criadoPor + (r.criadoEm ? ' · ' + new Date(r.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''))],
    [r.status === 'RECUSADO' ? 'Recusado por' : 'Aprovado por', r.aprovadoPor && (r.aprovadoPor + (r.aprovadoEm ? ' · ' + new Date(r.aprovadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : ''))],
    ['Motivo da recusa', r.status === 'RECUSADO' && (r.motivoRecusa || MOTIVO_RECUSA)],
    ['Desconto motorista', r.descontoMotorista && DESC_LB[r.descontoMotorista]],
    ['Fotos', nFotos(r) || null],
    ['Itens', (r.itens || []).map((x) => `${x.cod} × ${x.qtd}`).join(' · ')],
    ['Avarias', (r.fotosAvaria || []).map((a) => a.desc).filter(Boolean).join(' · ')],
    ['Consolidado', r.cruzado ? `${r.canalFat || ''} · ${r.transpFat || ''}` : 'NF não encontrada']
  ].filter(([, v]) => v);
  return `<div class="tip-h">NF ${esc(r.nf)} · ${esc(r.cliente || '')}</div><div class="tip-g">${it.map(([k, v]) => `<span>${k}</span><b>${esc(v)}</b>`).join('')}</div>`;
}
const GRUPOS = [['VD', 'Venda Direta (VD)'], ['VET', 'Vet Criador (VET)'], ['OUTROS', 'Promocional / sem canal']];
const grupoDe = (r) => (r.canal === 'VD' || r.canal === 'VET' ? r.canal : 'OUTROS');

const PERS = [['hoje', 'Hoje'], ['ontem', 'Ontem'], ['semana', 'Esta semana'], ['mes', 'Este mês']];
function perRange(p) {
  const t = todayISO();
  if (p === 'ontem') { const y = addDays(t, -1); return [y, y]; }
  if (p === 'semana') { const d = new Date(t + 'T12:00:00'); const w = (d.getDay() + 6) % 7; return [addDays(t, -w), t]; } // segunda até hoje
  if (p === 'mes') return [t.slice(0, 8) + '01', t];
  return [t, t];
}
async function vRegistros() {
  if (!TIPOS_ATIVOS[RF.tipo]) RF.tipo = 'REENTREGA';
  RF.per = 'hoje'; [RF.de, RF.ate] = perRange('hoje');
  RF.sel = new Set();
  const m = $('#main'); m.classList.add('full');
  m.innerHTML = `<div class="reg-page">
  <div class="reg-tabs" id="rTabs">${Object.entries(TIPOS_ATIVOS).map(([k, v]) => `<button data-t="${k}" class="${RF.tipo === k ? 'on' : ''}">${v} <b data-c="${k}">·</b></button>`).join('')}
    <span class="spacer"></span><button class="btn-aprov" id="rApDia">📋 Aprovados do dia <b id="rApN">0</b></button></div>
  <div class="reg-filters">
    <div class="per-chips" id="rPer">${PERS.map(([k, l]) => `<button data-p="${k}" class="${RF.per === k ? 'on' : ''}">${l} <b data-pc="${k}">·</b></button>`).join('')}
      <span class="per-custom ${RF.per === 'custom' ? 'on' : ''}" id="rPerC">📅 <input type="date" id="rDe" value="${RF.de}" title="De"> até <input type="date" id="rAte" value="${RF.ate}" title="Até"></span></div>
    <label>Status<select id="rStatus"><option value="">Todos</option>${opts(['PENDENTE', 'APROVADO', 'RECUSADO'], RF.status, false)}</select></label>
    <label>Transportadora<select id="rTransp"><option value="">Todas</option>${opts(S.cfg.transportadoras, RF.transp, false)}</select></label>
    <label class="grow">Buscar (NF, cliente, motorista, representante)<input id="rQ" value="${esc(RF.q)}" placeholder="Digite para filtrar"></label>
    <button class="btn" id="rRef" title="Recarregar dados">↻ Atualizar</button>
  </div>
  <div class="reg-mid"><div class="reg-body" id="rOut"><div class="muted" style="padding:16px">Carregando…</div></div>
  <aside class="apdia ${RF.apOpen ? '' : 'hidden'}" id="apDia"></aside></div>
  <div id="tip" class="tip hidden"></div>
  <div class="reg-bar">
    <span id="rSelInfo" class="muted">Nenhum registro selecionado</span><span class="spacer"></span>
    ${isAdm() ? '<button class="btn good" id="rAprov" disabled>✓ Aprovar</button><button class="btn bad" id="rRecus" disabled>✕ Recusar</button><button class="btn" id="rEditar" disabled>✎ Editar</button>' : ''}
    <button class="btn" id="rExp">⤓ Exportar Excel</button>
  </div></div>`;
  $$('#rTabs button').forEach((b) => b.onclick = () => { RF.tipo = b.dataset.t; RF.sel.clear(); RF.lim = {}; if (!RCOLS[RF.tipo].some((c) => c[0] === RF.sort)) RF.sort = 'data'; $$('#rTabs button').forEach((x) => x.classList.toggle('on', x === b)); renderRegistros(); });
  const bind = (id, k) => { $(id).onchange = $(id).oninput = () => { RF[k] = $(id).value; RF.lim = {}; renderRegistros(); }; };
  $$('#rPer button').forEach((b) => b.onclick = () => { RF.per = b.dataset.p; [RF.de, RF.ate] = perRange(RF.per); $('#rDe').value = RF.de; $('#rAte').value = RF.ate; RF.lim = {}; renderRegistros(); });
  ['#rDe', '#rAte'].forEach((id) => $(id).onchange = () => { RF.per = 'custom'; RF.de = $('#rDe').value; RF.ate = $('#rAte').value || RF.de; if (RF.ate < RF.de) { RF.ate = RF.de; $('#rAte').value = RF.de; } RF.lim = {}; renderRegistros(); });
  bind('#rStatus', 'status'); bind('#rTransp', 'transp'); bind('#rQ', 'q');
  $('#rRef').onclick = async () => { await loadAll(true); renderRegistros(); };
  $('#rApDia').onclick = () => { RF.apOpen = !RF.apOpen; $('#apDia').classList.toggle('hidden', !RF.apOpen); renderApDia(); };
  $('#rExp').onclick = () => { const rows = filtraRegistros(); const sel = rows.filter((r) => RF.sel.has(r.id)); exportXlsx(sel.length ? sel : rows, 'registros_' + RF.tipo.toLowerCase()); };
  if (isAdm()) {
    const acao = async (status) => {
      const recs = S.cache.filter((r) => RF.sel.has(r.id)); if (!recs.length) return;
      let motivoRecusa; if (status === 'RECUSADO') { motivoRecusa = MOTIVO_RECUSA; if (!confirm(`Recusar ${recs.length} registro(s) por ${MOTIVO_RECUSA}?`)) return; }
      try { await api('status', { refs: recs.map((r) => monthOf(r.data) + '|' + r.id), status, motivoRecusa }); toast(`${recs.length} registro(s) ${status === 'APROVADO' ? 'aprovado(s)' : 'recusado(s)'}`); RF.sel.clear(); await loadAll(true); renderRegistros(); } catch (e) { toast(e.message, true); }
    };
    $('#rAprov').onclick = () => acao('APROVADO'); $('#rRecus').onclick = () => acao('RECUSADO');
    $('#rEditar').onclick = () => { const r = S.cache.find((x) => RF.sel.has(x.id)); if (r) editModal(r, () => loadAll().then(renderRegistros)); };
  }
  try { await loadAll(); renderRegistros(); } catch (e) { $('#rOut').textContent = e.message; }
}
function filtraRegistros(ignoraTipo, de = RF.de, ate = RF.ate) {
  const q = strip(RF.q);
  const cnt = reentregaCounts(S.cache);
  return S.cache.filter((r) => r.data >= de && r.data <= ate && (ignoraTipo || r.tipo === RF.tipo) && (!RF.status || r.status === RF.status) && (!RF.transp || r.transportadora === RF.transp)
    && (!q || strip([r.nf, r.cliente, r.motorista, r.rep, r.nfd, r.conferente, r.cidade].join(' ')).includes(q)))
    .map((r) => ({ ...r, _n: r.tipo === 'REENTREGA' ? (cnt[r.nf] || []).length : 0 }));
}
function cellReg(r, [k, , cls]) {
  const v = r[k];
  if (cls === 'wrap' && k !== 'cliente') return `<td class="wrap">${esc(v ?? '')}</td>`;
  if (k === 'data' || k === 'dataEmissao' || k === 'dataEntrega' || k === 'dataRetornoEstoque') return `<td>${fD(v)}</td>`;
  if (k === 'nf') return `<td><button class="link nfLink">${esc(v)}</button></td>`;
  if (k === '_itens') { const it = r.itens || []; return `<td>${it.length ? `${it.length} · ${fNum(it.reduce((s, x) => s + (x.qtd || 0), 0))} un` : ''}</td>`; }
  if (k === '_fotos') { const n = nFotos(r); return `<td>${n ? `<span class="ph-badge">📷 ${n}</span>` : ''}</td>`; }
  if (k === 'descontoMotorista') return `<td>${v ? `<span class="desc-tag d-${v.replace(' ', '')}">${DESC_LB[v] || esc(v)}</span>` : ''}</td>`;
  if (k === '_n') return `<td class="num">${v ? `<span class="times t${Math.min(v, 4)}">${v}×</span>` : ''}</td>`;
  if (k === 'valor' || k === 'valorNF') return `<td class="num">${fMoney(v)}</td>`;
  if (k === 'peso') return `<td class="num">${fNum(v, 1)}</td>`;
  if (k === 'cliente') return `<td class="wrap">${esc(v || (r.cruzado === false ? '— sem consolidado' : ''))}</td>`;
  return `<td class="${cls || ''}">${esc(v ?? '')}</td>`;
}
function renderRegistros() {
  if (!$('#rOut') || !S.cache) return;
  // contadores nas abas
  const todos = filtraRegistros(true);
  $$('#rTabs b[data-c]').forEach((b) => { const n = todos.filter((r) => r.tipo === b.dataset.c).length; const p = todos.filter((r) => r.tipo === b.dataset.c && r.status === 'PENDENTE').length; b.innerHTML = fNum(n) + (p ? ` <i class="pend-dot" title="${p} pendente(s)">${p}</i>` : ''); });
  // contagem de cada período rápido (aba atual + filtros de status/transportadora/busca)
  $$('#rPer b[data-pc]').forEach((b) => { const [a, z] = perRange(b.dataset.pc); b.textContent = fNum(filtraRegistros(false, a, z).length); });
  $$('#rPer button').forEach((b) => b.classList.toggle('on', b.dataset.p === RF.per));
  $('#rPerC') && $('#rPerC').classList.toggle('on', RF.per === 'custom');
  const rows = filtraRegistros();
  const k = RF.sort, d = RF.dir;
  rows.sort((a, b) => { const x = a[k] ?? '', y = b[k] ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * d || ((b.data + (b.hora || '')).localeCompare(a.data + (a.hora || ''))); });
  const cols = RCOLS[RF.tipo];
  const ncol = cols.length + 2;
  const colg = '';
  const head = `<tr><th class="chk" style="width:34px"><input type="checkbox" class="gAll"></th><th class="sort" style="width:110px" data-c="status">Status${RF.sort === 'status' ? (RF.dir > 0 ? ' ▲' : ' ▼') : ''}</th>${cols.map(([c, l, cls, w, pr]) => `<th class="sort ${cls === 'num' ? 'num' : ''} ${pr || ''}" ${w ? `style="width:${w}px"` : ''} data-c="${c}">${l}${RF.sort === c ? (RF.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr>`;
  let html = '';
  for (const [g, nome] of GRUPOS) {
    const gr = rows.filter((r) => grupoDe(r) === g);
    if (g === 'OUTROS' && !gr.length) continue;
    const st = { APROVADO: 0, PENDENTE: 0, RECUSADO: 0 }; gr.forEach((r) => st[r.status]++);
    const val = gr.reduce((s, r) => s + (Number(RF.tipo === 'CANCELADA' ? r.valorNF : r.valor) || 0), 0);
    const pes = gr.reduce((s, r) => s + (Number(r.peso) || 0), 0);
    const nfs = new Set(gr.map((r) => r.nf)).size;
    const reinc = RF.tipo === 'REENTREGA' ? new Set(gr.filter((r) => r._n >= 2).map((r) => r.nf)).size : 0;
    const lim = RF.lim[g] || 200; const fech = RF.fechado[g];
    html += `<section class="grp ${fech ? 'closed' : ''}" data-g="${g}">
      <header class="grp-h">
        <button class="grp-tg" title="Recolher / expandir">${fech ? '▸' : '▾'}</button>
        <span class="dot c-${g === 'OUTROS' ? 'ND' : g}"></span><b class="grp-n">${nome}</b>
        <span class="grp-s"><span>Registros <b>${fNum(gr.length)}</b></span><span>NFs <b>${fNum(nfs)}</b></span>
        ${RF.tipo === 'REENTREGA' ? `<span>Reincidentes <b>${fNum(reinc)}</b></span>` : ''}
        ${RF.tipo !== 'OCORRENCIA' ? `<span>Valor <b>${fMoney(val)}</b></span>` : ''}${RF.tipo === 'REENTREGA' ? `<span>Peso <b>${fNum(pes, 0)} kg</b></span>` : ''}</span>
        <span class="spacer"></span>
        <span class="grp-st"><span class="pill APROVADO" title="Aprovados">✓ ${fNum(st.APROVADO)} aprovados</span><span class="pill PENDENTE" title="Pendentes">● ${fNum(st.PENDENTE)} pendentes</span><span class="pill RECUSADO" title="Recusados">✕ ${fNum(st.RECUSADO)} recusados</span></span>
      </header>
      <div class="grp-b"><table class="fixed">${colg}<thead>${head}</thead><tbody>
      ${gr.length ? gr.slice(0, lim).map((r) => `<tr data-id="${r.id}" class="${RF.sel.has(r.id) ? 'sel' : ''} st-${r.status}"><td class="chk"><input type="checkbox" class="rChk" ${RF.sel.has(r.id) ? 'checked' : ''}></td><td>${pill(r.status)}</td>${cols.map((c) => (c[4] ? cellReg(r, c).replace('<td', `<td data-p="${c[4]}"`) : cellReg(r, c))).join('')}</tr>`).join('')
        : `<tr><td colspan="${ncol}" class="muted" style="padding:14px">Nenhum registro ${RF.per === 'hoje' ? 'hoje' : RF.per === 'ontem' ? 'ontem' : 'no período'} neste canal.</td></tr>`}
      </tbody></table>${gr.length > lim ? `<div class="grp-more"><button class="btn rMore" data-g="${g}">Mostrar mais ${fNum(Math.min(500, gr.length - lim))} de ${fNum(gr.length - lim)} restantes</button></div>` : ''}</div>
    </section>`;
  }
  $('#rOut').innerHTML = html;
  $$('#rOut th.sort').forEach((th) => th.onclick = () => { const c = th.dataset.c; if (RF.sort === c) RF.dir *= -1; else { RF.sort = c; RF.dir = c === 'data' ? -1 : 1; } renderRegistros(); });
  $$('#rOut .grp-tg').forEach((b) => b.onclick = () => { const g = b.closest('.grp').dataset.g; RF.fechado[g] = !RF.fechado[g]; renderRegistros(); });
  $$('#rOut .rMore').forEach((b) => b.onclick = () => { RF.lim[b.dataset.g] = (RF.lim[b.dataset.g] || 200) + 500; renderRegistros(); });
  $$('#rOut .rEdit').forEach((b) => b.onclick = () => editModal(S.cache.find((x) => x.id === b.closest('tr').dataset.id), () => loadAll().then(renderRegistros)));
  $$('#rOut .nfLink').forEach((b) => b.onclick = () => { consultaNF = b.textContent; go('consulta'); });
  $$('#rOut .rChk').forEach((c) => c.onchange = () => { const id = c.closest('tr').dataset.id; c.checked ? RF.sel.add(id) : RF.sel.delete(id); c.closest('tr').classList.toggle('sel', c.checked); updSel(); });
  $$('#rOut .gAll').forEach((c) => c.onchange = () => { c.closest('.grp').querySelectorAll('.rChk').forEach((x) => { x.checked = c.checked; const id = x.closest('tr').dataset.id; c.checked ? RF.sel.add(id) : RF.sel.delete(id); x.closest('tr').classList.toggle('sel', c.checked); }); updSel(); });
  bindTip(); renderApDia();
  if (isAdm()) $$('#rOut tbody tr[data-id]').forEach((tr) => tr.ondblclick = () => editModal(S.cache.find((x) => x.id === tr.dataset.id), () => loadAll().then(renderRegistros)));
  updSel();
}
// ---- aprovados do dia (só reentregas), para copiar e colar ----
const localDay = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function renderApDia() {
  if (!RF.apDia) RF.apDia = todayISO();
  const lista = (S.cache || []).filter((r) => r.tipo === 'REENTREGA' && r.status === 'APROVADO' && localDay(r.aprovadoEm) === RF.apDia)
    .sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));
  if ($('#rApN')) $('#rApN').textContent = lista.length;
  const el = $('#apDia'); if (!el || el.classList.contains('hidden')) return;
  const linha = (r) => [r.nf, fD(r.data), r.motivo || '', r.transportadora || ''].join('\t');
  const bloco = (g, nome) => {
    const l = lista.filter((r) => grupoDe(r) === g); if (!l.length && g === 'OUTROS') return '';
    return `<div class="ap-g"><div class="ap-gh"><span class="dot c-${g === 'OUTROS' ? 'ND' : g}"></span><b>${nome}</b><span class="muted small">${l.length} NF(s)</span><span class="spacer"></span>
      <button class="btn sm apCopy" data-g="${g}" ${l.length ? '' : 'disabled'} title="Copia os números das NFs, um por linha">Copiar</button></div>
      ${l.length ? `<table class="ap-t"><thead><tr><th>NF</th><th>Data retorno</th><th>Motivo</th><th>Transp.</th></tr></thead><tbody>${l.map((r) => `<tr><td><b>${esc(r.nf)}</b></td><td>${fD(r.data)}</td><td>${esc(r.motivo || '')}</td><td>${esc(r.transportadora || '')}</td></tr>`).join('')}</tbody></table>` : '<div class="muted small" style="padding:8px 2px">Nenhuma reentrega aprovada.</div>'}</div>`;
  };
  el.innerHTML = `<div class="ap-h"><b>Reentregas aprovadas</b><button class="link" id="apClose">fechar ✕</button></div>
    <label>Aprovadas em<input type="date" id="apData" value="${RF.apDia}"></label>
    <div class="muted small">"Copiar" leva só os números das NFs, um por linha.</div>
    ${bloco('VD', 'VD')}${bloco('VET', 'VET')}${bloco('OUTROS', 'Promo / sem canal')}`;
  $('#apClose').onclick = () => { RF.apOpen = false; el.classList.add('hidden'); };
  $('#apData').onchange = () => { RF.apDia = $('#apData').value; renderApDia(); };
  const copiar = async (txt, n) => { try { await navigator.clipboard.writeText(txt); } catch { const t = document.createElement('textarea'); t.value = txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toast(`${n} NF(s) copiada(s)`); };
  $$('.apCopy', el).forEach((b) => b.onclick = () => { const l = lista.filter((r) => grupoDe(r) === b.dataset.g); copiar(l.map((r) => r.nf).join('\n'), l.length); });
}
// ---- tooltip de detalhes ----
function bindTip() {
  const tip = $('#tip'); let t;
  $$('#rOut tbody tr[data-id]').forEach((tr) => {
    tr.onmouseenter = (e) => { clearTimeout(t); t = setTimeout(() => { const r = S.cache.find((x) => x.id === tr.dataset.id); if (!r) return; tip.innerHTML = detalhesHTML(r); tip.classList.remove('hidden'); posTip(e); }, 350); };
    tr.onmousemove = (e) => { if (!tip.classList.contains('hidden')) posTip(e); else tr._e = e; };
    tr.onmouseleave = () => { clearTimeout(t); tip.classList.add('hidden'); };
  });
  function posTip(e) { const w = tip.offsetWidth, h = tip.offsetHeight; let x = e.clientX + 16, y = e.clientY + 14; if (x + w > innerWidth - 8) x = e.clientX - w - 16; if (y + h > innerHeight - 8) y = e.clientY - h - 14; tip.style.left = x + 'px'; tip.style.top = y + 'px'; }
}
function updSel() {
  const n = RF.sel.size; const recs = S.cache.filter((r) => RF.sel.has(r.id));
  $('#rSelInfo').innerHTML = n ? `<b>${n}</b> selecionado(s) · ${fMoney(recs.reduce((s, r) => s + (Number(r.valor) || 0), 0))} <button class="link" id="rClr">limpar</button>` : 'Nenhum registro selecionado · marque as linhas para aprovar, recusar ou exportar só elas';
  $('#rClr') && ($('#rClr').onclick = () => { RF.sel.clear(); renderRegistros(); });
  if (isAdm()) { $('#rAprov').disabled = $('#rRecus').disabled = !n; $('#rEditar').disabled = n !== 1; }
}
function exportXlsx(rows, nome) {
  const data = rows.map((r) => ({
    Tipo: TIPOS[r.tipo], Data: fD(r.data), Hora: r.hora || '', NF: r.nf, 'Retornos (histórico)': r._n || '', Canal: r.canal, Cliente: r.cliente || '', Representante: r.rep || '', Pedido: r.pedido || '',
    'Data faturamento': fD(r.dtFat), Cidade: r.cidade || '', Motivo: r.motivo || '', Valor: r.valor ?? '', Peso: r.peso ?? '', 'Nº NFD': r.nfd || '', 'Data emissão NFD': fD(r.dataEmissao), 'Data entrega': fD(r.dataEntrega),
    'OR entrada': r.orEntrada || '', 'Retorno estoque': fD(r.dataRetornoEstoque), Motorista: r.motorista || '', Placa: r.placa || '', Transportadora: r.transportadora || '', Conferente: r.conferente || '', Turno: r.turno || '',
    'Desconto motorista': r.descontoMotorista ? DESC_LB[r.descontoMotorista] : '', 'Qtd fotos': nFotos(r) || '', 'Itens (código × qtd)': (r.itens || []).map((x) => `${x.cod} × ${x.qtd}`).join('\n'),
    'Itens (descrição)': (r.itens || []).map((x) => `${x.desc} × ${x.qtd}`).join('\n'),
    'Foto documento': /^https?:/.test(r.fotoDoc || '') ? r.fotoDoc : '', 'Fotos avaria (descrição | link)': (r.fotosAvaria || []).map((a) => (a.desc || 'sem descrição') + (/^https?:/.test(a.url) ? ' | ' + a.url : '')).join('\n'),
    Status: r.status, 'Aprovado por': r.aprovadoPor || '', Observação: r.obs || '', 'Cruzou consolidado': r.cruzado ? 'SIM' : 'NÃO', 'Aba origem (import)': r.abaOrigem || ''
  }));
  const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  XLSX.writeFile(wb, `${nome}_${todayISO()}.xlsx`);
}

// ============ CONSULTA NF ============
let consultaNF = '';
function vConsulta() {
  $('#main').innerHTML = `<div class="card row" style="margin-bottom:12px"><label style="max-width:320px">Nota fiscal<input id="cNF" class="nfbig" inputmode="numeric" value="${esc(consultaNF)}" placeholder="Digite e tecle Enter"></label><button class="btn primary big" id="cGo">Consultar</button></div><div id="cOut"></div>`;
  const run = async () => {
    const nf = $('#cNF').value.replace(/\D/g, ''); if (!nf) return; consultaNF = nf;
    $('#cOut').innerHTML = '<div class="muted">Buscando…</div>';
    try {
      const j = await api('lookup?nf=' + nf); const f = j.fat;
      const reent = j.hist.filter((h) => h.tipo === 'REENTREGA' && h.status !== 'RECUSADO').length;
      $('#cOut').innerHTML = `<div class="grid g2" style="align-items:start">
      <div class="card"><h3>Consolidado de faturamento</h3>${f ? `<div class="kv">
        <div><span>Canal</span><b>${canalTag(f[0])}${esc(f[0])}</b></div><div><span>Transportadora</span>${esc(f[1])}</div><div style="grid-column:1/-1"><span>Cliente</span>${esc(f[2] || f[3])}</div>
        <div><span>Pedido</span>${esc(f[4] || '')}</div><div><span>Faturamento</span>${fD(f[5])}</div><div><span>Valor NF</span>${fMoney(f[7])}</div><div><span>Peso bruto</span>${fNum(f[6], 1)} kg</div>
        <div><span>Representante</span>${esc(f[8] || '')}</div><div><span>Cidade / bairro</span>${esc(f[9] || '')} ${f[10] ? '· ' + esc(f[10]) : ''}</div></div>` : `<div class="alert warn">NF não encontrada no consolidado.</div><div class="muted small" style="margin-top:6px">${baseTxt(j.base)}</div>`}</div>
      <div class="card"><h3>Histórico da NF ${esc(nf)} ${reent ? `· <span class="times t${Math.min(reent, 4)}">${reent}×</span> reentrega(s)` : ''}</h3>
      ${j.hist.length ? `<div class="tl">${j.hist.map((h) => `<div class="tl-item"><div><div class="d">${fD(h.data)}</div><div class="muted small">${esc(h.hora || '')} ${h.turno ? '· ' + esc(h.turno) : ''}</div></div>
        <div><b>${TIPOS[h.tipo]}</b> ${pill(h.status)} ${h.motivo ? '· ' + esc(h.motivo) : ''}${h.nfd ? ' · NFD ' + esc(h.nfd) : ''}${h.orEntrada ? ' · OR ' + esc(h.orEntrada) : ''}
        <div class="muted small">${[h.motorista, h.transportadora, h.conferente && 'Conf.: ' + h.conferente, h.valor != null && fMoney(h.valor), h.obs].filter(Boolean).map(esc).join(' · ')}</div>
        ${h.descontoMotorista ? `<div class="small">Desconto do motorista: <b>${DESC_LB[h.descontoMotorista] || esc(h.descontoMotorista)}</b></div>` : ''}
        ${itensHTML(h)}
        ${galeriaHTML(h)}
        ${isAdm() ? `<button class="link cEdit" data-id="${h.id}">editar</button>` : ''}</div></div>`).join('')}</div>` : '<div class="muted">Nenhum registro para esta NF.</div>'}</div></div>`;
      $$('.cEdit').forEach((b) => b.onclick = () => editModal(j.hist.find((x) => x.id === b.dataset.id), run));
    } catch (e) { $('#cOut').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
  };
  $('#cGo').onclick = run; $('#cNF').onkeydown = (e) => { if (e.key === 'Enter') run(); };
  if (consultaNF) run(); else $('#cNF').focus();
}

$$('#nav button').forEach((b) => b.onclick = () => go(b.dataset.v));
$('#logout').onclick = logout;
