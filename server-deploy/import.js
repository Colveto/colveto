// Import des clients et des animaux depuis l'export d'un autre logiciel
// vétérinaire (Excel .xlsx ou CSV/TXT), quel qu'il soit.
//
// 1. parseFile()      lit le fichier : encodage (UTF-8, UTF-16, Windows-1252),
//                     séparateur (; , tabulation |), guillemets, Excel.
// 2. suggestMapping() devine à quel champ Colveto correspond chaque colonne.
// 3. runImport()      normalise les valeurs (espèces, sexes, dates…), évite
//                     les doublons et crée les fiches. En mode « essai »
//                     (dryRun) tout est annulé à la fin : l'aperçu montre
//                     exactement ce que ferait le vrai import.
// 4. undoBatch()      annule un import (fiches créées par lui uniquement).
//
// Les fiches déjà présentes ne sont JAMAIS modifiées.

const { randomUUID } = require('crypto');

// ---------------------------------------------------------------------------
// Champs cibles
// ---------------------------------------------------------------------------
const FIELDS = {
  ownerRef: { group: 'client', label: 'N° / code client' },
  ownerFullName: { group: 'client', label: 'Nom complet du client (nom + prénom)' },
  ownerLastName: { group: 'client', label: 'Nom du client' },
  ownerFirstName: { group: 'client', label: 'Prénom du client' },
  ownerEmail: { group: 'client', label: 'Email' },
  ownerPhone: { group: 'client', label: 'Téléphone' },
  ownerPhone2: { group: 'client', label: 'Téléphone 2 (portable…)' },
  ownerAddress: { group: 'client', label: 'Adresse' },
  ownerAddress2: { group: 'client', label: "Complément d'adresse" },
  ownerPostalCode: { group: 'client', label: 'Code postal' },
  ownerCity: { group: 'client', label: 'Ville' },
  ownerCountry: { group: 'client', label: 'Pays' },
  ownerNotes: { group: 'client', label: 'Remarques client' },
  patientRef: { group: 'animal', label: 'N° / code animal' },
  patientName: { group: 'animal', label: "Nom de l'animal" },
  patientSpecies: { group: 'animal', label: 'Espèce' },
  patientBreed: { group: 'animal', label: 'Race' },
  patientSex: { group: 'animal', label: 'Sexe' },
  patientSterilized: { group: 'animal', label: 'Stérilisé / castré' },
  patientBirthDate: { group: 'animal', label: 'Date de naissance' },
  patientMicrochip: { group: 'animal', label: 'N° de puce / identification' },
  patientColor: { group: 'animal', label: 'Robe / couleur' },
  patientWeight: { group: 'animal', label: 'Poids' },
  patientDeceased: { group: 'animal', label: 'Décédé' },
  patientAllergies: { group: 'animal', label: 'Allergies' },
  patientNotes: { group: 'animal', label: 'Remarques animal' },
};

// Intitulés de colonnes connus (FR, EN, DE, NL), comparés sans accents ni
// ponctuation. L'ordre compte : le premier champ qui reconnaît gagne.
// Colonnes sans intérêt pour Colveto : ignorées d'office (pas recopiées en notes).
const IGNORED = ['civilite', 'titre', 'title', 'salutation', 'anrede', 'aanhef', 'politesse', 'formule de politesse'];

