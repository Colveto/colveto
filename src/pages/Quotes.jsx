import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export const QUOTE_STATUS_LABELS = {
  draft: 'Brouillon', sent: 'Envoyé', accepted: 'Accepté', refused: 'Refusé', invoiced: 'Facturé',
};

export default function Quotes() {
  const [quotes, setQuotes] = useState([]);
  const [filter, setFilter] = useState('');

  useEffect(() => { window.api.quotes.list().then(setQuotes); }, []);

  const filtered = filter ? quotes.filter((q) => q.status === filter) : quotes;
  const totalTTC = filtered.reduce((s, q) => s + (q.status !== 'refused' ? q.totalTTC : 0), 0);

  return (
    <div>
      <div className="page-header">
        <h2>Devis</h2>
        <Link to="/quotes/new" className="btn btn-primary">+ Nouveau devis</Link>
      </div>

      <div className="card">
        <div className="flex-row mb-4">
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Tous les statuts</option>
            {Object.entries(QUOTE_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>{label}</option>
            ))}
          </select>
          <div className="text-light">Total filtré: <strong>{totalTTC.toFixed(2)} €</strong></div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">Aucun devis.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Numéro</th><th>Date</th><th>Client</th><th>Patient</th>
                <th>Statut</th><th className="text-right">Montant TTC</th><th>Facture</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((q) => (
                <tr key={q.id}>
                  <td><Link to={`/quotes/${q.id}`}>{q.number}</Link></td>
                  <td>{q.date}</td>
                  <td>{q.ownerLastName} {q.ownerFirstName}</td>
                  <td>{(q.patientNames?.length ? q.patientNames.join(', ') : q.patientName) || '—'}</td>
                  <td><span className={`badge badge-${q.status}`}>{QUOTE_STATUS_LABELS[q.status]}</span></td>
                  <td className="text-right font-bold">{q.totalTTC.toFixed(2)} €</td>
                  <td>{q.invoiceId ? <Link to={`/invoices/${q.invoiceId}`}>{q.invoiceNumber}</Link> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
