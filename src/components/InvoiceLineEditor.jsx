import React, { useState } from 'react';
import SearchSelect from './SearchSelect.jsx';
import { num, ttcOf, fmtEur } from '../lib/money.js';

export function newActItem(patientId) {
  return { kind: 'act', description: '', quantity: 1, priceHT: 0, vatRate: 17, accountCode: '706000', patientId: patientId || '' };
}
export function newProductItem(patientId) {
  return {
    kind: 'product', description: '', quantity: 1, priceHT: 0, vatRate: 3, accountCode: '707000',
    medicineId: '', saleUnitId: '', lotId: '', patientId: patientId || '',
    _medicineDetails: null, // cached: { saleUnits, lots }
  };
}

// FIFO: les lots encodés en premier sortent en premier (ordre d'encodage,
// puis date d'achat en départage).
const byEncodingOrder = (a, b) =>
  (a.createdAt || '').localeCompare(b.createdAt || '')
  || (a.purchaseDate || '').localeCompare(b.purchaseDate || '');

// Pick the first-encoded lot that still has stock. If it doesn't cover the whole
// quantity, the server completes from the next lots (FIFO) — so we only fail
// when the total stock across all lots is insufficient.
export function pickFIFOLot(lots, saleUnit, quantity) {
  if (!lots || !saleUnit) return null;
  const needed = num(saleUnit.quantityInBaseUnit) * num(quantity);
  const inStock = lots.filter((l) => num(l.remainingQuantityBaseUnit) > 0).sort(byEncodingOrder);
  const total = inStock.reduce((s, l) => s + num(l.remainingQuantityBaseUnit), 0);
  if (total + 0.0001 < needed) return null;
  return inStock[0]?.id || null;
}

// Mirror of the server's split: starting from the chosen lot, which lots (and
// how many base units from each) will be consumed.
function planLotSplit(lots, lotId, saleUnit, quantity) {
  const first = lots.find((l) => l.id === lotId);
  if (!first || !saleUnit) return [];
  const others = lots.filter((l) => l.id !== lotId && num(l.remainingQuantityBaseUnit) > 0).sort(byEncodingOrder);
  let left = num(saleUnit.quantityInBaseUnit) * num(quantity);
  const plan = [];
  for (const l of [first, ...others]) {
    if (left <= 0.0001) break;
    const take = Math.min(left, Math.max(0, num(l.remainingQuantityBaseUnit)));
    if (take > 0) { plan.push({ lot: l, take }); left -= take; }
  }
  return plan;
}

// A protocol's per-kg lines round up to the next whole sale unit.
function computeProtocolLineQty(item, weight) {
  if (item.quantityMode === 'per_kg') {
    const w = num(weight);
    if (w <= 0) return 0;
    return Math.max(1, Math.ceil(num(item.quantity) * w));
  }
  return num(item.quantity);
}

