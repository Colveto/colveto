import React, { useEffect, useState } from 'react';

// Assistant de paramétrage rapide, affiché une seule fois à l'administrateur
// d'une installation neuve (réglage setupCompleted = '0'). Tout reste
// modifiable ensuite dans Paramètres.

const DAYS = [
  { v: '1', l: 'Lun' }, { v: '2', l: 'Mar' }, { v: '3', l: 'Mer' }, { v: '4', l: 'Jeu' },
  { v: '5', l: 'Ven' }, { v: '6', l: 'Sam' }, { v: '0', l: 'Dim' },
];

const STEPS = ['Cabinet', 'Horaires', 'Emails', 'Facturation'];

const WIZARD_KEYS = [
  'clinicName', 'clinicAddress', 'clinicPostalCode', 'clinicCity', 'clinicPhone', 'clinicEmail',
  'clinicWebsite', 'clinicVatNumber',
  'cabinetOpenHour', 'cabinetCloseHour', 'cabinetClosedDays', 'publicBaseUrl',
  'smtpHost', 'smtpPort', 'smtpSecure', 'smtpUser', 'smtpFromEmail', 'smtpFromName',
  'invoicePrefix', 'invoiceCounter', 'invoiceCopyEmail',
];

function guessPublicUrl() {
  const { protocol, origin, hostname } = window.location;
  if (protocol !== 'https:' || hostname === 'localhost' || hostname === '127.0.0.1') return '';
  return origin;
}

