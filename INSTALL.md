# Installer Colveto

Colveto fonctionne comme un **serveur** auquel on accède avec un **navigateur**
(ordinateurs du cabinet, tablette, téléphone). Les données sont stockées dans une base
SQLite sur ce serveur.

Deux façons de l'installer :

- **A. Sur un serveur en ligne (VPS)** — recommandé : accessible partout, en HTTPS,
  et nécessaire pour la prise de rendez-vous en ligne et les liens dans les emails.
- **B. Essai sur votre ordinateur** — pour découvrir le logiciel.

Dans les deux cas il vous faut une **application d'authentification** sur téléphone
(Google Authenticator, Microsoft Authenticator, 2FAS…) : la double authentification est
obligatoire pour le compte administrateur.

---

## A. Installation sur un VPS (Ubuntu)

### Ce qu'il vous faut

- un VPS sous **Ubuntu 22.04 ou 24.04** (1 Go de RAM minimum, 2 Go conseillés),
  chez un hébergeur situé dans l'Union européenne ;
- un **nom de domaine** (ou sous-domaine), par exemple `rdv.moncabinet.lu` ;
- un accès SSH root au VPS.

### 1. Faire pointer le domaine vers le VPS

Chez votre registrar, créez un enregistrement DNS **A** :
`rdv.moncabinet.lu → adresse IP du VPS`.

### 2. Préparer l'application (sur votre ordinateur)

Il faut [Node.js](https://nodejs.org) 20 ou plus.

```bash
git clone <adresse-du-dépôt> colveto
cd colveto
npm install
npm run build
cp -R dist server-deploy/dist
```

### 3. Envoyer les fichiers sur le VPS et installer

```bash
scp -r server-deploy root@<IP-du-VPS>:/root/colveto-install
ssh root@<IP-du-VPS>
cd /root/colveto-install
chmod +x deploy.sh
DOMAIN=rdv.moncabinet.lu ./deploy.sh
```

Le script installe Node.js, Caddy (HTTPS automatique avec Let's Encrypt), crée un
utilisateur système dédié, le service `vet-clinic` et ouvre le pare-feu (SSH, HTTP, HTTPS).

### 4. Premier démarrage

Ouvrez `https://rdv.moncabinet.lu/app/` : Colveto vous guide.

1. Création du **compte administrateur**, protégée par le **code d'installation**
   affiché à la fin du script (retrouvable avec `cat /var/lib/vet-clinic/setup-code.txt`).
   Sans ce code, personne d'autre ne peut prendre la main sur votre serveur avant vous.
2. Activation de la **double authentification**.
3. **Paramétrage rapide** en 4 étapes : cabinet, horaires et adresse publique,
   envoi des emails, facturation. Chaque étape peut être passée et tout reste
   modifiable ensuite dans **Paramètres**.

Ensuite, pensez à activer la **sauvegarde automatique** (Paramètres) et, si vous voulez
votre logo sur les factures, à déposer un fichier PNG nommé `logo-invoice.png` dans
`/opt/vet-clinic/` puis à lancer `systemctl restart vet-clinic`.

La page de prise de rendez-vous pour vos clients est à l'adresse `https://rdv.moncabinet.lu/`.

### Où sont les données ?

| Quoi | Où |
|---|---|
| Base de données | `/var/lib/vet-clinic/vet-clinic.db` |
| Pièces jointes, sauvegardes | `/var/lib/vet-clinic/` |
| Application | `/opt/vet-clinic/` |
| Journaux | `journalctl -u vet-clinic` |

### Sauvegardes : à faire absolument

La sauvegarde intégrée copie la base dans un dossier **du même serveur**. Si le serveur
est perdu, elle est perdue aussi. Copiez régulièrement `/var/lib/vet-clinic/`
**ailleurs** (votre ordinateur, un stockage externe chiffré), par exemple :

```bash
scp -r root@<IP-du-VPS>:/var/lib/vet-clinic ./sauvegarde-colveto-$(date +%F)
```

Et testez de temps en temps la restauration.

### Mettre à jour Colveto

```bash
# sur votre ordinateur
git pull
npm install
npm run build
rm -rf server-deploy/dist && cp -R dist server-deploy/dist
scp -r server-deploy root@<IP-du-VPS>:/root/colveto-install
# sur le VPS (faites d'abord une copie de /var/lib/vet-clinic)
cd /root/colveto-install && DOMAIN=rdv.moncabinet.lu ./deploy.sh
```

---

## B. Essai sur votre ordinateur

```bash
git clone <adresse-du-dépôt> colveto
cd colveto
npm install
npm run build
cp -R dist server-deploy/dist
cd server-deploy
npm install
DATA_DIR=./donnees node server-standalone.js
```

Ouvrez ensuite <http://localhost:3737/app/>.

Pour un essai sans double authentification ni envoi d'emails, lancez à la place :
`DEMO_MODE=1 DATA_DIR=./donnees node server-standalone.js`.
**N'utilisez jamais le mode démo avec de vraies données.**

---

## Récupérer toutes vos données

**Paramètres → Exporter mes données** : export complet en JSON, ou table par table en
CSV (lisible dans Excel ou LibreOffice). Vous pouvez ainsi quitter Colveto à tout moment.
Les pièces jointes sont dans le dossier de données du serveur.
