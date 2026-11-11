import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import SearchSelect from '../components/SearchSelect.jsx';
import InvoiceLineEditor, { newActItem, pickFIFOLot } from '../components/InvoiceLineEditor.jsx';
import { num, fmtEur, isAct, discountFields, docDiscountPct } from '../lib/money.js';

const in30Days = () => {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
};

// Rebuild an editor line from a stored invoice/quote line. Product lines get
// their medicine details (sale units, lots) back; with `pickLot`, a FIFO lot is
// chosen for the stored quantity (a quote has none — it never touched stock).
async function toEditorItem(it, { pickLot = false } = {}) {
  if (it.kind === 'product' && it.medicineId) {
    let det = null;
    try { det = await window.api.medicines.get(it.medicineId); } catch { /* ignore */ }
    let lotId = it.lotId || '';
    if (pickLot && det) {
      const su = det.saleUnits?.find((u) => u.id === it.saleUnitId);
      lotId = su ? (pickFIFOLot(det.lots, su, Number(it.quantity)) || '') : '';
    }
    return {
      kind: 'product', description: it.description, quantity: it.quantity,
      priceHT: it.priceHT, vatRate: it.vatRate, accountCode: it.accountCode,
      medicineId: it.medicineId, saleUnitId: it.saleUnitId, lotId,
      patientId: it.patientId || '', _medicineDetails: det,
    };
  }
  // L'éditeur travaille sur le prix catalogue ; la remise est réappliquée à l'enregistrement.
  return {
    kind: it.kind || 'act', description: it.description, quantity: it.quantity,
    priceHT: it.listPriceHT ?? it.priceHT, vatRate: it.vatRate, accountCode: it.accountCode,
    serviceId: it.serviceId || undefined, patientId: it.patientId || '',
  };
}

