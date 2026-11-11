import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import InvoiceLineEditor from '../components/InvoiceLineEditor.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../components/Toast.jsx';
import { printCurrentPageToPDFBase64, printRouteToPDFBase64 } from '../lib/api.js';
import { num, fmtEur, discountFields, docDiscountPct } from '../lib/money.js';
import { templateVars, fillTemplate, firstPlaceholder, placeholderTabHandler } from '../lib/recordTemplates.js';

const RECORD_TYPES = ['Consultation', 'Vaccination', 'Chirurgie', 'Examen', 'Prescription', 'Autre'];

// Default follow-up reminder lead-time (in months) per record type
const DEFAULT_FOLLOWUP_MONTHS = {
  Vaccination: 12,
  Examen: 6,
  Chirurgie: 1,
};

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// ----- Lab results display helpers -----
function flagStyle(flag) {
  switch (flag) {
    case 'high': return { color: '#dc2626', fontWeight: 700 };
    case 'low': return { color: '#2563eb', fontWeight: 700 };
    case 'critical': return { color: '#fff', background: '#dc2626', fontWeight: 700, padding: '0 4px', borderRadius: 3 };
    default: return {};
  }
}
function flagArrow(flag) {
  if (flag === 'high' || flag === 'critical') return '▲ ';
  if (flag === 'low') return '▼ ';
  return '';
}
function refRange(a) {
  if (a.refLow == null && a.refHigh == null) return '';
  return `${a.refLow ?? ''} – ${a.refHigh ?? ''}`;
}
function fmtLabDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d)) return value;
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}
// Group per-instrument result rows into one session per diagnosticSetId.
function groupLabResults(results) {
  const map = new Map();
  for (const r of results) {
    const key = r.diagnosticSetId || r.id;
    if (!map.has(key)) {
      map.set(key, { key, runDate: r.runDate, instruments: [], results: [], reportResultId: null });
    }
    const g = map.get(key);
    g.results.push(r);
    if (r.instrument) g.instruments.push(r.instrument);
    if (!g.reportResultId && r.reportPdfPath) g.reportResultId = r.id;
    if (!g.runDate && r.runDate) g.runDate = r.runDate;
  }
  return Array.from(map.values());
}

const buildEmpty = (user) => ({
  date: new Date().toISOString().slice(0, 10),
  type: 'Consultation', title: '', description: '',
  treatment: '', weight: '', temperature: '',
  veterinarian: user?.role === 'veterinarian' ? user.fullName : '',
  followUpEnabled: false,
  followUpDate: '',
  followUpTitle: '',
  followUpNotes: '',
});

