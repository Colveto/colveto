import React, { useEffect, useState } from 'react';
import SearchSelect from './SearchSelect.jsx';
import { useToast } from './Toast.jsx';

// Bloc « Référé par un vétérinaire » d'une fiche client : la case à cocher et,
// quand elle est cochée, le choix du confrère dans le répertoire (avec création
// à la volée, sans quitter le formulaire).
//
// `value` porte les deux champs de la fiche propriétaire : referredByVet (0/1)
// et referringVetId. Cocher la case sans choisir de vétérinaire reste permis —
// on ne connaît pas toujours le nom au moment de créer la fiche — mais la
// restriction des motifs de rendez-vous, elle, s'applique dès que la case est
// cochée.
export default function ReferringVetField({ value, onChange }) {
  const { showToast } = useToast();
  const [vets, setVets] = useState([]);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const checked = !!value.referredByVet;

  const loadVets = () => window.api.referringVets.list().then(setVets).catch(() => {});
  useEffect(() => { loadVets(); }, []);

  const createVet = async () => {
    if (!draft.name.trim()) {
      showToast('Le nom du vétérinaire est obligatoire', 'error');
      return;
    }
    setSaving(true);
    try {
      const vet = await window.api.referringVets.create(draft);
      await loadVets();
      onChange({ referredByVet: 1, referringVetId: vet.id });
      setDraft(null);
      showToast(`Fiche créée pour ${vet.name}`, 'success');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="form-row cols-1">
      <div className="form-group">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked
              ? { referredByVet: 1, referringVetId: value.referringVetId || null }
              : { referredByVet: 0, referringVetId: null })}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          Référé par un vétérinaire
        </label>

        {checked && (
          <div style={{ marginTop: 8 }}>
            {draft ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 10 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nom du vétérinaire *</label>
                    <input className="input" autoFocus value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Clinique</label>
                    <input className="input" value={draft.clinic}
                      onChange={(e) => setDraft({ ...draft, clinic: e.target.value })} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Email</label>
                    <input className="input" type="email" value={draft.email}
                      onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Téléphone</label>
                    <input className="input" value={draft.phone}
                      onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                  </div>
                </div>
                <div className="flex-row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-sm" disabled={saving} onClick={() => setDraft(null)}>Annuler</button>
                  <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={createVet}>
                    {saving ? 'Création…' : 'Créer la fiche'}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <SearchSelect
                  value={value.referringVetId || ''}
                  onChange={(id) => onChange({ referredByVet: 1, referringVetId: id || null })}
                  options={vets.map((v) => ({
                    id: v.id,
                    label: v.name,
                    sub: [v.clinic, v.email].filter(Boolean).join(' · ') || null,
                    keywords: `${v.clinic || ''} ${v.email || ''} ${v.city || ''}`,
                  }))}
                  placeholder="Rechercher un vétérinaire référent…"
                  onCreate={(query) => setDraft({ name: query || '', clinic: '', email: '', phone: '' })}
                  createLabel="Nouveau vétérinaire référent"
                />
                <small className="text-light">
                  Ce client ne pourra prendre que les motifs de rendez-vous autorisés pour les
                  patients référés (réglés dans Paramètres → Types de rendez-vous).
                </small>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
