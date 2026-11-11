import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { Link } from 'react-router-dom';
import { ttcOf, fmtEur, num as toNum } from '../lib/money.js';

function parseDecimal(s) {
  if (s === '' || s == null) return '';
  // Accept "0.5" or "0,5" or partial like "0." (preserve string while typing)
  const cleaned = String(s).replace(',', '.');
  if (cleaned === '.' || cleaned === '-') return cleaned;
  // Keep the raw string so user can type freely; convert later if needed
  return cleaned;
}

// Prix par unité de base (ex: par dose) avant réduction = prix payé par emballage / doses par emballage
function baseUnitPriceHT(lot) {
  const unit = Number(lot?.unitPriceHT);
  if (!unit) return 0;
  const packSize = Number(lot?.packSize) || 1;
  return unit / packSize;
}

// Prix net HT par emballage (comme sur la facture : P.N. = P.U. - remise%). Arrondi au centime à ce niveau,
// exactement comme le fournisseur arrondit sa ligne de facture — PAS après division par le conditionnement.
function netPackagePriceHT(lot) {
  const unit = Number(lot?.unitPriceHT);
  if (!unit) return '';
  const discount = Number(lot?.discountPct) || 0;
  return (unit * (1 - discount / 100)).toFixed(2);
}

// Quantité totale reçue en unité de base = nombre d'emballages reçus × doses (ou autre unité) par emballage
function totalBaseUnitsReceived(lot) {
  const packages = Number(lot?.packagesReceived);
  if (!packages) return 0;
  const packSize = Number(lot?.packSize) || 1;
  return packages * packSize;
}

// Prix total HT payé pour le lot = prix net par emballage × nombre d'emballages reçus (coïncide avec le total facture)
function totalPurchasePriceHT(lot) {
  const net = Number(netPackagePriceHT(lot));
  const packages = Number(lot?.packagesReceived);
  if (!net || !packages) return '';
  return (net * packages).toFixed(2);
}

// Prix net HT par unité de base (dose), pour info seulement : dérivé du total réel, jamais l'inverse,
// pour ne jamais désynchroniser le prix unitaire affiché et le total payé.
function netUnitPriceHT(lot) {
  const total = Number(totalPurchasePriceHT(lot));
  const qty = totalBaseUnitsReceived(lot);
  if (!total || !qty) return '';
  return (total / qty).toFixed(2);
}

