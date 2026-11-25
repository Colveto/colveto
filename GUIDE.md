# Guide de Colveto — installer, paramétrer, utiliser

Ce guide accompagne un cabinet de A à Z, sans connaissances techniques. Comptez
**une heure** pour l'installation et le paramétrage complet, catalogue compris.

**Sommaire**

1. [Choisir son installation](#1-choisir-son-installation)
2. [Installer Colveto](#2-installer-colveto)
3. [Premier démarrage](#3-premier-démarrage)
4. [Compléter les paramètres](#4-compléter-les-paramètres)
5. [Préparer le catalogue](#5-préparer-le-catalogue)
6. [Ajouter l'équipe](#6-ajouter-léquipe)
7. [Reprendre les données de l'ancien logiciel](#7-reprendre-les-données-de-lancien-logiciel)
8. [Utiliser Colveto au quotidien](#8-utiliser-colveto-au-quotidien)
9. [Plusieurs ordinateurs dans le cabinet](#9-plusieurs-ordinateurs-dans-le-cabinet)
10. [Sauvegardes, sécurité et mises à jour](#10-sauvegardes-sécurité-et-mises-à-jour)
11. [Problèmes fréquents](#11-problèmes-fréquents)

---

## 1. Choisir son installation

| Votre cabinet | Ce qu'il faut faire |
|---|---|
| **Un seul ordinateur** | Installer Colveto sur cet ordinateur. C'est tout. |
| **Plusieurs ordinateurs** | Installer Colveto sur l'ordinateur **central** (celui qui reste allumé pendant les heures d'ouverture). Les autres postes s'y connectent : voir [chapitre 9](#9-plusieurs-ordinateurs-dans-le-cabinet). |
| **Accès depuis partout, prise de RDV 24 h/24** | Installer Colveto sur un serveur en ligne (VPS) : voir `INSTALL.md`, à confier de préférence à un informaticien. |

Dans tous les cas, **les données restent chez vous** : rien n'est envoyé aux auteurs
de Colveto.

---

## 2. Installer Colveto

1. Ouvrez la page **[github.com/Colveto/colveto/releases](https://github.com/Colveto/colveto/releases)**.
2. Dans la dernière version, rubrique *Assets*, téléchargez le fichier qui correspond à
   votre ordinateur :

| Ordinateur | Fichier |
|---|---|
| Windows | `Colveto-…-win-x64.exe` |
| Mac récent (puce Apple M1, M2, M3…) | `Colveto-…-mac-arm64.dmg` |
| Mac ancien (processeur Intel) | `Colveto-…-mac-x64.dmg` |

> **Quel Mac ai-je ?** Menu  → *À propos de ce Mac*. « Puce Apple M… » = fichier
> `arm64` ; « Processeur Intel » = fichier `x64`.

### Windows
Double-cliquez sur le fichier téléchargé. Si Windows affiche **« Windows a protégé
votre ordinateur »**, cliquez sur **Informations complémentaires**, puis
**Exécuter quand même**. Colveto s'installe et s'ouvre ; une icône est créée sur le
bureau.

La première fois, le **pare-feu Windows** peut demander d'autoriser Colveto :
acceptez pour les **réseaux privés** (nécessaire si d'autres postes s'y connectent).

### Mac
Ouvrez le fichier `.dmg`, puis glissez **Colveto** dans le dossier **Applications**.
Au premier lancement, macOS refuse d'ouvrir l'application (elle n'est pas signée par
Apple) : allez dans **Réglages Système → Confidentialité et sécurité**, puis cliquez
sur **Ouvrir quand même**. Cette manipulation n'est à faire qu'une fois.

---

## 3. Premier démarrage

### 3.1 Nouveau cabinet ou poste supplémentaire
Colveto demande comment l'ordinateur sera utilisé :
- **Nouveau cabinet** : première installation de Colveto dans le cabinet. Choisissez
  ceci sur l'ordinateur central.
- **Rejoindre un cabinet** : Colveto est déjà installé sur un autre ordinateur du
  cabinet. Voir [chapitre 9](#9-plusieurs-ordinateurs-dans-le-cabinet).

### 3.2 Le compte administrateur
Saisissez le nom complet, un **identifiant** (sans espace, par exemple `mdupont`) et
un **mot de passe** d'au moins 8 caractères. Ce compte a tous les droits : notez bien
ses informations.

Lisez ensuite les **conditions d'utilisation** affichées sous le formulaire et cochez
la case pour les accepter au nom du cabinet : Colveto est gratuit et sans garantie, et
le cabinet reste responsable de ses données, de ses sauvegardes et de ses obligations
légales. Elles restent consultables dans ⚙️ Paramètres.

> Sur un serveur en ligne, un **code d'installation** est aussi demandé : il
> s'affiche à la fin de l'installation du serveur. Il empêche quiconque de créer le
> compte administrateur à votre place.

### 3.3 La double authentification (obligatoire pour l'administrateur)
Elle protège les données médicales même si le mot de passe est découvert.
1. Installez sur votre téléphone une application d'authentification : *Google
   Authenticator*, *Microsoft Authenticator* ou *2FAS* (gratuites).
2. Dans l'application, scannez le **QR code** affiché par Colveto.
3. Tapez le **code à 6 chiffres** que l'application affiche.
4. Colveto affiche des **codes de secours** : **notez-les sur papier** et rangez-les.
   Ils permettent de vous connecter si vous perdez votre téléphone (chaque code ne
   sert qu'une fois).

À chaque connexion, Colveto demandera ensuite le mot de passe **et** le code du
téléphone.

### 3.4 Le paramétrage rapide (4 étapes)
Chaque étape peut être passée et tout reste modifiable dans **Paramètres**.

1. **Cabinet** : nom (obligatoire), adresse, téléphone, email, site web, n° de TVA.
   Ces informations apparaissent sur les factures, les emails et la page de RDV.
2. **Horaires** : heures d'ouverture, jours d'ouverture (en bleu ; cliquez sur un jour
   pour l'ouvrir ou le fermer), et **adresse publique** (à laisser vide si Colveto
   n'est accessible que dans le cabinet).
3. **Emails** : le serveur d'envoi de votre messagerie (voir [4.2](#42-emails)).
   Bouton **Envoyer un email de test** pour vérifier.
4. **Facturation** : préfixe et prochain numéro de facture (reprenez la suite de votre
   ancien logiciel), et l'adresse de votre fiduciaire si elle doit recevoir une copie
   des factures payées.

---

## 4. Compléter les paramètres

Menu **⚙️ Paramètres**. N'oubliez pas **Enregistrer les paramètres** en bas de page.

### 4.1 Cabinet
Nom, n° d'entreprise, adresse, TVA, téléphone, email, site web et **signature des
emails** (texte libre, plusieurs lignes ; à défaut : nom, site et téléphone).

**Logo sur les factures** (version serveur uniquement pour l'instant) : placez votre
logo (image PNG) sous le nom `logo-invoice.png` dans le dossier de Colveto sur le
serveur (voir `INSTALL.md`).

### 4.2 Emails
Indispensables pour les rappels, les confirmations de RDV et l'envoi des factures.
Votre fournisseur de messagerie fournit ces informations (cherchez « paramètres
SMTP » sur son site) :

| Champ | Exemple |
|---|---|
| Serveur SMTP | `smtp.monfournisseur.lu` |
| Port / sécurité | 587 + STARTTLS, ou 465 + SSL/TLS |
| Identifiant / mot de passe | ceux de la boîte mail |
| Email et nom d'expéditeur | `cabinet@moncabinet.lu`, « Cabinet des Tilleuls » |

> **Gmail** : créez un « mot de passe d'application » (compte Google → Sécurité) et
> utilisez-le à la place du mot de passe habituel.

Cliquez sur **📧 Envoyer un email de test**.

### 4.3 Rappels automatiques
Activez les rappels et choisissez le délai (24 h = la veille). Les modèles des emails
(rappel de RDV, rappel de vaccin, facture, compte rendu, dossier, analyses) sont
modifiables ; laissés vides, un modèle par défaut est utilisé. Les mots entre
accolades, comme `{{patientName}}`, sont remplacés automatiquement.

### 4.4 Horaires et types de rendez-vous
- **Horaires du cabinet** : plage affichée dans l'agenda, granularité (15, 20 ou
  30 min).
- **Types de rendez-vous** : pour chaque type (consultation, vaccination…), une
  **couleur**, une **durée** par défaut, l'**ordre** d'affichage, et deux cases :
  - **En ligne** : proposé sur la page de prise de RDV pour les clients ;
  - **Référés** : seuls motifs autorisés pour un client adressé par un confrère.

### 4.5 Réservation en ligne
- **Délai minimum** avant un RDV pris en ligne (1 h par défaut ; 24 h = pas de RDV le
  jour même).
- **À plusieurs vétérinaires**, le client choisit son vétérinaire ou « Sans
  préférence ». Il ne voit alors que les heures où ce vétérinaire est libre. Sans
  préférence, le RDV va au premier vétérinaire libre. Avec un seul vétérinaire, rien
  ne change pour le client.
- Pour rendre la page de RDV accessible depuis Internet et l'ajouter au site du
  cabinet, transmettez **`RENDEZ-VOUS-EN-LIGNE.md`** à votre informaticien (15 à
  30 min de travail). Sur l'application de bureau, il faut cocher **Activer l'accès
  public**, puis redémarrer Colveto.

### 4.6 Facturation et comptabilité
Préfixe et compteur des factures, **copie comptable** des factures payées (email de
la fiduciaire), comptes Sage pour l'export comptable.

### 4.7 Sauvegarde — à faire dès le premier jour
Voir [chapitre 10](#10-sauvegardes-sécurité-et-mises-à-jour).

### 4.8 VAMREG — antibiotiques (Belgique uniquement)
Pour les cabinets belges qui ont un **dépôt de médicaments** : Colveto déclare
lui-même au registre VAMREG de l'AFMPS les antibiotiques reçus (registre *IN*) et
délivrés (registre *OUT*). Hors de Belgique, laissez ce module désactivé.

> **Quelles espèces ?** VAMREG couvre les **chevaux** et les **poissons d'élevage**
> depuis le 1er juillet 2026, puis les chiens, chats et autres animaux de compagnie
> à partir du 1er janvier 2029. Les bovins, porcs, volailles, veaux, lapins et
> petits ruminants se déclarent dans **Sanitel-Med**, pas dans VAMREG : Colveto ne
> les envoie pas.

1. **Créer la clé API** : sur le portail de l'AFMPS (app.fagg-afmps.be → FAMHP
   Connect → onglet *Clés API*), avec le compte du dépôt qui a le rôle
   « déclarant ». Suivez le guide de l'AFMPS « VAMREG — Création d'une clé API ».
2. **Paramètres → Configurer VAMREG** (ou menu 🇧🇪 VAMREG une fois activé) :
   - cochez **Activer les déclarations VAMREG**, choisissez l'environnement
     **Production — déclarations officielles** ;
   - collez la **clé API**, puis **Tester** : le message « Connexion à VAMREG
     (production) réussie » doit s'afficher ;
   - indiquez le **n° d'Ordre par défaut** (ex. F2345) et le **type de fournisseur
     habituel** (distributeur belge, pharmacie…) ;
   - **Espèces** : pour chaque espèce de Colveto, l'espèce VAMREG correspondante ou
     « Ne pas déclarer ». Par défaut, seul le cheval est déclaré.
   - **Enregistrer**.
3. **Médicaments** : sur la fiche de chaque antibiotique, cochez **🇧🇪 Antibiotique
   à déclarer à VAMREG**, puis cherchez le produit dans la liste officielle (nom ou
   code CNK). Le CNK et le **contenu d'un conditionnement** se remplissent seuls :
   vérifiez ce dernier (par exemple 100 pour un flacon de 100 mL si l'unité de base
   est le mL). Un produit acheté à l'étranger se saisit comme « Produit étranger ».
4. **Utilisateurs** : renseignez le **n° d'Ordre** de chaque vétérinaire.

Ensuite, tout est automatique :
- à chaque **réception de lot**, une entrée est déclarée (choisissez le type de
  fournisseur dans la fenêtre « Recevoir un lot » ; la quantité reçue doit faire un
  nombre entier de conditionnements) ;
- à chaque **facture validée** pour une espèce déclarée, une sortie est déclarée,
  au nom du vétérinaire qui a délivré le produit ;
- une **facture annulée** ou un **lot corrigé** est supprimé ou modifié chez VAMREG,
  tant que le trimestre est encore ouvert ;
- rien n'est envoyé pour les dates antérieures à l'activation du module.

La page **🇧🇪 VAMREG** montre chaque déclaration : ✅ envoyée, ⏳ en attente (VAMREG
indisponible, nouvel essai toutes les 15 minutes), ❌ à corriger (le motif est
indiqué : CNK manquant, n° d'Ordre manquant, quantité non entière…). Corrigez la
fiche concernée, puis **Envoyer maintenant**. Vous restez responsable de vos
déclarations : jetez un œil à cette page au moins une fois par trimestre.

Pas encore pris en charge : les **préparations magistrales** et l'indication
(facultative) ; déclarez-les directement sur vamreg.be.

---

## 5. Préparer le catalogue

### Actes (menu 🩺 Actes)
**+ Nouvel acte** : nom, prix **HTVA**, taux de TVA, code et compte comptable
(optionnels). Ce sont les prestations qui apparaîtront sur les factures.

### Médicaments (menu 💊 Médicaments)
1. **+ Nouveau médicament** : nom, unité de base (comprimé, mL, g…), TVA, et les
   **unités de vente** (par exemple « boîte de 30 cp », « comprimé à l'unité »).
2. À chaque livraison, **+ Lot** (« Recevoir un lot ») : n° de lot, date de
   péremption, quantité, prix payé, fournisseur. Le bouton **Calculer prix de vente
   avec marge cible** propose les prix de vente.
3. Le stock se décompte tout seul à chaque facture. Pour une casse ou un inventaire,
   cliquez sur la quantité restante pour la corriger (menu 📦 Stock).
4. **Belgique** : cochez *Antibiotique à déclarer à VAMREG* sur les antibiotiques
   (voir [4.8](#48-vamreg--antibiotiques-belgique-uniquement)).

### Protocoles (menu 🧪 Protocoles)
Un protocole est un ensemble d'actes et de produits facturés ensemble (par exemple
« Castration chat » = acte + anesthésie + médicaments). **+ Nouveau protocole**, puis
**+ Acte** / **+ Produit**. Astuce : depuis une facture, *Enregistrer comme
protocole* en crée un en un clic.

### Modèles de rapports (menu 📋 Modèles de rapports)
Textes types pour les comptes rendus (examen, traitement). **+ Nouveau modèle**, ou
**Dupliquer** un modèle existant.

---

## 6. Ajouter l'équipe

### Utilisateurs (menu 👤 Utilisateurs)
**+ Nouvel utilisateur** : nom, identifiant, mot de passe (8 caractères minimum) et
**rôle** :

| Rôle | Peut… |
|---|---|
| **Administrateur** | tout faire : paramètres, utilisateurs, rapports financiers, validation des factures, export comptable |
| **Vétérinaire** | agenda, clients, animaux, dossiers médicaux, factures |
| **Assistant(e)** | agenda, clients, animaux, préparation des factures et encaissements |

Chacun a **son propre compte** : ne partagez pas les identifiants. En Belgique, avec
VAMREG activé, indiquez aussi le **n° d'Ordre** des vétérinaires. Un compte peut
être désactivé (départ d'un employé) sans perdre l'historique.

**Plusieurs vétérinaires.** La case **🩺 Vétérinaire consultant** donne au compte
**son propre agenda** : il peut être choisi pour un rendez-vous, au cabinet comme en
ligne. Elle est cochée d'office pour un vétérinaire et pour l'administrateur ;
décochez-la pour un administrateur qui ne consulte pas (gérant, secrétariat). Les
comptes qui ont un agenda portent le badge **🩺 Agenda** dans la liste.

### Sécurité (menu 🔒 Sécurité)
Chaque utilisateur peut y activer la double authentification (recommandé pour tous)
et consulter le **journal des connexions**.

---

## 7. Reprendre les données de l'ancien logiciel

1. Dans l'ancien logiciel, **exportez les clients et les animaux** au format **Excel**
   ou **CSV** (ou demandez cet export à son éditeur).
2. Dans Colveto : **Paramètres → Importer des données → Ouvrir l'assistant
   d'import**, puis déposez le fichier.
3. Vérifiez l'**association des colonnes** proposée par Colveto (« NOM » → Nom du
   client, « Espèce » → Espèce…) et corrigez-la si besoin. Les colonnes non associées
   sont recopiées dans les remarques, pour ne rien perdre.
4. Cliquez sur **Vérifier** : rien n'est encore enregistré. Lisez le résumé et les
   points à vérifier.
5. Cliquez sur **Importer**.

Deux fichiers séparés (clients, puis animaux) ? Importez **d'abord les clients**
(avec leur n° de client), **puis les animaux** (avec ce même n°).

Un import se trompe ? **Annuler cet import** dans l'historique supprime tout ce qu'il
a créé. Les anciennes factures, elles, restent dans l'ancien logiciel, qui sert
d'archive légale.

---

## 8. Utiliser Colveto au quotidien

### Tableau de bord
Les prochains rendez-vous et l'essentiel de la journée.

### Agenda (menu 📅 Agenda)
- **+ RDV** : client (ou nouveau client), animal, type, début et fin, notes.
- **⏸ Bloquer** : réserver un créneau (réunion, congés, chirurgie), éventuellement
  récurrent.
- Vue **Jour** ou **Semaine**, bouton **Aujourd'hui**.
- Dans un RDV : statut, et **✉ Envoyer rappel maintenant**.
- Les RDV pris en ligne par les clients arrivent directement dans l'agenda.

**À plusieurs vétérinaires** (au moins deux comptes « vétérinaire consultant », voir
§ 6) :
- Une ligne **Agendas** apparaît en haut : cochez les vétérinaires à afficher. Chacun
  a sa couleur, et Colveto retient votre choix sur ce poste. Au départ, un vétérinaire
  voit son propre agenda.
- Chaque RDV appartient à **un vétérinaire** (champ obligatoire dans le RDV). Par
  défaut, c'est vous si vous êtes vétérinaire.
- Un blocage **concerne** soit **tout le cabinet** (fermeture, formation commune),
  soit **un seul vétérinaire** (congés, chirurgie) : les autres restent réservables.
- Deux vétérinaires peuvent avoir un RDV à la même heure : seul l'agenda du
  vétérinaire concerné est occupé.

### Clients et animaux (menus 👥 Propriétaires et 🐾 Patients)
- **+ Nouveau propriétaire**, puis dans sa fiche **+ Nouvel animal**.
- La fiche de l'animal regroupe : signalement (puce, naissance, poids, allergies…),
  **dossier médical**, **analyses**, **📎 pièces jointes** (radios, photos,
  documents), **📅 rappels programmés** (vaccins, contrôles).

### Consultation : l'acte médical
Dans la fiche de l'animal : **+ Acte médical**. Choisissez éventuellement un
**modèle de rapport**, complétez l'examen et le traitement, enregistrez. Ensuite :
**📄 Rapport PDF**, **✉ Envoyer au client** (en français ou en anglais), ou
**✉ Envoyer dossier par mail** pour le dossier complet.

### Facturation (menu 🧾 Facturation)
1. **+ Nouvelle facture** : client, puis les lignes (actes, médicaments, ou un
   protocole entier), remise éventuelle.
2. La facture est d'abord un **brouillon**. Au moment du paiement, notez le **mode de
   paiement** (espèces, carte, virement, Payconiq, chèque).
3. L'**administrateur valide** les brouillons (case à cocher, puis **✓ Valider la
   sélection**). La validation attribue le numéro définitif, sans trou dans la
   numérotation, et envoie la facture par email au client s'il a une adresse.
4. Une facture validée ne se modifie plus : en cas d'erreur, **Annuler facture**,
   puis en refaire une.
5. **🖨 Imprimer / PDF** pour une version papier.

### Devis (menu 📝 Devis)
Comme une facture, avec les statuts envoyé, accepté ou refusé. **→ Transformer en
facture** quand le client accepte.

### Rapports (menu 📈 Rapports, administrateur)
Synthèse financière, activité, performance par employé, **caisse** (compter la
caisse, apports, sorties), **charges mensuelles**, **marges par médicament**, et
**traçabilité d'un lot** (en cas de rappel pharmaceutique : quels animaux ont reçu ce
lot).

### Vétérinaires référents (menus 🩻 et 🔗)
- **Vétérinaires référents** : l'annuaire des confrères qui vous adressent des cas.
- **Dossiers référés** : les cas reçus par le formulaire d'adressage. Le confrère
  reçoit un lien sécurisé pour suivre l'évolution du dossier.

### Export comptable (menu 📊 Export Sage)
Choisissez la période, puis exportez le FEC ou le CSV pour votre fiduciaire.

---

## 9. Plusieurs ordinateurs dans le cabinet

1. Sur l'**ordinateur central**, Colveto est installé en « Nouveau cabinet ». Dans
   **Paramètres → Serveur (multi-postes)**, notez son **adresse** (par exemple
   `http://192.168.1.10:3737`).
2. Sur chaque autre poste, au choix :
   - ouvrir un **navigateur** (Chrome, Safari, Edge…) à l'adresse
     `http://192.168.1.10:3737/app/` : rien à installer ;
   - ou installer Colveto et choisir **Rejoindre un cabinet**, avec cette adresse.
3. Chaque personne se connecte avec **son propre compte**.

À savoir :
- l'ordinateur central doit rester **allumé** pendant les heures d'ouverture ;
- demandez une **adresse IP fixe** pour lui (réglage de la box internet), sinon son
  adresse peut changer ;
- si un poste ne se connecte pas, vérifiez le pare-feu de l'ordinateur central
  (Colveto doit être autorisé sur les réseaux privés).

---

## 10. Sauvegardes, sécurité et mises à jour

### Sauvegardes : indispensables
Dans **Paramètres → Sauvegarde de la base de données** :
1. **Ajouter** une destination : clé USB, disque externe, dossier réseau (NAS) ou
   dossier synchronisé (iCloud Drive, OneDrive).
2. Activez la **sauvegarde automatique quotidienne** et choisissez l'heure.
3. Cliquez sur **💾 Sauvegarder maintenant** pour vérifier.

Une sauvegarde sur le même disque que Colveto ne protège pas d'une panne de
l'ordinateur : utilisez au moins une destination **externe**. La marche à suivre pour
**restaurer** une sauvegarde est rappelée au même endroit.

### Récupérer toutes ses données
**Paramètres → Exporter mes données** : export complet (JSON), une table en CSV, ou
**Clients et animaux (CSV)** en un seul fichier.

### Mises à jour
Colveto vérifie seul l'existence d'une nouvelle version (au démarrage, puis toutes
les 6 heures). Un bandeau bleu apparaît alors :
- **Windows** : la mise à jour se télécharge seule ; cliquez sur **Redémarrer et
  installer** ;
- **Mac** : cliquez sur **Télécharger la nouvelle version**, puis remplacez
  l'application dans le dossier Applications.

Avant chaque installation, une copie de la base est faite automatiquement. Réglages
dans **Paramètres → Mises à jour**.

### Vos responsabilités
Colveto est fourni gratuitement et **sans garantie**. Le cabinet est seul responsable
de ses données (sauvegardes, sécurité) et de sa conformité (RGPD, facturation,
registre des médicaments). Voir le README.

---

## 11. Problèmes fréquents

**« Windows a protégé votre ordinateur »** → *Informations complémentaires* →
*Exécuter quand même*.

**Le Mac refuse d'ouvrir Colveto** → Réglages Système → Confidentialité et sécurité →
*Ouvrir quand même*.

**Les emails ne partent pas** → Paramètres → Emails : vérifiez le serveur, le port,
la sécurité et le mot de passe (Gmail : mot de passe d'application), puis *Envoyer un
email de test*.

**Un poste ne trouve pas l'ordinateur central** → l'ordinateur central est-il
allumé ? L'adresse a-t-elle changé (voir Paramètres → Serveur) ? Le pare-feu
autorise-t-il Colveto ?

**J'ai perdu mon téléphone (double authentification)** → connectez-vous avec un de
vos **codes de secours**, puis réactivez la double authentification dans 🔒 Sécurité
avec le nouveau téléphone.

**Un employé a oublié son mot de passe** → un administrateur ouvre 👤 Utilisateurs →
*Modifier*, et lui attribue un nouveau mot de passe.

**Un vétérinaire n'apparaît pas dans l'agenda ni dans la réservation en ligne** →
👤 Utilisateurs → *Modifier* : cochez **🩺 Vétérinaire consultant** et vérifiez que
le compte est actif.

**Une facture validée contient une erreur** → *Annuler facture*, puis en créer une
nouvelle (une facture validée ne se modifie pas, c'est une obligation comptable).

**VAMREG : une déclaration reste « à corriger »** → ouvrez 🇧🇪 VAMREG, lisez le
motif, corrigez la fiche du médicament (CNK, contenu d'un conditionnement), le n°
d'Ordre du vétérinaire (👤 Utilisateurs) ou la quantité du lot, puis **Envoyer
maintenant**. « Clé API refusée » : la clé a expiré ou vient de l'environnement de
test, recréez-la sur le portail de l'AFMPS.

**Autre question ?** Ouvrez un ticket sur
[github.com/Colveto/colveto/issues](https://github.com/Colveto/colveto/issues), sans
jamais y mettre de données de clients.