export default function PatientDetail() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [patient, setPatient] = useState(null);
  const [records, setRecords] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(() => buildEmpty(user));
  const [editPatient, setEditPatient] = useState(null);
  const [emailDraft, setEmailDraft] = useState(null);
  const [recordEmailDraft, setRecordEmailDraft] = useState(null);
  const [labEmailDraft, setLabEmailDraft] = useState(null);
  const [sending, setSending] = useState(false);
  const [labRequests, setLabRequests] = useState([]);
  const [labResults, setLabResults] = useState([]);
  const [expandedLabs, setExpandedLabs] = useState(() => new Set());
  const [showLabModal, setShowLabModal] = useState(false);
  const [labForm, setLabForm] = useState({ note: '' });
  const [labSubmitting, setLabSubmitting] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [referralCase, setReferralCase] = useState(null);
  const [attachmentEmailDraft, setAttachmentEmailDraft] = useState(null);
  const [siblingPatients, setSiblingPatients] = useState([]);
  const [billingServices, setBillingServices] = useState([]);
  const [billingMedicines, setBillingMedicines] = useState([]);
  const [billingProtocols, setBillingProtocols] = useState([]);
  const [billingItems, setBillingItems] = useState([]);
  const [ownerDraftInvoice, setOwnerDraftInvoice] = useState(null);
  const [savingInvoice, setSavingInvoice] = useState(false);
  const [recordTemplates, setRecordTemplates] = useState([]);
  const titleRef = useRef(null);
  const descriptionRef = useRef(null);
  const treatmentRef = useRef(null);

  useEffect(() => {
    window.api.recordTemplates.list().then(setRecordTemplates).catch(() => {});
  }, []);

  const load = () => {
    window.api.patients.get(id).then(setPatient);
    window.api.records.listByPatient(id).then(setRecords);
    window.api.followUps.list({ patientId: id }).then(setFollowUps);
    window.api.lab.listRequests(id).then(setLabRequests).catch(() => {});
    window.api.lab.listResults(id).then(setLabResults).catch(() => {});
    window.api.attachments.list(id).then(setAttachments).catch(() => {});
    window.api.referrals.list({ patientId: id }).then((list) => setReferralCase(list[0] || null)).catch(() => {});
  };
  useEffect(load, [id]);

  // Lien « ✉ Envoyer au référent » venu de la fiche d'un confrère ou de la fiche
  // client : ?sendTo=<vetId> ouvre le modal d'envoi déjà pointé sur lui. Le
  // paramètre est retiré de l'URL pour ne pas rouvrir le modal au rechargement.
  useEffect(() => {
    const vetId = searchParams.get('sendTo');
    if (!vetId || !patient) return;
    setSearchParams({}, { replace: true });
    openSendEmail({ vetId });
  }, [patient, searchParams]);

  // Billing: catalog, the owner's other animals (for the per-line animal picker),
  // and any draft invoice already open for this owner (so lines get merged into it
  // rather than spawning a second invoice for the same visit).
  const loadBilling = () => {
    if (!patient?.ownerId) return;
    window.api.services.list().then(setBillingServices).catch(() => {});
    window.api.medicines.list().then(setBillingMedicines).catch(() => {});
    window.api.protocols.list().then(setBillingProtocols).catch(() => setBillingProtocols([]));
    window.api.patients.list(patient.ownerId).then(setSiblingPatients).catch(() => {});
    window.api.invoices.list()
      .then((all) => setOwnerDraftInvoice(all.find((i) => i.ownerId === patient.ownerId && i.status === 'draft') || null))
      .catch(() => {});
  };
  useEffect(loadBilling, [patient?.ownerId]);

  const saveBilling = async () => {
    if (billingItems.length === 0) return;
    for (const it of billingItems) {
      if (!it.description) { showToast('Renseignez la description de toutes les lignes', 'error'); return; }
      if (it.kind === 'product' && (!it.medicineId || !it.saleUnitId || !it.lotId)) {
        showToast('Ligne produit incomplète : ' + it.description, 'error');
        return;
      }
    }
    // Lignes déjà enregistrées : prix net + remise conservés tels quels.
    const toPayload = (it) => ({
      kind: it.kind, description: it.description, quantity: num(it.quantity), priceHT: num(it.priceHT),
      listPriceHT: it.listPriceHT ?? null, discountPct: it.discountPct ?? null,
      vatRate: num(it.vatRate), accountCode: it.accountCode,
      serviceId: it.serviceId || null, medicineId: it.medicineId || null,
      lotId: it.lotId || null, saleUnitId: it.saleUnitId || null,
      patientId: it.patientId || id,
    });
    setSavingInvoice(true);
    try {
      let inv;
      if (ownerDraftInvoice) {
        const full = await window.api.invoices.get(ownerDraftInvoice.id);
        // Brouillon déjà remisé : les nouveaux actes reçoivent la même remise.
        const pct = docDiscountPct(full.items);
        inv = await window.api.invoices.update(ownerDraftInvoice.id, {
          ownerId: full.ownerId, patientId: full.patientId, date: full.date, dueDate: full.dueDate,
          notes: full.notes, createdBy: user?.id,
          items: [
            ...(full.items || []).map(toPayload),
            ...billingItems.map((it) => ({ ...toPayload(it), ...discountFields(it, pct) })),
          ],
        });
      } else {
        inv = await window.api.invoices.create({
          ownerId: patient.ownerId, patientId: id, date: new Date().toISOString().slice(0, 10),
          status: 'draft', notes: '', createdBy: user?.id,
          items: billingItems.map(toPayload),
        });
      }
      setBillingItems([]);
      setOwnerDraftInvoice(inv);
      showToast('Facture ' + inv.number + ' mise à jour ✓', 'success');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSavingInvoice(false);
    }
  };

  const uploadAttachments = async (fileList, category) => {
    if (!fileList || fileList.length === 0) return;
    setUploadingFiles(true);
    try {
      const formData = new FormData();
      for (const f of fileList) formData.append('files', f);
      formData.append('category', category);
      await window.api.attachments.upload(id, formData);
      showToast('Pièce(s) jointe(s) ajoutée(s)', 'success');
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setUploadingFiles(false);
    }
  };

  const removeAttachment = async (attId) => {
    if (!confirm('Supprimer cette pièce jointe ?')) return;
    await window.api.attachments.remove(attId);
    load();
  };

  const toggleAttachmentVisibility = async (att) => {
    await window.api.attachments.update(att.id, { notes: att.notes, visibleToReferrer: !att.visibleToReferrer });
    load();
  };

  const openAttachment = async (attId) => {
    try {
      const url = await window.api.attachments.fileObjectUrl(attId);
      window.open(url, '_blank');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openSendAttachment = async (att, lang = 'fr') => {
    try {
      const preview = await window.api.attachments.emailPreview(att.id, lang);
      if (!preview.smtpConfigured) {
        showToast('SMTP non configuré — voir Paramètres', 'error');
        return;
      }
      setAttachmentEmailDraft({
        attachmentId: att.id,
        attachment: att,
        attachmentLabel: att.originalName,
        lang: preview.lang,
        to: preview.to,
        subject: preview.subject,
        body: preview.body,
        ownerHasEmail: preview.ownerHasEmail,
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const switchAttachmentEmailLang = (lang) => {
    if (lang === attachmentEmailDraft.lang) return;
    openSendAttachment(attachmentEmailDraft.attachment, lang);
  };

  const sendAttachmentEmail = async () => {
    if (!attachmentEmailDraft.to?.trim()) {
      showToast('Email destinataire requis', 'error');
      return;
    }
    setSending(true);
    try {
      await window.api.attachments.send(attachmentEmailDraft.attachmentId, {
        to: attachmentEmailDraft.to.trim(),
        subject: attachmentEmailDraft.subject,
        body: attachmentEmailDraft.body,
        lang: attachmentEmailDraft.lang,
      });
      showToast('Pièce jointe envoyée à ' + attachmentEmailDraft.to, 'success');
      setAttachmentEmailDraft(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  if (!patient) return <div>Chargement…</div>;

  const save = async () => {
    if (!editing.title) { showToast('Titre requis', 'error'); return; }
    const data = {
      patientId: id,
      date: editing.date,
      type: editing.type,
      title: editing.title,
      description: editing.description,
      treatment: editing.treatment,
      weight: editing.weight ? parseFloat(editing.weight) : null,
      temperature: editing.temperature ? parseFloat(editing.temperature) : null,
      veterinarian: editing.veterinarian,
    };
    try {
      if (editing.id) {
        await window.api.records.update(editing.id, data);
        showToast('Acte modifié', 'success');
      } else {
        data.createdBy = user?.id;
        if (editing.followUpEnabled && editing.followUpDate) {
          data.followUp = {
            scheduledDate: editing.followUpDate,
            title: editing.followUpTitle || `Rappel ${editing.type.toLowerCase()} - ${patient?.name || ''}`,
            notes: editing.followUpNotes || '',
            type: editing.type,
          };
        }
        await window.api.records.create(data);
        showToast('Acte enregistré', 'success');
      }
      setShowModal(false);
      setEditing(buildEmpty(user));
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const startEdit = (rec) => {
    setEditing({
      id: rec.id,
      date: rec.date,
      type: rec.type,
      title: rec.title,
      description: rec.description || '',
      treatment: rec.treatment || '',
      weight: rec.weight || '',
      temperature: rec.temperature || '',
      veterinarian: rec.veterinarian || '',
      followUpEnabled: false,
      followUpDate: '',
      followUpTitle: '',
      followUpNotes: '',
    });
    setShowModal(true);
  };

  const typeFields = (type) => {
    const months = DEFAULT_FOLLOWUP_MONTHS[type];
    return {
      type,
      followUpEnabled: !!months,
      followUpDate: months ? addMonths(editing.date, months) : '',
      followUpTitle: months
        ? `Rappel ${type.toLowerCase()} - ${patient?.name || ''}`
        : '',
    };
  };
  const onTypeChange = (type) => setEditing({ ...editing, ...typeFields(type) });

  // Pré-remplit l'acte avec un modèle, puis sélectionne le premier champ [..]
  // à compléter (titre, sinon description, sinon traitement).
  const applyTemplate = (templateId) => {
    const tpl = recordTemplates.find((t) => t.id === templateId);
    if (!tpl) return;
    const hasContent = editing.title || editing.description || editing.treatment;
    if (hasContent && !confirm('Remplacer le titre, la description et le traitement par ce modèle ?')) return;
    const vars = templateVars(patient, { weight: editing.weight || displayWeight, date: editing.date });
    const next = {
      ...editing,
      ...(tpl.recordType && RECORD_TYPES.includes(tpl.recordType) && !editing.id ? typeFields(tpl.recordType) : {}),
      title: fillTemplate(tpl.title, vars),
      description: fillTemplate(tpl.description, vars),
      treatment: fillTemplate(tpl.treatment, vars),
    };
    setEditing(next);
    setTimeout(() => {
      for (const [ref, text] of [[titleRef, next.title], [descriptionRef, next.description], [treatmentRef, next.treatment]]) {
        const span = firstPlaceholder(text);
        if (span && ref.current) {
          ref.current.focus();
          ref.current.setSelectionRange(span[0], span[1]);
          return;
        }
      }
    }, 0);
  };
  const rowsFor = (text, min) => Math.min(22, Math.max(min, String(text || '').split('\n').length + 1));

  const removeFollowUp = async (followUpId) => {
    if (!confirm('Annuler ce rappel ? Aucun email ne sera envoyé.')) return;
    await window.api.followUps.delete(followUpId);
    load();
  };

  const remove = async (recId) => {
    if (!confirm('Supprimer cet acte médical ?')) return;
    await window.api.records.delete(recId);
    load();
  };

  const removePatient = async () => {
    if (!confirm(`Supprimer définitivement ${patient.name} ? Cette action est irréversible (ses actes médicaux et rappels seront aussi supprimés).`)) return;
    try {
      await window.api.patients.delete(patient.id);
      showToast('Animal supprimé', 'success');
      navigate(patient.ownerId ? `/owners/${patient.ownerId}` : '/patients');
    } catch (e) {
      const msg = /FOREIGN KEY|constraint/i.test(e.message)
        ? "Impossible : cet animal a des factures liées. Supprimez les factures d'abord."
        : e.message;
      showToast(msg, 'error');
    }
  };

  const requestAnalysis = async () => {
    setLabSubmitting(true);
    try {
      await window.api.lab.createRequest({ patientId: id, note: labForm.note || null });
      showToast('Demande enregistrée', 'success');
      setShowLabModal(false);
      setLabForm({ note: '' });
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setLabSubmitting(false);
    }
  };

  const cancelLabRequest = async (reqId) => {
    if (!confirm('Annuler cette demande d\'analyse ?')) return;
    try {
      await window.api.lab.cancelRequest(reqId);
      load();
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openLabReport = async (resultId) => {
    try {
      const url = await window.api.lab.reportObjectUrl(resultId);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      showToast('Rapport PDF indisponible', 'error');
    }
  };

  const openSendLab = async (resultId, label) => {
    try {
      const preview = await window.api.lab.resultEmailPreview(resultId);
      if (!preview.smtpConfigured) { showToast('SMTP non configuré — voir Paramètres', 'error'); return; }
      if (!preview.hasReport) { showToast('Pas de rapport PDF pour cette analyse', 'error'); return; }
      setLabEmailDraft({
        resultId,
        label,
        to: preview.to,
        subject: preview.subject,
        body: preview.body,
        ownerHasEmail: preview.ownerHasEmail,
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const sendLabEmail = async () => {
    if (!labEmailDraft.to?.trim()) { showToast('Email destinataire requis', 'error'); return; }
    setSending(true);
    try {
      await window.api.lab.sendResult(labEmailDraft.resultId, {
        to: labEmailDraft.to.trim(),
        subject: labEmailDraft.subject,
        body: labEmailDraft.body,
      });
      showToast('Analyses envoyées à ' + labEmailDraft.to, 'success');
      setLabEmailDraft(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const vetTpl = (tpl, name) => (tpl || '').replace(/\{\{vetName\}\}/g, name || '');

  // Bascule de destinataire : l'adresse et le modèle de message suivent. Le
  // texte n'est réécrit que s'il n'a pas été retouché à la main, pour ne jamais
  // effacer une saisie.
  const applyRecipient = (d, mode, vetId) => {
    const vetOf = (vid) => d.vets.find((v) => v.id === vid) || null;
    const prev = d.mode === 'vet' ? vetOf(d.referringVetId) : null;
    const prevSubject = d.mode === 'vet' ? vetTpl(d.vetSubjectTpl, prev?.name) : d.ownerSubject;
    const prevBody = d.mode === 'vet' ? vetTpl(d.vetBodyTpl, prev?.name) : d.ownerBody;
    const untouched = d.subject === prevSubject && d.body === prevBody;
    const next = vetOf(vetId);
    const out = {
      ...d,
      mode,
      referringVetId: mode === 'vet' ? (vetId || '') : d.referringVetId,
      to: mode === 'vet' ? (next?.email || '') : (d.ownerEmail || ''),
    };
    if (untouched) {
      out.subject = mode === 'vet' ? vetTpl(d.vetSubjectTpl, next?.name) : d.ownerSubject;
      out.body = mode === 'vet' ? vetTpl(d.vetBodyTpl, next?.name) : d.ownerBody;
    }
    return out;
  };

  // `vetId` ouvre directement l'envoi vers un confrère précis (raccourcis depuis
  // sa fiche ou depuis la fiche du client). Sans lui, le destinataire par défaut
  // reste le propriétaire, le référent du client étant juste présélectionné.
  const openSendEmail = async ({ vetId } = {}) => {
    try {
      // Les analyses sont relues ici plutôt que prises dans le state : le modal
      // peut s'ouvrir via ?sendTo= avant la fin du chargement de la page, et les
      // cases « analyses à joindre » doivent quand même être pré-cochées.
      const [preview, vets, labs] = await Promise.all([
        window.api.patients.emailPreview(id),
        window.api.referringVets.list().catch(() => []),
        window.api.lab.listResults(id).catch(() => []),
      ]);
      if (!preview.smtpConfigured) {
        showToast('SMTP non configuré — voir Paramètres', 'error');
        return;
      }
      const wanted = vetId ? vets.find((v) => v.id === vetId) : null;
      setEmailDraft({
        // 'owner' ou 'vet' : pilote le destinataire, le modèle de message et la
        // journalisation de l'envoi sur la fiche du confrère.
        mode: wanted ? 'vet' : 'owner',
        vets,
        referringVetId: wanted ? wanted.id : (preview.referringVet?.id || ''),
        to: wanted ? (wanted.email || '') : preview.to,
        ownerEmail: preview.to,
        // Les deux modèles sont conservés côte à côte pour pouvoir changer de
        // destinataire sans perdre le texte d'origine.
        ownerSubject: preview.subject,
        ownerBody: preview.body,
        vetSubjectTpl: preview.vetSubject || preview.subject,
        vetBodyTpl: preview.vetBody || preview.body,
        subject: wanted ? vetTpl(preview.vetSubject, wanted.name) : preview.subject,
        body: wanted ? vetTpl(preview.vetBody, wanted.name) : preview.body,
        ownerHasEmail: preview.ownerHasEmail,
        referringVet: preview.referringVet || null,
        labKeys: groupLabResults(labs).map((g) => g.key),
        attachmentIds: [],
        period: 'all',
        fromDate: '',
        toDate: '',
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const sendEmail = async () => {
    if (!emailDraft.to?.trim()) {
      showToast('Email destinataire requis', 'error');
      return;
    }
    setSending(true);
    try {
      let pdfBase64 = null;
      try {
        pdfBase64 = await printCurrentPageToPDFBase64();
      } catch (e) {
        console.error('printToPDF failed, falling back to server-side rendering:', e);
      }
      const range = (() => {
        if (emailDraft.period === 'custom') return { fromDate: emailDraft.fromDate || '', toDate: emailDraft.toDate || '' };
        const months = { '3m': 3, '6m': 6, '12m': 12 }[emailDraft.period];
        if (!months) return { fromDate: '', toDate: '' };
        const from = new Date(); from.setMonth(from.getMonth() - months);
        return { fromDate: from.toISOString().slice(0, 10), toDate: '' };
      })();
      await window.api.patients.send(id, {
        to: emailDraft.to.trim(),
        subject: emailDraft.subject,
        body: emailDraft.body,
        labKeys: emailDraft.labKeys,
        attachmentIds: emailDraft.attachmentIds,
        referringVetId: emailDraft.mode === 'vet' ? (emailDraft.referringVetId || '') : '',
        fromDate: range.fromDate,
        toDate: range.toDate,
        pdfBase64,
      });
      showToast('Dossier envoyé à ' + emailDraft.to, 'success');
      setEmailDraft(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const openSendRecord = async (record) => {
    try {
      const preview = await window.api.records.emailPreview(record.id);
      if (!preview.smtpConfigured) {
        showToast('SMTP non configuré — voir Paramètres', 'error');
        return;
      }
      setRecordEmailDraft({
        recordId: record.id,
        recordLabel: `${record.date} — ${record.title || record.type}`,
        to: preview.to,
        subject: preview.subject,
        body: preview.body,
        ownerHasEmail: preview.ownerHasEmail,
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const sendRecordEmail = async () => {
    if (!recordEmailDraft.to?.trim()) {
      showToast('Email destinataire requis', 'error');
      return;
    }
    setSending(true);
    try {
      // Render the print-friendly /records/:id/print view in a hidden Electron
      // window so the PDF uses the same fonts/CSS as the on-screen invoice.
      let pdfBase64 = null;
      try {
        pdfBase64 = await printRouteToPDFBase64(`/records/${recordEmailDraft.recordId}/print`);
      } catch (e) {
        console.error('printRouteToPDF failed, falling back to server PDF:', e);
      }
      await window.api.records.send(recordEmailDraft.recordId, {
        to: recordEmailDraft.to.trim(),
        subject: recordEmailDraft.subject,
        body: recordEmailDraft.body,
        pdfBase64,
      });
      showToast('Compte-rendu envoyé à ' + recordEmailDraft.to, 'success');
      setRecordEmailDraft(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const ageString = patient.birthDate ? (() => {
    const years = (Date.now() - new Date(patient.birthDate)) / (1000 * 60 * 60 * 24 * 365.25);
    return years >= 1 ? `${Math.floor(years)} an(s)` : `${Math.floor(years * 12)} mois`;
  })() : '—';

  // `records` is already sorted by date DESC — the first entry with a logged
  // weight is the most recent one. Falls back to the patient's own weight field
  // (set via "Modifier fiche") when no medical record has recorded one yet.
  const displayWeight = records.find((r) => r.weight != null && r.weight !== '')?.weight ?? patient.weight;

  return (
    <div>
      {referralCase && (
        <div className="card mb-4" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}>
          🔗 Patient référé par <strong>Dr {referralCase.referringVetName}</strong>
          {referralCase.referringVetClinic ? ` (${referralCase.referringVetClinic})` : ''} — {' '}
          <Link to={`/referrals/${referralCase.id}`}>dossier {referralCase.reference}</Link>
        </div>
      )}
      <div className="page-header">
        <div>
          <Link to="/patients" className="text-light">← Patients</Link>
          <h2>{patient.name} <span className="text-light text-lg">({patient.species})</span></h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => openSendEmail()}>✉ Envoyer dossier par mail</button>
          <button className="btn btn-secondary" onClick={() => setEditPatient({ ...patient })}>
            Modifier fiche
          </button>
          <button className="btn btn-danger" onClick={removePatient}>Supprimer l'animal</button>
          <button className="btn btn-primary" onClick={() => { setEditing(buildEmpty(user)); setShowModal(true); }}>
            + Acte médical
          </button>
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">Fiche signalétique</h3>
        <div className="form-row cols-3">
          <div><strong>Race:</strong> {patient.breed || '—'}</div>
          <div><strong>Sexe:</strong> {patient.sex === 'M' ? 'Mâle' : patient.sex === 'F' ? 'Femelle' : '—'}</div>
          <div><strong>Âge:</strong> {ageString}</div>
        </div>
        <div className="form-row cols-3">
          <div><strong>Poids:</strong> {displayWeight ? `${displayWeight} kg` : '—'}</div>
          <div><strong>Couleur:</strong> {patient.color || '—'}</div>
          <div><strong>Stérilisé:</strong> {patient.sterilized ? 'Oui' : 'Non'}</div>
        </div>
        <div className="form-row">
          <div><strong>N° puce:</strong> {patient.microchipId || '—'}</div>
          <div><strong>Allergies:</strong> {patient.allergies || '—'}</div>
        </div>
        {patient.species === 'Chien' && (
          <div className="form-row cols-3">
            <div><strong>Date identification électronique:</strong> {patient.microchipDate ? new Date(patient.microchipDate).toLocaleDateString('fr-FR') : '—'}</div>
          </div>
        )}
        <div className="mt-2">
          <strong>Propriétaire:</strong>{' '}
          <Link to={`/owners/${patient.ownerId}`}>
            {patient.ownerLastName} {patient.ownerFirstName}
          </Link>
          {patient.ownerPhone && <> — {patient.ownerPhone}</>}
        </div>
      </div>

      <div className="card">
        <h3 className="mt-2">Dossier médical</h3>
        {records.length === 0 ? (
          <div className="empty-state">Aucun acte enregistré.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Titre</th>
                <th>Vétérinaire</th><th>Poids/T°</th><th></th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id}>
                  <td>{r.date}</td>
                  <td><span className="badge badge-scheduled">{r.type}</span></td>
                  <td>
                    <div className="font-bold">{r.title}</div>
                    {r.description && <div className="text-light" style={{ fontSize: 12 }}>{r.description}</div>}
                    {r.treatment && <div style={{ fontSize: 12 }}><strong>Traitement:</strong> {r.treatment}</div>}
                  </td>
                  <td>{r.veterinarian || '—'}</td>
                  <td>
                    {r.weight ? `${r.weight} kg` : ''}
                    {r.temperature ? ` / ${r.temperature}°C` : ''}
                  </td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => openSendRecord(r)} title="Envoyer ce rapport par mail">✉</button>
                    <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => startEdit(r)}>Modifier</button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => remove(r.id)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">🧾 Facturation</h3>
        {ownerDraftInvoice && (
          <div className="mb-4" style={{ fontSize: 13, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 10px' }}>
            Facture brouillon en cours pour ce propriétaire : <Link to={`/invoices/${ownerDraftInvoice.id}`}><strong>{ownerDraftInvoice.number}</strong></Link>
            {ownerDraftInvoice.patientNames?.length > 0 && <> — {ownerDraftInvoice.patientNames.join(', ')}</>}. Les lignes ajoutées ci-dessous y seront regroupées.
          </div>
        )}
        {siblingPatients.length > 1 && (
          <div className="text-light mb-4" style={{ fontSize: 13 }}>
            Ce propriétaire a {siblingPatients.length} animaux — chaque ligne peut être attribuée à l'un d'eux, toutes sur la même facture.
          </div>
        )}
        <InvoiceLineEditor
          items={billingItems}
          onChange={setBillingItems}
          services={billingServices}
          medicines={billingMedicines}
          protocols={billingProtocols}
          patients={siblingPatients}
          defaultPatientId={id}
        />
        {billingItems.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16, marginTop: 12 }}>
            <strong>
              Total {fmtEur(billingItems.reduce((s, it) => s + num(it.quantity) * num(it.priceHT) * (1 + num(it.vatRate) / 100), 0))} TVAC
            </strong>
            <button className="btn btn-primary" disabled={savingInvoice} onClick={saveBilling}>
              {savingInvoice ? 'Enregistrement…' : ownerDraftInvoice ? 'Ajouter à la facture' : 'Créer la facture'}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">📎 Pièces jointes</h3>
        <div className="text-light mb-4" style={{ fontSize: 13 }}>
          Radios, photos et documents rattachés à ce patient. Sauf décoché, elles restent visibles par un vétérinaire référent lié à ce dossier.
        </div>
        <div className="flex-row mb-4" style={{ gap: 10 }}>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {uploadingFiles ? 'Envoi…' : '+ Radio'}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
              disabled={uploadingFiles}
              onChange={(e) => { uploadAttachments(e.target.files, 'radiograph'); e.target.value = ''; }} />
          </label>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {uploadingFiles ? 'Envoi…' : '+ Photo'}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
              disabled={uploadingFiles}
              onChange={(e) => { uploadAttachments(e.target.files, 'photo'); e.target.value = ''; }} />
          </label>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {uploadingFiles ? 'Envoi…' : '+ Document'}
            <input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" style={{ display: 'none' }}
              disabled={uploadingFiles}
              onChange={(e) => { uploadAttachments(e.target.files, 'document'); e.target.value = ''; }} />
          </label>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
            {uploadingFiles ? 'Envoi…' : '+ Vidéo'}
            <input type="file" multiple accept="video/mp4,video/quicktime,video/webm" style={{ display: 'none' }}
              disabled={uploadingFiles}
              onChange={(e) => { uploadAttachments(e.target.files, 'video'); e.target.value = ''; }} />
          </label>
        </div>
        {attachments.length === 0 ? (
          <div className="empty-state">Aucune pièce jointe.</div>
        ) : (
          <table className="table">
            <thead><tr><th>Type</th><th>Fichier</th><th>Ajouté le</th><th>Visible référent</th><th></th></tr></thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.id}>
                  <td>{a.category}</td>
                  <td>{a.originalName}</td>
                  <td>{new Date(a.createdAt).toLocaleDateString('fr-FR')}</td>
                  <td>
                    <input type="checkbox" checked={!!a.visibleToReferrer} onChange={() => toggleAttachmentVisibility(a)} />
                  </td>
                  <td className="text-right">
                    <button className="btn btn-sm" onClick={() => openSendAttachment(a)} title="Envoyer au propriétaire par mail">✉</button>
                    <button className="btn btn-sm" style={{ marginLeft: 6 }} onClick={() => openAttachment(a.id)}>Voir</button>
                    <button className="btn btn-sm btn-danger" style={{ marginLeft: 6 }} onClick={() => removeAttachment(a.id)}>Supprimer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">🔬 Analyses de laboratoire</h3>
        {labRequests.filter((r) => r.status === 'pending' || r.status === 'sent').map((r) => (
          <div key={r.id} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '6px 10px', background: '#fef9c3', borderRadius: 6, marginBottom: 6, fontSize: 13,
          }}>
            <span>
              ⏳ Demande <code>{r.requisitionNumber}</code> —{' '}
              {r.status === 'pending' ? 'à transmettre à la station' : 'transmise, en attente de résultats'}
              {r.note ? ` · ${r.note}` : ''}
            </span>
            <button className="btn btn-sm btn-danger" onClick={() => cancelLabRequest(r.id)}>Annuler</button>
          </div>
        ))}

        {labResults.length === 0 ? (
          <div className="empty-state">Aucune analyse enregistrée pour ce patient.</div>
        ) : (
          groupLabResults(labResults).map((group) => {
            const open = expandedLabs.has(group.key);
            const toggle = () => setExpandedLabs((prev) => {
              const next = new Set(prev);
              if (next.has(group.key)) next.delete(group.key); else next.add(group.key);
              return next;
            });
            return (
              <div key={group.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
                <div onClick={toggle} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '10px 12px', cursor: 'pointer', background: open ? '#f8fafc' : '#fff',
                }}>
                  <span style={{ fontSize: 14 }}>
                    <span style={{ color: '#6b7280', marginRight: 8 }}>{open ? '▼' : '▶'}</span>
                    <strong>🔬 Analyse labo</strong>
                    <span className="text-light"> — {fmtLabDate(group.runDate)}</span>
                  </span>
                  {open && group.results.length > 0 && (
                    <div style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                      <button className="btn btn-sm" onClick={() => openLabReport(group.reportResultId || group.results[0].id)}>📄 Rapport PDF</button>
                      <button className="btn btn-sm" onClick={() => openSendLab(group.reportResultId || group.results[0].id, fmtLabDate(group.runDate))}>✉ Envoyer au client</button>
                    </div>
                  )}
                </div>
                {open && (
                  <div style={{ padding: '0 12px 12px' }}>
                    <div className="text-light" style={{ fontSize: 12, margin: '0 0 8px' }}>
                      {Array.from(new Set(group.instruments)).join(', ')}
                    </div>
                    {group.results.map((res) => (
                      <div key={res.id} style={{ marginBottom: 8 }}>
                        {group.results.length > 1 && (
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 2 }}>{res.instrument}</div>
                        )}
                        <table className="table" style={{ fontSize: 13 }}>
                          <thead>
                            <tr><th>Paramètre</th><th>Résultat</th><th>Réf.</th></tr>
                          </thead>
                          <tbody>
                            {res.assays.map((a) => (
                              <tr key={a.id}>
                                <td>{a.assayName}</td>
                                <td><span style={flagStyle(a.flag)}>{flagArrow(a.flag)}{a.value}{a.unit ? ` ${a.unit}` : ''}</span></td>
                                <td className="text-light" style={{ fontSize: 12 }}>{refRange(a)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {res.notes && (
                          <div style={{ fontSize: 12, fontStyle: 'italic', color: '#6b7280' }}>📝 {res.notes}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="card">
        <h3 className="mt-2">📅 Rappels programmés</h3>
        {followUps.length === 0 ? (
          <div className="empty-state">
            Aucun rappel programmé. Pour en créer un, ajoutez un acte médical (vaccination par exemple) et cochez "Programmer un rappel".
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date prévue</th><th>Titre</th><th>Type</th>
                <th>Statut</th><th></th>
              </tr>
            </thead>
            <tbody>
              {followUps.map((f) => {
                const isLate = f.status === 'pending' && f.scheduledDate < new Date().toISOString().slice(0, 10);
                return (
                  <tr key={f.id}>
                    <td>
                      {new Date(f.scheduledDate).toLocaleDateString('fr-FR')}
                      {isLate && <span style={{ color: 'var(--danger)', fontSize: 11 }}> (en retard)</span>}
                    </td>
                    <td>
                      <div className="font-bold">{f.title}</div>
                      {f.notes && <div className="text-light" style={{ fontSize: 12 }}>{f.notes}</div>}
                    </td>
                    <td>{f.type || '—'}</td>
                    <td>
                      {f.status === 'pending' && <span className="badge badge-scheduled">En attente</span>}
                      {f.status === 'sent' && <span className="badge badge-paid">Envoyé{f.sentAt ? ' le ' + new Date(f.sentAt).toLocaleDateString('fr-FR') : ''}</span>}
                      {f.status === 'failed' && <span className="badge badge-cancelled" title={f.errorMsg}>Échec</span>}
                      {f.status === 'cancelled' && <span className="badge badge-cancelled">Annulé</span>}
                    </td>
                    <td className="text-right">
                      {f.status === 'pending' && (
                        <button className="btn btn-sm btn-danger" onClick={() => removeFollowUp(f.id)}>
                          Annuler
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <MedicationHistory patientId={id} baseUnit={null} />

      {showModal && (
        <Modal
          title={editing.id ? 'Modifier l\'acte médical' : 'Nouvel acte médical'}
          width={820}
          onClose={() => { setShowModal(false); setEditing(buildEmpty(user)); }}
          footer={
            <>
              <button className="btn" onClick={() => setShowModal(false)}>Annuler</button>
              <button className="btn btn-primary" onClick={save}>Enregistrer</button>
            </>
          }
        >
          {recordTemplates.length > 0 && (
            <div className="form-row cols-1">
              <div className="form-group">
                <label>Modèle de rapport</label>
                <select className="select" value="" onChange={(e) => applyTemplate(e.target.value)}>
                  <option value="">— Partir d'un modèle (Tab passe d'un champ [..] à l'autre) —</option>
                  {recordTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Date *</label>
              <input className="input" type="date" value={editing.date}
                onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Type *</label>
              <select className="select" value={editing.type}
                onChange={(e) => onTypeChange(e.target.value)}>
                {RECORD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row cols-1">
            <div className="form-group">
              <label>Titre *</label>
              <input className="input" ref={titleRef} value={editing.title}
                onKeyDown={(e) => placeholderTabHandler(e, { next: descriptionRef })}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Description / examen clinique</label>
              <textarea className="textarea" ref={descriptionRef} value={editing.description}
                rows={rowsFor(editing.description, 4)}
                onKeyDown={(e) => placeholderTabHandler(e, { prev: titleRef, next: treatmentRef })}
                onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Traitement / prescription</label>
              <textarea className="textarea" ref={treatmentRef} value={editing.treatment}
                rows={rowsFor(editing.treatment, 3)}
                onKeyDown={(e) => placeholderTabHandler(e, { prev: descriptionRef })}
                onChange={(e) => setEditing({ ...editing, treatment: e.target.value })} />
            </div>
          </div>
          <div className="form-row cols-3">
            <div className="form-group">
              <label>Poids (kg)</label>
              <input className="input" type="number" step="0.1" value={editing.weight}
                onChange={(e) => setEditing({ ...editing, weight: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Température (°C)</label>
              <input className="input" type="number" step="0.1" value={editing.temperature}
                onChange={(e) => setEditing({ ...editing, temperature: e.target.value })} />
            </div>
            <div className="form-group">
              <label>Vétérinaire</label>
              <input className="input" value={editing.veterinarian}
                onChange={(e) => setEditing({ ...editing, veterinarian: e.target.value })} />
            </div>
          </div>

          {!editing.id && (
          <div style={{ marginTop: 16, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={editing.followUpEnabled}
                onChange={(e) => setEditing({
                  ...editing,
                  followUpEnabled: e.target.checked,
                  followUpDate: e.target.checked && !editing.followUpDate
                    ? addMonths(editing.date, DEFAULT_FOLLOWUP_MONTHS[editing.type] || 12)
                    : editing.followUpDate,
                })} />
              <strong>📅 Programmer un rappel automatique au propriétaire</strong>
            </label>

            {editing.followUpEnabled && (
              <div style={{ marginTop: 12 }}>
                <div className="form-row">
                  <div className="form-group">
                    <label>Date du rappel *</label>
                    <input className="input" type="date" value={editing.followUpDate}
                      onChange={(e) => setEditing({ ...editing, followUpDate: e.target.value })} />
                    <small className="text-light">
                      L'email partira automatiquement à cette date.
                      {DEFAULT_FOLLOWUP_MONTHS[editing.type] &&
                        ` Pré-rempli à +${DEFAULT_FOLLOWUP_MONTHS[editing.type]} mois.`}
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Titre du rappel</label>
                    <input className="input" value={editing.followUpTitle}
                      onChange={(e) => setEditing({ ...editing, followUpTitle: e.target.value })}
                      placeholder="Ex : Rappel vaccination annuelle" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Notes (optionnel, visible dans l'email)</label>
                  <textarea className="textarea" rows={2} value={editing.followUpNotes}
                    onChange={(e) => setEditing({ ...editing, followUpNotes: e.target.value })}
                    placeholder="Ex : prévoir un rappel CHPPi + Leucose" />
                </div>
              </div>
            )}
          </div>
          )}
        </Modal>
      )}

      {editPatient && (
        <PatientEditModal patient={editPatient} onClose={() => setEditPatient(null)} onSaved={() => { setEditPatient(null); load(); }} />
      )}

      {emailDraft && (
        <Modal
          title={`Envoyer le dossier de ${patient.name} par mail`}
          onClose={() => !sending && setEmailDraft(null)}
          footer={
            <>
              <button className="btn" disabled={sending} onClick={() => setEmailDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={sending} onClick={sendEmail}>
                {sending ? 'Envoi…' : '✉ Envoyer'}
              </button>
            </>
          }
        >
          {!emailDraft.ownerHasEmail && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
              ⚠ Aucune adresse email enregistrée pour ce propriétaire. Renseigne-la ci-dessous (et complète la fiche client plus tard).
            </div>
          )}
          <div className="form-group">
            <label>Destinataire *</label>
            <div className="flex-row mb-2" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button"
                className={`btn btn-sm ${emailDraft.mode === 'owner' ? 'btn-primary' : ''}`}
                onClick={() => setEmailDraft((d) => applyRecipient(d, 'owner', d.referringVetId))}>
                👤 Propriétaire
              </button>
              <button type="button"
                className={`btn btn-sm ${emailDraft.mode === 'vet' ? 'btn-primary' : ''}`}
                onClick={() => setEmailDraft((d) => {
                  const v = d.vets.find((x) => x.id === d.referringVetId) || d.vets[0];
                  return applyRecipient(d, 'vet', v?.id || '');
                })}>
                🩻 Vétérinaire référent
              </button>
            </div>
            {emailDraft.mode === 'vet' && (
              emailDraft.vets.length === 0 ? (
                <div style={{
                  background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6,
                  padding: 10, marginBottom: 8, fontSize: 13,
                }}>
                  ⚠ Aucun vétérinaire dans le répertoire.{' '}
                  <Link to="/referring-vets">Créer une fiche</Link> — ou saisissez l'adresse à la main ci-dessous.
                </div>
              ) : (
                <select className="select mb-2" value={emailDraft.referringVetId || ''}
                  onChange={(e) => setEmailDraft((d) => applyRecipient(d, 'vet', e.target.value))}>
                  <option value="">— Choisir un vétérinaire —</option>
                  {emailDraft.vets.map((v) => (
                    <option key={v.id} value={v.id}>
                      Dr {v.name}{v.clinic ? ` — ${v.clinic}` : ''}{v.email ? '' : ' (sans email)'}
                    </option>
                  ))}
                </select>
              )
            )}
            <input className="input" type="email" value={emailDraft.to}
              onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })} />
            {emailDraft.mode === 'vet' && emailDraft.referringVetId && (
              <small className="text-light">
                L'envoi sera enregistré dans l'historique de ce vétérinaire référent.
              </small>
            )}
            {emailDraft.mode === 'owner' && emailDraft.referringVet && (
              <small className="text-light">
                Ce client est adressé par Dr {emailDraft.referringVet.name} — le bouton ci-dessus
                bascule l'envoi vers lui.
              </small>
            )}
          </div>
          <div className="form-group mt-2">
            <label>Sujet</label>
            <input className="input" value={emailDraft.subject}
              onChange={(e) => setEmailDraft({ ...emailDraft, subject: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Message</label>
            <textarea className="textarea" rows={12} value={emailDraft.body}
              onChange={(e) => setEmailDraft({ ...emailDraft, body: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Période du dossier à inclure</label>
            <select className="input" value={emailDraft.period}
              onChange={(e) => setEmailDraft({ ...emailDraft, period: e.target.value })}>
              <option value="all">Tout l'historique</option>
              <option value="3m">3 derniers mois</option>
              <option value="6m">6 derniers mois</option>
              <option value="12m">12 derniers mois</option>
              <option value="custom">Personnalisé…</option>
            </select>
          </div>
          {emailDraft.period === 'custom' && (
            <div className="form-row cols-2">
              <div className="form-group">
                <label>Du</label>
                <input className="input" type="date" value={emailDraft.fromDate}
                  onChange={(e) => setEmailDraft({ ...emailDraft, fromDate: e.target.value })} />
              </div>
              <div className="form-group">
                <label>Au</label>
                <input className="input" type="date" value={emailDraft.toDate}
                  onChange={(e) => setEmailDraft({ ...emailDraft, toDate: e.target.value })} />
              </div>
            </div>
          )}
          {labResults.length > 0 && (
            <div className="form-group mt-2">
              <label>Analyses labo à joindre (PDF séparés)</label>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', maxHeight: 160, overflowY: 'auto' }}>
                {groupLabResults(labResults).map((g) => {
                  const checked = emailDraft.labKeys.includes(g.key);
                  return (
                    <label key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setEmailDraft((d) => ({
                          ...d,
                          labKeys: e.target.checked ? [...d.labKeys, g.key] : d.labKeys.filter((k) => k !== g.key),
                        }))} />
                      <span>🔬 Analyse labo — {fmtLabDate(g.runDate)}{' '}
                        <span className="text-light">({Array.from(new Set(g.instruments)).join(', ')})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          {attachments.length > 0 && (
            <div className="form-group mt-2">
              <label>Pièces jointes à inclure</label>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: '6px 10px', maxHeight: 160, overflowY: 'auto' }}>
                {attachments.map((a) => {
                  const checked = emailDraft.attachmentIds.includes(a.id);
                  return (
                    <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked}
                        onChange={(e) => setEmailDraft((d) => ({
                          ...d,
                          attachmentIds: e.target.checked ? [...d.attachmentIds, a.id] : d.attachmentIds.filter((i) => i !== a.id),
                        }))} />
                      <span>📎 {a.originalName}{' '}
                        <span className="text-light">({a.category}{a.sizeBytes ? `, ${fmtFileSize(a.sizeBytes)}` : ''})</span>
                      </span>
                    </label>
                  );
                })}
              </div>
              {emailDraft.attachmentIds.some((aid) => (attachments.find((a) => a.id === aid)?.sizeBytes || 0) > 15 * 1024 * 1024) && (
                <small style={{ color: '#b45309', display: 'block', marginTop: 4 }}>
                  ⚠ Une ou plusieurs pièces jointes sélectionnées dépassent 15 Mo — certaines boîtes mail (dont Gmail) refusent les emails trop volumineux.
                </small>
              )}
            </div>
          )}
          <small className="text-light">
            Le dossier PDF ({emailDraft.period === 'all' ? 'tout l\'historique' : emailDraft.period === 'custom' ? 'période personnalisée' : `${emailDraft.period.replace('m', '')} derniers mois`} : signalétique + actes médicaux + rappels + historique médicamenteux) sera joint automatiquement{labResults.length > 0 && emailDraft.labKeys.length > 0 ? `, avec ${emailDraft.labKeys.length} analyse(s) de laboratoire en pièces jointes séparées` : ''}{emailDraft.attachmentIds.length > 0 ? `, avec ${emailDraft.attachmentIds.length} pièce(s) jointe(s) en pièces jointes séparées` : ''}. Le modèle par défaut se configure dans Paramètres.
          </small>
        </Modal>
      )}

      {recordEmailDraft && (
        <Modal
          title={`Envoyer le compte-rendu : ${recordEmailDraft.recordLabel}`}
          onClose={() => !sending && setRecordEmailDraft(null)}
          footer={
            <>
              <button className="btn" disabled={sending} onClick={() => setRecordEmailDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={sending} onClick={sendRecordEmail}>
                {sending ? 'Envoi…' : '✉ Envoyer'}
              </button>
            </>
          }
        >
          {!recordEmailDraft.ownerHasEmail && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
              ⚠ Aucune adresse email enregistrée pour ce propriétaire. Renseigne-la ci-dessous.
            </div>
          )}
          <div className="form-group">
            <label>Destinataire *</label>
            <input className="input" type="email" value={recordEmailDraft.to}
              onChange={(e) => setRecordEmailDraft({ ...recordEmailDraft, to: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Sujet</label>
            <input className="input" value={recordEmailDraft.subject}
              onChange={(e) => setRecordEmailDraft({ ...recordEmailDraft, subject: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Message</label>
            <textarea className="textarea" rows={12} value={recordEmailDraft.body}
              onChange={(e) => setRecordEmailDraft({ ...recordEmailDraft, body: e.target.value })} />
          </div>
          <small className="text-light">
            Le PDF de cette consultation (description + traitement + poids/température) sera joint automatiquement. Le modèle par défaut se configure dans Paramètres.
          </small>
        </Modal>
      )}

      {attachmentEmailDraft && (
        <Modal
          title={`Envoyer la pièce jointe : ${attachmentEmailDraft.attachmentLabel}`}
          onClose={() => !sending && setAttachmentEmailDraft(null)}
          footer={
            <>
              <button className="btn" disabled={sending} onClick={() => setAttachmentEmailDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={sending} onClick={sendAttachmentEmail}>
                {sending ? 'Envoi…' : '✉ Envoyer'}
              </button>
            </>
          }
        >
          {!attachmentEmailDraft.ownerHasEmail && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
              ⚠ Aucune adresse email enregistrée pour ce propriétaire. Renseigne-la ci-dessous.
            </div>
          )}
          <div className="form-group">
            <label>Langue</label>
            <div className="flex-row" style={{ gap: 6 }}>
              <button type="button" className={attachmentEmailDraft.lang === 'fr' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => switchAttachmentEmailLang('fr')}>Français</button>
              <button type="button" className={attachmentEmailDraft.lang === 'en' ? 'btn btn-primary btn-sm' : 'btn btn-sm'}
                onClick={() => switchAttachmentEmailLang('en')}>English</button>
            </div>
          </div>
          <div className="form-group mt-2">
            <label>Destinataire *</label>
            <input className="input" type="email" value={attachmentEmailDraft.to}
              onChange={(e) => setAttachmentEmailDraft({ ...attachmentEmailDraft, to: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Sujet</label>
            <input className="input" value={attachmentEmailDraft.subject}
              onChange={(e) => setAttachmentEmailDraft({ ...attachmentEmailDraft, subject: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Message</label>
            <textarea className="textarea" rows={8} value={attachmentEmailDraft.body}
              onChange={(e) => setAttachmentEmailDraft({ ...attachmentEmailDraft, body: e.target.value })} />
          </div>
          <small className="text-light">Le fichier ({attachmentEmailDraft.attachmentLabel}) sera joint automatiquement.</small>
        </Modal>
      )}

      {labEmailDraft && (
        <Modal
          title={`Envoyer les analyses (${labEmailDraft.label}) par mail`}
          onClose={() => !sending && setLabEmailDraft(null)}
          footer={
            <>
              <button className="btn" disabled={sending} onClick={() => setLabEmailDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={sending} onClick={sendLabEmail}>
                {sending ? 'Envoi…' : '✉ Envoyer'}
              </button>
            </>
          }
        >
          {!labEmailDraft.ownerHasEmail && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 6, padding: 10, marginBottom: 12, fontSize: 13 }}>
              ⚠ Aucune adresse email enregistrée pour ce propriétaire. Renseigne-la ci-dessous.
            </div>
          )}
          <div className="form-group">
            <label>Destinataire *</label>
            <input className="input" type="email" value={labEmailDraft.to}
              onChange={(e) => setLabEmailDraft({ ...labEmailDraft, to: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Sujet</label>
            <input className="input" value={labEmailDraft.subject}
              onChange={(e) => setLabEmailDraft({ ...labEmailDraft, subject: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Message</label>
            <textarea className="textarea" rows={12} value={labEmailDraft.body}
              onChange={(e) => setLabEmailDraft({ ...labEmailDraft, body: e.target.value })} />
          </div>
          <small className="text-light">
            Le rapport PDF du laboratoire de cette analyse sera joint automatiquement. Le modèle par défaut se configure dans Paramètres.
          </small>
        </Modal>
      )}
    </div>
  );
}

function PatientEditModal({ patient, onClose, onSaved }) {
  const [form, setForm] = React.useState({ ...patient });
  const [owners, setOwners] = React.useState([]);
  React.useEffect(() => { window.api.owners.list().then(setOwners).catch(() => {}); }, []);
  const ownerChanged = form.ownerId && form.ownerId !== patient.ownerId;
  async function save() {
    if (!form.name?.trim()) { alert('Le nom est obligatoire'); return; }
    if (!form.ownerId) { alert('Le propriétaire est obligatoire'); return; }
    if (ownerChanged) {
      const o = owners.find((x) => x.id === form.ownerId);
      if (!window.confirm(`Transférer ${patient.name} à ${o ? `${o.lastName} ${o.firstName}` : 'ce propriétaire'} ?\n\nLes factures et RDV passés restent au nom de l'ancien propriétaire ; les RDV à venir suivent l'animal.`)) return;
    }
    try {
      await window.api.patients.update(patient.id, {
        ownerId: form.ownerId,
        name: form.name.trim(),
        species: form.species,
        breed: form.breed || null,
        sex: form.sex || null,
        birthDate: form.birthDate || null,
        weight: form.weight ? parseFloat(form.weight) : null,
        color: form.color || null,
        sterilized: form.sterilized ? 1 : 0,
        microchipId: form.microchipId || null,
        allergies: form.allergies || null,
        dangerousDog: form.dangerousDog ? 1 : 0,
        microchipDate: form.microchipDate || null,
      });
      onSaved();
    } catch (e) { alert('Erreur : ' + e.message); }
  }
  return (
    <div className="modal-overlay"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 30, overflow: 'auto' }}>
      <div className="card" style={{ maxWidth: 600, width: '100%', marginTop: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>Modifier la fiche patient</h3>
          <button className="btn" style={{ fontSize: '1.4rem', lineHeight: 1, padding: '4px 10px' }} onClick={onClose}>×</button>
        </div>
        <div className="form-row"><label>Propriétaire *</label>
          <SearchSelect
            value={form.ownerId}
            onChange={(id) => setForm({ ...form, ownerId: id })}
            options={owners.map((o) => ({
              id: o.id,
              label: `${o.lastName} ${o.firstName}`,
              sub: [o.email, o.phone].filter(Boolean).join(' · ') || null,
              keywords: `${o.email || ''} ${o.phone || ''} ${o.city || ''}`,
            }))}
            placeholder="Rechercher un propriétaire…"
          />
          {ownerChanged && <div className="text-light" style={{ fontSize: 12, marginTop: 4 }}>⚠ L'animal sera transféré à ce propriétaire.</div>}
        </div>
        <div className="form-grid-2">
          <div className="form-row"><label>Nom *</label>
            <input className="input" value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="form-row"><label>Espèce *</label>
            <select className="select" value={form.species || ''} onChange={(e) => setForm({ ...form, species: e.target.value })}>
              <option value="">—</option>
              <option value="Chien">Chien</option>
              <option value="Chat">Chat</option>
              <option value="Lapin">Lapin</option>
              <option value="NAC">NAC</option>
              <option value="Oiseau">Oiseau</option>
              <option value="Reptile">Reptile</option>
              <option value="Autre">Autre</option>
            </select></div>
        </div>
        <div className="form-grid-2">
          <div className="form-row"><label>Race</label>
            <input className="input" value={form.breed || ''} onChange={(e) => setForm({ ...form, breed: e.target.value })} /></div>
          <div className="form-row"><label>Sexe</label>
            <select className="select" value={form.sex || ''} onChange={(e) => setForm({ ...form, sex: e.target.value })}>
              <option value="">—</option>
              <option value="M">Mâle</option>
              <option value="F">Femelle</option>
            </select></div>
        </div>
        <div className="form-grid-2">
          <div className="form-row"><label>Né le</label>
            <input className="input" type="date" value={form.birthDate || ''} onChange={(e) => setForm({ ...form, birthDate: e.target.value })} /></div>
          <div className="form-row"><label>Poids (kg)</label>
            <input className="input" type="text" inputMode="decimal" value={form.weight || ''} onChange={(e) => setForm({ ...form, weight: e.target.value.replace(',', '.') })} /></div>
        </div>
        <div className="form-grid-2">
          <div className="form-row"><label>Couleur</label>
            <input className="input" value={form.color || ''} onChange={(e) => setForm({ ...form, color: e.target.value })} /></div>
          <div className="form-row"><label>N° puce</label>
            <input className="input" value={form.microchipId || ''} onChange={(e) => setForm({ ...form, microchipId: e.target.value })} /></div>
        </div>
        <div className="form-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.sterilized} onChange={(e) => setForm({ ...form, sterilized: e.target.checked })} />
            Stérilisé(e)
          </label>
        </div>
        <div className="form-row">
          <label>Allergies</label>
          <textarea className="textarea" rows={2} value={form.allergies || ''} onChange={(e) => setForm({ ...form, allergies: e.target.value })} />
        </div>
        {form.species === 'Chien' && (
          <div className="form-grid-2">
            <div className="form-row"><label>Date d'identification électronique</label>
              <input className="input" type="date" value={form.microchipDate || ''} onChange={(e) => setForm({ ...form, microchipDate: e.target.value })} /></div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={save}>Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function MedicationHistory({ patientId }) {
  const [list, setList] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    window.api.dispensings.byPatient(patientId)
      .then((data) => { if (!cancelled) { setList(data || []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patientId]);

  return (
    <div className="card">
      <h3 className="mt-2">💊 Historique médicamenteux</h3>
      {loading ? (
        <div className="empty-state">Chargement…</div>
      ) : list.length === 0 ? (
        <div className="empty-state">Aucun médicament dispensé à ce patient.</div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Médicament</th>
              <th>Quantité</th>
              <th>Lot</th>
              <th>Péremption</th>
              <th>Facture</th>
            </tr>
          </thead>
          <tbody>
            {list.map((d) => (
              <tr key={d.id}>
                <td>{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                <td><strong>{d.medicineName}</strong></td>
                <td>{d.quantitySold} × {d.saleUnitName} <span style={{ color: '#9ca3af' }}>({d.baseUnitsConsumed} {d.baseUnit})</span></td>
                <td><code>{d.lotNumber}</code></td>
                <td>{d.expiryDate}</td>
                <td>{d.invoiceNumber || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