export default function Medicines() {
  // Seul l'admin voit les marges (santé financière du cabinet).
  const { user } = useAuth();
  const seesMargins = user?.role === 'admin';
  // Catégorie de marge choisie à la réception d'un lot. « stored » = on garde
  // celle déjà enregistrée sur le médicament.
  const [marginPreset, setMarginPreset] = useState('stored');
  const [presets, setPresets] = useState({});
  const [meds, setMeds] = useState([]);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null);
  const [addingLot, setAddingLot] = useState(null); // { medicineId, medicineName, baseUnit }
  const [newLot, setNewLot] = useState(null);
  const [lotQtyEdit, setLotQtyEdit] = useState(null); // { id, value }

  // Escape key closes any open modal
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (addingLot) { setAddingLot(null); setNewLot(null); }
        else if (editing) setEditing(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, addingLot]);

  async function load() {
    const list = await window.api.medicines.list({
      includeInactive: showInactive ? '1' : '',
    });
    setMeds(list);
  }

  useEffect(() => {
    load();
  }, [showInactive]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return meds;
    return meds.filter((m) =>
      (m.name || '').toLowerCase().includes(s) ||
      (m.atcCode || '').toLowerCase().includes(s) ||
      (m.description || '').toLowerCase().includes(s)
    );
  }, [meds, search]);

  function startNew() {
    setEditing({
      name: '', atcCode: '', description: '',
      baseUnit: 'comprimé', packagingDescription: '',
      defaultVatRate: 3.0, minStockAlert: 0, targetMarginPct: 35, active: true, notes: '',
      saleUnits: [{ name: '1 boîte', quantityInBaseUnit: 1, defaultPriceHT: 0, isDefault: 1, sortOrder: 0 }],
    });
  }

  async function startEdit(id) {
    const full = await window.api.medicines.get(id);
    setEditing(full);
  }

  function startAddLot(med) {
    const today = new Date().toISOString().slice(0, 10);
    setAddingLot({ medicineId: med.id, medicineName: med.name, baseUnit: med.baseUnit });
    setNewLot({
      lotNumber: '',
      expiryDate: '',
      supplierName: '',
      purchaseDate: today,
      unitPriceHT: '',
      discountPct: '',
      packSize: '1',
      packagesReceived: '',
      notes: '',
    });
  }

  async function saveLot() {
    if (!newLot.lotNumber || !newLot.expiryDate || !newLot.purchaseDate || !newLot.packagesReceived) {
      alert('N° lot, date péremption, date achat, et quantité sont obligatoires.');
      return;
    }
    try {
      await window.api.lots.create({
        medicineId: addingLot.medicineId,
        lotNumber: newLot.lotNumber.trim(),
        expiryDate: newLot.expiryDate,
        supplierName: newLot.supplierName?.trim() || null,
        purchaseDate: newLot.purchaseDate,
        unitPriceHT: baseUnitPriceHT(newLot),
        discountPct: Number(newLot.discountPct) || 0,
        purchasePriceHT: Number(totalPurchasePriceHT(newLot)) || 0,
        initialQuantityBaseUnit: totalBaseUnitsReceived(newLot),
        notes: newLot.notes?.trim() || null,
      });
      setAddingLot(null);
      setNewLot(null);
      load();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  }

  useEffect(() => {
    window.api.medicines.marginPresets().then(setPresets).catch(() => setPresets({}));
  }, []);

  async function recalcMargin() {
    if (!addingLot || !newLot) return;
    const unitPrice = Number(newLot.unitPriceHT);
    const qty = Number(newLot.packagesReceived);
    if (!unitPrice || !qty) {
      alert('Renseigne d\'abord la quantité reçue ET le prix unitaire HT.');
      return;
    }
    // Le serveur applique la marge cible : elle n'est pas transmise aux
    // rôles qui n'ont pas à connaître la santé financière du cabinet.
    const r = await window.api.medicines.pricePreview(
      addingLot.medicineId,
      baseUnitPriceHT(newLot),
      marginPreset === 'stored' ? null : marginPreset
    );
    const newUnits = r.saleUnits || [];
    const fmtPrice = (p) => p < 1 ? p.toFixed(3) : p.toFixed(2);
    const vat = toNum(r.vatRate);
    const lines = newUnits.map((u) => {
      const ttc = u.defaultPriceHT * (1 + vat / 100);
      return '  ' + u.name + ' : ' + fmtPrice(u.defaultPriceHT) + ' € HTVA / ' + fmtPrice(ttc) + ' € TVAC';
    });
    if (!confirm('Mettre à jour les prix de vente ?\n' + lines.join('\n'))) return;
    await window.api.medicines.saveSaleUnits(addingLot.medicineId, newUnits);
    alert(r.targetMarginPct != null
      ? 'Prix de vente mis à jour avec ' + r.targetMarginPct + '% de marge cible (arrondi au sup).'
      : 'Prix de vente mis à jour (arrondi au sup).');
    load();
  }

  async function deleteLot(lotId) {
    if (!confirm('Supprimer définitivement ce lot ?')) return;
    try {
      await window.api.lots.delete(lotId);
      // Reload current edit modal data
      if (editing?.id) {
        const fresh = await window.api.medicines.get(editing.id);
        setEditing(fresh);
      }
      load();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  }

  async function saveLotQty() {
    if (!lotQtyEdit) return;
    const v = Number(String(lotQtyEdit.value).replace(',', '.'));
    if (isNaN(v) || v < 0) {
      alert('Quantité invalide.');
      return;
    }
    try {
      await window.api.lots.update(lotQtyEdit.id, { remainingQuantityBaseUnit: v });
      setLotQtyEdit(null);
      if (editing?.id) {
        const fresh = await window.api.medicines.get(editing.id);
        setEditing(fresh);
      }
      load();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  }

  async function save() {
    if (!editing.name?.trim()) {
      alert('Le nom est obligatoire');
      return;
    }
    const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const cleaned = {
      ...editing,
      defaultVatRate: num(editing.defaultVatRate),
      minStockAlert: num(editing.minStockAlert),
      // Non-admin : on n'envoie pas la marge (on ne l'a pas reçue) ; le
      // serveur conserve celle déjà enregistrée.
      ...(seesMargins ? { targetMarginPct: num(editing.targetMarginPct) || 35 } : {}),
      saleUnits: (editing.saleUnits || []).map((u) => ({
        ...u,
        quantityInBaseUnit: num(u.quantityInBaseUnit),
        defaultPriceHT: num(u.defaultPriceHT),
      })),
    };
    try {
      if (editing.id) {
        await window.api.medicines.update(editing.id, cleaned);
        if (Array.isArray(cleaned.saleUnits)) {
          await window.api.medicines.saveSaleUnits(editing.id, cleaned.saleUnits);
        }
      } else {
        await window.api.medicines.create(cleaned);
      }
      setEditing(null);
      load();
    } catch (e) {
      alert('Erreur enregistrement : ' + e.message);
    }
  }

  async function remove(id) {
    if (!confirm('Désactiver ce médicament ? (les dispensations passées restent traçables)')) return;
    await window.api.medicines.delete(id);
    load();
  }

  function addUnit() {
    setEditing({
      ...editing,
      saleUnits: [...(editing.saleUnits || []), {
        name: '', quantityInBaseUnit: 1, defaultPriceHT: 0, isDefault: 0, sortOrder: (editing.saleUnits?.length || 0),
      }],
    });
  }

  function removeUnit(i) {
    const u = (editing.saleUnits || []).filter((_, idx) => idx !== i);
    setEditing({ ...editing, saleUnits: u });
  }

  function updateUnit(i, patch) {
    const u = [...(editing.saleUnits || [])];
    u[i] = { ...u[i], ...patch };
    if (patch.isDefault === 1) {
      u.forEach((x, idx) => { if (idx !== i) x.isDefault = 0; });
    }
    setEditing({ ...editing, saleUnits: u });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Médicaments</h2>
        </div>
        {seesMargins && <button className="btn btn-primary" onClick={startNew}>+ Nouveau médicament</button>}
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <input className="input" placeholder="Rechercher par nom, code ATC, description…"
            value={search} onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Inclure inactifs
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}>
          {filtered.length} médicament{filtered.length > 1 ? 's' : ''}
          {meds.length !== filtered.length ? ` (sur ${meds.length})` : ''}
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun médicament.{seesMargins && ' Cliquez sur "+ Nouveau médicament" pour commencer.'}</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Code ATC</th>
                <th>Unité</th>
                <th style={{ textAlign: 'right' }}>Stock</th>
                <th>Péremption proche</th>
                <th>TVA</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} style={{ opacity: m.active ? 1 : 0.5 }}>
                  <td><strong>{m.name}</strong>{!m.active && ' (inactif)'}</td>
                  <td>{m.atcCode || '—'}</td>
                  <td>{m.baseUnit}</td>
                  <td style={{ textAlign: 'right' }}>
                    {m.totalStockBase != null
                      ? `${Number(m.totalStockBase).toLocaleString('fr-LU')} ${m.baseUnit}`
                      : '—'}
                    {m.minStockAlert > 0 && m.totalStockBase < m.minStockAlert && (
                      <span style={{ marginLeft: 6, color: '#dc2626', fontSize: '0.85em' }}>⚠️ bas</span>
                    )}
                  </td>
                  <td>{m.nearestExpiry || '—'}</td>
                  <td>{m.defaultVatRate}%</td>
                  <td>
                    {m.active && (
                      <button className="btn btn-primary" style={{ marginRight: 6 }} onClick={() => startAddLot(m)}>+ Lot</button>
                    )}
                    <button className="btn btn-secondary" onClick={() => startEdit(m.id)}>Modifier</button>
                    {m.active && (
                      <button className="btn" style={{ marginLeft: 6, color: '#dc2626' }} onClick={() => remove(m.id)}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="modal-overlay"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 30, overflow: 'auto' }}>
          <div className="card" style={{ maxWidth: 720, width: '100%', marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{editing.id ? 'Modifier' : 'Nouveau'} médicament</h3>
              <button className="btn" style={{ fontSize: '1.4rem', lineHeight: 1, padding: '4px 10px' }} onClick={() => setEditing(null)} aria-label="Fermer">×</button>
            </div>

            <div className="form-row">
              <label>Nom *</label>
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Code ATC (optionnel)</label>
                <input className="input" value={editing.atcCode || ''} onChange={(e) => setEditing({ ...editing, atcCode: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Conditionnement (ex: "Boîte de 10 cp")</label>
                <input className="input" value={editing.packagingDescription || ''} onChange={(e) => setEditing({ ...editing, packagingDescription: e.target.value })} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Unité de base * (mL, comprimé, g…)</label>
                <input className="input" value={editing.baseUnit} onChange={(e) => setEditing({ ...editing, baseUnit: e.target.value })} />
              </div>
              <div className="form-row">
                <label>TVA par défaut (%)</label>
                <input className="input" type="text" inputMode="decimal" value={editing.defaultVatRate ?? ''} onChange={(e) => setEditing({ ...editing, defaultVatRate: parseDecimal(e.target.value) })} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Seuil d'alerte stock bas (en {editing.baseUnit}, 0 = pas d'alerte)</label>
                <input className="input" type="text" inputMode="decimal" value={editing.minStockAlert ?? ''} onChange={(e) => setEditing({ ...editing, minStockAlert: parseDecimal(e.target.value) })} />
              </div>
              <div className="form-row">
                <label>{seesMargins ? 'Marge cible (%)' : 'Marge cible'}</label>
                {seesMargins ? (
                  <input className="input" type="text" inputMode="decimal" value={editing.targetMarginPct ?? ''} onChange={(e) => setEditing({ ...editing, targetMarginPct: parseDecimal(e.target.value) })} />
                ) : (
                  <input className="input" value="—" disabled title="Réservé à l'administrateur" />
                )}
              </div>
            </div>

            <div className="form-row">
              <label>Description (optionnel)</label>
              <textarea className="textarea" rows="2" value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>

            <h4 style={{ marginTop: 20 }}>Unités de vente</h4>
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 10 }}>
              Définissez les conditionnements vendables. Ex: "1 flacon de 20mL" (= 20 unités de base), "1 mL" (= 1 unité de base).
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 60px 40px', gap: 8, marginBottom: 4, fontSize: '0.75rem', color: '#6b7280' }}>
              <div>Nom</div>
              <div>Qté en {editing.baseUnit}</div>
              <div>Prix HTVA</div>
              <div>Prix TVAC</div>
              <div></div>
              <div></div>
            </div>
            {(editing.saleUnits || []).map((u, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 60px 40px', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                <input className="input" placeholder="Nom (ex: 1 flacon 20mL)" value={u.name}
                  onChange={(e) => updateUnit(i, { name: e.target.value })} />
                <input className="input" type="text" inputMode="decimal" placeholder={'Qté en ' + editing.baseUnit}
                  value={u.quantityInBaseUnit ?? ''}
                  onChange={(e) => updateUnit(i, { quantityInBaseUnit: parseDecimal(e.target.value) })} />
                <input className="input" type="text" inputMode="decimal" placeholder="Prix HTVA €"
                  value={u.defaultPriceHT ?? ''}
                  onChange={(e) => updateUnit(i, { defaultPriceHT: parseDecimal(e.target.value) })} />
                <div style={{ fontSize: '0.85rem', color: '#475569', padding: '6px 0' }}>
                  {fmtEur(ttcOf(u.defaultPriceHT, editing.defaultVatRate))}
                </div>
                <label style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" name="defaultUnit" checked={u.isDefault === 1}
                    onChange={() => updateUnit(i, { isDefault: 1 })} />
                  défaut
                </label>
                <button className="btn" style={{ color: '#dc2626' }} onClick={() => removeUnit(i)}>×</button>
              </div>
            ))}
            <button className="btn btn-secondary" onClick={addUnit}>+ Ajouter une unité</button>

            {editing.id && (
              <>
                <h4 style={{ marginTop: 24 }}>Lots en stock</h4>
                {(editing.lots || []).length === 0 ? (
                  <div style={{ color: '#6b7280', fontStyle: 'italic', fontSize: '0.9rem', padding: '8px 0' }}>
                    Aucun lot. Fermez ce dialogue puis cliquez sur "+ Lot" depuis la liste.
                  </div>
                ) : (
                  <table className="table" style={{ fontSize: '0.9rem' }}>
                    <thead>
                      <tr>
                        <th>N° Lot</th>
                        <th>Péremption</th>
                        <th style={{ textAlign: 'right' }}>Restant</th>
                        <th>Fournisseur</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {editing.lots.map((l) => (
                        <tr key={l.id}>
                          <td><code>{l.lotNumber}</code></td>
                          <td>{l.expiryDate}</td>
                          <td style={{ textAlign: 'right' }}>
                            {lotQtyEdit?.id === l.id ? (
                              <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                                <input
                                  className="input"
                                  type="text"
                                  inputMode="decimal"
                                  autoFocus
                                  style={{ width: 80, textAlign: 'right', padding: '2px 6px' }}
                                  value={lotQtyEdit.value}
                                  onChange={(e) => setLotQtyEdit({ ...lotQtyEdit, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') saveLotQty();
                                    if (e.key === 'Escape') setLotQtyEdit(null);
                                  }}
                                />
                                <button className="btn" style={{ color: '#16a34a', padding: '2px 8px' }} onClick={saveLotQty} title="Valider">✓</button>
                                <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setLotQtyEdit(null)} title="Annuler">×</button>
                              </span>
                            ) : (
                              <span
                                style={{ cursor: 'pointer' }}
                                title="Cliquer pour corriger la quantité restante (perte, casse, inventaire…)"
                                onClick={() => setLotQtyEdit({ id: l.id, value: String(l.remainingQuantityBaseUnit) })}
                              >
                                {Number(l.remainingQuantityBaseUnit).toLocaleString('fr-LU')} {editing.baseUnit} ✎
                              </span>
                            )}
                          </td>
                          <td>{l.supplierName || '—'}</td>
                          <td>
                            <button className="btn" style={{ color: '#dc2626' }} onClick={() => deleteLot(l.id)}>×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 24, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={save}>{editing.id ? 'Enregistrer' : 'Créer'}</button>
            </div>
          </div>
        </div>
      )}

      {addingLot && newLot && (
        <div className="modal-overlay"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 30, overflow: 'auto' }}>
          <div className="card" style={{ maxWidth: 540, width: '100%', marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Recevoir un lot</h3>
              <button className="btn" style={{ fontSize: '1.4rem', lineHeight: 1, padding: '4px 10px' }} onClick={() => { setAddingLot(null); setNewLot(null); }} aria-label="Fermer">×</button>
            </div>
            <div style={{ color: '#6b7280', marginBottom: 16 }}>{addingLot.medicineName}</div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>N° lot *</label>
                <input className="input" value={newLot.lotNumber}
                  onChange={(e) => setNewLot({ ...newLot, lotNumber: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Péremption *</label>
                <input className="input" type="date" value={newLot.expiryDate}
                  onChange={(e) => setNewLot({ ...newLot, expiryDate: e.target.value })} />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Conditionnement d'achat ({addingLot.baseUnit} par emballage)</label>
                <input className="input" type="text" inputMode="decimal" placeholder="1" value={newLot.packSize}
                  onChange={(e) => setNewLot({ ...newLot, packSize: e.target.value.replace(',', '.') })} />
              </div>
              <div className="form-row">
                <label>{Number(newLot.packSize) > 1 ? "Nombre d'emballages reçus *" : `Quantité reçue * (en ${addingLot.baseUnit})`}</label>
                <input className="input" type="text" inputMode="decimal" value={newLot.packagesReceived}
                  onChange={(e) => setNewLot({ ...newLot, packagesReceived: e.target.value.replace(',', '.') })} />
                {Number(newLot.packSize) > 1 && Number(newLot.packagesReceived) > 0 && (
                  <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 4 }}>
                    = {totalBaseUnitsReceived(newLot).toLocaleString('fr-LU')} {addingLot.baseUnit} au total
                  </div>
                )}
              </div>
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>{Number(newLot.packSize) > 1 ? `Prix HT par emballage (€) — P.U. facture` : 'Prix unitaire HT (€) — P.U.'}</label>
                <input className="input" type="text" inputMode="decimal" value={newLot.unitPriceHT}
                  onChange={(e) => setNewLot({ ...newLot, unitPriceHT: e.target.value.replace(',', '.') })} />
              </div>
              <div className="form-row">
                <label>Réduction fournisseur (%)</label>
                <input className="input" type="text" inputMode="decimal" placeholder="0" value={newLot.discountPct}
                  onChange={(e) => setNewLot({ ...newLot, discountPct: e.target.value.replace(',', '.') })} />
              </div>
            </div>

            <div className="form-row">
              <label>Prix net HT (€) — P.N., par {addingLot.baseUnit}</label>
              <input className="input" type="text" value={netUnitPriceHT(newLot)} disabled
                style={{ background: '#f1f5f9', color: '#475569' }} />
            </div>

            <div className="form-row">
              <label>Prix total HT (€) — payé pour le lot</label>
              <input className="input" type="text" value={totalPurchasePriceHT(newLot)} disabled
                style={{ background: '#f1f5f9', color: '#475569' }} />
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Date d'achat *</label>
                <input className="input" type="date" value={newLot.purchaseDate}
                  onChange={(e) => setNewLot({ ...newLot, purchaseDate: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Fournisseur</label>
                <input className="input" value={newLot.supplierName}
                  onChange={(e) => setNewLot({ ...newLot, supplierName: e.target.value })} />
              </div>
            </div>

            <div className="form-row">
              <label>Notes</label>
              <textarea className="textarea" rows="2" value={newLot.notes}
                onChange={(e) => setNewLot({ ...newLot, notes: e.target.value })} />
            </div>

            <div style={{ background: '#f8fafc', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginTop: 8 }}>
              <div style={{ fontSize: '0.85rem', color: '#475569', marginBottom: 8 }}>
                💡 Recalculer les prix de vente du médicament pour appliquer une marge sur ce nouveau coût.
              </div>
              <select className="input" style={{ marginBottom: 8 }} value={marginPreset} onChange={(e) => setMarginPreset(e.target.value)}>
                <option value="stored">Marge habituelle de ce médicament</option>
                <option value="medicine">Marge médicament{presets.medicine ? ` (${presets.medicine} %)` : ''}</option>
                <option value="food">Marge nourriture{presets.food ? ` (${presets.food} %)` : ''}</option>
              </select>
              <button className="btn btn-secondary" onClick={() => recalcMargin()}>
                {seesMargins ? 'Calculer prix de vente avec marge cible' : 'Recalculer les prix de vente'}
              </button>
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => { setAddingLot(null); setNewLot(null); }}>Annuler</button>
              <button className="btn btn-primary" onClick={saveLot}>Enregistrer le lot</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
