import React, { useEffect, useMemo, useState } from 'react';

// Bloc « VAMREG » de la fiche médicament (cabinets belges, module activé).
// Les champs vivent dans l'objet `editing` de Medicines.jsx (colonnes vamreg*).
export function vamregPayloadFrom(editing) {
  const f = parseForeign(editing.vamregForeign);
  return {
    declare: !!editing.vamregDeclare,
    productType: editing.vamregProductType === 'FOREIGN' ? 'FOREIGN' : 'BE',
    cnk: editing.vamregCnk || '',
    productLabel: editing.vamregProductLabel || '',
    packBaseUnits: editing.vamregPackBaseUnits === '' || editing.vamregPackBaseUnits == null
      ? null : Number(String(editing.vamregPackBaseUnits).replace(',', '.')),
    providerType: editing.vamregProviderType || '',
    foreign: f,
  };
}

function parseForeign(v) {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

// Correspondance raisonnable entre l'unité VAMREG d'un produit belge et
// l'unité de base saisie dans Colveto (pour pré-remplir le contenu d'un conditionnement).
function unitMatches(amrUnit, baseUnit) {
  const b = (baseUnit || '').toLowerCase();
  if (amrUnit === 'ML') return /^m\s?l/.test(b);
  if (amrUnit === 'G') return b === 'g' || b.startsWith('gramme');
  if (amrUnit === 'PIECE') return /compr|cp|g[ée]lule|pi[eè]ce|tube|seringue|injecteur|bolus|unit/.test(b);
  return false;
}

export default function VamregMedicineFields({ editing, setEditing }) {
  const [products, setProducts] = useState(null);
  const [foreignList, setForeignList] = useState(null);
  const [providers, setProviders] = useState([]);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const type = editing.vamregProductType === 'FOREIGN' ? 'FOREIGN' : 'BE';
  const foreign = parseForeign(editing.vamregForeign);
  const set = (patch) => setEditing({ ...editing, ...patch });
  const setForeign = (patch) => set({ vamregForeign: { ...foreign, ...patch } });

  useEffect(() => {
    if (!editing.vamregDeclare) return;
    window.api.vamreg.ref('provider-type').then(setProviders).catch((e) => setError(e.message));
  }, [editing.vamregDeclare]);
  useEffect(() => {
    if (!editing.vamregDeclare) return;
    if (type === 'BE' && !products) window.api.vamreg.ref('medicinal-product').then(setProducts).catch((e) => setError(e.message));
    if (type === 'FOREIGN' && !foreignList) window.api.vamreg.ref('foreign-medicinal-product').then(setForeignList).catch((e) => setError(e.message));
  }, [editing.vamregDeclare, type]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const list = type === 'BE' ? (products || []) : (foreignList || []);
    return list.filter((p) => (type === 'BE'
      ? `${p.cnk} ${p.ppnFr} ${p.ppnNl} ${p.maName}`
      : `${p.foreignProductName} ${p.foreignMaNumber}`).toLowerCase().includes(q)).slice(0, 30);
  }, [query, products, foreignList, type]);

  function pickBe(p) {
    const guess = unitMatches(p.amrDeclarationUnit, editing.baseUnit) ? p.amrPackUnitAmount : editing.vamregPackBaseUnits;
    set({ vamregCnk: p.cnk, vamregProductLabel: `${p.ppnFr} (CNK ${p.cnk})`, vamregPackBaseUnits: guess ?? '' });
    setQuery('');
  }
  function pickForeign(p) {
    const guess = unitMatches(p.amrDeclarationUnit, editing.baseUnit) ? p.amrPackUnitAmount : editing.vamregPackBaseUnits;
    set({
      vamregProductLabel: p.foreignProductName,
      vamregPackBaseUnits: guess ?? '',
      vamregForeign: {
        foreignProductName: p.foreignProductName, foreignMaNumber: p.foreignMaNumber, foreignMaHolder: p.foreignMaHolder,
        packSize: p.packSize, pharmaceuticalFormSporId: p.pharmaceuticalFormSporId,
        activeSubstanceStrengthUnits: p.activeSubstanceStrengthUnitMasses || null,
      },
    });
    setQuery('');
  }

  return (
    <div style={{ marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, background: '#f8fafc' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
        <input type="checkbox" checked={!!editing.vamregDeclare}
          onChange={(e) => set({ vamregDeclare: e.target.checked ? 1 : 0, vamregProductType: editing.vamregProductType || 'BE' })} />
        🇧🇪 Antibiotique à déclarer à VAMREG
      </label>
      {!!editing.vamregDeclare && (
        <div style={{ marginTop: 10 }}>
          {error && <div style={{ color: '#b91c1c', fontSize: '0.85rem', marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: '0.9rem' }}>
            <label><input type="radio" checked={type === 'BE'} onChange={() => set({ vamregProductType: 'BE' })} /> Produit autorisé en Belgique (CNK)</label>
            <label><input type="radio" checked={type === 'FOREIGN'} onChange={() => set({ vamregProductType: 'FOREIGN' })} /> Produit étranger</label>
          </div>

          <div className="form-row">
            <label>{type === 'BE' ? 'Rechercher dans la liste VAMREG (nom ou CNK)' : 'Rechercher dans les produits étrangers fréquents (facultatif)'}</label>
            <div>
            <input className="input" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder={type === 'BE' ? 'ex. Florkem ou 2630648' : 'ex. Penstrep'} />
            {matches.length > 0 && (
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, background: 'white', maxHeight: 220, overflow: 'auto', marginTop: 4 }}>
                {matches.map((p) => (
                  <div key={type === 'BE' ? p.cnk : p.updPackId || p.foreignMaNumber}
                    onClick={() => (type === 'BE' ? pickBe(p) : pickForeign(p))}
                    style={{ padding: '6px 10px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '0.85rem' }}>
                    {type === 'BE'
                      ? <><b>{p.ppnFr}</b> <span style={{ color: '#6b7280' }}>— CNK {p.cnk}{p.usage === 'HUMAN' ? ' · usage humain' : ''}</span></>
                      : <><b>{p.foreignProductName}</b> <span style={{ color: '#6b7280' }}>— {p.foreignMaNumber}</span></>}
                  </div>
                ))}
              </div>
            )}
            </div>
          </div>

          {type === 'BE' ? (
            <div className="form-row">
              <label>Code CNK *</label>
              <div>
                <input className="input" value={editing.vamregCnk || ''} maxLength={7} inputMode="numeric"
                  onChange={(e) => set({ vamregCnk: e.target.value.replace(/\D/g, ''), vamregProductLabel: '' })} />
                {editing.vamregProductLabel && <div style={{ fontSize: '0.8rem', color: '#475569', marginTop: 4 }}>{editing.vamregProductLabel}</div>}
              </div>
            </div>
          ) : (
            <>
              <div className="form-grid-2">
                <div className="form-row">
                  <label>Nom du produit *</label>
                  <input className="input" value={foreign.foreignProductName || ''} onChange={(e) => setForeign({ foreignProductName: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>N° d'autorisation (AMM) *</label>
                  <input className="input" value={foreign.foreignMaNumber || ''} onChange={(e) => setForeign({ foreignMaNumber: e.target.value })} />
                </div>
              </div>
              <div className="form-grid-2">
                <div className="form-row">
                  <label>Titulaire de l'AMM</label>
                  <input className="input" value={foreign.foreignMaHolder || ''} onChange={(e) => setForeign({ foreignMaHolder: e.target.value })} />
                </div>
                <div className="form-row">
                  <label>Taille du conditionnement * (ex. 100 ml)</label>
                  <input className="input" value={foreign.packSize || ''} onChange={(e) => setForeign({ packSize: e.target.value })} />
                </div>
              </div>
            </>
          )}

          <div className="form-grid-2">
            <div className="form-row">
              <label>Contenu d'un conditionnement * (en {editing.baseUnit})</label>
              <div>
                <input className="input" type="text" inputMode="decimal" value={editing.vamregPackBaseUnits ?? ''}
                  onChange={(e) => set({ vamregPackBaseUnits: e.target.value.replace(',', '.') })} />
                <div style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
                  Sert à convertir les quantités en conditionnements pour VAMREG.
                </div>
              </div>
            </div>
            <div className="form-row">
              <label>Fournisseur habituel (type)</label>
              <select className="select" value={editing.vamregProviderType || ''} onChange={(e) => set({ vamregProviderType: e.target.value })}>
                <option value="">Valeur par défaut du cabinet</option>
                {providers.map((p) => <option key={p.code} value={p.code}>{p.fr}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
