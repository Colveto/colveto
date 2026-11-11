const crypto = require('crypto');
const { sendEmail } = require('./email');

const DEFAULT_SUBJECT = 'Rappel de votre RDV chez {{cabinetName}} le {{dayName}} {{date}}';

const DEFAULT_BODY = `Bonjour {{ownerFirstName}},

Nous vous rappelons votre rendez-vous au cabinet {{cabinetName}} :

🐾 Patient : {{patientName}}
📅 Date : {{dayName}} {{date}} à {{time}}
🩺 Motif : {{type}}

{{#confirmUrl}}
Pour confirmer votre rendez-vous : {{confirmUrl}}
Pour le reporter : {{rescheduleUrl}}
Pour l'annuler : {{cancelUrl}}
{{/confirmUrl}}
{{^confirmUrl}}
Si vous ne pouvez pas venir, merci de nous prévenir au {{cabinetPhone}}.
{{/confirmUrl}}

À très bientôt,
L'équipe {{cabinetName}}`;

const DEFAULT_FOLLOWUP_SUBJECT = 'Rappel pour {{patientName}} : {{title}}';

const DEFAULT_FOLLOWUP_BODY = `Bonjour {{ownerFirstName}},

C'est le moment du rappel pour {{patientName}} :

📌 {{title}}
{{#notes}}
ℹ️ {{notes}}
{{/notes}}

Merci de prendre rendez-vous au cabinet {{cabinetName}}{{#cabinetPhone}} au {{cabinetPhone}}{{/cabinetPhone}}{{#publicBaseUrl}} ou en ligne sur {{publicBaseUrl}}{{/publicBaseUrl}}.

À très bientôt,
L'équipe {{cabinetName}}`;

function makeToken(secret, appointmentId, action) {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${appointmentId}:${action}`);
  return hmac.digest('hex').substring(0, 24);
}

function verifyToken(secret, appointmentId, action, token) {
  const expected = makeToken(secret, appointmentId, action);
  // constant-time compare
  if (!token || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  }
  return diff === 0;
}

function renderTemplate(template, vars) {
  // Handle simple Mustache-style sections {{#var}}...{{/var}} and {{^var}}...{{/var}}
  let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, content) => {
    return vars[name] ? content : '';
  });
  out = out.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, name, content) => {
    return vars[name] ? '' : content;
  });
  // Replace simple variables
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v ?? '');
  }
  return out;
}

const DAY_NAMES = {
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
};
const MONTH_NAMES = {
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};

function buildVars(appointment, settings, secret, lang) {
  const L = (lang === 'en') ? 'en' : 'fr';
  const start = new Date(appointment.startTime);
  const dayNames = DAY_NAMES[L];
  const monthNames = MONTH_NAMES[L];
  const timeSep = (L === 'en') ? ':' : 'h';
  const dateStr = (L === 'en')
    ? `${monthNames[start.getMonth()]} ${start.getDate()}`
    : `${start.getDate()} ${monthNames[start.getMonth()]}`;

  const publicBase = (settings.publicBaseUrl || '').replace(/\/+$/, '');
  const confirmUrl = publicBase ? `${publicBase}/r/confirm/${appointment.id}/${makeToken(secret, appointment.id, 'confirm')}` : '';
  const cancelUrl = publicBase ? `${publicBase}/r/cancel/${appointment.id}/${makeToken(secret, appointment.id, 'cancel')}` : '';
  const rescheduleUrl = publicBase ? `${publicBase}/r/reschedule/${appointment.id}/${makeToken(secret, appointment.id, 'reschedule')}` : '';

  return {
    ownerFirstName: appointment.ownerFirstName || '',
    ownerLastName: appointment.ownerLastName || '',
    patientName: appointment.patientName || (L === 'en' ? 'your pet' : 'votre animal'),
    date: dateStr,
    dayName: dayNames[start.getDay()],
    time: `${String(start.getHours()).padStart(2, '0')}${timeSep}${String(start.getMinutes()).padStart(2, '0')}`,
    type: appointment.typeName || appointment.title || (L === 'en' ? 'appointment' : 'rendez-vous'),
    cabinetName: settings.clinicName || (L === 'en' ? 'your veterinary clinic' : 'votre cabinet vétérinaire'),
    cabinetPhone: settings.clinicPhone || '',
    cabinetAddress: settings.clinicAddress || '',
    confirmUrl,
    cancelUrl,
    rescheduleUrl,
    lang: L,
  };
}

function renderHtml(textBody) {
  // Wrap in basic styled HTML, convert URLs to links and linebreaks to <br>
  const escaped = textBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#2563eb;text-decoration:underline;">$1</a>'
  );
  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;max-width:600px;margin:0 auto;padding:20px;">
<div style="background:white;padding:24px;border-radius:8px;border:1px solid #e5e7eb;">
${linked.split('\n').map((l) => `<div>${l || '&nbsp;'}</div>`).join('')}
</div>
</body></html>`;
}

async function sendFollowUpReminder(deps, followUp) {
  const { db } = deps;
  const settings = db.getSettings();
  const vars = {
    ownerFirstName: followUp.ownerFirstName || '',
    ownerLastName: followUp.ownerLastName || '',
    patientName: followUp.patientName || 'votre animal',
    title: followUp.title || '',
    notes: followUp.notes || '',
    type: followUp.type || '',
    cabinetName: settings.clinicName || 'votre cabinet vétérinaire',
    cabinetPhone: settings.clinicPhone || '',
    cabinetAddress: settings.clinicAddress || '',
    publicBaseUrl: settings.publicBaseUrl || '',
  };
  const subject = renderTemplate(settings.followUpEmailSubject || DEFAULT_FOLLOWUP_SUBJECT, vars);
  const text = renderTemplate(settings.followUpEmailBody || DEFAULT_FOLLOWUP_BODY, vars);
  const html = renderHtml(text);

  try {
    await sendEmail(settings, {
      to: followUp.ownerEmail,
      subject,
      text,
      html,
    });
    db.markFollowUpSent(followUp.id, new Date().toISOString(), null);
    return { ok: true };
  } catch (e) {
    db.markFollowUpSent(followUp.id, new Date().toISOString(), e.message);
    return { ok: false, error: e.message };
  }
}