// One unified "type anything, we detect act vs product vs protocol" line editor
// for invoices. Used both by the full invoice page (NewInvoice.jsx) and the quick
// "Facturation" block embedded in the patient's medical record (PatientDetail.jsx).
// `quoteMode` (devis) : pas de lot ni d'alerte de stock — rien n'est déstocké.
export default function InvoiceLineEditor({ items, onChange, services, medicines, protocols, patients, defaultPatientId, quoteMode = false }) {
  const showAnimalPicker = (patients?.length || 0) > 1;
  const [protocolWeightPrompt, setProtocolWeightPrompt] = useState(null); // { protocol, weight }

  const updateItem = (i, patch) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeItem = (i) => onChange(items.filter((_, idx) => idx !== i));

  const pickSaleUnit = (i, saleUnitId) => {
    const it = items[i];
    const det = it._medicineDetails;
    if (!det) return;
    const su = det.saleUnits.find((u) => u.id === saleUnitId);
    if (!su) return;
    const lotId = pickFIFOLot(det.lots, su, num(it.quantity)) || '';
    updateItem(i, { saleUnitId, lotId, priceHT: su.defaultPriceHT, description: det.name + ' — ' + su.name });
  };

  const updateProductQty = (i, qty) => {
    const it = items[i];
    const det = it._medicineDetails;
    let lotId = it.lotId;
    if (det) {
      const su = det.saleUnits.find((u) => u.id === it.saleUnitId);
      if (su) {
        // Keep a lot chosen by hand as long as it still has stock; the server
        // completes from the next lots if needed. Empty = total stock insufficient.
        const fifo = pickFIFOLot(det.lots, su, num(qty));
        const current = det.lots.find((l) => l.id === it.lotId);
        lotId = fifo && current && num(current.remainingQuantityBaseUnit) > 0 ? it.lotId : (fifo || '');
      }
    }
    updateItem(i, { quantity: qty, lotId });
  };

  // The unified search bar: searches services + medicines + protocols together
  // and tags each result so picking one adds the right kind of line automatically.
  const catalogOptions = [
    ...services.map((s) => ({
      id: 'svc:' + s.id, kind: 'act', ref: s,
      label: `🩺 ${s.code ? `[${s.code}] ` : ''}${s.name}`,
      sub: `${fmtEur(s.priceHT)} HT · TVA 17%`,
      keywords: s.code || '',
    })),
    ...medicines.map((m) => ({
      id: 'med:' + m.id, kind: 'product', ref: m,
      label: `💊 ${m.name}`,
      sub: m.atcCode ? `ATC ${m.atcCode} · Produit` : 'Produit',
      keywords: `${m.atcCode || ''} ${m.description || ''}`,
    })),
    ...(protocols || []).map((p) => ({
      id: 'proto:' + p.id, kind: 'protocol', ref: p,
      label: `🧪 ${p.name}`,
      sub: p.description || `Protocole · ${p.itemsCount} ligne${p.itemsCount > 1 ? 's' : ''}`,
      keywords: p.description || '',
    })),
  ];

  // Build the invoice lines for a protocol: catalogue prices are looked up live
  // (not the snapshot frozen at protocol-creation time), and product lines get a
  // fresh FIFO lot pick.
  const buildProtocolLines = async (protocol, weight) => {
    const lines = [];
    for (const it of protocol.items) {
      const qty = computeProtocolLineQty(it, weight);
      if (it.kind === 'act') {
        const svc = it.serviceId ? services.find((s) => s.id === it.serviceId) : null;
        lines.push({
          kind: 'act', serviceId: it.serviceId || undefined, description: it.description,
          quantity: qty, priceHT: svc ? num(svc.priceHT) : num(it.priceHT),
          vatRate: svc ? num(svc.vatRate) : num(it.vatRate), accountCode: it.accountCode || '706000',
          patientId: defaultPatientId || '',
        });
      } else {
        let det = null;
        let lotId = '';
        let su = null;
        if (it.medicineId) {
          try { det = await window.api.medicines.get(it.medicineId); } catch { /* ignore */ }
        }
        if (det && it.saleUnitId) {
          su = det.saleUnits.find((u) => u.id === it.saleUnitId) || null;
          if (su) lotId = pickFIFOLot(det.lots, su, qty) || '';
        }
        lines.push({
          kind: 'product', medicineId: it.medicineId || '', saleUnitId: it.saleUnitId || '', lotId,
          _medicineDetails: det, description: it.description, quantity: qty,
          priceHT: su ? num(su.defaultPriceHT) : num(it.priceHT),
          vatRate: det ? num(det.defaultVatRate) : num(it.vatRate), accountCode: it.accountCode || '707000',
          patientId: defaultPatientId || '',
        });
      }
    }
    return lines;
  };

  const applyProtocol = async (protocol, weight) => {
    onChange([...items, ...(await buildProtocolLines(protocol, weight))]);
  };

  const addFromCatalog = async (optId) => {
    const opt = catalogOptions.find((o) => o.id === optId);
    if (!opt) return;
    if (opt.kind === 'act') {
      const svc = opt.ref;
      onChange([...items, {
        kind: 'act', description: svc.name, quantity: 1,
        priceHT: svc.priceHT, vatRate: svc.vatRate, accountCode: svc.accountCode,
        serviceId: svc.id, patientId: defaultPatientId || '',
      }]);
    } else if (opt.kind === 'product') {
      // Build the full product line in one shot before appending — updating it
      // in a second step (via index) would race the still-pending state update
      // from a first, incomplete append.
      const medicineId = opt.ref.id;
      const details = await window.api.medicines.get(medicineId);
      const defaultUnit = details.saleUnits?.find((u) => u.isDefault === 1) || details.saleUnits?.[0];
      let lotId = '';
      let priceHT = 0;
      let description = details.name;
      if (defaultUnit) {
        lotId = pickFIFOLot(details.lots, defaultUnit, 1) || '';
        priceHT = defaultUnit.defaultPriceHT;
        description = details.name + ' — ' + defaultUnit.name;
      }
      onChange([...items, {
        kind: 'product', description, quantity: 1, priceHT,
        vatRate: details.defaultVatRate || 3, accountCode: '707000',
        medicineId, saleUnitId: defaultUnit?.id || '', lotId,
        patientId: defaultPatientId || '', _medicineDetails: details,
      }]);
    } else {
      // Protocol — expands into several lines. If it doses by weight, ask for the
      // patient's weight first (prefilled from the current animal's record).
      const protocol = await window.api.protocols.get(opt.ref.id);
      if (!protocol?.items?.length) return;
      const hasPerKg = protocol.items.some((i) => i.quantityMode === 'per_kg');
      if (hasPerKg) {
        const knownWeight = patients?.find((p) => p.id === defaultPatientId)?.weight;
        setProtocolWeightPrompt({ protocol, weight: knownWeight ? String(knownWeight) : '' });
      } else {
        await applyProtocol(protocol, '');
      }
    }
  };

  // Nothing matched the catalog — add a free-text act line the vet can price by hand.
  const addFreeText = (text) => {
    onChange([...items, { ...newActItem(defaultPatientId), description: text }]);
  };

  return (
    <div>
      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Ajouter un acte, un produit ou un protocole</label>
        <SearchSelect
          value=""
          onChange={addFromCatalog}
          options={catalogOptions}
          onCreate={addFreeText}
          createLabel="ligne libre"
          placeholder="Tapez un nom d'acte, de médicament ou de protocole…"
          allowClear={false}
        />
      </div>

      {protocolWeightPrompt && (
        <div className="modal-overlay"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 30, overflow: 'auto' }}>
          <div className="card" style={{ maxWidth: 420, width: '100%', marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{protocolWeightPrompt.protocol.name}</h3>
              <button className="btn" style={{ fontSize: '1.4rem', lineHeight: 1, padding: '4px 10px' }} onClick={() => setProtocolWeightPrompt(null)}>×</button>
            </div>
            <p style={{ color: '#6b7280', fontSize: '0.9rem', margin: '4px 0 12px' }}>
              Ce protocole contient une dose au poids — arrondie à l'unité de vente supérieure.
            </p>
            <div className="form-group">
              <label>Poids de l'animal (kg) *</label>
              <input className="input" type="text" inputMode="decimal" autoFocus
                value={protocolWeightPrompt.weight}
                onChange={(e) => setProtocolWeightPrompt({ ...protocolWeightPrompt, weight: e.target.value.replace(',', '.') })} />
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setProtocolWeightPrompt(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={async () => {
                if (num(protocolWeightPrompt.weight) <= 0) { alert('Saisissez un poids > 0.'); return; }
                await applyProtocol(protocolWeightPrompt.protocol, protocolWeightPrompt.weight);
                setProtocolWeightPrompt(null);
              }}>Appliquer</button>
            </div>
          </div>
        </div>
      )}

      {items.map((it, i) => (
        <div key={i} style={{
          border: '1px solid ' + (it.kind === 'product' ? '#bbf7d0' : '#dbeafe'),
          background: it.kind === 'product' ? '#f0fdf4' : '#eff6ff',
          borderRadius: 8, padding: 12, marginBottom: 10,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{
              background: it.kind === 'product' ? '#16a34a' : '#2563eb', color: 'white',
              padding: '2px 8px', borderRadius: 6, fontSize: '0.75em', fontWeight: 600,
            }}>
              {it.kind === 'product' ? 'PRODUIT' : 'ACTE'}
            </span>
            {showAnimalPicker && (
              <select className="select" style={{ width: 'auto', fontSize: '0.85rem' }}
                value={it.patientId || ''}
                onChange={(e) => updateItem(i, { patientId: e.target.value })}>
                <option value="">— Animal —</option>
                {patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            )}
            <button className="btn" style={{ marginLeft: 'auto', color: '#dc2626' }} onClick={() => removeItem(i)}>× supprimer</button>
          </div>

          <input className="input" placeholder="Description" value={it.description ?? ''}
            style={{ marginBottom: 8 }}
            onChange={(e) => updateItem(i, { description: e.target.value })} />

          {it.kind === 'product' && it._medicineDetails && (
            <div style={{ marginBottom: 8 }}>
              <select className="select" value={it.saleUnitId || ''} onChange={(e) => pickSaleUnit(i, e.target.value)}>
                {it._medicineDetails.saleUnits?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {fmtEur(u.defaultPriceHT)} HT / {fmtEur(ttcOf(u.defaultPriceHT, it._medicineDetails.defaultVatRate || it.vatRate))} TTC
                  </option>
                ))}
              </select>
              {it.saleUnitId && !quoteMode && (
                <div style={{ fontSize: '0.85rem', color: '#475569', marginTop: 4 }}>
                  {it.lotId ? (() => {
                    const lot = it._medicineDetails.lots.find((l) => l.id === it.lotId);
                    const su = it._medicineDetails.saleUnits?.find((u) => u.id === it.saleUnitId);
                    const plan = planLotSplit(it._medicineDetails.lots, it.lotId, su, it.quantity);
                    return lot ? (
                      <>
                        📦 Lot (1er entré) : <code>{lot.lotNumber}</code> — péremption {lot.expiryDate} — reste {Number(lot.remainingQuantityBaseUnit)} {it._medicineDetails.baseUnit}
                        <select className="select" style={{ marginLeft: 12, width: 'auto', display: 'inline-block' }}
                          value={it.lotId}
                          onChange={(e) => updateItem(i, { lotId: e.target.value })}>
                          {it._medicineDetails.lots
                            .filter((l) => Number(l.remainingQuantityBaseUnit) > 0)
                            .sort(byEncodingOrder)
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.lotNumber} — {l.expiryDate} — {Number(l.remainingQuantityBaseUnit)} {it._medicineDetails.baseUnit}
                              </option>
                            ))}
                        </select>
                        {plan.length > 1 && (
                          <div style={{ color: '#b45309', marginTop: 4 }}>
                            ↪ Lot insuffisant, réparti sur : {plan.map((p) => `${p.lot.lotNumber} (${Number(p.take.toFixed(3))} ${it._medicineDetails.baseUnit})`).join(' + ')}
                          </div>
                        )}
                      </>
                    ) : null;
                  })() : <span style={{ color: '#dc2626' }}>⚠️ Stock insuffisant (tous lots confondus) pour cette quantité</span>}
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '70px 1fr 70px 100px 1fr', gap: 8 }}>
            <div>
              <label style={{ fontSize: '0.75rem' }}>Qté</label>
              <input className="input" type="text" inputMode="decimal" value={it.quantity ?? ''}
                onChange={(e) => {
                  const v = e.target.value.replace(',', '.');
                  if (it.kind === 'product') updateProductQty(i, v);
                  else updateItem(i, { quantity: v });
                }} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem' }}>Prix unit. HTVA €</label>
              <input className="input" type="text" inputMode="decimal" value={it.priceHT ?? ''}
                onChange={(e) => updateItem(i, { priceHT: e.target.value.replace(',', '.') })} />
              <div style={{ fontSize: '0.72rem', color: '#6b7280', marginTop: 2 }}>
                TVAC : {fmtEur(ttcOf(it.priceHT, it.vatRate))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '0.75rem' }}>TVA %</label>
              <input className="input" type="text" inputMode="decimal" value={it.vatRate ?? ''}
                onChange={(e) => updateItem(i, { vatRate: e.target.value.replace(',', '.') })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem' }}>Compte</label>
              <input className="input" value={it.accountCode ?? ''}
                onChange={(e) => updateItem(i, { accountCode: e.target.value })} />
            </div>
            <div>
              <label style={{ fontSize: '0.75rem' }}>Total</label>
              <div style={{ padding: '4px 0', fontWeight: 600, lineHeight: 1.3 }}>
                {fmtEur(num(it.quantity) * num(it.priceHT))} HTVA
              </div>
              <div style={{ fontSize: '0.78rem', color: '#475569' }}>
                {fmtEur(num(it.quantity) * ttcOf(it.priceHT, it.vatRate))} TVAC
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
