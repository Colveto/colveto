import React, { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import Modal from '../components/Modal.jsx';
import { useToast } from '../components/Toast.jsx';
import { printCurrentPageToPDFBase64 } from '../lib/api.js';
import { QUOTE_STATUS_LABELS } from './Quotes.jsx';
import PaymentMethodModal, { PAYMENT_METHODS } from '../components/PaymentMethodModal.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const INVOICE_STATUS_LABELS = {
  draft: 'Brouillon', sent: 'Envoyée', paid: 'Payée', cancelled: 'Annulée',
};

function fmtMoney(n) {
  return Number(n || 0).toLocaleString('fr-LU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Avec mode="quote", affiche un devis : même document, autres statuts et actions.
export default function InvoiceDetail({ mode = 'invoice' }) {
  const isQuote = mode === 'quote';
  const api = isQuote ? window.api.quotes : window.api.invoices;
  const STATUS_LABELS = isQuote ? QUOTE_STATUS_LABELS : INVOICE_STATUS_LABELS;
  const docLabel = isQuote ? 'Devis' : 'Facture';
  const { id } = useParams();
  const nav = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  // Factures : seul l'administrateur valide et envoie (le serveur l'impose aussi).
  const canValidate = isQuote || user?.role === 'admin';
  const [inv, setInv] = useState(null);
  const [paying, setPaying] = useState(false);
  const [settings, setSettings] = useState({});
  const [emailDraft, setEmailDraft] = useState(null);
  const [sending, setSending] = useState(false);
  const [protoDraft, setProtoDraft] = useState(null);
  const [savingProto, setSavingProto] = useState(false);

  const load = () => api.get(id).then(setInv);
  useEffect(() => {
    load();
    window.api.settings.get().then(setSettings);
  }, [id]);

  if (!inv) return <div>Chargement…</div>;

  const setStatus = async (status, paymentMethod) => {
    try {
      const result = await api.updateStatus(id, status, paymentMethod);
      if (result?.fiduciaryEmailError) {
        showToast(result.fiduciaryEmailError, 'error');
      }
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    load();
  };
  // Brouillon : le paiement est seulement noté ; la validation (admin) le fera passer en payée.
  const notePayment = async (method) => {
    try {
      await window.api.invoices.setPayment(id, method);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    load();
  };
  const validate = async () => {
    if (!confirm('Valider cette facture ? Elle reçoit son numéro définitif, ne pourra plus être modifiée ni supprimée, et part par e-mail au client.')) return;
    try {
      const { validated, errors } = await window.api.invoices.validate([id]);
      if (validated[0]?.sentTo) showToast(`Facture validée et envoyée à ${validated[0].sentTo} ✓`, 'success');
      for (const e of errors) showToast(e.error, 'error');
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
    load();
  };
  const remove = async () => {
    if (!confirm(`Supprimer ${isQuote ? 'ce devis' : 'cette facture'} ? Cette action est irréversible.`)) return;
    await api.delete(id);
    nav(isQuote ? '/quotes' : '/invoices');
  };
  const print = () => window.print();

  const openSendEmail = async () => {
    try {
      const preview = await api.emailPreview(id);
      if (!preview.smtpConfigured) {
        showToast('SMTP non configuré — voir Paramètres', 'error');
        return;
      }
      setEmailDraft({
        to: preview.to,
        subject: preview.subject,
        body: preview.body,
        ownerHasEmail: preview.ownerHasEmail,
      });
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    }
  };

  const openSaveAsProtocol = () => {
    const defaultName = inv.patientName
      ? `Protocole — ${inv.patientName} (${inv.number})`
      : `Protocole ${inv.number}`;
    setProtoDraft({ name: defaultName, description: '' });
  };

  const saveAsProtocol = async () => {
    if (!protoDraft.name?.trim()) {
      showToast('Donnez un nom au protocole', 'error');
      return;
    }
    const items = (inv.items || []).map((it, idx) => ({
      sortOrder: idx,
      kind: (it.kind || 'act') === 'product' ? 'product' : 'act',
      serviceId: (it.kind || 'act') === 'act' ? (it.serviceId || null) : null,
      medicineId: it.kind === 'product' ? (it.medicineId || null) : null,
      saleUnitId: it.kind === 'product' ? (it.saleUnitId || null) : null,
      description: it.description,
      quantityMode: 'fixed',
      quantity: Number(it.quantity) || 1,
      priceHT: Number(it.listPriceHT ?? it.priceHT) || 0,
      vatRate: Number(it.vatRate) || 17,
      accountCode: it.accountCode || (it.kind === 'product' ? '707000' : '706000'),
    }));
    setSavingProto(true);
    try {
      await window.api.protocols.create({
        name: protoDraft.name.trim(),
        description: protoDraft.description?.trim() || null,
        items,
      });
      showToast('Protocole enregistré ✓', 'success');
      setProtoDraft(null);
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSavingProto(false);
    }
  };

  const sendEmail = async () => {
    if (!emailDraft.to?.trim()) {
      showToast('Email destinataire requis', 'error');
      return;
    }
    setSending(true);
    try {
      // If running in Electron, render the on-screen invoice via Chromium's
      // printToPDF — identical to what the user gets via the Print dialog.
      // The print stylesheet hides the modal/sidebar so only the invoice document is captured.
      let pdfBase64 = null;
      try {
        pdfBase64 = await printCurrentPageToPDFBase64();
      } catch (e) {
        console.error('printToPDF failed, falling back to server-side rendering:', e);
      }
      await api.send(id, {
        to: emailDraft.to.trim(),
        subject: emailDraft.subject,
        body: emailDraft.body,
        pdfBase64,
      });
      showToast(`${docLabel} envoyé${isQuote ? '' : 'e'} à ` + emailDraft.to, 'success');
      setEmailDraft(null);
      load(); // pour un devis, le serveur passe lui-même le brouillon en « envoyé »
    } catch (e) {
      showToast('Erreur : ' + e.message, 'error');
    } finally {
      setSending(false);
    }
  };

  const provisional = String(inv.number || '').startsWith('BROUILLON-');
  const acts = (inv.items || []).filter((it) => (it.kind || 'act') === 'act');
  const products = (inv.items || []).filter((it) => it.kind === 'product');

  // Remise sur les actes : priceHT est déjà net, listPriceHT = prix avant remise.
  const discountTotal = acts.reduce((s, it) => (it.discountPct
    ? s + Number(it.quantity) * (Number(it.listPriceHT) - Number(it.priceHT)) : s), 0);
  const discountPct = acts.reduce((m, it) => Math.max(m, Number(it.discountPct) || 0), 0);

  const vatBreakdown = {};
  for (const it of inv.items || []) {
    const ht = Number(it.quantity) * Number(it.priceHT);
    const rate = Number(it.vatRate);
    if (!vatBreakdown[rate]) vatBreakdown[rate] = { ht: 0, vat: 0 };
    vatBreakdown[rate].ht += ht;
    vatBreakdown[rate].vat += ht * (rate / 100);
  }

  return (
    <div className="invoice-page">
      <style>{INVOICE_CSS}</style>

      <div className="page-header no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <Link to={isQuote ? '/quotes' : '/invoices'} className="text-light">← {isQuote ? 'Devis' : 'Factures'}</Link>
          <h2 style={{ margin: 0 }}>{docLabel} {inv.number}</h2>
          {isQuote && inv.invoiceId && (
            <div className="text-light">Transformé en facture <Link to={`/invoices/${inv.invoiceId}`}>{inv.invoiceNumber}</Link></div>
          )}
          {!isQuote && inv.fromQuote && (
            <div className="text-light">Issue du devis <Link to={`/quotes/${inv.fromQuote.id}`}>{inv.fromQuote.number}</Link></div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn" onClick={print}>🖨 Imprimer / PDF</button>
          {(inv.items || []).length > 0 && (
            <button className="btn" onClick={openSaveAsProtocol} title="Créer un protocole à partir de cette facture">
              🧪 Enregistrer comme protocole
            </button>
          )}
          {isQuote ? (
            <>
              {!inv.invoiceId && <button className="btn" onClick={openSendEmail}>✉ Envoyer par mail</button>}
              {!inv.invoiceId && <button className="btn" onClick={() => nav(`/quotes/${id}/edit`)}>✏ Modifier</button>}
              {inv.status === 'draft' && <button className="btn" onClick={() => setStatus('sent')}>Marquer envoyé</button>}
              {['draft', 'sent'].includes(inv.status) && <button className="btn" onClick={() => setStatus('accepted')}>Marquer accepté</button>}
              {['draft', 'sent', 'accepted'].includes(inv.status) && <button className="btn" onClick={() => setStatus('refused')}>Marquer refusé</button>}
              {inv.status === 'refused' && <button className="btn" onClick={() => setStatus('sent')}>Rouvrir</button>}
              {!inv.invoiceId && inv.status !== 'refused' && (
                <button className="btn btn-primary" onClick={() => nav(`/invoices/new?fromQuote=${id}`)}>→ Transformer en facture</button>
              )}
              {!inv.invoiceId && <button className="btn btn-danger" onClick={remove}>Supprimer</button>}
            </>
          ) : (
            <>
              {canValidate && !['draft', 'cancelled'].includes(inv.status) && (
                <button className="btn" onClick={openSendEmail}>✉ Envoyer par mail</button>
              )}
              {inv.status === 'draft' && (
                <button className="btn" onClick={() => setPaying(true)}>
                  💶 {inv.paymentMethod ? 'Modifier le paiement' : 'Noter le paiement'}
                </button>
              )}
              {inv.status === 'draft' && <button className="btn" onClick={() => nav(`/invoices/${id}/edit`)}>✏ Modifier</button>}
              {canValidate && inv.status === 'draft' && (
                <button className="btn btn-primary" onClick={validate}>
                  {inv.paymentMethod ? 'Valider (payée)' : 'Valider (marquer envoyée)'}
                </button>
              )}
              {!canValidate && inv.status === 'draft' && <span className="text-light" style={{ alignSelf: 'center' }}>En attente de validation par l'administrateur</span>}
              {inv.status === 'sent' && <button className="btn btn-primary" onClick={() => setPaying(true)}>Marquer payée</button>}
              {/* Numéro définitif = plus de suppression (pas de trou), seulement l'annulation. */}
              {canValidate && !provisional && ['draft', 'sent'].includes(inv.status) && (
                <button className="btn" onClick={() => confirm('Annuler cette facture ? Elle garde son numéro et sort du chiffre d\'affaires ; les produits sont remis en stock.') && setStatus('cancelled')}>Annuler facture</button>
              )}
              {provisional && <button className="btn btn-danger" onClick={remove}>Supprimer</button>}
            </>
          )}
        </div>
      </div>

      <div className="invoice-doc">
        <header className="inv-header">
          <div className="inv-cabinet">
            <img className="inv-logo" src="logo-invoice.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
            <div>
              <div className="inv-cabinet-name">{settings.clinicName || 'Cabinet vétérinaire'}</div>
              <div className="inv-cabinet-info">
                {settings.clinicAddress && <div>{settings.clinicAddress}</div>}
                {(settings.clinicPostalCode || settings.clinicCity) && <div>{settings.clinicPostalCode} {settings.clinicCity}</div>}
                {settings.clinicPhone && <div>📞 {settings.clinicPhone}</div>}
                {settings.clinicEmail && <div>✉ {settings.clinicEmail}</div>}
                {settings.clinicVatNumber && <div className="inv-cabinet-tva">TVA : {settings.clinicVatNumber}</div>}
              </div>
            </div>
          </div>
          <div className="inv-meta">
            <div className="inv-title">{docLabel}</div>
            <div className="inv-number">N° <strong>{inv.number}</strong></div>
            <div className="inv-meta-row"><span>Date</span><strong>{fmtDate(inv.date)}</strong></div>
            {inv.dueDate && <div className="inv-meta-row"><span>Échéance</span><strong>{fmtDate(inv.dueDate)}</strong></div>}
            {inv.validUntil && <div className="inv-meta-row"><span>Valable jusqu'au</span><strong>{fmtDate(inv.validUntil)}</strong></div>}
            <div className={'inv-status inv-status-' + inv.status}>
              {STATUS_LABELS[inv.status]}
              {!isQuote && ['paid', 'draft'].includes(inv.status) && PAYMENT_METHODS[inv.paymentMethod] && ` — ${PAYMENT_METHODS[inv.paymentMethod]}`}
            </div>
          </div>
        </header>

        <div className="inv-body">
        <section className="inv-client">
          <div className="inv-client-label">Adressée à</div>
          <div className="inv-client-name">{inv.ownerLastName} {inv.ownerFirstName}</div>
          <div className="inv-client-info">
            {inv.ownerAddress && <div>{inv.ownerAddress}</div>}
            {(inv.ownerPostalCode || inv.ownerCity) && <div>{inv.ownerPostalCode} {inv.ownerCity}</div>}
            {inv.patientName && <div className="inv-patient">Concerne : <strong>{inv.patientName}</strong></div>}
          </div>
        </section>

        {acts.length > 0 && (
          <section className="inv-section inv-section-act">
            <h3 className="inv-section-title">Actes vétérinaires <span className="inv-tva-badge">TVA 17%</span></h3>
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Description</th>
                  <th className="ar">Qté</th>
                  <th className="ar">P.U. HTVA</th>
                  <th className="ar">P.U. TVAC</th>
                  <th className="ar">Total HTVA</th>
                  <th className="ar">Total TVAC</th>
                </tr>
              </thead>
              <tbody>
                {acts.map((it) => {
                  const ht = Number(it.quantity) * Number(it.priceHT);
                  const ttc = ht * (1 + Number(it.vatRate) / 100);
                  const puTtc = Number(it.priceHT) * (1 + Number(it.vatRate) / 100);
                  return (
                    <tr key={it.id}>
                      <td>
                        {it.description}
                        {inv.patients?.length > 1 && it.patientName && (
                          <div className="inv-lot">Animal : {it.patientName}</div>
                        )}
                        {it.discountPct > 0 && (
                          <div className="inv-lot">Remise {Number(it.discountPct).toLocaleString('fr-LU')} % (prix normal {fmtMoney(it.listPriceHT)} HTVA)</div>
                        )}
                      </td>
                      <td className="ar">{Number(it.quantity).toLocaleString('fr-LU')}</td>
                      <td className="ar">{fmtMoney(it.priceHT)}</td>
                      <td className="ar">{fmtMoney(puTtc)}</td>
                      <td className="ar">{fmtMoney(ht)}</td>
                      <td className="ar"><strong>{fmtMoney(ttc)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {products.length > 0 && (
          <section className="inv-section inv-section-product">
            <h3 className="inv-section-title">Produits / Médicaments <span className="inv-tva-badge inv-tva-badge-green">TVA 3%</span></h3>
            <table className="inv-table">
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>Description</th>
                  <th className="ar">Qté</th>
                  <th className="ar">P.U. HTVA</th>
                  <th className="ar">P.U. TVAC</th>
                  <th className="ar">Total HTVA</th>
                  <th className="ar">Total TVAC</th>
                </tr>
              </thead>
              <tbody>
                {products.map((it) => {
                  const ht = Number(it.quantity) * Number(it.priceHT);
                  const ttc = ht * (1 + Number(it.vatRate) / 100);
                  const puTtc = Number(it.priceHT) * (1 + Number(it.vatRate) / 100);
                  return (
                    <tr key={it.id}>
                      <td>
                        {it.description}
                        {inv.patients?.length > 1 && it.patientName && (
                          <div className="inv-lot">Animal : {it.patientName}</div>
                        )}
                        {it.lotId && (
                          <div className="inv-lot">Lot : <code>{it.lotId.slice(0, 8)}…</code></div>
                        )}
                      </td>
                      <td className="ar">{Number(it.quantity).toLocaleString('fr-LU')}</td>
                      <td className="ar">{fmtMoney(it.priceHT)}</td>
                      <td className="ar">{fmtMoney(puTtc)}</td>
                      <td className="ar">{fmtMoney(ht)}</td>
                      <td className="ar"><strong>{fmtMoney(ttc)}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        <section className="inv-totals">
          <table className="inv-totals-table">
            <tbody>
              {discountTotal > 0.004 && (
                <tr className="inv-vat-detail">
                  <td>Remise de {discountPct.toLocaleString('fr-LU')} % sur les actes (HTVA)</td>
                  <td className="ar">− {fmtMoney(discountTotal)}</td>
                </tr>
              )}
              <tr><td>Total HTVA</td><td className="ar">{fmtMoney(inv.totalHT)}</td></tr>
              {Object.keys(vatBreakdown).sort().map((rate) => (
                <tr key={rate} className="inv-vat-detail">
                  <td>dont TVA {Number(rate).toFixed(0)}% sur {fmtMoney(vatBreakdown[rate].ht)}</td>
                  <td className="ar">{fmtMoney(vatBreakdown[rate].vat)}</td>
                </tr>
              ))}
              <tr><td>TVA totale</td><td className="ar">{fmtMoney(inv.totalVAT)}</td></tr>
              <tr className="inv-total-row">
                <td>{isQuote ? 'Total estimé (TVAC)' : 'Net à payer (TVAC)'}</td>
                <td className="ar">{fmtMoney(inv.totalTTC)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {inv.notes && (
          <section className="inv-notes">
            <div className="inv-notes-label">Notes</div>
            <div>{inv.notes}</div>
          </section>
        )}

        </div>
        <footer className="inv-footer">
          <div className="inv-footer-thanks">Merci de votre confiance 🐾</div>
          {isQuote ? (
            <div>
              Devis estimatif{inv.validUntil ? `, valable jusqu'au ${fmtDate(inv.validUntil)}` : ''}.
              Le montant final peut varier selon les actes et produits réellement nécessaires.
            </div>
          ) : (<>
          {settings.clinicIban && (
            <div>
              <strong>Coordonnées bancaires :</strong> IBAN {settings.clinicIban}
              {settings.clinicBic && <> · BIC {settings.clinicBic}</>}
            </div>
          )}
          {settings.clinicPaymentTerms ? (
            <div>{settings.clinicPaymentTerms}</div>
          ) : (
            <div>Paiement comptant à réception, sauf accord écrit.</div>
          )}
          </>)}
          {settings.clinicLegalMentions && <div>{settings.clinicLegalMentions}</div>}
        </footer>
      </div>

      {paying && (
        <PaymentMethodModal
          invoiceNumber={inv.number}
          onClose={() => setPaying(false)}
          title={inv.status === 'draft' ? 'Paiement reçu' : undefined}
          confirmLabel={inv.status === 'draft' ? 'Noter le paiement' : undefined}
          initial={inv.paymentMethod || ''}
          onConfirm={async (method) => {
            if (inv.status === 'draft') await notePayment(method); else await setStatus('paid', method);
            setPaying(false);
          }}
        />
      )}

      {emailDraft && (
        <Modal
          title={`Envoyer ${isQuote ? 'le devis' : 'la facture'} ${inv.number} par mail`}
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
            <input className="input" type="email" value={emailDraft.to}
              onChange={(e) => setEmailDraft({ ...emailDraft, to: e.target.value })} />
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
          <small className="text-light">
            {isQuote
              ? <>Le devis PDF (devis-{inv.number}.pdf) sera joint automatiquement.</>
              : <>La facture PDF (facture-{inv.number}.pdf) sera jointe automatiquement. Le modèle par défaut se configure dans Paramètres.</>}
          </small>
        </Modal>
      )}

      {protoDraft && (
        <Modal
          title="Enregistrer comme protocole"
          onClose={() => !savingProto && setProtoDraft(null)}
          footer={
            <>
              <button className="btn" disabled={savingProto} onClick={() => setProtoDraft(null)}>Annuler</button>
              <button className="btn btn-primary" disabled={savingProto} onClick={saveAsProtocol}>
                {savingProto ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0, color: '#475569', fontSize: '0.9rem' }}>
            Les {(inv.items || []).length} ligne(s) {isQuote ? "de ce devis" : "de cette facture"} seront copiées dans un nouveau protocole
            (les lots ne sont pas conservés — ils seront resélectionnés automatiquement à chaque application).
            Vous pourrez ensuite convertir certaines lignes en dose au poids depuis l'onglet Protocoles.
          </p>
          <div className="form-group">
            <label>Nom du protocole *</label>
            <input className="input" value={protoDraft.name}
              onChange={(e) => setProtoDraft({ ...protoDraft, name: e.target.value })} />
          </div>
          <div className="form-group mt-2">
            <label>Description (optionnel)</label>
            <input className="input" value={protoDraft.description}
              onChange={(e) => setProtoDraft({ ...protoDraft, description: e.target.value })}
              placeholder="ex: Anesthésie de courte durée pour chirurgie mineure" />
          </div>
        </Modal>
      )}
    </div>
  );
}

const INVOICE_CSS = `
  .invoice-page { background: #f8f7f2; min-height: 100vh; padding: 20px 0; margin: -20px -16px; }
  .invoice-doc {
    background: white;
    color: #0f172a;
    max-width: 850px;
    margin: 0 auto;
    border-radius: 14px;
    box-shadow: 0 8px 32px rgba(15,23,42,0.10);
    font-family: 'DM Sans', -apple-system, sans-serif;
    overflow: hidden;
    position: relative;
  }
  .invoice-doc::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 8px;
    background: linear-gradient(90deg, #2563EB 0%, #2563EB 60%, #0f5c45 60%, #0f5c45 100%);
  }
  .invoice-doc * { box-sizing: border-box; }

  /* Header band - colored */
  .inv-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 32px;
    padding: 38px 52px 30px;
    background: linear-gradient(135deg, #EFF6FF 0%, #f8f7f2 100%);
    border-bottom: 1px solid #e2e8f0;
    position: relative;
  }
  .inv-header::after {
    content: "🐾";
    position: absolute;
    right: 30px;
    bottom: -28px;
    font-size: 80px;
    opacity: 0.04;
    pointer-events: none;
  }
  .inv-cabinet { display: flex; gap: 20px; align-items: flex-start; }
  .inv-logo {
    height: 84px;
    width: auto;
    max-width: 160px;
    object-fit: contain;
    padding: 6px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 2px 10px rgba(37,99,235,0.10);
  }
  .inv-cabinet-name {
    font-family: 'DM Serif Display', serif;
    font-size: 1.6rem;
    color: #2563EB;
    line-height: 1;
    margin-bottom: 10px;
    letter-spacing: -0.5px;
  }
  .inv-cabinet-info { font-size: 0.85rem; color: #475569; line-height: 1.5; }
  .inv-cabinet-tva { margin-top: 6px; font-weight: 500; color: #0f172a; }

  .inv-meta { text-align: right; min-width: 220px; }
  .inv-title {
    font-family: 'DM Serif Display', serif;
    font-size: 3rem;
    color: #0f5c45;
    line-height: 0.95;
    margin-bottom: 8px;
    letter-spacing: -1.5px;
    font-style: italic;
  }
  .inv-title::after {
    content: '';
    display: block;
    width: 50px;
    height: 3px;
    background: #0f5c45;
    margin-top: 8px;
    margin-left: auto;
    border-radius: 2px;
  }
  .inv-number { font-size: 0.95rem; margin-bottom: 14px; color: #64748b; }
  .inv-number strong { color: #0f172a; }
  .inv-meta-row {
    display: flex;
    justify-content: space-between;
    gap: 14px;
    font-size: 0.85rem;
    margin-bottom: 4px;
    color: #475569;
  }
  .inv-meta-row strong { color: #0f172a; font-weight: 500; }
  .inv-status {
    display: inline-block;
    margin-top: 10px;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.78rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .inv-status-draft { background: #f1f5f9; color: #64748b; }
  .inv-status-sent { background: #dbeafe; color: #1d4ed8; }
  .inv-status-paid { background: #d1fae5; color: #0f5c45; }
  .inv-status-cancelled { background: #fee2e2; color: #b91c1c; }
  .inv-status-accepted, .inv-status-invoiced { background: #d1fae5; color: #0f5c45; }
  .inv-status-refused { background: #fee2e2; color: #b91c1c; }

  /* Body wrapper */
  .inv-body { padding: 32px 52px 40px; }

  /* Client block */
  .inv-client {
    background: white;
    border: 1.5px solid #2563EB;
    border-left-width: 5px;
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 32px;
    position: relative;
  }
  .inv-client-label {
    font-size: 0.72rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 600;
    margin-bottom: 6px;
  }
  .inv-client-name {
    font-family: 'DM Serif Display', serif;
    font-size: 1.15rem;
    color: #0f172a;
    margin-bottom: 6px;
  }
  .inv-client-info { font-size: 0.88rem; color: #475569; line-height: 1.5; }
  .inv-patient { margin-top: 6px; }

  /* Sections - colored cards */
  .inv-section {
    margin-bottom: 24px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .inv-section-act { border-color: #bfdbfe; }
  .inv-section-product { border-color: #bbf7d0; }
  .inv-section-title {
    font-family: 'DM Serif Display', serif;
    font-size: 1.15rem;
    margin: 0;
    padding: 14px 18px;
    font-weight: 400;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .inv-section-act .inv-section-title {
    background: linear-gradient(90deg, #EFF6FF, #ffffff);
    color: #1d4ed8;
    border-bottom: 1px solid #bfdbfe;
  }
  .inv-section-product .inv-section-title {
    background: linear-gradient(90deg, #f0fdf4, #ffffff);
    color: #0f5c45;
    border-bottom: 1px solid #bbf7d0;
  }
  .inv-section-title::before {
    content: '';
    width: 8px;
    height: 24px;
    border-radius: 4px;
  }
  .inv-section-act .inv-section-title::before { background: #2563EB; }
  .inv-section-product .inv-section-title::before { background: #0f5c45; }
  .inv-tva-badge {
    margin-left: auto;
    background: #dbeafe;
    color: #1d4ed8;
    padding: 4px 12px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    font-family: 'DM Sans', sans-serif;
  }
  .inv-tva-badge-green { background: #d1fae5; color: #0f5c45; }

  .inv-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
  }
  .inv-table th {
    text-align: left;
    padding: 10px 12px;
    background: #f8fafc;
    color: #475569;
    font-weight: 500;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    border-bottom: 1px solid #e2e8f0;
  }
  .inv-table td {
    padding: 12px;
    border-bottom: 1px solid #f1f5f9;
    vertical-align: top;
  }
  .inv-table .ar { text-align: right; }
  .inv-lot { font-size: 0.72rem; color: #94a3b8; margin-top: 3px; }

  /* Totals - more striking */
  .inv-totals { display: flex; justify-content: flex-end; margin-top: 28px; }
  .inv-totals-table {
    min-width: 360px;
    font-size: 0.92rem;
    background: #f8f7f2;
    border-radius: 12px;
    padding: 14px 22px;
  }
  .inv-totals-table td {
    padding: 7px 6px;
    color: #0f172a;
  }
  .inv-totals-table .ar { text-align: right; font-weight: 500; }
  .inv-vat-detail td {
    color: #94a3b8;
    font-size: 0.78rem;
    padding-left: 18px;
    font-style: italic;
  }
  .inv-total-row td {
    border-top: 2px solid #0f5c45;
    padding-top: 12px;
    margin-top: 6px;
    font-family: 'DM Serif Display', serif;
    font-size: 1.5rem;
    color: #0f5c45;
    font-style: italic;
  }

  /* Notes & footer */
  .inv-notes {
    margin-top: 28px;
    padding: 14px 18px;
    background: #fffbeb;
    border-left: 3px solid #f59e0b;
    border-radius: 6px;
    font-size: 0.88rem;
  }
  .inv-notes-label {
    font-size: 0.72rem;
    color: #92400e;
    text-transform: uppercase;
    font-weight: 600;
    letter-spacing: 0.05em;
    margin-bottom: 4px;
  }

  .inv-footer {
    margin-top: 36px;
    padding: 22px 28px;
    background: linear-gradient(135deg, #EFF6FF 0%, #f0fdf4 100%);
    border-top: 3px solid #2563EB;
    font-size: 0.82rem;
    color: #475569;
    line-height: 1.7;
    text-align: center;
  }
  .inv-footer strong { color: #0f172a; }
  .inv-footer-thanks {
    font-family: 'DM Serif Display', serif;
    font-style: italic;
    color: #0f5c45;
    font-size: 1.05rem;
    margin-bottom: 10px;
  }

  /* Print: white backgrounds to save ink, keep colored accents (text, borders) */
  @media print {
    body, .invoice-page { background: white !important; }
    .sidebar, .no-print, header.no-print { display: none !important; }
    .main-content, .invoice-page { padding: 0 !important; margin: 0 !important; }
    .invoice-doc {
      box-shadow: none !important;
      border-radius: 0 !important;
      max-width: 100% !important;
      background: white !important;
    }
    .invoice-doc::before { display: none !important; }
    .inv-header {
      background: white !important;
      border-bottom: 2px solid #2563EB !important;
      padding: 24px 30px 18px !important;
    }
    .inv-header::after { display: none !important; }
    .inv-body { padding: 24px 30px !important; }
    .inv-logo { box-shadow: none !important; padding: 0 !important; }
    .inv-client {
      background: white !important;
      border: 1.5px solid #2563EB !important;
      border-left-width: 4px !important;
    }
    .inv-section { border: 1px solid #cbd5e1 !important; }
    .inv-section-act .inv-section-title,
    .inv-section-product .inv-section-title {
      background: white !important;
      border-bottom: 1px solid #cbd5e1 !important;
    }
    .inv-table th { background: white !important; border-bottom: 1px solid #94a3b8 !important; }
    .inv-tva-badge, .inv-tva-badge-green {
      background: white !important;
      border: 1px solid currentColor;
    }
    .inv-totals-table { background: white !important; border: 1px solid #cbd5e1 !important; }
    .inv-notes {
      background: white !important;
      border: 1px solid #f59e0b !important;
      border-left: 3px solid #f59e0b !important;
    }
    .inv-footer {
      background: white !important;
      border-top: 2px solid #2563EB !important;
      padding: 18px 30px !important;
    }
    .inv-status {
      background: white !important;
      border: 1.5px solid currentColor;
    }
    /* Multi-page invoices: let content flow and avoid splitting rows/totals across pages */
    .invoice-doc { overflow: visible !important; }
    .inv-table tr, .inv-totals, .inv-footer, .inv-notes { break-inside: avoid; page-break-inside: avoid; }
    .inv-section-title { break-after: avoid; page-break-after: avoid; }
    /* Force-hide all browser print background-graphics fallbacks */
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;
