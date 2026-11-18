/* Admin: consolidado, importação do histórico, motoristas, listas */
'use strict';

// ---------- normalizações ----------
function excelDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { if (v < 20000 || v > 80000) return null; const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5); return d.toISOString().slice(0, 10); }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${pad(m[2])}-${pad(m[1])}`; }
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}
function excelTime(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') { const f = v % 1; const mins = Math.round(f * 1440) % 1440; return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`; }
  const m = String(v).match(/(\d{1,2})[:h](\d{2})/); return m ? `${pad(m[1])}:${m[2]}` : '';
}
function normTransp(v) {
  const s = strip(v); if (!s || s === 'NENHUM' || /^\d/.test(s) && !s.startsWith('3ZX')) return '';
  if (s.includes('DESCALV') || s.includes('DESALV')) return 'DESCALVADO';
  if (s.includes('FULL')) return 'FULL FLEX';
  if (s.includes('PET SUP') || s.includes('PETSUP')) return 'PET SUPPLIES';
  if (s.includes('SAVING')) return 'FRETESAVING';
  if (s.startsWith('3ZX')) return '3ZX';
  if (s.includes('ENZO')) return 'ENZO';
  if (s.includes('EZX')) return 'EZX';
  if (s.includes('ICE BOYS')) return 'ICE BOYS';
  return (S.cfg?.transportadoras || []).includes(s) ? s : '';
}
const MOTIVO_MAP = [
  [/TEMPO/, 'FALTA DE TEMPO HÁBIL'], [/AUSENTE/, 'CLIENTE AUSENTE'], [/FECHAD/, 'LOCAL FECHADO'], [/FORA D[AE] ROTA/, 'FORA DE ROTA'],
  [/ENDERE/, 'ENDEREÇO INCORRETO'], [/(FALTA D[AE] MERCADORIA|NAO LOCALIZAD|FALTA NO ESTOQUE)/, 'FALTA DE MERCADORIA'], [/AVARI/, 'MERCADORIA AVARIADA'],
  [/QUEBR/, 'VEÍCULO QUEBROU'], [/COUBE/, 'NÃO COUBE NO VEÍCULO'], [/(INADEQUAD|RESTRI)/, 'RESTRIÇÃO DE VEÍCULO'], [/AGENDA/, 'SEM AGENDAMENTO'],
  [/ESPACO/, 'SEM ESPAÇO PARA RECEBIMENTO'], [/(ESTACION|PARADA)/, 'SEM LOCAL PARA ESTACIONAR'], [/DESACORDO/, 'DESACORDO COMERCIAL'],
  [/(NAO REALIZADO|NAO FEZ|SEM PEDIDO)/, 'PEDIDO NÃO REALIZADO'], [/RECUS/, 'CLIENTE RECUSOU O PEDIDO'], [/DIVERG/, 'DIVERGÊNCIA NO PEDIDO'],
  [/NAO SAIU/, 'NÃO SAIU DO CD'], [/(CLIMA|CHUVA|ALAGA)/, 'CLIMA'], [/DUPLICAD/, 'DUPLICADO'], [/AGUARDAR/, 'MOTORISTA NÃO QUIS AGUARDAR']
];
function normMotivo(v) {
  const s = strip(v); if (!s) return '';
  for (const [re, out] of MOTIVO_MAP) if (re.test(s)) return out;
  return String(v).trim().toUpperCase();
}
function normTurno(v) { const s = String(v ?? '').trim(); const m = s.match(/^([123])/); return m ? m[1] + '°' : ''; }
function parseNum(v) {
  if (v == null || v === '') return undefined; if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, ''); if (!s) return undefined;
  const lc = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  if (lc >= 0 && s.length - lc - 1 <= 2) s = s.slice(0, lc).replace(/[.,]/g, '') + '.' + s.slice(lc + 1); else s = s.replace(/[.,]/g, '');
  const n = parseFloat(s); return isFinite(n) ? n : undefined;
}
const intNF = (v) => { const s = String(v ?? '').replace(/\D/g, '').replace(/^0+/, ''); return s && s.length <= 9 ? s : ''; };
const H = (s) => strip(s).replace(/[º°]/g, 'O');