const SYNONYMS = [
  ['ownerRef', ['code client', 'n client', 'no client', 'num client', 'numero client', 'id client', 'client id', 'ref client', 'reference client', 'customer id', 'client no', 'client number', 'clientnr', 'kundennummer', 'kunden nr', 'klantnummer', 'klant nr', 'id proprietaire', 'code proprietaire', 'n proprietaire', 'owner id']],
  ['patientRef', ['code animal', 'n animal', 'no animal', 'id animal', 'numero animal', 'ref animal', 'patient id', 'animal id', 'pet id', 'tiernummer', 'dier nr', 'diernummer', 'n patient', 'code patient']],
  ['patientName', ['nom animal', 'nom de l animal', 'animal', 'nom patient', 'patient', 'pet name', 'animal name', 'patient name', 'pet', 'tiername', 'tier', 'naam dier', 'diernaam', 'dier', 'nom du patient']],
  ['patientSpecies', ['espece', 'especes', 'species', 'tierart', 'art', 'diersoort', 'soort', 'type animal', 'type d animal']],
  ['patientBreed', ['race', 'breed', 'rasse', 'ras']],
  ['patientSex', ['sexe', 'sex', 'gender', 'geschlecht', 'geslacht', 'genre']],
  ['patientSterilized', ['sterilise', 'sterilisee', 'castre', 'castree', 'sterilisation', 'castration', 'neutered', 'spayed', 'kastriert', 'gecastreerd', 'gesteriliseerd', 'sterilized', 'neutre']],
  ['patientBirthDate', ['date de naissance', 'naissance', 'ne le', 'nee le', 'date naissance', 'birth date', 'birthdate', 'date of birth', 'dob', 'geburtsdatum', 'geboortedatum', 'geboren']],
  ['patientMicrochip', ['puce', 'n puce', 'numero de puce', 'transpondeur', 'identification', 'n identification', 'microchip', 'chip', 'chip number', 'transponder', 'chipnummer', 'mikrochip', 'id electronique', 'identifiant electronique']],
  ['patientColor', ['robe', 'couleur', 'color', 'colour', 'farbe', 'kleur', 'pelage']],
  ['patientWeight', ['poids', 'weight', 'gewicht', 'poids kg']],
  ['patientDeceased', ['decede', 'decedee', 'deces', 'mort', 'deceased', 'dead', 'verstorben', 'overleden', 'date de deces']],
  ['patientAllergies', ['allergies', 'allergie', 'allergy', 'allergien', 'allergieen']],
  ['patientNotes', ['remarques animal', 'notes animal', 'commentaire animal', 'observations animal', 'antecedents']],
  ['ownerFullName', ['nom complet', 'nom prenom', 'nom et prenom', 'client', 'proprietaire', 'nom du proprietaire', 'nom client', 'owner', 'owner name', 'customer', 'customer name', 'full name', 'besitzer', 'kunde', 'eigenaar', 'klant', 'naam eigenaar', 'nom du client']],
  ['ownerLastName', ['nom', 'nom de famille', 'last name', 'lastname', 'surname', 'family name', 'nachname', 'familienname', 'achternaam', 'naam', 'name']],
  ['ownerFirstName', ['prenom', 'first name', 'firstname', 'given name', 'vorname', 'voornaam']],
  ['ownerEmail', ['email', 'e mail', 'mail', 'courriel', 'adresse email', 'adresse mail', 'email address']],
  ['ownerPhone2', ['gsm', 'portable', 'mobile', 'tel portable', 'telephone portable', 'cellulaire', 'handy', 'mobiel', 'cell', 'cell phone', 'tel 2', 'telephone 2']],
  ['ownerPhone', ['telephone', 'tel', 'phone', 'tel fixe', 'telephone fixe', 'tel domicile', 'telefon', 'telefoon', 'phone number', 'tel 1', 'telephone 1']],
  ['ownerAddress2', ['complement', 'complement d adresse', 'adresse 2', 'address 2', 'address line 2']],
  ['ownerAddress', ['adresse', 'rue', 'address', 'street', 'strasse', 'straat', 'adres', 'adresse 1', 'address line 1', 'voie']],
  ['ownerPostalCode', ['code postal', 'cp', 'postal code', 'zip', 'zip code', 'postcode', 'plz', 'postleitzahl', 'npa']],
  ['ownerCity', ['ville', 'localite', 'commune', 'city', 'town', 'ort', 'stadt', 'plaats', 'gemeente', 'woonplaats']],
  ['ownerCountry', ['pays', 'country', 'land']],
  ['ownerNotes', ['remarques client', 'notes client', 'commentaire client', 'observations client', 'remarques', 'notes', 'commentaire', 'commentaires', 'observations', 'remarks', 'comments', 'bemerkungen', 'opmerkingen']],
];

