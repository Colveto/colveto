/**
 * Standalone server for the Vet Clinic app, intended for VPS deployment.
 * Runs the same Express server as the Electron app, without Electron.
 *
 * Environment variables:
 *   DATA_DIR     - Where to store the SQLite database and JWT secret (default: /var/lib/vet-clinic)
 *   SERVER_PORT  - Port to listen on (default: 3737)
 *   SERVER_HOST  - Host to bind to (default: 127.0.0.1, behind Caddy reverse proxy)
 */

const path = require('path');
const fs = require('fs');
const Database = require('./database');
const { createServer, createPublicApp } = require('./server');
const { startScheduler: startBackupScheduler } = require('./backup');
const { startScheduler: startReminderScheduler } = require('./reminders');

const dataDir = process.env.DATA_DIR || '/var/lib/vet-clinic';
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'vet-clinic.db');
console.log(`[server] Database: ${dbPath}`);
const db = new Database(dbPath);

const app = createServer({ db, userDataPath: dataDir });
// createServer side-effect: writes ${dataDir}/jwt-secret.txt on first run

const port = parseInt(process.env.SERVER_PORT || '3737', 10);
const host = process.env.SERVER_HOST || '127.0.0.1';

const httpServer = app.listen(port, host, () => {
  console.log(`[server] Listening on http://${host}:${port}`);
  console.log(`[server] Data directory: ${dataDir}`);
  console.log(`[server] Ready.`);
});

// Accès public seul (optionnel) : PUBLIC_PORT=3738 → n'expose que la prise de
// rendez-vous, l'adressage et les liens des emails. À utiliser pour publier la
// prise de RDV sur Internet depuis l'ordinateur central (tunnel, reverse proxy).
let publicServer = null;
if (process.env.PUBLIC_PORT) {
  const publicPort = parseInt(process.env.PUBLIC_PORT, 10);
  const publicHost = process.env.PUBLIC_HOST || '127.0.0.1';
  const publicDir = process.env.PUBLIC_DIR ? path.resolve(process.env.PUBLIC_DIR) : path.join(__dirname, 'public');
  publicServer = createPublicApp(app, { publicDir }).listen(publicPort, publicHost, () => {
    console.log(`[server] Accès public (RDV en ligne) sur http://${publicHost}:${publicPort}`);
  });
}

// Backup scheduler
startBackupScheduler({
  db,
  getSettings: () => db.getSettings(),
  saveSettings: (data) => db.saveSettings(data),
});

// Reminder scheduler — uses the same JWT secret created by createServer.
// Désactivé en mode démo : inutile puisque tout envoi d'email est verrouillé
// (email.js), et ça évite une erreur toutes les 5 minutes dans le journal.
if (process.env.DEMO_MODE === '1') {
  console.log('[server] MODE DÉMO — envoi d\'emails verrouillé, rappels désactivés');
} else {
  const secretPath = path.join(dataDir, 'jwt-secret.txt');
  const secret = fs.readFileSync(secretPath, 'utf-8').trim();
  startReminderScheduler({ db, secret });
  console.log('[server] Reminder scheduler started');
}

// Graceful shutdown
const shutdown = () => {
  console.log('[server] Shutting down...');
  if (publicServer) publicServer.close();
  httpServer.close(() => {
    db.close();
    process.exit(0);
  });
  // Force-exit after 10s
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
