import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PaymentMethodModal, { PAYMENT_METHODS } from '../components/PaymentMethodModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';

const STATUS_LABELS = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', cancelled: 'Annulée',
};

export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [filter, setFilter] = useState('');
  const [paying, setPaying] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [validating, setValidating] = useState(false);
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'admin';

  const load = () => window.api.invoices.list().then((list) => {
    setInvoices(list);
    // On ne garde sélectionnés que les brouillons encore présents.
    setSelected((prev) => new Set(list.filter((i) => i.status === 'draft' && prev.has(i.id)).map((i) => i.id)));
  });
  useEffect(() => { load(); }, []);

  const filtered = filter ? invoices.filter((i) => i.status === filter) : invoices;
  const totalTTC = filtered.reduce((s, i) => s + (i.status !== 'cancelled' ? i.totalTTC : 0), 0);
  const visibleDrafts = filtered.filter((i) => i.status === 'draft');
  const allDraftsSelected = visibleDrafts.length > 0 && visibleDrafts.every((i) => selected.has(i.id));

  const setStatus = async (id, status, paymentMethod) => {
    try {
      const result = await window.api.invoices.updateStatus(id, status, paymentMethod);
      if (result?.fiduciaryEmailError) showToast(result.fiduciaryEmailError, 'error');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    load();
  };

  const setDraftPayment = async (id, paymentMethod) => {
    try {
      await window.api.invoices.setPayment(id, paymentMethod || null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    load();
  };

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAllDrafts = () => setSelected(allDraftsSelected ? new Set() : new Set(visibleDrafts.map((i) => i.id)));

  const validateSelected = async () => {
    const chosen = invoices.filter((i) => selected.has(i.id));
    const paid = chosen.filter((i) => i.paymentMethod).length;
    const msg = `Valider ${chosen.length} facture${chosen.length > 1 ? 's' : ''} ?\n\n`
      + `${paid} avec paiement noté → payée${paid > 1 ? 's' : ''}\n`
      + `${chosen.length - paid} sans paiement → envoyée${chosen.length - paid > 1 ? 's' : ''}\n\n`
      + 'Elles reçoivent leur numéro définitif, ne pourront plus être modifiées ni supprimées, '
      + 'et partent par e-mail aux clients qui ont une adresse.';
    if (!confirm(msg)) return;
    setValidating(true);
    try {
      // Ordre chronologique : les numéros suivent les dates des factures.
      const ids = [...chosen].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((i) => i.id);
      const { validated, errors } = await window.api.invoices.validate(ids);
      const sent = validated.filter((v) => v.sentTo).length;
      if (validated.length) {
        showToast(`${validated.length} facture${validated.length > 1 ? 's' : ''} validée${validated.length > 1 ? 's' : ''}, `
          + `${sent} envoyée${sent > 1 ? 's' : ''} au client ✓`, 'success');
      }
      for (const e of errors) showToast(`${e.number || 'Facture'} : ${e.error}`, 'error');
      setSelected(new Set());
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setValidating(false);
      load();
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Facturation</h2>
        <Link to="/invoices/new" className="btn btn-primary">+ Nouvelle facture</Link>
      </div>

      <div className="card">
        <div className="flex-row mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
          <select className="select" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 200 }}>
            <option value="">Tous les statuts</option>
            <option value="draft">Brouillons</option>
            <option value="sent">Envoyées</option>
            <option value="paid">Payées</option>
            <option value="cancelled">Annulées</option>
          </select>
          <div className="text-light">Total filtré: <strong>{totalTTC.toFixed(2)} €</strong></div>
          {isAdmin && (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }}
              disabled={selected.size === 0 || validating} onClick={validateSelected}>
              {validating ? 'Validation…' : `✓ Valider la sélection (${selected.size})`}
            </button>
          )}
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">Aucune facture.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                {isAdmin && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" title="Sélectionner tous les brouillons" disabled={visibleDrafts.length === 0}
                      checked={allDraftsSelected} onChange={toggleAllDrafts} />
                  </th>
                )}
                <th>Numéro</th><th>Date</th><th>Client</th><th>Patient</th>
                <th>Statut</th><th>Paiement</th><th className="text-right">Montant TTC</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id}>
                  {isAdmin && (
                    <td>
                      {i.status === 'draft' && (
                        <input type="checkbox" checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                      )}
                    </td>
                  )}
                  <td style={{ whiteSpace: 'nowrap' }}><Link to={`/invoices/${i.id}`}>{i.number}</Link></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{i.date}</td>
                  <td>{i.ownerLastName} {i.ownerFirstName}</td>
                  <td>{(i.patientNames?.length ? i.patientNames.join(', ') : i.patientName) || '—'}</td>
                  <td><span className={`badge badge-${i.status}`}>{STATUS_LABELS[i.status]}</span></td>
                  <td>
                    {i.status === 'draft' ? (
                      <select className="select" value={i.paymentMethod || ''} style={{ padding: '2px 6px', fontSize: '0.85em', width: 'auto', minWidth: 140 }}
                        onChange={(e) => setDraftPayment(i.id, e.target.value)}>
                        <option value="">— Non payée —</option>
                        {Object.entries(PAYMENT_METHODS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    ) : (i.status === 'paid' && PAYMENT_METHODS[i.paymentMethod]) || <span className="text-light">—</span>}
                  </td>
                  <td className="text-right font-bold">{i.totalTTC.toFixed(2)} €</td>
                  <td className="text-right">
                    {i.status === 'sent' && (
                      <button className="btn btn-sm btn-primary" onClick={() => setPaying(i)}>
                        Marquer payée
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {paying && (
        <PaymentMethodModal
          invoiceNumber={paying.number}
          onClose={() => setPaying(null)}
          onConfirm={async (method) => { await setStatus(paying.id, 'paid', method); setPaying(null); }}
        />
      )}
    </div>
  );
}
