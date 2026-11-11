const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ageString(birthDate) {
  if (!birthDate) return '—';
  const years = (Date.now() - new Date(birthDate)) / (1000 * 60 * 60 * 24 * 365.25);
  return years >= 1 ? `${Math.floor(years)} an(s)` : `${Math.floor(years * 12)} mois`;
}

const C = {
  blue: '#2563EB',
  blueDark: '#1d4ed8',
  blueLight: '#EFF6FF',
  blueBorder: '#bfdbfe',
  green: '#0f5c45',
  greenLight: '#f0fdf4',
  greenBorder: '#bbf7d0',
  cream: '#f8f7f2',
  text: '#0f172a',
  textMid: '#475569',
  textMute: '#94a3b8',
  textLabel: '#64748b',
  border: '#e2e8f0',
  borderLight: '#f1f5f9',
};

function logoPath() {
  const candidates = [
    path.join(__dirname, 'logo-invoice.png'),
    path.join(__dirname, '..', 'public', 'logo-invoice.png'),
    path.join(__dirname, '..', 'dist', 'logo-invoice.png'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch { /* ignore */ }
  }
  return null;
}

// Draw a vector paw print centered at (cx, cy). PDFKit can't render the 🐾 emoji
// (the standard fonts have no glyph), so the on-screen watermark is reproduced as
// a simple vector: one pad + four toe beans. Caller sets fill colour/opacity.
function drawPaw(doc, cx, cy, s) {
  doc.ellipse(cx, cy, 13 * s, 10 * s).fill();
  const toes = [[-12, -14, 5, 7], [-4.5, -20, 5, 7.5], [4.5, -20, 5, 7.5], [12, -14, 5, 7]];
  for (const [dx, dy, rx, ry] of toes) {
    doc.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s).fill();
  }
}

