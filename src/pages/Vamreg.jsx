import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { SPECIES } from '../components/PatientFormModal.jsx';

// VAMREG — registre belge des antimicrobiens à usage vétérinaire (AFMPS).
// Réglages du cabinet (admin) + journal des déclarations envoyées.

const STATUS = {
  sent: { label: 'Envoyée', cls: 'badge-paid' },
  pending: { label: 'En attente', cls: 'badge-scheduled' },
  error: { label: 'À corriger', cls: 'badge-cancelled' },
  locked: { label: 'Trimestre clos', cls: 'badge-draft' },
};
const DEFAULT_SPECIES = { Cheval: 'HORSE' };
const fmtDate = (d) => (d ? new Date(d.length <= 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-BE') : '—');

export default function Vamreg() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [form, setForm] = useState(null);
  const [species, setSpecies] = useState([]);
  const [providers, setProviders] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function loadSettings() {
    const s = await window.api.settings.get();
    let map = {};
    try { map = JSON.parse(s.vamregSpeciesMap || '{}'); } catch { map = {}; }
    setForm({
      vamregEnabled: s.vamregEnabled === '1',
      vamregEnvironment: s.vamregEnvironment === 'prod' ? 'prod' : 'uat',
      vamregApiKey: s.vamregApiKey || '',
      vamregDefaultVetOrderNumber: s.vamregDefaultVetOrderNumber || '',
      vamregDefaultProviderType: s.vamregDefaultProviderType || 'DIST_BE',
      vamregDeclareIn: s.vamregDeclareIn !== '0',
      vamregStartDate: s.vamregStartDate || '',
      speciesMap: { ...DEFAULT_SPECIES, ...map },
    });
    if (s.vamregApiKey) loadRefs();
  }
  function loadRefs() {
    window.api.vamreg.ref('target-species').then(setSpecies).catch(() => {});
    window.api.vamreg.ref('provider-type').then(setProviders).catch(() => {});
  }
  const loadStatus = () => window.api.vamreg.status().then(setStatus).catch(() => {});

  useEffect(() => { loadSettings(); loadStatus(); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await window.api.settings.save({
        vamregEnabled: form.vamregEnabled ? '1' : '0',
        vamregEnvironment: form.vamregEnvironment,
        vamregApiKey: form.vamregApiKey,
        vamregDefaultVetOrderNumber: form.vamregDefaultVetOrderNumber,
        vamregDefaultProviderType: form.vamregDefaultProviderType,
        vamregDeclareIn: form.vamregDeclareIn ? '1' : '0',
        ...(form.vamregStartDate ? { vamregStartDate: form.vamregStartDate } : {}),
        vamregSpeciesMap: JSON.stringify(form.speciesMap),
      });
      setMsg({ ok: true, text: 'Réglages enregistrés.' });
      await loadSettings();
      setTimeout(loadStatus, 2500);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally { setBusy(false); }
  }

  async function test() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.vamreg.test();
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) loadRefs();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setMsg(null);
    try {
      const r = await window.api.vamreg.sync();
      if (r.skipped) setMsg({ ok: false, text: r.skipped });
      else if (r.fatal) setMsg({ ok: false, text: r.fatal });
      else setMsg({ ok: !r.errors, text: `Envoi terminé : ${r.created} créée(s), ${r.updated} modifiée(s), ${r.deleted} supprimée(s)${r.errors ? `, ${r.errors} à corriger` : ''}.` });
      await loadStatus();
    } catch (e) { setMsg({ ok: false, text: e.message }); } finally { setBusy(false); }
  }

  if (!form) return null;
  const c = status?.counts || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <h2>VAMREG 🇧🇪</h2>
          <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Registre des antimicrobiens à usage vétérinaire (AFMPS) — déclaration automatique des entrées et sorties d'antibiotiques.
          </div>
        </div>
        {form.vamregEnabled && (
          <button className="btn btn-primary" disabled={busy} onClick={syncNow}>Envoyer maintenant</button>
        )}
      </div>

      {msg && (
        <div className="card" style={{ borderLeft: `4px solid ${msg.ok ? '#16a34a' : '#dc2626'}`, padding: 12 }}>{msg.text}</div>
      )}

      {isAdmin && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Réglages du cabinet</h3>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, marginBottom: 12 }}>
            <input type="checkbox" checked={form.vamregEnabled} onChange={(e) => setForm({ ...form, vamregEnabled: e.target.checked })} />
            Activer les déclarations VAMREG (cabinet belge titulaire d'un dépôt vétérinaire)
          </label>

          <div className="form-grid-2">
            <div className="form-row">
              <label>Environnement</label>
              <select className="select" value={form.vamregEnvironment} onChange={(e) => setForm({ ...form, vamregEnvironment: e.target.value })}>
                <option value="uat">Test (UAT) — aucune déclaration réelle</option>
                <option value="prod">Production — déclarations officielles</option>
              </select>
            </div>
            <div className="form-row">
              <label>Clé API (secrète)</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" type="password" autoComplete="off" value={form.vamregApiKey}
                  onChange={(e) => setForm({ ...form, vamregApiKey: e.target.value })} placeholder="Coller la clé créée dans FAMHP Connect" />
                <button className="btn" disabled={busy} onClick={async () => { await save(); await test(); }}>Tester</button>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                À créer sur app.fagg-afmps.be → FAMHP Connect → onglet « Clés API ».
              </div>
            </div>
          </div>

          <div className="form-grid-2">
            <div className="form-row">
              <label>N° d'Ordre par défaut</label>
              <input className="input" value={form.vamregDefaultVetOrderNumber} maxLength={5} placeholder="ex. F2345"
                onChange={(e) => setForm({ ...form, vamregDefaultVetOrderNumber: e.target.value.toUpperCase() })} />
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                Utilisé quand le vétérinaire qui a facturé n'a pas son n° dans Utilisateurs.
              </div>
            </div>
            <div className="form-row">
              <label>Type de fournisseur par défaut (entrées)</label>
              <select className="select" value={form.vamregDefaultProviderType} onChange={(e) => setForm({ ...form, vamregDefaultProviderType: e.target.value })}>
                {(providers.length ? providers : [{ code: 'DIST_BE', fr: 'Distributeur Belge' }]).map((p) => <option key={p.code} value={p.code}>{p.fr}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid-2">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={form.vamregDeclareIn} onChange={(e) => setForm({ ...form, vamregDeclareIn: e.target.checked })} />
              Déclarer les entrées (réception des lots d'antibiotiques)
            </label>
            <div className="form-row">
              <label>Déclarer à partir du</label>
              <input className="input" type="date" value={form.vamregStartDate}
                onChange={(e) => setForm({ ...form, vamregStartDate: e.target.value })} />
              <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                Rien d'antérieur n'est envoyé. Rempli automatiquement le jour de l'activation.
              </div>
            </div>
          </div>

          <h4>Espèces déclarées (sorties)</h4>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginTop: 0 }}>
            Choisissez, pour chaque espèce de Colveto, l'espèce VAMREG correspondante — ou « Ne pas déclarer ».
            Les bovins, porcs et volailles ne figurent pas dans la liste VAMREG.
          </p>
          <table className="table" style={{ maxWidth: 560 }}>
            <tbody>
              {SPECIES.map((sp) => (
                <tr key={sp}>
                  <td style={{ width: 160 }}>{sp}</td>
                  <td>
                    <select className="select" value={form.speciesMap[sp] || ''}
                      onChange={(e) => setForm({ ...form, speciesMap: { ...form.speciesMap, [sp]: e.target.value } })}>
                      <option value="">Ne pas déclarer</option>
                      {(species.length ? species : [{ code: 'HORSE', fr: 'Cheval' }, { code: 'DOG', fr: 'Chien' }, { code: 'CAT', fr: 'Chat' }, { code: 'OTHER_NON_FOOD', fr: 'Autre animal (non producteur de denrées)' }])
                        .map((s) => <option key={s.code} value={s.code}>{s.fr}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <button className="btn btn-primary" disabled={busy} onClick={save}>Enregistrer</button>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
          <h3 style={{ margin: 0 }}>Déclarations</h3>
          {status && (
            <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              {status.env === 'prod' ? 'Production' : 'Test (UAT)'} · période modifiable depuis le {fmtDate(status.window?.start)}
              {status.lastResult?.at ? ` · dernier envoi ${new Date(status.lastResult.at).toLocaleString('fr-BE')}` : ''}
            </div>
          )}
        </div>
        {status?.lastResult?.fatal && (
          <div style={{ color: '#b91c1c', marginTop: 8 }}>⚠️ {status.lastResult.fatal}</div>
        )}
        {status?.lastResult?.skipped && !status.lastResult.fatal && (
          <div style={{ color: '#b45309', marginTop: 8 }}>⚠️ {status.lastResult.skipped}</div>
        )}
        <div style={{ display: 'flex', gap: 16, margin: '10px 0', fontSize: '0.9rem' }}>
          <span>✅ {c.sent || 0} envoyée(s)</span>
          <span>⏳ {c.pending || 0} en attente</span>
          <span style={{ color: c.error ? '#b91c1c' : undefined }}>⚠️ {c.error || 0} à corriger</span>
          {c.locked ? <span>🔒 {c.locked} trimestre clos</span> : null}
        </div>
        {!status?.rows?.length ? (
          <div className="empty-state">
            {form.vamregEnabled ? 'Aucune déclaration pour l\'instant.' : 'Module désactivé.'}
          </div>
        ) : (
          <table className="table" style={{ fontSize: '0.88rem' }}>
            <thead>
              <tr><th>Date</th><th>Registre</th><th>Détail</th><th>Statut</th></tr>
            </thead>
            <tbody>
              {status.rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.declDate)}</td>
                  <td>{r.register === 'IN' ? 'Entrée' : 'Sortie'}</td>
                  <td>
                    {r.label}
                    {r.lastError && <div style={{ color: r.status === 'error' ? '#b91c1c' : '#6b7280', fontSize: '0.8rem' }}>{r.lastError}</div>}
                  </td>
                  <td><span className={`badge ${(STATUS[r.status] || {}).cls || ''}`}>{(STATUS[r.status] || {}).label || r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