const norm = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function suggestMapping(headers) {
  const used = new Set();
  return headers.map((h) => {
    const n = norm(h);
    if (IGNORED.includes(n)) return '-';
    for (const [field, words] of SYNONYMS) {
      if (used.has(field)) continue;
      if (words.some((w) => n === w)) { used.add(field); return field; }
    }
    // Correspondance partielle (« Nom du client » → ownerLastName…), plus prudente.
    for (const [field, words] of SYNONYMS) {
      if (used.has(field)) continue;
      if (words.some((w) => w.length >= 4 && (n.startsWith(w + ' ') || n.endsWith(' ' + w)))) {
        used.add(field); return field;
      }
    }
    return '';
  });
}

// ---------------------------------------------------------------------------
// Lecture du fichier
// ---------------------------------------------------------------------------
function decodeText(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return new TextDecoder('utf-8').decode(buf.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Exports des logiciels Windows anciens : Windows-1252 (≈ Latin-1).
    return new TextDecoder('windows-1252').decode(buf);
  }
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ';'; let bestScore = -1;
  for (const d of [';', ',', '\t', '|']) {
    const counts = sample.map((l) => {
      let n = 0; let q = false;
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      return n;
    });
    const nonZero = counts.filter((c) => c > 0);
    if (!nonZero.length) continue;
    // Le bon séparateur apparaît souvent ET le même nombre de fois par ligne.
    const mode = nonZero.sort((a, b) => nonZero.filter((v) => v === b).length - nonZero.filter((v) => v === a).length)[0];
    const score = nonZero.filter((c) => c === mode).length * 10 + mode;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

function parseCsv(text) {
  const d = detectDelimiter(text);
  const rows = [];
  let row = []; let field = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      q = true;
    } else if (ch === d) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return { rows, delimiter: d };
}

function cellText(v) {
  if (v == null) return '';
  if (v instanceof Date) {
    if (isNaN(v)) return '';
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return cellText(v.result);
    if ('text' in v) return String(v.text);
    if ('error' in v) return '';
    return '';
  }
  return String(v);
}

async function parseXlsx(buf) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  // Premier onglet qui contient des données.
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0) || wb.worksheets[0];
  if (!ws) return { rows: [] };
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = [];
    for (let c = 1; c <= r.cellCount; c++) vals.push(cellText(r.getCell(c).value).trim());
    rows.push(vals);
  });
  return { rows, sheet: ws.name };
}

const MAX_ROWS = 100000;

async function parseFile(buf, fileName = '') {
  const ext = (fileName.split('.').pop() || '').toLowerCase();
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // .xlsx = archive zip
  const isOle = buf[0] === 0xd0 && buf[1] === 0xcf; // ancien .xls binaire
  if (isOle || ext === 'xls') {
    const e = new Error("Ancien format Excel (.xls) : ouvrez le fichier dans Excel ou LibreOffice, puis « Enregistrer sous » au format .xlsx ou CSV, et importez ce nouveau fichier.");
    e.status = 400; throw e;
  }
  if (ext === 'ods' || ext === 'numbers') {
    const e = new Error('Format non pris en charge : enregistrez le fichier au format .xlsx ou CSV.');
    e.status = 400; throw e;
  }
  let parsed;
  if (isZip || ext === 'xlsx') parsed = await parseXlsx(buf);
  else parsed = parseCsv(decodeText(buf));

  // Lignes vides retirées ; la première ligne non vide = intitulés.
  let rows = parsed.rows
    .map((r) => r.map((c) => String(c == null ? '' : c).trim()))
    .filter((r) => r.some((c) => c !== ''));
  if (rows.length < 2) {
    const e = new Error('Le fichier ne contient pas de données (il faut une ligne d’intitulés puis au moins une ligne).');
    e.status = 400; throw e;
  }
  const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
  let headers = rows[0].slice(0, width);
  while (headers.length < width) headers.push('');
  headers = headers.map((h, i) => h || `Colonne ${i + 1}`);
  rows = rows.slice(1, MAX_ROWS + 1).map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
  return { headers, rows, delimiter: parsed.delimiter || null, sheet: parsed.sheet || null };
}

