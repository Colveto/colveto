// Modèles de rapports : substitution des variables de la fiche et navigation
// au clavier entre les champs à compléter. Syntaxe décrite dans
// server-deploy/record-templates-seed.js.

export const TEMPLATE_VARIABLES = [
  { key: 'animal', label: 'nom de l\'animal' },
  { key: 'espece', label: 'espèce' },
  { key: 'race', label: 'race' },
  { key: 'sexe', label: 'sexe (et stérilisation)' },
  { key: 'age', label: 'âge' },
  { key: 'poids', label: 'dernier poids connu' },
  { key: 'date', label: 'date de l\'acte' },
];

function ageOf(birthDate) {
  if (!birthDate) return '';
  const years = (Date.now() - new Date(birthDate)) / (1000 * 60 * 60 * 24 * 365.25);
  if (isNaN(years) || years < 0) return '';
  return years >= 1 ? `${Math.floor(years)} an(s)` : `${Math.floor(years * 12)} mois`;
}

function sexOf(patient) {
  if (patient.sex === 'M') return patient.sterilized ? 'mâle castré' : 'mâle';
  if (patient.sex === 'F') return patient.sterilized ? 'femelle stérilisée' : 'femelle';
  return '';
}

export function templateVars(patient, { weight, date } = {}) {
  return {
    animal: patient?.name || '',
    espece: patient?.species || '',
    race: patient?.breed || '',
    sexe: patient ? sexOf(patient) : '',
    age: ageOf(patient?.birthDate),
    poids: weight != null && weight !== '' ? String(weight).replace('.', ',') : '',
    date: date ? new Date(date).toLocaleDateString('fr-FR') : '',
  };
}

// Remplace {{variable}} ; une valeur inconnue devient un champ [..] à compléter.
export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, key) =>
    (key in vars ? (vars[key] || '[..]') : m));
}

const PLACEHOLDER = /\[[^\]\n]*\]/g;

function placeholders(text) {
  return Array.from(String(text || '').matchAll(PLACEHOLDER), (m) => [m.index, m.index + m[0].length]);
}

export function firstPlaceholder(text) {
  return placeholders(text)[0] || null;
}

// onKeyDown d'un champ texte : Tab / Maj+Tab sélectionnent le champ [..]
// suivant / précédent. Quand ce champ n'en a plus dans cette direction, on
// enchaîne sur le premier (ou dernier) [..] du champ `next` (ou `prev`) ;
// à défaut, Tab garde son comportement normal.
export function placeholderTabHandler(e, { next, prev } = {}) {
  if (e.key !== 'Tab' || e.altKey || e.ctrlKey || e.metaKey) return;
  const el = e.currentTarget;
  const spans = placeholders(el.value);
  const target = e.shiftKey
    ? [...spans].reverse().find(([s]) => s < el.selectionStart)
    : spans.find(([s, end]) => s >= el.selectionEnd || (s >= el.selectionStart && end > el.selectionEnd));
  if (target) {
    e.preventDefault();
    el.setSelectionRange(target[0], target[1]);
    return;
  }
  const other = (e.shiftKey ? prev : next)?.current;
  const otherSpans = other ? placeholders(other.value) : [];
  if (!otherSpans.length) return;
  const span = e.shiftKey ? otherSpans[otherSpans.length - 1] : otherSpans[0];
  e.preventDefault();
  other.focus();
  other.setSelectionRange(span[0], span[1]);
}
