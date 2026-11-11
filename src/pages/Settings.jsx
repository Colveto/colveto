import React, { useEffect, useState } from 'react';
import { getApiBase, setApiBase } from '../lib/api.js';
import { useToast } from '../components/Toast.jsx';
import { useUpdateState } from '../components/UpdateBanner.jsx';

export default function Settings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState({});
  const [services, setServices] = useState([]);
  const [newService, setNewService] = useState({ code: '', name: '', priceHT: '', vatRate: 20, accountCode: '706000' });
  const [saved, setSaved] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBase());
  const [defaultServerUrl, setDefaultServerUrl] = useState(null);
  const [lanIp, setLanIp] = useState(null);
  const [serverPort, setServerPort] = useState(null);
  const [publicAccess, setPublicAccess] = useState(null); // appli de bureau uniquement

  // Backup state
  const [backupConfig, setBackupConfig] = useState({ enabled: false, time: '22:00', destinations: [] });
  const [backupStatus, setBackupStatus] = useState(null);
  const [backupList, setBackupList] = useState([]);
  const [newDestination, setNewDestination] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);

  // Appointment types state
  const [apptTypes, setApptTypes] = useState([]);
  const [newType, setNewType] = useState({ name: '', defaultDuration: 30, color: '#2563eb' });

  const loadApptTypes = () => window.api.appointmentTypes.list().then(setApptTypes);

  const loadBackup = async () => {
    try {
      const status = await window.api.backup.status();
      setBackupConfig({
        enabled: status.enabled,
        time: status.time,
        destinations: status.destinations,
      });
      setBackupStatus(status);
      const list = await window.api.backup.list();
      setBackupList(list);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    window.api.settings.get().then(setSettings);
    window.api.services.list().then(setServices);
    if (window.electronApi) {
      window.electronApi.getConfig().then((cfg) => {
        setDefaultServerUrl(cfg.defaultApiUrl);
        setLanIp(cfg.lanIp);
        setServerPort(cfg.port);
        setPublicAccess({ port: cfg.publicPort, running: !!cfg.publicAccessRunning });
      });
    }
    loadBackup();
    loadApptTypes();
  }, []);

  const addApptType = async () => {
    if (!newType.name) return;
    await window.api.appointmentTypes.create({
      name: newType.name,
      defaultDuration: parseInt(newType.defaultDuration, 10) || 30,
      color: newType.color,
      sortOrder: apptTypes.length + 1,
    });
    setNewType({ name: '', defaultDuration: 30, color: '#2563eb' });
    loadApptTypes();
  };

  const updateApptType = async (id, patch) => {
    const t = apptTypes.find((x) => x.id === id);
    if (!t) return;
    await window.api.appointmentTypes.update(id, { ...t, ...patch });
    loadApptTypes();
  };

  const deleteApptType = async (id) => {
    if (!confirm('Supprimer ce type de RDV ? Les RDV existants ne seront pas affectés mais perdront leur type.')) return;
    await window.api.appointmentTypes.delete(id);
    loadApptTypes();
  };

  // Sélection des types réservables en ligne (settings.publicBookableTypeIds = CSV d'ids ; vide = tous réservables)
  const bookableIds = () => (settings.publicBookableTypeIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isBookable = (id) => {
    const l = bookableIds();
    return l.length === 0 || l.includes(id);
  };
  const toggleBookable = async (id) => {
    const current = bookableIds();
    const base = current.length ? current : apptTypes.map((t) => t.id);
    const next = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    const csv = next.join(',');
    setSettings((s) => ({ ...s, publicBookableTypeIds: csv }));
    await window.api.settings.save({ publicBookableTypeIds: csv });
  };

  // Motifs autorisés pour un client coché « référé par un vétérinaire » sur sa
  // fiche (settings.referredAllowedTypeIds = CSV d'ids ; vide = aucune restriction).
  const referredIds = () => (settings.referredAllowedTypeIds || '').split(',').map((s) => s.trim()).filter(Boolean);
  const isReferredAllowed = (id) => referredIds().includes(id);
  const toggleReferredAllowed = async (id) => {
    const current = referredIds();
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    const csv = next.join(',');
    setSettings((s) => ({ ...s, referredAllowedTypeIds: csv }));
    await window.api.settings.save({ referredAllowedTypeIds: csv });
  };

  const [testEmailRecipient, setTestEmailRecipient] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);


  const sendTestEmail = async () => {
    setEmailBusy(true);
    try {
      // Save current SMTP config first
      await window.api.settings.save({
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpSecure: settings.smtpSecure,
        smtpUser: settings.smtpUser,
        smtpPass: settings.smtpPass,
        smtpFromEmail: settings.smtpFromEmail,
        smtpFromName: settings.smtpFromName,
      });
      const result = await window.api.reminders.testEmail(testEmailRecipient || settings.smtpFromEmail);
      showToast(`Email de test envoyé à ${result.sentTo} ✓`, 'success', 6000);
    } catch (e) {
      showToast('Échec : ' + e.message, 'error', 8000);
    }
    setEmailBusy(false);
  };

  const saveBackupConfig = async () => {
    setBackupBusy(true);
    try {
      await window.api.backup.saveConfig(backupConfig);
      showToast('Paramètres de sauvegarde enregistrés', 'success');
      await loadBackup();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    setBackupBusy(false);
  };

  const runBackupNow = async () => {
    if (backupConfig.destinations.length === 0) {
      showToast('Ajoutez d\'abord au moins une destination de sauvegarde', 'warning');
      return;
    }
    setBackupBusy(true);
    try {
      const result = await window.api.backup.runNow();
      if (result.ok) {
        showToast(`Sauvegarde effectuée vers ${result.written.length} destination(s)`, 'success');
      } else {
        showToast('Sauvegarde échouée : ' + (result.errors?.[0]?.error || 'erreur inconnue'), 'error');
      }
      await loadBackup();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    setBackupBusy(false);
  };

  const addDestination = () => {
    const path = newDestination.trim();
    if (!path) return;
    if (backupConfig.destinations.includes(path)) {
      showToast('Cette destination est déjà dans la liste', 'warning');
      return;
    }
    setBackupConfig({
      ...backupConfig,
      destinations: [...backupConfig.destinations, path],
    });
    setNewDestination('');
  };

  const removeDestination = (path) => {
    setBackupConfig({
      ...backupConfig,
      destinations: backupConfig.destinations.filter((d) => d !== path),
    });
  };

  const fmtSize = (bytes) => {
    if (bytes < 1024) return `${bytes} o`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  };

  const fmtRelativeTime = (iso) => {
    if (!iso) return 'Jamais';
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'À l\'instant';
    if (min < 60) return `Il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `Il y a ${h}h`;
    const d = Math.floor(h / 24);
    if (d < 7) return `Il y a ${d}j`;
    return new Date(iso).toLocaleDateString('fr-FR');
  };

  const saveServerUrl = () => {
    setApiBase(serverUrl.replace(/\/+$/, ''));
    if (confirm('URL du serveur enregistrée. Recharger l\'application maintenant ?')) {
      window.location.reload();
    }
  };

  const save = async () => {
    await window.api.settings.save(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addService = async () => {
    if (!newService.name || !newService.priceHT) return;
    await window.api.services.create({
      ...newService,
      priceHT: parseFloat(newService.priceHT),
      vatRate: parseFloat(newService.vatRate),
    });
    setNewService({ code: '', name: '', priceHT: '', vatRate: 20, accountCode: '706000' });
    window.api.services.list().then(setServices);
  };

  const deleteService = async (id) => {
    if (!confirm('Supprimer ce service ?')) return;
    await window.api.services.delete(id);
    window.api.services.list().then(setServices);
  };

  const set = (k, v) => setSettings({ ...settings, [k]: v });

  return (
    <div>
      <div className="page-header">
        <h2>Paramètres</h2>
      </div>

      <div className="card" style={{ background: '#eef2ff' }}>
        <h3 className="mt-2" style={{ marginTop: 0 }}>Serveur (multi-postes)</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Cette application peut fonctionner sur plusieurs ordinateurs du cabinet en se connectant tous au même serveur.
        </p>

        {lanIp && (
          <div className="mb-4" style={{
            padding: 12, background: 'white', borderRadius: 6, fontSize: 13,
          }}>
            <strong>📡 Ce PC peut servir de serveur pour les autres postes.</strong>
            <div className="mt-2">
              Sur les autres PC du cabinet, configurez l'URL du serveur sur :{' '}
              <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
                http://{lanIp}:{serverPort}
              </code>
            </div>
          </div>
        )}

        <div className="form-group">
          <label>URL du serveur</label>
          <input className="input" value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)} />
          <small className="text-light">
            {defaultServerUrl && <>Par défaut : <code>{defaultServerUrl}</code> (le serveur de ce PC).</>}
            {' '}Pour utiliser le serveur d'un autre PC, entrez son URL (ex : <code>http://192.168.1.10:3737</code>).
          </small>
        </div>
        <div className="flex-row mt-2" style={{ justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => { setServerUrl(defaultServerUrl); }}>
            Réinitialiser à ce PC
          </button>
          <button className="btn btn-primary" onClick={saveServerUrl}>
            Enregistrer et recharger
          </button>
        </div>
      </div>

      <div className="card" style={{ background: '#f0fdf4' }}>
        <h3 className="mt-2" style={{ marginTop: 0 }}>✉️ Rappels automatiques par email</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Envoi d'un email de rappel aux propriétaires avant leur rendez-vous.
          Configurez votre serveur d'email (SMTP) puis activez les rappels.
        </p>

        <h4 style={{ margin: '16px 0 8px 0', fontSize: 14 }}>Serveur SMTP (envoi d'email)</h4>
        <div className="form-row">
          <div className="form-group">
            <label>Serveur SMTP *</label>
            <input className="input" value={settings.smtpHost || ''}
              onChange={(e) => set('smtpHost', e.target.value)}
              placeholder="ex : smtp.gmail.com, smtp.orange.fr, ssl0.ovh.net" />
          </div>
          <div className="form-group">
            <label>Port</label>
            <input className="input" type="number" value={settings.smtpPort || '587'}
              onChange={(e) => set('smtpPort', e.target.value)}
              placeholder="587 (TLS) ou 465 (SSL)" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Connexion sécurisée</label>
            <select className="select" value={settings.smtpSecure || '0'}
              onChange={(e) => set('smtpSecure', e.target.value)}>
              <option value="0">STARTTLS (port 587)</option>
              <option value="1">SSL/TLS (port 465)</option>
            </select>
          </div>
          <div className="form-group">
            <label>Identifiant (souvent l'email)</label>
            <input className="input" value={settings.smtpUser || ''}
              onChange={(e) => set('smtpUser', e.target.value)}
              placeholder="cabinet@example.fr" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Mot de passe</label>
            <input className="input" type="password" value={settings.smtpPass || ''}
              onChange={(e) => set('smtpPass', e.target.value)}
              placeholder="••••••••" />
            <small className="text-light">
              Pour Gmail, créez un "mot de passe d'application" : compte Google → Sécurité → Mots de passe d'application.
            </small>
          </div>
          <div className="form-group">
            <label>Email expéditeur (visible)</label>
            <input className="input" value={settings.smtpFromEmail || ''}
              onChange={(e) => set('smtpFromEmail', e.target.value)}
              placeholder="cabinet@example.fr" />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Nom expéditeur (visible)</label>
            <input className="input" value={settings.smtpFromName || ''}
              onChange={(e) => set('smtpFromName', e.target.value)}
              placeholder="Cabinet Colveto" />
          </div>
        </div>

        <div className="flex-row mt-2" style={{ alignItems: 'flex-end', gap: 8 }}>
          <div className="form-group" style={{ flex: 1 }}>
            <label>Adresse pour test</label>
            <input className="input" value={testEmailRecipient}
              onChange={(e) => setTestEmailRecipient(e.target.value)}
              placeholder={settings.smtpFromEmail || 'votre-email@example.fr'} />
          </div>
          <button className="btn" disabled={emailBusy || !settings.smtpHost} onClick={sendTestEmail}>
            {emailBusy ? 'Envoi…' : '📧 Envoyer un email de test'}
          </button>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>Configuration des rappels</h4>
        <div className="form-row">
          <div className="form-group">
            <label>Activer les rappels automatiques</label>
            <select className="select" value={settings.reminderEnabled || '0'}
              onChange={(e) => set('reminderEnabled', e.target.value)}>
              <option value="1">Oui</option>
              <option value="0">Non</option>
            </select>
          </div>
          <div className="form-group">
            <label>Délai avant le RDV (en heures)</label>
            <input className="input" type="number" min="1" max="168"
              value={settings.reminderHoursBefore || '24'}
              onChange={(e) => set('reminderHoursBefore', e.target.value)} />
            <small className="text-light">Standard : 24 (la veille). Maximum : 168 (une semaine).</small>
          </div>
        </div>

        <div className="form-group mt-2">
          <label>URL publique du serveur (pour les liens de confirmation/annulation)</label>
          <input className="input" value={settings.publicBaseUrl || ''}
            onChange={(e) => set('publicBaseUrl', e.target.value)}
            placeholder="ex : https://rdv.moncabinet.fr — laisser vide pour désactiver les liens" />
          <small className="text-light">
            ⚠ Pour que les clients puissent cliquer sur "Confirmer" depuis chez eux, ce serveur doit être accessible
            depuis Internet. Sans URL publique, l'email contient juste un rappel passif (pas de liens cliquables).
            Solutions possibles : Tailscale (gratuit), Cloudflare Tunnel (gratuit), nom de domaine pointant
            vers votre IP publique.
          </small>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>📌 Modèle d'email pour rappels de suivi (vaccination, contrôle…)</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables : <code>{'{{ownerFirstName}}'}</code>, <code>{'{{patientName}}'}</code>,
          <code>{'{{title}}'}</code>, <code>{'{{notes}}'}</code>, <code>{'{{type}}'}</code>,
          <code>{'{{cabinetName}}'}</code>, <code>{'{{cabinetPhone}}'}</code>.
        </p>
        <div className="form-group">
          <label>Sujet (rappel de suivi)</label>
          <input className="input" value={settings.followUpEmailSubject || ''}
            onChange={(e) => set('followUpEmailSubject', e.target.value)}
            placeholder="Rappel pour {{patientName}} : {{title}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps (rappel de suivi)</label>
          <textarea className="textarea" value={settings.followUpEmailBody || ''}
            onChange={(e) => set('followUpEmailBody', e.target.value)}
            rows={8}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>📩 Modèle d'email pour rappels de RDV</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables disponibles : <code>{'{{ownerFirstName}}'}</code>, <code>{'{{ownerLastName}}'}</code>,
          <code>{'{{patientName}}'}</code>, <code>{'{{date}}'}</code>, <code>{'{{dayName}}'}</code>,
          <code>{'{{time}}'}</code>, <code>{'{{type}}'}</code>, <code>{'{{cabinetName}}'}</code>,
          <code>{'{{cabinetPhone}}'}</code>, <code>{'{{confirmUrl}}'}</code>, <code>{'{{cancelUrl}}'}</code>.
          Utilisez <code>{'{{#confirmUrl}}'}…{'{{/confirmUrl}}'}</code> pour n'afficher un bloc que si l'URL de confirmation est configurée.
        </p>
        <div className="form-group">
          <label>Sujet de l'email</label>
          <input className="input" value={settings.reminderEmailSubject || ''}
            onChange={(e) => set('reminderEmailSubject', e.target.value)}
            placeholder="Rappel de votre RDV chez {{cabinetName}} le {{dayName}} {{date}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps de l'email</label>
          <textarea className="textarea" value={settings.reminderEmailBody || ''}
            onChange={(e) => set('reminderEmailBody', e.target.value)}
            rows={12}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
          <small className="text-light">
            Astuce : si vous laissez vide, un modèle par défaut élégant est utilisé.
          </small>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>🧾 Modèle d'email pour l'envoi de facture</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables : <code>{'{{ownerFirstName}}'}</code>, <code>{'{{ownerLastName}}'}</code>,
          <code>{'{{patientName}}'}</code>, <code>{'{{invoiceNumber}}'}</code>,
          <code>{'{{invoiceDate}}'}</code>, <code>{'{{dueDate}}'}</code>,
          <code>{'{{invoiceTotal}}'}</code>, <code>{'{{invoiceTotalHT}}'}</code>,
          <code>{'{{cabinetName}}'}</code>, <code>{'{{cabinetPhone}}'}</code>,
          <code>{'{{clinicIban}}'}</code>, <code>{'{{clinicBic}}'}</code>.
          Vous pouvez aussi éditer le sujet/corps au cas par cas avant chaque envoi.
        </p>
        <div className="form-group">
          <label>Sujet de l'email</label>
          <input className="input" value={settings.invoiceEmailSubject || ''}
            onChange={(e) => set('invoiceEmailSubject', e.target.value)}
            placeholder="Votre facture {{invoiceNumber}} — {{cabinetName}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps de l'email</label>
          <textarea className="textarea" value={settings.invoiceEmailBody || ''}
            onChange={(e) => set('invoiceEmailBody', e.target.value)}
            rows={12}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
          <small className="text-light">
            Le PDF de la facture est joint automatiquement à l'email.
          </small>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>📋 Modèle d'email pour l'envoi d'un compte-rendu de consultation</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables : <code>{'{{patientName}}'}</code>, <code>{'{{ownerFirstName}}'}</code>, <code>{'{{ownerLastName}}'}</code>,
          <code>{'{{recordDate}}'}</code>, <code>{'{{recordType}}'}</code>, <code>{'{{recordTitle}}'}</code>,
          <code>{'{{cabinetName}}'}</code>, <code>{'{{cabinetPhone}}'}</code>.
        </p>
        <div className="form-group">
          <label>Sujet de l'email</label>
          <input className="input" value={settings.medicalRecordEmailSubject || ''}
            onChange={(e) => set('medicalRecordEmailSubject', e.target.value)}
            placeholder="Compte-rendu du {{recordDate}} pour {{patientName}} — {{cabinetName}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps de l'email</label>
          <textarea className="textarea" value={settings.medicalRecordEmailBody || ''}
            onChange={(e) => set('medicalRecordEmailBody', e.target.value)}
            rows={10}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
          <small className="text-light">
            Le PDF du compte-rendu (signalétique du patient + détails de l'acte) est joint automatiquement.
          </small>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>🐾 Modèle d'email pour l'envoi du dossier patient</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables : <code>{'{{patientName}}'}</code>, <code>{'{{patientSpecies}}'}</code>,
          <code>{'{{ownerFirstName}}'}</code>, <code>{'{{ownerLastName}}'}</code>,
          <code>{'{{cabinetName}}'}</code>, <code>{'{{cabinetPhone}}'}</code>,
          <code>{'{{cabinetEmail}}'}</code>.
        </p>
        <div className="form-group">
          <label>Sujet de l'email</label>
          <input className="input" value={settings.patientRecordEmailSubject || ''}
            onChange={(e) => set('patientRecordEmailSubject', e.target.value)}
            placeholder="Dossier médical de {{patientName}} — {{cabinetName}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps de l'email</label>
          <textarea className="textarea" value={settings.patientRecordEmailBody || ''}
            onChange={(e) => set('patientRecordEmailBody', e.target.value)}
            rows={12}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
          <small className="text-light">
            Le PDF du dossier complet est joint automatiquement à l'email.
          </small>
        </div>

        <h4 style={{ margin: '24px 0 8px 0', fontSize: 14 }}>🔬 Modèle d'email pour l'envoi des analyses</h4>
        <p className="text-light" style={{ fontSize: 12, marginTop: 0 }}>
          Variables : <code>{'{{patientName}}'}</code>, <code>{'{{ownerFirstName}}'}</code>, <code>{'{{ownerLastName}}'}</code>,
          <code>{'{{runDate}}'}</code>, <code>{'{{instrument}}'}</code>,
          <code>{'{{cabinetName}}'}</code>, <code>{'{{cabinetPhone}}'}</code>.
        </p>
        <div className="form-group">
          <label>Sujet de l'email</label>
          <input className="input" value={settings.labResultEmailSubject || ''}
            onChange={(e) => set('labResultEmailSubject', e.target.value)}
            placeholder="Résultats d'analyses de {{patientName}} — {{cabinetName}}" />
        </div>
        <div className="form-group mt-2">
          <label>Corps de l'email</label>
          <textarea className="textarea" value={settings.labResultEmailBody || ''}
            onChange={(e) => set('labResultEmailBody', e.target.value)}
            rows={10}
            placeholder="Laisser vide pour utiliser le modèle par défaut" />
          <small className="text-light">
            Le rapport PDF du laboratoire de l'analyse est joint automatiquement à l'email.
          </small>
        </div>
      </div>


      <div className="card">
        <h3 className="mt-2">📅 Horaires du cabinet</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Heures affichées dans l'agenda. Les RDV en dehors de ces heures restent visibles
          mais l'agenda est plus compact si on se concentre sur les heures d'ouverture.
        </p>
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Heure d'ouverture</label>
            <input className="input" type="number" min="0" max="23"
              value={settings.cabinetOpenHour || '9'}
              onChange={(e) => set('cabinetOpenHour', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Heure de fermeture</label>
            <input className="input" type="number" min="1" max="24"
              value={settings.cabinetCloseHour || '18'}
              onChange={(e) => set('cabinetCloseHour', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Granularité (min)</label>
            <select className="select" value={settings.cabinetSlotMinutes || '15'}
              onChange={(e) => set('cabinetSlotMinutes', e.target.value)}>
              <option value="15">15 minutes</option>
              <option value="20">20 minutes</option>
              <option value="30">30 minutes</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">🌐 Réservation en ligne</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Paramètres appliqués à la page publique de prise de rendez-vous.
        </p>
        {publicAccess && (
          <div className="form-group" style={{ background: '#f0f9ff', padding: 12, borderRadius: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.publicAccessEnabled === '1'}
                onChange={(e) => set('publicAccessEnabled', e.target.checked ? '1' : '0')} />
              Activer l'accès public pour la prise de rendez-vous depuis Internet
            </label>
            <small className="text-light">
              Ouvre sur ce PC un accès limité à la page de rendez-vous et aux liens des emails
              (port {publicAccess.port}) — jamais aux dossiers ni à l'application. Votre informaticien
              le publie ensuite sur Internet (guide RENDEZ-VOUS-EN-LIGNE.md). Enregistrez puis
              redémarrez Colveto pour appliquer.{' '}
              <strong>État actuel : {publicAccess.running ? 'actif' : 'inactif'}.</strong>
            </small>
          </div>
        )}
        <div className="form-group">
          <label>Délai minimum avant un RDV (heures)</label>
          <input className="input" type="number" min="0" max="720" step="0.5"
            value={settings.publicBookingMinAdvanceHours || '1'}
            onChange={(e) => set('publicBookingMinAdvanceHours', e.target.value)}
            style={{ maxWidth: 160 }} />
          <small className="text-light">
            Les créneaux trop proches sont masqués sur le site de réservation. Par défaut : 1 heure.
            Mettez 0 pour autoriser la réservation jusqu'à la dernière minute, 24 pour interdire les RDV le jour même, etc.
          </small>
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">🏷️ Types de rendez-vous</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Chaque type a une couleur et une durée par défaut. Quand vous choisissez un type
          dans l'agenda, la durée se règle automatiquement. La colonne <strong>« En ligne »</strong> contrôle
          les motifs proposés sur la page publique de prise de rendez-vous ; <strong>« Ordre »</strong> règle
          leur ordre d'affichage (du plus petit au plus grand).
        </p>
        <p className="text-light" style={{ marginTop: 0 }}>
          La colonne <strong>« Référés »</strong> liste les seuls motifs qu'un client coché
          « référé par un vétérinaire » peut prendre — en agenda comme en réservation en ligne.
          Elle évite qu'un patient adressé par son vétérinaire traitant vienne en médecine générale.
          {referredIds().length === 0 && (
            <strong> Aucune case cochée : la restriction est désactivée.</strong>
          )}
        </p>
        <table className="table">
          <thead>
            <tr><th>Couleur</th><th>Nom</th><th>Durée (min)</th><th>Ordre</th><th>En ligne</th><th>Référés</th><th></th></tr>
          </thead>
          <tbody>
            {apptTypes.map((t) => (
              <tr key={t.id}>
                <td>
                  <input type="color" value={t.color}
                    onChange={(e) => updateApptType(t.id, { color: e.target.value })}
                    style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }} />
                </td>
                <td>
                  <input className="input" defaultValue={t.name}
                    onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== t.name && updateApptType(t.id, { name: e.target.value.trim() })} />
                </td>
                <td>
                  <input className="input" type="number" defaultValue={t.defaultDuration}
                    onBlur={(e) => parseInt(e.target.value, 10) !== t.defaultDuration && updateApptType(t.id, { defaultDuration: parseInt(e.target.value, 10) })}
                    style={{ width: 80 }} />
                </td>
                <td>
                  <input className="input" type="number" defaultValue={t.sortOrder}
                    onBlur={(e) => (parseInt(e.target.value, 10) || 0) !== t.sortOrder && updateApptType(t.id, { sortOrder: parseInt(e.target.value, 10) || 0 })}
                    style={{ width: 70 }} />
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={isBookable(t.id)}
                    onChange={() => toggleBookable(t.id)}
                    title="Proposer ce motif sur la page de réservation en ligne"
                    style={{ width: 18, height: 18, cursor: 'pointer' }} />
                </td>
                <td className="text-center">
                  <input type="checkbox" checked={isReferredAllowed(t.id)}
                    onChange={() => toggleReferredAllowed(t.id)}
                    title="Autoriser ce motif pour les clients référés par un vétérinaire"
                    style={{ width: 18, height: 18, cursor: 'pointer' }} />
                </td>
                <td className="text-right">
                  <button className="btn btn-sm btn-danger" onClick={() => deleteApptType(t.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f9fafb' }}>
              <td>
                <input type="color" value={newType.color}
                  onChange={(e) => setNewType({ ...newType, color: e.target.value })}
                  style={{ width: 40, height: 30, border: 'none', cursor: 'pointer' }} />
              </td>
              <td>
                <input className="input" placeholder="Nom (ex : Téléconsultation)" value={newType.name}
                  onChange={(e) => setNewType({ ...newType, name: e.target.value })} />
              </td>
              <td>
                <input className="input" type="number" value={newType.defaultDuration}
                  onChange={(e) => setNewType({ ...newType, defaultDuration: e.target.value })}
                  style={{ width: 80 }} />
              </td>
              <td></td>
              <td></td>
              <td></td>
              <td><button className="btn btn-sm btn-primary" onClick={addApptType}>+ Ajouter</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 className="mt-2">Cabinet</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Nom du cabinet</label>
            <input className="input" value={settings.clinicName || ''}
              onChange={(e) => set('clinicName', e.target.value)} />
          </div>
          <div className="form-group">
            <label>N° d'entreprise (RCS / SIRET)</label>
            <input className="input" value={settings.clinicSiret || ''}
              onChange={(e) => set('clinicSiret', e.target.value)} />
          </div>
        </div>
        <div className="form-row cols-1">
          <div className="form-group">
            <label>Adresse</label>
            <input className="input" value={settings.clinicAddress || ''}
              onChange={(e) => set('clinicAddress', e.target.value)} />
          </div>
        </div>
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Code postal</label>
            <input className="input" value={settings.clinicPostalCode || ''}
              onChange={(e) => set('clinicPostalCode', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Ville</label>
            <input className="input" value={settings.clinicCity || ''}
              onChange={(e) => set('clinicCity', e.target.value)} />
          </div>
          <div className="form-group">
            <label>N° TVA</label>
            <input className="input" value={settings.clinicVatNumber || ''}
              onChange={(e) => set('clinicVatNumber', e.target.value)} />
          </div>
        </div>
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Téléphone</label>
            <input className="input" value={settings.clinicPhone || ''}
              onChange={(e) => set('clinicPhone', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input className="input" type="email" value={settings.clinicEmail || ''}
              onChange={(e) => set('clinicEmail', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Site web</label>
            <input className="input" value={settings.clinicWebsite || ''}
              onChange={(e) => set('clinicWebsite', e.target.value)}
              placeholder="https://www.moncabinet.lu" />
          </div>
        </div>
        <div className="form-group">
          <label>Signature des emails</label>
          <textarea className="input" rows={4} value={settings.emailSignature || ''}
            onChange={(e) => set('emailSignature', e.target.value)}
            placeholder={'Laisser vide pour : nom du cabinet, site web, téléphone'} />
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">Facturation</h3>
        <div className="form-row">
          <div className="form-group">
            <label>Préfixe N° facture</label>
            <input className="input" value={settings.invoicePrefix || ''}
              onChange={(e) => set('invoicePrefix', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Compteur (prochain numéro)</label>
            <input className="input" type="number" value={settings.invoiceCounter || '1'}
              onChange={(e) => set('invoiceCounter', e.target.value)} />
          </div>
        </div>
        <div className="form-group">
          <label>Copie comptable des factures payées (email)</label>
          <input className="input" type="email" value={settings.invoiceCopyEmail || ''}
            onChange={(e) => set('invoiceCopyEmail', e.target.value)}
            placeholder="ex : adresse de dépôt de votre fiduciaire — laisser vide pour désactiver" />
          <small className="text-light">Chaque facture qui passe en « payée » y est envoyée en PDF.</small>
        </div>
      </div>

      <UpdatesCard settings={settings} set={set} />

      <DataExportCard showToast={showToast} />

      <div className="card">
        <h3 className="mt-2">📥 Importer des données</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Reprenez les clients et les animaux de votre ancien logiciel à partir d'un export Excel
          ou CSV. Aperçu avant import, doublons évités, annulation possible.
        </p>
        <a className="btn btn-primary" href="#/import">Ouvrir l'assistant d'import</a>
      </div>

      <div className="card">
        <h3 className="mt-2">Comptabilité Sage</h3>
        <div className="form-row cols-3">
          <div className="form-group">
            <label>Code journal</label>
            <input className="input" value={settings.sageJournalCode || ''}
              onChange={(e) => set('sageJournalCode', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Compte TVA collectée</label>
            <input className="input" value={settings.sageVatAccount || ''}
              onChange={(e) => set('sageVatAccount', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Compte clients</label>
            <input className="input" value={settings.sageClientAccount || ''}
              onChange={(e) => set('sageClientAccount', e.target.value)} />
          </div>
        </div>
      </div>

      <div className="flex-row mb-4" style={{ justifyContent: 'flex-end' }}>
        {saved && <span style={{ color: 'var(--success)' }}>✓ Enregistré</span>}
        <button className="btn btn-primary" onClick={save}>Enregistrer les paramètres</button>
      </div>

      <div className="card" style={{ background: '#fefce8' }}>
        <h3 className="mt-2" style={{ marginTop: 0 }}>💾 Sauvegarde de la base de données</h3>
        <p className="text-light" style={{ marginTop: 0 }}>
          Sauvegarde automatique de tous vos dossiers patients, propriétaires, RDV et factures.
          Configurez une ou plusieurs destinations (clé USB, dossier iCloud Drive, OneDrive…).
        </p>

        <div className="form-row">
          <div className="form-group">
            <label>Activer la sauvegarde automatique</label>
            <select className="select" value={backupConfig.enabled ? '1' : '0'}
              onChange={(e) => setBackupConfig({ ...backupConfig, enabled: e.target.value === '1' })}>
              <option value="1">Oui</option>
              <option value="0">Non</option>
            </select>
          </div>
          <div className="form-group">
            <label>Heure de sauvegarde quotidienne</label>
            <input className="input" type="time" value={backupConfig.time}
              onChange={(e) => setBackupConfig({ ...backupConfig, time: e.target.value })} />
          </div>
        </div>

        <div className="form-group mt-2">
          <label>Destinations de sauvegarde</label>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input className="input" value={newDestination}
              onChange={(e) => setNewDestination(e.target.value)}
              placeholder="Ex : E:\Sauvegarde   ou   C:\Users\VotreNom\iCloudDrive\Cabinet"
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDestination(); } }} />
            <button className="btn btn-primary" onClick={addDestination} type="button">+ Ajouter</button>
          </div>
          <small className="text-light">
            Astuce : pour la clé USB, branchez-la et regardez sa lettre dans l'Explorateur (ex : <code>E:</code>).
            Pour iCloud Drive, le chemin est habituellement <code>C:\Users\VotreNom\iCloudDrive</code>.
          </small>

          {backupConfig.destinations.length === 0 ? (
            <div className="empty-state" style={{ padding: 16 }}>Aucune destination configurée.</div>
          ) : (
            <table className="table" style={{ background: 'white', marginTop: 8 }}>
              <thead>
                <tr><th>Chemin</th><th></th></tr>
              </thead>
              <tbody>
                {backupConfig.destinations.map((d) => (
                  <tr key={d}>
                    <td><code>{d}</code></td>
                    <td className="text-right">
                      <button className="btn btn-sm btn-danger" type="button"
                        onClick={() => removeDestination(d)}>Retirer</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex-row mt-4" style={{ justifyContent: 'space-between' }}>
          <div className="text-light" style={{ fontSize: 13 }}>
            <strong>Dernière sauvegarde : </strong>
            {backupStatus?.lastBackupAt ? (
              <>
                {fmtRelativeTime(backupStatus.lastBackupAt)}
                {backupStatus.lastBackupResult?.ok === false && (
                  <span style={{ color: 'var(--danger)' }}> ⚠ Échec</span>
                )}
              </>
            ) : 'Jamais'}
          </div>
          <div className="flex-row">
            <button className="btn" onClick={runBackupNow} disabled={backupBusy}>
              {backupBusy ? 'En cours…' : '💾 Sauvegarder maintenant'}
            </button>
            <button className="btn btn-primary" onClick={saveBackupConfig} disabled={backupBusy}>
              Enregistrer la config
            </button>
          </div>
        </div>

        {backupList.length > 0 && (
          <div className="mt-4">
            <strong style={{ fontSize: 13 }}>Historique des sauvegardes ({backupList.length})</strong>
            <table className="table" style={{ background: 'white', marginTop: 8, fontSize: 13 }}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Destination</th>
                  <th>Taille</th>
                  <th>Fichier</th>
                </tr>
              </thead>
              <tbody>
                {backupList.slice(0, 10).map((b) => (
                  <tr key={b.path}>
                    <td>{new Date(b.createdAt).toLocaleString('fr-FR')}</td>
                    <td><code style={{ fontSize: 11 }}>{b.destination}</code></td>
                    <td>{fmtSize(b.size)}</td>
                    <td style={{ fontSize: 11 }}><code>{b.filename}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {backupList.length > 10 && (
              <small className="text-light">… et {backupList.length - 10} sauvegarde(s) plus ancienne(s).</small>
            )}
            <small className="text-light" style={{ display: 'block', marginTop: 8 }}>
              Politique de rétention : 30 dernières sauvegardes quotidiennes + 1 par mois pendant 5 ans.
              Les fichiers plus anciens sont supprimés automatiquement.
            </small>
          </div>
        )}

        <div className="mt-4" style={{
          padding: 12, background: '#eff6ff', borderRadius: 6, fontSize: 12,
        }}>
          <strong>Comment restaurer une sauvegarde ?</strong>
          <ol style={{ marginBottom: 0 }}>
            <li>Fermez l'application complètement</li>
            <li>Récupérez le fichier <code>.db</code> de la sauvegarde voulue (sur la clé USB ou dans iCloud)</li>
            <li>Ouvrez le dossier de données de Colveto :
              <br />Windows : touches Windows + R, puis <code>%APPDATA%\Colveto</code>
              <br />Mac : Finder → Aller → Aller au dossier, puis <code>~/Library/Application Support/Colveto</code>
              <br />Serveur (VPS) : <code>/var/lib/vet-clinic</code></li>
            <li>Renommez le fichier <code>vet-clinic.db</code> existant en <code>vet-clinic.db.old</code></li>
            <li>Copiez le fichier de sauvegarde dans ce dossier et renommez-le en <code>vet-clinic.db</code></li>
            <li>Relancez l'application</li>
          </ol>
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">Catalogue de services</h3>
        <table className="table">
          <thead>
            <tr><th>Code</th><th>Nom</th><th>Prix HT</th><th>TVA</th><th>Compte</th><th></th></tr>
          </thead>
          <tbody>
            {services.map((s) => (
              <tr key={s.id}>
                <td>{s.code || '—'}</td>
                <td>{s.name}</td>
                <td>{s.priceHT.toFixed(2)} €</td>
                <td>{s.vatRate} %</td>
                <td>{s.accountCode}</td>
                <td className="text-right">
                  <button className="btn btn-sm btn-danger" onClick={() => deleteService(s.id)}>Supprimer</button>
                </td>
              </tr>
            ))}
            <tr style={{ background: '#f9fafb' }}>
              <td><input className="input" placeholder="Code" value={newService.code}
                onChange={(e) => setNewService({ ...newService, code: e.target.value })} /></td>
              <td><input className="input" placeholder="Nom du service *" value={newService.name}
                onChange={(e) => setNewService({ ...newService, name: e.target.value })} /></td>
              <td><input className="input" type="number" step="0.01" placeholder="0.00" value={newService.priceHT}
                onChange={(e) => setNewService({ ...newService, priceHT: e.target.value })} /></td>
              <td><input className="input" type="number" step="0.1" value={newService.vatRate}
                onChange={(e) => setNewService({ ...newService, vatRate: e.target.value })} /></td>
              <td><input className="input" value={newService.accountCode}
                onChange={(e) => setNewService({ ...newService, accountCode: e.target.value })} /></td>
              <td><button className="btn btn-sm btn-primary" onClick={addService}>+ Ajouter</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Export complet des données du cabinet : JSON (tout) ou CSV (une table).
function DataExportCard({ showToast }) {
  const [data, setData] = useState(null);
  const [table, setTable] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const d = await window.api.dataExport.all();
      setData(d);
      setTable(Object.keys(d.tables)[0] || '');
      return d;
    } catch (e) {
      showToast('Export impossible : ' + e.message, 'error');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const downloadJSON = async () => {
    const d = data || await load();
    if (d) window.api.dataExport.downloadJSON(d);
  };
  const downloadClientsAnimals = async () => {
    const d = data || await load();
    if (d) window.api.dataExport.downloadClientsAnimalsCSV(d);
  };

  return (
    <div className="card">
      <h3 className="mt-2">📤 Exporter mes données</h3>
      <p className="text-light" style={{ marginTop: 0 }}>
        Toutes les données du cabinet (clients, animaux, dossiers, rendez-vous, factures, stock…),
        lisibles sans Colveto. Les mots de passe et secrets ne sont pas exportés.
        Les pièces jointes (radios, photos) restent dans le dossier de données du serveur.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" onClick={downloadJSON} disabled={loading}>
          {loading ? 'Préparation…' : 'Tout télécharger (JSON)'}
        </button>
        <button className="btn" onClick={downloadClientsAnimals} disabled={loading}
          title="Un seul fichier, une ligne par animal — se réimporte tel quel dans un autre Colveto">
          Clients et animaux (CSV)
        </button>
        {!data ? (
          <button className="btn btn-secondary" onClick={load} disabled={loading}>Exporter une table en CSV…</button>
        ) : (
          <>
            <select className="input" style={{ width: 'auto' }} value={table} onChange={(e) => setTable(e.target.value)}>
              {Object.entries(data.tables).map(([name, rows]) => (
                <option key={name} value={name}>{name} ({rows.length})</option>
              ))}
            </select>
            <button className="btn btn-secondary" onClick={() => window.api.dataExport.downloadCSV(data, table)} disabled={!table}>
              Télécharger en CSV
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Mises à jour automatiques (application de bureau uniquement).
function UpdatesCard({ settings, set }) {
  const [st, setSt] = useUpdateState();
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const check = async () => {
    setBusy(true);
    try { setSt(await window.electronApi.checkForUpdates()); } finally { setBusy(false); }
  };
  const label = {
    idle: '', checking: 'Recherche en cours…', 'up-to-date': 'Vous avez la dernière version.',
    available: `Version ${st.latest} disponible.`, downloading: `Téléchargement de la version ${st.latest}…`,
    ready: `Version ${st.latest} prête à installer (voir le bandeau en haut).`,
    unconfigured: 'Mises à jour non configurées dans cette version.', error: `Erreur : ${st.error}`,
  }[st.status] || '';
  return (
    <div className="card">
      <h3 className="mt-2" style={{ marginTop: 0 }}>🔄 Mises à jour</h3>
      <p className="text-light" style={{ marginTop: 0 }}>
        Version installée : <strong>{st.current}</strong>. {label}
      </p>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input type="checkbox" checked={settings.updateCheckEnabled !== '0'}
          onChange={(e) => set('updateCheckEnabled', e.target.checked ? '1' : '0')} />
        Rechercher automatiquement les nouvelles versions (au démarrage puis toutes les 6 heures)
      </label>
      <small className="text-light" style={{ display: 'block', marginBottom: 10 }}>
        Colveto consulte la liste des versions publiées sur GitHub ; aucune donnée du cabinet n'est envoyée.
        {st.platform === 'win32'
          ? ' Sur Windows, la nouvelle version se télécharge seule et s’installe quand vous cliquez sur « Redémarrer et installer ».'
          : ' Sur Mac, un lien permet de télécharger la nouvelle version, à glisser dans le dossier Applications.'}
        {' '}Une copie de la base est faite avant chaque installation.
      </small>
      <button className="btn" onClick={check} disabled={busy || !st.configured}>
        {busy ? 'Recherche…' : 'Rechercher maintenant'}
      </button>
    </div>
  );
}
