import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from './Referrals.jsx';
import { useToast } from '../components/Toast.jsx';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function ReferringVetDetail() {
  const { id } = useParams();
  const { showToast } = useToast();
  const [vet, setVet] = useState(null);

  useEffect(() => {
    window.api.referringVets.get(id)
      .then(setVet)
      .catch((e) => showToast('Erreur : ' + e.message, 'error'));
  }, [id]);

  if (!vet) return <div>Chargement…</div>;

  const address = [vet.address, [vet.postalCode, vet.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/referring-vets" className="text-light">← Vétérinaires référents</Link>
          <h2>Dr {vet.name}</h2>
          {vet.clinic && <div className="text-light">{vet.clinic}</div>}
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">Coordonnées</h3>
        <div className="form-row">
          <div><strong>Email:</strong> {vet.email || '—'}</div>
          <div><strong>Téléphone:</strong> {vet.phone || '—'}</div>
        </div>
        <div className="form-row cols-1">
          <div><strong>Adresse:</strong> {address || '—'}</div>
        </div>
        {vet.notes && <div className="mt-2"><strong>Notes:</strong> {vet.notes}</div>}
        {!vet.active && (
          <div className="mt-2 text-light">Fiche marquée inactive.</div>
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">Patients référés ({vet.patients.length})</h3>
        {vet.patients.length === 0 ? (
          <div className="empty-state">
            Aucun patient rattaché. Un patient apparaît ici dès que sa fiche client est
            cochée « référé par un vétérinaire » avec ce confrère, ou qu'un dossier du
            portail lui est lié.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Animal</th>
                <th>Espèce</th>
                <th>Propriétaire</th>
                <th>Dossier</th>
                <th>Dernier envoi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vet.patients.map((p) => (
                <tr key={p.id}>
                  <td><Link to={`/patients/${p.id}`}>{p.name}</Link></td>
                  <td>{p.species || '—'}</td>
                  <td>
                    <Link to={`/owners/${p.ownerId}`}>{p.ownerLastName} {p.ownerFirstName}</Link>
                  </td>
                  <td>{p.reference || '—'}</td>
                  <td>{p.lastSentAt ? fmtDate(p.lastSentAt) : <span className="text-light">jamais</span>}</td>
                  <td className="text-right">
                    <Link className="btn btn-sm" to={`/patients/${p.id}?sendTo=${vet.id}`}>
                      ✉ Envoyer le dossier
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {vet.cases.length > 0 && (
        <div className="card">
          <h3 className="mt-2">Dossiers reçus par le portail ({vet.cases.length})</h3>
          <table className="table">
            <thead>
              <tr><th>Référence</th><th>Reçu le</th><th>Animal</th><th>Motif</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {vet.cases.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/referrals/${c.id}`}>{c.reference}</Link></td>
                  <td>{fmtDate(c.createdAt)}</td>
                  <td>{c.patientName}</td>
                  <td>{c.reasonForReferral || '—'}</td>
                  <td><StatusBadge status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 className="mt-2">Dossiers et radios envoyés ({vet.sends.length})</h3>
        {vet.sends.length === 0 ? (
          <div className="empty-state">
            Rien n'a encore été envoyé à ce confrère. Utilisez « ✉ Envoyer le dossier »
            en face d'un de ses patients ci-dessus : le dossier PDF part vers lui, avec
            les radios et analyses que vous cochez.
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Animal</th><th>Destinataire</th><th>Contenu</th><th>Objet</th></tr>
            </thead>
            <tbody>
              {vet.sends.map((sd) => (
                <tr key={sd.id}>
                  <td>{fmtDateTime(sd.sentAt)}</td>
                  <td>{sd.patientName || '—'}</td>
                  <td style={{ fontSize: 13 }}>{sd.toEmail}</td>
                  <td>{sd.summary || '—'}</td>
                  <td style={{ fontSize: 13 }}>{sd.subject || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
