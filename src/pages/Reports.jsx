import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../components/Modal.jsx';

// ===== Budget control config =====
const OVERHEAD_CATEGORIES = [
  'Consommables médicaux',
  'Matériel & équipement',
  'Laboratoire / analyses',
  'Loyer & charges locatives',
  'Salaires & charges sociales',
  'Assurances',
  'Frais bancaires',
  'Marketing & publicité',
  'Véhicule & déplacements',
  'Formation',
  'Logiciels & abonnements',
  'Téléphone & internet',
  'Entretien & nettoyage',
  'Comptabilité & honoraires',
  'Énergie (élec/eau/gaz)',
  'Autre',
];
// Luxembourg VAT rates
const LU_VAT_RATES = [17, 14, 8, 3, 0];
// Distinct colors for category pie charts
const CHART_COLORS = [
  '#2563EB', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2',
  '#db2777', '#65a30d', '#ea580c', '#0d9488', '#9333ea', '#ca8a04',
  '#475569', '#e11d48', '#15803d', '#1d4ed8',
];

// ===== Formatters =====
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtMoney(v) {
  return Number(v || 0).toLocaleString('fr-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtInt(v) {
  return Number(v || 0).toLocaleString('fr-LU');
}
function fmtPct(v) {
  return v == null ? '—' : (Number(v).toFixed(1) + '%');
}
function fmtMonth(ym) {
  if (!ym || ym.length < 7) return ym;
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

// ===== Excel export (budget) =====
function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Render a "dépenses par catégorie (HT)" pie chart to a PNG data URL via canvas.
function renderCategoryChartPng(cats) {
  const W = 720, H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#111827'; ctx.font = 'bold 15px Arial'; ctx.textAlign = 'left';
  ctx.fillText('Dépenses par catégorie (HT)', 20, 26);

  const data = [...cats].filter((c) => (Number(c.ht) || 0) > 0).sort((a, b) => b.ht - a.ht);
  const total = data.reduce((s, c) => s + (Number(c.ht) || 0), 0) || 1;
  const cx = 190, cy = 215, r = 150;
  let a = -Math.PI / 2;
  data.forEach((c, i) => {
    const frac = (Number(c.ht) || 0) / total;
    const a1 = a + frac * 2 * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, a, a1);
    ctx.closePath();
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.stroke();
    a = a1;
  });

  // Legend on the right
  ctx.font = '12px Arial'; ctx.textAlign = 'left';
  let ly = 70;
  data.forEach((c, i) => {
    if (ly > H - 16) return;
    ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length];
    ctx.fillRect(390, ly - 10, 12, 12);
    ctx.fillStyle = '#374151';
    const pct = ((Number(c.ht) || 0) / total * 100).toFixed(1);
    const lbl = c.category.length > 22 ? c.category.slice(0, 21) + '…' : c.category;
    ctx.fillText(`${lbl} — ${Math.round(Number(c.ht) || 0).toLocaleString('fr-FR')} € (${pct}%)`, 408, ly);
    ly += 21;
  });
  return canvas.toDataURL('image/png');
}

const EUR_FMT = '#,##0.00 "€"';

