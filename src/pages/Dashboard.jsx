import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [stats, setStats] = useState(null);
  const [upcomingFollowUps, setUpcomingFollowUps] = useState([]);

  useEffect(() => {
    window.api.stats.dashboard().then(setStats);
    // Follow-ups due in the next 30 days
    window.api.followUps.list({ upcomingDays: 30 }).then(setUpcomingFollowUps);
  }, []);

  if (!stats) return <div>Chargement…</div>;

  const fmt = (d) => new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div>
      <div className="page-header">
        <h2>Tableau de bord</h2>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <div className="label">RDV aujourd'hui</div>
          <div className="value">{stats.todayAppts}</div>
        </div>
        <div className="stat-card">
          <div className="label">Patients</div>
          <div className="value">{stats.totalPatients}</div>
        </div>
        <div className="stat-card">
          <div className="label">Propriétaires</div>
          <div className="value">{stats.totalOwners}</div>
        </div>
        <div className="stat-card">
          <div className="label">Factures impayées</div>
          <div className="value">{stats.unpaidCount}</div>
        </div>
      </div>

      {upcomingFollowUps.length > 0 && (
        <div className="card" style={{ background: '#fefce8', border: '1px solid #fde047' }}>
          <div className="flex-row between mb-4">
            <h3 style={{ margin: 0 }}>📅 Rappels à envoyer dans les 30 jours ({upcomingFollowUps.length})</h3>
          </div>
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Patient</th><th>Propriétaire</th><th>Rappel</th><th>Email</th></tr>
            </thead>
            <tbody>
              {upcomingFollowUps.slice(0, 8).map((f) => {
                const isLate = f.scheduledDate < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={f.id}>
                    <td>
                      {new Date(f.scheduledDate).toLocaleDateString('fr-FR')}
                      {isLate && <span style={{ color: 'var(--danger)', fontSize: 11 }}> (en retard)</span>}
                    </td>
                    <td><Link to={`/patients/${f.patientId}`}>{f.patientName}</Link></td>
                    <td>{f.ownerLastName} {f.ownerFirstName}</td>
                    <td>{f.title}</td>
                    <td style={{ fontSize: 12 }}>
                      {f.ownerEmail ? <span className="text-light">{f.ownerEmail}</span> :
                        <span style={{ color: 'var(--danger)' }}>⚠ pas d'email</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {upcomingFollowUps.length > 8 && (
            <small className="text-light">… et {upcomingFollowUps.length - 8} autre(s).</small>
          )}
        </div>
      )}

      <div className="card">
        <div className="flex-row between mb-4">
          <h3 style={{ margin: 0 }}>Prochains rendez-vous</h3>
          <Link to="/calendar" className="btn btn-sm">Voir l'agenda →</Link>
        </div>
        {stats.upcomingAppts.length === 0 ? (
          <div className="empty-state">Aucun rendez-vous à venir.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Patient</th>
                <th>Propriétaire</th>
                <th>Motif</th>
              </tr>
            </thead>
            <tbody>
              {stats.upcomingAppts.map((a) => (
                <tr key={a.id}>
                  <td>{fmt(a.startTime)}</td>
                  <td>{a.patientName || '—'}</td>
                  <td>{a.ownerFirstName} {a.ownerLastName}</td>
                  <td>{a.reason || a.title}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
