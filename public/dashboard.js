/* Dashboard */
'use strict';
const DF = { preset: '30d', de: null, ate: null, canal: '', transp: '', pend: false, rank: 'motorista' };
const charts = {};
const C1 = '#2a78d6', INK2 = '#52514e', INK3 = '#8a8984', GRID = '#ecebe6';

function presetRange(p) {
  const t = todayISO(); const d = new Date();
  if (p === 'mes') return [t.slice(0, 8) + '01', t];
  if (p === 'mesant') { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1); const b = new Date(d.getFullYear(), d.getMonth(), 0); const f = (x) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; return [f(a), f(b)]; }
  if (p === '30d') return [addDays(t, -29), t];
  if (p === '90d') return [addDays(t, -89), t];
  if (p === 'ano') return [t.slice(0, 4) + '-01-01', t];
  if (p === 'tudo') return ['2000-01-01', t];
  return [DF.de, DF.ate];
}

async function vDashboard() {
  if (!DF.de) [DF.de, DF.ate] = presetRange(DF.preset);
  $('#main').innerHTML = `<div class="filters card">
    <label>Período<select id="dPre">${[['mes', 'Este mês'], ['mesant', 'Mês anterior'], ['30d', 'Últimos 30 dias'], ['90d', 'Últimos 90 dias'], ['ano', 'Este ano'], ['tudo', 'Todo o histórico'], ['custom', 'Personalizado']].map(([v, l]) => `<option value="${v}" ${DF.preset === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>De<input type="date" id="dDe" value="${DF.de}"></label><label>Até<input type="date" id="dAte" value="${DF.ate}"></label>
    <label>Canal<select id="dCanal"><option value="">VD + VET + PROMO</option>${opts([...CANAIS, 'N/D'], DF.canal, false)}</select></label>
    <label>Transportadora<select id="dTransp"><option value="">Todas</option>${opts(S.cfg.transportadoras, DF.transp, false)}</select></label>
    <label style="flex-direction:row;align-items:center;gap:6px;min-width:auto;padding-bottom:10px"><input type="checkbox" id="dPend" ${DF.pend ? 'checked' : ''} style="min-height:auto"> incluir pendentes</label>
    <span class="spacer"></span><button class="btn" id="dRef">Atualizar dados</button>
  </div><div id="dOut" class="muted">Carregando…</div>`;
  $('#dPre').onchange = () => { DF.preset = $('#dPre').value; if (DF.preset !== 'custom') { [DF.de, DF.ate] = presetRange(DF.preset); $('#dDe').value = DF.de; $('#dAte').value = DF.ate; } renderDash(); };
  ['#dDe', '#dAte'].forEach((s) => $(s).onchange = () => { DF.preset = 'custom'; $('#dPre').value = 'custom'; DF.de = $('#dDe').value; DF.ate = $('#dAte').value; renderDash(); });
  $('#dCanal').onchange = () => { DF.canal = $('#dCanal').value; renderDash(); };
  $('#dTransp').onchange = () => { DF.transp = $('#dTransp').value; renderDash(); };
  $('#dPend').onchange = () => { DF.pend = $('#dPend').checked; renderDash(); };
  $('#dRef').onclick = async () => { S.fatStats = null; await loadAll(true); renderDash(); };
  try {
    await loadAll();
    if (!S.fatStats) S.fatStats = (await api('fat-stats')).stats;
    renderDash();
  } catch (e) { $('#dOut').textContent = e.message; }
}

function groupCount(arr, keyFn, valFn) {
  const m = new Map();
  arr.forEach((r) => { const k = keyFn(r); if (k == null || k === '') return; m.set(k, (m.get(k) || 0) + (valFn ? valFn(r) : 1)); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
function topN(entries, n) {
  if (entries.length <= n) return entries;
  const top = entries.slice(0, n); const rest = entries.slice(n).reduce((s, e) => s + e[1], 0);
  return [...top, ['Outros (' + (entries.length - n) + ')', rest]];
}
function weekStart(iso) { const d = new Date(iso + 'T12:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return d.toISOString().slice(0, 10); }

function renderDash() {
  if (!$('#dOut')) return;
  const all = S.cache || [];
  const okStatus = (r) => r.status === 'APROVADO' || (DF.pend && r.status === 'PENDENTE');
  const fil = (r) => okStatus(r) && (!DF.canal || r.canal === DF.canal) && (!DF.transp || r.transportadora === DF.transp);
  const inP = (r) => r.data >= DF.de && r.data <= DF.ate;
  const base = all.filter((r) => inP(r) && fil(r));
  const R = base.filter((r) => r.tipo === 'REENTREGA');
  const NFD = base.filter((r) => r.tipo === 'NFD'), OC = base.filter((r) => r.tipo === 'OCORRENCIA');
  const cntAll = reentregaCounts(all.filter((r) => r.status === 'APROVADO' || (DF.pend && r.status === 'PENDENTE')));
  const nfsP = [...new Set(R.map((r) => r.nf))];
  const reinc = nfsP.filter((nf) => (cntAll[nf] || []).length >= 2);
  const valor = R.reduce((s, r) => s + (Number(r.valor) || 0), 0), peso = R.reduce((s, r) => s + (Number(r.peso) || 0), 0);
  const semCruz = R.filter((r) => !r.cruzado).length;

  // taxa de reentrega (coorte por mês de faturamento)
  const st = S.fatStats || {};
  const monthsP = Object.keys(st).filter((m) => m >= monthOf(DF.de) && m <= monthOf(DF.ate)).sort();
  const fatN = (m) => Object.entries(st[m] || {}).reduce((s, [k, v]) => { const [c, t] = k.split('|'); return s + ((!DF.canal || c === DF.canal) && (!DF.transp || t === DF.transp) ? v.n : 0); }, 0);
  const reentNFsByFatMonth = {};
  Object.entries(cntAll).forEach(([nf, arr]) => { const r = arr[0]; if (!r.dtFat || !fil(r)) return; const m = monthOf(r.dtFat); (reentNFsByFatMonth[m] = reentNFsByFatMonth[m] || new Set()).add(nf); });
  const fatTot = monthsP.reduce((s, m) => s + fatN(m), 0);
  const reTot = monthsP.reduce((s, m) => s + (reentNFsByFatMonth[m]?.size || 0), 0);
  const taxa = fatTot ? reTot / fatTot : null;

  const kpi = (k, v, s) => `<div class="card kpi"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s || '&nbsp;'}</div></div>`;
  $('#dOut').innerHTML = `
  <div class="grid g4" style="margin-bottom:12px">
    ${kpi('Reentregas no período', fNum(R.length), `${fNum(nfsP.length)} NFs diferentes`)}
    ${kpi('NFs que voltaram 2× ou mais', fNum(reinc.length), nfsP.length ? fPct(reinc.length / nfsP.length) + ' das NFs reentregues' : '')}
    ${kpi('Valor reentregue', fCompact(valor), fNum(peso / 1000, 1) + ' t de peso')}
    ${kpi('Taxa de reentrega', fPct(taxa, 2), fatTot ? `${fNum(reTot)} de ${fNum(fatTot)} NFs faturadas em ${monthsP.map(fMes).join(', ')}` : 'carregue o consolidado no Admin')}
  </div>
  <div class="grid g4" style="margin-bottom:12px">
    ${kpi('NFDs recebidas', fNum(NFD.length), fMoney(NFD.reduce((s, r) => s + (Number(r.valor) || 0), 0)))}
    ${kpi('Ocorrências', fNum(OC.length), topN(groupCount(OC, (r) => r.motivo), 2).slice(0, 2).map(([k, v]) => `${k}: ${v}`).join(' · '))}
    ${kpi('Ocorrências com desconto do motorista', fNum(OC.filter((r) => r.descontoMotorista === 'TOTAL' || r.descontoMotorista === 'PARCIAL').length), `Total: ${fNum(OC.filter((r) => r.descontoMotorista === 'TOTAL').length)} · Parcial: ${fNum(OC.filter((r) => r.descontoMotorista === 'PARCIAL').length)} · Sem: ${fNum(OC.filter((r) => r.descontoMotorista === 'SEM DESCONTO').length)}`)}
    ${kpi('Reentregas sem cruzamento', fNum(semCruz), semCruz ? 'NF não encontrada no consolidado' : 'todas cruzaram com o consolidado')}
  </div>
  <div class="grid g2" style="margin-bottom:12px">
    <div class="card chart-card"><h3>Reentregas por <span id="granLb"></span></h3><div class="legend" id="lgEvo"></div><div class="chart-box"><canvas id="chEvo"></canvas></div></div>
    <div class="card chart-card"><h3>Taxa de reentrega por mês de faturamento</h3><div class="sub">% das NFs faturadas no mês que voltaram ao menos 1×</div><div class="legend" id="lgTaxa"></div><div class="chart-box"><canvas id="chTaxa"></canvas></div></div>
  </div>
  <div class="grid g3" style="margin-bottom:12px">
    <div class="card chart-card"><h3>Motivos de reentrega</h3><div class="chart-box tall"><canvas id="chMot"></canvas></div></div>
    <div class="card chart-card"><h3>Reentregas por transportadora</h3><div class="chart-box tall"><canvas id="chTr"></canvas></div></div>
    <div class="card chart-card"><h3>Quantas vezes cada NF voltou</h3><div class="sub">NFs reentregues no período, contando todo o histórico</div><div class="chart-box tall"><canvas id="chVz"></canvas></div></div>
  </div>
  <div class="grid g2" style="margin-bottom:12px">
    <div class="card chart-card"><div class="row" style="align-items:center;margin-bottom:8px"><h3 style="margin:0">Ranking de reentregas</h3><span class="spacer"></span>
      <div class="seg" id="rankSeg">${[['motorista', 'Motoristas'], ['rep', 'Representantes'], ['cliente', 'Clientes'], ['cidade', 'Cidades'], ['turno', 'Turno']].map(([k, l]) => `<button data-k="${k}" class="${DF.rank === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="chart-box tall"><canvas id="chRank"></canvas></div></div>
    <div class="card chart-card"><h3>NFDs e ocorrências por motivo</h3><div class="legend"><span><span class="dot" style="background:#6250d6"></span>Ocorrências</span><span><span class="dot" style="background:#e87ba4"></span>NFDs</span></div><div class="chart-box tall"><canvas id="chNO"></canvas></div></div>
  </div>
  <div class="section-title"><h3>NFs reincidentes (voltaram 2× ou mais)</h3><span class="muted small">${fNum(reinc.length)} NF(s)</span><span class="spacer"></span><button class="btn" id="dExpRe">Exportar Excel</button></div>
  <div id="reincTbl"></div>`;

  // --- evolução
  const span = daysBetween(DF.de, DF.ate);
  const gran = span <= 45 ? 'dia' : span <= 210 ? 'semana' : 'mês';
  $('#granLb').textContent = gran;
  const keyOf = (d) => (gran === 'dia' ? d : gran === 'semana' ? weekStart(d) : monthOf(d));
  const keys = []; { let d = DF.de < '2024-01-01' ? (R.map((r) => r.data).sort()[0] || DF.ate) : DF.de; const seen = new Set(); while (d <= DF.ate) { const k = keyOf(d); if (!seen.has(k)) { seen.add(k); keys.push(k); } d = addDays(d, gran === 'mês' ? 27 : 1); } const k2 = keyOf(DF.ate); if (!seen.has(k2)) keys.push(k2); }
  const canaisPresentes = CANAIS.concat('N/D').filter((c) => R.some((r) => r.canal === c));
  const lab = (k) => (gran === 'mês' ? fMes(k) : fD(k).slice(0, 5));
  $('#lgEvo').innerHTML = canaisPresentes.map((c) => `<span><span class="dot" style="background:${CANAL_COR[c]}"></span>${c}</span>`).join('');
  mkChart('chEvo', {
    type: 'bar',
    data: { labels: keys.map(lab), datasets: canaisPresentes.map((c) => ({ label: c, backgroundColor: CANAL_COR[c], data: keys.map((k) => R.filter((r) => r.canal === c && keyOf(r.data) === k).length), borderRadius: 3, borderSkipped: 'start', borderColor: '#fcfcfb', borderWidth: { top: 2 } })) },
    options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 10 } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, plugins: { tooltip: { mode: 'index', intersect: false, callbacks: { title: (it) => (gran === 'semana' ? 'Semana de ' : '') + it[0].label, footer: (it) => 'Total: ' + it.reduce((s, i) => s + i.raw, 0) } } } }
  });

  // --- taxa mensal por canal
  const allMonths = Object.keys(st).sort().slice(-12);
  const canaisTaxa = (DF.canal ? [DF.canal] : ['VD', 'VET']).filter((c) => c !== 'N/D');
  $('#lgTaxa').innerHTML = canaisTaxa.map((c) => `<span><span class="dot" style="background:${CANAL_COR[c]}"></span>${c}</span>`).join('');
  const taxaM = (m, c) => {
    const n = Object.entries(st[m] || {}).reduce((s, [k, v]) => { const [cc, t] = k.split('|'); return s + (cc === c && (!DF.transp || t === DF.transp) ? v.n : 0); }, 0);
    if (!n) return null;
    let re = 0; reentNFsByFatMonth[m]?.forEach((nf) => { if (cntAll[nf][0].canal === c) re++; });
    return { y: re / n * 100, re, n };
  };
  mkChart('chTaxa', {
    type: 'line',
    data: { labels: allMonths.map(fMes), datasets: canaisTaxa.map((c) => { const pts = allMonths.map((m) => taxaM(m, c)); return { label: c, borderColor: CANAL_COR[c], backgroundColor: CANAL_COR[c], data: pts.map((p) => (p ? +p.y.toFixed(2) : null)), _pts: pts, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: '#fcfcfb', pointBorderWidth: 2, tension: 0, spanGaps: true }; }) },
    options: { interaction: { mode: 'index', intersect: false }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { callback: (v) => v + '%' } } }, plugins: { tooltip: { callbacks: { label: (i) => { const p = i.dataset._pts[i.dataIndex]; return p ? `${i.dataset.label}: ${p.y.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% (${p.re} de ${fNum(p.n)} NFs)` : ''; } } } } }
  });

  // --- barras horizontais
  hbar('chMot', topN(groupCount(R, (r) => r.motivo || '(sem motivo)'), 11), 'reentregas');
  hbar('chTr', groupCount(R, (r) => r.transportadora || '(não informada)'), 'reentregas');
  const vz = { '1×': 0, '2×': 0, '3×': 0, '4× ou mais': 0 };
  nfsP.forEach((nf) => { const n = (cntAll[nf] || []).length || 1; vz[n >= 4 ? '4× ou mais' : n + '×']++; });
  mkChart('chVz', {
    type: 'bar', data: { labels: Object.keys(vz), datasets: [{ data: Object.values(vz), backgroundColor: ['#9ec5f4', '#5598e7', '#256abf', '#104281'], borderRadius: 4, borderSkipped: 'start', maxBarThickness: 64 }] },
    options: { scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { tooltip: { callbacks: { label: (i) => `${i.raw} NF(s) · ${nfsP.length ? fPct(i.raw / nfsP.length) : ''}` } } } }
  });
  const rankKey = { motorista: (r) => r.motorista, rep: (r) => r.rep, cliente: (r) => r.cliente, cidade: (r) => r.cidade, turno: (r) => r.turno }[DF.rank];
  hbar('chRank', groupCount(R, rankKey).slice(0, 12), 'reentregas');
  $$('#rankSeg button').forEach((b) => b.onclick = () => { DF.rank = b.dataset.k; $$('#rankSeg button').forEach((x) => x.classList.toggle('on', x === b)); hbar('chRank', groupCount(R, { motorista: (r) => r.motorista, rep: (r) => r.rep, cliente: (r) => r.cliente, cidade: (r) => r.cidade, turno: (r) => r.turno }[DF.rank]).slice(0, 12), 'reentregas'); });

  const motNO = [...new Set([...OC, ...NFD].map((r) => r.motivo || '(sem motivo)'))];
  const cOc = Object.fromEntries(groupCount(OC, (r) => r.motivo || '(sem motivo)')), cNf = Object.fromEntries(groupCount(NFD, (r) => r.motivo || '(sem motivo)'));
  motNO.sort((a, b) => ((cOc[b] || 0) + (cNf[b] || 0)) - ((cOc[a] || 0) + (cNf[a] || 0)));
  mkChart('chNO', {
    type: 'bar', data: { labels: motNO, datasets: [{ label: 'Ocorrências', data: motNO.map((m) => cOc[m] || 0), backgroundColor: '#6250d6', borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 }, { label: 'NFDs', data: motNO.map((m) => cNf[m] || 0), backgroundColor: '#e87ba4', borderRadius: 4, borderSkipped: 'start', maxBarThickness: 18 }] },
    options: { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } }, plugins: { tooltip: { mode: 'index', intersect: false } } }
  });

  // --- tabela de reincidentes
  const outrosPorNF = {};
  all.filter((r) => r.tipo !== 'REENTREGA' && r.status !== 'RECUSADO').forEach((r) => (outrosPorNF[r.nf] = outrosPorNF[r.nf] || []).push(r));
  const reRows = reinc.map((nf) => { const a = cntAll[nf]; const l = a[a.length - 1]; return { nf, n: a.length, a, l, outros: outrosPorNF[nf] || [] }; })
    .sort((x, y) => y.n - x.n || y.l.data.localeCompare(x.l.data));
  $('#reincTbl').innerHTML = reRows.length ? `<div class="tbl-wrap"><table><thead><tr><th>NF</th><th class="num">Vezes</th><th>Canal</th><th>Cliente</th><th>Representante</th><th>Transp.</th><th>Datas de retorno</th><th>Motivos</th><th class="num">Valor NF</th><th>NFD / Ocorrência</th></tr></thead><tbody>
    ${reRows.slice(0, 400).map((x) => `<tr><td><button class="link nfLink">${esc(x.nf)}</button></td><td class="num"><span class="times t${Math.min(x.n, 4)}">${x.n}×</span></td><td>${canalTag(x.l.canal)}${esc(x.l.canal)}</td><td class="wrap">${esc(x.l.cliente || '')}</td><td>${esc(x.l.rep || '')}</td><td>${esc(x.l.transportadora || '')}</td>
    <td class="wrap">${x.a.map((r) => fD(r.data).slice(0, 5) + '/' + r.data.slice(2, 4)).join(', ')}</td><td class="wrap">${esc([...new Set(x.a.map((r) => r.motivo).filter(Boolean))].join(', '))}</td><td class="num">${fMoney(x.l.valorNF ?? x.l.valor)}</td>
    <td class="wrap">${x.outros.map((o) => TIPOS[o.tipo] + (o.motivo ? ' (' + esc(o.motivo) + ')' : '')).join(', ')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card muted">Nenhuma NF reincidente no período.</div>';
  $$('#reincTbl .nfLink').forEach((b) => b.onclick = () => { consultaNF = b.textContent; go('consulta'); });
  $('#dExpRe').onclick = () => {
    const data = reRows.map((x) => ({ NF: x.nf, Vezes: x.n, Canal: x.l.canal, Cliente: x.l.cliente || '', Representante: x.l.rep || '', Transportadora: x.l.transportadora || '', 'Datas de retorno': x.a.map((r) => fD(r.data)).join(', '), Motivos: [...new Set(x.a.map((r) => r.motivo).filter(Boolean))].join(', '), 'Valor NF': x.l.valorNF ?? x.l.valor ?? '', 'NFD/Ocorrência': x.outros.map((o) => TIPOS[o.tipo] + (o.motivo ? ' (' + o.motivo + ')' : '')).join(', ') }));
    const ws = XLSX.utils.json_to_sheet(data); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Reincidentes'); XLSX.writeFile(wb, `nfs_reincidentes_${todayISO()}.xlsx`);
  };
}

