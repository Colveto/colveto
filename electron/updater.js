// Mises à jour automatiques de l'application de bureau.
//
// Source : les « releases » du dépôt public sur GitHub. L'appli
// interroge l'API publique (simple lecture, AUCUNE donnée du cabinet n'est
// envoyée), compare les versions, puis :
//   - Windows : télécharge l'installateur en arrière-plan (electron-updater,
//     fichier latest.yml de la release) et propose « Redémarrer et installer » ;
//   - Mac : affiche la nouvelle version avec un lien de téléchargement (Apple
//     n'autorise l'installation automatique que pour les applis signées avec
//     un compte développeur).
// Avant d'installer, la base est sauvegardée (sauvegarde-avant-mise-a-jour).
//
// Le dépôt est indiqué dans package.json → "colveto.updateRepo" ("compte/depot").
// Désactivable dans Paramètres (réglage updateCheckEnabled = '0').

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let state = { status: 'idle', current: null, latest: null, notes: '', pageUrl: null, error: null, progress: null };
let deps = null;
let timer = null;

function repo() {
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    const r = process.env.COLVETO_UPDATE_REPO || (pkg.colveto && pkg.colveto.updateRepo) || '';
    return /^[\w.-]+\/[\w.-]+$/.test(r) && !r.startsWith('VOTRE-COMPTE') ? r : null;
  } catch { return null; }
}

function cmpVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

function setState(patch) {
  state = { ...state, ...patch };
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('update:status', state); } catch { /* fenêtre fermée */ }
  }
}

function apiBase() {
  // COLVETO_UPDATE_API : pour les tests (faux serveur de releases).
  return process.env.COLVETO_UPDATE_API || 'https://api.github.com';
}

async function fetchLatestRelease() {
  const r = repo();
  if (!r) return null;
  // GitHub exige un User-Agent ; lecture anonyme (60 requêtes/heure, on en fait 4 par jour).
  const res = await fetch(`${apiBase()}/repos/${r}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Colveto-updater' } });
  if (res.status === 404) return null; // aucune release publiée
  if (!res.ok) throw new Error(`Serveur des mises à jour : HTTP ${res.status}`);
  return res.json();
}

function enabled() {
  try { return deps.getSettings().updateCheckEnabled !== '0'; } catch { return true; }
}

async function check({ manual = false } = {}) {
  if (!repo()) { if (manual) setState({ status: 'unconfigured' }); return state; }
  if (!manual && !enabled()) return state;
  if (['downloading', 'ready'].includes(state.status)) return state;
  setState({ status: 'checking', error: null });
  try {
    const rel = await fetchLatestRelease();
    const latest = rel && String(rel.tag_name || '').replace(/^v/, '');
    if (!latest || cmpVersions(latest, app.getVersion()) <= 0) {
      setState({ status: 'up-to-date', latest: latest || app.getVersion() });
      return state;
    }
    const pageUrl = rel.html_url || `https://github.com/${repo()}/releases`;
    setState({ status: 'available', latest, notes: rel.body || '', pageUrl });
    if (process.platform === 'win32') await downloadWindows(rel);
  } catch (e) {
    setState({ status: 'error', error: e.message });
  }
  return state;
}

async function downloadWindows(rel) {
  const { autoUpdater } = require('electron-updater');
  // latest.yml et l'installateur sont des fichiers joints à la release.
  const asset = (rel.assets || []).find((a) => a.name === 'latest.yml');
  if (!asset) { setState({ status: 'available' }); return; } // release sans mise à jour auto
  const baseUrl = asset.browser_download_url.replace(/\/latest\.yml$/, '');
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.setFeedURL({ provider: 'generic', url: baseUrl });
  autoUpdater.removeAllListeners();
  autoUpdater.on('download-progress', (p) => setState({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', () => setState({ status: 'ready', progress: 100 }));
  autoUpdater.on('error', (e) => setState({ status: 'available', error: `Téléchargement impossible : ${e.message}` }));
  setState({ status: 'downloading', progress: 0 });
  await autoUpdater.checkForUpdates();
}

// Copie cohérente de la base (API de sauvegarde SQLite) avant installation.
async function backupBeforeUpdate() {
  const dir = path.join(app.getPath('userData'), 'sauvegardes-avant-mise-a-jour');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(dir, `vet-clinic-${app.getVersion()}-${stamp}.db`);
  await deps.db.db.backup(file);
  // On garde les 5 plus récentes.
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().reverse().slice(5);
  for (const f of old) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  return file;
}

async function install() {
  if (state.status === 'ready' && process.platform === 'win32') {
    await backupBeforeUpdate();
    const { autoUpdater } = require('electron-updater');
    if (deps.beforeQuit) deps.beforeQuit();
    autoUpdater.quitAndInstall(true, true);
    return { ok: true };
  }
  // Mac (ou Windows sans fichier latest.yml) : page de téléchargement.
  await backupBeforeUpdate().catch(() => {});
  if (state.pageUrl) shell.openExternal(state.pageUrl);
  return { ok: true, manual: true };
}

function start(d) {
  deps = d;
  state.current = app.getVersion();
  setTimeout(() => check().catch(() => {}), 15 * 1000);
  timer = setInterval(() => check().catch(() => {}), CHECK_EVERY_MS);
  if (timer.unref) timer.unref();
}

function getState() { return { ...state, current: app.getVersion(), configured: !!repo(), platform: process.platform }; }

module.exports = { start, check, install, getState, _cmpVersions: cmpVersions };
