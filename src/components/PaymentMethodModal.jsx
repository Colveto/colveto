import React, { useState } from 'react';
import Modal from './Modal.jsx';

export const PAYMENT_METHODS = {
  cash: 'Espèces', card: 'Carte bancaire', transfer: 'Virement', payconiq: 'Payconiq', cheque: 'Chèque',
};

// Demande le mode de paiement avant de marquer une facture payée.
export default function PaymentMethodModal({ invoiceNumber, onConfirm, onClose, title, confirmLabel = 'Marquer payée', initial = '' }) {
  const [method, setMethod] = useState(initial);
  const [saving, setSaving] = useState(false);

  const confirm = async () => {
    setSaving(true);
    try {
      await onConfirm(method);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={title || `Facture ${invoiceNumber} payée`}
      onClose={() => !saving && onClose()}
      footer={
        <>
          <button className="btn" disabled={saving} onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" disabled={!method || saving} onClick={confirm}>
            {saving ? 'Enregistrement…' : confirmLabel}
          </button>
        </>
      }
    >
      <div className="form-group">
        <label>Mode de paiement *</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(PAYMENT_METHODS).map(([key, label]) => (
            <button key={key} type="button"
              className={'btn' + (method === key ? ' btn-primary' : '')}
              onClick={() => setMethod(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
