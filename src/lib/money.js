// Money / VAT helpers — used wherever prices are displayed.
// Convention: tarifs stockés HT, affichage en HTVA et TVAC.

export function num(v) {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function ttcOf(priceHT, vatRate) {
  return num(priceHT) * (1 + num(vatRate) / 100);
}

// 2 décimales pour ≥ 1€, 3 décimales en dessous (cohérent avec Medicines.jsx).
export function fmtPrice(v) {
  const n = num(v);
  const digits = Math.abs(n) < 1 && n !== 0 ? 3 : 2;
  return n.toLocaleString('fr-LU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtEur(v) {
  return fmtPrice(v) + ' €';
}

// "1,23 € HT / 1,44 € TTC"
export function fmtHTandTTC(priceHT, vatRate) {
  return `${fmtEur(priceHT)} HT / ${fmtEur(ttcOf(priceHT, vatRate))} TTC`;
}

// Remise en % sur les actes d'une facture/d'un devis. Le prix enregistré
// (priceHT) est le prix NET ; le prix catalogue et le % sont gardés à côté.
export function isAct(it) {
  return (it.kind || 'act') !== 'product';
}

export function netPrice(priceHT, pct) {
  return Math.round(num(priceHT) * (1 - num(pct) / 100) * 100) / 100;
}

// Champs prix d'une ligne à envoyer au serveur, à partir de son prix catalogue.
export function discountFields(it, pct) {
  const p = num(pct);
  if (!isAct(it) || p <= 0) return { priceHT: num(it.priceHT), listPriceHT: null, discountPct: null };
  return { priceHT: netPrice(it.priceHT, p), listPriceHT: num(it.priceHT), discountPct: p };
}

// % de remise d'un document enregistré (repris depuis ses lignes d'actes).
export function docDiscountPct(items) {
  return (items || []).reduce((m, it) => (isAct(it) ? Math.max(m, num(it.discountPct)) : m), 0);
}
