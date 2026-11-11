import React, { useEffect, useState } from 'react';
import Modal from '../components/Modal.jsx';
import { ROLES, useAuth } from '../context/AuthContext.jsx';

const empty = {
  fullName: '', username: '', email: '', password: '',
  role: 'assistant', active: true,
};

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(empty);

  const load = () => window.api.users.list().then(setUsers);
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(empty); setShowModal(true); };
  const openEdit = (u) => { setEditing({ ...u, password: '', active: !!u.active }); setShowModal(true); };

  const save = async () => {
    if (!editing.fullName || !editing.username) { alert('Nom et identifiant requis'); return; }
    if (!editing.id && !editing.password) { alert('Mot de passe requis'); return; }
    if (editing.password && editing.password.length < 6) { alert('Mot de passe trop court (min 6 caractères)'); return; }
    if (editing.id) {
      const data = { ...editing };
      if (!data.password) delete data.password;
      await window.api.users.update(editing.id, data);
    } else {
      await window.api.users.create(editing);
    }
    setShowModal(false);
    load();
  };

  const remove = async (u) => {
    if (u.id === currentUser.id) { alert('Vous ne pouvez pas supprimer votre propre compte.'); return; }
    if (!confirm(`Supprimer l'utilisateur ${u.fullName} ?`)) return;
    await window.api.users.delete(u.id);
    load();
  };

  return (
    <div>
      <div className="page-header">
        <h2>Utilisateurs</h2>
        <button className="btn btn-primary" onClick={openNew}>+ Nouvel utilisateur</button>
      </div>

      <div className="card">
        {users.length === 0 ? (
          <div className="empty-state">Aucun utilisateur.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th><th>Identifiant</th><th>Rôle</th>
                <th>Email</th><th>Statut</th><th>Dernière connexion</th><th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="font-bold">
                    {u.fullName}
                    {u.id === currentUser.id && <span className="text-light"> (vous)</span>}
                  </td>
                  <td>{u.username}</td>
                  <td><span className="badge badge-scheduled">{ROLES[u.role]?.label || u.role}</span></td>
                  <td>{u.email || '—'}</td>
                  <td>
                    {u.active ? (
                      <span className="badge badge-paid">Actif</span>
                    ) : (
                      <span className="badge badge-cancelled">Désactivé</span>
                    )}
                  </td>
                  <td>{u.lastLogin ? new Date(u.lastLogin).toLocaleString('fr-FR') : '—'}</td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => openEdit(u)}>Modifier</button>
                    {u.id !== currentUser.id && (
                      <button className="btn btn-sm btn-danger" style={{ marginLeft: 4 }}
                        onClick={() => remove(u)}>Supprimer</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal
          title={editing.id ? `Modifier ${editing.fullName}` : 'Nouvel utilisateur'}
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
              <label>Nom complet *</label>
              <input className="input" value={editing.fullName}
                onChange={(e) => setEditing({ ...editing, fullName: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Identifiant *</label>
              <input className="input" value={editing.username}
                onChange={(e) => setEditing({ ...editing, username: e.target.value.toLowerCase() })}
                disabled={!!editing.id}
                pattern="[-a-zA-Z0-9._]+" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email</label>
              <input className="input" type="email" value={editing.email || ''}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Rôle *</label>
              <select className="select" value={editing.role}
                onChange={(e) => setEditing({ ...editing, role: e.target.value })}
                disabled={editing.id === currentUser.id}>
                {Object.entries(ROLES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{editing.id ? 'Nouveau mot de passe (laisser vide si inchangé)' : 'Mot de passe *'}</label>
              <input className="input" type="password" value={editing.password || ''}
                onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                placeholder={editing.id ? 'Laisser vide pour ne pas changer' : ''} />
            </div>
            <div className="form-group">
              <label>Statut</label>
              <select className="select" value={editing.active ? '1' : '0'}
                onChange={(e) => setEditing({ ...editing, active: e.target.value === '1' })}
                disabled={editing.id === currentUser.id}>
                <option value="1">Actif</option>
                <option value="0">Désactivé</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      <div className="card" style={{ background: '#f9fafb' }}>
        <h3 className="mt-2" style={{ marginTop: 0 }}>Permissions par rôle</h3>
        <table className="table" style={{ background: 'transparent' }}>
          <thead>
            <tr>
              <th>Fonction</th>
              <th className="text-center">Administrateur</th>
              <th className="text-center">Vétérinaire</th>
              <th className="text-center">Assistant(e)</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Agenda</td><td className="text-center">✓</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
            <tr><td>Propriétaires & patients</td><td className="text-center">✓</td><td className="text-center">✓</td><td className="text-center">✓</td></tr>
            <tr><td>Facturation</td><td className="text-center">✓</td><td className="text-center">✓</td><td className="text-center">—</td></tr>
            <tr><td>Export Sage</td><td className="text-center">✓</td><td className="text-center">✓</td><td className="text-center">—</td></tr>
            <tr><td>Paramètres du cabinet</td><td className="text-center">✓</td><td className="text-center">—</td><td className="text-center">—</td></tr>
            <tr><td>Gestion des utilisateurs</td><td className="text-center">✓</td><td className="text-center">—</td><td className="text-center">—</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
