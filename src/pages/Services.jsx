import React, { useEffect, useState, useMemo } from 'react';
import { ttcOf, fmtEur } from '../lib/money.js';

function parseDecimal(s) {
  if (s === '' || s == null) return '';
  return String(s).replace(',', '.');
}

export default function Services() {
  const [services, setServices] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);

  async function load() {
    const list = await window.api.services.list();
    setServices(list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'fr')));
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return services;
    return services.filter((sv) =>
      (sv.name || '').toLowerCase().includes(s) ||
      (sv.code || '').toLowerCase().includes(s)
    );
  }, [services, search]);

  function startNew() {
    setEditing({ code: '', name: '', priceHT: '', vatRate: 17, accountCode: '706000' });
  }
  function startEdit(svc) {
    setEditing({ ...svc });
  }
  async function save() {
    if (!editing.name?.trim()) { alert('Nom obligatoire'); return; }
    const num = (v) => { const n = Number(v); return isNaN(n) ? 0 : n; };
    const data = {
      code: editing.code?.trim() || null,
      name: editing.name.trim(),
      priceHT: num(editing.priceHT),
      vatRate: num(editing.vatRate) || 17,
      accountCode: editing.accountCode || '706000',
    };
    try {
      if (editing.id) await window.api.services.update(editing.id, data);
      else await window.api.services.create(data);
      setEditing(null);
      load();
    } catch (e) { alert('Erreur : ' + e.message); }
  }
  async function remove(id) {
    if (!confirm('Supprimer cet acte ? (les factures passées ne sont pas modifiées)')) return;
    try {
      await window.api.services.delete(id);
      load();
    } catch (e) { alert('Erreur : ' + e.message); }
  }

  return (
    <div>
      <div className="page-header">
        <h2>Catalogue d'actes</h2>
        <button className="btn btn-primary" onClick={startNew}>+ Nouvel acte</button>
      </div>

      <div className="card">
        <input className="input" placeholder="Rechercher par nom ou code…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}>
          {filtered.length} acte{filtered.length > 1 ? 's' : ''}{services.length !== filtered.length ? ` (sur ${services.length})` : ''}
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun acte.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Nom</th>
                <th style={{ textAlign: 'right' }}>Prix HTVA</th>
                <th style={{ textAlign: 'right' }}>Prix TVAC</th>
                <th style={{ textAlign: 'right' }}>TVA</th>
                <th>Compte</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr key={s.id}>
                  <td>{s.code || '—'}</td>
                  <td><strong>{s.name}</strong></td>
                  <td style={{ textAlign: 'right' }}>{fmtEur(s.priceHT)}</td>
                  <td style={{ textAlign: 'right' }}>{fmtEur(ttcOf(s.priceHT, s.vatRate))}</td>
                  <td style={{ textAlign: 'right' }}>{s.vatRate}%</td>
                  <td>{s.accountCode}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => startEdit(s)}>Modifier</button>
                    <button className="btn" style={{ marginLeft: 6, color: '#dc2626' }} onClick={() => remove(s.id)}>×</button>
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
          <div className="card" style={{ maxWidth: 540, width: '100%', marginTop: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>{editing.id ? 'Modifier' : 'Nouvel'} acte</h3>
              <button className="btn" style={{ fontSize: '1.4rem', lineHeight: 1, padding: '4px 10px' }} onClick={() => setEditing(null)}>×</button>
            </div>

            <div className="form-grid-2">
              <div className="form-row">
                <label>Code (optionnel)</label>
                <input className="input" value={editing.code || ''}
                  onChange={(e) => setEditing({ ...editing, code: e.target.value })} />
              </div>
              <div className="form-row">
                <label>Nom *</label>
                <input className="input" value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-row">
                <label>Prix HTVA (€) *</label>
                <input className="input" type="text" inputMode="decimal" value={editing.priceHT}
                  onChange={(e) => setEditing({ ...editing, priceHT: parseDecimal(e.target.value) })} />
                <small style={{ color: '#6b7280' }}>
                  Soit {fmtEur(ttcOf(editing.priceHT, editing.vatRate))} TVAC
                </small>
              </div>
              <div className="form-row">
                <label>TVA (%)</label>
                <input className="input" type="text" inputMode="decimal" value={editing.vatRate}
                  onChange={(e) => setEditing({ ...editing, vatRate: parseDecimal(e.target.value) })} />
              </div>
            </div>
            <div className="form-row">
              <label>Compte comptable</label>
              <input className="input" value={editing.accountCode}
                onChange={(e) => setEditing({ ...editing, accountCode: e.target.value })} />
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn btn-primary" onClick={save}>{editing.id ? 'Enregistrer' : 'Créer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
