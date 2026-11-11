import React, { useState } from 'react';

export default function SageExport() {
  const today = new Date();
  const firstDayOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10);

  const [startDate, setStartDate] = useState(firstDayOfMonth);
  const [endDate, setEndDate] = useState(lastDayOfMonth);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const exportFEC = async () => {
    setBusy(true); setMessage(null);
    try {
      const res = await window.api.sage.exportFEC({ startDate, endDate });
      if (res.canceled) setMessage({ type: 'info', text: 'Export annulé.' });
      else setMessage({ type: 'success', text: `FEC exporté : ${res.path}` });
    } catch (e) {
      setMessage({ type: 'error', text: 'Erreur : ' + e.message });
    }
    setBusy(false);
  };

  const exportCSV = async () => {
    setBusy(true); setMessage(null);
    try {
      const res = await window.api.sage.exportCSV({ startDate, endDate });
      if (res.canceled) setMessage({ type: 'info', text: 'Export annulé.' });
      else setMessage({ type: 'success', text: `CSV exporté : ${res.path}` });
    } catch (e) {
      setMessage({ type: 'error', text: 'Erreur : ' + e.message });
    }
    setBusy(false);
  };

  return (
    <div>
      <div className="page-header">
        <h2>Export Sage Cloud Démat</h2>
      </div>

      <div className="card">
        <h3 className="mt-2">Période d'export</h3>
        <p className="text-light">
          Sélectionnez la période pour générer un export comptable (FEC) ou un récapitulatif CSV
          des factures émises.
        </p>
        <div className="form-row">
          <div className="form-group">
            <label>Du</label>
            <input className="input" type="date" value={startDate}
              onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Au</label>
            <input className="input" type="date" value={endDate}
              onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        <div className="flex-row mt-4">
          <button className="btn btn-primary" disabled={busy} onClick={exportFEC}>
            📄 Exporter FEC (Sage)
          </button>
          <button className="btn" disabled={busy} onClick={exportCSV}>
            📊 Exporter CSV factures
          </button>
        </div>

        {message && (
          <div className="mt-4" style={{
            padding: 12, borderRadius: 6,
            background: message.type === 'success' ? '#d1fae5' :
                        message.type === 'error' ? '#fee2e2' : '#dbeafe',
            color: message.type === 'success' ? '#065f46' :
                   message.type === 'error' ? '#991b1b' : '#1e40af',
          }}>
            {message.text}
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">Format FEC (Fichier des Écritures Comptables)</h3>
        <p className="text-light">
          Le fichier FEC généré respecte le format réglementaire français exigé par
          l'administration fiscale (article L.47 A-I du LPF). Il est compatible avec
          l'import dans <strong>Sage Cloud Démat</strong> et la plupart des logiciels comptables.
        </p>
        <ul className="text-light">
          <li>Format : texte tabulé (TXT), encodage UTF-8</li>
          <li>Colonnes : 18 champs réglementaires (JournalCode, EcritureDate, CompteNum, Debit, Credit, etc.)</li>
          <li>Écritures générées : ventes (706000) + TVA collectée (445710) + créance client (411000)</li>
          <li>Comptes auxiliaires : un compte 411XXXXXX par client (basé sur l'ID propriétaire)</li>
        </ul>
        <p className="text-light">
          Vous pouvez personnaliser le code journal et les comptes par défaut dans <strong>Paramètres</strong>.
        </p>
      </div>

      <div className="card">
        <h3 className="mt-2">Intégration API Sage Cloud Démat (à venir)</h3>
        <p className="text-light">
          Une connexion directe via l'API Sage est en préparation. Elle permettra :
        </p>
        <ul className="text-light">
          <li>Synchronisation automatique des factures</li>
          <li>Dépôt des PDF dans Sage Démat</li>
          <li>Récupération des statuts de paiement</li>
        </ul>
        <p className="text-light">
          Pour l'instant, utilisez l'export FEC puis importez-le dans Sage Cloud via
          le module d'import comptable.
        </p>
      </div>
    </div>
  );
}