// Sert aux factures et, avec mode="quote", aux devis (mêmes lignes, sans lot ni
// déstockage). « ?fromQuote=<id> » préremplit une facture depuis un devis.
export default function NewInvoice({ mode = 'invoice' }) {
  const isQuote = mode === 'quote';
  const api = isQuote ? window.api.quotes : window.api.invoices;
  const base = isQuote ? '/quotes' : '/invoices';
  const { user } = useAuth();
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const { id: editId } = useParams();
  const prefilledOwnerId = searchParams.get('ownerId') || '';
  const fromQuoteId = isQuote ? null : searchParams.get('fromQuote');
  const [invoiceNumber, setInvoiceNumber] = useState(null);
  const [sourceQuote, setSourceQuote] = useState(null);

  const [owners, setOwners] = useState([]);
  const [patients, setPatients] = useState([]);
  const [services, setServices] = useState([]);
  const [medicines, setMedicines] = useState([]);
  const [protocols, setProtocols] = useState([]);

  const [form, setForm] = useState({
    ownerId: prefilledOwnerId,
    patientId: '',
    date: new Date().toISOString().slice(0, 10),
    dueDate: isQuote ? in30Days() : '',
    notes: '',
    discountPct: '',
    items: [newActItem()],
  });

  useEffect(() => {
    window.api.owners.list().then(setOwners);
    window.api.patients.list().then(setPatients);
    window.api.services.list().then(setServices);
    window.api.medicines.list().then(setMedicines);
    window.api.protocols.list().then(setProtocols).catch(() => setProtocols([]));
  }, []);

  // Edit mode: load the existing (draft) invoice / quote and prefill the form.
  useEffect(() => {
    if (!editId) return;
    (async () => {
      try {
        const doc = await api.get(editId);
        const items = await Promise.all((doc.items || []).map((it) => toEditorItem(it)));
        setInvoiceNumber(doc.number);
        setForm({
          ownerId: doc.ownerId,
          patientId: doc.patientId || '',
          date: doc.date,
          dueDate: (isQuote ? doc.validUntil : doc.dueDate) || '',
          notes: doc.notes || '',
          discountPct: docDiscountPct(doc.items) || '',
          items: items.length ? items : [newActItem()],
        });
      } catch (e) {
        alert(`Impossible de charger ${isQuote ? 'le devis' : 'la facture'} : ` + e.message);
        nav(base);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  // Facture depuis un devis : mêmes lignes et prix, lots choisis maintenant (FIFO).
  useEffect(() => {
    if (!fromQuoteId || editId) return;
    (async () => {
      try {
        const q = await window.api.quotes.get(fromQuoteId);
        if (q.invoiceId) {
          alert(`Le devis ${q.number} a déjà été transformé en facture.`);
          nav(`/invoices/${q.invoiceId}`);
          return;
        }
        const items = await Promise.all((q.items || []).map((it) => toEditorItem(it, { pickLot: true })));
        setSourceQuote(q);
        setForm({
          ownerId: q.ownerId,
          patientId: q.patientId || '',
          date: new Date().toISOString().slice(0, 10),
          dueDate: '',
          notes: q.notes || '',
          discountPct: docDiscountPct(q.items) || '',
          items: items.length ? items : [newActItem()],
        });
      } catch (e) {
        alert('Impossible de charger le devis : ' + e.message);
        nav('/quotes');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromQuoteId]);

  const discountPct = Math.min(100, Math.max(0, num(form.discountPct)));
  const totals = form.items.reduce((acc, it) => {
    const gross = num(it.quantity) * num(it.priceHT);
    const ht = num(it.quantity) * discountFields(it, discountPct).priceHT;
    const tva = ht * (num(it.vatRate) / 100);
    acc.ht += ht; acc.tva += tva; acc.discount += gross - ht;
    return acc;
  }, { ht: 0, tva: 0, discount: 0 });
  const hasActs = form.items.some(isAct);
  const ttc = totals.ht + totals.tva;

  const ownerPatients = patients.filter((p) => !form.ownerId || p.ownerId === form.ownerId);

  const save = async () => {
    if (!form.ownerId) { alert('Sélectionnez un propriétaire'); return; }
    if (form.items.length === 0) { alert('Ajoutez au moins une ligne'); return; }
    if (form.items.some((i) => !i.description)) { alert('Renseignez la description de toutes les lignes'); return; }

    // Check products have an animal, lot & sale unit (a quote touches no stock).
    for (const it of form.items) {
      if (it.kind === 'product' && isQuote) {
        if (!it.medicineId || !it.saleUnitId) { alert('Produit ou unité de vente manquant sur la ligne "' + it.description + '".'); return; }
      } else if (it.kind === 'product') {
        if (!(it.patientId || form.patientId)) { alert('Un animal est requis sur la ligne produit "' + it.description + '" (traçabilité).'); return; }
        if (!it.medicineId) { alert('Médicament manquant sur une ligne produit.'); return; }
        if (!it.saleUnitId) { alert('Unité de vente manquante.'); return; }
        if (!it.lotId) { alert('Stock insuffisant (tous lots confondus) pour la quantité demandée de "' + it.description + '".'); return; }
      }
    }

    const data = {
      ownerId: form.ownerId,
      patientId: form.patientId || null,
      date: form.date,
      ...(isQuote
        ? { validUntil: form.dueDate || null }
        : { dueDate: form.dueDate || null, status: 'draft', quoteId: sourceQuote?.id || null }),
      notes: form.notes,
      createdBy: user?.id,
      items: form.items.map((i) => ({
        kind: i.kind,
        description: i.description,
        quantity: num(i.quantity),
        ...discountFields(i, discountPct),
        vatRate: num(i.vatRate),
        accountCode: i.accountCode,
        serviceId: i.serviceId || null,
        medicineId: i.medicineId || null,
        lotId: isQuote ? null : (i.lotId || null),
        saleUnitId: i.saleUnitId || null,
        patientId: i.patientId || null,
      })),
    };

    try {
      const saved = editId ? await api.update(editId, data) : await api.create(data);
      nav(`${base}/${saved.id}`);
    } catch (e) {
      alert('Erreur: ' + e.message);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>
          {isQuote
            ? (editId ? `Modifier le devis ${invoiceNumber || ''}` : 'Nouveau devis')
            : (editId ? `Modifier la facture ${invoiceNumber || ''}` : 'Nouvelle facture')}
        </h2>
      </div>

      {sourceQuote && (
        <div className="card" style={{ background: '#eff6ff', border: '1px solid #bfdbfe' }}>
          Facture créée à partir du devis <strong>{sourceQuote.number}</strong> — vérifiez les lignes et les lots
          avant d'enregistrer. Le stock n'est déduit qu'à la création de la facture.
        </div>
      )}

      <div className="card">
        <div className="form-row">
          <div className="form-group">
            <label>Propriétaire *</label>
            <SearchSelect
              value={form.ownerId}
              onChange={(id) => setForm({ ...form, ownerId: id, patientId: '' })}
              options={owners.map((o) => ({
                id: o.id,
                label: `${o.lastName} ${o.firstName}`,
                sub: [o.email, o.phone].filter(Boolean).join(' · ') || null,
                keywords: `${o.email || ''} ${o.phone || ''} ${o.city || ''}`,
              }))}
              placeholder="Rechercher un propriétaire…"
            />
          </div>
          <div className="form-group">
            <label>Animal par défaut {!isQuote && form.items.some((i) => i.kind === 'product') && '*'}</label>
            <SearchSelect
              value={form.patientId}
              onChange={(id) => setForm({ ...form, patientId: id })}
              options={ownerPatients.map((p) => ({
                id: p.id,
                label: `${p.name} (${p.species})`,
                sub: p.breed || null,
                keywords: `${p.breed || ''} ${p.species}`,
              }))}
              placeholder={form.ownerId ? 'Rechercher un patient…' : 'Choisir d\'abord un propriétaire'}
              disabled={!form.ownerId}
            />
            {ownerPatients.length > 1 && (
              <small style={{ color: '#6b7280' }}>Utilisé pour les nouvelles lignes — modifiable par ligne si le propriétaire a plusieurs animaux.</small>
            )}
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label>Date *</label>
            <input className="input" type="date" value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </div>
          <div className="form-group">
            <label>{isQuote ? 'Valable jusqu\'au' : 'Échéance'}</label>
            <input className="input" type="date" value={form.dueDate}
              onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>{isQuote ? 'Lignes du devis' : 'Lignes de facturation'}</h3>

        <InvoiceLineEditor
          items={form.items}
          onChange={(items) => setForm({ ...form, items })}
          services={services}
          medicines={medicines}
          protocols={protocols}
          patients={ownerPatients}
          defaultPatientId={form.patientId}
          quoteMode={isQuote}
        />

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'flex-start', gap: 32, marginTop: 16, flexWrap: 'wrap' }}>
          {hasActs && (
            <div className="form-group" style={{ margin: 0 }}>
              <label>Remise sur les actes (%)</label>
              <input className="input" type="number" min="0" max="100" step="0.5" style={{ width: 120 }}
                value={form.discountPct} placeholder="0"
                onChange={(e) => setForm({ ...form, discountPct: e.target.value })} />
              <small style={{ display: 'block', color: '#6b7280' }}>Appliquée à toutes les lignes d'actes, pas aux produits.</small>
            </div>
          )}
          <table style={{ minWidth: 280 }}>
            <tbody>
              {totals.discount > 0.004 && (
                <tr><td>Remise actes ({discountPct.toLocaleString('fr-LU')} %)</td><td className="text-right font-bold">− {fmtEur(totals.discount)}</td></tr>
              )}
              <tr><td>Total HTVA</td><td className="text-right font-bold">{fmtEur(totals.ht)}</td></tr>
              <tr><td>TVA</td><td className="text-right font-bold">{fmtEur(totals.tva)}</td></tr>
              <tr><td className="text-lg font-bold">Total TVAC</td><td className="text-right text-lg font-bold">{fmtEur(ttc)}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="form-group mt-4">
          <label>Notes</label>
          <textarea className="textarea" value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </div>

        <div className="flex-row mt-4" style={{ justifyContent: 'flex-end', display: 'flex', gap: 10 }}>
          <button className="btn" onClick={() => nav(editId ? `${base}/${editId}` : (sourceQuote ? `/quotes/${sourceQuote.id}` : base))}>Annuler</button>
          <button className="btn btn-primary" onClick={save}>
            {editId ? 'Enregistrer les modifications' : (isQuote ? 'Créer le devis' : 'Créer la facture')}
          </button>
        </div>
      </div>
    </div>
  );
}