function renderPatientPdf({ patient, owner, records, followUps, dispensings, labResults, title = 'Dossier médical', recordsSectionTitle }, settings) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const ml = doc.page.margins.left;
      const mr = doc.page.margins.right;
      const contentW = pageW - ml - mr;
      const rightX = pageW - mr;

      // ===== Top accent bar (blue 60% / green 40%, mirrors the on-screen doc) =====
      doc.rect(0, 0, pageW * 0.6, 8).fill(C.blue);
      doc.rect(pageW * 0.6, 0, pageW * 0.4, 8).fill(C.green);

      // ===== Header band — subtle blue→cream gradient like the invoice/record view =====
      const headerH = 150;
      const headerGrad = doc.linearGradient(0, 8, pageW, 8 + headerH);
      headerGrad.stop(0, C.blueLight).stop(1, C.cream);
      doc.rect(0, 8, pageW, headerH).fill(headerGrad);

      // Faint 🐾 watermark, bottom-right of the header band
      doc.save();
      doc.fillColor(C.green).fillOpacity(0.05);
      drawPaw(doc, pageW - 78, 8 + headerH - 18, 1.8);
      doc.restore();
      doc.fillColor(C.text);

      const lp = logoPath();
      const headerTop = 26;
      let cabinetTextX = ml;
      if (lp) {
        // Logo sits in a white rounded card, as on screen
        const cardS = 80;
        doc.roundedRect(ml, headerTop, cardS, cardS, 12).fill('white');
        doc.lineWidth(1).strokeColor(C.blueBorder).roundedRect(ml, headerTop, cardS, cardS, 12).stroke();
        try {
          doc.image(lp, ml + 8, headerTop + 8, { fit: [cardS - 16, cardS - 16] });
        } catch { /* ignore */ }
        cabinetTextX = ml + cardS + 18;
      }

      // Left (cabinet) and right (title) columns are kept strictly separate so a
      // long clinic name can never collide with the title.
      const metaX = ml + contentW * 0.55;
      const metaW = rightX - metaX;
      const cabinetW = metaX - cabinetTextX - 14;

      doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(18)
        .text(settings.clinicName || 'Cabinet vétérinaire', cabinetTextX, headerTop + 2, { width: cabinetW });
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9);
      if (settings.clinicAddress) doc.text(settings.clinicAddress, cabinetTextX, doc.y + 2, { width: cabinetW });
      if (settings.clinicPostalCode || settings.clinicCity) {
        doc.text(`${settings.clinicPostalCode || ''} ${settings.clinicCity || ''}`.trim(), cabinetTextX, doc.y, { width: cabinetW });
      }
      if (settings.clinicPhone) doc.text(`Tél : ${settings.clinicPhone}`, cabinetTextX, doc.y);
      if (settings.clinicEmail) doc.text(settings.clinicEmail, cabinetTextX, doc.y);
      if (settings.clinicVatNumber) {
        doc.fillColor(C.text).font('Helvetica-Bold').text(`TVA : ${settings.clinicVatNumber}`, cabinetTextX, doc.y + 3);
      }

      // Title (right) — large italic green, auto-shrunk to fit its column on one line
      doc.font('Helvetica-BoldOblique');
      let titleSize = 30;
      while (titleSize > 15 && doc.fontSize(titleSize).widthOfString(title) > metaW) titleSize -= 1;
      doc.fillColor(C.green).fontSize(titleSize)
        .text(title, metaX, headerTop + 2, { width: metaW, align: 'right' });
      doc.rect(rightX - 50, headerTop + 50, 50, 3).fill(C.green);
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9)
        .text(`Édité le ${fmtDate(new Date().toISOString())}`, metaX, headerTop + 62, { width: metaW, align: 'right' });

      doc.y = 8 + headerH + 18;

      // ===== Patient identity block (white card with blue left border) =====
      const cardY = doc.y;
      const cardH = 110;
      doc.rect(ml, cardY, contentW, cardH).fillAndStroke('white', C.blueBorder);
      doc.rect(ml, cardY, 5, cardH).fill(C.blue);

      doc.fillColor(C.textLabel).font('Helvetica-Bold').fontSize(7.5)
        .text('PATIENT', ml + 16, cardY + 12, { width: contentW - 32, characterSpacing: 1 });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(16)
        .text(patient.name || '—', ml + 16, cardY + 24);

      // Grid of signalement
      const sigItems = [
        ['Espèce', patient.species || '—'],
        ['Race', patient.breed || '—'],
        ['Sexe', patient.sex === 'M' ? 'Mâle' : patient.sex === 'F' ? 'Femelle' : '—'],
        ['Né(e) le', fmtDate(patient.birthDate)],
        ['Âge', ageString(patient.birthDate)],
        ['Poids', patient.weight ? `${patient.weight} kg` : '—'],
        ['Couleur', patient.color || '—'],
        ['Stérilisé(e)', patient.sterilized ? 'Oui' : 'Non'],
      ];
      const sigGridY = cardY + 50;
      const sigCols = 4;
      const sigColW = (contentW - 32) / sigCols;
      for (let i = 0; i < sigItems.length; i++) {
        const col = i % sigCols;
        const row = Math.floor(i / sigCols);
        const x = ml + 16 + col * sigColW;
        const y = sigGridY + row * 28;
        doc.fillColor(C.textLabel).font('Helvetica').fontSize(7).text(sigItems[i][0].toUpperCase(), x, y, { width: sigColW - 8, characterSpacing: 0.5 });
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(String(sigItems[i][1]), x, y + 9, { width: sigColW - 8 });
      }
      doc.y = cardY + cardH + 12;

      // Microchip + allergies if present
      if (patient.microchipId || patient.allergies) {
        const xy = doc.y;
        doc.fillColor(C.textMid).font('Helvetica').fontSize(9);
        if (patient.microchipId) {
          doc.font('Helvetica-Bold').text('N° puce : ', ml, xy, { continued: true })
            .font('Helvetica').text(patient.microchipId);
        }
        if (patient.allergies) {
          doc.font('Helvetica-Bold').text('Allergies : ', ml, doc.y, { continued: true })
            .font('Helvetica').text(patient.allergies);
        }
        doc.y += 6;
      }

      // ===== Owner block =====
      if (owner) {
        const oy = doc.y;
        const oh = 60;
        doc.rect(ml, oy, contentW, oh).fillAndStroke('white', C.greenBorder);
        doc.rect(ml, oy, 5, oh).fill(C.green);
        doc.fillColor(C.textLabel).font('Helvetica-Bold').fontSize(7.5)
          .text('PROPRIÉTAIRE', ml + 16, oy + 10, { characterSpacing: 1 });
        doc.fillColor(C.text).font('Helvetica-Bold').fontSize(12)
          .text(`${owner.firstName || ''} ${owner.lastName || ''}`.trim(), ml + 16, oy + 22);
        doc.fillColor(C.textMid).font('Helvetica').fontSize(9);
        const oparts = [];
        if (owner.email) oparts.push(owner.email);
        if (owner.phone) oparts.push(owner.phone);
        let line2 = oparts.join('  ·  ');
        const addr = [owner.address, owner.postalCode, owner.city].filter(Boolean).join(', ');
        if (addr) line2 = line2 ? `${line2}  ·  ${addr}` : addr;
        if (line2) doc.text(line2, ml + 16, oy + 38, { width: contentW - 32 });
        doc.y = oy + oh + 18;
      }

      // ===== Medical records section =====
      drawSectionTitle(doc, recordsSectionTitle || `Actes médicaux (${records.length})`, C.blue, C.blueLight, C.blueBorder, ml, contentW);
      if (records.length === 0) {
        doc.fillColor(C.textMute).font('Helvetica-Oblique').fontSize(10)
          .text('Aucun acte enregistré.', ml + 4, doc.y + 4);
        doc.moveDown(0.5);
      } else {
        for (const r of records) {
          if (doc.y > pageH - 160) doc.addPage();
          drawRecordCard(doc, r, ml, contentW);
        }
      }
      doc.moveDown(0.5);

      // ===== Follow-ups =====
      if (followUps && followUps.length > 0) {
        if (doc.y > pageH - 180) doc.addPage();
        drawSectionTitle(doc, `Rappels programmés (${followUps.length})`, C.green, C.greenLight, C.greenBorder, ml, contentW);
        for (const f of followUps) {
          if (doc.y > pageH - 100) doc.addPage();
          drawFollowUpRow(doc, f, ml, contentW);
        }
        doc.moveDown(0.5);
      }

      // ===== Dispensings =====
      if (dispensings && dispensings.length > 0) {
        if (doc.y > pageH - 180) doc.addPage();
        drawSectionTitle(doc, `Historique médicamenteux (${dispensings.length})`, C.blue, C.blueLight, C.blueBorder, ml, contentW);
        drawDispensingsTable(doc, dispensings, ml, contentW);
      }

      // ===== Lab analyses =====
      if (labResults && labResults.length > 0) {
        if (doc.y > pageH - 180) doc.addPage();
        drawSectionTitle(doc, `Analyses de laboratoire (${labResults.length})`, C.green, C.greenLight, C.greenBorder, ml, contentW);
        drawLabResults(doc, labResults, ml, contentW);
      }

      // ===== Footer on every page =====
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(pageRange.start + i);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const fy = pageH - 50;
        const footGrad = doc.linearGradient(0, fy, pageW, fy + 50);
        footGrad.stop(0, C.blueLight).stop(1, C.greenLight);
        doc.rect(0, fy, pageW, 50).fill(footGrad);
        doc.rect(0, fy, pageW, 3).fill(C.blue);

        doc.fillColor(C.green).font('Helvetica-BoldOblique').fontSize(10)
          .text(patient.name || 'Dossier patient', 0, fy + 12, {
            width: pageW, align: 'center', lineBreak: false,
          });
        doc.fillColor(C.textMid).font('Helvetica').fontSize(8)
          .text(`${settings.clinicName || ''} · Document confidentiel`, 0, fy + 28, {
            width: pageW, align: 'center', lineBreak: false,
          });
        doc.fillColor(C.textMute).font('Helvetica').fontSize(7)
          .text(`Page ${i + 1} / ${pageRange.count}`, ml, pageH - 12, {
            width: contentW, align: 'right', lineBreak: false,
          });

        doc.page.margins.bottom = savedBottom;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function drawSectionTitle(doc, title, accent, tint, border, x, w) {
  const startY = doc.y;
  const h = 30;
  doc.rect(x, startY, w, h).fillAndStroke(tint, border);
  doc.rect(x + 12, startY + 4, 6, h - 8).fill(accent);
  doc.fillColor(accent).font('Helvetica-BoldOblique').fontSize(12)
    .text(title, x + 26, startY + 9, { width: w - 40 });
  doc.y = startY + h + 8;
  doc.fillColor(C.text);
}

