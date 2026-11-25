// VAMREG — registre belge des antimicrobiens à usage vétérinaire (AFMPS).
//
// Module facultatif pour les cabinets belges (dépôt vétérinaire). Rien ne part
// tant que « vamregEnabled » n'est pas activé dans Paramètres avec la clé API
// du cabinet (créée par le vétérinaire sur app.fagg-afmps.be → FAMHP Connect).
//
// Principe : réconciliation. À partir de l'état de la base, on calcule les
// déclarations attendues (entrées = lots reçus, sorties = lignes produit des
// factures validées), on les compare à ce qui a déjà été envoyé
// (table vamreg_declarations) et on crée / modifie / supprime chez VAMREG ce
// qui diffère. Une facture annulée ou un lot corrigé est ainsi répercuté tout
// seul, tant que le trimestre est encore ouvert chez VAMREG.
//
// Documentation : « API Manual (OCT26) — Interface Control Document » de l'AFMPS.

const crypto = require('crypto');

const HOSTS = {
  uat: 'https://uat.app.fagg-afmps.be/vamreg/api',
  prod: 'https://app.fagg-afmps.be/vamreg/api',
};
const REF_LISTS = new Set([
  'medicinal-product', 'foreign-medicinal-product', 'target-species', 'indication',
  'provider-type', 'pharmaceutical-form', 'active-substance', 'unit',
]);
const DEFAULT_SPECIES_MAP = { Cheval: 'HORSE' }; // les autres espèces : non déclarées par défaut
const BATCH = 100;

// ---------- dates et fenêtre de déclaration ----------
const iso = (d) => d.toISOString().slice(0, 10);
function quarterStart(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
}
// Trimestre courant jusqu'à aujourd'hui, plus le trimestre précédent tant qu'on
// n'a pas dépassé sa fin + 1 mois + 14 jours (ICD § 2.2.2.1).
function declarationWindow(now = new Date()) {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const qs = quarterStart(today);
  const prevStart = new Date(Date.UTC(qs.getUTCFullYear(), qs.getUTCMonth() - 3, 1));
  const prevEnd = new Date(qs.getTime() - 86400000);
  const deadline = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth() + 1, prevEnd.getUTCDate() + 14));
  return { start: iso(today <= deadline ? prevStart : qs), today: iso(today) };
}

function parseJson(s, fallback) {
  try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; }
}
const round = (x, n = 6) => Math.round(x * 10 ** n) / 10 ** n;
const fmt = (x) => String(round(x, 3)).replace('.', ',');
const hashOf = (payload) => crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');

function config(settings) {
  return {
    enabled: settings.vamregEnabled === '1' || settings.vamregEnabled === 'true',
    env: settings.vamregEnvironment === 'prod' ? 'prod' : 'uat',
    apiKey: (settings.vamregApiKey || '').trim(),
    startDate: settings.vamregStartDate || null,
    declareIn: settings.vamregDeclareIn !== '0',
    speciesMap: { ...DEFAULT_SPECIES_MAP, ...parseJson(settings.vamregSpeciesMap, {}) },
    defaultProvider: settings.vamregDefaultProviderType || 'DIST_BE',
    defaultVet: (settings.vamregDefaultVetOrderNumber || '').trim().toUpperCase(),
  };
}

// ---------- calcul des déclarations attendues ----------
function productFields(m) {
  if (m.vamregProductType === 'FOREIGN') {
    const f = parseJson(m.vamregForeign, {});
    const missing = [];
    if (!f.foreignProductName) missing.push('nom du produit');
    if (!f.foreignMaNumber) missing.push('n° d\'AMM');
    if (!f.packSize) missing.push('taille du conditionnement');
    if (missing.length) return { error: `Produit étranger incomplet (${missing.join(', ')}) — fiche médicament.` };
    const out = {
      productType: 'FOREIGN',
      foreignProductName: f.foreignProductName,
      foreignMaNumber: f.foreignMaNumber,
      packSize: f.packSize,
    };
    if (f.foreignMaHolder) out.foreignMaHolder = f.foreignMaHolder;
    if (f.pharmaceuticalFormSporId) out.pharmaceuticalFormSporId = f.pharmaceuticalFormSporId;
    if (f.activeSubstanceStrengthUnits) out.activeSubstanceStrengthUnits = f.activeSubstanceStrengthUnits;
    return { fields: out };
  }
  if (!/^\d{7}$/.test(m.vamregCnk || '')) return { error: 'Code CNK manquant — fiche médicament.' };
  return { fields: { productType: 'BE', cnk: m.vamregCnk } };
}

