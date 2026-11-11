import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Reusable TOTP enrollment flow. Calls onDone() once 2FA is active.
export function Enroll2FA({ onDone }) {
  const [step, setStep] = useState('start'); // start | scan | done
  const [data, setData] = useState(null);     // { secret, uri, qr }
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const begin = async () => {
    setError(null); setBusy(true);
    try {
      const r = await window.api.twofa.setup();
      setData(r);
      setStep('scan');
    } catch (e) { setError(e.message || 'Erreur'); }
    setBusy(false);
  };

  const confirm = async (e) => {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      const r = await window.api.twofa.confirm(code.trim());
      setBackupCodes(r.backupCodes || []);
      setStep('done');
    } catch (e) { setError(e.message || 'Code invalide'); }
    setBusy(false);
  };

  if (step === 'start') {
    return (
      <div>
        <p className="text-light mb-4">
          La double authentification (2FA) ajoute un code à usage unique, généré par une application
          (Google Authenticator, Microsoft Authenticator, etc.), en plus de votre mot de passe.
        </p>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary" onClick={begin} disabled={busy}>
          {busy ? '…' : 'Activer la 2FA'}
        </button>
      </div>
    );
  }

  if (step === 'scan') {
    return (
      <form onSubmit={confirm}>
        <ol style={{ paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Ouvrez votre application d’authentification.</li>
          <li>Scannez ce QR code (ou saisissez la clé manuellement).</li>
          <li>Entrez le code à 6 chiffres affiché pour confirmer.</li>
        </ol>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', margin: '12px 0' }}>
          {data?.qr && <img src={data.qr} alt="QR code 2FA" style={{ width: 180, height: 180, border: '1px solid #e5e7eb', borderRadius: 8 }} />}
          <div>
            <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>Clé manuelle</div>
            <code style={{ fontSize: '0.95rem', wordBreak: 'break-all' }}>{data?.secret}</code>
          </div>
        </div>
        <div className="form-group" style={{ maxWidth: 220 }}>
          <label>Code à 6 chiffres</label>
          <input className="input" autoFocus value={code} inputMode="numeric" placeholder="123456"
            onChange={(e) => setCode(e.target.value)} required
            style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem' }} />
        </div>
        {error && <div className="auth-error" style={{ marginBottom: 12 }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '…' : 'Confirmer'}</button>
      </form>
    );
  }

  // done — show backup codes
  return (
    <div>
      <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
        ✅ <strong>2FA activée.</strong>
      </div>
      <p className="text-light">
        Conservez ces <strong>codes de secours</strong> en lieu sûr. Chacun fonctionne <strong>une seule fois</strong>
        si vous perdez l’accès à votre application d’authentification. Ils ne seront plus jamais affichés.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, max-content)', gap: '4px 24px', fontFamily: 'monospace', fontSize: '1rem', margin: '12px 0', padding: 12, background: '#f8fafc', borderRadius: 8, border: '1px solid #e5e7eb' }}>
        {backupCodes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <button className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(backupCodes.join('\n'))}>Copier les codes</button>{' '}
      <button className="btn btn-primary" onClick={() => onDone && onDone()}>J’ai noté mes codes</button>
    </div>
  );
}

// Full-screen mandatory gate for admins without 2FA.
export function Mandatory2FA() {
  const { refreshUser, logout, user } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>Sécurité requise</h1>
        <p className="text-light mb-4">
          Bonjour {user?.fullName}. Votre compte <strong>administrateur</strong> doit être protégé par la
          double authentification (2FA) avant de continuer.
        </p>
        <Enroll2FA onDone={refreshUser} />
        <div style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={logout}>Se déconnecter</button>
        </div>
      </div>
    </div>
  );
}

function TwoFactorSection() {
  const { user, refreshUser } = useAuth();
  const [disabling, setDisabling] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);

  const disable = async () => {
    setError(null);
    try {
      await window.api.twofa.disable(password);
      setPassword(''); setDisabling(false);
      await refreshUser();
    } catch (e) { setError(e.message || 'Erreur'); }
  };

  return (
    <div className="card">
      <h3>Double authentification (2FA)</h3>
      {user?.totpEnabled ? (
        <div>
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: 12, marginBottom: 12 }}>
            ✅ La 2FA est <strong>activée</strong> sur votre compte.
          </div>
          {user.role === 'admin' && (
            <p className="text-light" style={{ fontSize: '0.85rem' }}>
              Note : la 2FA est obligatoire pour les comptes administrateur. Si vous la désactivez,
              elle vous sera redemandée à la prochaine connexion.
            </p>
          )}
          {!disabling ? (
            <button className="btn btn-secondary" onClick={() => setDisabling(true)}>Désactiver la 2FA</button>
          ) : (
            <div style={{ maxWidth: 320 }}>
              <label style={{ fontSize: '0.78rem' }}>Confirmez avec votre mot de passe</label>
              <input className="input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} />
              {error && <div className="auth-error" style={{ margin: '8px 0' }}>{error}</div>}
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-secondary" onClick={() => { setDisabling(false); setError(null); }}>Annuler</button>{' '}
                <button className="btn btn-primary" onClick={disable} disabled={!password}>Confirmer la désactivation</button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <Enroll2FA onDone={refreshUser} />
      )}
    </div>
  );
}

function LoginJournal() {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.api.security.loginEvents(200).then(setEvents).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="card">
      <h3>Journal des connexions</h3>
      <p className="text-light" style={{ fontSize: '0.85rem', marginBottom: 12 }}>
        200 derniers événements de connexion (réussites et échecs).
      </p>
      {error && <div className="auth-error">{error}</div>}
      {!events ? <div className="empty-state">Chargement…</div> : events.length === 0 ? (
        <div className="empty-state">Aucun événement.</div>
      ) : (
        <table className="table">
          <thead>
            <tr><th>Date</th><th>Identifiant</th><th>Résultat</th><th>Détail</th><th>IP</th></tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.createdAt)}</td>
                <td>{e.username || '—'}</td>
                <td style={{ color: e.success ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                  {e.success ? 'Réussi' : 'Échec'}
                </td>
                <td style={{ color: '#6b7280' }}>{e.reason || '—'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{e.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function Security() {
  const { user } = useAuth();
  return (
    <div>
      <div className="page-header"><h2>Sécurité</h2></div>
      <TwoFactorSection />
      {user?.role === 'admin' && <LoginJournal />}
    </div>
  );
}