function drawRecordCard(doc, r, x, w) {
  const startY = doc.y;
  const innerX = x + 14;
  const innerW = w - 28;

  // Header line: date · type
  doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(10)
    .text(fmtDate(r.date), innerX, startY);
  doc.fillColor(C.textMid).font('Helvetica').fontSize(9)
    .text('  ·  ' + (r.type || ''), innerX + 60, startY + 1);

  // Title
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11)
    .text(r.title || '—', innerX, doc.y + 2, { width: innerW });

  // Meta
  const meta = [];
  if (r.veterinarian) meta.push(`Vét. ${r.veterinarian}`);
  if (r.weight) meta.push(`Poids ${r.weight} kg`);
  if (r.temperature) meta.push(`T° ${r.temperature}°C`);
  if (meta.length) {
    doc.fillColor(C.textMute).font('Helvetica').fontSize(8.5)
      .text(meta.join('  ·  '), innerX, doc.y + 2, { width: innerW });
  }

  if (r.description) {
    doc.fillColor(C.textLabel).font('Helvetica-Bold').fontSize(7)
      .text('DESCRIPTION', innerX, doc.y + 6, { characterSpacing: 0.5 });
    doc.fillColor(C.text).font('Helvetica').fontSize(9.5)
      .text(r.description, innerX, doc.y + 1, { width: innerW });
  }
  if (r.treatment) {
    doc.fillColor(C.textLabel).font('Helvetica-Bold').fontSize(7)
      .text('TRAITEMENT', innerX, doc.y + 6, { characterSpacing: 0.5 });
    doc.fillColor(C.text).font('Helvetica').fontSize(9.5)
      .text(r.treatment, innerX, doc.y + 1, { width: innerW });
  }

  const endY = doc.y + 8;
  // Left accent bar covering the whole record
  doc.rect(x, startY - 3, 3, endY - startY).fill(C.blue);
  // Bottom separator
  doc.strokeColor(C.borderLight).lineWidth(0.5)
    .moveTo(x, endY).lineTo(x + w, endY).stroke();
  doc.y = endY + 4;
}

