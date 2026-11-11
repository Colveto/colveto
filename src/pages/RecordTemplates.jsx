import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { TEMPLATE_VARIABLES, placeholderTabHandler } from '../lib/recordTemplates.js';

const RECORD_TYPES = ['Consultation', 'Vaccination', 'Chirurgie', 'Examen', 'Prescription', 'Autre'];

const blankTemplate = () => ({ name: '', recordType: 'Consultation', title: '', description: '', treatment: '' });

export default function RecordTemplates() {
  const { user } = useAuth();
  const canEdit = user?.role === 'admin' || user?.role === 'veterinarian';
  const [templates, setTemplates] = useState([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      setTemplates(await window.api.recordTemplates.list());
    } catch (e) {
      alert('Erreur de chargement : ' + e.message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      (t.name || '').toLowerCase().includes(q) || (t.recordType || '').toLowerCase().includes(q));
  }, [templates, search]);

  async function remove(t) {
    if (!confirm(`Supprimer le modèle « ${t.name} » ?`)) return;
    try {
      await window.api.recordTemplates.delete(t.id);
      load();
    } catch (e) {
      alert('Erreur : ' + e.message);
    }
  }

  if (editing) {
    return (
      <TemplateEditor
        editing={editing}
        setEditing={setEditing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); load(); }}
      />
    );
  }

  return (
    <div>
      <div className="page-header">
        <h2>Modèles de rapports</h2>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing(blankTemplate())}>+ Nouveau modèle</button>}
      </div>

      <div className="card">
        <input
          className="input"
          placeholder="Rechercher un modèle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: '#6b7280' }}>
          {filtered.length} modèle{filtered.length > 1 ? 's' : ''}
          {templates.length !== filtered.length ? ` (sur ${templates.length})` : ''}
          {' '}— utilisables depuis « + Nouvel acte » dans la fiche d'un animal.
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Chargement…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            Aucun modèle. Créez-en un pour pré-rédiger un compte-rendu que vous n'aurez plus qu'à compléter.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Type d'acte</th>
                <th>Titre</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.recordType || '—'}</td>
                  <td style={{ color: '#475569' }}>{t.title || '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <>
                        <button className="btn btn-secondary" onClick={() => setEditing({ ...t })}>Modifier</button>
                        <button className="btn" style={{ marginLeft: 6 }}
                          onClick={() => setEditing({ ...t, id: undefined, name: `${t.name} (copie)` })}>Dupliquer</button>
                        <button className="btn" style={{ marginLeft: 6, color: '#dc2626' }} onClick={() => remove(t)}>×</button>
                      </>
                    )}
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

function TemplateEditor({ editing, setEditing, onCancel, onSaved }) {
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setEditing({ ...editing, [k]: v });
  const rowsFor = (text, min) => Math.min(24, Math.max(min, String(text || '').split('\n').length + 1));

  async function save() {
    if (!editing.name?.trim()) { alert('Donnez un nom au modèle.'); return; }
    const payload = {
      name: editing.name.trim(),
      recordType: editing.recordType,
      title: editing.title,
      description: editing.description,
      treatment: editing.treatment,
    };
    setSaving(true);
    try {
      if (editing.id) await window.api.recordTemplates.update(editing.id, payload);
      else await window.api.recordTemplates.create(payload);
      onSaved();
    } catch (e) {
      alert('Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2>{editing.id ? 'Modifier le modèle' : 'Nouveau modèle'}</h2>
        <div>
          <button className="btn" onClick={onCancel} disabled={saving}>Annuler</button>
          <button className="btn btn-primary" style={{ marginLeft: 6 }} onClick={save} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>

      <div className="card" style={{ fontSize: '0.85rem', color: '#475569', lineHeight: 1.6 }}>
        <strong>Champs à compléter :</strong> écrivez-les entre crochets, ex. <code>[gauche/droit]</code> ou <code>[..]</code>.
        Dans l'acte, <kbd>Tab</kbd> sélectionne le champ suivant (<kbd>Maj</kbd>+<kbd>Tab</kbd> le précédent) : il suffit de taper pour le remplacer.
        <br />
        <strong>Remplis automatiquement depuis la fiche :</strong>{' '}
        {TEMPLATE_VARIABLES.map((v, i) => (
          <span key={v.key}>{i > 0 && ', '}<code>{`{{${v.key}}}`}</code> ({v.label})</span>
        ))}
        . Une valeur absente de la fiche devient <code>[..]</code>.
      </div>

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Nom du modèle *</label>
            <input className="input" value={editing.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Type d'acte</label>
            <select className="select" value={editing.recordType || ''} onChange={(e) => set('recordType', e.target.value)}>
              {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols-1">
          <div className="form-group">
            <label>Titre de l'acte</label>
            <input className="input" value={editing.title || ''} onKeyDown={(e) => placeholderTabHandler(e)}
              onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Description / examen clinique</label>
            <textarea className="textarea" value={editing.description || ''} rows={rowsFor(editing.description, 8)}
              onKeyDown={(e) => placeholderTabHandler(e)} onChange={(e) => set('description', e.target.value)}
              style={{ fontFamily: 'inherit' }} />
          </div>
          <div className="form-group">
            <label>Traitement / prescription</label>
            <textarea className="textarea" value={editing.treatment || ''} rows={rowsFor(editing.treatment, 5)}
              onKeyDown={(e) => placeholderTabHandler(e)} onChange={(e) => set('treatment', e.target.value)}
              style={{ fontFamily: 'inherit' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
