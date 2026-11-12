const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
authenticator.options = { window: 1 }; // tolerate ±1 time-step for clock drift
const { runBackup, listBackups } = require('./backup');
const { sendReminderForAppointment, verifyToken, makeToken, sendBookingConfirmation } = require('./reminders');
const { testConnection: testSmtp, sendEmail, looksLikeLink } = require('./email');
const { renderInvoicePdf } = require('./invoice-pdf');
const { renderPatientPdf, renderLabPdf } = require('./patient-pdf');
const { htmlToPdf } = require('./pdf-chrome');
const { patientHtml, invoiceHtml, labHtml } = require('./pdf-html');
const { registerReferralRoutes, makeLimiter } = require('./referrals');

// Preferred PDF renderers: render the branded HTML via headless Chrome
// (pixel-identical to the on-screen view), falling back to the PDFKit renderers
// if Chromium is unavailable so e-mail sending never breaks.
async function renderPatientPdfBest(opts, settings) {
  try {
    return await htmlToPdf(patientHtml({ ...opts, settings }));
  } catch (e) {
    console.error('[pdf] rendu Chrome indisponible, repli PDFKit :', e.message);
    return renderPatientPdf(opts, settings);
  }
}

async function renderInvoicePdfBest(invoice, settings) {
  try {
    return await htmlToPdf(invoiceHtml(invoice, settings));
  } catch (e) {
    console.error('[pdf] rendu Chrome facture indisponible, repli PDFKit :', e.message);
    return renderInvoicePdf(invoice, settings);
  }
}

// Devis : rendu Chrome uniquement — le repli PDFKit ne sait produire qu'une
// « Facture », ce qui serait trompeur pour un devis.
async function renderQuotePdf(quote, settings) {
  return htmlToPdf(invoiceHtml(quote, settings, { quote: true }));
}

async function renderLabPdfBest(results, patient, owner, settings) {
  try {
    return await htmlToPdf(labHtml({ results, patient, owner, settings }));
  } catch (e) {
    console.error('[pdf] rendu Chrome labo indisponible, repli PDFKit :', e.message);
    return renderLabPdf(results, patient, owner, settings);
  }
}

const PAYMENT_METHODS = {
  cash: 'Espèces', card: 'Carte bancaire', transfer: 'Virement', payconiq: 'Payconiq', cheque: 'Chèque',
};

const DEFAULT_INVOICE_EMAIL_SUBJECT = 'Votre facture {{invoiceNumber}} — {{cabinetName}}';
const DEFAULT_INVOICE_EMAIL_BODY = `Bonjour {{ownerFirstName}},

Vous trouverez ci-joint la facture {{invoiceNumber}} du {{invoiceDate}}{{#patientName}} concernant {{patientName}}{{/patientName}}.

Montant : {{invoiceTotal}} TVAC{{#dueDate}}
Échéance : {{dueDate}}{{/dueDate}}

{{#clinicIban}}Pour le règlement par virement :
IBAN : {{clinicIban}}{{#clinicBic}}
BIC : {{clinicBic}}{{/clinicBic}}
Communication : {{invoiceNumber}}

{{/clinicIban}}N'hésitez pas à nous contacter pour toute question.

À très bientôt,
L'équipe {{cabinetName}}`;

const DEFAULT_QUOTE_EMAIL_SUBJECT = 'Votre devis {{quoteNumber}} — {{cabinetName}}';
const DEFAULT_QUOTE_EMAIL_BODY = `Bonjour {{ownerFirstName}},

Vous trouverez ci-joint le devis {{quoteNumber}} du {{quoteDate}}{{#patientName}} concernant {{patientName}}{{/patientName}}.

Montant estimé : {{quoteTotal}} TVAC{{#validUntil}}
Valable jusqu'au : {{validUntil}}{{/validUntil}}

N'hésitez pas à nous contacter pour toute question.

À très bientôt,
L'équipe {{cabinetName}}`;


// Liens publics du cabinet (site vitrine, page de prise de RDV), tirés des
// Paramètres : clinicWebsite et publicBaseUrl. Repli sur "/" si non renseignés.
function clinicLinks(settings) {
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '').replace(/["<>]/g, '');
  const booking = clean(settings.publicBaseUrl);
  const website = clean(settings.clinicWebsite) || booking;
  return {
    website: website || '/',
    booking: booking || '/',
    bookingLabel: booking ? booking.replace(/^https?:\/\//, '') : 'notre page de rendez-vous',
  };
}

function buildQuoteVars(quote, owner, settings) {
  return {
    ownerFirstName: quote.ownerFirstName || owner?.firstName || '',
    ownerLastName: quote.ownerLastName || owner?.lastName || '',
    patientName: quote.patientName || '',
    quoteNumber: quote.number || '',
    quoteDate: fmtDateFr(quote.date),
    validUntil: fmtDateFr(quote.validUntil),
    quoteTotal: fmtMoneyFr(quote.totalTTC),
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetEmail: settings.clinicEmail || '',
  };
}

const DEFAULT_MEDICAL_RECORD_EMAIL_SUBJECT = 'Compte-rendu du {{recordDate}} pour {{patientName}} — {{cabinetName}}';
const DEFAULT_MEDICAL_RECORD_EMAIL_BODY = `Bonjour {{ownerFirstName}},

Comme convenu, vous trouverez ci-joint le compte-rendu de la consultation du {{recordDate}} concernant {{patientName}}{{#recordTitle}} : {{recordTitle}}{{/recordTitle}}.

N'hésitez pas à nous contacter au {{cabinetPhone}} pour toute question.

À très bientôt,
L'équipe {{cabinetName}}`;

const DEFAULT_PATIENT_RECORD_EMAIL_SUBJECT = 'Dossier médical de {{patientName}} — {{cabinetName}}';
const DEFAULT_PATIENT_RECORD_EMAIL_BODY = `Bonjour {{ownerFirstName}},

Comme convenu, voici en pièce jointe le dossier médical de {{patientName}}.

Ce dossier reprend la fiche signalétique, l'ensemble des actes médicaux enregistrés, les rappels programmés et l'historique des médicaments dispensés.

N'hésitez pas à nous contacter au {{cabinetPhone}} pour toute question.

À très bientôt,
L'équipe {{cabinetName}}`;

function renderTpl(template, vars) {
  let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, content) =>
    vars[name] ? content : ''
  );
  out = out.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, content) =>
    vars[name] ? '' : content
  );
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
  }
  return out;
}

