# Contribuer à Colveto

Merci de votre intérêt ! Colveto est maintenu bénévolement, sur le temps libre d'un
vétérinaire : les réponses peuvent prendre du temps.

## Signaler un bug ou proposer une idée

Ouvrez un ticket (issue) en précisant :

- ce que vous faisiez, ce qui s'est passé, ce que vous attendiez ;
- la version de Colveto et le type d'installation (VPS, ordinateur) ;
- les messages d'erreur éventuels (`journalctl -u vet-clinic -n 50`).

**Ne publiez jamais de données réelles** (noms de clients, emails, dossiers médicaux).

## Proposer une modification du code

1. Ouvrez d'abord un ticket pour en discuter, surtout pour un changement important.
2. Faites une branche à partir de `main`, avec des changements ciblés.
3. Vérifiez que l'application se lance et que la fonction modifiée marche
   (voir l'essai local dans [INSTALL.md](INSTALL.md)).
4. Ouvrez une demande de fusion (pull request) qui explique le pourquoi du changement.

## Organisation du code

```
src/              Interface (React), servie par le serveur sous /app
server-deploy/    Serveur (Node.js, Express, SQLite) — c'est lui qu'on installe
  server.js       Routes de l'API
  database.js     Schéma et accès à la base SQLite
  public/         Pages publiques : prise de RDV, adressage, suivi des référés
electron/         Application de bureau (moins maintenue que le serveur)
```

Les textes de l'interface sont en français.

En contribuant, vous acceptez que votre contribution soit publiée sous la licence du
projet (AGPL-3.0-or-later).
