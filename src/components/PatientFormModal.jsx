import React, { useState } from 'react';
import Modal from './Modal.jsx';
import SearchSelect from './SearchSelect.jsx';

const SPECIES = ['Chien', 'Chat', 'Lapin', 'NAC', 'Oiseau', 'Reptile', 'Cheval', 'Autre'];
const SEX = [{ v: 'M', l: 'Mâle' }, { v: 'F', l: 'Femelle' }];

const emptyPatient = (ownerId) => ({
  ownerId: ownerId || '', name: '', species: 'Chien', breed: '', sex: 'M',
  birthDate: '', weight: '', color: '', microchipId: '',
  sterilized: false, allergies: '', notes: '',
});

// Reusable "create / edit patient" popup. Pass `initialOwnerId` (+ `lockOwner`)
// to open it pre-filled for a known owner (e.g. from the owner's own page).
export default function PatientFormModal({ owners, initialOwnerId, patient, lockOwner, onClose, onSaved }) {
  const [editing, setEditing] = useState(() => patient
    ? { ...patient, sterilized: !!patient.sterilized, weight: patient.weight ?? '' }
    : emptyPatient(initialOwnerId));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!editing.ownerId || !editing.name) {
      alert('Propriétaire et nom requis');
      return;
    }
    setSaving(true);
    try {
      const data = { ...editing, weight: editing.weight ? parseFloat(editing.weight) : null };
      const saved = editing.id
        ? await window.api.patients.update(editing.id, data)
        : await window.api.patients.create(data);
      onSaved(saved);
    } catch (e) {
      alert('Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={editing.id ? 'Modifier le patient' : 'Nouveau patient'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>Enregistrer</button>
        </>
      }
    >
      <div className="form-row">
        <div className="form-group">
          <label>Propriétaire *</label>
          <SearchSelect
            value={editing.ownerId}
            onChange={(id) => setEditing({ ...editing, ownerId: id })}
            options={owners.map((o) => ({
              id: o.id,
              label: `${o.lastName} ${o.firstName}`,
              sub: [o.email, o.phone].filter(Boolean).join(' · ') || null,
              keywords: `${o.email || ''} ${o.phone || ''} ${o.city || ''}`,
            }))}
            placeholder="Rechercher un propriétaire…"
            disabled={lockOwner}
          />
        </div>
        <div className="form-group">
          <label>Nom *</label>
          <input className="input" value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus />
        </div>
      </div>
      <div className="form-row cols-3">
        <div className="form-group">
          <label>Espèce *</label>
          <select className="select" value={editing.species}
            onChange={(e) => setEditing({ ...editing, species: e.target.value })}>
            {SPECIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Race</label>
          <input className="input" value={editing.breed || ''}
            onChange={(e) => setEditing({ ...editing, breed: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Sexe</label>
          <select className="select" value={editing.sex || ''}
            onChange={(e) => setEditing({ ...editing, sex: e.target.value })}>
            <option value="">—</option>
            {SEX.map((s) => <option key={s.v} value={s.v}>{s.l}</option>)}
          </select>
        </div>
      </div>
      <div className="form-row cols-3">
        <div className="form-group">
          <label>Date de naissance</label>
          <input className="input" type="date" value={editing.birthDate || ''}
            onChange={(e) => setEditing({ ...editing, birthDate: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Poids (kg)</label>
          <input className="input" type="number" step="0.1" value={editing.weight || ''}
            onChange={(e) => setEditing({ ...editing, weight: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Couleur</label>
          <input className="input" value={editing.color || ''}
            onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label>N° de puce</label>
          <input className="input" value={editing.microchipId || ''}
            onChange={(e) => setEditing({ ...editing, microchipId: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Stérilisé</label>
          <select className="select" value={editing.sterilized ? '1' : '0'}
            onChange={(e) => setEditing({ ...editing, sterilized: e.target.value === '1' })}>
            <option value="0">Non</option>
            <option value="1">Oui</option>
          </select>
        </div>
      </div>
      <div className="form-row cols-1">
        <div className="form-group">
          <label>Allergies</label>
          <input className="input" value={editing.allergies || ''}
            onChange={(e) => setEditing({ ...editing, allergies: e.target.value })} />
        </div>
        <div className="form-group">
          <label>Notes</label>
          <textarea className="textarea" value={editing.notes || ''}
            onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
        </div>
      </div>
    </Modal>
  );
}