// Build and download the budget workbook (Synthèse + Charges par catégorie + Détail).
async function exportBudgetExcel({ data, lines, period }) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default || mod;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Colveto';
  const num = (v) => Number(v || 0);
  const periodLabel = `${period.startDate || '—'} → ${period.endDate || '—'}`;
  const cats = data.overheads?.byCategory || [];

  // --- Sheet 1: Synthèse ---
  const s1 = wb.addWorksheet('Synthèse');
  s1.columns = [{ width: 34 }, { width: 18 }];
  const t1 = s1.addRow(['Synthèse financière']); t1.font = { bold: true, size: 14 };
  s1.addRow(['Période', periodLabel]);
  s1.addRow([]);
  const collected = data.tva?.collected ?? data.tva?.total ?? 0;
  const synthRows = [
    ["Chiffre d'affaires HT", data.ca?.ht],
    ["Chiffre d'affaires TTC", data.ca?.ttc],
    ['TVA collectée (ventes)', collected],
    ['TVA déductible (dépenses)', data.tva?.deductible],
    ['TVA nette à payer', data.tva?.net],
    ['Charges fixes (HT)', data.overheads?.fixed],
    ['Charges variables (HT)', data.overheads?.variable],
    ['Bénéfice', data.profit],
  ];
  for (const [k, v] of synthRows) {
    const r = s1.addRow([k, num(v)]);
    r.getCell(2).numFmt = EUR_FMT;
    if (k === 'TVA nette à payer' || k === 'Bénéfice') r.font = { bold: true };
  }

  // --- Sheet 2: Charges par catégorie (+ chart) ---
  const s2 = wb.addWorksheet('Charges par catégorie');
  s2.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 16 }];
  const h2 = s2.addRow(['Catégorie', 'HT', 'TVA', 'TTC']); h2.font = { bold: true };
  for (const c of cats) {
    const r = s2.addRow([c.category, num(c.ht), num(c.vat), num(c.ttc)]);
    [2, 3, 4].forEach((i) => { r.getCell(i).numFmt = EUR_FMT; });
  }
  const tt = s2.addRow([
    'Total',
    cats.reduce((s, c) => s + num(c.ht), 0),
    cats.reduce((s, c) => s + num(c.vat), 0),
    cats.reduce((s, c) => s + num(c.ttc), 0),
  ]);
  tt.font = { bold: true };
  [2, 3, 4].forEach((i) => { tt.getCell(i).numFmt = EUR_FMT; });
  if (cats.length) {
    try {
      const png = renderCategoryChartPng(cats);
      const imgId = wb.addImage({ base64: png, extension: 'png' });
      s2.addImage(imgId, { tl: { col: 5, row: 1 }, ext: { width: 580, height: 320 } });
    } catch { /* chart optional */ }
  }

  // --- Sheet 3: Détail charges ---
  const s3 = wb.addWorksheet('Détail charges');
  s3.columns = [
    { header: 'Mois', width: 10 }, { header: 'Type', width: 10 }, { header: 'Catégorie', width: 26 },
    { header: 'Libellé', width: 28 }, { header: 'HT', width: 14 }, { header: 'TVA %', width: 9 },
    { header: 'TVA €', width: 14 }, { header: 'TTC', width: 14 }, { header: 'Récupérable', width: 12 },
  ];
  s3.getRow(1).font = { bold: true };
  for (const it of (lines || [])) {
    const ht = num(it.amountHT), rate = num(it.vatRate), vat = ht * rate / 100;
    const r = s3.addRow([
      it.yearMonth, it.kind === 'fixed' ? 'Fixe' : 'Variable', it.category || 'Sans catégorie',
      it.label, ht, rate, vat, ht + vat, it.vatRecoverable ? 'Oui' : 'Non',
    ]);
    [5, 7, 8].forEach((i) => { r.getCell(i).numFmt = EUR_FMT; });
  }

  const buf = await wb.xlsx.writeBuffer();
  const fname = `budget_${(period.startDate || '').replace(/-/g, '')}_${(period.endDate || '').replace(/-/g, '')}.xlsx`;
  downloadBlob(fname, new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

// ===== Period picker (mois courant / année courante / 12 derniers mois / custom) =====
// Local-time date formatters. NOTE: never use Date#toISOString() on a date built
// from local components (new Date(y, m, d)) — it converts to UTC and, in timezones
// ahead of UTC (e.g. Luxembourg, UTC+1/+2), shifts the 1st of a month to the
// previous month. Always format from local getFullYear/getMonth/getDate.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function ymLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function defaultPeriod() {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    mode: 'thisMonth',
    startDate: ymdLocal(monthStart),
    endDate: ymdLocal(monthEnd),
  };
}
function applyMode(mode, custom) {
  const today = new Date();
  if (mode === 'thisMonth') {
    const s = new Date(today.getFullYear(), today.getMonth(), 1);
    const e = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { mode, startDate: ymdLocal(s), endDate: ymdLocal(e) };
  }
  if (mode === 'thisYear') {
    const s = new Date(today.getFullYear(), 0, 1);
    const e = new Date(today.getFullYear(), 11, 31);
    return { mode, startDate: ymdLocal(s), endDate: ymdLocal(e) };
  }
  if (mode === 'last12') {
    const e = today;
    const s = new Date(today.getFullYear(), today.getMonth() - 11, 1);
    return { mode, startDate: ymdLocal(s), endDate: ymdLocal(e) };
  }
  return { mode: 'custom', startDate: custom?.startDate || '', endDate: custom?.endDate || '' };
}
function PeriodPicker({ period, setPeriod, extra }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
      <div>
        <label style={{ fontSize: '0.78rem' }}>Période</label>
        <select className="input" value={period.mode}
          onChange={(e) => setPeriod(applyMode(e.target.value, period))}>
          <option value="thisMonth">Mois courant</option>
          <option value="thisYear">Année courante</option>
          <option value="last12">12 derniers mois</option>
          <option value="custom">Personnalisée</option>
        </select>
      </div>
      <div>
        <label style={{ fontSize: '0.78rem' }}>Du</label>
        <input className="input" type="date" value={period.startDate}
          disabled={period.mode !== 'custom'}
          onChange={(e) => setPeriod({ ...period, startDate: e.target.value })} />
      </div>
      <div>
        <label style={{ fontSize: '0.78rem' }}>Au</label>
        <input className="input" type="date" value={period.endDate}
          disabled={period.mode !== 'custom'}
          onChange={(e) => setPeriod({ ...period, endDate: e.target.value })} />
      </div>
      {extra}
    </div>
  );
}

