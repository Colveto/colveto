const nodemailer = require('nodemailer');

// Mode démo (DEMO_MODE=1) : aucun email ne doit jamais quitter le serveur.
// Le verrou est placé ici, au point de passage unique de tous les envois
// (server.js, reminders.js, referrals.js) — impossible d'en oublier un.
const DEMO_MODE = process.env.DEMO_MODE === '1';
const DEMO_ERROR = "Envoi d'emails désactivé en mode démo — en conditions réelles, ce message serait envoyé au destinataire.";

function buildTransport(settings) {
  if (!settings.smtpHost) return null;
  const port = parseInt(settings.smtpPort, 10) || 587;
  const config = {
    host: settings.smtpHost,
    port,
    secure: settings.smtpSecure === '1' || port === 465,
  };
  if (settings.smtpUser) {
    config.auth = { user: settings.smtpUser, pass: settings.smtpPass };
  }
  return nodemailer.createTransport(config);
}

function fromAddress(settings) {
  const email = (settings.smtpFromEmail || settings.smtpUser || '').trim();
  if (!email) throw new Error('Adresse expéditeur non configurée');
  const name = (settings.smtpFromName || settings.clinicName || '').trim();
  return name ? `"${name.replace(/"/g, '')}" <${email}>` : email;
}

async function sendEmail(settings, { to, cc, bcc, subject, html, text, attachments }) {
  if (DEMO_MODE) {
    console.log(`[demo] Email bloqué → ${to} | ${subject}`);
    throw new Error(DEMO_ERROR);
  }
  const transport = buildTransport(settings);
  if (!transport) throw new Error('SMTP non configuré');
  return transport.sendMail({
    from: fromAddress(settings),
    to,
    cc,
    bcc,
    subject,
    text,
    html,
    attachments,
  });
}

async function testConnection(settings) {
  if (DEMO_MODE) throw new Error(DEMO_ERROR);
  const transport = buildTransport(settings);
  if (!transport) throw new Error('SMTP non configuré');
  await transport.verify();
  return true;
}

// Champs saisis sur les formulaires publics (noms, animal…) et recopiés dans
// les e-mails partant de l'adresse du cabinet vers une adresse elle aussi
// saisie : sans ce filtre, n'importe qui pourrait faire envoyer par le cabinet
// un message contenant un lien de son choix (hameçonnage).
const LINK_RE = /(:\/\/|www\.|@|\b[a-z0-9-]+\.(com|net|org|info|biz|io|co|app|link|click|xyz|top|site|online|shop|ru|cn|lu|be|fr|de|nl|uk|eu|pt|es|it|ch|me|ly|gl)\b)/i;
function looksLikeLink(value) {
  return typeof value === 'string' && LINK_RE.test(value);
}

module.exports = { sendEmail, testConnection, looksLikeLink };
