// Portail vétérinaires référents : soumission de cas, accusé de réception,
// suivi par lien magique, et gestion staff des dossiers reçus.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { sendEmail, looksLikeLink } = require('./email');
const { renderTemplate } = require('./reminders');
const { issueReferralToken, resolveReferralToken } = require('./referral-tokens');

const VALID_STATUSES = ['submitted', 'under_review', 'scheduled', 'in_treatment', 'completed', 'declined'];
const FILE_MIME_WHITELIST = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
// Pièces jointes patient (staff, authentifié) : mêmes types + vidéos (démarches
// de boiterie, etc.). Volontairement séparé de FILE_MIME_WHITELIST pour ne pas
// ouvrir l'upload vidéo sur le formulaire public /api/public/referrals.
const ATTACHMENT_MIME_WHITELIST = [...FILE_MIME_WHITELIST, 'video/mp4', 'video/quicktime', 'video/webm'];
function renderReferralHtml(textBody) {
  const escaped = textBody
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;">$1</a>'
  );
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:white;padding:24px;border-radius:8px;border:1px solid #e5e7eb;">
${linked.split('\n').map((l) => `<div>${l || '&nbsp;'}</div>`).join('')}
</div></body></html>`;
}

function sanitizeFilename(name) {
  const base = String(name || 'fichier').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
  return base || 'fichier';
}

function storeFileBuffer(userDataPath, subdir, ownerId, buffer, originalName) {
  const dir = path.join(userDataPath, subdir, ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const storedFilename = `${crypto.randomUUID()}-${sanitizeFilename(originalName)}`;
  fs.writeFileSync(path.join(dir, storedFilename), buffer);
  return storedFilename;
}

function diskPath(userDataPath, subdir, ownerId, storedFilename) {
  return path.join(userDataPath, subdir, ownerId, storedFilename);
}

function streamFile(res, absPath, { originalName, mimeType }) {
  if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Fichier introuvable.' });
  res.setHeader('Content-Type', mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${sanitizeFilename(originalName)}"`);
  fs.createReadStream(absPath).pipe(res);
}

// Wraps multer so upload errors (size/count/type) come back as JSON, not an
// unhandled exception or an HTML error page — matches the rest of the API.
function uploadMiddleware(fields, {
  mimeWhitelist = FILE_MIME_WHITELIST,
  maxFileSize = 25 * 1024 * 1024,
  rejectMessage = 'Type de fichier non autorisé (PDF, JPEG, PNG ou WEBP uniquement).',
} = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSize, files: 12 },
    fileFilter: (req, file, cb) => {
      if (!mimeWhitelist.includes(file.mimetype)) {
        return cb(Object.assign(new Error(rejectMessage), { status: 400 }));
      }
      cb(null, true);
    },
  }).fields(fields);
  return (req, res, next) => {
    upload(req, res, (err) => {
      if (err) return res.status(err.status || 400).json({ error: err.message || 'Erreur de téléversement.' });
      next();
    });
  };
}

// ----- Per-IP rate limiting (mirrors server.js's login throttle pattern) -----
function makeLimiter({ windowMs, maxHits, blockMs, message }) {
  const hits = new Map(); // ip -> { count, windowStart, blockedUntil }
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) {
      if (rec.blockedUntil < now && (now - rec.windowStart) > windowMs) hits.delete(ip);
    }
  }, 30 * 60 * 1000);
  if (cleanup.unref) cleanup.unref();
  return (req, res, next) => {
    const now = Date.now();
    let rec = hits.get(req.ip);
    if (rec && rec.blockedUntil > now) {
      const retry = Math.ceil((rec.blockedUntil - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `${message} Réessayez dans ${Math.ceil(retry / 60)} min.` });
    }
    if (!rec || (now - rec.windowStart) > windowMs) rec = { count: 0, windowStart: now, blockedUntil: 0 };
    rec.count += 1;
    if (rec.count > maxHits) rec.blockedUntil = now + blockMs;
    hits.set(req.ip, rec);
    if (rec.blockedUntil > now) {
      return res.status(429).json({ error: `${message} Réessayez plus tard.` });
    }
    next();
  };
}

