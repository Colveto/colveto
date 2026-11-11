import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import ReferringVetField from '../components/ReferringVetField.jsx';
import { useToast } from '../components/Toast.jsx';

const empty = {
  firstName: '', lastName: '', email: '', phone: '',
  address: '', city: '', postalCode: '', notes: '',
  referredByVet: 0, referringVetId: null,
};

export default function Owners() {
  const { showToast } = useToast();
  const [owners, setOwners] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(empty);

  const load = () => window.api.owners.list().then(setOwners);
  useEffect(() => { load(); }, []);

  const remove = async (o) => {
    if (o.patientCount > 0) {
      showToast(`Impossible : ce propriétaire a ${o.patientCount} animal/animaux. Supprime-les d'abord.`, 'error');
      return;
    }
    if (!confirm(`Supprimer définitivement ${o.lastName} ${o.firstName} ? Cette action est irréversible.`)) return;
    try {
      await window.api.owners.delete(o.id);
      load();
    } catch (e) {
      const msg = /FOREIGN KEY|constraint/i.test(e.message)
        ? 'Impossible : ce propriétaire a des factures ou animaux liés.'
        : e.message;
      showToast('Erreur : ' + msg, 'error');
    }
  };

  const filtered = owners.filter((o) => {
    const s = search.toLowerCase();
    return !s ||
      o.firstName.toLowerCase().includes(s) ||
      o.lastName.toLowerCase().includes(s) ||
      (o.email || '').toLowerCase().includes(s) ||
      (o.phone || '').includes(s);
  });

  const save = async () => {
    if (!editing.firstName || !editing.lastName) {
      alert('Prénom et nom requis');
      return;
    }
    if (editing.id) await window.api.owners.update(editing.id, editing);
    else await window.api.owners.create(editing);
    setShowModal(false);
    setEditing(empty);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Propriétaires</h2>
        <button className="btn btn-primary" onClick={() => { setEditing(empty); setShowModal(true); }}>
          + Nouveau propriétaire
        </button>
      </div>

      <div className="card">
        <input className="input mb-4" placeholder="Rechercher…"
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 300 }} />
        {filtered.length === 0 ? (
          <div className="empty-state">Aucun propriétaire.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th><th>Email</th><th>Téléphone</th><th>Ville</th>
                <th>Patients</th><th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/owners/${o.id}`}>{o.lastName} {o.firstName}</Link></td>
                  <td>{o.email || '—'}</td>
                  <td>{o.phone || '—'}</td>
                  <td>{o.city || '—'}</td>
                  <td>{o.patientCount}</td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => { setEditing(o); setShowModal(true); }}>
                      Modifier
                    </button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(o)}>
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
        <Modal
          title={editing.id ? 'Modifier le propriétaire' : 'Nouveau propriétaire'}
          onClose={() => setShowModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={save}>Enregistrer</button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Prénom *</label>
              <input className="input" value={editing.firstName}
                onChange={(e) => setEditing({ ...editing, firstName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Nom *</label>
              <input className="input" value={editing.lastName}
                onChange={(e) => setEditing({ ...editing, lastName: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input className="input" type="email" value={editing.email || ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Téléphone</label>
              <input className="input" value={editing.phone || ''}
                onChange={(e) => setEditing({ ...editing, phone: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Adresse</label>
              <input className="input" value={editing.address || ''}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Code postal</label>
              <input className="input" value={editing.postalCode || ''}
                onChange={(e) => setEditing({ ...editing, postalCode: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Ville</label>
              <input className="input" value={editing.city || ''}
                onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
            </div>
          </div>
          <ReferringVetField
            value={editing}
            onChange={(patch) => setEditing({ ...editing, ...patch })}
          />
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Notes</label>
              <textarea className="textarea" value={editing.notes || ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
