import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';

const emptyVet = {
  name: '', clinic: '', email: '', phone: '',
  address: '', postalCode: '', city: '', notes: '', active: 1,
};

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function ReferringVets() {
  const { showToast } = useToast();
  const [vets, setVets] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    window.api.referringVets.list({ search: search || undefined })
      .then(setVets)
      .finally(() => setLoading(false));
  };
  useEffect(load, [search]);

  const save = async () => {
    if (!editing.name.trim()) {
      showToast('Le nom du vétérinaire est obligatoire', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing.id) await window.api.referringVets.update(editing.id, editing);
      else await window.api.referringVets.create(editing);
      setEditing(null);
      showToast('Vétérinaire enregistré', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (v) => {
    const linked = (v.caseCount || 0) + (v.clientCount || 0);
    const warn = linked > 0
      ? `\n\n${v.caseCount || 0} dossier(s) et ${v.clientCount || 0} fiche(s) client lui sont rattachés : ils seront conservés mais perdront ce lien.`
      : '';
    if (!confirm(`Supprimer définitivement la fiche de ${v.name} ?${warn}`)) return;
    try {
      await window.api.referringVets.remove(v.id);
      showToast('Fiche supprimée', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>Vétérinaires référents</h2>
        <button className="btn btn-primary" onClick={() => setEditing({ ...emptyVet })}>
          + Nouveau vétérinaire
        </button>
      </div>

      <div className="card">
        <p className="text-light" style={{ marginTop: 0 }}>
          Répertoire des confrères qui nous adressent des cas. Les demandes reçues par le
          portail créent la fiche automatiquement ; celles reçues par mail ou par téléphone
          s'ajoutent ici à la main.
        </p>
        <input className="input mb-4" placeholder="Rechercher (nom, clinique, email, ville)…"
          value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 360 }} />

        {loading ? (
          <div className="empty-state">Chargement…</div>
        ) : vets.length === 0 ? (
          <div className="empty-state">
            {search ? 'Aucun vétérinaire ne correspond à cette recherche.' : 'Aucun vétérinaire référent enregistré.'}
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Vétérinaire</th>
                <th>Clinique</th>
                <th>Contact</th>
                <th style={{ textAlign: 'center' }}>Patients référés</th>
                <th>Dernier envoi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vets.map((v) => (
                <tr key={v.id} style={v.active ? undefined : { opacity: 0.55 }}>
                  <td>
                    <Link to={`/referring-vets/${v.id}`}>Dr {v.name}</Link>
                    {!v.active && <span className="text-light"> (inactif)</span>}
                  </td>
                  <td>{v.clinic || '—'}</td>
                  <td style={{ fontSize: 13 }}>
                    {v.email || '—'}
                    {v.phone && <div className="text-light">{v.phone}</div>}
                  </td>
                  <td style={{ textAlign: 'center' }}>{(v.caseCount || 0) + (v.clientCount || 0)}</td>
                  <td>{fmtDate(v.lastSentAt)}</td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => setEditing(v)}>Modifier</button>
                    {' '}
                    <button className="btn btn-sm btn-danger" onClick={() => remove(v)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <Modal
          title={editing.id ? `Modifier ${editing.name}` : 'Nouveau vétérinaire référent'}
          onClose={() => !saving && setEditing(null)}
          footer={
            <>
              <button className="btn" disabled={saving} onClick={() => setEditing(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={saving} onClick={save}>
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          }
        >
          <div className="form-row">
            <div className="form-group">
              <label>Nom *</label>
              <input className="input" autoFocus value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Clinique</label>
              <input className="input" value={editing.clinic || ''}
                onChange={(e) => setEditing({ ...editing, clinic: e.target.value })} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input className="input" type="email" value={editing.email || ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              <small className="text-light">Destinataire des dossiers et radios envoyés depuis la fiche patient.</small>
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
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Notes</label>
              <textarea className="textarea" value={editing.notes || ''}
                onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={!!editing.active}
                  onChange={(e) => setEditing({ ...editing, active: e.target.checked ? 1 : 0 })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }} />
                Actif
              </label>
              <small className="text-light">
                Un confrère inactif reste dans l'historique mais passe en fin de liste.
              </small>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
