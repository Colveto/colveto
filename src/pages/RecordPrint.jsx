import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function ageString(birthDate) {
  if (!birthDate) return '—';
  const years = (Date.now() - new Date(birthDate)) / (1000 * 60 * 60 * 24 * 365.25);
  return years >= 1 ? `${Math.floor(years)} an(s)` : `${Math.floor(years * 12)} mois`;
}

// Print-only view of a single medical record. The layout/styling mirrors the
// invoice page so that the printToPDF output matches the visual identity.
// The Electron main process loads this URL in a hidden BrowserWindow and waits
// for window.__PRINT_READY__ before calling printToPDF.
export default function RecordPrint() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    window.__PRINT_READY__ = false;
    (async () => {
      try {
        const d = await window.api.records.getFull(id);
        setData(d);
        // Give the browser a couple of frames to paint, then signal ready.
        requestAnimationFrame(() => requestAnimationFrame(() => {
          window.__PRINT_READY__ = true;
        }));
      } catch (e) {
        setError(e.message);
        window.__PRINT_READY__ = true; // unblock even on failure
      }
    })();
  }, [id]);

  if (error) return <div style={{ padding: 40 }}>Erreur : {error}</div>;
  if (!data) return <div style={{ padding: 40 }}>Chargement…</div>;

  const { record, patient, owner, settings } = data;
  const sex = patient?.sex === 'M' ? 'Mâle' : patient?.sex === 'F' ? 'Femelle' : '—';

  return (
    <div className="invoice-page">
      <style>{RECORD_CSS}</style>
      <div className="invoice-doc">
        <header className="inv-header">
          <div className="inv-cabinet">
            <img className="inv-logo" src="logo-invoice.png" alt="" onError={(e) => { e.target.style.display = 'none'; }} />
            <div>
              <div className="inv-cabinet-name">{settings?.clinicName || 'Cabinet vétérinaire'}</div>
              <div className="inv-cabinet-info">
                {settings?.clinicAddress && <div>{settings.clinicAddress}</div>}
                {(settings?.clinicPostalCode || settings?.clinicCity) && (
                  <div>{settings.clinicPostalCode} {settings.clinicCity}</div>
                )}
                {settings?.clinicPhone && <div>📞 {settings.clinicPhone}</div>}
                {settings?.clinicEmail && <div>✉ {settings.clinicEmail}</div>}
                {settings?.clinicVatNumber && <div className="inv-cabinet-tva">TVA : {settings.clinicVatNumber}</div>}
              </div>
            </div>
          </div>
          <div className="inv-meta">
            <div className="inv-title">Compte-rendu</div>
            <div className="inv-number">Du <strong>{fmtDate(record?.date)}</strong></div>
            <div className="inv-meta-row"><strong>{record?.type}</strong></div>
          </div>
        </header>

        <div className="inv-body">
          {/* Patient block */}
          <section className="inv-client">
            <div className="inv-client-label">Patient</div>
            <div className="inv-client-name">{patient?.name || '—'}</div>
            <div className="inv-client-info">
              <div>
                {patient?.species || '—'}
                {patient?.breed ? ` · ${patient.breed}` : ''}
                {' · '}{sex}
                {patient?.birthDate ? ` · ${ageString(patient.birthDate)} (né(e) le ${fmtDate(patient.birthDate)})` : ''}
              </div>
              <div>
                {patient?.weight ? `Poids : ${patient.weight} kg · ` : ''}
                {patient?.color ? `Couleur : ${patient.color} · ` : ''}
                Stérilisé(e) : {patient?.sterilized ? 'Oui' : 'Non'}
              </div>
              {patient?.microchipId && <div>N° puce : {patient.microchipId}</div>}
              {patient?.allergies && <div>Allergies : <strong>{patient.allergies}</strong></div>}
            </div>
          </section>

          {/* Owner block (green tint) */}
          {owner && (
            <section className="inv-client inv-client-owner">
              <div className="inv-client-label">Propriétaire</div>
              <div className="inv-client-name">{owner.firstName} {owner.lastName}</div>
              <div className="inv-client-info">
                {(owner.address || owner.postalCode || owner.city) && (
                  <div>{[owner.address, owner.postalCode, owner.city].filter(Boolean).join(', ')}</div>
                )}
                {(owner.email || owner.phone) && (
                  <div>
                    {owner.email && <>✉ {owner.email}</>}
                    {owner.email && owner.phone && ' · '}
                    {owner.phone && <>📞 {owner.phone}</>}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Record section */}
          <section className="inv-section inv-section-act">
            <h3 className="inv-section-title">
              {record?.title || record?.type || 'Consultation'}
            </h3>
            <div className="rec-body">
              <div className="rec-meta">
                {record?.veterinarian && <div><strong>Vétérinaire :</strong> {record.veterinarian}</div>}
                {record?.weight && <div><strong>Poids :</strong> {record.weight} kg</div>}
                {record?.temperature && <div><strong>Température :</strong> {record.temperature}°C</div>}
              </div>
              {record?.description && (
                <div className="rec-block">
                  <div className="rec-block-label">Description / examen clinique</div>
                  <div className="rec-block-content">{record.description}</div>
                </div>
              )}
              {record?.treatment && (
                <div className="rec-block">
                  <div className="rec-block-label">Traitement / prescription</div>
                  <div className="rec-block-content">{record.treatment}</div>
                </div>
              )}
            </div>
          </section>
        </div>

        <footer className="inv-footer">
          <div className="inv-footer-thanks">Document confidentiel — {patient?.name || ''}</div>
          {settings?.clinicLegalMentions && <div>{settings.clinicLegalMentions}</div>}
        </footer>
      </div>
    </div>
  );
}

// Mirror of the invoice CSS, with two extra rule blocks (.inv-client-owner +
// .rec-*) for the record-specific bits. Anything not used by RecordPrint is
// harmless (unused selectors).
const RECORD_CSS = `
  .invoice-page { background: #f8f7f2; min-height: 100vh; padding: 20px 0; margin: 0; }
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
    font-size: 0.85rem;
    margin-bottom: 4px;
    color: #475569;
  }
  .inv-meta-row strong { color: #0f172a; font-weight: 600; }

  .inv-body { padding: 32px 52px 40px; }

  .inv-client {
    background: white;
    border: 1.5px solid #2563EB;
    border-left-width: 5px;
    border-radius: 10px;
    padding: 18px 22px;
    margin-bottom: 20px;
    position: relative;
  }
  .inv-client-owner { border-color: #0f5c45; }
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
  .inv-client-info { font-size: 0.88rem; color: #475569; line-height: 1.6; }

  .inv-section {
    margin-top: 14px;
    margin-bottom: 24px;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #e2e8f0;
  }
  .inv-section-act { border-color: #bfdbfe; }
  .inv-section-title {
    font-family: 'DM Serif Display', serif;
    font-size: 1.15rem;
    margin: 0;
    padding: 14px 18px;
    font-weight: 400;
    display: flex;
    align-items: center;
    gap: 12px;
    background: linear-gradient(90deg, #EFF6FF, #ffffff);
    color: #1d4ed8;
    border-bottom: 1px solid #bfdbfe;
  }
  .inv-section-title::before {
    content: '';
    width: 8px;
    height: 24px;
    border-radius: 4px;
    background: #2563EB;
  }

  .rec-body { padding: 18px 22px 20px; background: white; }
  .rec-meta {
    display: flex;
    gap: 24px;
    flex-wrap: wrap;
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #f1f5f9;
    font-size: 0.92rem;
    color: #475569;
  }
  .rec-meta strong { color: #0f172a; font-weight: 500; }
  .rec-block { margin-top: 14px; }
  .rec-block-label {
    font-size: 0.72rem;
    color: #2563EB;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .rec-block-content {
    font-size: 0.97rem;
    color: #0f172a;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  .inv-footer {
    margin-top: 12px;
    padding: 22px 28px;
    background: linear-gradient(135deg, #EFF6FF 0%, #f0fdf4 100%);
    border-top: 3px solid #2563EB;
    font-size: 0.82rem;
    color: #475569;
    line-height: 1.7;
    text-align: center;
  }
  .inv-footer-thanks {
    font-family: 'DM Serif Display', serif;
    font-style: italic;
    color: #0f5c45;
    font-size: 1.05rem;
    margin-bottom: 6px;
  }

  @media print {
    body, .invoice-page { background: white !important; padding: 0 !important; margin: 0 !important; }
    .sidebar, .no-print { display: none !important; }
    .invoice-doc {
      box-shadow: none !important;
      border-radius: 0 !important;
      max-width: 100% !important;
    }
  }
`;
