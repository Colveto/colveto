// Server-side HTML builders for the headless-Chrome PDF renderer (pdf-chrome.js).
//
// The markup + CSS mirror the on-screen React print views (RecordPrint.jsx /
// InvoiceDetail.jsx) so the e-mailed PDFs are pixel-identical to what the desktop
// app used to produce. Everything is self-contained (fonts and logo embedded as data URIs,
// no external request) so rendering needs no auth and no app boot.

const fs = require('fs');
const path = require('path');

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return esc(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ageString(birthDate) {
  if (!birthDate) return '—';
  const years = (Date.now() - new Date(birthDate)) / (1000 * 60 * 60 * 24 * 365.25);
  return years >= 1 ? `${Math.floor(years)} an(s)` : `${Math.floor(years * 12)} mois`;
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('fr-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

let _logoDataUri = null;
function logoDataUri() {
  if (_logoDataUri !== null) return _logoDataUri;
  const candidates = [
    path.join(__dirname, 'logo-pdf.png'),
    path.join(__dirname, 'logo-invoice.png'),
    path.join(__dirname, '..', 'public', 'logo-invoice.png'),
    path.join(__dirname, '..', 'dist', 'logo-invoice.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        _logoDataUri = `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
        return _logoDataUri;
      }
    } catch { /* ignore */ }
  }
  _logoDataUri = '';
  return _logoDataUri;
}

// Polices intégrées (public/fonts/) converties en data URI : le PDF se rend
// sans aucune requête réseau. Repli sur les polices système si absentes.
let _fontCss = null;
function fontCss() {
  if (_fontCss !== null) return _fontCss;
  _fontCss = '';
  const dirs = [path.join(__dirname, 'public', 'fonts'), path.join(__dirname, 'fonts')];
  for (const dir of dirs) {
    try {
      const css = fs.readFileSync(path.join(dir, 'fonts.css'), 'utf8');
      _fontCss = css.replace(/url\(\.\/([\w.-]+\.woff2)\)/g, (m, file) =>
        `url(data:font/woff2;base64,${fs.readFileSync(path.join(dir, file)).toString('base64')})`);
      break;
    } catch { /* essayer le dossier suivant */ }
  }
  return _fontCss;
}

// Shared <head>: embedded fonts + the print/identity CSS (mirror of the React views).
function docHead() {
  return `<meta charset="utf-8">
<style>${fontCss()}</style>
<style>${BASE_CSS}</style>`;
}

function headerHtml(settings, { title, subtitleHtml }) {
  const logo = logoDataUri();
  return `
  <header class="doc-header">
    <div class="doc-cabinet">
      ${logo ? `<img class="doc-logo" src="${logo}" alt="">` : ''}
      <div>
        <div class="doc-cabinet-name">${esc(settings.clinicName || 'Cabinet vétérinaire')}</div>
        <div class="doc-cabinet-info">
          ${settings.clinicAddress ? `<div>${esc(settings.clinicAddress)}</div>` : ''}
          ${(settings.clinicPostalCode || settings.clinicCity) ? `<div>${esc(`${settings.clinicPostalCode || ''} ${settings.clinicCity || ''}`.trim())}</div>` : ''}
          ${settings.clinicPhone ? `<div>📞 ${esc(settings.clinicPhone)}</div>` : ''}
          ${settings.clinicEmail ? `<div>✉ ${esc(settings.clinicEmail)}</div>` : ''}
          ${settings.clinicVatNumber ? `<div class="doc-cabinet-tva">TVA : ${esc(settings.clinicVatNumber)}</div>` : ''}
        </div>
      </div>
    </div>
    <div class="doc-meta">
      <div class="doc-title">${esc(title)}</div>
      ${subtitleHtml || ''}
    </div>
  </header>`;
}

function patientBlockHtml(patient) {
  const sex = patient.sex === 'M' ? 'Mâle' : patient.sex === 'F' ? 'Femelle' : '—';
  return `
  <section class="card card-blue">
    <div class="card-label">Patient</div>
    <div class="card-name">${esc(patient.name || '—')}</div>
    <div class="card-info">
      <div>${esc(patient.species || '—')}${patient.breed ? ` · ${esc(patient.breed)}` : ''} · ${sex}${patient.birthDate ? ` · ${ageString(patient.birthDate)} (né(e) le ${fmtDate(patient.birthDate)})` : ''}</div>
      <div>${patient.weight ? `Poids : ${esc(patient.weight)} kg · ` : ''}${patient.color ? `Couleur : ${esc(patient.color)} · ` : ''}Stérilisé(e) : ${patient.sterilized ? 'Oui' : 'Non'}</div>
      ${patient.microchipId ? `<div>N° puce : ${esc(patient.microchipId)}</div>` : ''}
      ${patient.allergies ? `<div>Allergies : <strong>${esc(patient.allergies)}</strong></div>` : ''}
    </div>
  </section>`;
}

function ownerBlockHtml(owner) {
  if (!owner) return '';
  const addr = [owner.address, owner.postalCode, owner.city].filter(Boolean).join(', ');
  const contact = [owner.email ? `✉ ${esc(owner.email)}` : '', owner.phone ? `📞 ${esc(owner.phone)}` : ''].filter(Boolean).join(' · ');
  return `
  <section class="card card-green">
    <div class="card-label">Propriétaire</div>
    <div class="card-name">${esc(`${owner.firstName || ''} ${owner.lastName || ''}`.trim())}</div>
    <div class="card-info">
      ${addr ? `<div>${esc(addr)}</div>` : ''}
      ${contact ? `<div>${contact}</div>` : ''}
    </div>
  </section>`;
}

function recordCardHtml(r) {
  const meta = [
    r.veterinarian ? `<div><strong>Vétérinaire :</strong> ${esc(r.veterinarian)}</div>` : '',
    r.weight ? `<div><strong>Poids :</strong> ${esc(r.weight)} kg</div>` : '',
    r.temperature ? `<div><strong>Température :</strong> ${esc(r.temperature)}°C</div>` : '',
  ].filter(Boolean).join('');
  return `
  <section class="section section-act">
    <h3 class="section-title">
      <span class="section-date">${fmtDate(r.date)}</span>
      ${esc(r.title || r.type || 'Consultation')}
      ${r.type ? `<span class="section-tag">${esc(r.type)}</span>` : ''}
    </h3>
    <div class="rec-body">
      ${meta ? `<div class="rec-meta">${meta}</div>` : ''}
      ${r.description ? `<div class="rec-block"><div class="rec-block-label">Description / examen clinique</div><div class="rec-block-content">${esc(r.description)}</div></div>` : ''}
      ${r.treatment ? `<div class="rec-block"><div class="rec-block-label">Traitement / prescription</div><div class="rec-block-content">${esc(r.treatment)}</div></div>` : ''}
    </div>
  </section>`;
}

function sectionTitleHtml(text, variant = 'blue') {
  return `<h3 class="section-head section-head-${variant}">${esc(text)}</h3>`;
}

function followUpsHtml(followUps) {
  if (!followUps || !followUps.length) return '';
  const rows = followUps.map((f) => `
    <tr>
      <td>${fmtDate(f.dueDate || f.date)}</td>
      <td>${esc(f.title || f.type || f.reason || '—')}</td>
      <td>${esc(f.note || f.status || '')}</td>
    </tr>`).join('');
  return `${sectionTitleHtml(`Rappels programmés (${followUps.length})`, 'green')}
  <table class="data-table"><thead><tr><th>Échéance</th><th>Objet</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function dispensingsHtml(dispensings) {
  if (!dispensings || !dispensings.length) return '';
  const rows = dispensings.map((d) => `
    <tr>
      <td>${fmtDate(d.date)}</td>
      <td>${esc(d.medicineName || '—')}${d.saleUnitName ? ` · ${esc(d.saleUnitName)}` : ''}</td>
      <td>${esc(d.quantity != null ? d.quantity : '')}${d.baseUnit ? ` ${esc(d.baseUnit)}` : ''}</td>
      <td>${d.lotNumber ? `Lot ${esc(d.lotNumber)}` : ''}${d.expiryDate ? ` (exp. ${fmtDate(d.expiryDate)})` : ''}</td>
    </tr>`).join('');
  return `${sectionTitleHtml(`Historique médicamenteux (${dispensings.length})`, 'blue')}
  <table class="data-table"><thead><tr><th>Date</th><th>Médicament</th><th>Quantité</th><th>Lot</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function labResultsHtml(labResults) {
  if (!labResults || !labResults.length) return '';
  // Group by diagnostic set / run date, like the on-screen view.
  const groups = [];
  const byKey = new Map();
  for (const r of labResults) {
    const key = r.diagnosticSetId || r.id;
    if (!byKey.has(key)) { const g = { key, runDate: r.runDate, instruments: [], results: [] }; byKey.set(key, g); groups.push(g); }
    const g = byKey.get(key);
    if (r.instrument) g.instruments.push(r.instrument);
    g.results.push(r);
  }
  const flagClass = (f) => (f === 'H' || f === 'High') ? 'lab-high' : (f === 'L' || f === 'Low') ? 'lab-low' : '';
  const refRange = (a) => {
    if (a.refLow != null && a.refHigh != null) return `${a.refLow} – ${a.refHigh}${a.unit ? ` ${esc(a.unit)}` : ''}`;
    if (a.refText) return esc(a.refText);
    return '';
  };
  const blocks = groups.map((g) => {
    const instruments = Array.from(new Set(g.instruments)).join(', ');
    const tables = g.results.map((res) => {
      const rows = (res.assays || []).map((a) => `
        <tr>
          <td>${esc(a.assayName)}</td>
          <td class="${flagClass(a.flag)}">${esc(a.value)}${a.unit ? ` ${esc(a.unit)}` : ''}</td>
          <td class="lab-ref">${refRange(a)}</td>
        </tr>`).join('');
      return `
        ${g.results.length > 1 ? `<div class="lab-instrument">${esc(res.instrument || '')}</div>` : ''}
        <table class="data-table lab-table"><thead><tr><th>Paramètre</th><th>Résultat</th><th>Réf.</th></tr></thead><tbody>${rows}</tbody></table>
        ${res.notes ? `<div class="lab-notes">📝 ${esc(res.notes)}</div>` : ''}`;
    }).join('');
    return `<div class="lab-group"><div class="lab-group-head"><strong>${fmtDate(g.runDate)}</strong>${instruments ? ` — ${esc(instruments)}` : ''}</div>${tables}</div>`;
  }).join('');
  return `${sectionTitleHtml(`Analyses de laboratoire (${labResults.length})`, 'green')}${blocks}`;
}

// Main entry: build the full HTML document for a dossier OR a single-record
// compte-rendu (when recordsSectionTitle is set and one record is passed).
function patientHtml({ patient, owner, records = [], followUps = [], dispensings = [], labResults = [], title = 'Dossier médical', recordsSectionTitle, settings = {} }) {
  const singleRecord = !!recordsSectionTitle && records.length === 1;
  const subtitleHtml = singleRecord
    ? `<div class="doc-sub">Du <strong>${fmtDate(records[0].date)}</strong></div><div class="doc-sub doc-sub-tag">${esc(records[0].type || '')}</div>`
    : `<div class="doc-sub">Édité le <strong>${fmtDate(new Date().toISOString())}</strong></div>`;

  let recordsHtml = '';
  if (singleRecord) {
    recordsHtml = recordCardHtml(records[0]);
  } else {
    recordsHtml = sectionTitleHtml(recordsSectionTitle || `Actes médicaux (${records.length})`, 'blue');
    recordsHtml += records.length
      ? records.map(recordCardHtml).join('')
      : `<div class="empty">Aucun acte enregistré.</div>`;
  }

  const body = `
    ${patientBlockHtml(patient)}
    ${ownerBlockHtml(owner)}
    ${recordsHtml}
    ${followUpsHtml(followUps)}
    ${dispensingsHtml(dispensings)}
    ${labResultsHtml(labResults)}`;

  return `<!doctype html><html lang="fr"><head>${docHead()}</head>
<body>
  <div class="doc">
    ${headerHtml(settings, { title, subtitleHtml })}
    <div class="doc-body">${body}</div>
    <footer class="doc-footer">
      <div class="doc-footer-thanks">Document confidentiel — ${esc(patient.name || '')}</div>
      ${settings.clinicLegalMentions ? `<div>${esc(settings.clinicLegalMentions)}</div>` : ''}
    </footer>
  </div>
</body></html>`;
}

const BASE_CSS = `
  @page { margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  body { font-family: 'DM Sans', -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc { position: relative; }
  .doc::before { content:''; position:absolute; top:0; left:0; right:0; height:8px;
    background: linear-gradient(90deg, #2563EB 0%, #2563EB 60%, #0f5c45 60%, #0f5c45 100%); }

  /* ===== Header ===== */
  .doc-header { display:flex; justify-content:space-between; align-items:flex-start; gap:28px;
    padding:34px 48px 26px; background: linear-gradient(135deg, #EFF6FF 0%, #f8f7f2 100%);
    border-bottom: 2px solid #2563EB; }
  .doc-cabinet { display:flex; gap:18px; align-items:flex-start; min-width:0; }
  .doc-logo { height:80px; width:auto; max-width:150px; object-fit:contain; padding:6px;
    background:#fff; border-radius:12px; box-shadow:0 2px 10px rgba(37,99,235,0.10); }
  .doc-cabinet-name { font-family:'DM Serif Display', Georgia, serif; font-size:25px; color:#2563EB;
    line-height:1.05; margin-bottom:8px; letter-spacing:-0.4px; }
  .doc-cabinet-info { font-size:11.5px; color:#475569; line-height:1.5; }
  .doc-cabinet-tva { margin-top:5px; font-weight:500; color:#0f172a; }
  .doc-meta { text-align:right; min-width:200px; white-space:nowrap; }
  .doc-title { font-family:'DM Serif Display', Georgia, serif; font-style:italic; font-size:42px;
    color:#0f5c45; line-height:0.95; letter-spacing:-1px; }
  .doc-title::after { content:''; display:block; width:50px; height:3px; background:#0f5c45;
    margin:8px 0 0 auto; border-radius:2px; }
  .doc-sub { font-size:12.5px; color:#64748b; margin-top:10px; }
  .doc-sub strong { color:#0f172a; }
  .doc-sub-tag { color:#475569; font-weight:600; margin-top:2px; }

  /* ===== Body ===== */
  .doc-body { padding:28px 48px 36px; }
  .empty { font-style:italic; color:#94a3b8; padding:6px 2px 14px; }

  .card { border:1.5px solid #2563EB; border-left-width:5px; border-radius:10px;
    padding:16px 20px; margin-bottom:16px; background:#fff; }
  .card-green { border-color:#0f5c45; }
  .card-label { font-size:10px; color:#64748b; text-transform:uppercase; letter-spacing:0.08em;
    font-weight:600; margin-bottom:5px; }
  .card-name { font-family:'DM Serif Display', Georgia, serif; font-size:17px; color:#0f172a; margin-bottom:5px; }
  .card-info { font-size:12.5px; color:#475569; line-height:1.6; }

  .section-head { font-family:'DM Serif Display', Georgia, serif; font-weight:400; font-size:15px;
    margin:22px 0 10px; padding:9px 14px; border-radius:8px; display:flex; align-items:center; gap:10px; }
  .section-head::before { content:''; width:8px; height:22px; border-radius:4px; }
  .section-head-blue { background:linear-gradient(90deg,#EFF6FF,#ffffff); color:#1d4ed8; border:1px solid #bfdbfe; }
  .section-head-blue::before { background:#2563EB; }
  .section-head-green { background:linear-gradient(90deg,#f0fdf4,#ffffff); color:#0f5c45; border:1px solid #bbf7d0; }
  .section-head-green::before { background:#0f5c45; }

  .section { margin:12px 0 18px; border:1px solid #bfdbfe; border-radius:12px; overflow:hidden; }
  .section-title { font-family:'DM Serif Display', Georgia, serif; font-size:15px; margin:0; padding:12px 16px;
    font-weight:400; display:flex; align-items:center; gap:10px; background:linear-gradient(90deg,#EFF6FF,#fff);
    color:#1d4ed8; border-bottom:1px solid #bfdbfe; }
  .section-title::before { content:''; width:8px; height:22px; border-radius:4px; background:#2563EB; }
  .section-date { font-size:11px; color:#64748b; font-family:'DM Sans',sans-serif; font-weight:600;
    background:#EFF6FF; padding:2px 8px; border-radius:6px; }
  .section-tag { margin-left:auto; font-size:10.5px; color:#1d4ed8; font-family:'DM Sans',sans-serif;
    font-weight:600; text-transform:uppercase; letter-spacing:0.04em; }

  .rec-body { padding:16px 20px 18px; background:#fff; }
  .rec-meta { display:flex; gap:22px; flex-wrap:wrap; margin-bottom:12px; padding-bottom:10px;
    border-bottom:1px solid #f1f5f9; font-size:12px; color:#475569; }
  .rec-meta strong { color:#0f172a; font-weight:500; }
  .rec-block { margin-top:12px; }
  .rec-block-label { font-size:10px; color:#2563EB; text-transform:uppercase; letter-spacing:0.08em;
    font-weight:700; margin-bottom:4px; }
  .rec-block-content { font-size:12.5px; color:#0f172a; line-height:1.55; white-space:pre-wrap; }

  .data-table { width:100%; border-collapse:collapse; margin:4px 0 14px; font-size:12px; }
  .data-table th { text-align:left; color:#64748b; font-weight:600; font-size:10px; text-transform:uppercase;
    letter-spacing:0.04em; padding:6px 10px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
  .data-table td { padding:6px 10px; border-bottom:1px solid #f1f5f9; color:#0f172a; vertical-align:top; }
  .lab-group { border:1px solid #e5e7eb; border-radius:10px; padding:12px 14px; margin-bottom:12px; }
  .lab-group-head { font-size:13px; margin-bottom:6px; color:#0f172a; }
  .lab-instrument { font-size:11px; font-weight:600; color:#6b7280; margin:6px 0 2px; }
  .lab-table td { font-size:11.5px; }
  .lab-ref { color:#64748b; font-size:10.5px; }
  .lab-high { color:#b91c1c; font-weight:700; }
  .lab-low { color:#1d4ed8; font-weight:700; }
  .lab-notes { font-size:11px; font-style:italic; color:#6b7280; margin-top:4px; }

  /* ===== Footer ===== */
  .doc-footer { padding:20px 28px; background:linear-gradient(135deg,#EFF6FF 0%,#f0fdf4 100%);
    border-top:3px solid #2563EB; font-size:11px; color:#475569; line-height:1.7; text-align:center; }
  .doc-footer-thanks { font-family:'DM Serif Display', Georgia, serif; font-style:italic; color:#0f5c45;
    font-size:14px; margin-bottom:4px; }

  /* ===== Invoice-specific ===== */
  .ar { text-align:right; }
  .inv-metaline { display:flex; justify-content:space-between; gap:18px; font-size:12.5px; color:#64748b; margin-top:6px; }
  .inv-metaline strong { color:#0f172a; font-weight:500; }
  .inv-status { display:inline-block; margin-top:10px; padding:4px 12px; border-radius:999px; font-size:10px;
    font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
  .inv-status-draft { background:#f1f5f9; color:#64748b; }
  .inv-status-sent { background:#dbeafe; color:#1d4ed8; }
  .inv-status-paid { background:#d1fae5; color:#0f5c45; }
  .inv-status-cancelled { background:#fee2e2; color:#b91c1c; }
  .inv-status-accepted, .inv-status-invoiced { background:#d1fae5; color:#0f5c45; }
  .inv-status-refused { background:#fee2e2; color:#b91c1c; }
  .inv-section { margin:14px 0 18px; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; }
  .inv-section-title { font-family:'DM Serif Display', Georgia, serif; font-size:15px; margin:0; padding:12px 16px;
    font-weight:400; display:flex; align-items:center; gap:12px; background:linear-gradient(90deg,#EFF6FF,#fff);
    color:#1d4ed8; border-bottom:1px solid #bfdbfe; }
  .inv-section-title::before { content:''; width:8px; height:22px; border-radius:4px; background:#2563EB; }
  .inv-tva-badge { margin-left:auto; font-size:10px; font-weight:600; font-family:'DM Sans',sans-serif;
    background:#dbeafe; color:#1d4ed8; padding:3px 10px; border-radius:999px; letter-spacing:0.03em; }
  .inv-tva-badge.tva-green { background:#d1fae5; color:#0f5c45; }
  .inv-table { width:100%; border-collapse:collapse; font-size:12px; }
  .inv-table th { text-align:left; color:#64748b; font-weight:600; font-size:10px; text-transform:uppercase;
    letter-spacing:0.04em; padding:8px 12px; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
  .inv-table td { padding:8px 12px; border-bottom:1px solid #f1f5f9; color:#0f172a; vertical-align:top; }
  .inv-lot { font-size:10px; color:#94a3b8; margin-top:2px; }
  .inv-lot code { background:#f1f5f9; padding:1px 4px; border-radius:4px; }
  .inv-totals { display:flex; justify-content:flex-end; margin-top:16px; }
  .inv-totals-table { width:58%; border-collapse:collapse; font-size:12.5px; }
  .inv-totals-table td { padding:6px 12px; }
  .inv-totals-table td.ar { text-align:right; }
  .inv-vat-detail td { font-size:10.5px; color:#94a3b8; font-style:italic; padding-top:0; padding-bottom:2px; }
  .inv-total-row td { font-family:'DM Serif Display', Georgia, serif; font-style:italic; font-size:18px;
    color:#0f5c45; border-top:2px solid #0f5c45; padding-top:10px; }
  .inv-notes { margin-top:18px; padding:14px 18px; background:#fffbeb; border:1px solid #fde68a; border-radius:10px;
    font-size:12px; color:#0f172a; line-height:1.5; }
  .inv-notes-label { font-size:10px; color:#92400e; text-transform:uppercase; letter-spacing:0.06em;
    font-weight:700; margin-bottom:4px; }

  /* Let content flow continuously across A4 page breaks — no break-inside:avoid, so
     no white gaps appear before a card that would not fit at the bottom of a page.
     Only keep individual table rows from being split across two pages. */
  tr { break-inside: avoid; }
`;

// ===== Invoice =====
function invoiceRowsHtml(items, showAnimal) {
  return items.map((it) => {
    const qty = Number(it.quantity);
    const ht = qty * Number(it.priceHT);
    const ttc = ht * (1 + Number(it.vatRate) / 100);
    const puTtc = Number(it.priceHT) * (1 + Number(it.vatRate) / 100);
    return `<tr>
      <td>${esc(it.description || '')}${showAnimal && it.patientName ? `<div class="inv-lot">Animal : ${esc(it.patientName)}</div>` : ''}${Number(it.discountPct) > 0 ? `<div class="inv-lot">Remise ${Number(it.discountPct).toLocaleString('fr-LU')} % (prix normal ${fmtMoney(it.listPriceHT)} HTVA)</div>` : ''}${it.lotId ? `<div class="inv-lot">Lot : <code>${esc(String(it.lotId).slice(0, 8))}…</code></div>` : ''}</td>
      <td class="ar">${qty.toLocaleString('fr-LU')}</td>
      <td class="ar">${fmtMoney(it.priceHT)}</td>
      <td class="ar">${fmtMoney(puTtc)}</td>
      <td class="ar">${fmtMoney(ht)}</td>
      <td class="ar"><strong>${fmtMoney(ttc)}</strong></td>
    </tr>`;
  }).join('');
}

function invoiceTableHtml(title, badge, badgeClass, items, showAnimal) {
  if (!items.length) return '';
  return `<section class="inv-section">
    <h3 class="inv-section-title">${esc(title)} <span class="inv-tva-badge ${badgeClass}">${esc(badge)}</span></h3>
    <table class="inv-table"><thead><tr>
      <th style="width:40%">Description</th><th class="ar">Qté</th><th class="ar">P.U. HTVA</th>
      <th class="ar">P.U. TVAC</th><th class="ar">Total HTVA</th><th class="ar">Total TVAC</th>
    </tr></thead><tbody>${invoiceRowsHtml(items, showAnimal)}</tbody></table>
  </section>`;
}

// `quote: true` rend le même document en devis (titre, validité, pas de
// coordonnées de paiement).
function invoiceHtml(invoice, settings = {}, { quote = false } = {}) {
  const items = invoice.items || [];
  const acts = items.filter((it) => (it.kind || 'act') === 'act');
  const products = items.filter((it) => it.kind === 'product');
  const showAnimal = (invoice.patients?.length || 0) > 1;
  const vat = {};
  for (const it of items) {
    const rate = Number(it.vatRate);
    const ht = Number(it.quantity) * Number(it.priceHT);
    if (!vat[rate]) vat[rate] = { ht: 0, vat: 0 };
    vat[rate].ht += ht; vat[rate].vat += ht * (rate / 100);
  }
  const PAYMENT_LABELS = { cash: 'Espèces', card: 'Carte bancaire', transfer: 'Virement', payconiq: 'Payconiq', cheque: 'Chèque' };
  const statusLabels = quote
    ? { draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé' }
    : { draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', cancelled: 'Annulée' };
  const subtitleHtml = `
    <div class="inv-metaline"><span>N°</span><strong>${esc(invoice.number || '')}</strong></div>
    <div class="inv-metaline"><span>Date</span><strong>${fmtDate(invoice.date)}</strong></div>
    ${invoice.dueDate ? `<div class="inv-metaline"><span>Échéance</span><strong>${fmtDate(invoice.dueDate)}</strong></div>` : ''}
    ${invoice.validUntil ? `<div class="inv-metaline"><span>Valable jusqu'au</span><strong>${fmtDate(invoice.validUntil)}</strong></div>` : ''}
    <div class="inv-status inv-status-${esc(invoice.status || 'draft')}">${esc(statusLabels[invoice.status] || invoice.status || '')}${!quote && invoice.status === 'paid' && PAYMENT_LABELS[invoice.paymentMethod] ? ' — ' + esc(PAYMENT_LABELS[invoice.paymentMethod]) : ''}</div>`;

  const client = `
    <section class="card card-blue">
      <div class="card-label">Adressée à</div>
      <div class="card-name">${esc(`${invoice.ownerLastName || ''} ${invoice.ownerFirstName || ''}`.trim())}</div>
      <div class="card-info">
        ${invoice.ownerAddress ? `<div>${esc(invoice.ownerAddress)}</div>` : ''}
        ${(invoice.ownerPostalCode || invoice.ownerCity) ? `<div>${esc(`${invoice.ownerPostalCode || ''} ${invoice.ownerCity || ''}`.trim())}</div>` : ''}
        ${invoice.patientName ? `<div>Concerne : <strong>${esc(invoice.patientName)}</strong></div>` : ''}
      </div>
    </section>`;

  // Remise sur les actes : priceHT est déjà net, listPriceHT = prix avant remise.
  let discountTotal = 0, discountPct = 0;
  for (const it of acts) {
    if (!(Number(it.discountPct) > 0)) continue;
    discountTotal += Number(it.quantity) * (Number(it.listPriceHT) - Number(it.priceHT));
    discountPct = Math.max(discountPct, Number(it.discountPct));
  }
  const discountRow = discountTotal > 0.004
    ? `<tr class="inv-vat-detail"><td>Remise de ${discountPct.toLocaleString('fr-LU')} % sur les actes (HTVA)</td><td class="ar">− ${fmtMoney(discountTotal)}</td></tr>`
    : '';
  const vatRows = Object.keys(vat).sort().map((r) =>
    `<tr class="inv-vat-detail"><td>dont TVA ${Number(r).toFixed(0)}% sur ${fmtMoney(vat[r].ht)}</td><td class="ar">${fmtMoney(vat[r].vat)}</td></tr>`).join('');
  const totals = `
    <section class="inv-totals"><table class="inv-totals-table"><tbody>
      ${discountRow}
      <tr><td>Total HTVA</td><td class="ar">${fmtMoney(invoice.totalHT)}</td></tr>
      ${vatRows}
      <tr><td>TVA totale</td><td class="ar">${fmtMoney(invoice.totalVAT)}</td></tr>
      <tr class="inv-total-row"><td>${quote ? 'Total estimé (TVAC)' : 'Net à payer (TVAC)'}</td><td class="ar">${fmtMoney(invoice.totalTTC)}</td></tr>
    </tbody></table></section>`;

  const notes = invoice.notes ? `<section class="inv-notes"><div class="inv-notes-label">Notes</div><div>${esc(invoice.notes)}</div></section>` : '';

  const footer = quote ? `
    <footer class="doc-footer">
      <div class="doc-footer-thanks">Merci de votre confiance 🐾</div>
      <div>Devis estimatif${invoice.validUntil ? `, valable jusqu'au ${fmtDate(invoice.validUntil)}` : ''}. Le montant final peut varier selon les actes et produits réellement nécessaires.</div>
      ${settings.clinicLegalMentions ? `<div>${esc(settings.clinicLegalMentions)}</div>` : ''}
    </footer>` : `
    <footer class="doc-footer">
      <div class="doc-footer-thanks">Merci de votre confiance 🐾</div>
      ${settings.clinicIban ? `<div><strong>Coordonnées bancaires :</strong> IBAN ${esc(settings.clinicIban)}${settings.clinicBic ? ` · BIC ${esc(settings.clinicBic)}` : ''}</div>` : ''}
      <div>${settings.clinicPaymentTerms ? esc(settings.clinicPaymentTerms) : 'Paiement comptant à réception, sauf accord écrit.'}</div>
      ${settings.clinicLegalMentions ? `<div>${esc(settings.clinicLegalMentions)}</div>` : ''}
    </footer>`;

  return `<!doctype html><html lang="fr"><head>${docHead()}</head>
<body><div class="doc">
  ${headerHtml(settings, { title: quote ? 'Devis' : 'Facture', subtitleHtml })}
  <div class="doc-body">
    ${client}
    ${invoiceTableHtml('Actes vétérinaires', 'TVA 17%', '', acts, showAnimal)}
    ${invoiceTableHtml('Produits / Médicaments', 'TVA 3%', 'tva-green', products, showAnimal)}
    ${totals}
    ${notes}
  </div>
  ${footer}
</div></body></html>`;
}

// ===== Lab report (a single diagnostic session = array of results) =====
function labHtml({ results = [], patient = {}, owner, settings = {} }) {
  const runDate = results.length ? results[0].runDate : null;
  const subtitleHtml = `<div class="doc-sub">${runDate ? `Du <strong>${fmtDate(runDate)}</strong>` : ''}</div>`;
  return `<!doctype html><html lang="fr"><head>${docHead()}</head>
<body><div class="doc">
  ${headerHtml(settings, { title: 'Analyses', subtitleHtml })}
  <div class="doc-body">
    ${patientBlockHtml(patient)}
    ${ownerBlockHtml(owner)}
    ${labResultsHtml(results)}
  </div>
  <footer class="doc-footer">
    <div class="doc-footer-thanks">Document confidentiel — ${esc(patient.name || '')}</div>
    ${settings.clinicLegalMentions ? `<div>${esc(settings.clinicLegalMentions)}</div>` : ''}
  </footer>
</div></body></html>`;
}

module.exports = { patientHtml, invoiceHtml, labHtml, esc, fmtDate, ageString, fmtMoney, logoDataUri };