// ----- Email templates -----
const ACK_SUBJECT = '{{patientName}} ({{ownerLastName}}) — dossier bien reçu — {{cabinetName}}';
const ACK_BODY = `Bonjour Dr {{referringVetName}},

Nous vous remercions d'avoir référé {{patientName}} chez {{cabinetName}}.

Afin que vous puissiez suivre au mieux l'évolution de votre patient pendant son passage chez nous, voici un lien sécurisé vous permettant de consulter son dossier à tout moment :
{{viewUrl}}

Nous reviendrons vers vous dès que possible.

À très bientôt,
L'équipe {{cabinetName}}`;

const STATUS_SUBJECT = '{{patientName}} ({{ownerLastName}}) — mise à jour du dossier — {{cabinetName}}';
const STATUS_BODY = `Bonjour Dr {{referringVetName}},

Le statut du dossier de {{patientName}} (réf. {{reference}}) a été mis à jour : {{statusLabel}}.
{{#note}}
{{note}}
{{/note}}

Vous pouvez consulter le détail du dossier ici :
{{viewUrl}}

À très bientôt,
L'équipe {{cabinetName}}`;

const RESEND_SUBJECT = '{{patientName}} ({{ownerLastName}}) — votre lien de suivi — {{cabinetName}}';
const RESEND_BODY = `Bonjour Dr {{referringVetName}},

Voici votre lien de suivi pour le dossier {{reference}} ({{patientName}}) :
{{viewUrl}}

À très bientôt,
L'équipe {{cabinetName}}`;

const STAFF_NOTIFY_SUBJECT = 'Nouveau patient référé : {{patientName}} ({{ownerLastName}}) — {{referringVetName}}';
const STAFF_NOTIFY_BODY = `Nouveau dossier reçu via le portail vétérinaires référents.

Référence : {{reference}}
Patient : {{patientName}}{{#species}} ({{species}}){{/species}}
Propriétaire : {{ownerLastName}}
Vétérinaire référent : Dr {{referringVetName}}{{#referringVetClinic}} — {{referringVetClinic}}{{/referringVetClinic}}
Contact : {{referringVetEmail}}{{#referringVetPhone}} · {{referringVetPhone}}{{/referringVetPhone}}

Motif : {{reasonForReferral}}

Voir le dossier dans Colveto :
{{staffUrl}}`;

const STATUS_LABELS = {
  submitted: 'Dossier reçu',
  under_review: 'En cours d’évaluation',
  scheduled: 'Rendez-vous programmé',
  in_treatment: 'Prise en charge en cours',
  completed: 'Soins terminés',
  declined: 'Dossier non retenu',
};

// ----- Sending an attachment (radio/photo/document) to the owner by email -----
// "Mme/Mr" kept literally (not resolved per-owner): owners have no stored
// civility field.
const ATTACHMENT_EMAIL_TEMPLATES = {
  fr: {
    subject: 'Document pour {{patientName}} — {{cabinetName}}',
    body: `Bonjour Mme/Mr {{ownerLastName}},

Vous trouverez en pièce jointe les documents concernant votre animal.

Bien à vous,
{{cabinetSignature}}`,
  },
  en: {
    subject: 'Document for {{patientName}} — {{cabinetName}}',
    body: `Dear Mrs/Mr {{ownerLastName}},

Please find attached the documents concerning your pet.

Kind regards,
{{cabinetSignature}}`,
  },
};

function buildAttachmentVars(attachment, patient, owner, settings) {
  return {
    ownerFirstName: owner?.firstName || '',
    ownerLastName: owner?.lastName || '',
    patientName: patient?.name || 'votre animal',
    originalName: attachment.originalName,
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetSignature: emailSignature(settings),
  };
}