function computeDesired(rawDb, settings, now = new Date()) {
  const cfg = config(settings);
  const win = declarationWindow(now);
  const from = cfg.startDate && cfg.startDate > win.start ? cfg.startDate : win.start;
  const desired = new Map(); // sourceKey -> { register, declDate, label, payload }
  const problems = new Map(); // sourceKey -> { register, declDate, label, error }
  const dateTime = (d) => `${d}T12:00:00.000Z`;

  if (cfg.declareIn) {
    const lots = rawDb.prepare(`
      SELECT l.id, l.lotNumber, l.purchaseDate, l.initialQuantityBaseUnit, l.vamregProviderType AS lotProvider,
        m.name, m.baseUnit, m.vamregProductType, m.vamregCnk, m.vamregForeign, m.vamregPackBaseUnits,
        m.vamregProviderType AS medProvider
      FROM medicine_lots l JOIN medicines m ON m.id = l.medicineId
      WHERE m.vamregDeclare = 1 AND l.purchaseDate >= ? AND l.purchaseDate <= ?
    `).all(from, win.today);
    for (const l of lots) {
      const key = `lot:${l.id}`;
      const date = String(l.purchaseDate).slice(0, 10);
      const pack = Number(l.vamregPackBaseUnits);
      const packs = pack > 0 ? Number(l.initialQuantityBaseUnit) / pack : NaN;
      const base = { register: 'IN', declDate: date, label: `Réception — ${l.name}, lot ${l.lotNumber}` };
      const p = productFields(l);
      let error = p.error;
      if (!error && !(pack > 0)) error = 'Contenu d\'un conditionnement manquant — fiche médicament.';
      if (!error && Math.abs(packs - Math.round(packs)) > 1e-6) {
        error = `Quantité reçue (${fmt(l.initialQuantityBaseUnit)} ${l.baseUnit}) ≠ nombre entier de conditionnements de ${fmt(pack)} ${l.baseUnit}.`;
      }
      if (error) { problems.set(key, { ...base, error }); continue; }
      base.label += ` — ${Math.round(packs)} cond.`;
      desired.set(key, {
        ...base,
        payload: {
          register: 'IN', dateTime: dateTime(date), ...p.fields,
          providerType: l.lotProvider || l.medProvider || cfg.defaultProvider,
          inQuantityPackCount: Math.round(packs),
        },
      });
    }
  }

  const items = rawDb.prepare(`
    SELECT ii.id, ii.description, ii.quantity, i.number, i.date, i.createdBy,
      p.name AS patientName, p.species,
      m.name, m.vamregProductType, m.vamregCnk, m.vamregForeign, m.vamregPackBaseUnits,
      (SELECT SUM(d.baseUnitsConsumed) FROM medicine_dispensings d WHERE d.invoiceItemId = ii.id) AS baseUnits,
      (SELECT d.prescribedBy FROM medicine_dispensings d WHERE d.invoiceItemId = ii.id LIMIT 1) AS vetId,
      su.quantityInBaseUnit
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoiceId
    JOIN medicines m ON m.id = ii.medicineId
    LEFT JOIN patients p ON p.id = COALESCE(ii.patientId, i.patientId)
    LEFT JOIN medicine_sale_units su ON su.id = ii.saleUnitId
    WHERE ii.kind = 'product' AND m.vamregDeclare = 1 AND i.status IN ('sent', 'paid')
      AND i.date >= ? AND i.date <= ?
  `).all(from, win.today + 'T99');
  const vetNumber = rawDb.prepare('SELECT vetOrderNumber FROM users WHERE id = ?');
  for (const it of items) {
    const species = cfg.speciesMap[it.species] || '';
    if (!species) continue; // espèce non déclarée dans ce cabinet
    const key = `item:${it.id}`;
    const date = String(it.date).slice(0, 10);
    const base = {
      register: 'OUT', declDate: date,
      label: `Facture ${it.number} — ${it.patientName || '?'} (${it.species}) — ${it.name}`,
    };
    const p = productFields(it);
    const pack = Number(it.vamregPackBaseUnits);
    const units = it.baseUnits != null ? Number(it.baseUnits) : Number(it.quantity) * Number(it.quantityInBaseUnit || 0);
    const vet = ((it.vetId && (vetNumber.get(it.vetId) || {}).vetOrderNumber)
      || (it.createdBy && (vetNumber.get(it.createdBy) || {}).vetOrderNumber)
      || cfg.defaultVet || '').toUpperCase();
    let error = p.error;
    if (!error && !(pack > 0)) error = 'Contenu d\'un conditionnement manquant — fiche médicament.';
    if (!error && !(units > 0)) error = 'Quantité délivrée inconnue.';
    if (!error && !/^[01NF]\d{4}$/.test(vet)) error = 'N° d\'Ordre du vétérinaire manquant (Utilisateurs ou Paramètres → VAMREG).';
    if (error) { problems.set(key, { ...base, error }); continue; }
    // ICD : 3 décimales au plus, entre 0,001 et 100 000.
    const packs = Math.max(0.001, round(units / pack, 3));
    base.label += ` — ${fmt(packs)} cond.`;
    desired.set(key, {
      ...base,
      payload: {
        register: 'OUT', dateTime: dateTime(date), ...p.fields,
        targetSpecies: species, veterinarianOrderNumber: vet,
        outQuantityType: 'PACKS', outQuantityPackCount: packs,
      },
    });
  }
  return { desired, problems, window: { ...win, from } };
}

