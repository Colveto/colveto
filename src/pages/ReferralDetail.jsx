import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import { useToast } from '../components/Toast.jsx';
import { STATUS_LABELS, StatusBadge } from './Referrals.jsx';

const FILE_CATEGORY_LABELS = { referral_letter: 'Dossier', radiograph: 'Radio', other: 'Autre' };
const EVENT_LABELS = {
  submitted: 'Dossier soumis',
  status_changed: 'Statut modifié',
  note: 'Note',
  linked_to_patient: 'Lié à un patient',
  link_resent: 'Lien renvoyé',
};

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReferralDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [kase, setKase] = useState(null);
  const [patients, setPatients] = useState([]);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkMode, setLinkMode] = useState('existing'); // 'existing' | 'new'
  const [linkPatientId, setLinkPatientId] = useState('');
  const [newPatient, setNewPatient] = useState(null);
  const [statusForm, setStatusForm] = useState({ status: '', note: '', notifyVet: true, visibleToReferrer: true });
  const [busy, setBusy] = useState(false);

  const load = () => {
    window.api.referrals.get(id).then((k) => {
      setKase(k);
      setStatusForm((f) => ({ ...f, status: k.status }));
    });
  };
  useEffect(load, [id]);
  useEffect(() => { window.api.patients.list().then(setPatients); }, []);

  if (!kase) return <div>Chargement…</div>;

  const openLinkModal = () => {
    setNewPatient({
      owner: { firstName: kase.ownerFirstName || '', lastName: kase.ownerLastName || '', email: kase.ownerEmail || '', phone: kase.ownerPhone || '' },
      patient: { name: kase.patientName || '', species: kase.species || '', breed: kase.breed || '', sex: kase.sex || '', birthDate: kase.birthDate || '', weight: kase.weight || '' },
    });
    setLinkMode('existing');
    setLinkPatientId('');
    setShowLinkModal(true);
  };

  const confirmLink = async () => {
    setBusy(true);
    try {
      if (linkMode === 'existing') {
        if (!linkPatientId) { showToast('Choisissez un patient', 'error'); setBusy(false); return; }
        // Ouvrir le dossier d'un patient existant à une adresse inconnue : le
        // formulaire public ne vérifie pas qui l'a rempli.
        const t = kase.emailTrust;
        if (t && !t.known && !confirm(
          `⚠ ${kase.referringVetEmail} n'est pas encore connue du cabinet (${t.reason})\n\n`
          + `Rattacher ce dossier lui donnera accès au dossier médical complet de ce patient (actes, analyses, fichiers).\n\n`
          + `Confirmez uniquement si vous avez vérifié cette adresse auprès du confrère.`
        )) { setBusy(false); return; }
        await window.api.referrals.link(kase.id, { patientId: linkPatientId, confirmUnknownEmail: !!(t && !t.known) });
      } else {
        await window.api.referrals.link(kase.id, { createPatient: newPatient });
      }
      showToast('Dossier lié au patient', 'success');
      setShowLinkModal(false);
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const submitStatus = async () => {
    setBusy(true);
    try {
      await window.api.referrals.updateStatus(kase.id, statusForm);
      showToast('Statut mis à jour', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const resendLink = async () => {
    if (!confirm('Renvoyer un nouveau lien de suivi au vétérinaire référent ? L\'ancien lien sera invalidé.')) return;
    try {
      await window.api.referrals.resendLink(kase.id);
      showToast('Lien renvoyé par email', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const revokeTokens = async () => {
    if (!confirm('Révoquer tous les liens actifs pour ce dossier ? Le vétérinaire référent ne pourra plus y accéder.')) return;
    try {
      await window.api.referrals.revokeTokens(kase.id);
      showToast('Liens révoqués', 'success');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const removeCase = async () => {
    if (!confirm(`Supprimer définitivement le dossier ${kase.reference} (${kase.patientName}) ? Le vétérinaire référent perdra l'accès à son lien de suivi. Cette action est irréversible.`)) return;
    try {
      await window.api.referrals.remove(kase.id);
      showToast('Dossier supprimé', 'success');
      navigate('/referrals');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openFile = async (fileId) => {
    try {
      const url = await window.api.referrals.fileObjectUrl(kase.id, fileId);
      window.open(url, '_blank');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/referrals" style={{ fontSize: '0.85rem', color: '#6b7280' }}>&larr; Vétérinaires référents</Link>
          <h2 style={{ margin: '4px 0 0' }}>{kase.reference} — {kase.patientName}</h2>
        </div>
        <StatusBadge status={kase.status} />
      </div>

      <div className="card mb-4">
        <h3>Vétérinaire référent</h3>
        <div className="form-row">
          <div><strong>Dr {kase.referringVetName}</strong>{kase.referringVetClinic ? ` — ${kase.referringVetClinic}` : ''}</div>
        </div>
        <div className="text-light">{kase.referringVetEmail}{kase.referringVetPhone ? ` · ${kase.referringVetPhone}` : ''}</div>
        {kase.emailTrust && !kase.emailTrust.known && (
          <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginTop: 10, fontSize: 13 }}>
            ⚠ <strong>Adresse non vérifiée.</strong> {kase.emailTrust.reason}
            {kase.emailTrust.freemail && ' Adresse de messagerie gratuite, pas celle d\'une clinique.'}
            {' '}Le formulaire en ligne ne contrôle pas l'identité de l'expéditeur : avant de rattacher ce dossier à un patient existant,
            vérifiez cette adresse auprès du confrère (téléphone, annuaire).
          </div>
        )}
      </div>

      <div className="card mb-4">
        <h3>Patient</h3>
        {kase.patientId ? (
          <div>
            Lié à <Link to={`/patients/${kase.patientId}`}>{kase.patientName}</Link>
          </div>
        ) : (
          <div>
            <div className="text-light mb-4">
              {kase.patientName} — {kase.species || '?'} {kase.breed ? `(${kase.breed})` : ''}
              {kase.ownerFirstName ? ` — propriétaire : ${kase.ownerFirstName} ${kase.ownerLastName || ''}` : ''}
            </div>
            <button className="btn btn-primary" onClick={openLinkModal}>Lier à un patient</button>
          </div>
        )}
        {kase.reasonForReferral && (
          <div className="mt-4"><strong>Motif du renvoi :</strong> {kase.reasonForReferral}</div>
        )}
      </div>

      <div className="card mb-4">
        <h3>Pièces jointes reçues</h3>
        {(kase.files || []).length === 0 ? (
          <div className="empty-state">Aucun fichier.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Type</th><th>Fichier</th><th>Reçu le</th><th></th></tr></thead>
            <tbody>
              {kase.files.map((f) => (
                <tr key={f.id}>
                  <td>{FILE_CATEGORY_LABELS[f.category] || f.category}</td>
                  <td>{f.originalName}</td>
                  <td>{fmtDateTime(f.uploadedAt)}</td>
                  <td className="text-right"><button className="btn btn-sm" onClick={() => openFile(f.id)}>Voir</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card mb-4">
        <h3>Statut du dossier</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Statut</label>
            <select className="input" value={statusForm.status} onChange={(e) => setStatusForm({ ...statusForm, status: e.target.value })}>
              {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="form-row cols-1">
          <div className="form-group">
            <label>Note (optionnelle)</label>
            <textarea className="textarea" value={statusForm.note}
              onChange={(e) => setStatusForm({ ...statusForm, note: e.target.value })}
              placeholder="Ex : radios reçues, RDV programmé le 14/09…" />
          </div>
        </div>
        <label className="flex-row" style={{ gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={statusForm.visibleToReferrer}
            onChange={(e) => setStatusForm({ ...statusForm, visibleToReferrer: e.target.checked })} />
          Visible par le vétérinaire référent
        </label>
        <label className="flex-row" style={{ gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={statusForm.notifyVet}
            onChange={(e) => setStatusForm({ ...statusForm, notifyVet: e.target.checked })} />
          Notifier le vétérinaire référent par email
        </label>
        <button className="btn btn-primary mt-4" disabled={busy} onClick={submitStatus}>Mettre à jour</button>
      </div>

      <div className="card mb-4">
        <h3>Historique</h3>
        <table className="table">
          <tbody>
            {(kase.events || []).map((ev) => (
              <tr key={ev.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(ev.createdAt)}</td>
                <td>{EVENT_LABELS[ev.type] || ev.type}{ev.toStatus ? ` → ${STATUS_LABELS[ev.toStatus] || ev.toStatus}` : ''}</td>
                <td className="text-light">{ev.note || ''}</td>
                <td>{!ev.visibleToReferrer && <span className="text-light" style={{ fontSize: '0.78rem' }}>(interne)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Lien de suivi</h3>
        <div className="flex-row" style={{ gap: 10 }}>
          <button className="btn" onClick={resendLink}>Renvoyer le lien par email</button>
          <button className="btn btn-danger" onClick={revokeTokens}>Révoquer les liens actifs</button>
        </div>
      </div>

      <div className="card">
        <h3>Zone de suppression</h3>
        <p className="text-light mb-4" style={{ fontSize: 13 }}>
          Supprime définitivement ce dossier référent (fichiers, historique, lien de suivi). Le patient lié dans Colveto, s'il existe, n'est pas affecté.
        </p>
        <button className="btn btn-danger" onClick={removeCase}>Supprimer ce dossier</button>
      </div>

      {showLinkModal && (
        <Modal
          title="Lier ce dossier à un patient"
          onClose={() => setShowLinkModal(false)}
          footer={
            <>
              <button className="btn" onClick={() => setShowLinkModal(false)}>Annuler</button>
              <button className="btn btn-primary" disabled={busy} onClick={confirmLink}>Confirmer</button>
            </>
          }
        >
          <div className="flex-row mb-4" style={{ gap: 16 }}>
            <label><input type="radio" checked={linkMode === 'existing'} onChange={() => setLinkMode('existing')} /> Patient existant</label>
            <label><input type="radio" checked={linkMode === 'new'} onChange={() => setLinkMode('new')} /> Nouveau patient</label>
          </div>

          {linkMode === 'existing' ? (
            <SearchSelect
              value={linkPatientId}
              onChange={setLinkPatientId}
              placeholder="Rechercher un patient…"
              options={patients.map((p) => ({ id: p.id, label: p.name, sub: `${p.ownerFirstName} ${p.ownerLastName}` }))}
            />
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Prénom propriétaire</label>
                  <input className="input" value={newPatient?.owner.firstName || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, owner: { ...newPatient.owner, firstName: e.target.value } })} />
                </div>
                <div className="form-group">
                  <label>Nom propriétaire</label>
                  <input className="input" value={newPatient?.owner.lastName || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, owner: { ...newPatient.owner, lastName: e.target.value } })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email propriétaire</label>
                  <input className="input" value={newPatient?.owner.email || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, owner: { ...newPatient.owner, email: e.target.value } })} />
                </div>
                <div className="form-group">
                  <label>Téléphone propriétaire</label>
                  <input className="input" value={newPatient?.owner.phone || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, owner: { ...newPatient.owner, phone: e.target.value } })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nom du patient</label>
                  <input className="input" value={newPatient?.patient.name || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, patient: { ...newPatient.patient, name: e.target.value } })} />
                </div>
                <div className="form-group">
                  <label>Espèce</label>
                  <input className="input" value={newPatient?.patient.species || ''}
                    onChange={(e) => setNewPatient({ ...newPatient, patient: { ...newPatient.patient, species: e.target.value } })} />
                </div>
              </div>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