// ===== Employee filter =====
function EmployeeFilter({ value, onChange }) {
  const [users, setUsers] = useState([]);
  useEffect(() => { window.api.users.list().then(setUsers).catch(() => setUsers([])); }, []);
  return (
    <div>
      <label style={{ fontSize: '0.78rem' }}>Employé</label>
      <select className="input" value={value || ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">— Tous —</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
      </select>
    </div>
  );
}

// ===== Tiny inline bar chart =====
function BarChart({ data, valueKey, label = 'Mois', height = 110 }) {
  if (!data?.length) return <div className="empty-state">Pas de données.</div>;
  const max = Math.max(...data.map((d) => Number(d[valueKey]) || 0), 1);
  const barW = 100 / data.length;
  const top = 14; // room for the value label above the tallest bar
  return (
    <svg width="100%" height={top + height + 30} style={{ display: 'block' }}>
      {data.map((d, i) => {
        const v = Number(d[valueKey]) || 0;
        const h = (v / max) * height;
        const x = i * barW;
        return (
          <g key={i}>
            <rect x={`${x + 0.5}%`} y={top + height - h} width={`${barW - 1}%`} height={h}
              fill="#2563EB" rx="2" />
            <text x={`${x + barW / 2}%`} y={top + height + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
              {fmtMonth(d.month)}
            </text>
            {v > 0 && (
              <text x={`${x + barW / 2}%`} y={top + height - h - 3} textAnchor="middle" fontSize="9" fill="#1f2937">
                {v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ===== Profit chart: bars above/below a zero line (green = bénéfice, red = perte) =====
function ProfitChart({ data, height = 140 }) {
  if (!data?.length) return <div className="empty-state">Pas de données.</div>;
  const vals = data.map((d) => Number(d.profit) || 0);
  const maxPos = Math.max(...vals, 0);
  const maxNeg = Math.max(...vals.map((v) => -v), 0);
  const range = maxPos + maxNeg || 1;
  const top = 14, bottom = 14; // room for value labels above/below the bars
  const zeroY = top + (maxPos / range) * height;
  const barW = 100 / data.length;
  const short = (v) => {
    const a = Math.abs(v);
    return (v < 0 ? '−' : '') + (a >= 1000 ? (a / 1000).toFixed(1) + 'k' : Math.round(a));
  };
  return (
    <svg width="100%" height={top + height + bottom + 18} style={{ display: 'block' }}>
      <line x1="0" x2="100%" y1={zeroY} y2={zeroY} stroke="#9ca3af" strokeWidth="1" />
      {data.map((d, i) => {
        const v = vals[i];
        const h = (Math.abs(v) / range) * height;
        const x = i * barW;
        const cx = `${x + barW / 2}%`;
        const hasData = (Number(d.ca_ht) || 0) !== 0 || (Number(d.charges_ht) || 0) !== 0;
        return (
          <g key={i}>
            <title>{`${fmtMonth(d.month)} — CA ${fmtMoney(d.ca_ht)} − charges ${fmtMoney(d.charges_ht)} = ${fmtMoney(v)}`}</title>
            {h > 0 && (
              <rect x={`${x + 0.5}%`} y={v >= 0 ? zeroY - h : zeroY} width={`${barW - 1}%`} height={h}
                fill={v >= 0 ? '#16a34a' : '#dc2626'} rx="2" />
            )}
            {hasData && (
              <text x={cx} y={v >= 0 ? zeroY - h - 3 : zeroY + h + 10} textAnchor="middle" fontSize="9" fill="#1f2937">
                {short(v)}
              </text>
            )}
            <text x={cx} y={top + height + bottom + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
              {fmtMonth(d.month)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ===== KPI card =====
function Kpi({ label, value, sub, color = '#1f2937' }) {
  return (
    <div style={{
      background: '#f8fafc', padding: 14, borderRadius: 8, border: '1px solid #e5e7eb',
      flex: '1 1 200px', minWidth: 180,
    }}>
      <div style={{ fontSize: '0.78rem', color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ===== Main =====
export default function Reports() {
  const [tab, setTab] = useState('financial');

  const TabBtn = ({ id, children }) => (
    <button className={'btn ' + (tab === id ? 'btn-primary' : 'btn-secondary')} onClick={() => setTab(id)}>
      {children}
    </button>
  );

  return (
    <div>
      <div className="page-header"><h2>Rapports</h2></div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <TabBtn id="financial">📊 Synthèse</TabBtn>
          <TabBtn id="cash">💶 Caisse</TabBtn>
          <TabBtn id="activity">👥 Activité</TabBtn>
          <TabBtn id="tops">🏆 Tops</TabBtn>
          <TabBtn id="team">👔 Équipe</TabBtn>
          <TabBtn id="overheads">💼 Charges</TabBtn>
          <TabBtn id="margin">💰 Marges méd.</TabBtn>
          <TabBtn id="lotRecall">🔎 Rappel lot</TabBtn>
        </div>
      </div>

      {tab === 'financial' && <FinancialReport />}
      {tab === 'cash' && <CashReport />}
      {tab === 'activity' && <ActivityReport />}
      {tab === 'tops' && <TopsReport />}
      {tab === 'team' && <TeamReport />}
      {tab === 'overheads' && <OverheadsTab />}
      {tab === 'margin' && <MarginReport />}
      {tab === 'lotRecall' && <LotRecall />}
    </div>
  );
}

// =============== FINANCIAL ===============
function FinancialReport() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [userId, setUserId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.reports.financial({
        startDate: period.startDate, endDate: period.endDate, userId: userId || undefined,
      });
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period.startDate, period.endDate, userId]);

  async function exportExcel() {
    if (!data) return;
    setExporting(true);
    try {
      const lines = await window.api.overheads.list({
        startMonth: (period.startDate || '').slice(0, 7),
        endMonth: (period.endDate || '').slice(0, 7),
      });
      await exportBudgetExcel({ data, lines, period });
    } catch (e) {
      alert("Échec de l'export Excel : " + (e?.message || e));
    } finally { setExporting(false); }
  }

  const tvaNet = data?.tva?.net ?? ((data?.tva?.collected ?? data?.tva?.total ?? 0) - (data?.tva?.deductible ?? 0));

  return (
    <div className="card">
      <h3>Synthèse financière</h3>
      <PeriodPicker period={period} setPeriod={setPeriod}
        extra={<>
          <EmployeeFilter value={userId} onChange={setUserId} />
          <button className="btn btn-secondary" onClick={exportExcel} disabled={!data || exporting}>
            {exporting ? 'Export…' : '📥 Exporter en Excel'}
          </button>
        </>} />

      {loading && <div className="empty-state">Chargement…</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Chiffre d'affaires HT" value={fmtMoney(data.ca.ht)} sub={`${data.ca.count} facture${data.ca.count > 1 ? 's' : ''}`} />
            <Kpi label="Chiffre d'affaires TTC" value={fmtMoney(data.ca.ttc)} />
            <Kpi label="TVA collectée" value={fmtMoney(data.tva.collected ?? data.tva.total)} sub="sur les ventes" />
            <Kpi label="TVA déductible" value={fmtMoney(data.tva.deductible || 0)} sub="sur les dépenses récup." color="#0e7490" />
            <Kpi label="TVA nette à payer" value={fmtMoney(tvaNet)} color={tvaNet >= 0 ? '#dc2626' : '#16a34a'}
              sub={tvaNet >= 0 ? 'à reverser' : 'crédit de TVA'} />
            <Kpi label="Charges fixes" value={fmtMoney(data.overheads.fixed)} color="#b45309" />
            <Kpi label="Charges variables" value={fmtMoney(data.overheads.variable)} color="#b45309" />
            <Kpi label="Bénéfice" value={fmtMoney(data.profit)} color={data.profit >= 0 ? '#16a34a' : '#dc2626'}
              sub="CA HT − charges fixes & variables" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>TVA collectée par taux</h4>
            {data.tva.byRate.length === 0 ? <div className="empty-state">Aucune TVA sur la période.</div> : (
              <table className="table">
                <thead><tr><th>Taux</th><th style={{ textAlign: 'right' }}>Montant TVA</th></tr></thead>
                <tbody>
                  {data.tva.byRate.map((r, i) => (
                    <tr key={i}><td>{Number(r.rate).toFixed(1)}%</td><td style={{ textAlign: 'right' }}>{fmtMoney(r.amount)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>CA HT — 12 derniers mois</h4>
            <BarChart data={data.byMonth} valueKey="ca_ht" />
          </div>

          {data.byMonth?.[0]?.profit !== undefined && (
            <div style={{ marginTop: 16 }}>
              <h4 style={{ marginBottom: 8 }}>Bénéfice — 12 derniers mois</h4>
              <ProfitChart data={data.byMonth} />
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 4 }}>
                CA HT − charges du mois (toutes charges encodées). Survolez une barre pour le détail.
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// =============== CAISSE ===============
const CASH_MOVEMENT_LABELS = { count: 'Comptage', withdrawal: 'Sortie', deposit: 'Apport' };

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function CashReport() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      setData(await window.api.cash.summary({ startDate: period.startDate, endDate: period.endDate }));
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period.startDate, period.endDate]);

  async function save() {
    const amount = parseFloat(String(form.amount).replace(',', '.'));
    if (!Number.isFinite(amount) || amount < 0) { alert('Montant invalide'); return; }
    try {
      await window.api.cash.addMovement({ type: form.type, amount, note: form.note?.trim() || null });
      setForm(null);
      load();
    } catch (e) {
      alert('Erreur : ' + (e?.message || e));
    }
  }
  async function remove(m) {
    if (!confirm(`Supprimer ce ${CASH_MOVEMENT_LABELS[m.type].toLowerCase()} de ${fmtMoney(m.amount)} ?`)) return;
    await window.api.cash.deleteMovement(m.id);
    load();
  }

  const gapColor = (g) => (Math.abs(g) < 0.005 ? '#16a34a' : '#dc2626');
  const fmtGap = (g) => (g > 0 ? '+' : '') + fmtMoney(g);

  return (
    <div className="card">
      <h3>Caisse</h3>
      <PeriodPicker period={period} setPeriod={setPeriod}
        extra={<>
          <button className="btn btn-primary" onClick={() => setForm({ type: 'count', amount: '', note: '' })}>🧮 Compter la caisse</button>
          <button className="btn btn-secondary" onClick={() => setForm({ type: 'withdrawal', amount: '', note: '' })}>↗ Sortie</button>
          <button className="btn btn-secondary" onClick={() => setForm({ type: 'deposit', amount: '', note: '' })}>↘ Apport</button>
        </>} />

      {loading && !data && <div className="empty-state">Chargement…</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Espèces encaissées (factures validées)" value={fmtMoney(data.cashInvoicesTotal)}
              sub={data.cashDraftsTotal > 0
                ? `+ ${fmtMoney(data.cashDraftsTotal)} sur des brouillons pas encore validés`
                : 'sur la période'} />
            <Kpi label="Dans la caisse (théorique)" color="#0e7490"
              value={data.expectedBalance == null ? '—' : fmtMoney(data.expectedBalance)}
              sub={data.lastCount
                ? `dernier comptage ${fmtMoney(data.lastCount.amount)} le ${fmtDateTime(data.lastCount.date)}`
                : 'faites un premier comptage pour démarrer'} />
            {data.lastCount?.gap != null && (
              <Kpi label="Écart au dernier comptage" value={fmtGap(data.lastCount.gap)} color={gapColor(data.lastCount.gap)}
                sub="compté − théorique" />
            )}
            <Kpi label="Sorties / apports" value={`${fmtMoney(data.withdrawalsTotal)} / ${fmtMoney(data.depositsTotal)}`} color="#b45309"
              sub="sur la période" />
          </div>

          <h4 style={{ marginBottom: 8 }}>Comptages et mouvements</h4>
          {data.movements.length === 0 ? <div className="empty-state">Aucun mouvement sur la période.</div> : (
            <table className="table" style={{ marginBottom: 16 }}>
              <thead><tr>
                <th>Date</th><th>Type</th><th style={{ textAlign: 'right' }}>Montant</th>
                <th style={{ textAlign: 'right' }}>Théorique</th><th style={{ textAlign: 'right' }}>Écart</th>
                <th>Note</th><th>Par</th><th></th>
              </tr></thead>
              <tbody>
                {[...data.movements].reverse().map((m) => {
                  const c = m.type === 'count' ? data.counts.find((x) => x.id === m.id) : null;
                  return (
                    <tr key={m.id}>
                      <td>{fmtDateTime(m.date)}</td>
                      <td>{CASH_MOVEMENT_LABELS[m.type]}</td>
                      <td style={{ textAlign: 'right' }}>{m.type === 'withdrawal' ? '−' : ''}{fmtMoney(m.amount)}</td>
                      <td style={{ textAlign: 'right' }}>{c?.expected != null ? fmtMoney(c.expected) : ''}</td>
                      <td style={{ textAlign: 'right', color: c?.gap != null ? gapColor(c.gap) : undefined }}>{c?.gap != null ? fmtGap(c.gap) : ''}</td>
                      <td>{m.note || ''}</td>
                      <td>{m.createdByName || ''}</td>
                      <td style={{ textAlign: 'right' }}><button className="btn btn-sm" onClick={() => remove(m)}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <h4 style={{ marginBottom: 8 }}>Factures payées en espèces</h4>
          {data.cashInvoices.length === 0 ? <div className="empty-state">Aucune sur la période.</div> : (
            <table className="table">
              <thead><tr><th>Payée le</th><th>Facture</th><th>Client</th><th></th><th style={{ textAlign: 'right' }}>Montant TTC</th></tr></thead>
              <tbody>
                {[...data.cashInvoices].reverse().map((i) => (
                  <tr key={i.id}>
                    <td>{fmtDateTime(i.paidAt)}</td>
                    <td><a href={`#/invoices/${i.id}`}>{i.number}</a></td>
                    <td>{i.ownerLastName} {i.ownerFirstName}</td>
                    <td>{i.status === 'draft' && <span className="badge badge-draft">À valider</span>}</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(i.totalTTC)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {form && (
        <Modal title={{ count: 'Comptage de la caisse', withdrawal: 'Sortie de caisse', deposit: 'Apport en caisse' }[form.type]}
          onClose={() => setForm(null)}
          footer={<>
            <button className="btn" onClick={() => setForm(null)}>Annuler</button>
            <button className="btn btn-primary" onClick={save}>Enregistrer</button>
          </>}>
          <div className="form-group">
            <label>{form.type === 'count' ? 'Montant compté dans la caisse (€) *' : 'Montant (€) *'}</label>
            <input className="input" inputMode="decimal" autoFocus value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Note</label>
            <input className="input" value={form.note}
              placeholder={form.type === 'withdrawal' ? 'ex. dépôt en banque' : ''}
              onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </div>
          {form.type === 'count' && (
            <p className="text-light" style={{ fontSize: '0.85rem', margin: 0 }}>
              Le comptage devient la nouvelle base : les espèces encaissées ensuite s'y ajoutent, les sorties s'en déduisent.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}

// =============== ACTIVITY ===============
function ActivityReport() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [userId, setUserId] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.reports.activity({
        startDate: period.startDate, endDate: period.endDate, userId: userId || undefined,
      });
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period.startDate, period.endDate, userId]);

  return (
    <div className="card">
      <h3>Activité</h3>
      <PeriodPicker period={period} setPeriod={setPeriod}
        extra={<EmployeeFilter value={userId} onChange={setUserId} />} />

      {loading && <div className="empty-state">Chargement…</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
            <Kpi label="Nouveaux clients" value={fmtInt(data.newOwners)} />
            <Kpi label="Nouveaux patients" value={fmtInt(data.newPatients)} />
            <Kpi label="Consultations" value={fmtInt(data.nConsultations)} sub="Comptées via dossiers médicaux" />
          </div>

          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Répartition par espèce</h4>
            {data.speciesBreakdown.length === 0 ? <div className="empty-state">Aucune consultation sur la période.</div> : (
              <table className="table">
                <thead><tr><th>Espèce</th><th style={{ textAlign: 'right' }}>Consultations</th></tr></thead>
                <tbody>
                  {data.speciesBreakdown.map((r, i) => (
                    <tr key={i}><td>{r.species || '—'}</td><td style={{ textAlign: 'right' }}>{fmtInt(r.n)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Nouveaux clients — 12 derniers mois</h4>
            <BarChart data={data.byMonth} valueKey="newOwners" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <h4 style={{ marginBottom: 8 }}>Consultations — 12 derniers mois</h4>
            <BarChart data={data.byMonth} valueKey="nConsultations" />
          </div>
        </>
      )}
    </div>
  );
}

// =============== TOPS ===============
function TopsReport() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.reports.tops({
        startDate: period.startDate, endDate: period.endDate, limit: 10,
      });
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period.startDate, period.endDate]);

  return (
    <div className="card">
      <h3>Tops</h3>
      <PeriodPicker period={period} setPeriod={setPeriod} />

      {loading && <div className="empty-state">Chargement…</div>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div>
            <h4 style={{ marginBottom: 8 }}>🏥 Top 10 actes facturés</h4>
            {data.topActs.length === 0 ? <div className="empty-state">Aucun acte facturé.</div> : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Acte</th>
                    <th style={{ textAlign: 'right' }}>Nb</th>
                    <th style={{ textAlign: 'right' }}>CA HT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topActs.map((r) => (
                    <tr key={r.key}>
                      <td>{r.code ? <code style={{ marginRight: 6 }}>{r.code}</code> : null}<strong>{r.name}</strong></td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(r.n)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.ca_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>💊 Top 10 médicaments vendus</h4>
            {data.topMeds.length === 0 ? <div className="empty-state">Aucune vente de médicament.</div> : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Médicament</th>
                    <th style={{ textAlign: 'right' }}>Qté</th>
                    <th style={{ textAlign: 'right' }}>CA HT</th>
                    <th style={{ textAlign: 'right' }}>Coût HT</th>
                    <th style={{ textAlign: 'right' }}>Marge €</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topMeds.map((r) => (
                    <tr key={r.medicineId}>
                      <td><strong>{r.name}</strong></td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(r.qty)} {r.baseUnit}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.ca_ht)}</td>
                      <td style={{ textAlign: 'right', color: '#b45309' }}>{fmtMoney(r.cost_ht)}</td>
                      <td style={{ textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>{fmtMoney(r.margin_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div>
            <h4 style={{ marginBottom: 8 }}>👤 Top 10 clients</h4>
            {data.topClients.length === 0 ? <div className="empty-state">Aucun client facturé.</div> : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th style={{ textAlign: 'right' }}>Nb factures</th>
                    <th style={{ textAlign: 'right' }}>CA HT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topClients.map((r) => (
                    <tr key={r.ownerId}>
                      <td><strong>{r.lastName} {r.firstName}</strong></td>
                      <td style={{ textAlign: 'right' }}>{fmtInt(r.n_invoices)}</td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(r.ca_ht)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// =============== TEAM ===============
function TeamReport() {
  const [period, setPeriod] = useState(defaultPeriod());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('ca_ht');

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.reports.team({
        startDate: period.startDate, endDate: period.endDate,
      });
      setData(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [period.startDate, period.endDate]);

  const sortedUsers = useMemo(() => {
    if (!data?.users) return [];
    return [...data.users].sort((a, b) => (Number(b[sort]) || 0) - (Number(a[sort]) || 0));
  }, [data, sort]);

  return (
    <div className="card">
      <h3>Performance par employé</h3>
      <PeriodPicker period={period} setPeriod={setPeriod} />

      {loading && <div className="empty-state">Chargement…</div>}
      {data && (
        sortedUsers.length === 0 ? <div className="empty-state">Aucun utilisateur actif.</div> : (
          <table className="table">
            <thead>
              <tr>
                <th>Employé</th>
                <th>Rôle</th>
                <SortableTh field="nConsultations" sort={sort} setSort={setSort}>Consultations</SortableTh>
                <SortableTh field="nActs" sort={sort} setSort={setSort}>Actes facturés</SortableTh>
                <SortableTh field="nDispensings" sort={sort} setSort={setSort}>Méd. vendus</SortableTh>
                <SortableTh field="n_invoices" sort={sort} setSort={setSort}>Factures</SortableTh>
                <SortableTh field="ca_ht" sort={sort} setSort={setSort}>CA HT</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedUsers.map((u) => (
                <tr key={u.userId}>
                  <td><strong>{u.fullName}</strong></td>
                  <td style={{ fontSize: '0.85rem', color: '#6b7280' }}>{u.role}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(u.nConsultations)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(u.nActs)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(u.nDispensings)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtInt(u.n_invoices)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(u.ca_ht)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
      <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 8 }}>
        Note : attribution basée sur le champ <code>createdBy</code> (utilisateur connecté qui a saisi le dossier ou la facture).
      </div>
    </div>
  );
}
function SortableTh({ field, sort, setSort, children }) {
  const active = sort === field;
  return (
    <th style={{ textAlign: 'right', cursor: 'pointer' }} onClick={() => setSort(field)}>
      {children}{active ? ' ▼' : ''}
    </th>
  );
}

// =============== OVERHEADS (charges mensuelles) ===============
function OverheadsTab() {
  const today = new Date();
  const [yearMonth, setYearMonth] = useState(ymLocal(today));
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [newItem, setNewItem] = useState({ kind: 'variable', category: '', label: '', amountHT: '', vatRate: 17, vatRecoverable: true });
  const [editItem, setEditItem] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.overheads.list({ startMonth: yearMonth, endMonth: yearMonth });
      setItems(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [yearMonth]);

  async function addItem() {
    if (!newItem.label.trim() || !Number(newItem.amountHT)) {
      alert('Renseigne le libellé et un montant > 0.');
      return;
    }
    await window.api.overheads.create({
      yearMonth,
      kind: newItem.kind,
      category: newItem.category.trim() || null,
      label: newItem.label.trim(),
      amountHT: Number(newItem.amountHT),
      vatRate: Number(newItem.vatRate) || 0,
      vatRecoverable: newItem.vatRecoverable,
    });
    // keep type / category / vat settings for fast repeated entry
    setNewItem({ ...newItem, label: '', amountHT: '' });
    load();
  }
  async function removeItem(id) {
    if (!confirm('Supprimer cette charge ?')) return;
    await window.api.overheads.delete(id);
    load();
  }
  async function saveEdit() {
    if (!editItem.label.trim() || !Number(editItem.amountHT)) {
      alert('Renseigne le libellé et un montant > 0.');
      return;
    }
    if (!editItem.yearMonth || !/^\d{4}-\d{2}$/.test(editItem.yearMonth)) {
      alert('Renseigne un mois valide.');
      return;
    }
    await window.api.overheads.update(editItem.id, {
      yearMonth: editItem.yearMonth,
      kind: editItem.kind,
      category: (editItem.category || '').trim() || null,
      label: editItem.label.trim(),
      amountHT: Number(editItem.amountHT),
      vatRate: Number(editItem.vatRate) || 0,
      vatRecoverable: editItem.vatRecoverable,
    });
    setEditItem(null);
    load();
  }

  const fixed = items.filter((i) => i.kind === 'fixed');
  const variable = items.filter((i) => i.kind === 'variable');

  // Year-month options: 24 months back, 6 months forward
  const monthOptions = useMemo(() => {
    const out = [];
    const t = new Date();
    for (let i = -24; i <= 6; i++) {
      const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
      const ym = ymLocal(d);
      out.push({ ym, label: d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) });
    }
    return out.reverse();
  }, []);

  return (
    <div className="card">
      <h3>Charges mensuelles</h3>
      <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: 12 }}>
        Saisissez vos charges fixes (loyer, salaires, abonnements…) et variables (consommables, frais ponctuels…) par mois,
        avec leur catégorie et leur TVA. Le bénéfice (onglet Synthèse) soustrait le HT ; la TVA récupérable y est déduite de
        la TVA à payer. Export Excel disponible dans l'onglet Synthèse.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: '0.78rem' }}>Mois</label>
          <select className="input" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)}>
            {monthOptions.map((o) => <option key={o.ym} value={o.ym}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {loading && <div className="empty-state">Chargement…</div>}
      {!loading && (
        <>
          <CategoryBreakdown items={items} />
          <OverheadList title="Charges fixes" items={fixed} onDelete={removeItem} onEdit={setEditItem} />
          <OverheadList title="Charges variables" items={variable} onDelete={removeItem} onEdit={setEditItem} />

          <div style={{ marginTop: 24, padding: 12, background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }}>
            <h4 style={{ marginBottom: 8 }}>+ Ajouter une charge</h4>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Type</label>
                <select className="input" value={newItem.kind}
                  onChange={(e) => setNewItem({ ...newItem, kind: e.target.value })}>
                  <option value="fixed">Fixe</option>
                  <option value="variable">Variable</option>
                </select>
              </div>
              <div style={{ minWidth: 180 }}>
                <label style={{ fontSize: '0.78rem' }}>Catégorie</label>
                <input className="input" list="overhead-categories" placeholder="ex: Consommables" value={newItem.category}
                  onChange={(e) => setNewItem({ ...newItem, category: e.target.value })} />
                <datalist id="overhead-categories">
                  {OVERHEAD_CATEGORIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div style={{ flex: 1, minWidth: 180 }}>
                <label style={{ fontSize: '0.78rem' }}>Libellé</label>
                <input className="input" placeholder="ex: Loyer cabinet" value={newItem.label}
                  onChange={(e) => setNewItem({ ...newItem, label: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Montant HT (€)</label>
                <input className="input" type="number" step="0.01" placeholder="0.00" value={newItem.amountHT}
                  onChange={(e) => setNewItem({ ...newItem, amountHT: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addItem()}
                  style={{ width: 110 }} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem' }}>TVA</label>
                <select className="input" value={newItem.vatRate}
                  onChange={(e) => setNewItem({ ...newItem, vatRate: Number(e.target.value) })} style={{ width: 80 }}>
                  {LU_VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
              <label style={{ fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 8 }}
                title="Décochez si cette TVA n'est pas récupérable (elle ne sera pas déduite de la TVA à payer).">
                <input type="checkbox" checked={newItem.vatRecoverable}
                  onChange={(e) => setNewItem({ ...newItem, vatRecoverable: e.target.checked })} />
                TVA récup.
              </label>
              <button className="btn btn-primary" onClick={addItem}>Ajouter</button>
            </div>
          </div>
        </>
      )}

      {editItem && (
        <Modal title="Modifier la charge" onClose={() => setEditItem(null)}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setEditItem(null)}>Annuler</button>
            <button className="btn btn-primary" onClick={saveEdit}>Enregistrer</button>
          </>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <div>
                <label style={{ fontSize: '0.78rem' }}>Mois</label>
                <input className="input" type="month" value={editItem.yearMonth || ''}
                  onChange={(e) => setEditItem({ ...editItem, yearMonth: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.78rem' }}>Type</label>
                <select className="input" value={editItem.kind}
                  onChange={(e) => setEditItem({ ...editItem, kind: e.target.value })}>
                  <option value="fixed">Fixe</option>
                  <option value="variable">Variable</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem' }}>Catégorie</label>
              <input className="input" list="overhead-categories-edit" value={editItem.category || ''}
                onChange={(e) => setEditItem({ ...editItem, category: e.target.value })} />
              <datalist id="overhead-categories-edit">
                {OVERHEAD_CATEGORIES.map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
            <div>
              <label style={{ fontSize: '0.78rem' }}>Libellé</label>
              <input className="input" value={editItem.label}
                onChange={(e) => setEditItem({ ...editItem, label: e.target.value })} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '0.78rem' }}>Montant HT (€)</label>
                <input className="input" type="number" step="0.01" value={editItem.amountHT}
                  onChange={(e) => setEditItem({ ...editItem, amountHT: e.target.value })} />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem' }}>TVA</label>
                <select className="input" value={editItem.vatRate}
                  onChange={(e) => setEditItem({ ...editItem, vatRate: Number(e.target.value) })}>
                  {LU_VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}
                </select>
              </div>
            </div>
            <label style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={!!editItem.vatRecoverable}
                onChange={(e) => setEditItem({ ...editItem, vatRecoverable: e.target.checked })} />
              TVA récupérable
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

// Pie chart of HT by category for the selected month.
function CategoryBreakdown({ items }) {
  const cats = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      const c = i.category || 'Sans catégorie';
      m.set(c, (m.get(c) || 0) + (Number(i.amountHT) || 0));
    }
    return [...m.entries()].map(([category, ht]) => ({ category, ht }))
      .filter((c) => c.ht > 0).sort((a, b) => b.ht - a.ht);
  }, [items]);
  if (!cats.length) return null;

  const total = cats.reduce((s, c) => s + c.ht, 0);
  const cx = 90, cy = 90, r = 88;
  let angle = -Math.PI / 2;
  const slices = cats.map((c, i) => {
    const frac = total > 0 ? c.ht / total : 0;
    const a0 = angle, a1 = angle + frac * 2 * Math.PI;
    angle = a1;
    const x0 = (cx + r * Math.cos(a0)).toFixed(2), y0 = (cy + r * Math.sin(a0)).toFixed(2);
    const x1 = (cx + r * Math.cos(a1)).toFixed(2), y1 = (cy + r * Math.sin(a1)).toFixed(2);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const d = cats.length === 1
      ? `M ${cx - r},${cy} A ${r},${r} 0 1 1 ${cx + r},${cy} A ${r},${r} 0 1 1 ${cx - r},${cy} Z`
      : `M ${cx},${cy} L ${x0},${y0} A ${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    return { d, color: CHART_COLORS[i % CHART_COLORS.length], cat: c, frac };
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ marginBottom: 8 }}>Répartition par catégorie (HT)</h4>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
        <svg width="180" height="180" viewBox="0 0 180 180" style={{ flexShrink: 0 }}>
          {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="#fff" strokeWidth="1" />)}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 260 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
              <span style={{ width: 12, height: 12, background: s.color, borderRadius: 2, flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{s.cat.category}</span>
              <span style={{ fontWeight: 600 }}>{fmtMoney(s.cat.ht)}</span>
              <span style={{ color: '#6b7280', width: 46, textAlign: 'right' }}>{(s.frac * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OverheadList({ title, items, onDelete, onEdit }) {
  const groups = useMemo(() => {
    const m = new Map();
    for (const i of items) {
      const c = i.category || 'Sans catégorie';
      if (!m.has(c)) m.set(c, []);
      m.get(c).push(i);
    }
    return [...m.entries()].sort((a, b) => {
      const sa = a[1].reduce((s, i) => s + (Number(i.amountHT) || 0), 0);
      const sb = b[1].reduce((s, i) => s + (Number(i.amountHT) || 0), 0);
      return sb - sa;
    });
  }, [items]);
  const tot = items.reduce((acc, i) => {
    const ht = Number(i.amountHT) || 0, vat = ht * (Number(i.vatRate) || 0) / 100;
    acc.ht += ht; acc.vat += vat; acc.ttc += ht + vat; return acc;
  }, { ht: 0, vat: 0, ttc: 0 });

  return (
    <div style={{ marginBottom: 20 }}>
      <h4 style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <span>{title}</span>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
          HT {fmtMoney(tot.ht)} · TVA {fmtMoney(tot.vat)} · TTC {fmtMoney(tot.ttc)}
        </span>
      </h4>
      {items.length === 0 ? (
        <div className="empty-state" style={{ padding: 12 }}>Aucune ligne.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Libellé</th>
              <th style={{ textAlign: 'right' }}>TVA %</th>
              <th style={{ textAlign: 'right' }}>HT</th>
              <th style={{ textAlign: 'right' }}>TVA €</th>
              <th style={{ textAlign: 'right' }}>TTC</th>
              <th style={{ textAlign: 'center' }}>Récup.</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {groups.map(([cat, rows]) => {
              const sub = rows.reduce((acc, i) => {
                const ht = Number(i.amountHT) || 0, vat = ht * (Number(i.vatRate) || 0) / 100;
                acc.ht += ht; acc.vat += vat; acc.ttc += ht + vat; return acc;
              }, { ht: 0, vat: 0, ttc: 0 });
              return (
                <React.Fragment key={cat}>
                  <tr style={{ background: '#f1f5f9' }}>
                    <td colSpan={2} style={{ fontWeight: 600 }}>{cat}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(sub.ht)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(sub.vat)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtMoney(sub.ttc)}</td>
                    <td colSpan={2}></td>
                  </tr>
                  {rows.map((i) => {
                    const ht = Number(i.amountHT) || 0, rate = Number(i.vatRate) || 0, vat = ht * rate / 100;
                    return (
                      <tr key={i.id}>
                        <td style={{ paddingLeft: 18 }}>{i.label}</td>
                        <td style={{ textAlign: 'right' }}>{rate}%</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(ht)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(vat)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtMoney(ht + vat)}</td>
                        <td style={{ textAlign: 'center' }} title={i.vatRecoverable ? 'TVA récupérable' : 'TVA non récupérable'}>
                          {i.vatRecoverable ? '✓' : '—'}
                        </td>
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          {onEdit && <button className="btn btn-secondary" onClick={() => onEdit({ ...i, vatRecoverable: !!i.vatRecoverable })} style={{ marginRight: 6 }}>Modifier</button>}
                          <button className="btn btn-secondary" onClick={() => onDelete(i.id)}>Suppr.</button>
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// =============== EXISTING: LOT RECALL ===============
function LotRecall() {
  const [search, setSearch] = useState('');
  const [lots, setLots] = useState([]);
  const [selectedLot, setSelectedLot] = useState(null);
  const [dispensings, setDispensings] = useState([]);
  const [loading, setLoading] = useState(false);

  async function searchLots() {
    if (!search.trim()) return;
    setLoading(true);
    setSelectedLot(null);
    setDispensings([]);
    try {
      const found = await window.api.lots.search(search.trim());
      setLots(found);
    } finally { setLoading(false); }
  }
  async function loadDispensings(lot) {
    setSelectedLot(lot);
    setLoading(true);
    try {
      const d = await window.api.dispensings.byLot(lot.id);
      setDispensings(d);
    } finally { setLoading(false); }
  }

  return (
    <div className="card">
      <h3>Recherche de lot pour traçabilité (rappel pharmaceutique)</h3>
      <p style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: 12 }}>
        Entrez un numéro de lot pour retrouver tous les animaux qui en ont reçu et leurs propriétaires.
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input className="input" placeholder="N° lot (ex: ABC123)" value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && searchLots()}
          style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={searchLots} disabled={loading}>Rechercher</button>
      </div>

      {lots.length > 0 && !selectedLot && (
        <table className="table">
          <thead>
            <tr><th>Médicament</th><th>N° Lot</th><th>Péremption</th><th>Restant</th><th></th></tr>
          </thead>
          <tbody>
            {lots.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.medicineName}</strong></td>
                <td><code>{l.lotNumber}</code></td>
                <td>{fmtDate(l.expiryDate)}</td>
                <td>{Number(l.remainingQuantityBaseUnit)} / {Number(l.initialQuantityBaseUnit)} {l.baseUnit}</td>
                <td>
                  <button className="btn btn-secondary" onClick={() => loadDispensings(l)}>Voir traçabilité →</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {lots.length === 0 && search && !loading && (
        <div className="empty-state">Aucun lot trouvé pour "{search}".</div>
      )}

      {selectedLot && (
        <div>
          <button className="btn btn-secondary" onClick={() => setSelectedLot(null)} style={{ marginBottom: 12 }}>← Retour aux lots</button>
          <div style={{ background: '#fef3c7', padding: 12, borderRadius: 8, marginBottom: 16 }}>
            <strong>Lot {selectedLot.lotNumber}</strong> de <strong>{selectedLot.medicineName}</strong> — péremption {fmtDate(selectedLot.expiryDate)}
            <div style={{ marginTop: 4, fontSize: '0.9rem' }}>
              {dispensings.length} dispensation{dispensings.length > 1 ? 's' : ''} • Restant {Number(selectedLot.remainingQuantityBaseUnit)} / {Number(selectedLot.initialQuantityBaseUnit)} {selectedLot.baseUnit}
            </div>
          </div>

          {dispensings.length === 0 ? (
            <div className="empty-state">Ce lot n'a encore été dispensé à aucun animal.</div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Animal</th>
                  <th>Propriétaire</th>
                  <th>Contact</th>
                  <th>Quantité</th>
                </tr>
              </thead>
              <tbody>
                {dispensings.map((d) => (
                  <tr key={d.id}>
                    <td>{fmtDate(d.date)}</td>
                    <td><strong>{d.patientName}</strong> ({d.patientSpecies})</td>
                    <td>{d.ownerLastName} {d.ownerFirstName}</td>
                    <td>
                      {d.ownerEmail && <div style={{ fontSize: '0.85em' }}><a href={`mailto:${d.ownerEmail}`}>{d.ownerEmail}</a></div>}
                      {d.ownerPhone && <div style={{ fontSize: '0.85em' }}>{d.ownerPhone}</div>}
                    </td>
                    <td>{d.quantitySold} × {d.saleUnitName} = {d.baseUnitsConsumed} {d.baseUnit || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// =============== EXISTING: MARGIN PER MEDICINE ===============
function MarginReport() {
  const today = ymdLocal(new Date());
  const monthAgo = new Date(); monthAgo.setMonth(monthAgo.getMonth() - 1);
  const [startDate, setStartDate] = useState(ymdLocal(monthAgo));
  const [endDate, setEndDate] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const r = await window.api.reports.margin({ startDate, endDate });
      setRows(r);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const totals = rows.reduce((acc, r) => {
    acc.cost += r.totalCostHT || 0;
    acc.revenue += r.totalRevenueHT || 0;
    return acc;
  }, { cost: 0, revenue: 0 });
  const overallMargin = totals.cost > 0 ? ((totals.revenue - totals.cost) / totals.cost * 100) : null;

  return (
    <div className="card">
      <h3>Marges par médicament</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <label style={{ fontSize: '0.78rem' }}>Du</label>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: '0.78rem' }}>Au</label>
          <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={load} disabled={loading}>Recharger</button>
      </div>

      <div style={{ background: '#eff6ff', padding: 12, borderRadius: 8, marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <div><strong>Coût d'achat total :</strong> {fmtMoney(totals.cost)}</div>
        <div><strong>Vente HT total :</strong> {fmtMoney(totals.revenue)}</div>
        <div><strong>Marge :</strong> {fmtMoney(totals.revenue - totals.cost)} ({fmtPct(overallMargin)})</div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">Aucune dispensation sur cette période.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Médicament</th>
              <th style={{ textAlign: 'right' }}>Vendu</th>
              <th style={{ textAlign: 'right' }}>Vente HT</th>
              <th style={{ textAlign: 'right' }}>Coût HT</th>
              <th style={{ textAlign: 'right' }}>Marge €</th>
              <th style={{ textAlign: 'right' }}>Marge %</th>
              <th style={{ textAlign: 'right' }}>Cible</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const target = Number(r.targetMarginPct) || 35;
              const off = r.marginPct != null && r.marginPct < target - 5;
              return (
                <tr key={r.medicineId}>
                  <td><strong>{r.medicineName}</strong></td>
                  <td style={{ textAlign: 'right' }}>{Number(r.totalUnitsSold).toLocaleString('fr-LU')} {r.baseUnit}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(r.totalRevenueHT)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(r.totalCostHT)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtMoney(r.marginEUR)}</td>
                  <td style={{ textAlign: 'right', color: off ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                    {fmtPct(r.marginPct)}
                  </td>
                  <td style={{ textAlign: 'right', color: '#6b7280' }}>{target}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