function sheetRows(ws) { return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false }); }
// encontra a linha de cabeçalho que contém `must` e devolve {hi, col:{NOME:idx}}
function header(rows, must, maxRow = 6) {
  const mm = H(must);
  for (let i = 0; i < Math.min(maxRow, rows.length); i++) {
    const r = rows[i] || []; const ix = r.findIndex((c) => H(c) === mm);
    if (ix >= 0) { const col = {}; r.forEach((c, j) => { const k = H(c); if (k && !(k in col)) col[k] = j; }); return { hi: i, col }; }
  }
  return null;
}
function findSheet(wb, ...names) { const ns = names.map(H); return wb.SheetNames.find((n) => ns.includes(H(n))); }
async function readFile(file) { const buf = await file.arrayBuffer(); return XLSX.read(buf, { type: 'array', cellDates: false }); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

// ---------- base de motoristas (relatório de veículos do TMS) ----------
const NAO_MOTORISTA = /PEND[EÊ]NCIA|N[AÃ]O SAIU|^TRANSPORTADORA |^\s*(FULL FLEX|3ZX)\s*$/;
function transpCurta(v) {
  const k = normTransp(v); if (k) return k;
  const s = strip(v).replace(/\b(LTDA|ME|EIRELI|S\/?A|TRANSPORTES?|E SERVICOS|SERVICOS|LOGISTICA)\b/g, '').replace(/\s+/g, ' ').trim();
  return s && s !== '-' ? s : '';
}
function parseVeiculos(rows) {
  const h = header(rows, 'Placa', 3); if (!h) throw new Error('Não achei a coluna "Placa". Use o relatório de veículos exportado do TMS.');
  const c = h.col; const g = (r, k) => (c[k] != null ? r[c[k]] : null);
  if (c['MOTORISTA'] == null) throw new Error('Não achei a coluna "Motorista" no arquivo.');
  const out = []; const ign = { ficticias: 0, semMotorista: 0 }; const seen = new Set();
  for (let i = h.hi + 1; i < rows.length; i++) {
    const r = rows[i]; const placa = String(g(r, 'PLACA') || '').replace(/[\s-]/g, '').toUpperCase(); const nome = String(g(r, 'MOTORISTA') || '').replace(/\s+/g, ' ').trim().toUpperCase();
    if (!placa && !nome) continue;
    const tr = String(g(r, 'TRANSPORTADORA') || '').trim();
    if (strip(tr) === 'PLACAS FICTICIAS' || !nome || NAO_MOTORISTA.test(strip(nome))) { ign.ficticias++; continue; }
    if (seen.has(placa + nome)) continue; seen.add(placa + nome);
    out.push({ nome, placa, transp: transpCurta(tr), transpNome: tr, veiculo: String(g(r, 'TIPO VEICULO') || '').trim(), cap: parseNum(g(r, 'CAPACIDADE')) || undefined, ativo: strip(g(r, 'ATIVO')) !== 'NAO' });
  }
  return { motoristas: out, ign };
}
async function readTable(file) {
  if (/\.csv$/i.test(file.name)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let txt = new TextDecoder('utf-8').decode(buf); if (txt.includes('\uFFFD')) txt = new TextDecoder('windows-1252').decode(buf);
    const wb = XLSX.read(txt.replace(/^\uFEFF/, ''), { type: 'string', raw: true, FS: txt.split('\n')[0].includes(';') ? ';' : ',' });
    return sheetRows(wb.Sheets[wb.SheetNames[0]]);
  }
  const wb = await readFile(file); return sheetRows(wb.Sheets[wb.SheetNames[0]]);
}

// ---------- roteirização (NF × motorista) ----------
const ROT_NF = ['NOTA FISCAL', 'NF', 'NF-E', 'NFE', 'NO NF', 'NO DA NF', 'NUMERO NF', 'NUMERO DA NF', 'NUMERO DA NOTA', 'NOTA', 'DOCUMENTO', 'NUM. NF', 'N. NF', 'NOTA FISCAL/SERIE', 'NF/SERIE'];
const ROT_MOT = ['MOTORISTA', 'NOME MOTORISTA', 'NOME DO MOTORISTA', 'CONDUTOR'];
const ROT_PLACA = ['PLACA', 'PLACA VEICULO', 'PLACA DO VEICULO', 'VEICULO'];
const ROT_DATA = ['DATA ROTA', 'DATA DA ROTA', 'DATA ROTEIRIZACAO', 'DATA DE ROTEIRIZACAO', 'DATA SAIDA', 'DATA DE SAIDA', 'DATA CARREGAMENTO', 'DATA DE CARREGAMENTO', 'DATA EXPEDICAO', 'DATA ENTREGA', 'DATA DE ENTREGA', 'DATA PREVISTA', 'DATA'];
const ROT_TR = ['TRANSPORTADORA', 'TRANSPORTADOR'];
function parseRoteirizacao(sheets, dataPadrao) {
  for (const R of sheets) {
    for (let i = 0; i < Math.min(15, R.length); i++) {
      const row = (R[i] || []).map(H); const pick = (l) => { for (const k of l) { const j = row.indexOf(k); if (j >= 0) return j; } return -1; };
      const cNF = pick(ROT_NF), cM = pick(ROT_MOT), cP = pick(ROT_PLACA); if (cNF < 0 || (cM < 0 && cP < 0)) continue;
      const cD = pick(ROT_DATA), cT = pick(ROT_TR);
      const porPlaca = new Map((S.motoristas || []).filter((m) => m.ativo !== false).map((m) => [m.placa, m]));
      const rows = []; const stats = {}; const seen = new Set(); let semMot = 0;
      for (let k = i + 1; k < R.length; k++) {
        const r = R[k]; const m = String(r[cNF] ?? '').match(/\d{3,9}/); if (!m) continue; const nf = m[0].replace(/^0+/, '');
        const placa = cP >= 0 ? String(r[cP] ?? '').replace(/[\s-]/g, '').toUpperCase() : '';
        let mot = cM >= 0 ? String(r[cM] ?? '').replace(/\s+/g, ' ').trim().toUpperCase() : '';
        const base = placa ? porPlaca.get(placa) : null;
        if (!mot && base) mot = base.nome;
        if (!mot) { semMot++; continue; }
        const data = (cD >= 0 && excelDate(r[cD])) || dataPadrao;
        const tr = (cT >= 0 && transpCurta(r[cT])) || (base && base.transp) || ((S.motoristas || []).find((x) => x.nome === mot) || {}).transp || '';
        if (seen.has(nf + '|' + data)) continue; seen.add(nf + '|' + data);
        rows.push([nf, mot, placa, tr, data]);
        const o = ((stats[data] = stats[data] || {})[mot] = stats[data][mot] || { n: 0, t: tr }); o.n++;
      }
      return { rows, stats, semMot, colunas: { nf: R[i][cNF], motorista: cM >= 0 ? R[i][cM] : null, placa: cP >= 0 ? R[i][cP] : null, data: cD >= 0 ? R[i][cD] : null } };
    }
  }
  throw new Error('Não achei as colunas de Nota Fiscal e Motorista (ou Placa) nas primeiras linhas do arquivo.');
}

// ---------- consolidado ----------
function parseConsolidado(wb) {
  const rows = []; const stats = {}; const porAba = []; const seen = new Set();
  const NFH = ['NOTA FISCAL', 'NF', 'NO NF', 'NO DA NF', 'NUMERO NF', 'NUMERO DA NOTA', 'NOTA'];
  for (const name of wb.SheetNames) {
    const n = strip(name);
    const R = sheetRows(wb.Sheets[name]);
    let h = null; for (const k of NFH) { h = header(R, k, 10); if (h) { h.nfKey = H(k); break; } }
    if (!h) { porAba.push({ aba: name, canal: '-', transp: '-', n: 0, obs: 'sem coluna Nota Fiscal' }); continue; }
    const c = h.col; const g = (r, k) => (c[k] != null ? r[c[k]] : null);
    const canalAba = n.includes('VET') ? 'VET' : n.includes('PROMO') ? 'PROMO' : (n.includes('V.D') || /\bVD\b/.test(n) || n.includes('VENDA DIRETA')) ? 'VD' : null;
    const transpAba = normTransp(n.replace(/V\.D|VET\.?CRIADOR|PROMOCIONAL|VENDA DIRETA|\d{4}/g, ''));
    let cnt = 0;
    for (let i = h.hi + 1; i < R.length; i++) {
      const r = R[i]; const raw = g(r, h.nfKey);
      if (raw == null || (typeof raw === 'string' && !/^\s*\d[\d.\s-]*\s*$/.test(raw))) continue; // pula cabeçalhos repetidos/textos
      const nf = intNF(raw); if (!nf) continue;
      const canalCol = strip(g(r, 'CANAL') || g(r, 'TIPO') || '');
      const canal = canalAba || (canalCol.includes('VET') ? 'VET' : canalCol.includes('PROMO') ? 'PROMO' : canalCol ? 'VD' : 'N/D');
      const transp = transpAba || normTransp(g(r, 'TRANSPORTADORA')) || 'OUTROS';
      const dt = excelDate(g(r, 'DT. FATURAMENTO PEDIDO') ?? g(r, 'DATA FATURAMENTO') ?? g(r, 'DT. FATURAMENTO') ?? g(r, 'DATA DE EMISSAO'));
      const peso = parseNum(g(r, 'PESO TOTAL BRUTO KG')) ?? parseNum(g(r, 'PESO TOTAL LIQUIDO KG')) ?? parseNum(g(r, 'PESO'));
      const valor = parseNum(g(r, 'TOTAL NOTA FISCAL')) ?? parseNum(g(r, 'VALOR NF')) ?? parseNum(g(r, 'VALOR'));
      rows.push([nf, canal, transp, String(g(r, 'RAZAO SOCIAL') || '').trim(), String(g(r, 'CLIENTE') || '').trim(), g(r, 'PEDIDO') != null ? String(g(r, 'PEDIDO')) : '', dt, peso != null ? +peso.toFixed(3) : null, valor ?? null, String(g(r, 'REPRESENTANTE') || '').trim(), String(g(r, 'CIDADE') || '').trim(), String(g(r, 'BAIRRO') || '').trim()]);
      cnt++;
      if (dt && !seen.has(nf)) { seen.add(nf); const m = monthOf(dt); const k = canal + '|' + transp; const o = ((stats[m] = stats[m] || {})[k] = stats[m][k] || { n: 0, v: 0, p: 0 }); o.n++; o.v += valor || 0; o.p += peso || 0; }
    }
    porAba.push({ aba: name, canal: canalAba || 'pela coluna', transp: transpAba || 'pela coluna', n: cnt });
  }
  Object.values(stats).forEach((m) => Object.values(m).forEach((o) => { o.v = +o.v.toFixed(2); o.p = +o.p.toFixed(1); }));
  const datas = rows.map((r) => r[6]).filter(Boolean).sort();
  return { rows, stats, porAba, de: datas[0], ate: datas[datas.length - 1] };
}

// ---------- planilha antiga ----------
function parseAntiga(wb, opts) {
  const out = { recs: [], motoristas: [], rel: {} };
  const rel = out.rel; const inval = (d) => !d || d < '2024-01-01' || d > addDays(todayISO(), 60);
  const idOf = (...p) => 'i' + hashStr(p.join('|'));
  const occ = {}; const nth = (k) => (occ[k] = (occ[k] || 0) + 1);

  // abas oficiais PA / VET
  const ofic = []; const byNF = {};
  for (const [aba, canal] of [['PA', 'VD'], ['VET', 'VET']]) {
    const sn = findSheet(wb, aba); if (!sn) continue;
    const R = sheetRows(wb.Sheets[sn]); const h = header(R, 'Nota fiscal', 3); if (!h) continue;
    const c = h.col; let n = 0, bad = 0;
    for (let i = h.hi + 1; i < R.length; i++) {
      const r = R[i]; const nf = intNF(r[c['NOTA FISCAL']]); if (!nf) continue;
      const data = excelDate(r[c['DATA RETORNO']]); if (inval(data)) { bad++; continue; }
      const motivoOrig = r[c['MOTIVO']];
      const rec = { tipo: 'REENTREGA', nf, data, canal, abaOrigem: aba, motivo: normMotivo(motivoOrig), transportadora: normTransp(r[c['TRANSPORTADORA']]), status: 'APROVADO' };
      if (motivoOrig && strip(motivoOrig) !== strip(rec.motivo)) rec.obs = 'Motivo original: ' + String(motivoOrig).trim();
      rec.id = idOf(aba, nf, data, nth(aba + nf + data));
      ofic.push(rec); (byNF[nf] = byNF[nf] || []).push(rec); n++;
    }
    rel[aba] = { n, invalidas: bad };
  }
  // recebimentos (enriquecem as oficiais; sem correspondência viram registro próprio)
  for (const [aba, canal] of [['Recebimento Reentregas PA', 'VD'], ['Recebimento Reentregas VET', 'VET']]) {
    const sn = findSheet(wb, aba); if (!sn) continue;
    const R = sheetRows(wb.Sheets[sn]); const h = header(R, 'N° da NF'); if (!h) continue;
    const c = h.col; let merged = 0, novos = 0, bad = 0;
    for (let i = h.hi + 1; i < R.length; i++) {
      const r = R[i]; const nf = intNF(r[c['NO DA NF']]); if (!nf) continue;
      const data = excelDate(r[c['DATA DO RECEBIMENTO']]); if (inval(data)) { bad++; continue; }
      const det = {
        hora: excelTime(r[c['HORARIO']]), valor: parseNum(r[c['VALOR']]), peso: parseNum(r[c['PESO']]), motivo: normMotivo(r[c['MOTIVO DO INSUCESSO']]),
        motorista: String(r[c['MOTORISTA']] || '').trim().toUpperCase(), transportadora: normTransp(r[c['TRANSPORTADORA']]),
        conferente: String(r[c['CONFERENTE']] || '').trim().toUpperCase(), turno: normTurno(r[c['TURNO']])
      };
      const conf = strip(r[c['CONFIRMACAO DO ADM']]);
      const cands = (byNF[nf] || []).filter((o) => !o._m && Math.abs(daysBetween(o.data, data)) <= 7).sort((a, b) => Math.abs(daysBetween(a.data, data)) - Math.abs(daysBetween(b.data, data)));
      if (cands.length) {
        const o = cands[0]; o._m = 1; merged++;
        o.dataRecebimento = data;
        for (const [k, v] of Object.entries(det)) if (v !== '' && v != null && (k === 'motivo' || !o[k])) o[k] = v;
        if (o.obs && o.obs.startsWith('Motivo original')) delete o.obs;
      } else {
        if (!opts.semLancamento) continue;
        novos++;
        const status = conf === 'NAO RECEBIDO' ? 'RECUSADO' : conf === 'RECEBIDO' ? 'APROVADO' : (daysBetween(data, todayISO()) <= 15 ? 'PENDENTE' : 'APROVADO');
        const rec = { tipo: 'REENTREGA', nf, data, canal, abaOrigem: aba, status, ...det, obs: 'Importado da aba Recebimento (não estava lançado na aba ' + (canal === 'VD' ? 'PA' : 'VET') + ')' };
        rec.id = idOf(aba, nf, data, nth(aba + nf + data));
        ofic.push(rec);
      }
    }
    rel[aba] = { mescladas: merged, semLancamento: novos, invalidas: bad };
  }
  ofic.forEach((o) => delete o._m);
  out.recs.push(...ofic);

  // NFDs
  { const sn = findSheet(wb, 'Recebimento NFDs'); if (sn) { const R = sheetRows(wb.Sheets[sn]); const h = header(R, 'N° da NFD'); if (h) { const c = h.col; let n = 0, bad = 0;
    for (let i = h.hi + 1; i < R.length; i++) { const r = R[i]; const nf = intNF(r[c['NO DA NOTA REFERENCIADA']]); const nfd = intNF(r[c['NO DA NFD']]); if (!nf && !nfd) continue; if (!nf) { bad++; continue; }
      const data = excelDate(r[c['DATA DE RECEBIMENTO']]); if (inval(data)) { bad++; continue; }
      const conf = strip(r[c['CONFIRMACAO DO ADM']]);
      out.recs.push({ id: idOf('NFD', nf, nfd, data), tipo: 'NFD', nf, nfd, data, hora: excelTime(r[c['HORARIO']]), valor: parseNum(r[c['VALOR']]), motivo: String(r[c['MOTIVO']] || '').trim().toUpperCase(), dataEmissao: excelDate(r[c['DATA DE EMISSAO']]) || undefined,
        motorista: String(r[c['MOTORISTA']] || '').trim().toUpperCase(), transportadora: normTransp(r[c['TRANSPORTADORA']]), conferente: String(r[c['CONFERENTE']] || '').trim().toUpperCase(), turno: normTurno(r[c['TURNO']]), status: conf === 'NAO RECEBIDO' ? 'RECUSADO' : 'APROVADO' }); n++; }
    rel.NFDs = { n, ignoradas: bad }; } } }
  // Ocorrências
  { const sn = findSheet(wb, 'Recebimento Ocorrências'); if (sn) { const R = sheetRows(wb.Sheets[sn]); const h = header(R, 'Nota de origem'); if (h) { const c = h.col; let n = 0, bad = 0;
    for (let i = h.hi + 1; i < R.length; i++) { const r = R[i]; const nf = intNF(r[c['NOTA DE ORIGEM']]); if (!nf) { if (r[c['DATA DE RECEBIMENTO']] != null) bad++; continue; }
      const data = excelDate(r[c['DATA DE RECEBIMENTO']]); if (inval(data)) { bad++; continue; }
      const conf = strip(r[c['CONFIRMACAO DO ADM']]); const mot = String(r[c['MOTIVO']] || '').trim().toUpperCase();
      out.recs.push({ id: idOf('OC', nf, data, mot, nth('OC' + nf + data + mot)), tipo: 'OCORRENCIA', nf, data, hora: excelTime(r[c['HORARIO']]), motivo: mot, dataEntrega: excelDate(r[c['DATA DA ENTREGA']]) || undefined,
        motorista: String(r[c['MOTORISTA']] || '').trim().toUpperCase(), transportadora: normTransp(r[c['TRANSPORTADORA']]), conferente: String(r[c['CONFERENTE']] || '').trim().toUpperCase(), turno: normTurno(r[c['TURNO']]), status: conf === 'NAO RECEBIDO' ? 'RECUSADO' : 'APROVADO' }); n++; }
    rel['Ocorrências'] = { n, ignoradas: bad }; } } }
  // limpa campos vazios
  out.recs.forEach((r) => Object.keys(r).forEach((k) => { if (r[k] === '' || r[k] == null) delete r[k]; }));
  return out;
}

// ---------- tela ----------
function vAdmin() {
  const fm = S.fatMeta;
  $('#main').innerHTML = `<div class="grid g2" style="align-items:start">
  <div class="stack">
    <div class="card stack"><h3>1. Consolidado de faturamento</h3>
      <div class="${fm ? 'alert info' : 'alert warn'}">${fm ? `Base atual: <b>${fNum(fm.total)}</b> NFs${fm.de ? ` · faturamento de ${fD(fm.de)} a ${fD(fm.ate)}` : ''} · último arquivo <b>${esc(fm.ultimoArquivo || '')}</b> em ${new Date(fm.atualizadoEm).toLocaleString('pt-BR')}` : 'Nenhum consolidado carregado ainda: a busca de NF não vai trazer dados até você enviar o arquivo.'}</div>
      <div class="muted small">Envie o arquivo FATURAMENTO_CONSOLIDADO (todas as abas V.D / VET.CRIADOR / PROMOCIONAL). Ao escolher o arquivo o envio é automático. Pode reenviar sempre que atualizar: as NFs são sobrescritas e os registros que não cruzaram são reprocessados.</div>
      <input type="file" id="aFat" accept=".xlsx,.xlsm,.xls">
      <div id="aFatOut"></div>
    </div>
    <div class="card stack"><h3>2. Importar histórico da planilha antiga</h3>
      <div class="muted small">Lê as abas PA, VET, Recebimento Reentregas PA/VET, Recebimento NFDs, e Recebimento Ocorrências. Os recebimentos são casados com os lançamentos das abas PA/VET (mesma NF, até 7 dias) e completam hora, motorista, valor, conferente e turno. Pode importar de novo sem duplicar.</div>
      <label style="flex-direction:row;align-items:center;gap:6px"><input type="checkbox" id="aSemLanc" checked style="min-height:auto"> incluir recebimentos que nunca foram lançados nas abas PA/VET</label>
      <input type="file" id="aOld" accept=".xlsx,.xlsm,.xls">
      <div id="aOldOut"></div>
    </div>
    <div class="card stack"><h3>3. Entregas por motorista (roteirização)</h3>
      <div class="${S.rotMeta ? 'alert info' : 'alert warn'}" id="aRotSt">${S.rotMeta ? `Rotas de <b>${fD(S.rotMeta.de)}</b> a <b>${fD(S.rotMeta.ate)}</b> · ${fNum(S.rotMeta.nfs)} NFs · último arquivo <b>${esc(S.rotMeta.arquivo || '')}</b> em ${new Date(S.rotMeta.atualizadoEm).toLocaleString('pt-BR')}` : 'Nenhuma rota carregada: sem ela o dashboard não calcula a % de reentrega por motorista.'}</div>
      <div class="muted small">Envie o relatório de roteirização / entregas do TMS (.xlsx ou .csv) com, no mínimo, as colunas de <b>Nota Fiscal</b> e <b>Motorista</b> (ou <b>Placa</b>). Se tiver coluna de data da rota, ela é usada; senão vale a data abaixo. Pode enviar todo dia: os dias do arquivo são substituídos, sem duplicar.</div>
      <div class="row"><label style="max-width:220px">Data das rotas (se o arquivo não tiver)<input type="date" id="aRotData" value="${todayISO()}"></label></div>
      <input type="file" id="aRotFile" accept=".xlsx,.xls,.csv"><div id="aRotOut"></div>
    </div>
    <div class="card stack"><h3>4. Reprocessar cruzamento</h3>
      <div class="muted small">Refaz o cruzamento com o consolidado para registros que ainda não encontraram a NF (ex.: lançados antes de subir o consolidado do mês).</div>
      <div><button class="btn" id="aRecross">Reprocessar todos os meses</button></div><div id="aRecOut" class="muted small"></div>
    </div>
  </div>
  <div class="stack">
    <div class="card stack"><h3>Listas e cadastros</h3>
      <div class="grid g2">
        <label>Motivos de reentrega<textarea id="lMotR">${esc(S.cfg.motivosReentrega.join('\n'))}</textarea></label>
        <label>Transportadoras<textarea id="lTr">${esc(S.cfg.transportadoras.join('\n'))}</textarea></label>
        <label>Motivos de NFD<textarea id="lMotN">${esc(S.cfg.motivosNFD.join('\n'))}</textarea></label>
        <label>Motivos de ocorrência<textarea id="lMotO">${esc(S.cfg.motivosOcorrencia.join('\n'))}</textarea></label>
        <label>Conferentes (sugestões)<textarea id="lConf">${esc((S.cfg.conferentes || []).join('\n'))}</textarea></label>
        <label>Meta de reentrega por motorista (%)<input id="lMeta" type="number" step="0.1" min="0" value="${esc(S.cfg.metaReentrega ?? 3)}"></label>
        <label>Mínimo de NFs entregues para o motorista entrar na meta<input id="lMinMeta" type="number" step="1" min="1" value="${esc(S.cfg.minEntregasMeta ?? 10)}"></label>
        <label>Horário dos turnos (início-fim)<textarea id="lTurno">${esc(Object.entries(S.cfg.turnoHoras || {}).map(([k, [a, b]]) => `${k} ${a}-${b}`).join('\n'))}</textarea></label>
      </div>
      <div><button class="btn primary" id="aSaveCfg">Salvar listas</button></div>
    </div>
    <div class="card stack"><h3>Base de motoristas e veículos</h3>
      <div class="${S.motMeta ? 'alert info' : 'alert warn'}">${S.motMeta ? `<b>${fNum(S.motMeta.ativos)}</b> veículos ativos (de ${fNum(S.motMeta.total)}) · arquivo <b>${esc(S.motMeta.arquivo)}</b> em ${new Date(S.motMeta.atualizadoEm).toLocaleString('pt-BR')}` : (S.motoristas.length ? `${fNum(S.motoristas.length)} motoristas (lista antiga). Envie o relatório de veículos do TMS para atualizar.` : 'Nenhuma base carregada. Envie o relatório de veículos do TMS.')}</div>
      <div class="muted small">Envie o <b>relatório de veículos</b> exportado do TMS (.csv ou .xlsx). Ele <b>substitui</b> a lista inteira: motorista, placa, transportadora, tipo de veículo e se está ativo. No Registrar aparecem só os ativos; digitando o nome ou a placa, o resto é preenchido sozinho.</div>
      <input type="file" id="aMotFile" accept=".csv,.xlsx,.xls">
      <div id="aMotOut"></div>
      ${S.motoristas.length ? `<label>Buscar na base<input id="aMotQ" placeholder="nome, placa ou transportadora"></label><div id="aMotList"></div>` : ''}
    </div>
    <div class="card stack"><h3>Catálogo de itens (ocorrências)</h3>
      <div class="alert info"><b>${fNum((S.itens || []).length)}</b> itens no catálogo${S.itensMeta ? ` · arquivo <b>${esc(S.itensMeta.arquivo)}</b> em ${new Date(S.itensMeta.atualizadoEm).toLocaleString('pt-BR')}` : ' · catálogo padrão (Catalogo_Espelho_itens_novos)'}</div>
      <div class="muted small">Envie uma planilha com as colunas <b>Código Produto</b>, <b>Descrição Produto</b> e <b>Peso</b> (é lida a primeira aba que tiver essas colunas). Substitui o catálogo inteiro.</div>
      <input type="file" id="aItFile" accept=".xlsx,.xls,.csv"><div id="aItOut"></div>
    </div>
    <div class="card stack"><h3>Zona de perigo</h3>
      <div class="muted small">Apaga todos os registros (reentregas, NFDs, ocorrências, canceladas). O consolidado é mantido.</div>
      <div><button class="btn bad" id="aWipe">Apagar todos os registros</button></div>
    </div>
  </div></div>`;

  const lines = (id) => $(id).value.split('\n').map((s) => s.trim()).filter(Boolean);
  $('#aSaveCfg').onclick = async () => {
    const th = {}; lines('#lTurno').forEach((l) => { const m = l.match(/^(\S+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/); if (m) th[m[1]] = [m[2].padStart(5, '0'), m[3].padStart(5, '0')]; });
    const cfg = { motivosReentrega: lines('#lMotR').map((s) => s.toUpperCase()), transportadoras: lines('#lTr').map((s) => s.toUpperCase()), motivosNFD: lines('#lMotN').map((s) => s.toUpperCase()), motivosOcorrencia: lines('#lMotO').map((s) => s.toUpperCase()), conferentes: lines('#lConf').map((s) => s.toUpperCase()), turnoHoras: th, metaReentrega: Number($('#lMeta').value) || 3, minEntregasMeta: Math.max(1, Number($('#lMinMeta').value) || 10), turnos: Object.keys(th).length ? Object.keys(th) : S.cfg.turnos };
    try { S.cfg = (await api('cfg', { cfg })).cfg; toast('Listas salvas'); } catch (e) { toast(e.message, true); }
  };
  const listaMot = () => {
    const q = strip($('#aMotQ')?.value || ''); const el = $('#aMotList'); if (!el) return;
    const l = S.motoristas.filter((m) => !q || strip([m.nome, m.placa, m.transp, m.veiculo].join(' ')).includes(q));
    el.innerHTML = `<div class="tbl-wrap" style="max-height:320px"><table><thead><tr><th>Motorista</th><th>Placa</th><th>Transp.</th><th>Veículo</th><th>Ativo</th></tr></thead><tbody>${l.slice(0, 300).map((m) => `<tr${m.ativo === false ? ' style="color:var(--ink3)"' : ''}><td>${esc(m.nome)}</td><td>${esc(m.placa)}</td><td>${esc(m.transp)}</td><td>${esc(m.veiculo || '')}</td><td>${m.ativo === false ? 'Não' : 'Sim'}</td></tr>`).join('')}</tbody></table></div><div class="muted small">${fNum(l.length)} encontrado(s)${l.length > 300 ? ' · mostrando 300' : ''}</div>`;
  };
  $('#aMotQ') && ($('#aMotQ').oninput = listaMot); listaMot();
  $('#aRotFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = $('#aRotOut'); out.innerHTML = '<div class="muted">Lendo arquivo…</div>';
    try {
      let sheets;
      if (/\.csv$/i.test(f.name)) sheets = [await readTable(f)]; else { const wb = await readFile(f); sheets = wb.SheetNames.map((n) => sheetRows(wb.Sheets[n])); }
      const p = parseRoteirizacao(sheets, $('#aRotData').value || todayISO());
      if (!p.rows.length) throw new Error('Nenhuma NF com motorista encontrada.');
      const dias = Object.keys(p.stats).sort(); const mots = new Set(p.rows.map((x) => x[1]));
      out.innerHTML = `<div class="alert info">Colunas usadas: NF = <b>${esc(p.colunas.nf)}</b>${p.colunas.motorista ? ` · Motorista = <b>${esc(p.colunas.motorista)}</b>` : ''}${p.colunas.placa ? ` · Placa = <b>${esc(p.colunas.placa)}</b>` : ''} · Data = <b>${esc(p.colunas.data || 'data informada acima')}</b><br>
        ${fNum(p.rows.length)} NFs · ${fNum(mots.size)} motoristas · ${dias.length === 1 ? fD(dias[0]) : `${fD(dias[0])} a ${fD(dias[dias.length - 1])}`}${p.semMot ? ` · ${fNum(p.semMot)} linhas sem motorista ignoradas` : ''}</div>
        <div class="progress" id="aRotPg"><div></div></div>`;
      const CH = 3000;
      for (let i = 0; i < p.rows.length; i += CH) { await api('rot-upload', { rows: p.rows.slice(i, i + CH) }); $('#aRotPg div').style.width = Math.min(100, Math.round((i + CH) / p.rows.length * 100)) + '%'; }
      const j = await api('rot-upload', { stats: p.stats, fim: true, arquivo: f.name });
      S.rotMeta = j.meta; S.rotCache = null; toast('Rotas carregadas'); vAdmin();
    } catch (err) { out.innerHTML = `<div class="alert crit">${esc(err.message)}</div>`; }
  };
  $('#aItFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = $('#aItOut'); out.innerHTML = '<div class="muted">Lendo arquivo…</div>';
    try {
      let rows = null, h = null;
      if (/\.csv$/i.test(f.name)) { rows = await readTable(f); h = header(rows, 'Código Produto', 5); }
      else { const wb = await readFile(f); for (const n of wb.SheetNames) { const R = sheetRows(wb.Sheets[n]); const hh = header(R, 'Código Produto', 5); if (hh) { rows = R; h = hh; break; } } }
      if (!h) throw new Error('Não achei a coluna "Código Produto".');
      const c = h.col; const seen = new Set(); const itens = [];
      for (let i = h.hi + 1; i < rows.length; i++) { const r = rows[i]; const cod = String(r[c['CODIGO PRODUTO']] ?? '').trim(); if (!cod || seen.has(cod)) continue; seen.add(cod); itens.push([cod, String(r[c['DESCRICAO PRODUTO']] ?? '').trim(), parseNum(r[c['PESO']]) ?? null]); }
      if (!itens.length) throw new Error('Nenhum item encontrado.');
      const j = await api('itens', { itens, arquivo: f.name }); S.itens = itens; S.itensMeta = j.meta;
      toast(`Catálogo atualizado: ${fNum(itens.length)} itens`); vAdmin();
    } catch (err) { out.innerHTML = `<div class="alert crit">${esc(err.message)}</div>`; }
  };
  $('#aMotFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = $('#aMotOut'); out.innerHTML = '<div class="muted">Lendo arquivo…</div>';
    try {
      const { motoristas, ign } = parseVeiculos(await readTable(f));
      if (!motoristas.length) throw new Error('Nenhum motorista encontrado no arquivo.');
      const porT = {}; motoristas.forEach((m) => { const o = (porT[m.transp || '(sem)'] = porT[m.transp || '(sem)'] || { a: 0, i: 0 }); m.ativo ? o.a++ : o.i++; });
      out.innerHTML = `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Transportadora</th><th class="num">Ativos</th><th class="num">Inativos</th></tr></thead><tbody>${Object.entries(porT).sort((a, b) => b[1].a - a[1].a).map(([t, o]) => `<tr><td>${esc(t)}</td><td class="num">${fNum(o.a)}</td><td class="num">${fNum(o.i)}</td></tr>`).join('')}</tbody></table></div>
        <div class="muted small">${fNum(motoristas.length)} veículos lidos · ${fNum(ign.ficticias)} ignorados (placas fictícias / "baixar pendências" / sem motorista).</div>
        <div class="row"><button class="btn primary" id="aMotGo">Substituir base de motoristas</button></div>`;
      $('#aMotGo').onclick = async () => {
        $('#aMotGo').disabled = true;
        try {
          const j = await api('motoristas', { motoristas, arquivo: f.name });
          // novas transportadoras entram na lista do app
          const novas = [...new Set(motoristas.filter((m) => m.ativo && m.transp).map((m) => m.transp))].filter((t) => !S.cfg.transportadoras.includes(t));
          if (novas.length) S.cfg = (await api('cfg', { cfg: { transportadoras: [...S.cfg.transportadoras, ...novas] } })).cfg;
          S.motoristas = motoristas; S.motMeta = j.meta;
          toast(`Base atualizada: ${fNum(j.meta.ativos)} veículos ativos${novas.length ? ' · novas transportadoras: ' + novas.join(', ') : ''}`);
          vAdmin();
        } catch (err) { toast(err.message, true); $('#aMotGo').disabled = false; }
      };
    } catch (err) { out.innerHTML = `<div class="alert crit">${esc(err.message)}</div>`; }
  };
  $('#aWipe').onclick = async () => {
    const c = prompt('Isso apaga TODOS os registros. Digite APAGAR para confirmar:'); if (c !== 'APAGAR') return;
    try { await api('wipe', { confirm: 'APAGAR' }); invalidate(); S.sessao = []; toast('Registros apagados'); } catch (e) { toast(e.message, true); }
  };
  $('#aRecross').onclick = recrossAll;

  // consolidado
  $('#aFat').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = $('#aFatOut'); out.innerHTML = '<div class="muted">Lendo arquivo…</div>';
    try {
      const wb = await readFile(f); const p = parseConsolidado(wb);
      const tabela = `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Aba</th><th>Canal</th><th>Transp.</th><th class="num">NFs</th></tr></thead><tbody>${p.porAba.map((a) => `<tr><td>${esc(a.aba)}</td><td>${esc(a.canal)}</td><td>${esc(a.transp)}</td><td class="num">${a.obs ? '<span class="muted small">' + esc(a.obs) + '</span>' : fNum(a.n)}</td></tr>`).join('')}
        <tr><td colspan="3"><b>Total</b>${p.de ? ` · faturamento de ${fD(p.de)} a ${fD(p.ate)}` : ''}</td><td class="num"><b>${fNum(p.rows.length)}</b></td></tr></tbody></table></div>`;
      if (!p.rows.length) { out.innerHTML = tabela + '<div class="alert crit">Nenhuma NF encontrada no arquivo. Confira se é o FATURAMENTO_CONSOLIDADO e se as abas têm a coluna "Nota Fiscal".</div>'; return; }
      out.innerHTML = tabela + `<div class="alert info" id="aFatSt">Enviando ${fNum(p.rows.length)} NFs…</div><div class="progress" id="aFatPg"><div></div></div>`;
      const CH = 2500;
      for (let i = 0; i < p.rows.length; i += CH) { await api('fat-upload', { rows: p.rows.slice(i, i + CH) }); $('#aFatPg div').style.width = Math.min(100, Math.round((i + CH) / p.rows.length * 100)) + '%'; }
      const j = await api('fat-finish', { stats: p.stats, arquivo: f.name, linhas: p.rows.length, de: p.de, ate: p.ate });
      S.fatMeta = j.meta; S.fatStats = null;
      $('#aFatSt').textContent = 'Consolidado carregado. Atualizando o cruzamento dos registros…';
      await recrossAll();
      toast(`Consolidado carregado: ${fNum(j.meta.total)} NFs na base`);
      vAdmin();
    } catch (err) { out.innerHTML = `<div class="alert crit">${esc(err.message)}</div>`; console.error(err); }
  };

  // planilha antiga
  $('#aOld').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return; const out = $('#aOldOut'); out.innerHTML = '<div class="muted">Lendo arquivo…</div>';
    try {
      const wb = await readFile(f); const p = parseAntiga(wb, { semLancamento: $('#aSemLanc').checked });
      const byT = {}; p.recs.forEach((r) => { byT[r.tipo] = (byT[r.tipo] || 0) + 1; });
      const relRows = Object.entries(p.rel).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${Object.entries(v).map(([a, b]) => `${a}: <b>${fNum(b)}</b>`).join(' · ')}</td></tr>`).join('');
      out.innerHTML = `<div class="tbl-wrap" style="max-height:none"><table><thead><tr><th>Aba</th><th>Resultado da leitura</th></tr></thead><tbody>${relRows}</tbody></table></div>
        <div class="muted small" style="margin-top:6px">Será importado: ${Object.entries(byT).map(([k, v]) => `${TIPOS[k]}: <b>${fNum(v)}</b>`).join(' · ')}. Datas inválidas (ex.: 1922, 3099) são ignoradas.</div>
        <div class="row" style="margin-top:8px"><button class="btn primary" id="aOldGo">Importar</button></div><div class="progress hidden" id="aOldPg"><div></div></div><div id="aOldRes"></div>`;
      $('#aOldGo').onclick = async () => {
        $('#aOldGo').disabled = true; $('#aOldPg').classList.remove('hidden');
        try {
          const CH = 800; let cz = 0;
          for (let i = 0; i < p.recs.length; i += CH) { const j = await api('import', { recs: p.recs.slice(i, i + CH) }); cz += j.cruzados; $('#aOldPg div').style.width = Math.round((i + CH) / p.recs.length * 100) + '%'; }
          invalidate();
          $('#aOldRes').innerHTML = `<div class="alert info">Importados ${fNum(p.recs.length)} registros · ${fNum(cz)} cruzaram com o consolidado (o consolidado atual cobre só o período carregado).</div>`;
          toast('Histórico importado');
        } catch (err) { toast(err.message, true); $('#aOldGo').disabled = false; }
      };
    } catch (err) { out.innerHTML = `<div class="err">${esc(err.message)}</div>`; console.error(err); }
  };
}
async function recrossAll() {
  const b = await api('bootstrap'); let ver = 0, cz = 0;
  for (const m of b.months) { const j = await api('recross', { m }); ver += j.verificados; cz += j.cruzados; if ($('#aRecOut')) $('#aRecOut').textContent = `${fMes(m)}… ${fNum(cz)} cruzados de ${fNum(ver)} pendentes de cruzamento`; }
  invalidate();
  if ($('#aRecOut')) $('#aRecOut').textContent = `Concluído: ${fNum(cz)} registros cruzaram agora · ${fNum(ver - cz)} continuam sem NF no consolidado (geralmente notas fora do período do arquivo).`;
}