// Copie comptable à la fiduciaire quand une facture passe en payée.
// Renvoie le message d'erreur à afficher, ou null si la copie est partie.
// Destinataire : Paramètres → invoiceCopyEmail ; vide = pas de copie.
async function sendFiduciaryCopy(invoice, settings) {
  const to = (settings.invoiceCopyEmail || '').trim();
  if (!to) return null;
  if (!settings.smtpHost) return 'SMTP non configuré (voir Paramètres)';
  const label = `marquée payée — ${PAYMENT_METHODS[invoice.paymentMethod] || invoice.paymentMethod}`;
  try {
    const pdfBuffer = await renderInvoicePdfBest(invoice, settings);
    await sendEmail(settings, {
      to,
      subject: `Copie facture ${invoice.number} — pour la fiduciaire`,
      text: `Copie de la facture ${invoice.number} du ${invoice.date} (${label}).`,
      html: `<p>Copie de la facture ${invoice.number} du ${invoice.date} (${label}).</p>`,
      attachments: [{
        filename: `facture-${invoice.number || invoice.id}.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf',
      }],
    });
    return null;
  } catch (e) {
    console.error('[fiduciaire] envoi échoué pour facture', invoice.number, ':', e.message);
    return 'Copie à la fiduciaire non envoyée : ' + e.message;
  }
}

function invoiceEmailHtml(textBody) {
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

function fmtDateFr(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtMoneyFr(n) {
  return Number(n || 0).toLocaleString('fr-LU', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }) + ' €';
}

function buildInvoiceVars(invoice, owner, settings) {
  return {
    ownerFirstName: invoice.ownerFirstName || owner?.firstName || '',
    ownerLastName: invoice.ownerLastName || owner?.lastName || '',
    patientName: invoice.patientName || '',
    invoiceNumber: invoice.number || '',
    invoiceDate: fmtDateFr(invoice.date),
    dueDate: fmtDateFr(invoice.dueDate),
    invoiceTotal: fmtMoneyFr(invoice.totalTTC),
    invoiceTotalHT: fmtMoneyFr(invoice.totalHT),
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetEmail: settings.clinicEmail || '',
    clinicIban: settings.clinicIban || '',
    clinicBic: settings.clinicBic || '',
  };
}

// Modèle d'accompagnement quand le dossier part vers un confrère et non vers le
// propriétaire. Le ton reprend celui du portail référents (« Bonjour Dr … »).
// `{{vetName}}` est substitué côté client, le destinataire pouvant être choisi
// parmi tout le répertoire au moment de l'envoi.
const REFERRING_VET_EMAIL_SUBJECT = 'Dossier de {{patientName}} ({{ownerLastName}}) — {{cabinetName}}';
const REFERRING_VET_EMAIL_BODY = `Bonjour Dr {{vetName}},

Vous trouverez ci-joint le dossier de {{patientName}}{{speciesPart}}, de la famille {{ownerLastName}}.

Il reprend la fiche signalétique, les actes réalisés et les traitements dispensés. Les radios et analyses éventuelles sont jointes séparément.

Je reste à votre disposition pour en discuter.

Bien confraternellement,
{{cabinetName}}`;

function buildPatientVars(patient, owner, settings) {
  return {
    patientName: patient?.name || 'votre animal',
    patientSpecies: patient?.species || '',
    ownerFirstName: owner?.firstName || '',
    ownerLastName: owner?.lastName || '',
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetEmail: settings.clinicEmail || '',
  };
}

function buildRecordVars(record, patient, owner, settings) {
  return {
    patientName: patient?.name || 'votre animal',
    patientSpecies: patient?.species || '',
    recordDate: fmtDateFr(record?.date),
    recordType: record?.type || '',
    recordTitle: record?.title || '',
    ownerFirstName: owner?.firstName || '',
    ownerLastName: owner?.lastName || '',
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetEmail: settings.clinicEmail || '',
  };
}

const DEFAULT_LAB_RESULT_EMAIL_SUBJECT = 'Résultats d\'analyses de {{patientName}} — {{cabinetName}}';
const DEFAULT_LAB_RESULT_EMAIL_BODY = `Bonjour {{ownerFirstName}},

Vous trouverez ci-joint les résultats des analyses réalisées pour {{patientName}}{{#runDate}} le {{runDate}}{{/runDate}}.

N'hésitez pas à nous contacter au {{cabinetPhone}} pour toute question ou pour en discuter ensemble.

À très bientôt,
L'équipe {{cabinetName}}`;

function buildLabVars(result, patient, owner, settings) {
  return {
    patientName: patient?.name || 'votre animal',
    patientSpecies: patient?.species || '',
    runDate: fmtDateFr(result?.runDate),
    instrument: result?.instrument || '',
    ownerFirstName: owner?.firstName || '',
    ownerLastName: owner?.lastName || '',
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetEmail: settings.clinicEmail || '',
  };
}

function createServer({ db, userDataPath, distDir: distDirOverride }) {
  const app = express();
  // Behind Caddy: trust the first proxy so req.ip reflects the real client IP
  // (needed for per-IP login throttling). X-Forwarded-For is set by Caddy.
  app.set('trust proxy', 1);

  // CORS — allow only known web origins, plus non-browser clients (lab bridge,
  // curl) and the Electron desktop app (file:// → Origin "null"). The API is
  // authenticated via Bearer tokens (not cookies), but this still blocks
  // arbitrary websites from scripting the API in a logged-in user's browser.
  // L'origine de l'URL publique (Paramètres → publicBaseUrl) est ajoutée
  // dynamiquement, voir publicOrigin() ci-dessous.
  const ALLOWED_ORIGINS = [
    'http://localhost:5173',  // vite dev
    'http://localhost:3737',  // electron embedded server
    // Origines supplémentaires par instance (ex. l'instance de démo),
    // via EXTRA_ORIGINS="https://demo.example.org" (séparées par des virgules).
    ...(process.env.EXTRA_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ];
  function publicOrigin() {
    try { return new URL(db.getSettings().publicBaseUrl).origin; } catch { return null; }
  }
  app.use(cors({
    origin(origin, cb) {
      if (!origin || origin === 'null' || ALLOWED_ORIGINS.includes(origin) || origin === publicOrigin()) return cb(null, true);
      return cb(null, false);
    },
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: false }));

  // Persistent JWT secret per installation
  const secretFile = path.join(userDataPath, 'jwt-secret.txt');
  let JWT_SECRET;
  if (fs.existsSync(secretFile)) {
    JWT_SECRET = fs.readFileSync(secretFile, 'utf-8').trim();
  } else {
    JWT_SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(secretFile, JWT_SECRET);
  }

  // ===== Auth middleware =====
  function authRequired(req, res, next) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Token manquant' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      // Le compte est relu à chaque requête : un compte supprimé ou désactivé
      // perd l'accès tout de suite, et un changement de rôle s'applique sans
      // attendre l'expiration du jeton.
      const u = db.getUser(payload.id);
      if (!u || !u.active) return res.status(401).json({ error: 'Compte désactivé.' });
      // Invalidate tokens issued before the user's last password change.
      const pca = db.getPasswordChangedAt(payload.id);
      // iat est en secondes entières : on compare à la seconde, sinon un jeton
      // émis dans la même seconde que le changement serait rejeté.
      if (pca && payload.iat && payload.iat < Math.floor(new Date(pca).getTime() / 1000)) {
        return res.status(401).json({ error: 'Session expirée, reconnectez-vous.' });
      }
      // Admin sans 2FA : seules l'activation de la 2FA et la session sont
      // accessibles. L'écran bloquant du front ne suffit pas, l'API se
      // contournerait avec le seul mot de passe.
      if (needs2faEnrollment(u) && !ENROLL_2FA_PATHS.some((p) => req.path === p || req.path.startsWith(p + '/'))) {
        return res.status(403).json({ error: 'Activez la double authentification pour continuer.', mustEnroll2fa: true });
      }
      // Compte de la station de laboratoire : mot de passe stocké sur le PC du labo et
      // pas de 2FA, donc limité aux seules routes de l'agent (pas de dossiers).
      if (u.role === 'lab' && !LAB_ROUTES.some(([m, re]) => m === req.method && re.test(req.path))) {
        return res.status(403).json({ error: 'Accès refusé' });
      }
      req.user = { ...payload, role: u.role };
      next();
    } catch {
      return res.status(401).json({ error: 'Token invalide ou expiré' });
    }
  }
  const ENROLL_2FA_PATHS = ['/api/auth/me', '/api/2fa'];
  const LAB_ROUTES = [
    ['GET', /^\/api\/auth\/me$/],
    ['POST', /^\/api\/lab\/results\/ingest$/],
    ['GET', /^\/api\/lab\/requests\/pending$/],
    ['POST', /^\/api\/lab\/requests\/[^/]+\/sent$/],
  ];

  function requireRole(...roles) {
    return (req, res, next) => {
      if (!roles.includes(req.user?.role)) {
        return res.status(403).json({ error: 'Accès refusé' });
      }
      next();
    };
  }

  // Wrap async handler. Client errors (err.status 4xx) keep their message;
  // server errors (5xx) are logged but return a generic message (no internal leak).
  const wrap = (fn) => (req, res) => {
    const handle = (err) => {
      const status = err.status || err.statusCode || 500;
      if (status >= 500) {
        console.error(err);
        return res.status(500).json({ error: 'Erreur interne du serveur.' });
      }
      return res.status(status).json({ error: err.message || 'Requête invalide.' });
    };
    try {
      const result = fn(req, res);
      if (result && typeof result.then === 'function') result.catch(handle);
    } catch (err) {
      handle(err);
    }
  };

  // ----- Password policy -----
  function assertPasswordOk(pw) {
    if (typeof pw !== 'string' || pw.length < 8) {
      throw Object.assign(new Error('Le mot de passe doit contenir au moins 8 caractères.'), { status: 400 });
    }
  }

  // ----- Login brute-force throttling (per IP, in-memory) -----
  const LOGIN_WINDOW_MS = 15 * 60 * 1000;   // failures counted over 15 min
  const LOGIN_MAX_FAILS = 8;                 // then block...
  const LOGIN_BLOCK_MS = 15 * 60 * 1000;     // ...for 15 min
  const loginAttempts = new Map();           // ip -> { fails, windowStart, blockedUntil }
  function loginLimiter(req, res, next) {
    const rec = loginAttempts.get(req.ip);
    const now = Date.now();
    if (rec && rec.blockedUntil > now) {
      const retry = Math.ceil((rec.blockedUntil - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: `Trop de tentatives de connexion. Réessayez dans ${Math.ceil(retry / 60)} min.` });
    }
    next();
  }
  function recordLoginFailure(ip) {
    const now = Date.now();
    let rec = loginAttempts.get(ip);
    if (!rec || (now - rec.windowStart) > LOGIN_WINDOW_MS) {
      rec = { fails: 0, windowStart: now, blockedUntil: 0 };
    }
    rec.fails += 1;
    if (rec.fails >= LOGIN_MAX_FAILS) rec.blockedUntil = now + LOGIN_BLOCK_MS;
    loginAttempts.set(ip, rec);
  }
  function clearLoginFailures(ip) { loginAttempts.delete(ip); }
  // Periodic cleanup of stale entries
  const loginCleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of loginAttempts) {
      if (rec.blockedUntil < now && (now - rec.windowStart) > LOGIN_WINDOW_MS) loginAttempts.delete(ip);
    }
  }, 30 * 60 * 1000);
  if (loginCleanup.unref) loginCleanup.unref();

  // ===== Health =====
  app.get('/api/ping', (req, res) => res.json({ ok: true, version: '0.3.0' }));

  // ===== Staff app (built SPA, browser access) =====
  // Serves the internal staff React app at /app, from /opt/vet-clinic/dist/.
  // HashRouter is used client-side, so static serving is enough (no catch-all needed).
  // L'application de bureau fournit son propre dossier (dist/ à la racine).
  const distDir = distDirOverride || path.join(__dirname, 'dist');
  if (fs.existsSync(distDir)) {
    app.use('/app', express.static(distDir));
  }

  // ===== Public booking site (static files) =====
  // Serves the HTML booking page at the root, from /opt/vet-clinic/public/
  // PUBLIC_DIR permet à l'instance de démo de servir une page de RDV
  // neutre (sans le nom ni les liens du cabinet) tout en partageant le code.
  const publicDir = process.env.PUBLIC_DIR
    ? path.resolve(process.env.PUBLIC_DIR)
    : path.join(__dirname, 'public');
  if (fs.existsSync(publicDir)) {
    app.use('/', express.static(publicDir));
  }

  // ===== Auth =====
  // ----- Code d'installation (protège la création du 1er compte admin) -----
  // Tant qu'aucun compte n'existe, créer l'administrateur depuis une AUTRE
  // machine exige ce code, écrit dans <données>/setup-code.txt, dans les
  // journaux et affiché par deploy.sh. Depuis la machine elle-même (appli de
  // bureau), il n'est pas demandé. Derrière Caddy, les requêtes arrivent de
  // 127.0.0.1 mais portent X-Forwarded-For : elles comptent comme distantes.
  const setupCodeFile = path.join(userDataPath, 'setup-code.txt');
  function currentSetupCode() {
    if (db.hasAnyUser()) return null;
    try {
      const existing = fs.readFileSync(setupCodeFile, 'utf8').trim();
      if (existing) return existing;
    } catch { /* pas encore créé */ }
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (const b of crypto.randomBytes(8)) code += alphabet[b % alphabet.length];
    code = code.slice(0, 4) + '-' + code.slice(4);
    fs.writeFileSync(setupCodeFile, code + '\n', { mode: 0o600 });
    return code;
  }
  {
    const code = currentSetupCode();
    if (code) console.log(`[setup] Code d'installation (création du compte administrateur) : ${code}`);
  }
  function isLocalRequest(req) {
    const addr = req.socket.remoteAddress || '';
    return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr) && !req.headers['x-forwarded-for'];
  }
  function setupCodeOk(req) {
    if (isLocalRequest(req)) return true;
    const norm = (x) => String(x || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const expected = norm(currentSetupCode());
    const given = norm(req.body.setupCode);
    return !!expected && given.length === expected.length
      && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  }

  app.get('/api/auth/has-any-user', wrap((req, res) => {
    const hasAny = db.hasAnyUser();
    res.json({ hasAny, setupCodeRequired: !hasAny && !isLocalRequest(req) });
  }));

  // Règle UNIQUE d'enrôlement 2FA — un admin doit activer la 2FA, sauf en
  // mode démo où l'écran bloquant dissuaderait un cabinet en essai.
  // Renvoyée par login, /api/auth/me et /api/auth/setup : le client ne doit
  // jamais la recalculer, sinon le mode démo est contourné au rechargement.
  const needs2faEnrollment = (u) =>
    process.env.DEMO_MODE !== '1' && !!u && u.role === 'admin' && !u.totpEnabled;

  app.post('/api/auth/setup', loginLimiter, wrap((req, res) => {
    if (db.hasAnyUser()) return res.status(400).json({ error: 'Setup déjà effectué' });
    if (!setupCodeOk(req)) {
      recordLoginFailure(req.ip);
      return res.status(403).json({ error: "Code d'installation incorrect.", setupCodeRequired: true });
    }
    if (req.body.acceptTerms !== true) {
      return res.status(400).json({ error: "Les conditions d'utilisation doivent être acceptées." });
    }
    assertPasswordOk(req.body.password);
    const { setupCode, acceptTerms, termsVersion, ...fields } = req.body;
    const user = db.createUser({ ...fields, role: 'admin', active: true });
    recordTermsAcceptance(user);
    try { fs.unlinkSync(setupCodeFile); } catch { /* déjà supprimé */ }
    const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ user: { ...user, mustEnroll2fa: needs2faEnrollment(user) }, token });
  }));

  // Conditions d'utilisation (écran du premier démarrage). La version est
  // aussi définie dans src/components/TermsOfUse.jsx : les garder identiques.
  const TERMS_VERSION = '1';
  function recordTermsAcceptance(user) {
    db.saveSettings({
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date().toISOString(),
      termsAcceptedBy: user.fullName || user.username,
    });
  }
  app.post('/api/terms/accept', authRequired, requireRole('admin'), wrap((req, res) => {
    const u = db.db.prepare('SELECT fullName, username FROM users WHERE id = ?').get(req.user.id) || req.user;
    recordTermsAcceptance(u);
    res.json({ ok: true, termsVersion: TERMS_VERSION });
  }));

  app.post('/api/auth/login', loginLimiter, wrap((req, res) => {
    const { username, password, code } = req.body;
    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || null;
    const user = db.authenticate(username, password);
    if (!user) {
      recordLoginFailure(ip);
      db.logLoginEvent({ username, success: false, reason: 'identifiants', ip, userAgent });
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }
    // Second factor
    if (user.totpEnabled) {
      if (!code) return res.json({ needTotp: true }); // not a failure — ask for the code
      const t = db.getTotp(user.id);
      const codeStr = String(code).replace(/\s+/g, '');
      const ok = authenticator.check(codeStr, t.totpSecret) || db.consumeBackupCode(user.id, codeStr);
      if (!ok) {
        recordLoginFailure(ip);
        db.logLoginEvent({ userId: user.id, username, success: false, reason: '2fa', ip, userAgent });
        return res.status(401).json({ error: 'Code de vérification invalide.' });
      }
    }
    clearLoginFailures(ip);
    // En démo, on n'impose pas l'enrôlement 2FA : l'écran bloquant au premier
    // login dissuaderait un cabinet en essai. La 2FA reste activable via /security.
    const mustEnroll2fa = needs2faEnrollment(user);
    db.logLoginEvent({ userId: user.id, username, success: true, reason: mustEnroll2fa ? 'ok (2FA à configurer)' : 'ok', ip, userAgent });
    const token = jwt.sign({ id: user.id, role: user.role, username: user.username }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ user, token, mustEnroll2fa });
  }));

  // ===== 2FA (TOTP) =====
  app.post('/api/2fa/setup', authRequired, wrap(async (req, res) => {
    const u = db.getUser(req.user.id);
    const secret = authenticator.generateSecret();
    db.setTotpSecret(req.user.id, secret);
    const uri = authenticator.keyuri(u.username, 'Colveto', secret);
    const qr = await QRCode.toDataURL(uri);
    res.json({ secret, uri, qr });
  }));
  app.post('/api/2fa/confirm', authRequired, wrap((req, res) => {
    const t = db.getTotp(req.user.id);
    if (!t || !t.totpSecret) throw Object.assign(new Error('Aucune configuration 2FA en cours. Relancez l’activation.'), { status: 400 });
    const codeStr = String(req.body.code || '').replace(/\s+/g, '');
    if (!authenticator.check(codeStr, t.totpSecret)) {
      return res.status(400).json({ error: 'Code invalide. Vérifiez l’heure de votre téléphone et réessayez.' });
    }
    const plain = Array.from({ length: 8 }, () => crypto.randomBytes(4).toString('hex'));
    const hashed = plain.map((c) => bcrypt.hashSync(c, 10));
    db.enableTotp(req.user.id, JSON.stringify(hashed));
    res.json({ enabled: true, backupCodes: plain });
  }));
  app.post('/api/2fa/disable', authRequired, wrap((req, res) => {
    const u = db.authenticate(req.user.username, req.body.password || '');
    if (!u) return res.status(401).json({ error: 'Mot de passe incorrect.' });
    db.disableTotp(req.user.id);
    res.json({ disabled: true });
  }));

  // ===== Security: login audit log (admin) =====
  app.get('/api/security/login-events', authRequired, requireRole('admin'), wrap((req, res) => {
    res.json(db.listLoginEvents(req.query.limit));
  }));

  app.get('/api/auth/me', authRequired, wrap((req, res) => {
    const user = db.getUser(req.user.id);
    if (!user) return res.status(401).json({ error: 'Utilisateur introuvable' });
    res.json({ user: { ...user, mustEnroll2fa: needs2faEnrollment(user) } });
  }));

  // ===== Users (admin only) =====
  app.get('/api/users', authRequired, requireRole('admin'), wrap((req, res) => res.json(db.listUsers())));
  app.post('/api/users', authRequired, requireRole('admin'), wrap((req, res) => {
    assertPasswordOk(req.body.password);
    res.json(db.createUser(req.body));
  }));
  app.put('/api/users/:id', authRequired, requireRole('admin'), wrap((req, res) => {
    if (req.body.password != null && req.body.password !== '') assertPasswordOk(req.body.password);
    res.json(db.updateUser(req.params.id, req.body));
  }));
  app.delete('/api/users/:id', authRequired, requireRole('admin'), wrap((req, res) => res.json(db.deleteUser(req.params.id))));

  // ===== Owners =====
  app.get('/api/owners', authRequired, wrap((req, res) => res.json(db.listOwners())));
  app.get('/api/owners/:id', authRequired, wrap((req, res) => res.json(db.getOwner(req.params.id))));
  app.post('/api/owners', authRequired, wrap((req, res) => res.json(db.createOwner(req.body))));
  app.put('/api/owners/:id', authRequired, wrap((req, res) => res.json(db.updateOwner(req.params.id, req.body))));
  app.delete('/api/owners/:id', authRequired, wrap((req, res) => res.json(db.deleteOwner(req.params.id))));

  // ===== Patients =====
  app.get('/api/patients', authRequired, wrap((req, res) => res.json(db.listPatients(req.query.ownerId))));
  app.get('/api/patients/:id', authRequired, wrap((req, res) => res.json(db.getPatient(req.params.id))));
  app.post('/api/patients', authRequired, wrap((req, res) => res.json(db.createPatient(req.body))));
  app.put('/api/patients/:id', authRequired, wrap((req, res) => res.json(db.updatePatient(req.params.id, req.body))));
  app.delete('/api/patients/:id', authRequired, wrap((req, res) => res.json(db.deletePatient(req.params.id))));

  // ===== Medical records =====
  app.get('/api/patients/:patientId/records', authRequired, wrap((req, res) =>
    res.json(db.listMedicalRecords(req.params.patientId))
  ));
  app.post('/api/records', authRequired, wrap((req, res) =>
    res.json(db.createMedicalRecord({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/records/:id', authRequired, wrap((req, res) =>
    res.json(db.updateMedicalRecord(req.params.id, req.body))
  ));
  app.delete('/api/records/:id', authRequired, wrap((req, res) =>
    res.json(db.deleteMedicalRecord(req.params.id))
  ));

  // ===== Lab integration =====
  const labReportsDir = path.join(userDataPath, 'lab-reports');
  // Chemin du PDF du labo d'un résultat, uniquement s'il est DANS labReportsDir
  // et existe. Le chemin vient de la base : sans ce garde-fou, un chemin
  // arbitraire (ex. jwt-secret.txt) serait servi ou joint à un e-mail.
  function labReportFile(result) {
    if (!result || !result.reportPdfPath) return null;
    const abs = path.resolve(result.reportPdfPath);
    if (!abs.startsWith(path.resolve(labReportsDir) + path.sep)) return null;
    return fs.existsSync(abs) ? abs : null;
  }

  app.get('/api/patients/:patientId/lab/requests', authRequired, wrap((req, res) =>
    res.json(db.listLabRequests(req.params.patientId))
  ));
  app.get('/api/patients/:patientId/lab/results', authRequired, wrap((req, res) =>
    res.json(db.listLabResults(req.params.patientId))
  ));

  // Create / cancel an analysis request (from the renderer)
  app.post('/api/lab/requests', authRequired, wrap((req, res) => {
    if (!req.body.patientId) return res.status(400).json({ error: 'patientId requis' });
    res.json(db.createLabRequest({ ...req.body, createdBy: req.user.id }));
  }));
  app.post('/api/lab/requests/:id/cancel', authRequired, wrap((req, res) =>
    res.json(db.cancelLabRequest(req.params.id))
  ));

  // Used by a lab bridge: pull pending requests to send, mark them sent.
  app.get('/api/lab/requests/pending', authRequired, wrap((req, res) =>
    res.json(db.listPendingLabRequests())
  ));
  app.post('/api/lab/requests/:id/sent', authRequired, wrap((req, res) =>
    res.json(db.setLabRequestStatus(req.params.id, 'sent', { sentAt: new Date().toISOString() }))
  ));

  // Used by a lab bridge: ingest a parsed result (+ optional PDF report as base64).
  app.post('/api/lab/results/ingest', authRequired, wrap((req, res) => {
    const payload = req.body || {};
    if (!payload.sourceFile) return res.status(400).json({ error: 'sourceFile requis' });
    // Le chemin du rapport est toujours fixé par le serveur, jamais par le client.
    delete payload.reportPdfPath;
    if (payload.reportPdfBase64) {
      try {
        fs.mkdirSync(labReportsDir, { recursive: true });
        const safeName = (payload.diagnosticSetId || payload.sourceFile).replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
        const pdfPath = path.join(labReportsDir, safeName);
        fs.writeFileSync(pdfPath, Buffer.from(payload.reportPdfBase64, 'base64'));
        payload.reportPdfPath = pdfPath;
      } catch (e) {
        console.error('[lab] échec écriture PDF rapport:', e.message);
      }
      delete payload.reportPdfBase64;
    }
    res.json(db.ingestLabResult(payload));
  }));

  // Unmatched results + manual assignment to a patient
  app.get('/api/lab/unmatched', authRequired, wrap((req, res) =>
    res.json(db.listUnmatchedLabResults())
  ));
  app.post('/api/lab/results/:id/assign', authRequired, wrap((req, res) => {
    if (!req.body.patientId) return res.status(400).json({ error: 'patientId requis' });
    res.json(db.assignLabResult(req.params.id, req.body.patientId));
  }));

  // Serve a result's PDF report (fetched with auth by the renderer, opened as a blob).
  function labResultSession(result) {
    return result.patientId
      ? db.listLabResults(result.patientId).filter((r) => (r.diagnosticSetId || r.id) === (result.diagnosticSetId || result.id))
      : [result];
  }
  app.get('/api/lab/results/:id/report', authRequired, wrap(async (req, res) => {
    const result = db.getLabResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Analyse introuvable' });
    const reportFile = labReportFile(result);
    if (reportFile) {
      res.type('application/pdf');
      return res.sendFile(reportFile);
    }
    const patient = result.patientId ? db.getPatient(result.patientId) : null;
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    const session = labResultSession(result);
    const buf = await renderLabPdfBest(session.length ? session : [result], patient, owner, db.getSettings());
    res.type('application/pdf').send(buf);
  }));

  // Email a lab result's PDF report to the client.
  app.get('/api/lab/results/:id/email-preview', authRequired, wrap((req, res) => {
    const result = db.getLabResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Analyse introuvable' });
    if (!result.patientId) return res.status(400).json({ error: 'Analyse non rattachée à un patient' });
    const patient = db.getPatient(result.patientId);
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    const settings = db.getSettings();
    const vars = buildLabVars(result, patient, owner, settings);
    res.json({
      to: owner?.email || '',
      subject: renderTpl(settings.labResultEmailSubject || DEFAULT_LAB_RESULT_EMAIL_SUBJECT, vars),
      body: renderTpl(settings.labResultEmailBody || DEFAULT_LAB_RESULT_EMAIL_BODY, vars),
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
      hasReport: !!labReportFile(result) || !!(result.assays && result.assays.length),
    });
  }));

  app.post('/api/lab/results/:id/send', authRequired, requireRole('admin', 'veterinarian'), wrap(async (req, res) => {
    const result = db.getLabResult(req.params.id);
    if (!result) return res.status(404).json({ error: 'Analyse introuvable' });
    if (!result.patientId) return res.status(400).json({ error: 'Analyse non rattachée à un patient' });
    const patient = db.getPatient(result.patientId);
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres)' });

    const vars = buildLabVars(result, patient, owner, settings);
    const subject = (req.body.subject && req.body.subject.trim())
      || renderTpl(settings.labResultEmailSubject || DEFAULT_LAB_RESULT_EMAIL_SUBJECT, vars);
    const text = (req.body.body && req.body.body.trim())
      || renderTpl(settings.labResultEmailBody || DEFAULT_LAB_RESULT_EMAIL_BODY, vars);
    const html = invoiceEmailHtml(text);

    let pdfBuffer;
    try {
      const reportFile = labReportFile(result);
      if (reportFile) {
        pdfBuffer = fs.readFileSync(reportFile);
      } else {
        const session = labResultSession(result);
        pdfBuffer = await renderLabPdfBest(session.length ? session : [result], patient, owner, settings);
      }
    } catch (e) { return res.status(500).json({ error: 'Génération PDF échouée : ' + e.message }); }

    const safeName = (patient.name || 'analyses').replace(/[^\w\-]+/g, '_');
    const safeDate = (result.runDate || '').replace(/\D/g, '').slice(0, 8);
    try {
      await sendEmail(settings, {
        to, subject, text, html,
        attachments: [{
          filename: `analyses-${safeName}${safeDate ? '-' + safeDate : ''}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(500).json({ error: 'Envoi échoué : ' + e.message });
    }
  }));

  // ===== Single medical record: full data, email preview + send by mail =====
  function getRecord(id) {
    return db.db.prepare('SELECT * FROM medical_records WHERE id = ?').get(id);
  }

  // Returns the record + its patient + owner + (current) clinic settings — used by
  // the renderer's `/records/:id/print` route to render a print-friendly view.
  app.get('/api/records/:id/full', authRequired, wrap((req, res) => {
    const record = getRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Acte introuvable' });
    const patient = db.getPatient(record.patientId);
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    res.json({ record, patient, owner, settings: db.getSettings() });
  }));

  app.get('/api/records/:id/email-preview', authRequired, wrap((req, res) => {
    const record = getRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Acte introuvable' });
    const patient = db.getPatient(record.patientId);
    const owner = patient ? db.getOwner(patient.ownerId) : null;
    const settings = db.getSettings();
    const vars = buildRecordVars(record, patient, owner, settings);
    const subject = renderTpl(settings.medicalRecordEmailSubject || DEFAULT_MEDICAL_RECORD_EMAIL_SUBJECT, vars);
    const body = renderTpl(settings.medicalRecordEmailBody || DEFAULT_MEDICAL_RECORD_EMAIL_BODY, vars);
    res.json({
      to: owner?.email || '',
      subject, body,
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
    });
  }));

  app.post('/api/records/:id/send', authRequired, requireRole('admin', 'veterinarian'), wrap(async (req, res) => {
    const record = getRecord(req.params.id);
    if (!record) return res.status(404).json({ error: 'Acte introuvable' });
    const patient = db.getPatient(record.patientId);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable' });
    const owner = db.getOwner(patient.ownerId);
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres)' });

    const vars = buildRecordVars(record, patient, owner, settings);
    const subject = (req.body.subject && req.body.subject.trim())
      || renderTpl(settings.medicalRecordEmailSubject || DEFAULT_MEDICAL_RECORD_EMAIL_SUBJECT, vars);
    const text = (req.body.body && req.body.body.trim())
      || renderTpl(settings.medicalRecordEmailBody || DEFAULT_MEDICAL_RECORD_EMAIL_BODY, vars);
    const html = invoiceEmailHtml(text);

    let pdfBuffer;
    if (req.body.pdfBase64) {
      try {
        pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
      } catch (e) {
        return res.status(400).json({ error: 'PDF base64 invalide' });
      }
    } else {
      try {
        pdfBuffer = await renderPatientPdfBest({
          patient, owner,
          records: [record],
          followUps: [],
          dispensings: [],
          title: 'Compte-rendu',
          recordsSectionTitle: 'Consultation',
        }, settings);
      } catch (e) {
        return res.status(500).json({ error: 'Génération PDF échouée : ' + e.message });
      }
    }

    const safeName = (patient.name || 'consultation').replace(/[^\w\-]+/g, '_');
    const safeDate = (record.date || '').replace(/\D/g, '');
    try {
      await sendEmail(settings, {
        to, subject, text, html,
        attachments: [{
          filename: `compte-rendu-${safeName}-${safeDate}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(500).json({ error: 'Envoi échoué : ' + e.message });
    }
  }));

  // ===== Patient record: email preview + send by mail =====
  app.get('/api/patients/:id/email-preview', authRequired, wrap((req, res) => {
    const patient = db.getPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable' });
    const owner = db.getOwner(patient.ownerId);
    const settings = db.getSettings();
    const vars = buildPatientVars(patient, owner, settings);
    const subject = renderTpl(settings.patientRecordEmailSubject || DEFAULT_PATIENT_RECORD_EMAIL_SUBJECT, vars);
    const body = renderTpl(settings.patientRecordEmailBody || DEFAULT_PATIENT_RECORD_EMAIL_BODY, vars);
    // Vétérinaire référent du client, proposé comme destinataire alternatif
    // dans le modal d'envoi (dossier + radios pour le confrère).
    const referringVet = owner?.referringVetId ? db.getReferringVet(owner.referringVetId) : null;
    const vetVars = { ...vars, speciesPart: patient?.species ? `, ${String(patient.species).toLowerCase()}` : '' };
    res.json({
      to: owner?.email || '',
      subject,
      body,
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
      referringVet: referringVet
        ? { id: referringVet.id, name: referringVet.name, clinic: referringVet.clinic, email: referringVet.email }
        : null,
      // Variante confraternelle ; {{vetName}} reste à substituer côté client.
      vetSubject: renderTpl(REFERRING_VET_EMAIL_SUBJECT, vetVars),
      vetBody: renderTpl(REFERRING_VET_EMAIL_BODY, vetVars),
    });
  }));

  app.post('/api/patients/:id/send', authRequired, requireRole('admin', 'veterinarian'), wrap(async (req, res) => {
    const patient = db.getPatient(req.params.id);
    if (!patient) return res.status(404).json({ error: 'Patient introuvable' });
    const owner = db.getOwner(patient.ownerId);
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres)' });

    const vars = buildPatientVars(patient, owner, settings);
    const subject = (req.body.subject && req.body.subject.trim())
      || renderTpl(settings.patientRecordEmailSubject || DEFAULT_PATIENT_RECORD_EMAIL_SUBJECT, vars);
    const text = (req.body.body && req.body.body.trim())
      || renderTpl(settings.patientRecordEmailBody || DEFAULT_PATIENT_RECORD_EMAIL_BODY, vars);
    const html = invoiceEmailHtml(text);

    const safeName = (patient.name || 'patient').replace(/[^\w\-]+/g, '_');
    let pdfBuffer;
    const labAttachments = [];
    if (req.body.pdfBase64) {
      try {
        pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
      } catch (e) {
        return res.status(400).json({ error: 'PDF base64 invalide' });
      }
    } else {
      // Optional date-range filter: only include dossier entries within [fromDate, toDate]
      // (either bound optional). Undated entries are always kept.
      const fromDate = (req.body.fromDate || '').slice(0, 10);
      const toDate = (req.body.toDate || '').slice(0, 10);
      const inRange = (dateStr) => {
        if (!dateStr) return true;
        const d = String(dateStr).slice(0, 10);
        if (fromDate && d < fromDate) return false;
        if (toDate && d > toDate) return false;
        return true;
      };
      const records = db.listMedicalRecords(patient.id).filter((r) => inRange(r.date));
      let followUps = [];
      let dispensings = [];
      try { followUps = db.listFollowUpReminders({ patientId: patient.id }).filter((f) => inRange(f.dueDate || f.date)); } catch { /* ignore */ }
      try { dispensings = db.db.prepare(`
        SELECT d.*, m.name as medicineName, m.baseUnit, su.name as saleUnitName,
          l.lotNumber, l.expiryDate, i.number as invoiceNumber
        FROM dispensings d
        JOIN medicines m ON m.id = d.medicineId
        LEFT JOIN sale_units su ON su.id = d.saleUnitId
        LEFT JOIN lots l ON l.id = d.lotId
        LEFT JOIN invoices i ON i.id = d.invoiceId
        WHERE d.patientId = ? ORDER BY d.date DESC
      `).all(patient.id).filter((d) => inRange(d.date)); } catch { /* ignore */ }
      // Lab analyses are NOT embedded in the dossier PDF. The client sends `labKeys`
      // = the diagnostic-session keys the user ticked; each selected session is
      // attached to the e-mail as a separate PDF — preferably the original lab
      // report, otherwise a generated one. (Explicit selection, so no date filter.)
      const labKeys = Array.isArray(req.body.labKeys) ? req.body.labKeys : [];
      if (labKeys.length) {
        let labResults = [];
        try { labResults = db.listLabResults(patient.id); } catch { /* ignore */ }
        const bySet = new Map();
        for (const r of labResults) {
          const key = r.diagnosticSetId || r.id;
          if (!bySet.has(key)) bySet.set(key, []);
          bySet.get(key).push(r);
        }
        for (const [key, group] of bySet) {
          if (!labKeys.includes(key)) continue;
          const dt = (group[0].runDate || '').slice(0, 10).replace(/-/g, '') || 'labo';
          const withPdf = group.find((r) => labReportFile(r));
          try {
            const content = withPdf
              ? fs.readFileSync(labReportFile(withPdf))
              : await renderLabPdfBest(group, patient, owner, settings);
            labAttachments.push({
              filename: `analyse-labo-${safeName}-${dt}.pdf`,
              content,
              contentType: 'application/pdf',
            });
          } catch (e) {
            console.error('[pdf] pièce jointe analyse labo échouée :', e.message);
          }
        }
      }
      try {
        pdfBuffer = await renderPatientPdfBest({ patient, owner, records, followUps, dispensings, labResults: [] }, settings);
      } catch (e) {
        return res.status(500).json({ error: 'Génération PDF échouée : ' + e.message });
      }
    }

    // Pièces jointes du patient (radios, photos, documents, vidéos) explicitement
    // cochées par l'utilisateur dans le modal d'envoi. `attachmentIds` scoped to
    // this patient — ignore anything that doesn't belong to it.
    const attachmentIds = Array.isArray(req.body.attachmentIds) ? req.body.attachmentIds : [];
    const fileAttachments = [];
    for (const attId of attachmentIds) {
      const att = db.getAttachment(attId);
      if (!att || att.patientId !== patient.id) continue;
      const absPath = path.join(userDataPath, 'attachments', att.patientId, att.storedFilename);
      if (!fs.existsSync(absPath)) continue;
      fileAttachments.push({ filename: att.originalName, content: fs.createReadStream(absPath), contentType: att.mimeType });
    }

    try {
      await sendEmail(settings, {
        to, subject, text, html,
        attachments: [
          { filename: `dossier-${safeName}.pdf`, content: pdfBuffer, contentType: 'application/pdf' },
          ...labAttachments,
          ...fileAttachments,
        ],
      });
      // Envoi vers un vétérinaire référent : on le journalise pour savoir plus
      // tard qui a reçu quel dossier, et quand.
      const referringVetId = (req.body.referringVetId || '').trim();
      if (referringVetId && db.getReferringVet(referringVetId)) {
        const extras = labAttachments.length + fileAttachments.length;
        db.logReferringVetSend({
          referringVetId,
          patientId: patient.id,
          toEmail: to,
          subject,
          summary: `Dossier PDF${extras ? ` + ${extras} pièce(s) jointe(s)` : ''}`,
          sentBy: req.user.id,
        });
      }
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(500).json({ error: 'Envoi échoué : ' + e.message });
    }
  }));

  // ===== Clients adressés par un confrère =====
  // Un client coché « référé par un vétérinaire » ne peut prendre que les motifs
  // autorisés (réglage `referredAllowedTypeIds`, colonne « Référés » des
  // Paramètres) — typiquement consultation orthopédique et contrôle. Objectif :
  // qu'un patient adressé par son vétérinaire traitant ne prenne pas un rendez-vous
  // de médecine générale chez nous. Liste vide = aucune restriction.
  function referredAllowedTypeIds() {
    return (db.getSettings().referredAllowedTypeIds || '')
      .split(',').map((x) => x.trim()).filter(Boolean);
  }
  // Renvoie un message d'erreur si le motif est interdit pour ce client, sinon null.
  function referralTypeRefusal(ownerId, appointmentTypeId) {
    if (!ownerId) return null;
    const owner = db.getOwner(ownerId);
    if (!owner || !owner.referredByVet) return null;
    const allowed = referredAllowedTypeIds();
    if (allowed.length === 0) return null;
    if (appointmentTypeId && allowed.includes(appointmentTypeId)) return null;
    const names = db.listAppointmentTypes()
      .filter((t) => allowed.includes(t.id))
      .map((t) => t.name);
    const by = owner.referringVetName ? `Dr ${owner.referringVetName}` : 'un confrère';
    return `Ce client est adressé par ${by} : seuls les motifs suivants sont possibles — ${names.join(', ')}.`;
  }

  // ===== Appointments =====
  app.get('/api/appointments', authRequired, wrap((req, res) => {
    const range = (req.query.startDate && req.query.endDate)
      ? { startDate: req.query.startDate, endDate: req.query.endDate }
      : null;
    res.json(db.listAppointments(range));
  }));
  app.post('/api/appointments', authRequired, wrap(async (req, res) => {
    const refusal = referralTypeRefusal(req.body.ownerId, req.body.appointmentTypeId);
    if (refusal) return res.status(400).json({ error: refusal });
    const appt = db.createAppointment({ ...req.body, createdBy: req.user.id });

    // Confirmation au propriétaire, à la demande (case du popup de l'agenda).
    // Le RDV reste créé même si le mail échoue : l'erreur est renvoyée à l'écran.
    let confirmationError = null;
    let confirmationSentTo = null;
    if (req.body.notifyOwner) {
      const settings = db.getSettings();
      const owner = appt.ownerId ? db.getOwner(appt.ownerId) : null;
      if (!owner?.email) {
        confirmationError = 'RDV créé, mais aucune adresse email pour ce propriétaire : confirmation non envoyée.';
      } else if (!settings.smtpHost) {
        confirmationError = 'RDV créé, mais SMTP non configuré : confirmation non envoyée.';
      } else {
        const patient = appt.patientId ? db.getPatient(appt.patientId) : null;
        const type = appt.appointmentTypeId
          ? db.listAppointmentTypes().find((t) => t.id === appt.appointmentTypeId)
          : null;
        const result = await sendBookingConfirmation({ db, secret: JWT_SECRET }, {
          id: appt.id,
          startTime: appt.startTime,
          ownerFirstName: owner.firstName,
          ownerLastName: owner.lastName,
          ownerEmail: owner.email,
          patientName: patient?.name || '',
          typeName: type?.name || appt.title,
        }, 'fr', { selfService: false });
        if (result.ok) confirmationSentTo = owner.email;
        else confirmationError = 'RDV créé, mais la confirmation n\'a pas pu être envoyée : ' + result.error;
      }
    }
    res.json({ ...appt, confirmationSentTo, confirmationError });
  }));
  app.put('/api/appointments/:id', authRequired, wrap((req, res) => {
    const refusal = referralTypeRefusal(req.body.ownerId, req.body.appointmentTypeId);
    if (refusal) return res.status(400).json({ error: refusal });
    const appt = db.updateAppointment(req.params.id, req.body);
    res.json(appt);
  }));
  app.delete('/api/appointments/:id', authRequired, wrap((req, res) => {
    const result = db.deleteAppointment(req.params.id);
    res.json(result);
  }));

  // ===== Appointment types =====
  app.get('/api/appointment-types', authRequired, wrap((req, res) =>
    res.json(db.listAppointmentTypes())
  ));
  app.post('/api/appointment-types', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.createAppointmentType(req.body))
  ));
  app.put('/api/appointment-types/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.updateAppointmentType(req.params.id, req.body))
  ));
  app.delete('/api/appointment-types/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteAppointmentType(req.params.id))
  ));

  // ===== Time blocks =====
  app.get('/api/time-blocks', authRequired, wrap((req, res) => {
    const range = (req.query.startDate && req.query.endDate)
      ? { startDate: req.query.startDate, endDate: req.query.endDate }
      : null;
    res.json(db.listTimeBlocks(range));
  }));
  app.post('/api/time-blocks', authRequired, wrap((req, res) =>
    res.json(db.createTimeBlock({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/time-blocks/:id', authRequired, wrap((req, res) =>
    res.json(db.updateTimeBlock(req.params.id, req.body))
  ));
  app.delete('/api/time-blocks/:id', authRequired, wrap((req, res) =>
    res.json(db.deleteTimeBlock(req.params.id))
  ));

  // ===== Modèles de rapports =====
  const templateFields = (b) => {
    const name = String(b.name || '').trim();
    if (!name) throw Object.assign(new Error('Le nom du modèle est requis.'), { status: 400 });
    return { name, recordType: b.recordType, title: b.title, description: b.description, treatment: b.treatment };
  };
  app.get('/api/record-templates', authRequired, wrap((req, res) => res.json(db.listRecordTemplates())));
  app.post('/api/record-templates', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.createRecordTemplate(templateFields(req.body)))
  ));
  app.put('/api/record-templates/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) => {
    if (!db.getRecordTemplate(req.params.id)) return res.status(404).json({ error: 'Modèle introuvable' });
    res.json(db.updateRecordTemplate(req.params.id, templateFields(req.body)));
  }));
  app.delete('/api/record-templates/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteRecordTemplate(req.params.id))
  ));

  // ===== Services =====
  app.get('/api/services', authRequired, wrap((req, res) => res.json(db.listServices())));
  app.post('/api/services', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.createService(req.body))
  ));
  app.put('/api/services/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.updateService(req.params.id, req.body))
  ));
  app.delete('/api/services/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteService(req.params.id))
  ));

  // ===== Protocols =====
  app.get('/api/protocols', authRequired, wrap((req, res) => res.json(db.listProtocols())));
  app.get('/api/protocols/:id', authRequired, wrap((req, res) => {
    const p = db.getProtocol(req.params.id);
    if (!p) return res.status(404).json({ error: 'Protocole introuvable' });
    res.json(p);
  }));
  app.post('/api/protocols', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) => {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ error: 'Nom obligatoire' });
    }
    res.json(db.createProtocol({ ...req.body, createdBy: req.user.id }));
  }));
  app.put('/api/protocols/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) => {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ error: 'Nom obligatoire' });
    }
    res.json(db.updateProtocol(req.params.id, req.body));
  }));
  app.delete('/api/protocols/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteProtocol(req.params.id))
  ));

  // ===== Medicines (catalog) =====
  // ===== Marges : visibles de l'admin seul =====
  // La santé financière du cabinet ne regarde pas les assistants. Le
  // pourcentage de marge cible ne quitte jamais le serveur pour un autre rôle,
  // et ne peut pas être écrasé par lui. Le coût d'achat reste visible : c'est
  // l'assistant qui réceptionne les lots et le saisit.
  const seesMargins = (req) => req.user?.role === 'admin';
  const stripMargin = (req, med) => {
    if (!med || seesMargins(req)) return med;
    const { targetMarginPct, ...rest } = med;
    return rest;
  };

  app.get('/api/medicines', authRequired, wrap((req, res) =>
    res.json(db.listMedicines({
      activeOnly: req.query.includeInactive !== '1',
      search: req.query.search || '',
    }).map((m) => stripMargin(req, m)))
  ));
  app.get('/api/medicines/:id', authRequired, wrap((req, res) =>
    res.json(stripMargin(req, db.getMedicine(req.params.id)))
  ));

  // Applique la marge cible enregistrée à un coût d'achat et renvoie les prix
  // de vente proposés. Permet à un non-admin de recalculer les prix à la
  // réception d'un lot sans que le pourcentage lui soit jamais transmis.
  app.post('/api/medicines/:id/price-preview', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const med = db.getMedicine(req.params.id);
    if (!med) return res.status(404).json({ error: 'Médicament introuvable' });
    const cost = Number(req.body.costPerBaseUnit);
    if (!cost || cost <= 0) return res.status(400).json({ error: 'Coût par unité de base manquant' });
    // Catégorie choisie à la réception : l'utilisateur désigne une intention
    // (« nourriture »), jamais un pourcentage. Le choix est retenu sur le
    // médicament, pour ne pas avoir à le refaire à chaque lot.
    const st = db.getSettings();
    const presets = {
      medicine: Number(st.marginPresetMedicinePct) || 83,
      food: Number(st.marginPresetFoodPct) || 35,
    };
    const preset = req.body.preset;
    let margin;
    if (preset && presets[preset] != null) {
      margin = presets[preset];
      if (margin !== Number(med.targetMarginPct)) {
        db.updateMedicine(med.id, { ...med, targetMarginPct: margin });
      }
    } else {
      margin = Number(med.targetMarginPct) || 35;
    }
    const saleUnits = (med.saleUnits || []).map((u) => {
      const raw = cost * Number(u.quantityInBaseUnit) * (1 + margin / 100);
      // Arrondi au supérieur, 3 décimales sous 0,10 € pour ne pas perdre de marge
      const f = raw < 0.10 ? 1000 : 100;
      return { ...u, defaultPriceHT: Math.ceil(raw * f) / f };
    });
    res.json({
      saleUnits,
      vatRate: med.defaultVatRate,
      ...(seesMargins(req) ? { targetMarginPct: margin } : {}),
    });
  }));

  // Pourcentages des catégories — l'interface n'en a besoin que pour les
  // afficher à un admin ; un autre rôle ne reçoit que les libellés.
  app.get('/api/margin-presets', authRequired, wrap((req, res) => {
    const st = db.getSettings();
    if (!seesMargins(req)) return res.json({});
    res.json({
      medicine: Number(st.marginPresetMedicinePct) || 83,
      food: Number(st.marginPresetFoodPct) || 35,
    });
  }));
  // Ajouter un médicament au catalogue : admin seul (tout le monde encode les lots).
  app.post('/api/medicines', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.createMedicine({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/medicines/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const data = { ...req.body };
    if (!seesMargins(req)) {
      // Le champ n'est pas envoyé par un non-admin : sans cette reprise,
      // updateMedicine appliquerait son défaut de 35 % et détruirait la
      // marge réelle du médicament.
      const current = db.getMedicine(req.params.id);
      data.targetMarginPct = current?.targetMarginPct;
    }
    res.json(stripMargin(req, db.updateMedicine(req.params.id, data)));
  }));
  app.delete('/api/medicines/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.deleteMedicine(req.params.id))
  ));
  app.put('/api/medicines/:id/sale-units', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.saveSaleUnits(req.params.id, req.body.units || []))
  ));

  // ===== Medicine lots (stock) =====
  app.get('/api/lots', authRequired, wrap((req, res) =>
    res.json(db.listLots({
      medicineId: req.query.medicineId,
      expiringInDays: req.query.expiringInDays != null ? Number(req.query.expiringInDays) : null,
      lowStockOnly: req.query.lowStockOnly === '1',
      withZeroStock: req.query.withZeroStock === '1',
    }))
  ));
  app.get('/api/lots/:id', authRequired, wrap((req, res) => res.json(db.getLot(req.params.id))));
  app.post('/api/lots', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.createLot({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/lots/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.updateLot(req.params.id, req.body))
  ));
  app.delete('/api/lots/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.deleteLot(req.params.id))
  ));

  // ===== Dispensings & reports =====
  app.get('/api/dispensings', authRequired, wrap((req, res) => {
    if (req.query.lotId) return res.json(db.listDispensingsByLot(req.query.lotId));
    if (req.query.patientId) return res.json(db.listDispensingsByPatient(req.query.patientId));
    res.status(400).json({ error: 'lotId or patientId required' });
  }));
  app.get('/api/lots/search', authRequired, wrap((req, res) =>
    res.json(db.searchLotsByNumber(req.query.q || ''))
  ));
  app.get('/api/reports/margin', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.marginReport({ startDate: req.query.startDate, endDate: req.query.endDate }))
  ));
  app.get('/api/reports/financial', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.financialSummary({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      userId: req.query.userId || null,
    }))
  ));
  app.get('/api/reports/activity', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.activityStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      userId: req.query.userId || null,
    }))
  ));
  app.get('/api/reports/tops', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.topStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      limit: req.query.limit ? parseInt(req.query.limit, 10) : 10,
    }))
  ));
  app.get('/api/reports/team', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.teamStats({
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    }))
  ));

  // ===== Monthly overheads (saisie des charges fixes/variables par mois) =====
  app.get('/api/monthly-overheads', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.listMonthlyOverheads({
      startMonth: req.query.startMonth,
      endMonth: req.query.endMonth,
    }))
  ));
  app.post('/api/monthly-overheads', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.createMonthlyOverhead({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/monthly-overheads/:id', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.updateMonthlyOverhead(req.params.id, req.body))
  ));
  app.delete('/api/monthly-overheads/:id', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.deleteMonthlyOverhead(req.params.id))
  ));

  // ===== Invoices =====
  app.get('/api/invoices', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.listInvoices())
  ));
  app.get('/api/invoices/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.getInvoice(req.params.id))
  ));
  // Une facture naît toujours brouillon : la validation (admin) lui donne son numéro.
  app.post('/api/invoices', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.createInvoice({ ...req.body, status: 'draft', createdBy: req.user.id }))
  ));
  app.put('/api/invoices/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.updateInvoice(req.params.id, { ...req.body, createdBy: req.user.id }))
  ));
  // Une facture validée part d'office chez le client (modèle des Paramètres,
  // PDF rendu côté serveur). Renvoie { sentTo } ou { error } sans jamais lever :
  // un e-mail raté ne doit pas annuler la validation.
  async function emailInvoiceToOwner(invoice) {
    const owner = db.getOwner(invoice.ownerId);
    const settings = db.getSettings();
    const to = (owner?.email || '').trim();
    if (!to) return { error: 'pas d\'adresse e-mail sur la fiche client, facture non envoyée' };
    if (!settings.smtpHost) return { error: 'SMTP non configuré, facture non envoyée au client' };
    try {
      const vars = buildInvoiceVars(invoice, owner, settings);
      const text = renderTpl(settings.invoiceEmailBody || DEFAULT_INVOICE_EMAIL_BODY, vars);
      await sendEmail(settings, {
        to,
        subject: renderTpl(settings.invoiceEmailSubject || DEFAULT_INVOICE_EMAIL_SUBJECT, vars),
        text,
        html: invoiceEmailHtml(text),
        attachments: [{
          filename: `facture-${invoice.number || invoice.id}.pdf`,
          content: await renderInvoicePdfBest(invoice, settings),
          contentType: 'application/pdf',
        }],
      });
      return { sentTo: to };
    } catch (e) {
      console.error('[facture] envoi client échoué pour', invoice.number, ':', e.message);
      return { error: 'envoi au client échoué : ' + e.message };
    }
  }

  app.patch('/api/invoices/:id/status', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap(async (req, res) => {
    const prev = db.getInvoice(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Facture introuvable' });
    const newStatus = req.body.status;
    if (prev.status === 'draft' && newStatus !== 'cancelled' && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Seul l'administrateur peut valider une facture." });
    }
    if (newStatus === 'cancelled' && req.user.role !== 'admin') {
      return res.status(403).json({ error: "Seul l'administrateur peut annuler une facture." });
    }
    const paymentMethod = req.body.paymentMethod || prev.paymentMethod || null;
    if (newStatus === 'paid' && !PAYMENT_METHODS[paymentMethod]) {
      return res.status(400).json({ error: 'Mode de paiement requis.' });
    }
    const invoice = db.updateInvoiceStatus(req.params.id, newStatus, paymentMethod);

    // Send an accounting copy to the fiduciary only when the invoice actually
    // becomes paid (not on every PATCH, to avoid resending on repeat clicks).
    const fiduciaryEmailError = newStatus === 'paid' && prev.status !== 'paid'
      ? await sendFiduciaryCopy(invoice, db.getSettings()) : null;
    const client = prev.status === 'draft' && newStatus !== 'cancelled' ? await emailInvoiceToOwner(invoice) : {};
    res.json({ ...invoice, fiduciaryEmailError, clientEmailError: client.error || null, sentTo: client.sentTo || null });
  }));
  // Noter le paiement d'un brouillon : tous les rôles (l'admin validera ensuite).
  app.patch('/api/invoices/:id/payment', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const paymentMethod = req.body.paymentMethod || null;
    if (paymentMethod && !PAYMENT_METHODS[paymentMethod]) {
      return res.status(400).json({ error: 'Mode de paiement invalide.' });
    }
    res.json(db.setDraftPayment(req.params.id, paymentMethod));
  }));
  // Validation groupée : brouillon avec paiement noté → payée, sinon → envoyée.
  app.post('/api/invoices/validate', authRequired, requireRole('admin'), wrap(async (req, res) => {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validated = [];
    const errors = [];
    for (const id of ids) {
      let invoice;
      try {
        invoice = db.validateInvoice(id);
      } catch (e) {
        errors.push({ id, error: e.message });
        continue;
      }
      const client = await emailInvoiceToOwner(invoice);
      validated.push({ id, number: invoice.number, status: invoice.status, sentTo: client.sentTo || null });
      if (client.error) errors.push({ id, number: invoice.number, error: client.error });
      if (invoice.status === 'paid') {
        const err = await sendFiduciaryCopy(invoice, db.getSettings());
        if (err) errors.push({ id, number: invoice.number, error: err });
      }
    }
    res.json({ validated, errors });
  }));
  app.delete('/api/invoices/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteInvoice(req.params.id))
  ));

  // ===== Invoice: email preview + send by mail (PDF attached) =====
  app.get('/api/invoices/:id/email-preview', authRequired, requireRole('admin'), wrap((req, res) => {
    const invoice = db.getInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const owner = db.getOwner(invoice.ownerId);
    const settings = db.getSettings();
    if (invoice.status === 'draft') return res.status(400).json({ error: "Validez la facture avant de l'envoyer." });
    const vars = buildInvoiceVars(invoice, owner, settings);
    const subject = renderTpl(settings.invoiceEmailSubject || DEFAULT_INVOICE_EMAIL_SUBJECT, vars);
    const body = renderTpl(settings.invoiceEmailBody || DEFAULT_INVOICE_EMAIL_BODY, vars);
    res.json({
      to: owner?.email || '',
      subject,
      body,
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
    });
  }));

  app.post('/api/invoices/:id/send', authRequired, requireRole('admin'), wrap(async (req, res) => {
    const invoice = db.getInvoice(req.params.id);
    if (!invoice) return res.status(404).json({ error: 'Facture introuvable' });
    const owner = db.getOwner(invoice.ownerId);
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres)' });
    if (invoice.status === 'cancelled') return res.status(400).json({ error: 'Facture annulée' });
    if (invoice.status === 'draft') return res.status(400).json({ error: "Validez la facture avant de l'envoyer." });

    const vars = buildInvoiceVars(invoice, owner, settings);
    const subject = (req.body.subject && req.body.subject.trim())
      || renderTpl(settings.invoiceEmailSubject || DEFAULT_INVOICE_EMAIL_SUBJECT, vars);
    const text = (req.body.body && req.body.body.trim())
      || renderTpl(settings.invoiceEmailBody || DEFAULT_INVOICE_EMAIL_BODY, vars);
    const html = invoiceEmailHtml(text);

    let pdfBuffer;
    if (req.body.pdfBase64) {
      try {
        pdfBuffer = Buffer.from(req.body.pdfBase64, 'base64');
      } catch (e) {
        return res.status(400).json({ error: 'PDF base64 invalide' });
      }
    } else {
      try {
        pdfBuffer = await renderInvoicePdfBest(invoice, settings);
      } catch (e) {
        return res.status(500).json({ error: 'Génération PDF échouée : ' + e.message });
      }
    }

    try {
      await sendEmail(settings, {
        to, subject, text, html,
        attachments: [{
          filename: `facture-${invoice.number || invoice.id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(500).json({ error: 'Envoi échoué : ' + e.message });
    }
  }));

  // ===== Caisse (admin) =====
  app.get('/api/cash/summary', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.cashSummary({ startDate: req.query.startDate, endDate: req.query.endDate }))
  ));
  app.post('/api/cash/movements', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.addCashMovement({ ...req.body, createdBy: req.user.id }))
  ));
  app.delete('/api/cash/movements/:id', authRequired, requireRole('admin'), wrap((req, res) =>
    res.json(db.deleteCashMovement(req.params.id))
  ));

  // ===== Quotes (devis) =====
  app.get('/api/quotes', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.listQuotes())
  ));
  app.get('/api/quotes/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const quote = db.getQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(quote);
  }));
  app.post('/api/quotes', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.createQuote({ ...req.body, createdBy: req.user.id }))
  ));
  app.put('/api/quotes/:id', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) =>
    res.json(db.updateQuote(req.params.id, req.body))
  ));
  app.patch('/api/quotes/:id/status', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const quote = db.updateQuoteStatus(req.params.id, req.body.status);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    res.json(quote);
  }));
  app.delete('/api/quotes/:id', authRequired, requireRole('admin', 'veterinarian'), wrap((req, res) =>
    res.json(db.deleteQuote(req.params.id))
  ));
  app.get('/api/quotes/:id/email-preview', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap((req, res) => {
    const quote = db.getQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const owner = db.getOwner(quote.ownerId);
    const settings = db.getSettings();
    const vars = buildQuoteVars(quote, owner, settings);
    res.json({
      to: owner?.email || '',
      subject: renderTpl(DEFAULT_QUOTE_EMAIL_SUBJECT, vars),
      body: renderTpl(DEFAULT_QUOTE_EMAIL_BODY, vars),
      ownerHasEmail: !!owner?.email,
      smtpConfigured: !!settings.smtpHost,
    });
  }));
  app.post('/api/quotes/:id/send', authRequired, requireRole('admin', 'veterinarian', 'assistant'), wrap(async (req, res) => {
    const quote = db.getQuote(req.params.id);
    if (!quote) return res.status(404).json({ error: 'Devis introuvable' });
    const owner = db.getOwner(quote.ownerId);
    const settings = db.getSettings();
    const to = (req.body.to || owner?.email || '').trim();
    if (!to) return res.status(400).json({ error: 'Aucun email destinataire' });
    if (!settings.smtpHost) return res.status(400).json({ error: 'SMTP non configuré (voir Paramètres)' });

    const vars = buildQuoteVars(quote, owner, settings);
    const subject = (req.body.subject && req.body.subject.trim()) || renderTpl(DEFAULT_QUOTE_EMAIL_SUBJECT, vars);
    const text = (req.body.body && req.body.body.trim()) || renderTpl(DEFAULT_QUOTE_EMAIL_BODY, vars);

    let pdfBuffer;
    try {
      pdfBuffer = req.body.pdfBase64
        ? Buffer.from(req.body.pdfBase64, 'base64')
        : await renderQuotePdf(quote, settings);
    } catch (e) {
      return res.status(500).json({ error: 'Génération PDF échouée : ' + e.message });
    }

    try {
      await sendEmail(settings, {
        to, subject, text, html: invoiceEmailHtml(text),
        attachments: [{
          filename: `devis-${quote.number || quote.id}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        }],
      });
      // Un brouillon envoyé passe en « envoyé » ; un devis déjà accepté/refusé garde son statut.
      if (quote.status === 'draft') db.updateQuoteStatus(quote.id, 'sent');
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(500).json({ error: 'Envoi échoué : ' + e.message });
    }
  }));

  // ===== Settings =====
  // Le mot de passe SMTP ne quitte jamais le serveur : masqué pour l'admin
  // (le masque renvoyé tel quel à l'enregistrement = inchangé), absent pour
  // les autres rôles.
  const SMTP_PASS_MASK = '••••••••';
  function publicSettings(settings, role) {
    const out = { ...settings };
    if (role === 'admin' && out.smtpPass) out.smtpPass = SMTP_PASS_MASK;
    else delete out.smtpPass;
    return out;
  }
  // ===== Import depuis un autre logiciel (Paramètres → Importer des données) =====
  // Le fichier lu reste en mémoire 1 h sous un jeton : l'aperçu et l'import
  // le réutilisent sans renvoyer des mégaoctets à chaque essai de colonnes.
  const importer = require('./import');
  const importUpload = require('multer')({ storage: require('multer').memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
  const importFiles = new Map(); // jeton -> { headers, rows, fileName, at }
  const IMPORT_TTL = 60 * 60 * 1000;
  const sweepImports = () => { const now = Date.now(); for (const [k, v] of importFiles) if (now - v.at > IMPORT_TTL) importFiles.delete(k); };
  app.post('/api/import/parse', authRequired, requireRole('admin'), (req, res, next) => {
    importUpload.single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Fichier trop volumineux (30 Mo maximum).' : err.message });
      next();
    });
  }, wrap(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier reçu.' });
    sweepImports();
    const fileName = Buffer.from(req.file.originalname || '', 'latin1').toString('utf8');
    const parsed = await importer.parseFile(req.file.buffer, fileName);
    const token = crypto.randomUUID();
    importFiles.set(token, { ...parsed, fileName, at: Date.now() });
    res.json({
      token, fileName, headers: parsed.headers, totalRows: parsed.rows.length,
      sampleRows: parsed.rows.slice(0, 5), suggestions: importer.suggestMapping(parsed.headers),
      fields: importer.FIELDS, delimiter: parsed.delimiter, sheet: parsed.sheet,
    });
  }));
  app.post('/api/import/run', authRequired, requireRole('admin'), wrap((req, res) => {
    const f = importFiles.get(req.body.token);
    if (!f) return res.status(410).json({ error: 'Fichier expiré : déposez-le à nouveau.' });
    const mapping = Array.isArray(req.body.mapping) ? req.body.mapping.slice(0, f.headers.length) : [];
    const dryRun = req.body.dryRun !== false;
    const report = importer.runImport(db.db, {
      headers: f.headers, rows: f.rows, mapping, options: req.body.options || {},
      dryRun, fileName: f.fileName, userId: req.user.id,
    });
    if (!dryRun) importFiles.delete(req.body.token);
    res.json(report);
  }));
  app.get('/api/import/batches', authRequired, requireRole('admin'), wrap((req, res) => {
    res.json(importer.listBatches(db.db));
  }));
  app.post('/api/import/batches/:id/undo', authRequired, requireRole('admin'), wrap((req, res) => {
    res.json(importer.undoBatch(db.db, req.params.id));
  }));

  // ===== Export complet des données (Paramètres → Exporter mes données) =====
  app.get('/api/export/all', authRequired, requireRole('admin'), wrap((req, res) => {
    res.json({
      application: 'Colveto',
      exportedAt: new Date().toISOString(),
      tables: db.exportAll(),
    });
  }));

  app.get('/api/settings', authRequired, wrap((req, res) => res.json(publicSettings(db.getSettings(), req.user.role))));
  app.put('/api/settings', authRequired, requireRole('admin'), wrap((req, res) => {
    const data = { ...req.body };
    if (data.smtpPass === SMTP_PASS_MASK) delete data.smtpPass;
    // L'accord sur les conditions ne s'enregistre que par /api/terms/accept.
    delete data.termsVersion; delete data.termsAcceptedAt; delete data.termsAcceptedBy;
    res.json(publicSettings(db.saveSettings(data), req.user.role));
  }));

  // ===== Stats =====
  app.get('/api/stats/dashboard', authRequired, wrap((req, res) =>
    res.json(db.getDashboardStats())
  ));

  // ===== Follow-up reminders (vaccination, contrôle, etc.) =====
  app.get('/api/follow-ups', authRequired, wrap((req, res) =>
    res.json(db.listFollowUpReminders(req.query))
  ));

  app.post('/api/follow-ups', authRequired, wrap((req, res) =>
    res.json(db.createFollowUpReminder({ ...req.body, createdBy: req.user.id }))
  ));

  app.put('/api/follow-ups/:id', authRequired, wrap((req, res) =>
    res.json(db.updateFollowUpReminder(req.params.id, req.body))
  ));

  app.delete('/api/follow-ups/:id', authRequired, wrap((req, res) =>
    res.json(db.deleteFollowUpReminder(req.params.id))
  ));

  // ===== Reminders =====
  app.get('/api/reminders', authRequired, wrap((req, res) =>
    res.json(db.listReminders(parseInt(req.query.limit, 10) || 100))
  ));

  app.get('/api/reminders/by-appointment/:id', authRequired, wrap((req, res) =>
    res.json(db.listRemindersByAppointment(req.params.id))
  ));

  app.post('/api/reminders/send/:appointmentId', authRequired, requireRole('admin', 'veterinarian'), wrap(async (req, res) => {
    const appt = db.db.prepare(`
      SELECT a.*,
        p.name as patientName,
        o.firstName as ownerFirstName, o.lastName as ownerLastName, o.email as ownerEmail,
        t.name as typeName
      FROM appointments a
      LEFT JOIN patients p ON p.id = a.patientId
      LEFT JOIN owners o ON o.id = a.ownerId
      LEFT JOIN appointment_types t ON t.id = a.appointmentTypeId
      WHERE a.id = ?
    `).get(req.params.appointmentId);
    if (!appt) return res.status(404).json({ error: 'RDV introuvable' });
    if (!appt.ownerEmail) return res.status(400).json({ error: 'Aucun email pour ce client' });
    const result = await sendReminderForAppointment({ db, secret: JWT_SECRET }, appt);
    res.json(result);
  }));

  app.post('/api/email/test', authRequired, requireRole('admin'), wrap(async (req, res) => {
    const settings = db.getSettings();
    try {
      await testSmtp(settings);
      const to = req.body.to || settings.smtpFromEmail;
      await sendEmail(settings, {
        to,
        subject: 'Test SMTP — Colveto',
        text: 'Si vous recevez cet email, votre configuration SMTP fonctionne.',
        html: '<p>Si vous recevez cet email, votre configuration SMTP fonctionne. ✓</p>',
      });
      res.json({ ok: true, sentTo: to });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // ===== Public booking API (no auth) =====
  app.get('/api/public/cabinet-info', wrap((req, res) => {
    const s = db.getSettings();
    res.json({
      name: s.clinicName || 'Cabinet vétérinaire',
      address: s.clinicAddress || '',
      city: s.clinicCity || '',
      postalCode: s.clinicPostalCode || '',
      phone: s.clinicPhone || '',
      email: s.clinicEmail || s.smtpFromEmail || '',
      website: s.clinicWebsite || '',
      openHour: parseInt(s.cabinetOpenHour || '9', 10),
      closeHour: parseInt(s.cabinetCloseHour || '18', 10),
      minBookingDate: s.publicBookingMinDate || '',
      minAdvanceHours: Math.max(0, parseFloat(s.publicBookingMinAdvanceHours || '1')),
      closedDays: (s.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)),
    });
  }));

  function publicTypes() {
    const setting = (db.getSettings().publicBookableTypeIds || '').trim();
    const allowed = setting ? setting.split(',').map((s) => s.trim()).filter(Boolean) : null;
    let types = db.listAppointmentTypes();
    if (allowed) types = types.filter((t) => allowed.includes(t.id));
    return types;
  }
  app.get('/api/public/types', wrap((req, res) => {
    res.json(publicTypes());
  }));

  // Free slots for one date + appointment type.
  // Shared by /api/public/availability and /api/public/available-days.
  function publicAvailability(date, typeId) {
    const sset = db.getSettings();
    const minDate = (sset.publicBookingMinDate || '').trim();
    if (minDate && date < minDate) return [];
    const closedDays = (sset.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
    const dow = new Date(date + 'T12:00:00').getDay();
    if (closedDays.includes(dow)) return [];
    const type = typeId ? db.listAppointmentTypes().find((t) => t.id === typeId) : null;
    const duration = type ? type.defaultDuration : 30;
    const settings = db.getSettings();
    const openHour = parseInt(settings.cabinetOpenHour || '9', 10);
    const closeHour = parseInt(settings.cabinetCloseHour || '18', 10);
    const slotMinutes = parseInt(settings.cabinetSlotMinutes || '15', 10);
    const minAdvanceMs = Math.max(0, parseFloat(settings.publicBookingMinAdvanceHours || '1')) * 60 * 60 * 1000;

    // Build candidate slots
    const dayStart = new Date(`${date}T00:00:00`);
    const slots = [];
    for (let h = openHour; h < closeHour; h++) {
      for (let m = 0; m < 60; m += slotMinutes) {
        const start = new Date(dayStart);
        start.setHours(h, m, 0, 0);
        const end = new Date(start);
        end.setMinutes(end.getMinutes() + duration);
        // Skip if extends past closing
        if (end.getHours() > closeHour || (end.getHours() === closeHour && end.getMinutes() > 0)) continue;
        // Enforce minimum advance booking window (configurable in Settings)
        if (start.getTime() < Date.now() + minAdvanceMs) continue;
        slots.push({ start: start.toISOString(), end: end.toISOString() });
      }
    }

    // Remove busy slots (existing appointments + time blocks)
    const dayEnd = new Date(dayStart); dayEnd.setHours(23, 59, 59, 999);
    const appts = db.listAppointments({ startDate: dayStart.toISOString(), endDate: dayEnd.toISOString() });
    const blocks = db.listTimeBlocks({ startDate: dayStart.toISOString(), endDate: dayEnd.toISOString() });

    const busy = [];
    for (const a of appts) {
      if (a.status === 'cancelled') continue;
      busy.push({ start: new Date(a.startTime).getTime(), end: new Date(a.endTime).getTime() });
    }
    for (const b of blocks) {
      // Expand recurring blocks for that date
      const blockStart = new Date(b.startTime);
      const blockEnd = new Date(b.endTime);
      if (b.recurrence) {
        const dayDate = new Date(date);
        let matches = false;
        const dow = dayDate.getDay();
        if (b.recurrence === 'daily') matches = true;
        else if (b.recurrence === 'weekdays') matches = dow >= 1 && dow <= 5;
        else if (b.recurrence === 'weekly') matches = dow === blockStart.getDay();
        if (matches && dayDate >= new Date(blockStart.toISOString().slice(0, 10))) {
          const occStart = new Date(dayStart);
          occStart.setHours(blockStart.getHours(), blockStart.getMinutes(), 0, 0);
          const occEnd = new Date(dayStart);
          occEnd.setHours(blockEnd.getHours(), blockEnd.getMinutes(), 0, 0);
          if (occEnd <= occStart) occEnd.setDate(occEnd.getDate() + 1);
          busy.push({ start: occStart.getTime(), end: occEnd.getTime() });
        }
      } else if (blockEnd >= dayStart && blockStart <= dayEnd) {
        busy.push({ start: blockStart.getTime(), end: blockEnd.getTime() });
      }
    }

    const available = slots.filter((s) => {
      const st = new Date(s.start).getTime();
      const en = new Date(s.end).getTime();
      return !busy.some((b) => st < b.end && en > b.start);
    });

    return available;
  }

  app.get('/api/public/availability', wrap((req, res) => {
    const { date, typeId } = req.query;
    if (!date) return res.status(400).json({ error: 'date required' });
    res.json(publicAvailability(date, typeId));
  }));

  // Dates (YYYY-MM-DD) that still have at least one free slot, in chronological
  // order. Used by the public booking page so fully booked / closed days are
  // simply not offered.
  app.get('/api/public/available-days', wrap((req, res) => {
    const { typeId } = req.query;
    const limit = Math.min(60, Math.max(1, parseInt(req.query.limit || '30', 10)));
    const horizon = Math.min(365, Math.max(1, parseInt(req.query.horizon || '120', 10)));
    const sset = db.getSettings();
    const closedDays = (sset.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
    const minDate = (sset.publicBookingMinDate || '').trim();
    const days = [];
    const cursor = new Date(); cursor.setHours(12, 0, 0, 0);
    for (let i = 0; i < horizon && days.length < limit; i++) {
      const iso = cursor.getFullYear() + '-' + String(cursor.getMonth() + 1).padStart(2, '0') + '-' + String(cursor.getDate()).padStart(2, '0');
      if ((!minDate || iso >= minDate) && !closedDays.includes(cursor.getDay())) {
        if (publicAvailability(iso, typeId).length > 0) days.push(iso);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    res.json(days);
  }));

  // Page publique : sans plafond, un script pourrait remplir l'agenda et faire
  // envoyer des e-mails de confirmation à n'importe quelle adresse.
  const bookLimiter = makeLimiter({
    windowMs: 60 * 60 * 1000, maxHits: 6, blockMs: 60 * 60 * 1000,
    message: 'Trop de réservations depuis cette adresse.',
  });

  app.post('/api/public/book', bookLimiter, wrap((req, res) => {
    const { firstName, lastName, email, phone, patientName, species, breed,
            startTime, endTime, typeId, reason, lang } = req.body;
    if (!firstName || !lastName || !email || !phone || !patientName || !species || !startTime || !endTime) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }
    const tooLong = [firstName, lastName, email, phone, patientName, species, breed, typeId]
      .some((v) => v != null && (typeof v !== 'string' || v.length > 200))
      || (reason != null && (typeof reason !== 'string' || reason.length > 2000));
    if (tooLong || typeof startTime !== 'string' || typeof endTime !== 'string') {
      return res.status(400).json({ error: 'Champs invalides.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Adresse e-mail invalide.' });
    }
    if ([firstName, lastName, patientName, species, breed].some(looksLikeLink)) {
      return res.status(400).json({ error: 'Les noms ne peuvent pas contenir d\'adresse web ni d\'e-mail.' });
    }
    if (typeId && !publicTypes().some((t) => t.id === typeId)) {
      return res.status(400).json({ error: 'Motif non réservable en ligne.' });
    }
    const reqStart = new Date(startTime).getTime();
    const reqEnd = new Date(endTime).getTime();
    if (isNaN(reqStart) || isNaN(reqEnd)) {
      return res.status(400).json({ error: 'Créneau invalide.' });
    }
    const sset = db.getSettings();
    const minDate = (sset.publicBookingMinDate || '').trim();
    const startDate = startTime.slice(0, 10);
    if (minDate && startDate < minDate) {
      return res.status(400).json({ error: 'Réservation impossible avant le ' + minDate + '.' });
    }
    const minAdvanceMs = Math.max(0, parseFloat(sset.publicBookingMinAdvanceHours || '1')) * 60 * 60 * 1000;
    if (new Date(startTime).getTime() < Date.now() + minAdvanceMs) {
      return res.status(400).json({ error: 'Ce créneau est trop proche. Merci de choisir un créneau plus tardif.' });
    }
    const closedDays = (sset.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
    const dowBook = new Date(startTime).getDay();
    if (closedDays.includes(dowBook)) {
      return res.status(400).json({ error: 'Le cabinet est fermé ce jour-là.' });
    }
    // Verify slot still available
    const dayStart = new Date(startTime); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(startTime); dayEnd.setHours(23, 59, 59, 999);
    const appts = db.listAppointments({ startDate: dayStart.toISOString(), endDate: dayEnd.toISOString() });
    const conflict = appts.find((a) => {
      if (a.status === 'cancelled') return false;
      const aSt = new Date(a.startTime).getTime();
      const aEn = new Date(a.endTime).getTime();
      const sSt = new Date(startTime).getTime();
      const sEn = new Date(endTime).getTime();
      return sSt < aEn && sEn > aSt;
    });
    if (conflict) return res.status(409).json({ error: 'Ce créneau vient d\'être pris. Veuillez choisir un autre.' });
    // Le créneau demandé doit être exactement l'un de ceux proposés (horaires,
    // durée du motif, blocages) : sinon un endTime arbitraire bloquerait l'agenda.
    const localDay = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const offered = publicAvailability(localDay, typeId).some((s) =>
      new Date(s.start).getTime() === reqStart && new Date(s.end).getTime() === reqEnd);
    if (!offered) return res.status(409).json({ error: 'Ce créneau n\'est pas disponible. Veuillez en choisir un autre.' });

    // Create owner (or find existing by email)
    let owner = db.db.prepare('SELECT * FROM owners WHERE email = ? LIMIT 1').get(email);
    if (!owner) {
      owner = db.createOwner({ firstName, lastName, email, phone });
    }
    // Client adressé par un confrère : il ne peut réserver en ligne que les
    // motifs autorisés (pas de médecine générale). Le contrôle n'est possible
    // qu'ici, l'email n'étant connu qu'à la dernière étape du formulaire.
    const refusal = referralTypeRefusal(owner.id, typeId);
    if (refusal) {
      return res.status(400).json({
        error: refusal + ' Merci de reprendre la réservation avec l\'un de ces motifs, ou de contacter le cabinet.',
      });
    }
    // Find or create patient (name comparison is case + accent-insensitive)
    const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const targetName = norm(patientName);
    const existingPatients = db.db.prepare('SELECT * FROM patients WHERE ownerId = ?').all(owner.id);
    let patient = existingPatients.find((p) => norm(p.name) === targetName);
    if (!patient) {
      patient = db.createPatient({
        ownerId: owner.id, name: patientName, species, breed: breed || null,
      });
    }
    // Create appointment
    const type = typeId ? db.listAppointmentTypes().find((t) => t.id === typeId) : null;
    const settings = db.getSettings();
    const autoConfirm = settings.publicBookingAutoConfirm !== '0';
    const appointment = db.createAppointment({
      patientId: patient.id,
      ownerId: owner.id,
      startTime,
      endTime,
      title: `${type?.name || 'RDV'} - ${patientName}`,
      reason: reason || `Réservation en ligne par ${firstName} ${lastName}`,
      status: autoConfirm ? 'scheduled' : 'scheduled',
      appointmentTypeId: typeId || null,
    });

    // Send confirmation email to client (fire-and-forget; don't block booking response)
    if (settings.smtpHost) {
      const apptForEmail = {
        id: appointment.id,
        startTime,
        ownerFirstName: firstName,
        ownerLastName: lastName,
        ownerEmail: email,
        patientName,
        typeName: type?.name || 'Rendez-vous',
      };
      sendBookingConfirmation({ db, secret: JWT_SECRET }, apptForEmail, lang)
        .catch((e) => console.error('Booking confirmation email error:', e.message));
    }

    res.json({ ok: true, appointmentId: appointment.id });
  }));

  // ===== Public confirmation/cancellation pages (no auth) =====
  function renderPublicPage(title, message, color = '#16a34a') {
    return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;color:#1f2937;}
.card{max-width:480px;margin:60px auto;background:white;padding:40px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;}
.icon{font-size:64px;margin-bottom:16px;}
h1{margin:0 0 12px 0;color:${color};}
p{color:#6b7280;line-height:1.6;}
</style></head><body>
<div class="card"><div class="icon">${color === '#16a34a' ? '✓' : (color === '#dc2626' ? '✕' : 'ℹ')}</div>
<h1>${title}</h1><p>${message}</p></div></body></html>`;
  }

  app.get('/r/confirm/:appointmentId/:token', wrap((req, res) => {
    const { appointmentId, token } = req.params;
    if (!verifyToken(JWT_SECRET, appointmentId, 'confirm', token)) {
      return res.status(403).type('html').send(renderPublicPage(
        'Lien invalide', 'Ce lien de confirmation n\'est pas valide ou a expiré.', '#dc2626'
      ));
    }
    const appt = db.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt) {
      return res.status(404).type('html').send(renderPublicPage(
        'Rendez-vous introuvable', 'Ce rendez-vous n\'existe plus.', '#dc2626'
      ));
    }
    if (appt.status === 'cancelled') {
      return res.type('html').send(renderPublicPage(
        'Rendez-vous annulé', 'Ce rendez-vous a déjà été annulé.', '#dc2626'
      ));
    }
    db.db.prepare("UPDATE appointments SET status = 'confirmed' WHERE id = ?").run(appointmentId);
    res.type('html').send(renderPublicPage(
      'Rendez-vous confirmé',
      'Merci ! Votre rendez-vous est confirmé. À très bientôt au cabinet.',
      '#16a34a'
    ));
  }));

  // GET: show review page with appointment details + form to confirm cancellation
  app.get('/r/cancel/:appointmentId/:token', wrap((req, res) => {
    const { appointmentId, token } = req.params;
    if (!verifyToken(JWT_SECRET, appointmentId, 'cancel', token)) {
      return res.status(403).type('html').send(renderPublicPage(
        'Lien invalide', 'Ce lien d\'annulation n\'est pas valide ou a expire.', '#dc2626'
      ));
    }
    const appt = db.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt) {
      return res.status(404).type('html').send(renderPublicPage(
        'Rendez-vous introuvable', 'Ce rendez-vous n\'existe plus.', '#dc2626'
      ));
    }
    if (appt.status === 'cancelled') {
      return res.type('html').send(renderPublicPage(
        'Rendez-vous deja annule', 'Ce rendez-vous a deja ete annule.', '#f59e0b'
      ));
    }
    const settings = db.getSettings();
    const start = new Date(appt.startTime);
    const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const monthNames = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    const dateStr = dayNames[start.getDay()] + ' ' + start.getDate() + ' ' + monthNames[start.getMonth()] +
      ' a ' + String(start.getHours()).padStart(2,'0') + 'h' + String(start.getMinutes()).padStart(2,'0');
    const tooLate = (start.getTime() - Date.now()) < 2 * 60 * 60 * 1000;
    if (tooLate) {
      return res.type('html').send(renderPublicPage(
        'Trop tard pour annuler en ligne',
        'Votre rendez-vous a lieu ' + dateStr + ', soit dans moins de 2 heures. Merci de contacter directement le cabinet' + (settings.clinicPhone ? ' au <strong>' + settings.clinicPhone + '</strong>' : '') + '.',
        '#dc2626'
      ));
    }
    const reviewHtml = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Annuler votre rendez-vous</title>' +
      '<style>' +
      'body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;color:#1f2937;}' +
      '.card{max-width:480px;margin:60px auto;background:white;padding:36px 32px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);text-align:center;}' +
      '.icon{font-size:48px;margin-bottom:14px;}' +
      'h1{margin:0 0 14px 0;color:#1f2937;font-size:1.5rem;}' +
      '.date{background:#fef3c7;border-radius:6px;padding:14px;margin:18px 0;font-weight:600;color:#92400e;}' +
      'p{color:#6b7280;line-height:1.6;}' +
      '.btn-row{display:flex;gap:10px;margin-top:22px;}' +
      '.btn{flex:1;padding:12px 16px;border-radius:8px;font-size:1rem;border:none;cursor:pointer;font-weight:500;font-family:inherit;text-decoration:none;display:inline-block;line-height:1.5;}' +
      '.btn-cancel{background:#dc2626;color:white;}' +
      '.btn-cancel:hover{background:#b91c1c;}' +
      '.btn-back{background:#f3f4f6;color:#1f2937;}' +
      '.btn-back:hover{background:#e5e7eb;}' +
      '.btn-reschedule{background:#2563eb;color:white;display:block;margin-bottom:10px;}' +
      '.btn-reschedule:hover{background:#1d4ed8;}' +
      '</style></head><body>' +
      '<div class="card">' +
      '<div class="icon">&#9888;</div>' +
      '<h1>Annuler ou reporter ?</h1>' +
      '<div class="date">' + dateStr + '</div>' +
      '<a class="btn btn-reschedule" href="/r/reschedule/' + appointmentId + '/' + makeToken(JWT_SECRET, appointmentId, 'reschedule') + '">Reporter a une autre date</a>' +
      '<p>Ou souhaitez-vous annuler ce rendez-vous ? Cette action est irreversible.</p>' +
      '<form method="POST" action="/r/cancel/' + appointmentId + '/' + token + '">' +
      '<div class="btn-row">' +
      '<a class="btn btn-back" href="' + clinicLinks(db.getSettings()).website + '">Garder mon RDV</a>' +
      '<button type="submit" class="btn btn-cancel">Oui, annuler</button>' +
      '</div></form></div></body></html>';
    res.type('html').send(reviewHtml);
  }));

  // POST: actually cancel the appointment
  app.post('/r/cancel/:appointmentId/:token', wrap((req, res) => {
    const { appointmentId, token } = req.params;
    if (!verifyToken(JWT_SECRET, appointmentId, 'cancel', token)) {
      return res.status(403).type('html').send(renderPublicPage(
        'Lien invalide', 'Ce lien d\'annulation n\'est pas valide ou a expire.', '#dc2626'
      ));
    }
    const appt = db.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt) {
      return res.status(404).type('html').send(renderPublicPage(
        'Rendez-vous introuvable', 'Ce rendez-vous n\'existe plus.', '#dc2626'
      ));
    }
    if (appt.status === 'cancelled') {
      return res.type('html').send(renderPublicPage(
        'Rendez-vous deja annule', 'Ce rendez-vous a deja ete annule.', '#f59e0b'
      ));
    }
    const start = new Date(appt.startTime);
    const tooLate = (start.getTime() - Date.now()) < 2 * 60 * 60 * 1000;
    const settings = db.getSettings();
    if (tooLate) {
      return res.type('html').send(renderPublicPage(
        'Trop tard pour annuler en ligne',
        'Le rendez-vous a lieu dans moins de 2 heures. Merci de contacter directement le cabinet' + (settings.clinicPhone ? ' au <strong>' + settings.clinicPhone + '</strong>' : '') + '.',
        '#dc2626'
      ));
    }
    db.db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(appointmentId);
    res.type('html').send(renderPublicPage(
      'Rendez-vous annule',
      'Votre rendez-vous a bien ete annule. Pour reprendre rendez-vous, vous pouvez retourner sur <a href="' + clinicLinks(db.getSettings()).booking + '" style="color:#2563eb;">' + clinicLinks(db.getSettings()).bookingLabel + '</a>' + (settings.clinicPhone ? ' ou appeler le ' + settings.clinicPhone : '') + '.',
      '#f59e0b'
    ));
  }));

  // GET: reschedule page — pick a new slot for an existing appointment
  app.get('/r/reschedule/:appointmentId/:token', wrap((req, res) => {
    const { appointmentId, token } = req.params;
    if (!verifyToken(JWT_SECRET, appointmentId, 'reschedule', token)) {
      return res.status(403).type('html').send(renderPublicPage(
        'Lien invalide', 'Ce lien de modification n\'est pas valide ou a expire.', '#dc2626'
      ));
    }
    const appt = db.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt) {
      return res.status(404).type('html').send(renderPublicPage(
        'Rendez-vous introuvable', 'Ce rendez-vous n\'existe plus.', '#dc2626'
      ));
    }
    if (appt.status === 'cancelled') {
      return res.type('html').send(renderPublicPage(
        'Rendez-vous annule', 'Ce rendez-vous a ete annule. Pour reprendre rendez-vous, rendez-vous sur <a href="' + clinicLinks(db.getSettings()).booking + '" style="color:#2563eb;">' + clinicLinks(db.getSettings()).bookingLabel + '</a>.', '#f59e0b'
      ));
    }
    const settings = db.getSettings();
    const start = new Date(appt.startTime);
    const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const monthNames = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    const dateStr = dayNames[start.getDay()] + ' ' + start.getDate() + ' ' + monthNames[start.getMonth()] +
      ' a ' + String(start.getHours()).padStart(2, '0') + 'h' + String(start.getMinutes()).padStart(2, '0');
    const tooLate = (start.getTime() - Date.now()) < 2 * 60 * 60 * 1000;
    if (tooLate) {
      return res.type('html').send(renderPublicPage(
        'Trop tard pour modifier en ligne',
        'Votre rendez-vous a lieu ' + dateStr + ', soit dans moins de 2 heures. Merci de contacter directement le cabinet' + (settings.clinicPhone ? ' au <strong>' + settings.clinicPhone + '</strong>' : '') + '.',
        '#dc2626'
      ));
    }
    const now = new Date();
    const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    const minDate = (settings.publicBookingMinDate || '').trim();
    const minPick = (minDate && minDate > todayStr) ? minDate : todayStr;
    const cfg = JSON.stringify({
      typeId: appt.appointmentTypeId || '',
      closedDays: (settings.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n)),
    });
    const html = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Modifier votre rendez-vous</title>' +
      '<style>' +
      'body{font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:20px;color:#1f2937;}' +
      '.card{max-width:480px;margin:40px auto;background:white;padding:32px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.1);}' +
      'h1{margin:0 0 8px 0;font-size:1.4rem;text-align:center;}' +
      '.cur{background:#fef3c7;border-radius:6px;padding:12px;margin:16px 0;font-weight:600;color:#92400e;text-align:center;}' +
      '.intro{color:#6b7280;text-align:center;line-height:1.6;}' +
      'label{display:block;font-weight:600;margin:18px 0 6px;}' +
      'input[type=date]{width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;box-sizing:border-box;font-family:inherit;}' +
      '#slots{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;}' +
      '.slot{padding:10px 14px;border:1px solid #2563eb;background:white;color:#2563eb;border-radius:8px;cursor:pointer;font-size:1rem;font-family:inherit;}' +
      '.slot:hover{background:#2563eb;color:white;}' +
      '.msg{color:#6b7280;text-align:center;margin-top:14px;}' +
      '.foot{text-align:center;margin-top:22px;}' +
      '.foot a{color:#6b7280;font-size:0.9rem;}' +
      '</style></head><body>' +
      '<div class="card">' +
      '<h1>Modifier votre rendez-vous</h1>' +
      '<div class="cur">Actuel : ' + dateStr + '</div>' +
      '<p class="intro">Choisissez une nouvelle date, puis un creneau disponible.</p>' +
      '<label for="d">Nouvelle date</label>' +
      '<input type="date" id="d" min="' + minPick + '" value="' + minPick + '">' +
      '<form method="POST" action="/r/reschedule/' + appointmentId + '/' + token + '" id="f">' +
      '<div id="slots"></div></form>' +
      '<div class="msg" id="msg">Selectionnez une date pour voir les creneaux.</div>' +
      '<div class="foot"><a href="' + clinicLinks(db.getSettings()).website + '">Annuler la modification</a></div>' +
      '</div>' +
      '<script>' +
      'var CFG=' + cfg + ';' +
      'var d=document.getElementById("d"),slotsEl=document.getElementById("slots"),msg=document.getElementById("msg");' +
      'function ft(iso){var t=new Date(iso);return String(t.getHours()).padStart(2,"0")+"h"+String(t.getMinutes()).padStart(2,"0");}' +
      'function load(){slotsEl.innerHTML="";msg.textContent="Chargement...";var date=d.value;if(!date){msg.textContent="Choisissez une date.";return;}' +
      'var dow=new Date(date+"T12:00:00").getDay();if(CFG.closedDays.indexOf(dow)>=0){msg.textContent="Le cabinet est ferme ce jour-la. Choisissez une autre date.";return;}' +
      'fetch("/api/public/availability?date="+date+"&typeId="+encodeURIComponent(CFG.typeId)).then(function(r){return r.json();}).then(function(slots){' +
      'if(!slots.length){msg.textContent="Aucun creneau disponible ce jour-la.";return;}msg.textContent="";' +
      'slots.forEach(function(s){var b=document.createElement("button");b.type="submit";b.name="start";b.value=s.start;b.className="slot";b.textContent=ft(s.start);slotsEl.appendChild(b);});' +
      '}).catch(function(){msg.textContent="Erreur de chargement. Reessayez.";});}' +
      'd.addEventListener("change",load);load();' +
      '</' + 'script></body></html>';
    res.type('html').send(html);
  }));

  // POST: apply the new slot
  app.post('/r/reschedule/:appointmentId/:token', wrap((req, res) => {
    const { appointmentId, token } = req.params;
    if (!verifyToken(JWT_SECRET, appointmentId, 'reschedule', token)) {
      return res.status(403).type('html').send(renderPublicPage(
        'Lien invalide', 'Ce lien de modification n\'est pas valide ou a expire.', '#dc2626'
      ));
    }
    const appt = db.db.prepare('SELECT * FROM appointments WHERE id = ?').get(appointmentId);
    if (!appt) {
      return res.status(404).type('html').send(renderPublicPage(
        'Rendez-vous introuvable', 'Ce rendez-vous n\'existe plus.', '#dc2626'
      ));
    }
    if (appt.status === 'cancelled') {
      return res.type('html').send(renderPublicPage(
        'Rendez-vous annule', 'Ce rendez-vous a ete annule.', '#f59e0b'
      ));
    }
    const settings = db.getSettings();
    const curStart = new Date(appt.startTime);
    const tooLate = (curStart.getTime() - Date.now()) < 2 * 60 * 60 * 1000;
    if (tooLate) {
      return res.type('html').send(renderPublicPage(
        'Trop tard pour modifier en ligne',
        'Le rendez-vous a lieu dans moins de 2 heures. Merci de contacter directement le cabinet' + (settings.clinicPhone ? ' au <strong>' + settings.clinicPhone + '</strong>' : '') + '.',
        '#dc2626'
      ));
    }
    const backLink = '/r/reschedule/' + appointmentId + '/' + token;
    const retry = (m) => renderPublicPage('Creneau indisponible', m + ' <a href="' + backLink + '" style="color:#2563eb;">Choisir un autre creneau</a>.', '#dc2626');
    const newStart = req.body.start;
    if (!newStart || isNaN(new Date(newStart).getTime())) {
      return res.status(400).type('html').send(retry('Creneau invalide.'));
    }
    const newStartMs = new Date(newStart).getTime();
    const minDate = (settings.publicBookingMinDate || '').trim();
    if (minDate && newStart.slice(0, 10) < minDate) return res.type('html').send(retry('Cette date n\'est pas disponible.'));
    const minAdvanceMs = Math.max(0, parseFloat(settings.publicBookingMinAdvanceHours || '1')) * 60 * 60 * 1000;
    if (newStartMs < Date.now() + minAdvanceMs) return res.type('html').send(retry('Ce creneau est trop proche.'));
    const closedDays = (settings.cabinetClosedDays || '0,6').split(',').map((x) => parseInt(x.trim(), 10)).filter((n) => !isNaN(n));
    if (closedDays.includes(new Date(newStart).getDay())) return res.type('html').send(retry('Le cabinet est ferme ce jour-la.'));
    const duration = new Date(appt.endTime).getTime() - curStart.getTime();
    const newEnd = new Date(newStartMs + duration);
    // Verify the slot is still free (ignore this appointment itself)
    const dayStart = new Date(newStart); dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(newStart); dayEnd.setHours(23, 59, 59, 999);
    const dayAppts = db.listAppointments({ startDate: dayStart.toISOString(), endDate: dayEnd.toISOString() });
    const conflict = dayAppts.find((a) => {
      if (a.id === appointmentId || a.status === 'cancelled') return false;
      return newStartMs < new Date(a.endTime).getTime() && newEnd.getTime() > new Date(a.startTime).getTime();
    });
    if (conflict) return res.type('html').send(retry('Ce creneau vient d\'etre pris.'));
    // Comme pour /api/public/book : seul un créneau réellement proposé est
    // accepté (horaires d'ouverture, grille, plages bloquées), sinon le lien
    // permettrait de placer le RDV à n'importe quelle heure.
    const localDay = `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`;
    const offered = publicAvailability(localDay, appt.appointmentTypeId || undefined)
      .some((s) => new Date(s.start).getTime() === newStartMs);
    if (!offered) return res.type('html').send(retry('Ce creneau n\'est pas disponible.'));
    db.db.prepare('UPDATE appointments SET startTime = ?, endTime = ? WHERE id = ?').run(newStart, newEnd.toISOString(), appointmentId);
    const ns = new Date(newStart);
    const dayNames = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
    const monthNames = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
    const newDateStr = dayNames[ns.getDay()] + ' ' + ns.getDate() + ' ' + monthNames[ns.getMonth()] +
      ' a ' + String(ns.getHours()).padStart(2, '0') + 'h' + String(ns.getMinutes()).padStart(2, '0');
    res.type('html').send(renderPublicPage(
      'Rendez-vous modifie',
      'C\'est note ! Votre rendez-vous est maintenant prevu le <strong>' + newDateStr + '</strong>. A tres bientot au cabinet.',
      '#16a34a'
    ));
  }));

  // ===== Backups =====
  app.get('/api/backup/status', authRequired, wrap((req, res) => {
    const s = db.getSettings();
    const destinations = JSON.parse(s.backupDestinations || '[]');
    res.json({
      enabled: s.backupEnabled === '1',
      time: s.backupTime || '22:00',
      destinations,
      lastBackupAt: s.lastBackupAt || null,
      lastBackupResult: s.lastBackupResult ? JSON.parse(s.lastBackupResult) : null,
    });
  }));

  app.put('/api/backup/config', authRequired, requireRole('admin'), wrap((req, res) => {
    const { enabled, time, destinations } = req.body;
    db.saveSettings({
      backupEnabled: enabled ? '1' : '0',
      backupTime: time || '22:00',
      backupDestinations: JSON.stringify(destinations || []),
    });
    res.json({ ok: true });
  }));

  app.post('/api/backup/run', authRequired, requireRole('admin'), wrap(async (req, res) => {
    const s = db.getSettings();
    const destinations = JSON.parse(s.backupDestinations || '[]');
    if (destinations.length === 0) {
      return res.status(400).json({ error: 'Aucune destination de sauvegarde configuree' });
    }
    const result = await runBackup(db, destinations);
    if (result.ok) {
      db.saveSettings({
        lastBackupAt: result.at,
        lastBackupResult: JSON.stringify({ ok: true, count: result.written.length }),
      });
    } else {
      db.saveSettings({
        lastBackupResult: JSON.stringify({ ok: false, errors: result.errors }),
      });
    }
    res.json(result);
  }));

  app.get('/api/backup/list', authRequired, requireRole('admin'), wrap((req, res) => {
    const s = db.getSettings();
    const destinations = JSON.parse(s.backupDestinations || '[]');
    res.json(listBackups(destinations));
  }));

  // ===== Sage exports =====
  app.get('/api/sage/fec', authRequired, requireRole('admin'), wrap((req, res) => {
    const text = db.generateFEC({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.json({ content: text });
  }));
  app.get('/api/sage/csv', authRequired, requireRole('admin'), wrap((req, res) => {
    const text = db.generateInvoicesCSV({ startDate: req.query.startDate, endDate: req.query.endDate });
    res.json({ content: text });
  }));

  // ===== Portail vétérinaires référents =====
  registerReferralRoutes(app, { db, userDataPath, authRequired, requireRole, wrap });

  return app;
}

// ===== Accès public seul (rendez-vous en ligne depuis Internet) =====
// Second point d'entrée à exposer sur Internet (tunnel Cloudflare, reverse
// proxy…) quand le serveur tourne sur l'ordinateur central du cabinet.
// Liste blanche : pages publiques (prise de RDV, adressage, suivi), leur API
// sans connexion (/api/public/…) et les liens des emails (/r/…). Tout le reste
// — l'application du personnel (/app) et l'API authentifiée — répond 404 :
// les données du cabinet restent inaccessibles depuis Internet.
function createPublicApp(app, { publicDir = path.join(__dirname, 'public') } = {}) {
  const pub = express();
  pub.disable('x-powered-by');
  pub.set('trust proxy', 1);
  if (fs.existsSync(publicDir)) pub.use(express.static(publicDir, { index: 'index.html' }));
  pub.use((req, res, next) => {
    let p;
    try { p = decodeURIComponent(req.path); } catch { p = ''; }
    // Le routeur Express ignore la casse : on compare en minuscules.
    p = p.toLowerCase().replace(/\/{2,}/g, '/');
    const allowed = p === '/api/ping' || p.startsWith('/api/public/') || p.startsWith('/r/');
    if (!allowed || p.includes('..')) return res.status(404).type('text').send('Introuvable');
    return app(req, res, next);
  });
  return pub;
}

module.exports = { createServer, createPublicApp };
