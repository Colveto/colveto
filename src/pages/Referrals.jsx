import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '../components/Toast.jsx';

export const STATUS_LABELS = {
  submitted: 'Dossier reçu',
  under_review: 'En cours d’évaluation',
  scheduled: 'RDV programmé',
  in_treatment: 'Prise en charge en cours',
  completed: 'Soins terminés',
  declined: 'Non retenu',
};
export const STATUS_COLORS = {
  submitted: '#2563eb',
  under_review: '#f59e0b',
  scheduled: '#0891b2',
  in_treatment: '#7c3aed',
  completed: '#16a34a',
  declined: '#6b7280',
};

export function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
      fontSize: '0.78rem', fontWeight: 600, color, background: `${color}1a`,
    }}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function Referrals() {
  const { showToast } = useToast();
  const [cases, setCases] = useState([]);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    window.api.referrals.list({ status: status || undefined, search: search || undefined })
      .then(setCases)
      .finally(() => setLoading(false));
  };
  useEffect(load, [status, search]);

  const remove = async (c) => {
    if (!confirm(`Supprimer définitivement le dossier ${c.reference} (${c.patientName}) ? Le vétérinaire référent perdra l'accès à son lien de suivi. Cette action est irréversible.`)) return;
    try {
      await window.api.referrals.remove(c.id);
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Dossiers référés</h2>
      </div>

      <div className="card">
        <div className="flex-row mb-4" style={{ gap: 10 }}>
          <input className="input" placeholder="Rechercher (patient, vétérinaire, référence)…"
            value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 320 }} />
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
            <option value="">Tous les statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="empty-state">Chargement…</div>
        ) : cases.length === 0 ? (
          <div className="empty-state">Aucun dossier reçu pour l'instant.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Référence</th><th>Patient</th><th>Vétérinaire référent</th>
                <th>Clinique</th><th>Statut</th><th>Reçu le</th><th></th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.id}>
                  <td>{c.reference}</td>
                  <td>{c.patientName}</td>
                  <td>Dr {c.referringVetName}</td>
                  <td>{c.referringVetClinic || '—'}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td className="text-right">
                    <Link className="btn btn-sm" to={`/referrals/${c.id}`}>Ouvrir</Link>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(c)}>Supprimer</button>
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
