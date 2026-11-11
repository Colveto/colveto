import React, { useEffect, useState } from 'react';
import { useToast } from '../components/Toast.jsx';

// Assistant d'import : clients et animaux depuis l'export (Excel/CSV) de
// n'importe quel autre logiciel. Le serveur lit le fichier, devine les
// colonnes ; l'utilisateur corrige, vérifie (essai sans rien enregistrer),
// puis importe. Chaque import peut être annulé.

const GROUPS = [['client', 'Client'], ['animal', 'Animal']];

export default function Import() {
  const { showToast } = useToast();
  const [file, setFile] = useState(null);       // réponse de /parse
  const [mapping, setMapping] = useState([]);
  const [toNotes, setToNotes] = useState(true);
  const [report, setReport] = useState(null);   // dernier essai ou import
  const [busy, setBusy] = useState(false);
  const [batches, setBatches] = useState([]);

  const loadBatches = () => window.api.dataImport.batches().then(setBatches).catch(() => {});
  useEffect(() => { loadBatches(); }, []);

  const onFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true); setReport(null);
    try {
      const r = await window.api.dataImport.parse(f);
      setFile(r);
      setMapping(r.suggestions);
    } catch (err) {
      showToast(err.message, 'error', 10000);
    }
    setBusy(false);
  };

  const setCol = (i, value) => {
    setReport(null);
    setMapping((m) => m.map((v, j) => {
      if (j === i) return value;
      // Un champ ne peut être associé qu'à une seule colonne.
      if (value && value !== '-' && v === value) return '';
      return v;
    }));
  };

  const run = async (dryRun) => {
    if (!dryRun && !confirm(`Importer ${report.ownersCreated} client(s) et ${report.patientsCreated} animal(aux) ?`)) return;
    setBusy(true);
    try {
      const r = await window.api.dataImport.run(file.token, mapping, { unmappedToNotes: toNotes }, dryRun);
      setReport(r);
      if (!dryRun) {
        showToast(`Import terminé : ${r.ownersCreated} client(s), ${r.patientsCreated} animal(aux)`, 'success', 8000);
        loadBatches();
      }
    } catch (err) {
      showToast(err.message, 'error', 10000);
      if (/expiré/.test(err.message)) { setFile(null); setReport(null); }
    }
    setBusy(false);
  };

  const undo = async (b) => {
    if (!confirm(`Annuler l'import « ${b.fileName} » du ${new Date(b.createdAt).toLocaleString('fr-FR')} ?\n\nLes fiches créées par cet import seront supprimées, sauf celles utilisées depuis (rendez-vous, factures, dossiers…).`)) return;
    try {
      const r = await window.api.dataImport.undo(b.id);
      const kept = r.kept.owners + r.kept.patients;
      showToast(`Import annulé : ${r.removedOwners} client(s) et ${r.removedPatients} animal(aux) supprimés`
        + (kept ? ` — ${kept} fiche(s) conservée(s) car déjà utilisée(s)` : ''), 'success', 10000);
      loadBatches();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  const reset = () => { setFile(null); setMapping([]); setReport(null); };
  const done = report && !report.dryRun;

  return (
    <div>
      <div className="page-header">
        <h2>Importer des données</h2>
      </div>

      {!file && (
        <div className="card">
          <h3 className="mt-2" style={{ marginTop: 0 }}>1. Exportez vos données de l'ancien logiciel</h3>
          <ul className="text-light" style={{ lineHeight: 1.7, marginTop: 0 }}>
            <li>Dans votre ancien logiciel, cherchez une fonction <strong>Exporter</strong> (souvent dans la liste des
              clients ou des animaux) au format <strong>Excel</strong> ou <strong>CSV</strong>. À défaut, demandez à
              son éditeur « un export des clients et des animaux au format Excel ou CSV ».</li>
            <li>L'idéal : <strong>un seul fichier</strong> avec une ligne par animal et les coordonnées du client sur la
              même ligne. Deux fichiers séparés marchent aussi : importez d'abord <strong>les clients</strong> (avec leur
              n° de client), puis <strong>les animaux</strong> (avec ce même n° de client).</li>
            <li>Fichier <code>.xls</code> (ancien Excel), <code>.ods</code> ou <code>.numbers</code> : ouvrez-le et
              faites « Enregistrer sous » au format <code>.xlsx</code> ou CSV.</li>
          </ul>
          <h3 className="mt-2">2. Déposez le fichier</h3>
          <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xls,text/csv" onChange={onFile} disabled={busy} />
          {busy && <p className="text-light">Lecture du fichier…</p>}
        </div>
      )}

      {file && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="mt-2" style={{ marginTop: 0 }}>
              {done ? 'Import terminé' : '3. Associez les colonnes'} — <span className="text-light">{file.fileName}, {file.totalRows} ligne(s)</span>
            </h3>
            <button className="btn" onClick={reset} disabled={busy}>{done ? 'Importer un autre fichier' : 'Changer de fichier'}</button>
          </div>

          {!done && (
            <>
              <p className="text-light" style={{ marginTop: 0 }}>
                Colveto a deviné les colonnes qu'il a reconnues. Vérifiez et corrigez si besoin. Les colonnes
                non associées sont recopiées dans les remarques de l'animal (ou du client), pour ne rien perdre.
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead>
                    <tr><th>Colonne du fichier</th><th>Exemples</th><th>Champ Colveto</th></tr>
                  </thead>
                  <tbody>
                    {file.headers.map((h, i) => (
                      <tr key={i}>
                        <td><strong>{h}</strong></td>
                        <td className="text-light" style={{ fontSize: 12, maxWidth: 320 }}>
                          {file.sampleRows.map((r) => r[i]).filter(Boolean).slice(0, 3).join(' · ') || '—'}
                        </td>
                        <td>
                          <select className="select" value={mapping[i] || ''} onChange={(e) => setCol(i, e.target.value)}
                            style={{ minWidth: 240 }}>
                            <option value="">{toNotes ? '→ recopier dans les remarques' : '→ ignorer'}</option>
                            <option value="-">Ignorer cette colonne</option>
                            {GROUPS.map(([g, label]) => (
                              <optgroup key={g} label={label}>
                                {Object.entries(file.fields).filter(([, f]) => f.group === g).map(([k, f]) => (
                                  <option key={k} value={k}>{f.label}</option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
                <input type="checkbox" checked={toNotes} onChange={(e) => { setToNotes(e.target.checked); setReport(null); }} />
                Recopier les colonnes non associées dans les remarques
              </label>
              <button className="btn btn-primary" onClick={() => run(true)} disabled={busy}>
                {busy ? 'Vérification…' : 'Vérifier (aucune donnée enregistrée)'}
              </button>
            </>
          )}

          {report && <ImportReport report={report} />}

          {report && report.dryRun && (report.ownersCreated + report.patientsCreated > 0) && (
            <div style={{ marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => run(false)} disabled={busy}>
                {busy ? 'Import en cours…' : `Importer ${report.ownersCreated} client(s) et ${report.patientsCreated} animal(aux)`}
              </button>
            </div>
          )}
          {done && (
            <p style={{ marginTop: 12 }}>
              <a href="#/owners">Voir les clients</a> · <a href="#/patients">Voir les animaux</a>
            </p>
          )}
        </div>
      )}

      {batches.length > 0 && (
        <div className="card">
          <h3 className="mt-2" style={{ marginTop: 0 }}>Imports précédents</h3>
          <table className="table">
            <thead><tr><th>Date</th><th>Fichier</th><th>Créés</th><th></th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.createdAt).toLocaleString('fr-FR')}</td>
                  <td>{b.fileName}</td>
                  <td>{b.ownersCreated} client(s), {b.patientsCreated} animal(aux)</td>
                  <td style={{ textAlign: 'right' }}>
                    {b.undoneAt
                      ? <span className="text-light">annulé le {new Date(b.undoneAt).toLocaleDateString('fr-FR')}</span>
                      : <button className="btn btn-sm" onClick={() => undo(b)}>Annuler cet import</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ImportReport({ report: r }) {
  const [showAll, setShowAll] = useState(false);
  const issues = [...r.errors.map((e) => ({ ...e, kind: 'Ignorée' })), ...r.warnings.map((w) => ({ ...w, kind: 'Attention' }))]
    .sort((a, b) => a.line - b.line);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ background: r.dryRun ? '#f0f9ff' : '#ecfdf5', borderRadius: 8, padding: 12 }}>
        <strong>{r.dryRun ? 'Résultat de la vérification (rien n’a encore été enregistré)' : 'Import enregistré'}</strong>
        <ul style={{ margin: '8px 0 0', lineHeight: 1.7 }}>
          <li>{r.ownersCreated} nouveau(x) client(s), {r.patientsCreated} nouvel(aux) animal(aux)</li>
          {(r.ownersExisting > 0 || r.patientsExisting > 0) && (
            <li>Déjà dans Colveto (non recréés, non modifiés) : {r.ownersExisting} client(s), {r.patientsExisting} animal(aux)</li>
          )}
          {r.rowsSkipped > 0 && <li>{r.rowsSkipped} ligne(s) ignorée(s)</li>}
        </ul>
      </div>

      {issues.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <strong>Points à vérifier</strong>
          <ul className="text-light" style={{ fontSize: 13, lineHeight: 1.6 }}>
            {(showAll ? issues : issues.slice(0, 10)).map((x, i) => (
              <li key={i}>Ligne {x.line} — {x.kind} : {x.message}</li>
            ))}
          </ul>
          {issues.length > 10 && !showAll && (
            <button className="btn btn-sm" onClick={() => setShowAll(true)}>Tout afficher ({issues.length})</button>
          )}
        </div>
      )}

      {r.dryRun && r.sample.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <strong>Aperçu des premières lignes</strong>
          <table className="table" style={{ fontSize: 13 }}>
            <thead><tr><th>Ligne</th><th>Client</th><th>Contact</th><th>Animal</th><th>Espèce / sexe</th><th>Naissance</th><th>Puce</th></tr></thead>
            <tbody>
              {r.sample.map((s) => (
                <tr key={s.line}>
                  <td>{s.line}</td>
                  <td>{s.owner}</td>
                  <td className="text-light">{[s.email, s.phone].filter(Boolean).join(' · ')}</td>
                  <td>{s.patient ? s.patient.name : <span className="text-light">—</span>}</td>
                  <td>{s.patient ? `${s.patient.species}${s.patient.sex ? ' · ' + (s.patient.sex === 'M' ? 'mâle' : 'femelle') : ''}${s.patient.sterilized ? ' · stérilisé' : ''}` : ''}</td>
                  <td>{s.patient && s.patient.birthDate ? new Date(s.patient.birthDate).toLocaleDateString('fr-FR') : ''}</td>
                  <td className="text-light">{s.patient && s.patient.microchip}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="text-light">Les lignes « déjà dans Colveto » n'apparaissent pas comme nouveaux animaux.</small>
        </div>
      )}
    </div>
  );
}