// Signature des emails : Paramètres → emailSignature (texte libre, plusieurs
// lignes) ; à défaut, nom du cabinet + site + téléphone.
function emailSignature(settings) {
  const custom = (settings.emailSignature || '').trim();
  if (custom) return custom;
  const site = String(settings.clinicWebsite || settings.publicBaseUrl || '')
    .trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return [settings.clinicName, site, settings.clinicPhone].filter((x) => x && String(x).trim()).join('\n');
}

function referralViewUrl(settings, rawToken) {
  const base = (settings.publicBaseUrl || '').replace(/\/+$/, '');
  return `${base}/suivi.html?token=${rawToken}`;
}

function staffCaseUrl(settings, caseId) {
  const base = (settings.publicBaseUrl || '').replace(/\/+$/, '');
  return `${base}/app/#/referrals/${caseId}`;
}

// Who at the clinic should be told a new case came in. No dedicated Settings
// UI field yet — reuses the SMTP "from" address, which is usually the
// clinic's own inbox and already configured, so this works with zero
// extra setup. `referralNotificationEmail` can override it if ever needed.
function staffNotificationRecipient(settings) {
  return settings.referralNotificationEmail || settings.smtpFromEmail || settings.smtpUser || null;
}

async function sendReferralEmail(settings, { to, subject, body, vars }) {
  const text = renderTemplate(body, vars);
  const finalSubject = renderTemplate(subject, vars);
  const html = renderReferralHtml(text);
  try {
    await sendEmail(settings, { to, subject: finalSubject, text, html });
    return { ok: true };
  } catch (e) {
    // Never let a missing/broken SMTP config break a referral submission or
    // a staff status update — log and continue (mirrors reminders.js's pattern).
    console.error('[referrals] envoi email échoué:', e.message);
    return { ok: false, error: e.message };
  }
}

// Assembles what an external referring vet is allowed to see for a case.
// Deliberately never touches dispensings/invoices, and hand-picks fields from
// patients/owners/follow-ups rather than passing db.getPatient()/getOwner()
// results through as-is (those carry ownerPhone/email/address).
function buildReferrerCaseView(db, kase) {
  const events = db.listReferralEvents(kase.id, { referrerOnly: true });
  const intakeFiles = db.listReferralIntakeFiles(kase.id).map((f) => ({
    id: f.id, category: f.category, originalName: f.originalName,
    mimeType: f.mimeType, sizeBytes: f.sizeBytes, uploadedAt: f.uploadedAt, source: 'intake',
  }));

  const view = {
    reference: kase.reference,
    status: kase.status,
    statusLabel: STATUS_LABELS[kase.status] || kase.status,
    referringVetName: kase.referringVetName,
    patientName: kase.patientName,
    species: kase.species,
    breed: kase.breed,
    reasonForReferral: kase.reasonForReferral,
    createdAt: kase.createdAt,
    linked: !!kase.patientId,
    events,
    files: intakeFiles,
    patient: null,
    owner: null,
    records: [],
    followUps: [],
    labResults: [],
  };

  if (kase.patientId) {
    const rawPatient = db.getPatient(kase.patientId);
    if (rawPatient) {
      view.patient = {
        name: rawPatient.name, species: rawPatient.species, breed: rawPatient.breed,
        sex: rawPatient.sex, birthDate: rawPatient.birthDate, weight: rawPatient.weight,
        color: rawPatient.color, sterilized: rawPatient.sterilized, allergies: rawPatient.allergies,
      };
      view.owner = { firstName: rawPatient.ownerFirstName, lastName: rawPatient.ownerLastName };
    }
    view.records = db.listMedicalRecords(kase.patientId);
    view.followUps = db.listFollowUpReminders({ patientId: kase.patientId })
      .map((f) => ({ id: f.id, title: f.title, type: f.type, notes: f.notes, scheduledDate: f.scheduledDate, status: f.status }));
    view.labResults = db.listLabResults(kase.patientId);
    const clinicFiles = db.listAttachments(kase.patientId, { referrerOnly: true })
      .map((a) => ({
        id: a.id, category: a.category, originalName: a.originalName,
        mimeType: a.mimeType, sizeBytes: a.sizeBytes, uploadedAt: a.createdAt, source: 'clinic',
      }));
    view.files = [...view.files, ...clinicFiles].sort((a, b) => (a.uploadedAt < b.uploadedAt ? -1 : 1));
  }

  return view;
}