// `selfService: false` (RDV posé par le cabinet, ex. une chirurgie) : pas de
// liens pour reporter/annuler en ligne, le client est invité à appeler.
async function sendBookingConfirmation(deps, appointment, lang, { selfService = true } = {}) {
  const { db, secret } = deps;
  const settings = db.getSettings();
  const vars = buildVars(appointment, settings, secret, lang);
  if (!selfService) {
    vars.cancelUrl = '';
    vars.rescheduleUrl = '';
  }
  const isEn = vars.lang === 'en';
  const contactLine = !selfService
    ? (isEn
      ? `To change this appointment, please call us${vars.cabinetPhone ? ' at ' + vars.cabinetPhone : ''}.\n\n`
      : `Pour toute modification, merci de nous contacter${vars.cabinetPhone ? ' au ' + vars.cabinetPhone : ''}.\n\n`)
    : '';

  const subject = isEn
    ? `Booking confirmation — ${vars.cabinetName}`
    : `Confirmation de votre rendez-vous — ${vars.cabinetName}`;

  const text = isEn
    ? `Hello ${vars.ownerFirstName},

Your appointment is confirmed:

🐾 Pet: ${vars.patientName}
📅 Date: ${vars.dayName} ${vars.date} at ${vars.time}
🩺 Reason: ${vars.type}
📍 ${vars.cabinetName}${vars.cabinetAddress ? '\n   ' + vars.cabinetAddress : ''}${vars.cabinetPhone ? '\n📞 ' + vars.cabinetPhone : ''}

${vars.cancelUrl ? 'To reschedule this appointment: ' + vars.rescheduleUrl + '\nTo cancel it: ' + vars.cancelUrl + '\n(up to 2 hours before)\n\n' : ''}${contactLine}See you soon,
The ${vars.cabinetName} team`
    : `Bonjour ${vars.ownerFirstName},

Votre rendez-vous est confirmé :

🐾 Patient : ${vars.patientName}
📅 Date : ${vars.dayName} ${vars.date} à ${vars.time}
🩺 Motif : ${vars.type}
📍 ${vars.cabinetName}${vars.cabinetAddress ? '\n   ' + vars.cabinetAddress : ''}${vars.cabinetPhone ? '\n📞 ' + vars.cabinetPhone : ''}

${vars.cancelUrl ? 'Pour reporter ce rendez-vous : ' + vars.rescheduleUrl + '\nPour l\'annuler : ' + vars.cancelUrl + '\n(jusqu\'à 2h avant)\n\n' : ''}${contactLine}À très bientôt,
L'équipe ${vars.cabinetName}`;

  const html = renderHtml(text);

  try {
    await sendEmail(settings, {
      to: appointment.ownerEmail,
      subject,
      text,
      html,
    });
    return { ok: true };
  } catch (e) {
    console.error('Booking confirmation email failed:', e.message);
    return { ok: false, error: e.message };
  }
}

async function sendReminderForAppointment(deps, appointment) {
  const { db, secret } = deps;
  const settings = db.getSettings();
  const vars = buildVars(appointment, settings, secret);
  const subject = renderTemplate(settings.reminderEmailSubject || DEFAULT_SUBJECT, vars);
  const text = renderTemplate(settings.reminderEmailBody || DEFAULT_BODY, vars);
  const html = renderHtml(text);

  try {
    await sendEmail(settings, {
      to: appointment.ownerEmail,
      subject,
      text,
      html,
    });
    db.createReminder({
      appointmentId: appointment.id,
      channel: 'email',
      recipient: appointment.ownerEmail,
      status: 'sent',
      sentAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    db.createReminder({
      appointmentId: appointment.id,
      channel: 'email',
      recipient: appointment.ownerEmail,
      status: 'failed',
      errorMsg: e.message,
    });
    return { ok: false, error: e.message };
  }
}

function startScheduler(deps) {
  const { db } = deps;
  const tick = async () => {
    try {
      const settings = db.getSettings();
      if (settings.reminderEnabled !== '1') return;
      if (!settings.smtpHost) return;
      const hoursBefore = parseInt(settings.reminderHoursBefore || '24', 10);
      const now = new Date();
      const horizon = new Date(now);
      horizon.setHours(now.getHours() + hoursBefore);

      const appts = db.findAppointmentsNeedingReminder(now.toISOString(), horizon.toISOString());
      for (const a of appts) {
        await sendReminderForAppointment(deps, a);
      }

      // Follow-up reminders
      const today = new Date().toISOString().slice(0, 10);
      const followUps = db.findFollowUpsToSend(today);
      for (const f of followUps) {
        await sendFollowUpReminder(deps, f);
      }
    } catch (e) {
      console.error('Reminder scheduler error', e);
    }
  };
  setTimeout(tick, 10_000);
  setInterval(tick, 5 * 60_000);
}

module.exports = {
  startScheduler,
  sendReminderForAppointment,
  sendFollowUpReminder,
  sendBookingConfirmation,
  makeToken,
  verifyToken,
  renderTemplate,
  buildVars,
  DEFAULT_SUBJECT,
  DEFAULT_BODY,
  DEFAULT_FOLLOWUP_SUBJECT,
  DEFAULT_FOLLOWUP_BODY,
};