export default function SetupWizard({ onDone }) {
  const [step, setStep] = useState(0);
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [testMsg, setTestMsg] = useState(null);

  useEffect(() => {
    window.api.settings.get().then((cur) => {
      setS({
        ...cur,
        clinicName: cur.clinicName === 'Mon cabinet vétérinaire' ? '' : (cur.clinicName || ''),
        publicBaseUrl: cur.publicBaseUrl || guessPublicUrl(),
        cabinetOpenHour: cur.cabinetOpenHour || '9',
        cabinetCloseHour: cur.cabinetCloseHour || '18',
        cabinetClosedDays: cur.cabinetClosedDays || '0,6',
        smtpPort: cur.smtpPort || '587',
        smtpSecure: cur.smtpSecure || '0',
      });
    }).catch((e) => setError(e.message));
  }, []);

  if (!s) {
    return <div className="auth-page"><div className="auth-card">{error || 'Chargement…'}</div></div>;
  }

  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const closed = new Set(s.cabinetClosedDays.split(',').map((x) => x.trim()).filter(Boolean));
  const toggleDay = (d) => {
    const next = new Set(closed);
    if (next.has(d)) next.delete(d); else next.add(d);
    set('cabinetClosedDays', [...next].join(','));
  };
  const field = (key, label, props = {}) => (
    <div className="form-group mt-2">
      <label>{label}</label>
      <input className="input" value={s[key] || ''} onChange={(e) => set(key, e.target.value)} {...props} />
    </div>
  );

  // N'envoie que les champs de l'assistant : un réglage modifié entre-temps
  // depuis un autre poste n'est pas écrasé.
  const save = async (extra = {}) => {
    const data = {};
    for (const k of WIZARD_KEYS) if (s[k] !== undefined) data[k] = s[k];
    if (s.smtpPass) data.smtpPass = s.smtpPass;
    await window.api.settings.save({ ...data, ...extra });
  };

  const next = async () => {
    setError(null);
    if (step === 0 && !s.clinicName.trim()) { setError('Indiquez le nom du cabinet.'); return; }
    setBusy(true);
    try {
      if (step < STEPS.length - 1) {
        await save();
        setStep(step + 1);
      } else {
        await save({ setupCompleted: '1' });
        onDone();
      }
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };

  const later = async () => {
    setBusy(true);
    try {
      await window.api.settings.save({ setupCompleted: '1' });
      onDone();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const testEmail = async () => {
    setTestMsg('Envoi…');
    try {
      await save();
      const r = await window.api.reminders.testEmail(s.smtpFromEmail);
      setTestMsg(`✓ Email de test envoyé à ${r.sentTo}`);
    } catch (e) {
      setTestMsg('✗ ' + e.message);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card" style={{ maxWidth: 560 }}>
        <h1>Paramétrage rapide</h1>
        <p className="text-light text-center" style={{ marginTop: 0 }}>
          Étape {step + 1} sur {STEPS.length} — {STEPS[step]}. Tout reste modifiable plus tard dans Paramètres.
        </p>
        <div style={{ display: 'flex', gap: 6, margin: '12px 0 8px' }}>
          {STEPS.map((label, i) => (
            <div key={label} style={{
              flex: 1, height: 4, borderRadius: 2,
              background: i <= step ? 'var(--primary, #2563eb)' : 'var(--border, #e5e7eb)',
            }} />
          ))}
        </div>

        {step === 0 && (
          <>
            {field('clinicName', 'Nom du cabinet *', { autoFocus: true, placeholder: 'Ex : Cabinet vétérinaire des Tilleuls' })}
            {field('clinicAddress', 'Adresse')}
            <div className="form-row">
              <div style={{ flex: 1 }}>{field('clinicPostalCode', 'Code postal')}</div>
              <div style={{ flex: 2 }}>{field('clinicCity', 'Ville')}</div>
            </div>
            <div className="form-row">
              <div style={{ flex: 1 }}>{field('clinicPhone', 'Téléphone')}</div>
              <div style={{ flex: 1 }}>{field('clinicEmail', 'Email', { type: 'email' })}</div>
            </div>
            {field('clinicWebsite', 'Site web', { placeholder: 'https://www.moncabinet.lu' })}
            {field('clinicVatNumber', 'N° de TVA')}
          </>
        )}

        {step === 1 && (
          <>
            <div className="form-row">
              <div style={{ flex: 1 }}>{field('cabinetOpenHour', "Heure d'ouverture", { type: 'number', min: 0, max: 23 })}</div>
              <div style={{ flex: 1 }}>{field('cabinetCloseHour', 'Heure de fermeture', { type: 'number', min: 1, max: 24 })}</div>
            </div>
            <div className="form-group mt-2">
              <label>Jours d'ouverture</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {DAYS.map((d) => (
                  <button key={d.v} type="button"
                    className={closed.has(d.v) ? 'btn' : 'btn btn-primary'}
                    style={closed.has(d.v) ? { textDecoration: 'line-through', opacity: 0.6 } : {}}
                    title={closed.has(d.v) ? 'Fermé' : 'Ouvert'}
                    onClick={() => toggleDay(d.v)}>{d.l}</button>
                ))}
              </div>
              <small className="text-light">En bleu : jours d'ouverture. Cliquez sur un jour pour l'ouvrir ou le fermer.</small>
            </div>
            {field('publicBaseUrl', 'Adresse publique de Colveto', { placeholder: 'https://rdv.moncabinet.lu' })}
            <small className="text-light">
              Sert aux liens de confirmation et d'annulation dans les emails, et à la page de prise de
              rendez-vous en ligne. Laissez vide si Colveto n'est pas accessible depuis Internet.
            </small>
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-light" style={{ marginTop: 0 }}>
              Pour envoyer les rappels de rendez-vous et les factures, indiquez le serveur d'envoi
              (SMTP) de votre messagerie. Votre fournisseur d'email donne ces informations.
              Vous pouvez passer cette étape.
            </p>
            <div className="form-row">
              <div style={{ flex: 2 }}>{field('smtpHost', 'Serveur SMTP', { placeholder: 'ex : smtp.monfournisseur.lu' })}</div>
              <div style={{ flex: 1 }}>{field('smtpPort', 'Port', { type: 'number' })}</div>
            </div>
            <div className="form-group mt-2">
              <label>Sécurité</label>
              <select className="select" value={s.smtpSecure} onChange={(e) => set('smtpSecure', e.target.value)}>
                <option value="0">STARTTLS (port 587)</option>
                <option value="1">SSL/TLS (port 465)</option>
              </select>
            </div>
            <div className="form-row">
              <div style={{ flex: 1 }}>{field('smtpUser', 'Identifiant')}</div>
              <div style={{ flex: 1 }}>
                <div className="form-group mt-2">
                  <label>Mot de passe</label>
                  <input className="input" type="password" value={s.smtpPass || ''}
                    onChange={(e) => set('smtpPass', e.target.value)} autoComplete="new-password" />
                </div>
              </div>
            </div>
            <div className="form-row">
              <div style={{ flex: 1 }}>{field('smtpFromEmail', "Adresse d'envoi", { type: 'email' })}</div>
              <div style={{ flex: 1 }}>{field('smtpFromName', "Nom d'expéditeur", { placeholder: s.clinicName })}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <button type="button" className="btn" onClick={testEmail} disabled={!s.smtpHost || !s.smtpFromEmail}>
                Envoyer un email de test
              </button>
              {testMsg && <small>{testMsg}</small>}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            {field('invoicePrefix', 'Préfixe des numéros de facture', { placeholder: 'F' })}
            {field('invoiceCounter', 'Prochain numéro de facture', { type: 'number', min: 1 })}
            {field('invoiceCopyEmail', 'Copie des factures payées à votre fiduciaire (email)', {
              type: 'email', placeholder: 'Laisser vide pour ne pas envoyer de copie',
            })}
            <p className="text-light" style={{ marginTop: 12 }}>
              Pensez ensuite à : ajouter vos collaborateurs (Utilisateurs), compléter le catalogue
              d'actes et de médicaments, activer la sauvegarde automatique (Paramètres).
            </p>
          </>
        )}

        {error && <div className="auth-error">{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 20, gap: 8 }}>
          <button type="button" className="btn" onClick={later} disabled={busy}>Plus tard</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)} disabled={busy}>Retour</button>}
            <button type="button" className="btn btn-primary" onClick={next} disabled={busy}>
              {busy ? '…' : step < STEPS.length - 1 ? 'Suivant' : 'Terminer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
