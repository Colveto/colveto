import React from 'react';

// Conditions d'utilisation acceptées au premier démarrage (création du cabinet),
// puis une fois par l'administrateur sur les installations existantes.
// Changer TERMS_VERSION (ici ET dans server-deploy/server.js) redemande l'accord
// à l'administrateur au prochain démarrage.
export const TERMS_VERSION = '1';

export function TermsText() {
  return (
    <div style={{
      maxHeight: 260, overflowY: 'auto', fontSize: 13, lineHeight: 1.5,
      border: '1px solid var(--border, #e5e7eb)', borderRadius: 8,
      padding: '10px 14px', background: 'var(--bg-subtle, #f9fafb)', textAlign: 'left',
    }}>
      <p style={{ marginTop: 0 }}>
        <strong>Logiciel libre et gratuit.</strong> Colveto est distribué gratuitement sous licence
        libre GNU AGPL-3.0. Il n'y a ni vente, ni abonnement, ni contrat de service.
      </p>
      <p>
        <strong>Sans aucune garantie.</strong> Colveto est fourni « tel quel ». Ses auteurs ne garantissent
        ni son bon fonctionnement, ni son adaptation à votre activité, et ne peuvent être tenus
        responsables d'aucun dommage lié à son utilisation, y compris une perte de données ou une
        erreur de facturation, dans les limites prévues par la loi (articles 15 et 16 de la licence).
      </p>
      <p>
        <strong>Vos données restent chez vous.</strong> Elles sont enregistrées uniquement sur vos
        ordinateurs ou votre serveur, jamais chez les auteurs de Colveto. Votre cabinet est seul
        responsable de leur traitement au sens du RGPD, de leur sécurité et de leurs{' '}
        <strong>sauvegardes</strong>. Vérifiez régulièrement que les sauvegardes fonctionnent et
        conservez-en une copie hors du cabinet.
      </p>
      <p>
        <strong>Vos obligations légales restent les vôtres.</strong> Colveto vous aide, mais ne garantit
        pas la conformité de votre cabinet : facturation et mentions obligatoires, TVA et comptabilité,
        protection des données, tenue des registres de médicaments, déclarations d'utilisation
        d'antibiotiques auprès des autorités, etc. Contrôlez ce que le logiciel produit.
      </p>
      <p style={{ marginBottom: 0 }}>
        <strong>Support communautaire.</strong> L'aide est apportée bénévolement par la communauté
        (questions sur la page GitHub du projet), sans délai ni obligation de réponse.
      </p>
    </div>
  );
}

export function TermsCheckbox({ checked, onChange }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12, fontSize: 14, textAlign: 'left' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ marginTop: 3 }} />
      <span>J'ai lu ces conditions et je les accepte au nom du cabinet.</span>
    </label>
  );
}