// ---------------------------------------------------------------------------
// Normalisation des valeurs
// ---------------------------------------------------------------------------
const SPECIES_RULES = [
  ['Chien', /\b(chien|chienne|canin|canine|canis|dog|hund|hond|cn|chiot|puppy)\b/],
  ['Chat', /\b(chat|chatte|felin|feline|felis|cat|katze|kater|kat|chaton|kitten|ct)\b/],
  ['Lapin', /\b(lapin|lapine|rabbit|kaninchen|konijn|oryctolagus)\b/],
  ['Cheval', /\b(cheval|jument|etalon|equin|equine|equide|horse|pferd|paard|poney|pony|ane|anesse|mule|donkey)\b/],
  ['Oiseau', /\b(oiseau|bird|vogel|perroquet|perruche|canari|poule|coq|pigeon|ara|cacatoes|calopsitte|parrot|budgie)\b/],
  ['Reptile', /\b(reptile|tortue|serpent|lezard|gecko|python|iguane|pogona|dragon|turtle|tortoise|snake|lizard|schildkrote|schildpad)\b/],
  ['NAC', /\b(nac|furet|ferret|cobaye|cochon d inde|guinea|hamster|rat|souris|mouse|gerbille|chinchilla|octodon|degu|rongeur|rodent|frettchen|meerschweinchen|cavia)\b/],
];
function normSpecies(v) {
  const n = norm(v);
  if (!n) return { value: 'Autre', note: null };
  for (const [s, re] of SPECIES_RULES) if (re.test(n)) return { value: s, note: null };
  if (n === 'c') return { value: 'Chien', note: null };
  if (n === 'f' || n === 'ch') return { value: 'Chat', note: null };
  return { value: 'Autre', note: `Espèce d'origine : ${String(v).trim()}` };
}

const STERIL_RE = /(cast|ster|neut|spay|kastr|gecast|gester|\bmc\b|\bfc\b|\bfs\b|\bmn\b|\bfn\b|\bmk\b|\bwk\b)/;
function normSex(v) {
  const n = norm(v);
  if (!n) return { sex: null, sterilized: false };
  const sterilized = STERIL_RE.test(n);
  let sex = null;
  if (/^(m|male|mal|masculin|mannlich|maennlich|man|mannetje|reu|rude|kater|hengst|etalon|mc|mn|mk)\b/.test(n) || /\bmale\b/.test(n)) sex = 'M';
  if (/^(f|fem|femelle|female|feminin|w|weiblich|wk|v|vrouwelijk|vrouw|teef|poes|fc|fs|fn|fe)\b/.test(n) || /\bfemelle\b|\bfemale\b/.test(n)) sex = 'F';
  return { sex, sterilized };
}

function yes(v) {
  const n = norm(v);
  if (!n) return false;
  if (/^(non|no|nein|nee|n|0|faux|false|f)$/.test(n)) return false;
  return true; // oui / yes / x / 1 / une date de décès…
}

function pad(n) { return String(n).padStart(2, '0'); }
function validYmd(y, m, d) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
function normDate(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return { value: null, bad: false };
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) {
    const r = validYmd(+m[1], +m[2], +m[3]); return { value: r, bad: !r };
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) {
    let a = +m[1]; let b = +m[2]; let y = +m[3];
    if (m[3].length === 2) { const now = new Date().getFullYear() % 100; y += y > now ? 1900 : 2000; }
    // Format européen (jour/mois) par défaut ; mois/jour seulement si évident.
    let d = a; let mo = b;
    if (b > 12 && a <= 12) { d = b; mo = a; }
    const r = validYmd(y, mo, d); return { value: r, bad: !r };
  }
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) { // mois/année
    const r = validYmd(+m[2], +m[1], 1); return { value: r, bad: !r };
  }
  if ((m = s.match(/^(\d{4})$/))) { // année seule
    const r = validYmd(+m[1], 1, 1); return { value: r, bad: !r };
  }
  if (/^\d{5}(\.\d+)?$/.test(s)) { // numéro de série Excel
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 86400000);
    const r = validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()); return { value: r, bad: !r };
  }
  return { value: null, bad: true };
}

