const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('fr-LU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' €';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Colors mirroring the on-screen invoice CSS
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
  yellowBg: '#fffbeb',
  yellowBorder: '#f59e0b',
  yellowLabel: '#92400e',
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

function drawSection(doc, { title, tva, accent, tint, border, tvaBg, tvaColor, rows, x, w }) {
  const titleH = 32;
  const startY = doc.y;
  doc.rect(x, startY, w, titleH).fillAndStroke(tint, border);
  doc.rect(x + 12, startY + 4, 6, titleH - 8).fill(accent);
  doc.fillColor(accent).font('Helvetica-BoldOblique').fontSize(13)
    .text(title, x + 26, startY + 10, { width: w * 0.55 });

  const pillW = 64, pillH = 16;
  const pillX = x + w - pillW - 12;
  const pillY = startY + (titleH - pillH) / 2;
  doc.roundedRect(pillX, pillY, pillW, pillH, 8).fill(tvaBg);
  doc.fillColor(tvaColor).font('Helvetica-Bold').fontSize(8)
    .text(tva, pillX, pillY + 4, { width: pillW, align: 'center', characterSpacing: 0.5 });

  let y = startY + titleH;
  const colW = [w * 0.36, w * 0.08, w * 0.13, w * 0.13, w * 0.14, w * 0.16];
  const headers = ['Description', 'Qté', 'P.U. HTVA', 'P.U. TVAC', 'Total HTVA', 'Total TVAC'];
  const headerH = 22;
  doc.rect(x, y, w, headerH).fillAndStroke('#f8fafc', border);
  doc.fillColor(C.textMid).font('Helvetica-Bold').fontSize(7.5);
  let cx = x;
  for (let i = 0; i < headers.length; i++) {
    const align = i === 0 ? 'left' : 'right';
    doc.text(headers[i], cx + 6, y + 7, { width: colW[i] - 12, align, characterSpacing: 0.5 });
    cx += colW[i];
  }
  y += headerH;

  for (const it of rows) {
    const qty = Number(it.quantity);
    const ht = qty * Number(it.priceHT);
    const ttc = ht * (1 + Number(it.vatRate) / 100);
    const puTtc = Number(it.priceHT) * (1 + Number(it.vatRate) / 100);
    const cells = [
      it.description || '',
      qty.toLocaleString('fr-LU'),
      fmtMoney(it.priceHT),
      fmtMoney(puTtc),
      fmtMoney(ht),
      fmtMoney(ttc),
    ];
    const descH = doc.font('Helvetica').fontSize(9.5).heightOfString(cells[0], { width: colW[0] - 12 });
    const rowH = Math.max(22, descH + 12);

    if (y + rowH > doc.page.height - 110) {
      doc.addPage();
      y = doc.page.margins.top;
    }

    cx = x;
    doc.fillColor(C.text);
    for (let i = 0; i < cells.length; i++) {
      const align = i === 0 ? 'left' : 'right';
      const font = i === cells.length - 1 ? 'Helvetica-Bold' : 'Helvetica';
      doc.font(font).fontSize(9.5)
        .text(String(cells[i]), cx + 6, y + 6, { width: colW[i] - 12, align });
      cx += colW[i];
    }
    doc.strokeColor(C.borderLight).lineWidth(0.4)
      .moveTo(x, y + rowH).lineTo(x + w, y + rowH).stroke();
    y += rowH;
  }
  doc.strokeColor(border).lineWidth(0.6).rect(x, startY + titleH, w, y - startY - titleH).stroke();
  doc.y = y + 12;
}

function renderInvoicePdf(invoice, settings) {
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

      // ===== Top accent bar =====
      doc.rect(0, 0, pageW * 0.6, 8).fill(C.blue);
      doc.rect(pageW * 0.6, 0, pageW * 0.4, 8).fill(C.green);

      // ===== Header tint =====
      const headerH = 145;
      doc.rect(0, 8, pageW, headerH).fill(C.blueLight);
      doc.fillColor(C.text);

      const lp = logoPath();
      const headerTop = 22;
      let cabinetTextX = ml;
      if (lp) {
        try {
          doc.image(lp, ml, headerTop, { fit: [80, 80] });
          cabinetTextX = ml + 95;
        } catch { /* ignore */ }
      }

      doc.fillColor(C.blue).font('Helvetica-Bold').fontSize(18)
        .text(settings.clinicName || 'Cabinet vétérinaire', cabinetTextX, headerTop, { width: contentW * 0.55 });
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9);
      if (settings.clinicAddress) doc.text(settings.clinicAddress, cabinetTextX, doc.y, { width: contentW * 0.55 });
      if (settings.clinicPostalCode || settings.clinicCity) {
        doc.text(`${settings.clinicPostalCode || ''} ${settings.clinicCity || ''}`.trim(), cabinetTextX, doc.y, { width: contentW * 0.55 });
      }
      if (settings.clinicPhone) doc.text(`Tél : ${settings.clinicPhone}`, cabinetTextX, doc.y);
      if (settings.clinicEmail) doc.text(settings.clinicEmail, cabinetTextX, doc.y);
      if (settings.clinicVatNumber) {
        doc.fillColor(C.text).font('Helvetica-Bold').text(`TVA : ${settings.clinicVatNumber}`, cabinetTextX, doc.y + 3);
      }

      // "Facture" big title (right)
      const metaX = ml + contentW * 0.6;
      const metaW = contentW * 0.4;
      doc.fillColor(C.green).font('Helvetica-BoldOblique').fontSize(40)
        .text('Facture', metaX, headerTop - 4, { width: metaW, align: 'right' });
      doc.rect(rightX - 50, headerTop + 50, 50, 3).fill(C.green);

      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(11)
        .text(`N° ${invoice.number || ''}`, metaX, headerTop + 64, { width: metaW, align: 'right' });
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9)
        .text(`Date : ${fmtDate(invoice.date)}`, metaX, headerTop + 82, { width: metaW, align: 'right' });
      if (invoice.dueDate) {
        doc.text(`Échéance : ${fmtDate(invoice.dueDate)}`, metaX, headerTop + 96, { width: metaW, align: 'right' });
      }

      doc.y = 8 + headerH + 18;

      // ===== Client block =====
      const clientY = doc.y;
      const clientH = 78;
      doc.rect(ml, clientY, contentW, clientH).fillAndStroke('white', C.blueBorder);
      doc.rect(ml, clientY, 5, clientH).fill(C.blue);

      doc.fillColor(C.textLabel).font('Helvetica-Bold').fontSize(7.5)
        .text('FACTURÉ À', ml + 16, clientY + 12, { width: contentW - 32, characterSpacing: 1 });
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(13)
        .text(`${invoice.ownerFirstName || ''} ${invoice.ownerLastName || ''}`.trim(), ml + 16, clientY + 24);
      doc.fillColor(C.textMid).font('Helvetica').fontSize(9.5);
      if (invoice.ownerAddress) doc.text(invoice.ownerAddress, ml + 16, doc.y);
      if (invoice.ownerPostalCode || invoice.ownerCity) {
        doc.text(`${invoice.ownerPostalCode || ''} ${invoice.ownerCity || ''}`.trim(), ml + 16, doc.y);
      }
      if (invoice.patientName) {
        doc.fillColor(C.text).font('Helvetica').fontSize(10)
          .text('Concerne : ', ml + 16, doc.y + 4, { continued: true })
          .font('Helvetica-Bold').text(invoice.patientName);
      }
      doc.y = clientY + clientH + 18;

      // ===== Sections =====
      const items = invoice.items || [];
      const acts = items.filter((it) => (it.kind || 'act') === 'act');
      const products = items.filter((it) => it.kind === 'product');

      if (acts.length > 0) {
        drawSection(doc, {
          title: 'Actes vétérinaires', tva: 'TVA 17%',
          accent: C.blue, tint: C.blueLight, border: C.blueBorder,
          tvaBg: '#dbeafe', tvaColor: C.blueDark, rows: acts, x: ml, w: contentW,
        });
      }
      if (products.length > 0) {
        drawSection(doc, {
          title: 'Produits / Médicaments', tva: 'TVA 3%',
          accent: C.green, tint: C.greenLight, border: C.greenBorder,
          tvaBg: '#d1fae5', tvaColor: C.green, rows: products, x: ml, w: contentW,
        });
      }

      // ===== Totals =====
      if (doc.y > pageH - 220) doc.addPage();
      doc.moveDown(0.4);
      const totalsW = 280;
      const totalsX = rightX - totalsW;
      const ty = doc.y;

      const vatBreakdown = {};
      for (const it of items) {
        const ht = Number(it.quantity) * Number(it.priceHT);
        const rate = Number(it.vatRate);
        if (!vatBreakdown[rate]) vatBreakdown[rate] = { ht: 0, vat: 0 };
        vatBreakdown[rate].ht += ht;
        vatBreakdown[rate].vat += ht * (rate / 100);
      }

      const totalsCardH = 28 + Object.keys(vatBreakdown).length * 14 + 70;
      doc.rect(totalsX, ty, totalsW, totalsCardH).fill(C.cream);

      let trY = ty + 14;
      const labelX = totalsX + 18;
      const valueR = totalsX + totalsW - 18;
      const valueW = 130;

      doc.fillColor(C.text).font('Helvetica').fontSize(10);
      doc.text('Total HTVA', labelX, trY);
      doc.text(fmtMoney(invoice.totalHT), valueR - valueW, trY, { width: valueW, align: 'right' });
      trY += 16;

      doc.fillColor(C.textMute).font('Helvetica-Oblique').fontSize(8);
      for (const rate of Object.keys(vatBreakdown).sort()) {
        doc.text(`dont TVA ${Number(rate).toFixed(0)}% sur ${fmtMoney(vatBreakdown[rate].ht)}`,
          labelX + 8, trY, { width: totalsW - 36 });
        doc.text(fmtMoney(vatBreakdown[rate].vat), valueR - valueW, trY, { width: valueW, align: 'right' });
        trY += 13;
      }

      doc.fillColor(C.text).font('Helvetica').fontSize(10);
      doc.text('TVA totale', labelX, trY);
      doc.text(fmtMoney(invoice.totalVAT), valueR - valueW, trY, { width: valueW, align: 'right' });
      trY += 16;

      doc.strokeColor(C.green).lineWidth(2)
        .moveTo(labelX, trY).lineTo(valueR, trY).stroke();
      trY += 10;

      doc.fillColor(C.green).font('Helvetica-BoldOblique').fontSize(15);
      doc.text('Net à payer (TVAC)', labelX, trY, { width: totalsW - 36 - 120 });
      doc.text(fmtMoney(invoice.totalTTC), valueR - 130, trY, { width: 130, align: 'right' });

      doc.y = ty + totalsCardH + 14;

      // ===== Notes =====
      if (invoice.notes) {
        if (doc.y > pageH - 160) doc.addPage();
        const ny = doc.y;
        const noteHeight = doc.font('Helvetica').fontSize(10).heightOfString(invoice.notes, { width: contentW - 28 });
        const noteH = noteHeight + 32;
        doc.rect(ml, ny, contentW, noteH).fill(C.yellowBg);
        doc.rect(ml, ny, 4, noteH).fill(C.yellowBorder);
        doc.fillColor(C.yellowLabel).font('Helvetica-Bold').fontSize(8)
          .text('NOTES', ml + 14, ny + 10, { characterSpacing: 1 });
        doc.fillColor(C.text).font('Helvetica').fontSize(10)
          .text(invoice.notes, ml + 14, ny + 22, { width: contentW - 28 });
        doc.y = ny + noteH + 8;
      }

      // ===== Footer on every page =====
      const pageRange = doc.bufferedPageRange();
      for (let i = 0; i < pageRange.count; i++) {
        doc.switchToPage(pageRange.start + i);
        // Disable bottom margin so text below the content area doesn't auto-paginate
        const savedBottomMargin = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const fyBand = pageH - 80;
        // Footer band
        doc.rect(0, fyBand, pageW, 80).fill(C.blueLight);
        doc.rect(0, fyBand, pageW, 3).fill(C.blue);

        // "Merci de votre confiance"
        doc.fillColor(C.green).font('Helvetica-BoldOblique').fontSize(10);
        doc.text('Merci de votre confiance', 0, fyBand + 10, {
          width: pageW, align: 'center', lineBreak: false,
        });

        // IBAN line
        if (settings.clinicIban) {
          let line = `IBAN ${settings.clinicIban}`;
          if (settings.clinicBic) line += '  ·  BIC ' + settings.clinicBic;
          doc.fillColor(C.textMid).font('Helvetica').fontSize(8.5);
          doc.text(line, 0, fyBand + 28, { width: pageW, align: 'center', lineBreak: false });
        }

        // Payment terms
        const terms = settings.clinicPaymentTerms || 'Paiement comptant à réception, sauf accord écrit.';
        doc.fillColor(C.textMid).font('Helvetica').fontSize(8);
        doc.text(terms, ml, fyBand + 46, { width: contentW, align: 'center', lineBreak: false });

        // Optional legal mentions
        if (settings.clinicLegalMentions) {
          doc.fillColor(C.textMute).font('Helvetica').fontSize(7);
          doc.text(settings.clinicLegalMentions, ml, fyBand + 62, {
            width: contentW, align: 'center', lineBreak: false,
          });
        }

        // Page number (right)
        if (pageRange.count > 1) {
          doc.fillColor(C.textMute).font('Helvetica').fontSize(7);
          doc.text(`Page ${i + 1} / ${pageRange.count}`, ml, pageH - 14, {
            width: contentW, align: 'right', lineBreak: false,
          });
        }

        // Restore bottom margin
        doc.page.margins.bottom = savedBottomMargin;
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { renderInvoicePdf };
