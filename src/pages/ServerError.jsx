import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { getApiBase, ping } from '../lib/api.js';

export default function ServerError() {
  const { serverError, reconfigureServer, retry } = useAuth();
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [defaultUrl, setDefaultUrl] = useState(null);

  useEffect(() => {
    if (window.electronApi) {
      window.electronApi.getConfig().then((cfg) => setDefaultUrl(cfg.defaultApiUrl));
    }
  }, []);

  const test = async () => {
    setBusy(true); setTestResult(null);
    const cleaned = url.replace(/\/+$/, '');
    // Temporary check by trying a fetch
    try {
      const r = await fetch(`${cleaned}/api/ping`);
      setTestResult(r.ok ? { ok: true, msg: 'Connexion réussie ✓' } : { ok: false, msg: `Erreur HTTP ${r.status}` });
    } catch (e) {
      setTestResult({ ok: false, msg: 'Impossible de joindre cette URL' });
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    await reconfigureServer(url.replace(/\/+$/, ''));
    setBusy(false);
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 520 }}>
        <div className="auth-logo">⚠️</div>
        <h1>Serveur injoignable</h1>
        <p className="text-light text-center mb-4">
          {serverError || 'Le serveur ne répond pas.'}
        </p>

        <div className="form-group">
          <label>URL du serveur</label>
          <input className="input" value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://192.168.1.10:3737" />
          <small className="text-light">
            {defaultUrl && (
              <>Par défaut sur ce PC : <code>{defaultUrl}</code><br /></>
            )}
            Pour un PC client : entrez l'IP du PC serveur du cabinet, par exemple <code>http://192.168.1.10:3737</code>
          </small>
        </div>

        {testResult && (
          <div className="auth-error" style={{
            background: testResult.ok ? '#d1fae5' : '#fee2e2',
            color: testResult.ok ? '#065f46' : '#991b1b',
          }}>
            {testResult.msg}
          </div>
        )}

        <div className="flex-row mt-4" style={{ justifyContent: 'space-between' }}>
          <button className="btn" onClick={test} disabled={busy}>Tester la connexion</button>
          <div className="flex-row">
            <button className="btn" onClick={retry} disabled={busy}>Réessayer</button>
            <button className="btn btn-primary" onClick={save} disabled={busy}>Enregistrer</button>
          </div>
        </div>
      </div>
    </div>
  );
}
