# Rendez-vous en ligne — guide pour l'informaticien du cabinet

Colveto inclut une page de prise de rendez-vous pour les clients du cabinet, plus les
liens « confirmer / annuler / reporter » envoyés par email et le portail des
vétérinaires référents. Ce guide explique comment les rendre accessibles depuis Internet
et les relier au site web du cabinet. Comptez 15 à 30 minutes.

## Principe

| Port | Contenu | Exposition |
|---|---|---|
| **3737** | Tout Colveto : application du personnel, données | **Réseau du cabinet uniquement — ne jamais publier** |
| **3738** | Accès public seul : page de RDV, adressage, suivi, liens des emails | À publier sur Internet |

Sur le port 3738, tout le reste (application du personnel `/app`, API authentifiée,
création de compte…) répond **404**. Les données du cabinet ne sont donc pas
accessibles depuis Internet, même avec un mot de passe.

> **Cas d'un VPS** : si Colveto est installé sur un serveur en ligne avec `deploy.sh`,
> la page de RDV est déjà publiée à `https://<domaine>/`. Passez directement à l'étape 3.

> **Important** : avec un ordinateur central, la page de RDV n'est joignable que
> **lorsque cet ordinateur est allumé**. Pour une prise de RDV 24 h/24, un VPS est
> plus adapté (voir INSTALL.md).

## 1. Activer l'accès public sur l'ordinateur central

Lancez le serveur avec la variable `PUBLIC_PORT` :

```bash
PUBLIC_PORT=3738 DATA_DIR=<dossier-des-données> node server-standalone.js
```

Par défaut, le port 3738 n'écoute que sur la machine elle-même (`127.0.0.1`), ce qui
convient au tunnel de l'option A. Pour l'option B (reverse proxy sur une autre
machine), ajoutez `PUBLIC_HOST=0.0.0.0` et limitez l'accès au port 3738 à ce proxy dans
le pare-feu.

## 2. Publier le port 3738

### Option A — Tunnel Cloudflare (recommandé)

Aucun port à ouvrir sur la box, HTTPS automatique, gratuit. Il faut que le DNS du
domaine du cabinet soit géré par Cloudflare (offre gratuite).

1. Sur [dash.cloudflare.com](https://dash.cloudflare.com) : **Zero Trust → Networks →
   Tunnels → Create a tunnel** (type *Cloudflared*), nommez-le `colveto`.
2. Installez `cloudflared` sur l'ordinateur central avec la commande affichée par
   Cloudflare (sous Windows : `winget install --id Cloudflare.cloudflared`, puis la
   commande `cloudflared service install <jeton>`). Il démarrera avec Windows.
3. Dans **Public Hostname**, ajoutez :
   - *Subdomain* : `rdv` — *Domain* : `moncabinet.lu`
   - *Service* : `HTTP` — `localhost:3738`

**N'indiquez jamais `localhost:3737`.**

### Option B — Reverse proxy existant

Si le cabinet dispose déjà d'un reverse proxy (NAS, serveur, pare-feu), faites pointer
le sous-domaine vers `http://<IP-de-l'ordinateur-central>:3738` en HTTPS, en
transmettant l'en-tête `X-Forwarded-For`. Exemple avec Caddy :

```
rdv.moncabinet.lu {
    reverse_proxy 192.168.1.10:3738
}
```

## 3. Régler Colveto

Dans Colveto, compte administrateur, **Paramètres** :

- **URL publique du serveur** : `https://rdv.moncabinet.lu` — c'est elle qui sert dans
  les liens des emails ;
- **Cabinet → Site web** : l'adresse du site du cabinet (lien « Retour au site » sur la
  page de RDV) ;
- **Réservation en ligne** : types de rendez-vous proposés, délai minimum ;
- **Emails** : serveur SMTP, indispensable pour les confirmations.

## 4. Ajouter un bouton sur le site du cabinet

Un simple lien suffit, à placer dans le menu ou sur la page d'accueil :

```html
<a href="https://rdv.moncabinet.lu/"
   style="display:inline-block;padding:12px 22px;border-radius:8px;
          background:#2563eb;color:#fff;font-weight:600;text-decoration:none">
  Prendre rendez-vous en ligne
</a>
```

Sur WordPress, Wix, Squarespace, etc. : ajoutez un bouton dont le lien est
`https://rdv.moncabinet.lu/`.

## 5. Vérifier

Depuis un téléphone **en 4G/5G** (hors du wifi du cabinet) :

- [ ] `https://rdv.moncabinet.lu/` affiche la page de RDV avec le nom du cabinet ;
- [ ] `https://rdv.moncabinet.lu/app/` affiche **« Introuvable »** ;
- [ ] une réservation test apparaît dans l'agenda de Colveto ;
- [ ] l'email de confirmation arrive et ses liens « confirmer / annuler » fonctionnent.

Supprimez ensuite le rendez-vous test.