function drawFollowUpRow(doc, f, x, w) {
  const startY = doc.y;
  const innerX = x + 14;
  doc.fillColor(C.green).font('Helvetica-Bold').fontSize(10)
    .text(fmtDate(f.scheduledDate), innerX, startY, { width: 90 });
  doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10)
    .text(f.title || '—', innerX + 100, startY, { width: w - 130 });
  if (f.notes) {
    doc.fillColor(C.textMid).font('Helvetica').fontSize(9)
      .text(f.notes, innerX + 100, doc.y, { width: w - 130 });
  }
  doc.rect(x, startY - 2, 3, doc.y - startY + 4).fill(C.green);
  doc.moveDown(0.4);
}

function drawLabResults(doc, list, x, w) {
  const colW = [w * 0.40, w * 0.32, w * 0.28];
  for (const res of list) {
    if (doc.y > doc.page.height - 120) doc.addPage();
    // Session sub-header: date · instrument
    doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(10)
      .text(`${fmtDate(res.runDate)}  ·  ${res.instrument || ''}`, x + 4, doc.y);
    let y = doc.y + 4;

    // Column header
    doc.rect(x, y, w, 18).fillAndStroke('#f8fafc', C.border);
    doc.fillColor(C.textMid).font('Helvetica-Bold').fontSize(7.5);
    const heads = ['Paramètre', 'Résultat', 'Réf.'];
    let cx = x;
    for (let i = 0; i < heads.length; i++) {
      doc.text(heads[i], cx + 6, y + 6, { width: colW[i] - 12, align: i === 0 ? 'left' : 'right' });
      cx += colW[i];
    }
    y += 18;

    for (const a of (res.assays || [])) {
      if (y > doc.page.height - 80) { doc.addPage(); y = doc.page.margins.top; }
      const isHigh = a.flag === 'high' || a.flag === 'critical';
      const isLow = a.flag === 'low';
      const valColor = (isHigh) ? '#dc2626' : (isLow ? '#2563eb' : C.text);
      const arrow = isHigh ? '▲ ' : (isLow ? '▼ ' : '');
      const valStr = `${arrow}${a.value || ''}${a.unit ? ' ' + a.unit : ''}`;
      const ref = (a.refLow != null || a.refHigh != null)
        ? `${a.refLow != null ? a.refLow : ''} – ${a.refHigh != null ? a.refHigh : ''}` : '';
      const out = isHigh || isLow;
      cx = x;
      doc.fillColor(C.text).font('Helvetica').fontSize(9).text(a.assayName || '', cx + 6, y + 5, { width: colW[0] - 12 });
      cx += colW[0];
      doc.fillColor(valColor).font(out ? 'Helvetica-Bold' : 'Helvetica').fontSize(9)
        .text(valStr, cx + 6, y + 5, { width: colW[1] - 12, align: 'right' });
      cx += colW[1];
      doc.fillColor(C.textMute).font('Helvetica').fontSize(8)
        .text(ref, cx + 6, y + 6, { width: colW[2] - 12, align: 'right' });
      doc.strokeColor(C.borderLight).lineWidth(0.3).moveTo(x, y + 16).lineTo(x + w, y + 16).stroke();
      y += 16;
    }

    if (res.notes) {
      if (y > doc.page.height - 90) { doc.addPage(); y = doc.page.margins.top; }
      doc.fillColor(C.textMid).font('Helvetica-Oblique').fontSize(8)
        .text(res.notes, x + 6, y + 4, { width: w - 12 });
      y = doc.y;
    }
    doc.y = y + 10;
  }
}