// ---------- client HTTP ----------
async function call(cfg, method, path, body) {
  const res = await fetch(HOSTS[cfg.env] + path, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'FAMHP-SEC-KEY': cfg.apiKey,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function authMessage(status) {
  if (status === 401) return 'Clé API refusée par VAMREG (clé invalide, expirée ou d\'un autre environnement).';
  if (status === 403) return 'VAMREG refuse l\'accès : le compte lié à la clé n\'a pas le rôle « déclarant ».';
  return null;
}
const errorsText = (errs) => (Array.isArray(errs) ? errs : [errs])
  .map((e) => (e && e.englishMessage) ? `${String(e.field || '').replace(/^declarations\[\d+\]\.?/, '') || 'déclaration'} : ${e.englishMessage}` : String(e))
  .join(' ; ').slice(0, 1000);

// ---------- moteur ----------
function createVamreg({ db, log = console }) {
  const raw = db.db;
  let running = false;
  let again = false;
  let timer = null;
  let lastResult = null;
  const refCache = new Map(); // `${env}:${name}` -> { at, data }

  const now = () => new Date().toISOString();
  const upsert = raw.prepare(`
    INSERT INTO vamreg_declarations (id, sourceKey, register, declDate, label, payload, payloadHash, vamregId, environment, status, lastError, attempts, createdAt, updatedAt, sentAt)
    VALUES (@id, @sourceKey, @register, @declDate, @label, @payload, @payloadHash, @vamregId, @environment, @status, @lastError, @attempts, @createdAt, @updatedAt, @sentAt)
    ON CONFLICT(sourceKey) DO UPDATE SET register=excluded.register, declDate=excluded.declDate, label=excluded.label,
      payload=excluded.payload, payloadHash=excluded.payloadHash, vamregId=excluded.vamregId, environment=excluded.environment,
      status=excluded.status, lastError=excluded.lastError, attempts=excluded.attempts, updatedAt=excluded.updatedAt, sentAt=excluded.sentAt
  `);
  function save(row, patch) {
    const t = now();
    const r = {
      id: crypto.randomUUID(), payload: null, payloadHash: null, vamregId: null, lastError: null,
      attempts: 0, sentAt: null, createdAt: t, ...row, ...patch, updatedAt: t,
    };
    upsert.run(r);
  }

  async function sync({ force = false } = {}) {
    const settings = db.getSettings();
    const cfg = config(settings);
    if (!cfg.enabled) return { skipped: 'Module VAMREG désactivé.' };
    if (!cfg.apiKey) return { skipped: 'Clé API VAMREG manquante (Paramètres → VAMREG).' };
    if (running) { again = true; return { skipped: 'Synchronisation déjà en cours.' }; }
    // Retour au test après des envois en production : on garde la trace des
    // déclarations réelles (sinon elles seraient renvoyées en double au retour
    // en production) et on n'envoie rien.
    if (cfg.env === 'uat' && raw.prepare("SELECT 1 FROM vamreg_declarations WHERE environment = 'prod' AND vamregId IS NOT NULL LIMIT 1").get()) {
      return (lastResult = { skipped: 'Des déclarations ont déjà été envoyées en production : repassez l\'environnement sur « Production ».', at: now() });
    }
    running = true;
    const result = { created: 0, updated: 0, deleted: 0, errors: 0, at: now(), env: cfg.env };
    try {
      // Passage du test à la production : les essais de test n'ont plus de sens ici.
      if (cfg.env === 'prod') raw.prepare("DELETE FROM vamreg_declarations WHERE environment IS NOT NULL AND environment != 'prod'").run();
      const { desired, problems, window } = computeDesired(raw, settings);
      const stored = new Map(raw.prepare('SELECT * FROM vamreg_declarations').all().map((r) => [r.sourceKey, r]));
      const toCreate = [];
      const toUpdate = [];
      const toDelete = [];

      for (const [key, d] of desired) {
        const row = stored.get(key);
        const payloadHash = hashOf(d.payload);
        const rec = { ...(row || {}), sourceKey: key, register: d.register, declDate: d.declDate, label: d.label, environment: cfg.env };
        if (!row || !row.vamregId) {
          // Déjà refusée par VAMREG telle quelle : on attend une correction
          // (ou « Envoyer maintenant ») au lieu de la renvoyer toutes les 15 min.
          if (!force && row && row.status === 'error' && row.payloadHash === payloadHash) continue;
          toCreate.push({ rec, d, payloadHash });
        }
        else if (row.payloadHash !== payloadHash || (force && row.status === 'error')) toUpdate.push({ rec, d, payloadHash });
        else if (row.status !== 'sent' || row.label !== d.label) save(rec, { status: 'sent', lastError: null });
      }
      for (const [key, p] of problems) {
        const row = stored.get(key);
        save({ ...(row || {}), sourceKey: key, register: p.register, declDate: p.declDate, label: p.label, environment: cfg.env },
          { status: 'error', lastError: p.error });
        result.errors++;
      }
      for (const [key, row] of stored) {
        if (desired.has(key) || problems.has(key)) continue;
        if (!row.vamregId) { raw.prepare('DELETE FROM vamreg_declarations WHERE id = ?').run(row.id); continue; }
        if (row.declDate && row.declDate < window.start) {
          if (row.status !== 'locked') save(row, { status: 'locked', lastError: 'Supprimée dans Colveto, mais le trimestre est clos chez VAMREG.' });
          continue;
        }
        toDelete.push(row);
      }

      // Créations, par paquets. En cas de refus (400), VAMREG rejette tout le
      // paquet : on marque les lignes fautives et on renvoie les autres.
      for (let i = 0; i < toCreate.length; i += BATCH) {
        let chunk = toCreate.slice(i, i + BATCH);
        for (let pass = 0; pass < 2 && chunk.length; pass++) {
          const r = await call(cfg, 'POST', '/declaration', chunk.map((c) => c.d.payload));
          const auth = authMessage(r.status);
          if (auth) throw Object.assign(new Error(auth), { fatal: true });
          if (r.status === 200 && Array.isArray(r.data)) {
            chunk.forEach((c, k) => {
              save(c.rec, { payload: JSON.stringify(c.d.payload), payloadHash: c.payloadHash, vamregId: (r.data[k] || {}).id || null,
                status: 'sent', lastError: null, sentAt: now() });
              result.created++;
            });
            chunk = [];
          } else if (r.status === 400 && Array.isArray(r.data)) {
            const bad = new Map();
            for (const e of r.data) {
              const m = /^declarations\[(\d+)\]/.exec(e.field || '');
              const k = m ? Number(m[1]) : 0;
              bad.set(k, [...(bad.get(k) || []), e]);
            }
            chunk.forEach((c, k) => {
              if (!bad.has(k)) return;
              save(c.rec, { payload: JSON.stringify(c.d.payload), payloadHash: c.payloadHash, status: 'error',
                lastError: 'Refusée par VAMREG — ' + errorsText(bad.get(k)), attempts: (c.rec.attempts || 0) + 1 });
              result.errors++;
            });
            chunk = chunk.filter((_, k) => !bad.has(k));
          } else {
            chunk.forEach((c) => {
              save(c.rec, { payload: JSON.stringify(c.d.payload), payloadHash: c.payloadHash, status: 'pending',
                lastError: `VAMREG indisponible (HTTP ${r.status}) — nouvel essai plus tard.`, attempts: (c.rec.attempts || 0) + 1 });
              result.errors++;
            });
            chunk = [];
          }
        }
      }

      for (const u of toUpdate) {
        if (u.d.declDate < window.start || (u.rec.declDate && u.rec.declDate < window.start)) {
          save(u.rec, { status: 'locked', lastError: 'Modifiée dans Colveto, mais le trimestre est clos chez VAMREG.' });
          continue;
        }
        const r = await call(cfg, 'PUT', `/declaration/${u.rec.vamregId}`, { ...u.d.payload, id: u.rec.vamregId });
        const auth = authMessage(r.status);
        if (auth) throw Object.assign(new Error(auth), { fatal: true });
        if (r.status === 200) {
          save(u.rec, { payload: JSON.stringify(u.d.payload), payloadHash: u.payloadHash, status: 'sent', lastError: null, sentAt: now() });
          result.updated++;
        } else if (r.status === 404) {
          // Inconnue chez VAMREG (supprimée à la main ?) : elle sera recréée au prochain passage.
          save(u.rec, { vamregId: null, status: 'pending', lastError: 'Introuvable chez VAMREG — sera renvoyée.' });
          again = true;
        } else {
          save(u.rec, { status: 'error', lastError: (r.status === 400 ? 'Modification refusée par VAMREG — ' + errorsText(r.data) : `VAMREG indisponible (HTTP ${r.status}).`),
            attempts: (u.rec.attempts || 0) + 1 });
          result.errors++;
        }
      }

      for (const row of toDelete) {
        const r = await call(cfg, 'DELETE', `/declaration/${row.vamregId}`);
        const auth = authMessage(r.status);
        if (auth) throw Object.assign(new Error(auth), { fatal: true });
        if (r.status === 200 || r.status === 204 || r.status === 404) {
          raw.prepare('DELETE FROM vamreg_declarations WHERE id = ?').run(row.id);
          result.deleted++;
        } else {
          save(row, { status: 'error', lastError: `Suppression refusée par VAMREG (HTTP ${r.status}) — ${errorsText(r.data)}`, attempts: (row.attempts || 0) + 1 });
          result.errors++;
        }
      }
    } catch (e) {
      result.fatal = e.fatal ? e.message : `VAMREG injoignable : ${e.message}`;
      log.warn && log.warn('[vamreg]', result.fatal);
    } finally {
      running = false;
      lastResult = result;
      if (again) { again = false; schedule(); }
    }
    return result;
  }

  // Appelé après chaque modification de lot, facture ou médicament.
  function schedule(delayMs = 4000) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync().catch(() => {}); }, delayMs);
    if (timer.unref) timer.unref();
  }

  function status() {
    const cfg = config(db.getSettings());
    const counts = Object.fromEntries(raw.prepare('SELECT status, COUNT(*) AS n FROM vamreg_declarations GROUP BY status').all().map((r) => [r.status, r.n]));
    const rows = raw.prepare(`
      SELECT id, sourceKey, register, declDate, label, vamregId, status, lastError, attempts, updatedAt, sentAt
      FROM vamreg_declarations
      ORDER BY CASE status WHEN 'error' THEN 0 WHEN 'pending' THEN 1 WHEN 'locked' THEN 2 ELSE 3 END, declDate DESC, updatedAt DESC
      LIMIT 500
    `).all();
    return { enabled: cfg.enabled, env: cfg.env, hasKey: !!cfg.apiKey, window: declarationWindow(), counts, rows, lastResult, running };
  }

  async function testConnection() {
    const cfg = config(db.getSettings());
    if (!cfg.apiKey) return { ok: false, message: 'Aucune clé API enregistrée.' };
    try {
      const r = await call(cfg, 'GET', '/provider-type');
      if (r.status === 200) return { ok: true, message: `Connexion à VAMREG (${cfg.env === 'prod' ? 'production' : 'test'}) réussie.` };
      return { ok: false, message: authMessage(r.status) || `Réponse inattendue de VAMREG (HTTP ${r.status}).` };
    } catch (e) {
      return { ok: false, message: 'VAMREG injoignable : ' + e.message };
    }
  }

  // Listes de référence (médicaments BE, espèces…), mises en cache 12 h.
  async function referenceList(name) {
    if (!REF_LISTS.has(name)) throw Object.assign(new Error('Liste inconnue.'), { status: 404 });
    const cfg = config(db.getSettings());
    if (!cfg.apiKey) throw Object.assign(new Error('Clé API VAMREG manquante (Paramètres → VAMREG).'), { status: 400 });
    const k = `${cfg.env}:${name}`;
    const hit = refCache.get(k);
    if (hit && Date.now() - hit.at < 12 * 3600 * 1000) return hit.data;
    const r = await call(cfg, 'GET', '/' + name);
    if (r.status !== 200 || !Array.isArray(r.data)) {
      throw Object.assign(new Error(authMessage(r.status) || `VAMREG : liste indisponible (HTTP ${r.status}).`), { status: 502 });
    }
    const data = r.data.filter((x) => !x.deprecated);
    refCache.set(k, { at: Date.now(), data });
    return data;
  }

  // Passage régulier : rattrape les envois en échec et les jours de VAMREG indisponible.
  const interval = setInterval(() => { sync().catch(() => {}); }, 15 * 60 * 1000);
  if (interval.unref) interval.unref();
  schedule(30000);

  return { sync, schedule, status, testConnection, referenceList };
}

module.exports = { createVamreg, computeDesired, declarationWindow, DEFAULT_SPECIES_MAP };
