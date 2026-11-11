import React, { useEffect, useMemo, useState } from 'react';
import SearchSelect from '../components/SearchSelect.jsx';
import { num, ttcOf, fmtEur } from '../lib/money.js';

function blankActItem() {
  return {
    kind: 'act', serviceId: '',
    description: '', quantity: 1, quantityMode: 'fixed',
    priceHT: 0, vatRate: 17, accountCode: '706000',
  };
}
function blankProductItem() {
  return {
    kind: 'product', medicineId: '', saleUnitId: '',
    description: '', quantity: 1, quantityMode: 'fixed',
    priceHT: 0, vatRate: 3, accountCode: '707000',
    _saleUnits: [],
  };
}

export default function Protocols() {
  const [protocols, setProtocols] = useState([]);
  const [services, setServices] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [proto, svcs, meds] = await Promise.all([
        window.api.protocols.list(),
        window.api.services.list(),
        window.api.medicines.list(),
      ]);
      setProtocols(proto);
      setServices(svcs);
      setMedicines(meds);
    } catch (e) {
      alert('Erreur de chargement : ' + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return protocols;
    return protocols.filter((p) =>
      (p.name || '').toLowerCase().includes(q)
      || (p.description || '').toLowerCase().includes(q)
    );
  }, [protocols, search]);

  function startNew() {
    setEditing({ name: '', description: '', notes: '', items: [blankActItem()] });
  }
  async function startEdit(p) {
    try {
      const full = await window.api.protocols.get(p.id);
      // For product items, prefetch their sale units list so the dropdown stays populated
      const items = await Promise.all((full.items || []).map(async (it) => {
        if (it.kind === 'product' && it.medicineId) {
          try {
            const det = await window.api.medicines.get(it.medicineId);
            return { ...it, _saleUnits: det.saleUnits || [] };
          } catch { return { ...it, _saleUnits: [] }; }
        }
        return it;
      }));
      setEditing({ ...full, items });
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
  }

  async function remove(p) {
    if (!confirm(`Supprimer le protocole « ${p.name} » ?`)) return;
    try {
      await window.api.protocols.delete(p.id);
      load();
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
  }

  if (editing) {
    return (
      <ProtocolEditor
        editing={editing}
        setEditing={setEditing}
        services={services}
        medicines={medicines}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Protocoles</h2>
        <button className="btn btn-primary" onClick={startNew}>+ Nouveau protocole</button>
      </div>

      <div className="card">
        <input
          className="input"
          placeholder="Rechercher un protocole…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}>
          {filtered.length} protocole{filtered.length > 1 ? 's' : ''}
          {protocols.length !== filtered.length ? ` (sur ${protocols.length})` : ''}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            Aucun protocole. Créez-en un pour grouper des actes et médicaments
            fréquemment facturés ensemble (ex: anesthésie, vaccination annuelle).
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Description</th>
                <th style={{ textAlign: 'right' }}>Lignes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong></td>
                  <td style={{ color: '#475569' }}>{p.description || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{p.itemsCount}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => startEdit(p)}>Modifier</button>
                    <button className="btn" style={{ marginLeft: 6, color: '#dc2626' }} onClick={() => remove(p)}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ProtocolEditor({ editing, setEditing, services, medicines, onCancel, onSaved }) {
  const [saving, setSaving] = useState(false);

  const addAct = () => setEditing({ ...editing, items: [...editing.items, blankActItem()] });
  const addProduct = () => setEditing({ ...editing, items: [...editing.items, blankProductItem()] });
  const removeItem = (i) => {
    const items = editing.items.filter((_, idx) => idx !== i);
    setEditing({ ...editing, items });
  };
  const updateItem = (i, patch) => {
    const items = [...editing.items];
    items[i] = { ...items[i], ...patch };
    setEditing({ ...editing, items });
  };
  const moveItem = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= editing.items.length) return;
    const items = [...editing.items];
    [items[i], items[j]] = [items[j], items[i]];
    setEditing({ ...editing, items });
  };

  const applyService = (i, serviceId) => {
    const svc = services.find((s) => s.id === serviceId);
    if (!svc) {
      updateItem(i, { serviceId: '', description: '', priceHT: 0 });
      return;
    }
    updateItem(i, {
      serviceId: svc.id,
      description: svc.name,
      priceHT: svc.priceHT,
      vatRate: svc.vatRate,
      accountCode: svc.accountCode || '706000',
    });
  };

  const pickMedicine = async (i, medicineId) => {
    if (!medicineId) {
      updateItem(i, { medicineId: '', saleUnitId: '', _saleUnits: [], description: '', priceHT: 0 });
      return;
    }
    const det = await window.api.medicines.get(medicineId);
    const defaultUnit = det.saleUnits?.find((u) => u.isDefault === 1) || det.saleUnits?.[0];
    updateItem(i, {
      medicineId,
      saleUnitId: defaultUnit?.id || '',
      _saleUnits: det.saleUnits || [],
      description: det.name + (defaultUnit ? ' — ' + defaultUnit.name : ''),
      priceHT: defaultUnit?.defaultPriceHT || 0,
      vatRate: det.defaultVatRate || 3,
    });
  };

  const pickSaleUnit = (i, saleUnitId) => {
    const it = editing.items[i];
    const su = (it._saleUnits || []).find((u) => u.id === saleUnitId);
    if (!su) {
      updateItem(i, { saleUnitId: '' });
      return;
    }
    // Use the medicine's name (everything before " — ") + new unit name
    const med = medicines.find((m) => m.id === it.medicineId);
    updateItem(i, {
      saleUnitId,
      priceHT: su.defaultPriceHT,
      description: (med?.name || it.description.split(' — ')[0]) + ' — ' + su.name,
    });
  };

  async function save() {
    if (!editing.name?.trim()) { alert('Donnez un nom au protocole.'); return; }
    if (!editing.items.length) { alert('Ajoutez au moins une ligne.'); return; }
    for (const it of editing.items) {
      if (!it.description?.trim()) { alert('Toutes les lignes doivent avoir une description.'); return; }
      if (it.kind === 'product' && !it.medicineId) { alert('Sélectionnez un médicament pour chaque ligne produit.'); return; }
      if (it.kind === 'product' && !it.saleUnitId) { alert('Sélectionnez une unité de vente pour chaque ligne produit.'); return; }
      if (num(it.quantity) <= 0) { alert('Quantité (ou dose/kg) doit être > 0.'); return; }
    }
    const payload = {
      name: editing.name.trim(),
      description: editing.description?.trim() || null,
      notes: editing.notes?.trim() || null,
      items: editing.items.map((it, idx) => ({
        sortOrder: idx,
        kind: it.kind,
        serviceId: it.kind === 'act' ? (it.serviceId || null) : null,
        medicineId: it.kind === 'product' ? (it.medicineId || null) : null,
        saleUnitId: it.kind === 'product' ? (it.saleUnitId || null) : null,
        description: it.description.trim(),
        quantityMode: it.quantityMode || 'fixed',
        quantity: num(it.quantity),
        priceHT: num(it.priceHT),
        vatRate: num(it.vatRate),
        accountCode: it.accountCode || (it.kind === 'product' ? '707000' : '706000'),
      })),
    };
    setSaving(true);
    try {
      if (editing.id) await window.api.protocols.update(editing.id, payload);
      else await window.api.protocols.create(payload);
      onSaved();
    } catch (e) {
      alert('Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>{editing.id ? 'Modifier le protocole' : 'Nouveau protocole'}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={onCancel} disabled={saving}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : (editing.id ? 'Enregistrer' : 'Créer')}
          </button>
        </div>
      </div>

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Nom *</label>
            <input className="input" value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Description (optionnel)</label>
            <input className="input" value={editing.description || ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="ex: Anesthésie de courte durée pour chirurgie mineure" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Notes internes (optionnel)</label>
            <textarea className="textarea" value={editing.notes || ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Lignes du protocole</h3>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-secondary" onClick={addAct}>+ Acte</button>
            <button className="btn btn-primary" onClick={addProduct}>+ Produit</button>
          </div>
        </div>

        {editing.items.length === 0 && (
          <div className="empty-state">Aucune ligne. Ajoutez des actes ou des produits.</div>
        )}

        {editing.items.map((it, i) => (
          <div key={i} style={{
            border: '1px solid ' + (it.kind === 'product' ? '#bbf7d0' : '#dbeafe'),
            background: it.kind === 'product' ? '#f0fdf4' : '#eff6ff',
            borderRadius: 8, padding: 12, marginBottom: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                background: it.kind === 'product' ? '#16a34a' : '#2563eb', color: 'white',
                padding: '2px 8px', borderRadius: 6, fontSize: '0.75em', fontWeight: 600,
              }}>
                {it.kind === 'product' ? 'PRODUIT' : 'ACTE'}
              </span>
              <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>Ligne {i + 1}</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                <button className="btn" title="Monter" onClick={() => moveItem(i, -1)} disabled={i === 0}>↑</button>
                <button className="btn" title="Descendre" onClick={() => moveItem(i, +1)} disabled={i === editing.items.length - 1}>↓</button>
                <button className="btn" style={{ color: '#dc2626' }} onClick={() => removeItem(i)}>× supprimer</button>
              </div>
            </div>

            {it.kind === 'act' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, marginBottom: 8 }}>
                <SearchSelect
                  value={it.serviceId || ''}
                  onChange={(id) => applyService(i, id)}
                  options={services.map((s) => ({
                    id: s.id,
                    label: `${s.code ? `[${s.code}] ` : ''}${s.name}`,
                    sub: `${fmtEur(s.priceHT)} HT · ${fmtEur(ttcOf(s.priceHT, s.vatRate))} TTC`,
                    keywords: s.code || '',
                  }))}
                  placeholder="Rechercher un acte…"
                />
                <input className="input" placeholder="Description" value={it.description}
                  onChange={(e) => updateItem(i, { description: e.target.value })} />
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
                <SearchSelect
                  value={it.medicineId || ''}
                  onChange={(id) => pickMedicine(i, id)}
                  options={medicines.map((m) => ({
                    id: m.id,
                    label: m.name,
                    sub: m.atcCode ? `ATC ${m.atcCode}` : null,
                    keywords: `${m.atcCode || ''} ${m.description || ''}`,
                  }))}
                  placeholder="Rechercher un médicament…"
                />
                <select className="select" value={it.saleUnitId || ''}
                  onChange={(e) => pickSaleUnit(i, e.target.value)}
                  disabled={!(it._saleUnits || []).length}>
                  <option value="">— Unité —</option>
                  {(it._saleUnits || []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {fmtEur(u.defaultPriceHT)} HT
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 100px 80px 110px', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: '0.75rem' }}>Posologie</label>
                <select className="select" value={it.quantityMode}
                  onChange={(e) => updateItem(i, { quantityMode: e.target.value })}>
                  <option value="fixed">Quantité fixe</option>
                  <option value="per_kg">Dose par kg (poids du patient)</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '0.75rem' }}>
                  {it.quantityMode === 'per_kg' ? 'Qté / kg' : 'Quantité'}
                </label>
                <input className="input" type="text" inputMode="decimal"
                  value={it.quantity}
                  onChange={(e) => updateItem(i, { quantity: e.target.value.replace(',', '.') })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem' }}>Prix unit. HTVA €</label>
                <input className="input" type="text" inputMode="decimal" value={it.priceHT}
                  onChange={(e) => updateItem(i, { priceHT: e.target.value.replace(',', '.') })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem' }}>TVA %</label>
                <input className="input" type="text" inputMode="decimal" value={it.vatRate}
                  onChange={(e) => updateItem(i, { vatRate: e.target.value.replace(',', '.') })} />
              </div>
              <div>
                <label style={{ fontSize: '0.75rem' }}>Compte</label>
                <input className="input" value={it.accountCode}
                  onChange={(e) => updateItem(i, { accountCode: e.target.value })} />
              </div>
            </div>

            {it.quantityMode === 'per_kg' && (
              <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#475569' }}>
                💡 Pour un patient de 10 kg, cette ligne facturera{' '}
                <strong>{Math.ceil(num(it.quantity) * 10) || 0}</strong> {it.kind === 'product' ? 'unité(s)' : 'fois'}{' '}
                (arrondi à l'unité supérieure).
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
