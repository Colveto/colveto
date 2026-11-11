import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await login(username.trim().toLowerCase(), password, needTotp ? code.trim() : undefined);
      if (r?.needTotp) {
        setNeedTotp(true);
        setError(null);
      }
    } catch (err) {
      setError(err.message || 'Erreur de connexion');
    }
    setBusy(false);
  };

  const resetToLogin = () => {
    setNeedTotp(false);
    setCode('');
    setError(null);
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <img
            src="colveto-logo.png"
            alt="Colveto"
            onError={(e) => { e.currentTarget.src = 'colveto-logo.svg'; }}
            style={{ width: 96, height: 96, objectFit: 'contain' }}
          />
        </div>
        <h1>Colveto</h1>

        {!needTotp ? (
          <>
            <p className="text-light text-center mb-4">Connectez-vous pour continuer</p>
            <div className="form-group">
              <label>Identifiant</label>
              <input className="input" autoFocus value={username}
                onChange={(e) => setUsername(e.target.value)} required />
            </div>
            <div className="form-group mt-2">
              <label>Mot de passe</label>
              <input className="input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </>
        ) : (
          <>
            <p className="text-light text-center mb-4">
              Saisissez le code à 6 chiffres de votre application d’authentification
              <br />(ou un code de secours).
            </p>
            <div className="form-group">
              <label>Code de vérification</label>
              <input className="input" autoFocus value={code} inputMode="numeric"
                placeholder="123456"
                onChange={(e) => setCode(e.target.value)} required
                style={{ letterSpacing: '0.2em', textAlign: 'center', fontSize: '1.2rem' }} />
            </div>
          </>
        )}

        {error && (
          <div className="auth-error">{error}</div>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}
          style={{ width: '100%', marginTop: 16, justifyContent: 'center' }}>
          {busy ? 'Connexion…' : (needTotp ? 'Vérifier' : 'Se connecter')}
        </button>

        {needTotp && (
          <button type="button" className="btn btn-secondary" onClick={resetToLogin}
            style={{ width: '100%', marginTop: 8, justifyContent: 'center' }}>
            ← Retour
          </button>
        )}
      </form>
    </div>
  );
}
