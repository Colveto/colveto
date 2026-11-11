import React, { useEffect, useState } from 'react';

// Bandeau « nouvelle version » (application de bureau uniquement).
export function useUpdateState() {
  const api = typeof window !== 'undefined' ? window.electronApi : null;
  const [st, setSt] = useState(null);
  useEffect(() => {
    if (!api || !api.getUpdateState) return undefined;
    api.getUpdateState().then(setSt).catch(() => {});
    return api.onUpdateStatus((s) => setSt((prev) => ({ ...prev, ...s })));
  }, []);
  return [st, setSt];
}

export default function UpdateBanner() {
  const [st] = useUpdateState();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!st || hidden || !['available', 'downloading', 'ready'].includes(st.status)) return null;

  const install = async () => {
    setBusy(true);
    try { await window.electronApi.installUpdate(); } finally { setBusy(false); }
  };

  const isWin = st.platform === 'win32';
  let text; let action = null;
  if (st.status === 'downloading') {
    text = `Téléchargement de Colveto ${st.latest}… ${st.progress != null ? st.progress + ' %' : ''}`;
  } else if (st.status === 'ready') {
    text = `Colveto ${st.latest} est prêt à être installé. Vos données sont sauvegardées automatiquement avant l'installation.`;
    action = <button className="btn btn-primary btn-sm" onClick={install} disabled={busy}>Redémarrer et installer</button>;
  } else {
    text = isWin && !st.error
      ? `Colveto ${st.latest} est disponible.`
      : `Colveto ${st.latest} est disponible (vous avez la ${st.current}).`;
    action = <button className="btn btn-primary btn-sm" onClick={install} disabled={busy}>Télécharger la nouvelle version</button>;
  }

  return (
    <div className="no-print" style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a',
      borderRadius: 8, padding: '10px 14px', margin: '0 0 16px',
    }}>
      <span style={{ flex: 1, minWidth: 220 }}>🔄 {text}{st.error ? ` (${st.error})` : ''}</span>
      {action}
      <button className="btn btn-sm" onClick={() => setHidden(true)} title="Masquer jusqu'au prochain démarrage">Plus tard</button>
    </div>
  );
}
