import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

// Application de bureau : chaque PC a son propre serveur intégré. Sur le 2e PC
// d'un cabinet, il faut rejoindre le serveur principal, pas créer un second
// cabinet (sinon rendez-vous et factures se retrouvent dans deux bases).
const isDesktop = typeof window !== 'undefined' && !!window.electronApi;

function Logo() {
  return (
    <div className="auth-logo">
      <img
        src="colveto-logo.png"
        alt="Colveto"
        onError={(e) => { e.currentTarget.src = 'colveto-logo.svg'; }}
        style={{ width: 96, height: 96, objectFit: 'contain' }}
      />
    </div>
  );
}

export default function FirstRun() {
  const [mode, setMode] = useState(isDesktop ? 'choose' : 'new');

  if (mode === 'choose') {
    return (
      <div className="auth-page">
        <div className="auth-card" style={{ maxWidth: 520 }}>
          <Logo />
          <h1>Bienvenue dans Colveto</h1>
          <p className="text-light text-center mb-4">Comment ce poste va-t-il être utilisé ?</p>
          <button className="btn btn-primary" onClick={() => setMode('new')}
            style={{ width: '100%', justifyContent: 'center', padding: '14px 16px' }}>
            Nouveau cabinet — c'est la première installation de Colveto
          </button>
          <button className="btn" onClick={() => setMode('join')}
            style={{ width: '100%', justifyContent: 'center', padding: '14px 16px', marginTop: 10 }}>
            Rejoindre un cabinet — Colveto est déjà utilisé sur un autre ordinateur
          </button>
        </div>
      </div>
    );
  }
  if (mode === 'join') return <JoinServer onBack={() => setMode('choose')} />;
  return <NewClinic onBack={isDesktop ? () => setMode('choose') : null} />;
}

function JoinServer({ onBack }) {
  const { reconfigureServer } = useAuth();
  const [url, setUrl] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const join = async (e) => {
    e.preventDefault();
    setError(null);
    let cleaned = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(cleaned)) cleaned = 'http://' + cleaned;
    if (/^http:\/\/[^/:]+$/i.test(cleaned)) cleaned += ':3737';
    setBusy(true);
    try {
      const ping = await fetch(`${cleaned}/api/ping`).catch(() => null);
      if (!ping || !ping.ok) throw new Error('Aucun serveur Colveto ne répond à cette adresse. Vérifiez l\'adresse et que l\'ordinateur principal est allumé.');
      const r = await fetch(`${cleaned}/api/auth/has-any-user`).then((x) => x.json());
      if (!r.hasAny) throw new Error('Ce serveur n\'a pas encore de cabinet configuré. Installez d\'abord le cabinet sur l\'ordinateur principal.');
      await reconfigureServer(cleaned);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={join} style={{ maxWidth: 520 }}>
        <Logo />
        <h1>Rejoindre un cabinet</h1>
        <p className="text-light text-center mb-4">
          Ce poste va utiliser les données de l'ordinateur principal du cabinet (ou de votre serveur en ligne).
        </p>
        <div className="form-group">
          <label>Adresse du serveur Colveto</label>
          <input className="input" autoFocus value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="ex : 192.168.1.10:3737 ou https://rdv.moncabinet.lu" required />
          <small className="text-light">
            Sur l'ordinateur principal, l'adresse est indiquée dans Paramètres → Serveur (multi-postes).
          </small>
        </div>
        {error && <div className="auth-error">{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
          <button type="button" className="btn" onClick={onBack} disabled={busy}>Retour</button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Connexion…' : 'Rejoindre'}
          </button>
        </div>
      </form>
    </div>
  );
}

function NewClinic({ onBack }) {
  const { completeSetup } = useAuth();
  const [form, setForm] = useState({
    setupCode: '', fullName: '', username: '', email: '', password: '', confirmPassword: '',
  });
  const [codeRequired, setCodeRequired] = useState(false);
  useEffect(() => {
    window.api.auth.setupStatus().then((r) => setCodeRequired(!!r.setupCodeRequired)).catch(() => {});
  }, []);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirmPassword) {
      setError('Les mots de passe ne correspondent pas');
      return;
    }
    if (form.password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères');
      return;
    }
    setBusy(true);
    try {
      await completeSetup({
        setupCode: codeRequired ? form.setupCode.trim() : undefined,
        fullName: form.fullName.trim(),
        username: form.username.trim().toLowerCase(),
        email: form.email.trim() || null,
        password: form.password,
      });
    } catch (err) {
      setError(err.message || 'Erreur lors de la création du compte');
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit} style={{ maxWidth: 480 }}>
        <Logo />
        <h1>Bienvenue dans Colveto</h1>
        <p className="text-light text-center mb-4">
          Premier lancement — créez votre compte administrateur principal.
          Vous pourrez ajouter des collaborateurs ensuite.
        </p>

        {codeRequired && (
          <div className="form-group">
            <label>Code d'installation *</label>
            <input className="input" autoFocus value={form.setupCode}
              onChange={(e) => setForm({ ...form, setupCode: e.target.value })}
              placeholder="XXXX-XXXX" autoComplete="off" required
              style={{ fontFamily: 'monospace', letterSpacing: 2, textTransform: 'uppercase' }} />
            <small className="text-light">
              Affiché à la fin de l'installation du serveur. Il protège votre serveur : sans ce code,
              personne d'autre ne peut créer le compte administrateur à votre place.
              Sur le serveur : <code>cat /var/lib/vet-clinic/setup-code.txt</code>
            </small>
          </div>
        )}
        <div className="form-group mt-2">
          <label>Nom complet *</label>
          <input className="input" autoFocus={!codeRequired} value={form.fullName}
            onChange={(e) => setForm({ ...form, fullName: e.target.value })}
            placeholder="Ex : Dr. Marie Dupont" required />
        </div>
        <div className="form-group mt-2">
          <label>Identifiant de connexion *</label>
          <input className="input" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="Ex : marie ou mdupont"
            pattern="[-a-zA-Z0-9._]+" required />
          <small className="text-light">Lettres, chiffres, points, tirets — sans espace</small>
        </div>
        <div className="form-group mt-2">
          <label>Email (optionnel)</label>
          <input className="input" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div className="form-group mt-2">
          <label>Mot de passe *</label>
          <input className="input" type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            minLength={8} required />
          <small className="text-light">Minimum 8 caractères</small>
        </div>
        <div className="form-group mt-2">
          <label>Confirmer le mot de passe *</label>
          <input className="input" type="password" value={form.confirmPassword}
            onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            minLength={8} required />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
          {busy ? 'Création…' : 'Créer le compte administrateur'}
        </button>
        {onBack && (
          <button type="button" className="btn" onClick={onBack} disabled={busy}
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}>
            Retour
          </button>
        )}
      </form>
    </div>
  );
}