function mkChart(id, cfg) {
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id); if (!el) return;
  cfg.options = cfg.options || {};
  cfg.options.responsive = true; cfg.options.maintainAspectRatio = false; cfg.options.animation = { duration: 250 };
  cfg.options.plugins = { legend: { display: false }, ...(cfg.options.plugins || {}) };
  cfg.options.plugins.tooltip = { backgroundColor: '#1a1a19', padding: 10, cornerRadius: 8, titleFont: { weight: '700' }, ...(cfg.options.plugins.tooltip || {}) };
  charts[id] = new Chart(el, cfg);
}
function hbar(id, entries, unidade) {
  const trunc = (s) => (s.length > 30 ? s.slice(0, 29) + '…' : s);
  const tot = entries.reduce((s, e) => s + e[1], 0);
  mkChart(id, {
    type: 'bar',
    data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: C1, borderRadius: 4, borderSkipped: 'start', maxBarThickness: 20 }] },
    options: { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false }, ticks: { callback: function (v) { return trunc(this.getLabelForValue(v)); } } } },
      plugins: { tooltip: { callbacks: { label: (i) => `${i.raw} ${unidade} · ${tot ? fPct(i.raw / tot) : ''}` } } } }
  });
}
Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
Chart.defaults.font.size = 12;
Chart.defaults.color = INK2;
Chart.defaults.borderColor = GRID;