function drawDispensingsTable(doc, list, x, w) {
  const colW = [w * 0.13, w * 0.32, w * 0.22, w * 0.18, w * 0.15];
  const headers = ['Date', 'Médicament', 'Quantité', 'Lot', 'Péremption'];
  let y = doc.y;
  doc.rect(x, y, w, 20).fillAndStroke('#f8fafc', C.border);
  doc.fillColor(C.textMid).font('Helvetica-Bold').fontSize(7.5);
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx + 6, y + 6, { width: colW[i] - 12, characterSpacing: 0.5 });
    cx += colW[i];
  }
  y += 20;

  doc.font('Helvetica').fontSize(9).fillColor(C.text);
  for (const d of list) {
    if (y > doc.page.height - 80) { doc.addPage(); y = doc.page.margins.top; }
    const cells = [
      fmtDate(d.date),
      d.medicineName || '—',
      `${d.quantitySold} × ${d.saleUnitName || ''}`,
      d.lotNumber || '—',
      fmtDate(d.expiryDate),
    ];
    cx = x;
    const rowH = 18;
    for (let i = 0; i < cells.length; i++) {
      doc.text(String(cells[i]), cx + 6, y + 5, { width: colW[i] - 12 });
      cx += colW[i];
    }
    doc.strokeColor(C.borderLight).lineWidth(0.3)
      .moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke();
    y += rowH;
  }
  doc.y = y + 6;
}

// Standalone lab report PDF, generated from the stored assay data. Used when no
// lab report PDF is linked (e.g. the result XML was imported before the PDF
// landed in the lab folder). `results` = all instrument results of one session.
function renderLabPdf(results, patient, owner, settings) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
      const chunks = [];
      doc.on('data', (c) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const ml = doc.page.margins.left;
      const mr = doc.page.margins.right;
      const contentW = pageW - ml - mr;

      doc.rect(0, 0, pageW * 0.6, 8).fill(C.blue);
      doc.rect(pageW * 0.6, 0, pageW * 0.4, 8).fill(C.green);

      const headerH = 120;
      doc.rect(0, 8, pageW, headerH).fill(C.blueLight);
      const lp = logoPath();
      const headerTop = 22;
      let cx = ml;
      if (lp) { try { doc.image(lp, ml, headerTop, { fit: [70, 70] }); cx = ml + 85; } catch { /* ignore */ } }
      doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(16)
        .text(settings.clinicName || 'Cabinet vétérinaire', cx, headerTop, { width: contentW * 0.55 });
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9);
      if (settings.clinicAddress) doc.text(settings.clinicAddress, cx, doc.y, { width: contentW * 0.55 });
      if (settings.clinicPhone) doc.text(`Tél : ${settings.clinicPhone}`, cx, doc.y);

      const metaX = ml + contentW * 0.55;
      const metaW = contentW * 0.45;
      doc.fillColor(C.green).font('Helvetica-BoldOblique').fontSize(24)
        .text('Analyses', metaX, headerTop, { width: metaW, align: 'right' });
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9)
        .text(`Édité le ${fmtDate(new Date().toISOString())}`, metaX, headerTop + 40, { width: metaW, align: 'right' });

      doc.y = 8 + headerH + 16;

      // Patient / owner
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13).text(patient?.name || '—', ml, doc.y);
      doc.fillColor(C.textMid).font('Helvetica').fontSize(10);
      const pl = [patient?.species, patient?.breed].filter(Boolean).join(' · ');
      if (pl) doc.text(pl, ml, doc.y);
      if (owner) doc.text(`Propriétaire : ${(owner.firstName || '')} ${(owner.lastName || '')}`.trim(), ml, doc.y);
      doc.moveDown(0.8);

      drawLabResults(doc, results || [], ml, contentW);

      const pr = doc.bufferedPageRange();
      for (let i = 0; i < pr.count; i++) {
        doc.switchToPage(pr.start + i);
        const sb = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        const fy = pageH - 44;
        doc.rect(0, fy, pageW, 44).fill(C.blueLight);
        doc.rect(0, fy, pageW, 3).fill(C.blue);
        doc.fillColor(C.textMid).font('Helvetica').fontSize(8)
          .text(`${settings.clinicName || ''} · Document confidentiel`, 0, fy + 14, { width: pageW, align: 'center', lineBreak: false });
        doc.fillColor(C.textMute).font('Helvetica').fontSize(7)
          .text(`Page ${i + 1} / ${pr.count}`, ml, pageH - 12, { width: contentW, align: 'right', lineBreak: false });
        doc.page.margins.bottom = sb;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { renderPatientPdf, renderLabPdf };
