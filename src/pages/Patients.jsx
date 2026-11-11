import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SearchSelect from '../components/SearchSelect.jsx';
import PatientFormModal from '../components/PatientFormModal.jsx';
import { useToast } from '../components/Toast.jsx';

export default function Patients() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const prefilledOwnerId = searchParams.get('ownerId') || '';
  const [patients, setPatients] = useState([]);
  const [owners, setOwners] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(!!prefilledOwnerId);
  const [editing, setEditing] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [assignSel, setAssignSel] = useState({});

  const load = () => window.api.patients.list().then(setPatients);
  const loadUnmatched = () => window.api.lab.listUnmatched().then(setUnmatched).catch(() => {});
  useEffect(() => {
    load();
    loadUnmatched();
    window.api.owners.list().then(setOwners);
  }, []);

  const fmtDt = (v) => {
    if (!v) return '';
    const d = new Date(v);
    return isNaN(d) ? v : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const assignUnmatched = async (resultId) => {
    const pid = assignSel[resultId];
    if (!pid) { showToast('Choisissez d\'abord un patient', 'warning'); return; }
    try {
      await window.api.lab.assign(resultId, pid);
      showToast('Analyse rattachée au patient', 'success');
      loadUnmatched();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const remove = async (p) => {
    if (!confirm(`Supprimer définitivement ${p.name} ? Cette action est irréversible (ses actes médicaux et rappels seront aussi supprimés).`)) return;
    try {
      await window.api.patients.delete(p.id);
      load();
    } catch (e) {
      const msg = /FOREIGN KEY|constraint/i.test(e.message)
        ? 'Impossible : ce patient a des factures liées. Supprimez les factures d\'abord.'
        : e.message;
      showToast('Erreur : ' + msg, 'error');
    }
  };

  const filtered = patients.filter((p) => {
    const s = search.toLowerCase();
    return !s ||
      p.name.toLowerCase().includes(s) ||
      p.species.toLowerCase().includes(s) ||
      (p.breed || '').toLowerCase().includes(s) ||
      `${p.ownerLastName} ${p.ownerFirstName}`.toLowerCase().includes(s);
  });

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    if (prefilledOwnerId) setSearchParams((p) => { p.delete('ownerId'); return p; }, { replace: true });
  };
  const onSaved = () => {
    closeModal();
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Patients (animaux)</h2>
        <button className="btn btn-primary" onClick={() => { setEditing(null); setShowModal(true); }}>
          + Nouveau patient
        </button>
      </div>

      {unmatched.length > 0 && (
        <div className="card" style={{ background: '#fff7ed', border: '1px solid #fed7aa' }}>
          <h3 className="mt-2" style={{ marginTop: 0 }}>🔬 Analyses non rattachées ({unmatched.length})</h3>
          <p className="text-light" style={{ marginTop: 0 }}>
            Ces résultats reçus du laboratoire n'ont pas pu être associés automatiquement à un patient.
            Choisissez le patient correspondant et rattachez-les.
          </p>
          {unmatched.map((u) => (
            <div key={u.id} style={{
              display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0',
              borderTop: '1px solid #fed7aa', flexWrap: 'wrap',
            }}>
              <div style={{ flex: '1 1 260px', fontSize: 13 }}>
                <strong>{u.patientName || '—'}</strong>
                {u.clientLastName ? ` · propriétaire ${u.clientLastName}` : ''}
                <div className="text-light" style={{ fontSize: 12 }}>
                  {[u.instrument, fmtDt(u.runDate), `${u.assays.length} paramètre(s)`].filter(Boolean).join(' · ')}
                </div>
              </div>
              <div style={{ flex: '1 1 240px' }}>
                <SearchSelect
                  value={assignSel[u.id] || ''}
                  onChange={(pid) => setAssignSel((s) => ({ ...s, [u.id]: pid }))}
                  options={patients.map((p) => ({
                    id: p.id,
                    label: `${p.name} (${p.species})`,
                    sub: `${p.ownerLastName} ${p.ownerFirstName}`,
                    keywords: `${p.ownerLastName} ${p.ownerFirstName} ${p.breed || ''}`,
                  }))}
                  placeholder="Choisir un patient…"
                />
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => assignUnmatched(u.id)}>Rattacher</button>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <input className="input mb-4" placeholder="Rechercher…"
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun patient.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th><th>Espèce</th><th>Race</th><th>Sexe</th>
                <th>Propriétaire</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/patients/${p.id}`}>{p.name}</Link></td>
                  <td>{p.species}</td>
                  <td>{p.breed || '—'}</td>
                  <td>{p.sex || '—'}</td>
                  <td>{p.ownerLastName} {p.ownerFirstName}</td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => {
                      setEditing(p);
                      setShowModal(true);
                    }}>
                      Modifier
                    </button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(p)}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <PatientFormModal
          owners={owners}
          patient={editing}
          initialOwnerId={prefilledOwnerId}
          onClose={closeModal}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
