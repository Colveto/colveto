import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import PatientFormModal from '../components/PatientFormModal.jsx';
import ReferringVetField from '../components/ReferringVetField.jsx';
import { useToast } from '../components/Toast.jsx';

const STATUS_LABELS = {
  draft: 'Brouillon',
  sent: 'Envoyée',
  paid: 'Payée',
  cancelled: 'Annulée',
};
const STATUS_COLORS = {
  draft: '#6b7280',
  sent: '#2563eb',
  paid: '#16a34a',
  cancelled: '#dc2626',
};

function fmtCurrency(value) {
  const n = Number(value || 0);
  return n.toLocaleString('fr-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function OwnerDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [owner, setOwner] = useState(null);
  const [patients, setPatients] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);

  const load = () => {
    window.api.owners.get(id).then(setOwner);
    window.api.patients.list(id).then(setPatients);
    window.api.invoices.list().then((all) => {
      setInvoices((all || []).filter((inv) => inv.ownerId === id));
    });
  };
  useEffect(() => { load(); }, [id]);

  const removePatient = async (p) => {
    if (!confirm(`Supprimer définitivement ${p.name} ? Cette action est irréversible (ses actes médicaux et rappels seront aussi supprimés).`)) return;
    try {
      await window.api.patients.delete(p.id);
      showToast('Animal supprimé', 'success');
      load();
    } catch (e) {
      const msg = /FOREIGN KEY|constraint/i.test(e.message)
        ? "Impossible : cet animal a des factures liées. Supprimez les factures d'abord."
        : e.message;
      showToast(msg, 'error');
    }
  };

  const removeOwner = async () => {
    if (patients.length > 0) {
      showToast(`Impossible : ce propriétaire a ${patients.length} animal/animaux. Supprime-les d'abord.`, 'error');
      return;
    }
    if (!confirm(`Supprimer définitivement ${owner.lastName} ${owner.firstName} ? Cette action est irréversible.`)) return;
    try {
      await window.api.owners.delete(owner.id);
      showToast('Propriétaire supprimé', 'success');
      navigate('/owners');
    } catch (e) {
      const msg = /FOREIGN KEY|constraint/i.test(e.message)
        ? 'Impossible : ce propriétaire a des factures ou animaux liés.'
        : e.message;
      showToast(msg, 'error');
    }
  };

  const saveOwner = async () => {
    if (!editing.firstName || !editing.lastName) {
      alert('Prénom et nom requis');
      return;
    }
    try {
      await window.api.owners.update(editing.id, editing);
      setShowEditModal(false);
      showToast('Propriétaire mis à jour', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  if (!owner) return <div>Chargement…</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/owners" className="text-light">← Propriétaires</Link>
          <h2>{owner.lastName} {owner.firstName}</h2>
        </div>
        <div className="flex-row">
          <button className="btn btn-primary" onClick={() => { setEditing(owner); setShowEditModal(true); }}>
            Modifier
          </button>
          <button className="btn btn-danger" onClick={removeOwner}>Supprimer le propriétaire</button>
        </div>
      </div>

      {showEditModal && (
        <Modal
          title="Modifier le propriétaire"
          onClose={() => setShowEditModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowEditModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={saveOwner}>Enregistrer</button>
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

      <div className="card">
        <h3 className="mt-2">Coordonnées</h3>
        <div className="form-row">
          <div><strong>Email:</strong> {owner.email || '—'}</div>
          <div><strong>Téléphone:</strong> {owner.phone || '—'}</div>
        </div>
        <div className="form-row cols-1">
          <div><strong>Adresse:</strong> {[owner.address, owner.postalCode, owner.city].filter(Boolean).join(', ') || '—'}</div>
        </div>
        {owner.notes && <div className="mt-2"><strong>Notes:</strong> {owner.notes}</div>}
        {!!owner.referredByVet && (
          <div className="mt-2" style={{
            background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6,
            padding: '8px 10px', fontSize: 13,
          }}>
            🔗 <strong>Référé par un vétérinaire</strong>
            {owner.referringVetName ? (
              <>
                {' — '}
                <Link to={`/referring-vets/${owner.referringVetId}`}>Dr {owner.referringVetName}</Link>
                {owner.referringVetClinic ? ` (${owner.referringVetClinic})` : ''}
                {owner.referringVetEmail ? ` · ${owner.referringVetEmail}` : ''}
              </>
            ) : ' — vétérinaire non renseigné'}
            <div className="text-light" style={{ marginTop: 4 }}>
              Ses rendez-vous sont limités aux motifs autorisés pour les patients référés.
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="mt-2">Animaux ({patients.length})</h3>
          <button className="btn btn-secondary" onClick={() => setShowNewPatientModal(true)}>+ Nouvel animal</button>
        </div>
        {patients.length === 0 ? (
          <div className="empty-state">Aucun patient enregistré.</div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Nom</th><th>Espèce</th><th>Race</th><th>Sexe</th><th>Né le</th><th></th></tr>
            </thead>
            <tbody>
              {patients.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/patients/${p.id}`}>{p.name}</Link></td>
                  <td>{p.species}</td>
                  <td>{p.breed || '—'}</td>
                  <td>{p.sex || '—'}</td>
                  <td>{fmtDate(p.birthDate)}</td>
                  <td className="text-right">
                    {owner.referringVetId && (
                      <>
                        <Link className="btn btn-sm" to={`/patients/${p.id}?sendTo=${owner.referringVetId}`}
                          title={`Envoyer le dossier de ${p.name} à Dr ${owner.referringVetName}`}>
                          ✉ Au référent
                        </Link>
                        {' '}
                      </>
                    )}
                    <button className="btn btn-sm btn-danger" onClick={() => removePatient(p)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="mt-2">Factures ({invoices.length})</h3>
          <Link to={`/invoices/new?ownerId=${id}`} className="btn btn-primary">+ Nouvelle facture</Link>
        </div>
        {invoices.length === 0 ? (
          <div className="empty-state">Aucune facture pour ce propriétaire.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>N°</th>
                <th>Date</th>
                <th>Animal</th>
                <th style={{ textAlign: 'right' }}>Total TTC</th>
                <th>Statut</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => (
                <tr key={inv.id}>
                  <td><Link to={`/invoices/${inv.id}`}>{inv.number}</Link></td>
                  <td>{fmtDate(inv.date)}</td>
                  <td>{(inv.patientNames?.length ? inv.patientNames.join(', ') : inv.patientName) || '—'}</td>
                  <td style={{ textAlign: 'right' }}>{fmtCurrency(inv.totalTTC)}</td>
                  <td>
                    <span style={{
                      background: (STATUS_COLORS[inv.status] || '#6b7280') + '22',
                      color: STATUS_COLORS[inv.status] || '#6b7280',
                      padding: '2px 8px',
                      borderRadius: 6,
                      fontSize: '0.85em',
                      fontWeight: 500,
                    }}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNewPatientModal && (
        <PatientFormModal
          owners={[owner]}
          initialOwnerId={owner.id}
          lockOwner
          onClose={() => setShowNewPatientModal(false)}
          onSaved={() => {
            setShowNewPatientModal(false);
            showToast('Animal créé', 'success');
            load();
          }}
        />
      )}
    </div>
  );
}
