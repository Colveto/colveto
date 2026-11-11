# Colveto

**Logiciel libre et gratuit de gestion de cabinet vétérinaire.**
Un logiciel par un véto, pour des vétos.

Colveto est utilisé au quotidien dans un cabinet vétérinaire au Luxembourg. Il est publié
sous licence libre pour que d'autres cabinets puissent l'utiliser, l'adapter et l'améliorer.

## Fonctionnalités

- **Agenda** : rendez-vous, types de consultation, horaires, blocages
- **Prise de rendez-vous en ligne** pour vos clients, avec rappels, confirmation,
  annulation et report par email
- **Propriétaires et patients** : fiches, dossier médical, modèles de comptes rendus,
  pièces jointes (radios, photos, documents), impression PDF
- **Facturation** : devis, factures, TVA, modes de paiement, envoi par email,
  copie automatique à votre fiduciaire
- **Médicaments et stock** : lots, dates de péremption, délivrances, prix avec marge
- **Protocoles** de soins réutilisables
- **Résultats d'analyses de laboratoire** classés dans le dossier du patient
- **Portail vétérinaires référents** : formulaire d'adressage et suivi sécurisé du dossier
- **Rapports** et **export comptable** (FEC, CSV, Sage)
- **Sécurité** : comptes par rôle, double authentification (obligatoire pour l'administrateur),
  journal des connexions
- **Sauvegardes automatiques** et **export complet de vos données** (JSON / CSV),
  pour ne jamais être prisonnier du logiciel

## Installation

Voir **[INSTALL.md](INSTALL.md)** : installation sur un serveur (VPS) avec HTTPS automatique,
ou essai rapide sur votre ordinateur.

Pour publier la prise de rendez-vous en ligne et la relier au site du cabinet :
**[RENDEZ-VOUS-EN-LIGNE.md](RENDEZ-VOUS-EN-LIGNE.md)** (à transmettre à votre informaticien).

## ⚠️ À lire avant d'utiliser Colveto

Colveto est fourni **gratuitement, « en l'état », sans aucune garantie**
(voir la [licence](LICENSE)). En l'utilisant, vous acceptez que :

- **vous êtes seul responsable de vos données** : hébergement, sécurité, mises à jour et
  **sauvegardes**. Testez régulièrement la restauration de vos sauvegardes.
- **vous êtes seul responsable de votre conformité** : RGPD (vous êtes responsable du
  traitement des données de vos clients), obligations de facturation et de TVA,
  registre des médicaments, ordonnances, et toute autre règle applicable dans votre pays.
- les auteurs ne pourront être tenus responsables d'aucune perte de données, erreur de
  facturation ou autre dommage.

## Support

Le support est **uniquement communautaire**, via les tickets (issues) du dépôt :
questions, bugs, idées. Il n'y a ni hotline ni support par email.
Avant d'ouvrir un ticket, vérifiez qu'il n'existe pas déjà, et ne publiez **jamais**
de données de vos clients (noms, emails, captures d'écran non floutées).

**Faille de sécurité ?** Ouvrez un ticket en décrivant seulement le problème de façon
générale (sans procédure d'exploitation) ; un mainteneur vous recontactera.

## Contribuer

Les contributions sont bienvenues : voir [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

Colveto est distribué sous licence **GNU Affero General Public License v3.0 ou ultérieure**
(AGPL-3.0-or-later). Vous pouvez l'utiliser, le modifier et le redistribuer librement.
Si vous proposez une version modifiée de Colveto comme service en ligne, vous devez
publier vos modifications sous la même licence.