function normWeight(v) {
  const m = String(v == null ? '' : v).replace(',', '.').match(/(\d+(\.\d+)?)/);
  if (!m) return null;
  let w = parseFloat(m[1]);
  if (/\bg\b|gr|gramm/i.test(String(v)) && !/kg/i.test(String(v))) w /= 1000;
  return w > 0 && w < 2000 ? Math.round(w * 100) / 100 : null;
}

const CIVILITY = /^(m|mr|mrs|ms|mme|mlle|melle|mmes|messieurs|monsieur|madame|mademoiselle|dr|docteur|prof|famille|fam|herr|frau|dhr|mevr|mevrouw|meneer|m et mme|mr et mme|m mme|mr mme)\.?\s+/i;
function cleanName(s) {
  let t = String(s || '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) t = t.replace(CIVILITY, '').trim();
  return t;
}
function splitFullName(full) {
  const t = cleanName(full);
  if (!t) return { lastName: '', firstName: '' };
  if (t.includes(',')) {
    const [a, ...b] = t.split(',');
    return { lastName: a.trim(), firstName: b.join(',').trim() };
  }
  const words = t.split(' ');
  if (words.length === 1) return { lastName: t, firstName: '' };
  const isUpper = (w) => /[A-ZÀ-Ý]/.test(w) && w === w.toUpperCase();
  const upper = words.filter(isUpper);
  if (upper.length && upper.length < words.length) {
    return { lastName: upper.join(' '), firstName: words.filter((w) => !isUpper(w)).join(' ') };
  }
  // Pas d'indice : convention la plus courante des exports « NOM Prénom ».
  return { lastName: words[0], firstName: words.slice(1).join(' ') };
}
function titleCaseIfAllCaps(s) {
  if (!s || s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-'’])(\p{L})/gu, (m, p, c) => p + c.toUpperCase());
}

const digits = (s) => String(s || '').replace(/\D/g, '');
function normEmail(v) {
  const s = String(v || '').trim().toLowerCase().split(/[;,\s]+/)[0] || '';
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
function ensureSchema(db) {
  for (const sql of [
    'ALTER TABLE owners ADD COLUMN importRef TEXT',
    'ALTER TABLE owners ADD COLUMN importBatch TEXT',
    'ALTER TABLE patients ADD COLUMN importRef TEXT',
    'ALTER TABLE patients ADD COLUMN importBatch TEXT',
  ]) { try { db.exec(sql); } catch { /* déjà là */ } }
  db.exec(`CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    fileName TEXT,
    createdAt TEXT NOT NULL,
    createdBy TEXT,
    ownersCreated INTEGER NOT NULL DEFAULT 0,
    patientsCreated INTEGER NOT NULL DEFAULT 0,
    report TEXT,
    undoneAt TEXT
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_owners_importRef ON owners(importRef)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_patients_importBatch ON patients(importBatch)');
}

class Rollback extends Error {}

function runImport(sqlite, { headers, rows, mapping, options = {}, dryRun = true, fileName = '', userId = null }) {
  ensureSchema(sqlite);
  const col = {};
  mapping.forEach((f, i) => { if (f && FIELDS[f] && col[f] === undefined) col[f] = i; });
  const get = (r, f) => (col[f] === undefined ? '' : String(r[col[f]] || '').trim());
  const hasOwnerIdentity = ['ownerLastName', 'ownerFullName', 'ownerFirstName'].some((f) => col[f] !== undefined);
  const hasOwnerRef = col.ownerRef !== undefined;
  const hasPatient = col.patientName !== undefined;
  if (!hasOwnerIdentity && !hasPatient) {
    const e = new Error("Associez au moins le nom du client ou le nom de l'animal à une colonne.");
    e.status = 400; throw e;
  }
  if (hasPatient && !hasOwnerIdentity && !hasOwnerRef) {
    const e = new Error("Pour importer des animaux, associez aussi le client : son nom, ou son n° de client (si les clients ont été importés avant).");
    e.status = 400; throw e;
  }
  const extraCols = options.unmappedToNotes === false ? [] : headers
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => !mapping[i]);

  const batchId = randomUUID();
  const now = new Date().toISOString();
  const report = {
    totalRows: rows.length, ownersCreated: 0, ownersExisting: 0,
    patientsCreated: 0, patientsExisting: 0, rowsSkipped: 0,
    warnings: [], errors: [], sample: [],
  };
  const warn = (line, msg) => { if (report.warnings.length < 200) report.warnings.push({ line, message: msg }); };
  const fail = (line, msg) => { report.rowsSkipped++; if (report.errors.length < 200) report.errors.push({ line, message: msg }); };

  // Index des clients existants pour éviter les doublons.
  const owners = sqlite.prepare('SELECT id, firstName, lastName, email, phone, postalCode, importRef FROM owners').all();
  const byRef = new Map(); const byEmail = new Map(); const byPhone = new Map(); const byName = new Map();
  const nameKey = (o) => `${norm(o.lastName)}|${norm(o.firstName)}|${norm(o.postalCode)}`;
  const createdHere = new Set(); // clients créés par CET import (plusieurs animaux)
  const matchedExisting = new Set(); // clients déjà dans Colveto, retrouvés
  const indexOwner = (o) => {
    if (o.importRef) byRef.set(String(o.importRef), o.id);
    if (o.email) byEmail.set(String(o.email).toLowerCase(), o.id);
    const p = digits(o.phone).slice(-8); if (p.length >= 8) byPhone.set(p, o.id);
    if (o.lastName) byName.set(nameKey(o), o.id);
  };
  owners.forEach(indexOwner);
  const patientKeys = new Set(sqlite.prepare('SELECT ownerId, name, microchipId FROM patients').all()
    .flatMap((p) => [`${p.ownerId}|${norm(p.name)}`, p.microchipId ? `chip|${digits(p.microchipId) || norm(p.microchipId)}` : null].filter(Boolean)));

  const insOwner = sqlite.prepare(`INSERT INTO owners (id, firstName, lastName, email, phone, address, city, postalCode, notes, createdAt, importRef, importBatch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insPatient = sqlite.prepare(`INSERT INTO patients (id, ownerId, name, species, breed, sex, birthDate, weight, color, microchipId, sterilized, allergies, notes, createdAt, importRef, importBatch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const work = () => {
    rows.forEach((r, idx) => {
      const line = idx + 2; // ligne dans le fichier (1 = intitulés)
      const extras = extraCols.map(({ h, i }) => (r[i] ? `${h} : ${r[i]}` : null)).filter(Boolean);

      // ----- Client -----
      let ownerId = null;
      let ownerLabel = '';
      const ref = get(r, 'ownerRef');
      let lastName = cleanName(get(r, 'ownerLastName'));
      let firstName = cleanName(get(r, 'ownerFirstName'));
      if (!lastName && get(r, 'ownerFullName')) ({ lastName, firstName } = splitFullName(get(r, 'ownerFullName')));
      if (!lastName && firstName) { lastName = firstName; firstName = ''; }
      lastName = titleCaseIfAllCaps(lastName); firstName = titleCaseIfAllCaps(firstName);
      const email = normEmail(get(r, 'ownerEmail'));
      if (get(r, 'ownerEmail') && !email) warn(line, `Email illisible ignoré : « ${get(r, 'ownerEmail')} »`);
      const phones = [get(r, 'ownerPhone'), get(r, 'ownerPhone2')].filter(Boolean);
      const phone = phones.join(' / ') || null;
      const postalCode = get(r, 'ownerPostalCode') || null;

      if (ref && byRef.has(ref)) ownerId = byRef.get(ref);
      if (!ownerId && lastName) {
        const p = digits(phones[0]).slice(-8);
        ownerId = (email && byEmail.get(email))
          || (p.length >= 8 && byPhone.get(p))
          || byName.get(nameKey({ lastName, firstName, postalCode }))
          || null;
        // Un n° de client fait foi : deux numéros différents = deux clients,
        // même s'ils partagent un email ou un téléphone (famille, couple).
        if (ownerId && ref && createdHere.has(ownerId)) ownerId = null;
      }
      if (ownerId) {
        if (!createdHere.has(ownerId)) matchedExisting.add(ownerId);
        if (ref && !byRef.has(ref)) byRef.set(ref, ownerId);
      } else if (lastName) {
        ownerId = randomUUID();
        const address = [get(r, 'ownerAddress'), get(r, 'ownerAddress2')].filter(Boolean).join(', ') || null;
        const city = [get(r, 'ownerCity'), get(r, 'ownerCountry')].filter(Boolean).join(', ') || null;
        const notes = [get(r, 'ownerNotes'), !hasPatient && extras.length ? extras.join('\n') : null]
          .filter(Boolean).join('\n') || null;
        insOwner.run(ownerId, firstName, lastName, email, phone, address, city, postalCode, notes, now, ref || null, batchId);
        indexOwner({ id: ownerId, firstName, lastName, email, phone, postalCode, importRef: ref || null });
        createdHere.add(ownerId);
        report.ownersCreated++;
      } else if (ref && hasPatient && !hasOwnerIdentity) {
        fail(line, `Client n° « ${ref} » introuvable : importez d'abord le fichier des clients.`);
        return;
      } else if (!hasPatient || get(r, 'patientName')) {
        fail(line, 'Nom du client manquant.');
        return;
      } else {
        report.rowsSkipped++;
        return;
      }
      ownerLabel = `${lastName} ${firstName}`.trim();

      // ----- Animal -----
      let patientInfo = null;
      if (hasPatient) {
        const name = titleCaseIfAllCaps(get(r, 'patientName').replace(/\s+/g, ' ').trim());
        if (!name) {
          if (report.sample.length < 20) report.sample.push({ line, owner: ownerLabel, patient: null });
          return;
        }
        const chipRaw = get(r, 'patientMicrochip').replace(/\s+/g, '');
        const chipKey = chipRaw ? `chip|${digits(chipRaw) || norm(chipRaw)}` : null;
        if (patientKeys.has(`${ownerId}|${norm(name)}`) || (chipKey && patientKeys.has(chipKey))) {
          report.patientsExisting++;
        } else {
          const sp = normSpecies(get(r, 'patientSpecies'));
          const sx = normSex(get(r, 'patientSex'));
          const steril = col.patientSterilized !== undefined ? yes(get(r, 'patientSterilized')) : sx.sterilized;
          const bd = normDate(get(r, 'patientBirthDate'));
          if (bd.bad) warn(line, `Date de naissance illisible ignorée : « ${get(r, 'patientBirthDate')} »`);
          const notes = [
            get(r, 'patientNotes') || null,
            sp.note,
            col.patientDeceased !== undefined && yes(get(r, 'patientDeceased'))
              ? `DÉCÉDÉ${/\d/.test(get(r, 'patientDeceased')) ? ` (${get(r, 'patientDeceased')})` : ''}` : null,
            ...extras,
          ].filter(Boolean).join('\n') || null;
          const id = randomUUID();
          insPatient.run(id, ownerId, name, sp.value, get(r, 'patientBreed') || null, sx.sex,
            bd.value, normWeight(get(r, 'patientWeight')), get(r, 'patientColor') || null,
            chipRaw || null, steril ? 1 : 0, get(r, 'patientAllergies') || null, notes, now,
            get(r, 'patientRef') || null, batchId);
          patientKeys.add(`${ownerId}|${norm(name)}`); if (chipKey) patientKeys.add(chipKey);
          report.patientsCreated++;
          patientInfo = { name, species: sp.value, sex: sx.sex, sterilized: steril, birthDate: bd.value, microchip: chipRaw || null };
        }
      }
      if (report.sample.length < 20) report.sample.push({ line, owner: ownerLabel, email, phone, patient: patientInfo });
    });
    report.ownersExisting = matchedExisting.size;
    if (dryRun) throw new Rollback();
    sqlite.prepare(`INSERT INTO import_batches (id, fileName, createdAt, createdBy, ownersCreated, patientsCreated, report)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(batchId, fileName, now, userId, report.ownersCreated, report.patientsCreated,
      JSON.stringify({ ...report, sample: undefined }));
  };

  try {
    sqlite.transaction(work)();
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  }
  report.batchId = dryRun ? null : batchId;
  report.dryRun = dryRun;
  return report;
}

function listBatches(sqlite) {
  ensureSchema(sqlite);
  return sqlite.prepare('SELECT id, fileName, createdAt, ownersCreated, patientsCreated, undoneAt FROM import_batches ORDER BY createdAt DESC LIMIT 50').all();
}

// Supprime les fiches créées par cet import. Une fiche déjà utilisée depuis
// (facture, rendez-vous, dossier…) est conservée et signalée.
function undoBatch(sqlite, batchId) {
  ensureSchema(sqlite);
  const batch = sqlite.prepare('SELECT * FROM import_batches WHERE id = ?').get(batchId);
  if (!batch) { const e = new Error('Import introuvable.'); e.status = 404; throw e; }
  if (batch.undoneAt) { const e = new Error('Cet import a déjà été annulé.'); e.status = 400; throw e; }
  const kept = { patients: 0, owners: 0 };
  let removedPatients = 0; let removedOwners = 0;
  const tryDelete = (sql, id) => {
    const sp = `sp_${id.replace(/-/g, '')}`;
    sqlite.exec(`SAVEPOINT ${sp}`);
    try {
      const n = sqlite.prepare(sql).run(id).changes;
      sqlite.exec(`RELEASE ${sp}`);
      return n;
    } catch {
      sqlite.exec(`ROLLBACK TO ${sp}`); sqlite.exec(`RELEASE ${sp}`);
      return -1;
    }
  };
  const used = (table, column, id) => {
    try { return !!sqlite.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? LIMIT 1`).get(id); } catch { return false; }
  };
  sqlite.transaction(() => {
    for (const { id } of sqlite.prepare('SELECT id FROM patients WHERE importBatch = ?').all(batchId)) {
      const inUse = ['medical_records', 'appointments', 'invoices', 'quotes', 'lab_results', 'attachments', 'follow_up_reminders', 'medicine_dispensings']
        .some((t) => used(t, 'patientId', id));
      if (inUse || tryDelete('DELETE FROM patients WHERE id = ?', id) < 0) kept.patients++; else removedPatients++;
    }
    for (const { id } of sqlite.prepare('SELECT id FROM owners WHERE importBatch = ?').all(batchId)) {
      const inUse = used('patients', 'ownerId', id)
        || ['appointments', 'invoices', 'quotes'].some((t) => used(t, 'ownerId', id));
      if (inUse || tryDelete('DELETE FROM owners WHERE id = ?', id) < 0) kept.owners++; else removedOwners++;
    }
    sqlite.prepare('UPDATE import_batches SET undoneAt = ? WHERE id = ?').run(new Date().toISOString(), batchId);
  })();
  return { removedPatients, removedOwners, kept };
}

module.exports = {
  FIELDS, parseFile, suggestMapping, runImport, listBatches, undoBatch,
  // exportés pour les tests
  _normSpecies: normSpecies, _normSex: normSex, _normDate: normDate, _splitFullName: splitFullName, _decodeText: decodeText, _parseCsv: parseCsv,
};
