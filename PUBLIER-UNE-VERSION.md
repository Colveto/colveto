# Publier une nouvelle version de Colveto

Les applications de bureau installées dans les cabinets vérifient au démarrage, puis
toutes les 6 heures, la dernière version publiée dans les **Releases** de ce dépôt
GitHub. Sous Windows, elles la téléchargent et proposent « Redémarrer et installer ».
Sur Mac, elles affichent un lien de téléchargement.

Les installateurs sont **fabriqués automatiquement par GitHub** (onglet *Actions*,
fichier `.github/workflows/installateurs.yml`) : pas besoin de PC ni de Mac.

## Une seule fois

Dans `package.json`, le dépôt GitHub (compte/nom) doit être indiqué :

```json
"colveto": { "updateRepo": "votre-compte/colveto" }
```

Tant que cette valeur vaut `VOTRE-COMPTE/colveto`, les mises à jour automatiques sont
désactivées.

## À chaque version

1. **Numéro de version** : augmentez `"version"` dans `package.json` (ex. `0.5.0` → `0.6.0`)
   et enregistrez ce changement dans le dépôt (commit). Les cabinets ne voient une mise à
   jour que si ce numéro est plus grand que le leur.
2. **Étiquette** : créez l'étiquette `v` + numéro et envoyez-la :
   `git tag v0.6.0 && git push origin v0.6.0`.
3. **Fabrication** : GitHub fabrique les trois installateurs (≈ 15 min, onglet *Actions*)
   et crée une **release en brouillon** avec les fichiers joints (`.exe`, `.blockmap`,
   `latest.yml`, deux `.dmg`). Ne les renommez pas.
4. **Publication** : onglet *Releases* → le brouillon → complétez les nouveautés en
   quelques lignes pour les cabinets → **Publish release**.

Les cabinets reçoivent la mise à jour dans les heures qui suivent. Avant chaque
installation, Colveto fait une copie de la base dans
`sauvegardes-avant-mise-a-jour/` (dossier de données de Colveto, 5 dernières gardées).

## Fabriquer à la main (sans GitHub)

- Windows, sur un PC avec Node.js : double-clic sur `scripts\build-windows.bat`.
- Mac, hors dossier synchronisé par iCloud : `scripts/build-mac.sh`.

## Si une version pose problème

Publiez rapidement une version corrigée avec un numéro plus grand (`0.6.1`). Ne
supprimez pas une release déjà téléchargée : publiez plutôt la correction par-dessus.