function registerReferralRoutes(app, { db, userDataPath, authRequired, requireRole, wrap }) {
  const submitLimiter = makeLimiter({
    windowMs: 60 * 60 * 1000, maxHits: 10, blockMs: 60 * 60 * 1000,
    message: 'Trop de soumissions depuis cette adresse.',
  });
  const resendLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000, maxHits: 5, blockMs: 30 * 60 * 1000,
    message: 'Trop de demandes de renvoi de lien.',
  });
  const fileLimiter = makeLimiter({
    windowMs: 15 * 60 * 1000, maxHits: 60, blockMs: 15 * 60 * 1000,
    message: 'Trop de requêtes.',
  });

  // ===== Public =====
  app.post('/api/public/referrals', submitLimiter,
    uploadMiddleware([{ name: 'dossier', maxCount: 4 }, { name: 'radios', maxCount: 8 }]),
    wrap(async (req, res) => {
      const b = req.body || {};
      for (const f of ['referringVetName', 'referringVetEmail', 'patientName', 'ownerLastName']) {
        if (!b[f] || !String(b[f]).trim()) {
          return res.status(400).json({ error: `Champ requis manquant : ${f}` });
        }
      }
      // Ces champs sont recopiés dans l'accusé de réception envoyé à l'adresse saisie.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.referringVetEmail).trim())) {
        return res.status(400).json({ error: 'Adresse e-mail invalide.' });
      }
      if (['referringVetName', 'referringVetClinic', 'patientName', 'ownerLastName', 'ownerFirstName', 'species', 'breed']
        .some((f) => looksLikeLink(b[f]))) {
        return res.status(400).json({ error: 'Les noms ne peuvent pas contenir d\'adresse web ni d\'e-mail.' });
      }
      const settings = db.getSettings();
      const kase = db.createReferralCase(b);
      // Rattache le dossier à la fiche du confrère (créée à la volée si c'est
      // sa première demande), pour retrouver tous ses patients au même endroit.
      const vet = db.findOrCreateReferringVet({
        name: b.referringVetName, clinic: b.referringVetClinic,
        email: b.referringVetEmail, phone: b.referringVetPhone,
      });
      if (vet) db.db.prepare('UPDATE referral_cases SET referringVetId = ? WHERE id = ?').run(vet.id, kase.id);

      const filesByField = req.files || {};
      for (const [field, category] of [['dossier', 'referral_letter'], ['radios', 'radiograph']]) {
        for (const f of (filesByField[field] || [])) {
          const storedFilename = storeFileBuffer(userDataPath, 'referral-intake', kase.id, f.buffer, f.originalname);
          db.createReferralIntakeFile({
            caseId: kase.id, category, originalName: f.originalname,
            storedFilename, mimeType: f.mimetype, sizeBytes: f.size,
          });
        }
      }

      db.createReferralEvent({ caseId: kase.id, type: 'submitted', toStatus: 'submitted' });
      const rawToken = issueReferralToken(db, kase.id, { settings, createdReason: 'initial' });
      await sendReferralEmail(settings, {
        to: kase.referringVetEmail, subject: ACK_SUBJECT, body: ACK_BODY,
        vars: {
          referringVetName: kase.referringVetName, patientName: kase.patientName,
          ownerLastName: kase.ownerLastName || '',
          reference: kase.reference, viewUrl: referralViewUrl(settings, rawToken),
          cabinetName: settings.clinicName || 'notre cabinet',
        },
      });

      const staffTo = staffNotificationRecipient(settings);
      if (staffTo) {
        await sendReferralEmail(settings, {
          to: staffTo, subject: STAFF_NOTIFY_SUBJECT, body: STAFF_NOTIFY_BODY,
          vars: {
              referringVetName: kase.referringVetName, referringVetClinic: kase.referringVetClinic || '',
            referringVetEmail: kase.referringVetEmail, referringVetPhone: kase.referringVetPhone || '',
            patientName: kase.patientName, species: kase.species || '',
            ownerLastName: kase.ownerLastName || '', reasonForReferral: kase.reasonForReferral || '',
            reference: kase.reference, staffUrl: staffCaseUrl(settings, kase.id),
          },
        });
      }

      res.json({ ok: true, reference: kase.reference });
    }));

  app.get('/api/public/referrals/case', fileLimiter, wrap((req, res) => {
    const tokenRow = resolveReferralToken(db, req.query.token);
    if (!tokenRow) return res.status(404).json({ error: 'Lien invalide ou expiré.' });
    const kase = db.getReferralCase(tokenRow.caseId);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    res.json(buildReferrerCaseView(db, kase));
  }));

  app.get('/api/public/referrals/file/:fileId', fileLimiter, wrap((req, res) => {
    const tokenRow = resolveReferralToken(db, req.query.token);
    if (!tokenRow) return res.status(404).json({ error: 'Lien invalide ou expiré.' });
    const kase = db.getReferralCase(tokenRow.caseId);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });

    const intake = db.getReferralIntakeFile(req.params.fileId);
    if (intake && intake.caseId === kase.id) {
      const abs = diskPath(userDataPath, 'referral-intake', kase.id, intake.storedFilename);
      return streamFile(res, abs, intake);
    }
    const attachment = db.getAttachment(req.params.fileId);
    if (attachment && kase.patientId && attachment.patientId === kase.patientId && attachment.visibleToReferrer) {
      const abs = diskPath(userDataPath, 'attachments', attachment.patientId, attachment.storedFilename);
      return streamFile(res, abs, attachment);
    }
    return res.status(404).json({ error: 'Fichier introuvable.' });
  }));

  app.post('/api/public/referrals/resend', resendLimiter, wrap(async (req, res) => {
    const { reference, email } = req.body || {};
    const generic = { ok: true, message: 'Si les informations correspondent à un dossier, un e-mail a été envoyé.' };
    if (!reference || !email) return res.json(generic);
    const kase = db.getReferralCaseByReference(String(reference).trim());
    if (!kase || kase.referringVetEmail.toLowerCase() !== String(email).trim().toLowerCase()) {
      return res.json(generic);
    }
    const settings = db.getSettings();
    db.revokeReferralTokens(kase.id);
    const rawToken = issueReferralToken(db, kase.id, { settings, createdReason: 'resend' });
    db.createReferralEvent({ caseId: kase.id, type: 'link_resent', visibleToReferrer: false });
    await sendReferralEmail(settings, {
      to: kase.referringVetEmail, subject: RESEND_SUBJECT, body: RESEND_BODY,
      vars: {
        referringVetName: kase.referringVetName, patientName: kase.patientName,
        ownerLastName: kase.ownerLastName || '',
        reference: kase.reference, viewUrl: referralViewUrl(settings, rawToken),
        cabinetName: settings.clinicName || 'notre cabinet',
      },
    });
    res.json(generic);
  }));

  // ===== Répertoire des vétérinaires référents (staff) =====
  // Alimenté automatiquement par les dossiers du portail, mais entièrement
  // éditable à la main : beaucoup de confrères réfèrent simplement par mail.
  app.get('/api/referring-vets', authRequired, wrap((req, res) => {
    res.json(db.listReferringVets({ search: req.query.search, activeOnly: req.query.activeOnly === '1' }));
  }));

  app.get('/api/referring-vets/:id', authRequired, wrap((req, res) => {
    const vet = db.getReferringVet(req.params.id);
    if (!vet) return res.status(404).json({ error: 'Vétérinaire introuvable.' });
    res.json({
      ...vet,
      patients: db.listReferringVetPatients(vet.id),
      cases: db.listReferralCases({}).filter((c) => c.referringVetId === vet.id),
      sends: db.listReferringVetSends({ referringVetId: vet.id, limit: 50 }),
    });
  }));

  app.post('/api/referring-vets', authRequired, wrap((req, res) => {
    const email = (req.body.email || '').trim();
    if (email) {
      const existing = db.getReferringVetByEmail(email);
      if (existing) return res.status(409).json({ error: `Un vétérinaire avec cet email existe déjà : ${existing.name}.` });
    }
    res.json(db.createReferringVet(req.body));
  }));

  app.put('/api/referring-vets/:id', authRequired, wrap((req, res) => {
    const email = (req.body.email || '').trim();
    if (email) {
      const existing = db.getReferringVetByEmail(email);
      if (existing && existing.id !== req.params.id) {
        return res.status(409).json({ error: `Un autre vétérinaire utilise déjà cet email : ${existing.name}.` });
      }
    }
    res.json(db.updateReferringVet(req.params.id, req.body));
  }));

  app.delete('/api/referring-vets/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) => {
    const vet = db.getReferringVet(req.params.id);
    if (!vet) return res.status(404).json({ error: 'Vétérinaire introuvable.' });
    res.json(db.deleteReferringVet(req.params.id));
  }));

  // ===== Staff =====
  app.get('/api/referrals', authRequired, wrap((req, res) => {
    res.json(db.listReferralCases({ status: req.query.status, patientId: req.query.patientId, search: req.query.search }));
  }));

  app.get('/api/referrals/:id', authRequired, wrap((req, res) => {
    const kase = db.getReferralCase(req.params.id);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    res.json({
      ...kase,
      emailTrust: db.referralEmailTrust(kase),
      events: db.listReferralEvents(kase.id),
      files: db.listReferralIntakeFiles(kase.id),
    });
  }));

  app.post('/api/referrals/:id/link', authRequired, wrap((req, res) => {
    const kase = db.getReferralCase(req.params.id);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    let { patientId, createPatient } = req.body || {};
    let ownerId;
    if (createPatient) {
      const owner = db.createOwner(createPatient.owner || {});
      ownerId = owner.id;
      const patient = db.createPatient({ ...(createPatient.patient || {}), ownerId });
      patientId = patient.id;
    } else if (patientId) {
      const patient = db.getPatient(patientId);
      if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });
      // Patient existant + adresse jamais validée : confirmation explicite exigée.
      if (!db.referralEmailTrust(kase).known && req.body.confirmUnknownEmail !== true) {
        return res.status(409).json({
          error: `L'adresse ${kase.referringVetEmail} n'est pas encore connue du cabinet. Vérifiez-la auprès du confrère avant de lui ouvrir le dossier de ${patient.name}.`,
          needsConfirmation: true,
        });
      }
      ownerId = patient.ownerId;
    } else {
      return res.status(400).json({ error: 'patientId ou createPatient requis.' });
    }
    const updated = db.linkReferralCase(kase.id, { patientId, ownerId, linkedBy: req.user.id });
    // Le client hérite du référent du dossier : sa fiche est cochée « référé par
    // un vétérinaire », ce qui limite d'office ses motifs de rendez-vous.
    if (ownerId && kase.referringVetId) {
      const owner = db.getOwner(ownerId);
      if (owner && !owner.referringVetId) {
        db.updateOwner(ownerId, { ...owner, referredByVet: 1, referringVetId: kase.referringVetId });
      }
    }
    db.createReferralEvent({ caseId: kase.id, type: 'linked_to_patient', createdBy: req.user.id });
    res.json(updated);
  }));

  app.put('/api/referrals/:id/status', authRequired, wrap(async (req, res) => {
    const kase = db.getReferralCase(req.params.id);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    const { status, note, visibleToReferrer, notifyVet } = req.body || {};
    if (!VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    const fromStatus = kase.status;
    const updated = db.updateReferralCaseStatus(kase.id, status);
    db.createReferralEvent({
      caseId: kase.id, type: 'status_changed', fromStatus, toStatus: status,
      note: note || null, visibleToReferrer: visibleToReferrer !== false, createdBy: req.user.id,
    });
    if (notifyVet) {
      const settings = db.getSettings();
      const rawToken = issueReferralToken(db, kase.id, { settings, createdReason: 'staff-regenerated' });
      await sendReferralEmail(settings, {
        to: kase.referringVetEmail, subject: STATUS_SUBJECT, body: STATUS_BODY,
        vars: {
          referringVetName: kase.referringVetName, patientName: kase.patientName,
          ownerLastName: kase.ownerLastName || '',
          reference: kase.reference, statusLabel: STATUS_LABELS[status] || status,
          note: note || '', viewUrl: referralViewUrl(settings, rawToken),
          cabinetName: settings.clinicName || 'notre cabinet',
        },
      });
    }
    res.json(updated);
  }));

  app.post('/api/referrals/:id/resend-link', authRequired, wrap(async (req, res) => {
    const kase = db.getReferralCase(req.params.id);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    const settings = db.getSettings();
    db.revokeReferralTokens(kase.id);
    const rawToken = issueReferralToken(db, kase.id, { settings, createdReason: 'staff-regenerated' });
    db.createReferralEvent({ caseId: kase.id, type: 'link_resent', visibleToReferrer: false, createdBy: req.user.id });
    await sendReferralEmail(settings, {
      to: kase.referringVetEmail, subject: RESEND_SUBJECT, body: RESEND_BODY,
      vars: {
        referringVetName: kase.referringVetName, patientName: kase.patientName,
        ownerLastName: kase.ownerLastName || '',
        reference: kase.reference, viewUrl: referralViewUrl(settings, rawToken),
        cabinetName: settings.clinicName || 'notre cabinet',
      },
    });
    res.json({ ok: true });
  }));

  app.post('/api/referrals/:id/tokens/revoke', authRequired, wrap((req, res) => {
    db.revokeReferralTokens(req.params.id);
    res.json({ ok: true });
  }));

  app.delete('/api/referrals/:id', authRequired, wrap((req, res) => {
    const kase = db.getReferralCase(req.params.id);
    if (!kase) return res.status(404).json({ error: 'Dossier introuvable.' });
    db.deleteReferralCase(kase.id);
    // DB rows (intake files, tokens, events) cascade; the files themselves
    // live on disk and need their own cleanup.
    const dir = path.join(userDataPath, 'referral-intake', kase.id);
    fs.rm(dir, { recursive: true, force: true }, () => {});
    res.json({ success: true });
  }));

  app.get('/api/referrals/:caseId/files/:fileId', authRequired, wrap((req, res) => {
    const file = db.getReferralIntakeFile(req.params.fileId);
    if (!file || file.caseId !== req.params.caseId) return res.status(404).json({ error: 'Fichier introuvable.' });
    streamFile(res, diskPath(userDataPath, 'referral-intake', file.caseId, file.storedFilename), file);
  }));

  // ===== Attachments (pièces jointes patient : radios, photos, documents) =====
  app.get('/api/patients/:patientId/attachments', authRequired, wrap((req, res) => {
    res.json(db.listAttachments(req.params.patientId));
  }));

  app.post('/api/patients/:patientId/attachments',
    authRequired,
    uploadMiddleware([{ name: 'files', maxCount: 8 }], {
      mimeWhitelist: ATTACHMENT_MIME_WHITELIST,
      maxFileSize: 300 * 1024 * 1024, // vidéos (boiterie, etc.) bien plus lourdes qu'une radio/photo
      rejectMessage: 'Type de fichier non autorisé (PDF, JPEG, PNG, WEBP, MP4, MOV ou WEBM uniquement).',
    }),
    wrap((req, res) => {
      const patient = db.getPatient(req.params.patientId);
      if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });
      const category = req.body?.category || 'other';
      const created = [];
      for (const f of ((req.files || {}).files || [])) {
        const storedFilename = storeFileBuffer(userDataPath, 'attachments', req.params.patientId, f.buffer, f.originalname);
        created.push(db.createAttachment({
          patientId: req.params.patientId, medicalRecordId: req.body?.medicalRecordId || null,
          category, originalName: f.originalname, storedFilename, mimeType: f.mimetype,
          sizeBytes: f.size, notes: req.body?.notes || null, createdBy: req.user.id,
        }));
      }
      res.json(created);
    }));

  app.put('/api/attachments/:id', authRequired, wrap((req, res) => {
    res.json(db.updateAttachment(req.params.id, req.body || {}));
  }));

  app.delete('/api/attachments/:id', authRequired, wrap((req, res) => {
    db.deleteAttachment(req.params.id);
    res.json({ success: true });
  }));

  app.get('/api/attachments/:id/file', authRequired, wrap((req, res) => {
    const attachment = db.getAttachment(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Fichier introuvable.' });
    streamFile(res, diskPath(userDataPath, 'attachments', attachment.patientId, attachment.storedFilename), attachment);
  }));

  app.get('/api/attachments/:id/email-preview', authRequired, wrap((req, res) => {
    const attachment = db.getAttachment(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Fichier introuvable.' });
    const patient = db.getPatient(attachment.patientId);
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    const settings = db.getSettings();
    const vars = buildAttachmentVars(attachment, patient, owner, settings);
    const lang = ATTACHMENT_EMAIL_TEMPLATES[req.query.lang] ? req.query.lang : 'fr';
    const tpl = ATTACHMENT_EMAIL_TEMPLATES[lang];
    res.json({
      to: owner?.email || '',
      lang,
      subject: renderTemplate(tpl.subject, vars),
      body: renderTemplate(tpl.body, vars),
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
    });
  }));

  app.post('/api/attachments/:id/send', authRequired, requireRole('admin', 'veterinarian'), wrap(async (req, res) => {
    const attachment = db.getAttachment(req.params.id);
    if (!attachment) return res.status(404).json({ error: 'Fichier introuvable.' });
    const patient = db.getPatient(attachment.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable.' });
    const owner = db.getOwner(patient.ownerId);
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire.' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres).' });

    const filePath = diskPath(userDataPath, 'attachments', attachment.patientId, attachment.storedFilename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable sur le serveur.' });

    const vars = buildAttachmentVars(attachment, patient, owner, settings);
    const lang = ATTACHMENT_EMAIL_TEMPLATES[req.body.lang] ? req.body.lang : 'fr';
    const tpl = ATTACHMENT_EMAIL_TEMPLATES[lang];
    const subject = (req.body.subject && req.body.subject.trim()) || renderTemplate(tpl.subject, vars);
    const text = (req.body.body && req.body.body.trim()) || renderTemplate(tpl.body, vars);
    const html = renderReferralHtml(text);

    await sendEmail(settings, {
      to, subject, text, html,
      attachments: [{ filename: attachment.originalName, content: fs.createReadStream(filePath) }],
    });
    res.json({ ok: true });
  }));
}

module.exports = { registerReferralRoutes, buildReferrerCaseView, makeLimiter, STATUS_LABELS, VALID_STATUSES };
