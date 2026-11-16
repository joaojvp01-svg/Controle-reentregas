// API única do Controle de Reentregas (Vercel Serverless + Upstash Redis)
// Todas as rotas: /api/<acao>  (ex.: /api/login, /api/list?m=2026-11)
const crypto = require('crypto');
const { getRedis } = require('../lib/redis');
const { storeImage, readImage } = require('../lib/blob');

const SECRET = () => process.env.AUTH_SECRET || process.env.ADMIN_PASSWORD || 'troque-este-segredo';
const TTL_HORAS = 14;

// ---------- utilitários ----------
function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const h = crypto.createHmac('sha256', SECRET()).update(b).digest('base64url');
  return b + '.' + h;
}
function verify(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [b, h] = tok.split('.');
  const hh = crypto.createHmac('sha256', SECRET()).update(b).digest('base64url');
  if (h.length !== hh.length || !crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hh))) return null;
  try { const p = JSON.parse(Buffer.from(b, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
const P = (v) => { if (v == null) return null; if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; };
const S = (v) => JSON.stringify(v);
const newId = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const monthOf = (d) => (d || '').slice(0, 7);
const nowISO = () => new Date().toISOString();

async function hm(r, key, fields) {
  if (!fields.length) return [];
  const out = [];
  for (let i = 0; i < fields.length; i += 1000) {
    const part = fields.slice(i, i + 1000);
    const res = await r.hmget(key, ...part);
    if (Array.isArray(res)) out.push(...res);
    else if (res && typeof res === 'object') out.push(...part.map((f) => (f in res ? res[f] : null)));
    else out.push(...part.map(() => null));
  }
  return out;
}

const DEFAULT_CFG = {
  motivosReentrega: [
    'FALTA DE TEMPO HÁBIL', 'LOCAL FECHADO', 'CLIENTE AUSENTE', 'FORA DE ROTA', 'DESACORDO COMERCIAL',
    'PEDIDO NÃO REALIZADO', 'CLIENTE RECUSOU O PEDIDO', 'DIVERGÊNCIA NO PEDIDO', 'RESTRIÇÃO DE VEÍCULO',
    'SEM ESPAÇO PARA RECEBIMENTO', 'SEM LOCAL PARA ESTACIONAR', 'SEM AGENDAMENTO', 'ENDEREÇO INCORRETO',
    'FALTA DE MERCADORIA', 'MERCADORIA AVARIADA', 'NÃO COUBE NO VEÍCULO', 'VEÍCULO QUEBROU', 'NÃO SAIU DO CD',
    'CLIMA', 'MOTORISTA NÃO QUIS AGUARDAR', 'DUPLICADO', 'OUTROS'
  ],
  motivosNFD: ['AVARIA', 'FALTA', 'AVARIA/FALTA', 'DEVOLUÇÃO', 'OUTROS'],
  motivosOcorrencia: ['AVARIA', 'FALTA', 'AVARIA/FALTA', 'SOBRA', 'DEVOLUÇÃO', 'DESCONTO', 'VALIDADE', 'OUTROS'],
  transportadoras: ['DESCALVADO', 'FULL FLEX', 'PET SUPPLIES', 'FRETESAVING', '3ZX', 'ENZO', 'EZX', 'ICE BOYS'],
  conferentes: [],
  turnos: ['1°', '2°', '3°'],
  // Faixas de horário para sugerir o turno automaticamente (HH:MM)
  turnoHoras: { '1°': ['06:00', '14:20'], '2°': ['14:20', '22:00'], '3°': ['22:00', '06:00'] }
};

async function getCfg(r) {
  const c = P(await r.get('cfg')) || {};
  return { ...DEFAULT_CFG, ...c };
}

// Snapshot dos dados do consolidado dentro do registro
// layout do array fat: [canal, transp, razao, fantasia, pedido, dtFat, pesoBruto, valor, rep, cidade, bairro]
function applyFat(rec, f, forceCanal) {
  if (!f) { rec.cruzado = false; return rec; }
  rec.cruzado = true;
  rec.canalFat = f[0];
  if (!rec.canal || forceCanal || rec.canalAuto !== false) rec.canal = f[0];
  rec.transpFat = f[1];
  rec.cliente = f[2] || f[3] || rec.cliente;
  rec.pedido = f[4] || rec.pedido;
  rec.dtFat = f[5] || rec.dtFat;
  rec.pesoNF = f[6];
  rec.valorNF = f[7];
  rec.rep = f[8] || rec.rep;
  rec.cidade = f[9] || rec.cidade;
  rec.bairro = f[10] || rec.bairro;
  if (rec.valor == null || rec.valor === '') rec.valor = f[7];
  if (rec.peso == null || rec.peso === '') rec.peso = f[6];
  if (!rec.transportadora) rec.transportadora = f[1];
  return rec;
}

async function indexAdd(r, items) {
  // items: [{nf, ref}] ref = "m|id"
  const nfs = [...new Set(items.map((i) => String(i.nf)))];
  const cur = await hm(r, 'nfidx', nfs);
  const map = {};
  nfs.forEach((nf, i) => { map[nf] = P(cur[i]) || []; });
  items.forEach((i) => { const a = map[String(i.nf)]; if (!a.includes(i.ref)) a.push(i.ref); });
  const upd = {}; nfs.forEach((nf) => { upd[nf] = S(map[nf]); });
  await hsetChunk(r, 'nfidx', upd);
}
async function indexRemove(r, nf, ref) {
  const a = P(await r.hget('nfidx', String(nf))) || [];
  const b = a.filter((x) => x !== ref);
  if (b.length) await r.hset('nfidx', { [String(nf)]: S(b) }); else await r.hdel('nfidx', String(nf));
}
async function hsetChunk(r, key, obj) {
  const ks = Object.keys(obj);
  for (let i = 0; i < ks.length; i += 1000) {
    const part = {}; ks.slice(i, i + 1000).forEach((k) => { part[k] = obj[k]; });
    await r.hset(key, part);
  }
}

async function saveRecords(r, recs) {
  // grava em lote, agrupando por mês; atualiza meses, índice e pendências
  const byM = {};
  for (const rec of recs) { const m = monthOf(rec.data); (byM[m] = byM[m] || {})[rec.id] = S(rec); }
  for (const m of Object.keys(byM)) await hsetChunk(r, 'reg:' + m, byM[m]);
  const ms = Object.keys(byM); if (ms.length) await r.sadd('months', ...ms);
  await indexAdd(r, recs.map((x) => ({ nf: x.nf, ref: monthOf(x.data) + '|' + x.id })));
  const pend = {}; const notPend = [];
  for (const x of recs) { if (x.status === 'PENDENTE') pend[x.id] = monthOf(x.data); else notPend.push(x.id); }
  if (Object.keys(pend).length) await hsetChunk(r, 'pend', pend);
  for (let i = 0; i < notPend.length; i += 500) await r.hdel('pend', ...notPend.slice(i, i + 500));
}

async function getRefs(r, refs) {
  // refs "m|id" -> registros
  const byM = {};
  refs.forEach((ref) => { const [m, id] = ref.split('|'); (byM[m] = byM[m] || []).push(id); });
  const out = [];
  for (const m of Object.keys(byM)) {
    const vals = await hm(r, 'reg:' + m, byM[m]);
    vals.forEach((v) => { const o = P(v); if (o) out.push(o); });
  }
  return out;
}

function clean(rec) {
  const allowed = ['id', 'tipo', 'canal', 'canalAuto', 'nf', 'data', 'hora', 'motivo', 'valor', 'peso', 'motorista', 'placa',
    'transportadora', 'conferente', 'turno', 'status', 'obs', 'nfd', 'dataEmissao', 'dataEntrega', 'orEntrada',
    'dataRetornoEstoque', 'descontoMotorista', 'fotoDoc', 'fotosAvaria', 'cliente', 'rep', 'pedido', 'dtFat', 'cidade', 'bairro', 'origem', 'dataLanc', 'abaOrigem'];
  const o = {};
  for (const k of allowed) if (rec[k] !== undefined && rec[k] !== null && rec[k] !== '') o[k] = rec[k];
  if (o.nf != null) o.nf = String(o.nf).replace(/\D/g, '').replace(/^0+/, '');
  ['valor', 'peso'].forEach((k) => { if (o[k] != null) { const n = Number(o[k]); o[k] = isFinite(n) ? n : undefined; } });
  if (o.descontoMotorista && !['TOTAL', 'PARCIAL', 'SEM DESCONTO'].includes(o.descontoMotorista)) delete o.descontoMotorista;
  if (o.fotoDoc && typeof o.fotoDoc !== 'string') delete o.fotoDoc;
  if (o.fotosAvaria) { o.fotosAvaria = (Array.isArray(o.fotosAvaria) ? o.fotosAvaria : []).filter((f) => f && typeof f.url === 'string').slice(0, 20).map((f) => ({ url: f.url, desc: String(f.desc || '').slice(0, 300) })); if (!o.fotosAvaria.length) delete o.fotosAvaria; }
  return o;
}

// ---------- handler ----------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const url = new URL(req.url, 'http://x');
  const action = (url.pathname.replace(/^\/api\/?/, '').split('/')[0]) || url.searchParams.get('a') || '';
  const q = Object.fromEntries(url.searchParams.entries());
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };

  let r;
  try { r = getRedis(); } catch (e) { return send(500, { error: 'Banco não configurado: ' + e.message }); }

  try {
    // ---- login (público) ----
    if (action === 'login') {
      const { perfil, usuario, senha } = body;
      if (perfil === 'adm') {
        if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD) return send(500, { error: 'ADMIN_USER/ADMIN_PASSWORD não configurados na Vercel' });
        if (String(usuario || '').trim().toLowerCase() !== process.env.ADMIN_USER.toLowerCase() || senha !== process.env.ADMIN_PASSWORD) return send(401, { error: 'Usuário ou senha inválidos' });
        const nome = String(body.nome || usuario).trim().toUpperCase();
        return send(200, { token: sign({ r: 'adm', n: nome, exp: Date.now() + TTL_HORAS * 3600e3 }), perfil: 'adm', nome });
      }
      const nome = String(usuario || '').trim().toUpperCase();
      if (!nome) return send(400, { error: 'Informe seu nome' });
      if (process.env.OPER_PASSWORD && senha !== process.env.OPER_PASSWORD) return send(401, { error: 'Senha da operação inválida' });
      return send(200, { token: sign({ r: 'op', n: nome, exp: Date.now() + TTL_HORAS * 3600e3 }), perfil: 'op', nome });
    }

    // ---- foto (Blob privado): <img src="/api/foto?p=...&t=TOKEN"> ----
    if (action === 'foto') {
      if (!verify(q.t || (req.headers.authorization || '').replace(/^Bearer\s+/i, ''))) { res.statusCode = 401; return res.end('Sem acesso'); }
      const p = String(q.p || '');
      if (!/^reentregas\/[\w./-]+$/.test(p)) { res.statusCode = 400; return res.end('Foto inválida'); }
      const result = await readImage(p, req.headers['if-none-match'] || undefined);
      if (!result) { res.statusCode = 404; return res.end('Foto não encontrada'); }
      res.setHeader('Cache-Control', 'private, max-age=86400');
      if (result.blob && result.blob.etag) res.setHeader('ETag', result.blob.etag);
      if (result.statusCode === 304) { res.statusCode = 304; return res.end(); }
      if (result.statusCode !== 200) { res.statusCode = 404; return res.end('Foto não encontrada'); }
      res.setHeader('Content-Type', result.blob.contentType || 'image/jpeg');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const buf = Buffer.from(await new Response(result.stream).arrayBuffer());
      res.statusCode = 200; return res.end(buf);
    }

    const tok = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = verify(tok);
    if (!user) return send(401, { error: 'Sessão expirada. Entre novamente.' });
    const isAdm = user.r === 'adm';
    const needAdm = () => { if (!isAdm) { send(403, { error: 'Apenas ADM' }); return true; } return false; };

    switch (action) {
      case 'bootstrap': {
        const [cfg, mot, meta, months, pendN] = await Promise.all([
          getCfg(r), r.get('mot'), r.get('fatmeta'), r.smembers('months'), r.hlen('pend')
        ]);
        return send(200, { cfg, motoristas: P(mot) || [], fatMeta: P(meta), months: (months || []).sort(), pendentes: pendN || 0, user: { perfil: user.r, nome: user.n } });
      }
      case 'cfg': {
        if (needAdm()) return;
        const cfg = { ...(await getCfg(r)), ...body.cfg };
        await r.set('cfg', S(cfg));
        return send(200, { cfg });
      }
      case 'motoristas': {
        if (needAdm()) return;
        await r.set('mot', S(body.motoristas || []));
        return send(200, { ok: true, n: (body.motoristas || []).length });
      }
      case 'list': {
        const ms = String(q.m || '').split(',').filter(Boolean).slice(0, 36);
        const out = [];
        await Promise.all(ms.map(async (m) => {
          const h = await r.hgetall('reg:' + m);
          if (h) for (const v of Object.values(h)) { const o = P(v); if (o) out.push(o); }
        }));
        return send(200, { recs: out });
      }
      case 'pendentes': {
        const h = (await r.hgetall('pend')) || {};
        const refs = Object.entries(h).map(([id, m]) => m + '|' + id);
        const recs = await getRefs(r, refs);
        return send(200, { recs });
      }
      case 'upload': {
        const data = String(body.data || '');
        const m = data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
        if (!m) return send(400, { error: 'Imagem inválida' });
        if (data.length > 4.2e6) return send(413, { error: 'Foto muito grande' });
        const url = await storeImage(data, m[1], m[2], `reentregas/${new Date().toISOString().slice(0, 7)}/${newId()}.jpg`);
        return send(200, { url });
      }
      case 'lookup': {
        const nf = String(q.nf || '').replace(/\D/g, '').replace(/^0+/, '');
        if (!nf) return send(400, { error: 'NF inválida' });
        const [f, idx] = await Promise.all([r.hget('fat', nf), r.hget('nfidx', nf)]);
        const hist = await getRefs(r, P(idx) || []);
        hist.sort((a, b) => (a.data + (a.hora || '')).localeCompare(b.data + (b.hora || '')));
        const meta = P(await r.get('fatmeta'));
        return send(200, { nf, fat: P(f), hist, base: meta ? { total: meta.total, de: meta.de, ate: meta.ate } : null });
      }
      case 'save': {
        let rec = clean(body.rec || {});
        if (!rec.nf || !rec.data || !rec.tipo) return send(400, { error: 'NF, data e tipo são obrigatórios' });
        const isNew = !rec.id;
        let old = null;
        if (!isNew) {
          if (needAdm()) return;
          old = P(await r.hget('reg:' + body.oldMonth, rec.id));
          if (!old) return send(404, { error: 'Registro não encontrado' });
          rec = { ...old, ...rec };
          rec.editadoPor = user.n; rec.editadoEm = nowISO();
          if (rec.status !== old.status && rec.status !== 'PENDENTE') { rec.aprovadoPor = user.n; rec.aprovadoEm = nowISO(); }
          if (old.nf !== rec.nf || monthOf(old.data) !== monthOf(rec.data)) {
            await r.hdel('reg:' + monthOf(old.data), old.id);
            await indexRemove(r, old.nf, monthOf(old.data) + '|' + old.id);
          }
        } else {
          rec.id = newId();
          rec.criadoPor = user.n; rec.criadoEm = nowISO();
          rec.origem = 'app';
          // entram como PENDENTE (ADM pode lançar já aprovado)
          if (!isAdm || !rec.status) rec.status = 'PENDENTE';
          if (rec.status === 'APROVADO') { rec.aprovadoPor = user.n; rec.aprovadoEm = nowISO(); }
        }
        const f = P(await r.hget('fat', rec.nf));
        applyFat(rec, f);
        if (!rec.canal) rec.canal = 'N/D';
        await saveRecords(r, [rec]);
        return send(200, { rec });
      }
      case 'status': {
        if (needAdm()) return;
        const { refs = [], status, motivoRecusa } = body; // refs "m|id"
        if (!['APROVADO', 'RECUSADO', 'PENDENTE'].includes(status)) return send(400, { error: 'Status inválido' });
        const recs = await getRefs(r, refs);
        recs.forEach((x) => {
          x.status = status;
          if (status === 'APROVADO') { x.aprovadoPor = user.n; x.aprovadoEm = nowISO(); delete x.motivoRecusa; }
          if (status === 'RECUSADO') { x.aprovadoPor = user.n; x.aprovadoEm = nowISO(); if (motivoRecusa) x.motivoRecusa = motivoRecusa; }
        });
        await saveRecords(r, recs);
        return send(200, { n: recs.length });
      }
      case 'delete': {
        if (needAdm()) return;
        const { id, m } = body;
        const old = P(await r.hget('reg:' + m, id));
        if (!old) return send(404, { error: 'Não encontrado' });
        await r.hdel('reg:' + m, id);
        await r.hdel('pend', id);
        await indexRemove(r, old.nf, m + '|' + id);
        return send(200, { ok: true });
      }
      case 'fat-upload': {
        if (needAdm()) return;
        // rows: [[nf, canal, transp, razao, fantasia, pedido, dtFat, pesoBruto, valor, rep, cidade, bairro], ...]
        const obj = {};
        for (const row of body.rows || []) { const nf = String(row[0]); obj[nf] = S(row.slice(1)); }
        await hsetChunk(r, 'fat', obj);
        return send(200, { n: Object.keys(obj).length });
      }
      case 'fat-finish': {
        if (needAdm()) return;
        // stats: { "2026-07": { "VD|DESCALVADO": {n, v, p}, ... } }
        const st = body.stats || {};
        const upd = {}; Object.keys(st).forEach((m) => { upd[m] = S(st[m]); });
        if (Object.keys(upd).length) await r.hset('fatstats', upd);
        const total = await r.hlen('fat');
        const prev = P(await r.get('fatmeta')) || {};
        const de = [prev.de, body.de].filter(Boolean).sort()[0];
        const ate = [prev.ate, body.ate].filter(Boolean).sort().pop();
        const meta = { total, de, ate, ultimoArquivo: body.arquivo, linhasArquivo: body.linhas, atualizadoEm: nowISO(), por: user.n };
        await r.set('fatmeta', S(meta));
        return send(200, { meta });
      }
      case 'fat-stats': {
        const h = (await r.hgetall('fatstats')) || {};
        const out = {}; Object.entries(h).forEach(([m, v]) => { out[m] = P(v); });
        return send(200, { stats: out });
      }
      case 'import': {
        if (needAdm()) return;
        const recs = (body.recs || []).map((x) => {
          const c = clean(x); c.id = c.id || newId(); c.origem = 'import'; c.criadoPor = user.n; c.criadoEm = nowISO();
          c.status = x.status || 'APROVADO';
          if (x.dataRecebimento) c.dataRecebimento = x.dataRecebimento;
          return c;
        }).filter((x) => x.nf && x.data && x.tipo);
        const fats = await hm(r, 'fat', recs.map((x) => x.nf));
        recs.forEach((x, i) => { applyFat(x, P(fats[i])); if (!x.canal) x.canal = 'N/D'; });
        await saveRecords(r, recs);
        return send(200, { n: recs.length, cruzados: recs.filter((x) => x.cruzado).length });
      }
      case 'recross': {
        // refaz o cruzamento com o consolidado para os registros do mês que ainda não cruzaram
        if (needAdm()) return;
        const m = q.m || body.m;
        const h = (await r.hgetall('reg:' + m)) || {};
        const recs = Object.values(h).map(P).filter((x) => x && !x.cruzado);
        const fats = await hm(r, 'fat', recs.map((x) => x.nf));
        const upd = [];
        recs.forEach((x, i) => { const f = P(fats[i]); if (f) { applyFat(x, f); upd.push(x); } });
        if (upd.length) await saveRecords(r, upd);
        return send(200, { verificados: recs.length, cruzados: upd.length });
      }
      case 'wipe': {
        if (needAdm()) return;
        if (body.confirm !== 'APAGAR') return send(400, { error: 'Confirmação ausente' });
        const months = (await r.smembers('months')) || [];
        const keys = ['nfidx', 'pend', 'months', ...months.map((m) => 'reg:' + m)];
        if (body.fat) keys.push('fat', 'fatstats', 'fatmeta');
        await r.del(...keys);
        return send(200, { ok: true });
      }
      default:
        return send(404, { error: 'Ação desconhecida: ' + action });
    }
  } catch (e) {
    console.error(e);
    return send(500, { error: e.message || String(e) });
  }
};
