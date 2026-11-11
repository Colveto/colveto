import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function daysUntil(iso) {
  if (!iso) return Infinity;
  const d = new Date(iso);
  const now = new Date();
  return Math.ceil((d - now) / 86400000);
}

function expiryBadge(iso) {
  const days = daysUntil(iso);
  if (days < 0) return { label: 'Périmé', color: '#dc2626' };
  if (days <= 30) return { label: `Périme dans ${days}j`, color: '#dc2626' };
  if (days <= 90) return { label: `Périme dans ${days}j`, color: '#f59e0b' };
  return null;
}

export default function Stock() {
  const [lots, setLots] = useState([]);
  const [filter, setFilter] = useState('all'); // all | expiring30 | expiring90 | lowStock | empty
  const [search, setSearch] = useState('');
  const [qtyEdit, setQtyEdit] = useState(null); // { id, value }

  async function load() {
    const opts = { withZeroStock: filter === 'empty' ? '1' : '' };
    if (filter === 'expiring30') opts.expiringInDays = 30;
    if (filter === 'expiring90') opts.expiringInDays = 90;
    if (filter === 'lowStock') opts.lowStockOnly = '1';
    const list = await window.api.lots.list(opts);
    setLots(list);
  }

  async function saveQty() {
    if (!qtyEdit) return;
    const v = Number(String(qtyEdit.value).replace(',', '.'));
    if (isNaN(v) || v < 0) {
      alert('Quantité invalide.');
      return;
    }
    try {
      await window.api.lots.update(qtyEdit.id, { remainingQuantityBaseUnit: v });
      setQtyEdit(null);
      load();
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  }

  useEffect(() => { load(); }, [filter]);

  const filtered = search.trim()
    ? lots.filter((l) =>
        (l.medicineName || '').toLowerCase().includes(search.toLowerCase()) ||
        (l.lotNumber || '').toLowerCase().includes(search.toLowerCase()) ||
        (l.supplierName || '').toLowerCase().includes(search.toLowerCase())
      )
    : lots;

  const counts = {
    all: lots.length,
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>Stock</h2>
          <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            <Link to="/medicines">→ Aller au catalogue des médicaments</Link> pour ajouter de nouveaux lots
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <button className={'btn ' + (filter === 'all' ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter('all')}>
            Tous les lots actifs
          </button>
          <button className={'btn ' + (filter === 'expiring30' ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter('expiring30')}>
            ⚠️ Périme dans 30j
          </button>
          <button className={'btn ' + (filter === 'expiring90' ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter('expiring90')}>
            Périme dans 90j
          </button>
          <button className={'btn ' + (filter === 'lowStock' ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter('lowStock')}>
            📉 Stock bas
          </button>
          <button className={'btn ' + (filter === 'empty' ? 'btn-primary' : 'btn-secondary')} onClick={() => setFilter('empty')}>
            Inclure lots épuisés
          </button>
        </div>
        <input className="input" placeholder="Rechercher par médicament, numéro de lot, fournisseur…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}>
          {filtered.length} lot{filtered.length > 1 ? 's' : ''}
          {lots.length !== filtered.length ? ` (sur ${lots.length})` : ''}
        </div>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun lot pour les critères sélectionnés.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Médicament</th>
                <th>N° Lot</th>
                <th>Péremption</th>
                <th style={{ textAlign: 'right' }}>Restant</th>
                <th>Fournisseur</th>
                <th>Reçu le</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const badge = expiryBadge(l.expiryDate);
                return (
                  <tr key={l.id} style={{ opacity: l.remainingQuantityBaseUnit > 0 ? 1 : 0.5 }}>
                    <td><strong>{l.medicineName}</strong></td>
                    <td><code>{l.lotNumber}</code></td>
                    <td>
                      {fmtDate(l.expiryDate)}
                      {badge && (
                        <span style={{
                          marginLeft: 8, padding: '2px 8px', borderRadius: 6,
                          background: badge.color + '22', color: badge.color,
                          fontSize: '0.78em', fontWeight: 500,
                        }}>{badge.label}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {qtyEdit?.id === l.id ? (
                        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input
                            className="input"
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            style={{ width: 80, textAlign: 'right', padding: '2px 6px' }}
                            value={qtyEdit.value}
                            onChange={(e) => setQtyEdit({ ...qtyEdit, value: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveQty();
                              if (e.key === 'Escape') setQtyEdit(null);
                            }}
                          />
                          <span style={{ color: '#6b7280' }}>{l.baseUnit}</span>
                          <button className="btn" style={{ color: '#16a34a', padding: '2px 8px' }} onClick={saveQty} title="Valider">✓</button>
                          <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setQtyEdit(null)} title="Annuler">×</button>
                        </span>
                      ) : (
                        <span
                          style={{ cursor: 'pointer' }}
                          title="Cliquer pour corriger la quantité restante (perte, casse, inventaire…)"
                          onClick={() => setQtyEdit({ id: l.id, value: String(l.remainingQuantityBaseUnit) })}
                        >
                          {Number(l.remainingQuantityBaseUnit).toLocaleString('fr-LU')} {l.baseUnit}
                          <span style={{ color: '#9ca3af', fontSize: '0.85em' }}> / {Number(l.initialQuantityBaseUnit).toLocaleString('fr-LU')}</span>
                          {' '}✎
                        </span>
                      )}
                    </td>
                    <td>{l.supplierName || '—'}</td>
                    <td>{fmtDate(l.purchaseDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
