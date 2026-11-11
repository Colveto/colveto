const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const os = require('os');
// Les modules du serveur (server-deploy/) doivent se charger depuis les
// node_modules de l'application de bureau (compilés pour Electron), pas depuis
// server-deploy/node_modules (compilés pour Node, présent en développement).
{
  const Module = require('module');
  const rootModules = path.join(__dirname, '..', 'node_modules');
  const serverDir = path.join(__dirname, '..', 'server-deploy') + path.sep;
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveFromDesktop(request, parent, ...rest) {
    if (parent && parent.filename && parent.filename.startsWith(serverDir)
      && !request.startsWith('.') && !path.isAbsolute(request)) {
      try {
        return originalResolve.call(this, request, { ...parent, paths: [rootModules] }, ...rest);
      } catch { /* module absent à la racine : résolution normale */ }
    }
    return originalResolve.call(this, request, parent, ...rest);
  };
}

// L'application de bureau embarque le MÊME serveur que la version web
// (server-deploy/) : une seule base de code, toutes les fonctions.
const Database = require('../server-deploy/database');
const { createServer, createPublicApp } = require('../server-deploy/server');
const { startScheduler } = require('../server-deploy/backup');
const { startScheduler: startReminderScheduler } = require('../server-deploy/reminders');
const fs = require('fs');
const updater = require('./updater');

const isDev = process.env.NODE_ENV === 'development';
// Dossier de données personnalisé (tests, ou données sur un autre disque).
if (process.env.COLVETO_DATA_DIR) app.setPath('userData', path.resolve(process.env.COLVETO_DATA_DIR));
const SERVER_PORT = parseInt(process.env.SERVER_PORT || '3737', 10);
const PUBLIC_PORT = parseInt(process.env.PUBLIC_PORT || '3738', 10);

let mainWindow;
let db;
let httpServer;
let publicServer = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Colveto',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

function getLanIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function startEmbeddedServer() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'vet-clinic.db');
  db = new Database(dbPath);

  const expressApp = createServer({ db, userDataPath, distDir: path.join(__dirname, '..', 'dist') });
  httpServer = expressApp.listen(SERVER_PORT, '0.0.0.0', () => {
    const lanIp = getLanIp();
    console.log(`✓ Serveur Colveto démarré`);
    console.log(`  Local : http://localhost:${SERVER_PORT}`);
    if (lanIp) console.log(`  Réseau : http://${lanIp}:${SERVER_PORT}/app/  (navigateur des autres postes du cabinet)`);
  });

  // Accès public seul (rendez-vous en ligne), activé dans Paramètres →
  // Réservation en ligne. N'écoute que sur ce PC : l'informaticien le publie
  // avec un tunnel (voir RENDEZ-VOUS-EN-LIGNE.md). Pris en compte au démarrage.
  if (db.getSettings().publicAccessEnabled === '1') {
    const publicHost = process.env.PUBLIC_HOST || '127.0.0.1';
    publicServer = createPublicApp(expressApp, { publicDir: path.join(__dirname, '..', 'server-deploy', 'public') })
      .listen(PUBLIC_PORT, publicHost, () => {
        console.log(`  Accès public (RDV en ligne) : http://${publicHost}:${PUBLIC_PORT}`);
      });
  }

  // Start the daily backup scheduler
  startScheduler({
    db,
    getSettings: () => db.getSettings(),
    saveSettings: (data) => db.saveSettings(data),
  });

  // Start the reminder scheduler (uses the JWT secret already saved by the server)
  const secretPath = path.join(userDataPath, 'jwt-secret.txt');
  if (fs.existsSync(secretPath)) {
    const secret = fs.readFileSync(secretPath, 'utf-8').trim();
    startReminderScheduler({ db, secret });
  }

}

app.whenReady().then(() => {
  startEmbeddedServer();
  registerIpcHandlers();
  createWindow();
  updater.start({ db, getSettings: () => db.getSettings() });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (publicServer) publicServer.close();
  if (httpServer) httpServer.close();
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});

function registerIpcHandlers() {
  // Mises à jour automatiques (voir updater.js)
  ipcMain.handle('update:get', () => updater.getState());
  ipcMain.handle('update:check', () => updater.check({ manual: true }).then(() => updater.getState()));
  ipcMain.handle('update:install', () => updater.install());

  // The renderer fetches its config from here on startup
  ipcMain.handle('config:get', () => ({
    defaultApiUrl: `http://localhost:${SERVER_PORT}`,
    lanIp: getLanIp(),
    port: SERVER_PORT,
    publicPort: PUBLIC_PORT,
    publicAccessRunning: !!publicServer,
  }));

  // Print the currently displayed page to PDF (used to attach the on-screen
  // invoice/dossier to emails, identical to what the user gets via the Print
  // dialog → "Save as PDF").
  ipcMain.handle('print-to-pdf', async () => {
    if (!mainWindow) throw new Error('Aucune fenêtre active');
    const buf = await mainWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: false,
      // Electron expects margins in inches as numbers (10mm ≈ 0.4 inch)
      margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
    });
    return buf;
  });

  // Render a SPA route in a hidden BrowserWindow and printToPDF it.
  // Used to produce print-perfect PDFs of pages the user isn't currently on
  // (e.g. a single medical record). The hidden window inherits the default
  // session so localStorage (auth token, apiUrl) is shared.
  ipcMain.handle('print-route-to-pdf', async (_event, relativeHashRoute) => {
    if (!mainWindow) throw new Error('Aucune fenêtre active');
    // Build full URL using the same base as the main window, only swap the hash.
    const baseUrl = mainWindow.webContents.getURL();
    let printUrl;
    try {
      const u = new URL(baseUrl);
      u.hash = relativeHashRoute.startsWith('#') ? relativeHashRoute : `#${relativeHashRoute}`;
      printUrl = u.toString();
    } catch (e) {
      throw new Error('URL invalide pour l\'impression');
    }

    const printWin = new BrowserWindow({
      show: false,
      width: 1200,
      height: 1600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    try {
      await printWin.loadURL(printUrl);
      // Poll for window.__PRINT_READY__ === true (set by RecordPrint when data is loaded).
      const startedAt = Date.now();
      const timeoutMs = 12000;
      while (Date.now() - startedAt < timeoutMs) {
        try {
          const ready = await printWin.webContents.executeJavaScript('window.__PRINT_READY__ === true');
          if (ready) break;
        } catch { /* ignore JS errors during boot */ }
        await new Promise((r) => setTimeout(r, 150));
      }
      const buf = await printWin.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: true,
        preferCSSPageSize: false,
        margins: { top: 0.4, bottom: 0.4, left: 0.4, right: 0.4 },
      });
      return buf;
    } finally {
      try { printWin.destroy(); } catch { /* ignore */ }
    }
  });

}
