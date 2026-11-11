// Headless-Chrome PDF renderer.
//
// Background: the polished PDFs (invoice, medical record, dossier) were originally
// produced by the desktop Electron app printing the real React pages to PDF via
// Chromium. Since the clinic moved to the web-only app, e-mailed PDFs fell back to
// the simpler PDFKit renderer (Helvetica, no emoji) and lost the brand identity.
//
// This module restores pixel-fidelity by rendering self-contained HTML (built in
// pdf-html.js, mirroring the on-screen CSS) through a headless Chromium. It keeps a
// single browser alive and reuses it; callers always wrap calls in try/catch and
// fall back to PDFKit so e-mail sending never breaks if Chromium is unavailable.

let puppeteer = null;
try { puppeteer = require('puppeteer'); } catch { /* optional dep — fallback handles absence */ }

// Dans l'application de bureau, le serveur tourne dans le processus principal
// d'Electron : on utilise son propre Chromium (pas de Chrome à télécharger).
let electron = null;
if (process.versions.electron) {
  try { electron = require('electron'); } catch { /* pas dans Electron */ }
}

let browserPromise = null;

function launchArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',      // avoid /dev/shm exhaustion on small VPS
    '--disable-gpu',
    '--font-render-hinting=none',
  ];
}

async function getBrowser() {
  if (!puppeteer) throw new Error('puppeteer non installé');
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.isConnected()) return b;
    } catch { /* fall through to relaunch */ }
    browserPromise = null;
  }
  browserPromise = puppeteer.launch({ headless: 'new', args: launchArgs() });
  const b = await browserPromise;
  b.on('disconnected', () => { browserPromise = null; });
  return b;
}

// Render a full HTML document string to a PDF Buffer. Page width is A4 (794px @96dpi).
// Height strategy:
//   - if the content fits on one A4 page, the page is shrunk to the content height so
//     a short document (compte-rendu, small dossier) has NO trailing white space;
//   - if the content is taller, it paginates into normal A4 pages.
// The HTML/CSS owns its padding (full-bleed coloured bars), and content flows freely
// across page breaks (no break-inside rules) so no white gaps appear between cards.
const A4_WIDTH_PX = 794;
const A4_HEIGHT_PX = 1123; // 297mm @96dpi

// Variante Electron : fenêtre invisible, session isolée sans aucun accès réseau
// (seules les data: URI passent), scripts de la page interdits par CSP.
let pdfSession = null;
async function htmlToPdfElectron(html, timeoutMs) {
  const { BrowserWindow, session } = electron;
  if (!pdfSession) {
    pdfSession = session.fromPartition('colveto-pdf');
    pdfSession.webRequest.onBeforeRequest((details, cb) => {
      const ok = details.url.startsWith('data:') || details.url === 'about:blank';
      cb({ cancel: !ok });
    });
  }
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\' data:; font-src data:; img-src data:">';
  const doc = html.includes('<head>') ? html.replace('<head>', '<head>' + csp) : csp + html;
  const win = new BrowserWindow({
    show: false,
    width: A4_WIDTH_PX,
    height: A4_HEIGHT_PX,
    webPreferences: { session: pdfSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    // Une ressource bloquée (image distante…) peut faire rejeter loadURL alors
    // que le document est bien chargé : on attend la fin du chargement du DOM.
    const loaded = new Promise((resolve) => win.webContents.once('did-stop-loading', resolve));
    win.loadURL('data:text/html;charset=utf-8;base64,' + Buffer.from(doc).toString('base64')).catch(() => {});
    await Promise.race([loaded, new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), timeoutMs))]);
    await win.webContents.executeJavaScript('document.fonts ? document.fonts.ready.then(() => 1) : 1');
    const heightPx = await win.webContents.executeJavaScript(
      'Math.ceil((document.querySelector(".doc") || document.body).getBoundingClientRect().height)');
    const common = { printBackground: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } };
    const inch = (px) => px / 96;
    const pageSize = heightPx <= A4_HEIGHT_PX
      ? { width: inch(A4_WIDTH_PX), height: inch(Math.max(heightPx + 8, 200)) }
      : 'A4';
    return Buffer.from(await win.webContents.printToPDF({ ...common, pageSize }));
  } finally {
    try { win.destroy(); } catch { /* ignore */ }
  }
}

async function htmlToPdf(html, { timeoutMs = 20000 } = {}) {
  if (electron && electron.BrowserWindow) return htmlToPdfElectron(html, timeoutMs);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // Le HTML vient de nos gabarits mais contient des champs saisis par des
    // tiers (formulaires publics, labo). Chrome tourne sans bac à sable : pas de
    // JavaScript dans la page, et aucun accès réseau (polices et logo sont
    // intégrés en data URI) — ni fichier local (file://), ni réseau interne, ni autre site.
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (r) => {
      const url = r.url();
      if (url.startsWith('data:') || url === 'about:blank') return r.continue();
      return r.abort();
    });
    await page.setViewport({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX, deviceScaleFactor: 2 });
    await page.emulateMediaType('print');
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });
    // Make sure web fonts finished loading before measuring/snapshotting.
    try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch { /* ignore */ }
    const heightPx = await page.evaluate(() => {
      const el = document.querySelector('.doc') || document.body;
      return Math.ceil(el.getBoundingClientRect().height);
    });
    const common = { printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } };
    // page.pdf() resolves a plain Uint8Array (not a Node Buffer) on current puppeteer —
    // wrap it so callers (res.send(), nodemailer attachments) that check Buffer.isBuffer()
    // get a real Buffer instead of silently mis-handling a typed array.
    if (heightPx <= A4_HEIGHT_PX) {
      // Single compact page, content-tall + a few px of slack: the print pass can
      // re-layout a hair taller than the measurement pass, and without slack that
      // spills a near-empty second page.
      return Buffer.from(await page.pdf({ ...common, width: `${A4_WIDTH_PX}px`, height: `${Math.max(heightPx + 8, 200)}px` }));
    }
    // Multi-page document → standard A4 sheets.
    return Buffer.from(await page.pdf({ ...common, format: 'A4' }));
  } finally {
    await page.close().catch(() => {});
  }
}

async function isAvailable() {
  if (electron && electron.BrowserWindow) return true;
  try { await getBrowser(); return true; } catch { return false; }
}

async function shutdown() {
  if (!browserPromise) return;
  try { const b = await browserPromise; await b.close(); } catch { /* ignore */ }
  browserPromise = null;
}

module.exports = { htmlToPdf, getBrowser, isAvailable, shutdown };
