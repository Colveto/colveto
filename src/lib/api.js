// HTTP client for the Colveto server.
// Mimics the legacy window.api shape so existing pages keep working unchanged.

const STORAGE_API_URL = 'vet.apiUrl';
const STORAGE_TOKEN = 'vet.authToken';

let _apiBase = localStorage.getItem(STORAGE_API_URL) || '';

export function getApiBase() { return _apiBase; }
export function setApiBase(url) {
  _apiBase = (url || '').replace(/\/+$/, '');
  localStorage.setItem(STORAGE_API_URL, _apiBase);
}
export function getToken() { return localStorage.getItem(STORAGE_TOKEN); }
export function setToken(t) {
  if (t) localStorage.setItem(STORAGE_TOKEN, t);
  else localStorage.removeItem(STORAGE_TOKEN);
}

async function http(method, path, body, query) {
  if (!_apiBase) throw new Error('API non configurée');
  let url = `${_apiBase}${path}`;
  if (query) {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    if (qs) url += '?' + qs;
  }
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method,
    headers,
    cache: 'no-store',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let bodyText = '';
    try {
      bodyText = await res.text();
      try {
        const data = JSON.parse(bodyText);
        if (data?.error) msg = data.error;
      } catch { /* keep msg */ }
    } catch { /* ignore */ }
    console.error('[api]', method, url, '→', res.status, msg, bodyText?.slice(0, 200));
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  return res.json();
}

// Same as http() but sends a FormData body (multipart upload) and returns JSON.
// Can't reuse http(): that one always sets Content-Type: application/json,
// which would strip the multipart boundary the browser needs to add itself.
async function httpUpload(path, formData) {
  if (!_apiBase) throw new Error('API non configurée');
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${_apiBase}${path}`, { method: 'POST', headers, body: formData, cache: 'no-store' });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return res.json();
}

export async function ping() {
  try {
    const r = await fetch(`${_apiBase}/api/ping`);
    return r.ok;
  } catch {
    return false;
  }
}

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Print the current page to PDF via Electron's Chromium and return as base64.
// Returns null if not running in Electron — caller should fall back to server-side rendering.
export async function printCurrentPageToPDFBase64() {
  if (!window.electronApi?.printToPDF) return null;
  const bytes = await window.electronApi.printToPDF();
  return bytesToBase64(bytes);
}

// Same idea but for a route the user is NOT currently on. Electron opens it in
// a hidden window, waits for it to signal ready, then prints to PDF.
export async function printRouteToPDFBase64(relativeHashRoute) {
  if (!window.electronApi?.printRouteToPDF) return null;
  const bytes = await window.electronApi.printRouteToPDF(relativeHashRoute);
  return bytesToBase64(bytes);
}

// Trigger a browser download from text content
function downloadText(filename, content, mime = 'text/plain') {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const api = {
  auth: {
    hasAnyUser: async () => (await http('GET', '/api/auth/has-any-user')).hasAny,
    // { hasAny, setupCodeRequired } — le code est exigé hors de la machine serveur.
    setupStatus: () => http('GET', '/api/auth/has-any-user'),
    login: async (username, password, code) => {
      const r = await http('POST', '/api/auth/login', { username, password, code });
      if (r.needTotp) return { needTotp: true };
      setToken(r.token);
      return { user: r.user, mustEnroll2fa: !!r.mustEnroll2fa };
    },
    createFirstAdmin: async (data) => {
      const r = await http('POST', '/api/auth/setup', data);
      setToken(r.token);
      return r.user;
    },
    me: async () => {
      const r = await http('GET', '/api/auth/me');
      return r.user;
    },
    logout: () => setToken(null),
  },
  twofa: {
    setup: () => http('POST', '/api/2fa/setup'),
    confirm: (code) => http('POST', '/api/2fa/confirm', { code }),
    disable: (password) => http('POST', '/api/2fa/disable', { password }),
  },
  security: {
    loginEvents: (limit) => http('GET', '/api/security/login-events', undefined, { limit }),
  },
  users: {
    list: () => http('GET', '/api/users'),
    create: (data) => http('POST', '/api/users', data),
    update: (id, data) => http('PUT', `/api/users/${id}`, data),
    delete: (id) => http('DELETE', `/api/users/${id}`),
  },
  owners: {
    list: () => http('GET', '/api/owners'),
    get: (id) => http('GET', `/api/owners/${id}`),
    create: (data) => http('POST', '/api/owners', data),
    update: (id, data) => http('PUT', `/api/owners/${id}`, data),
    delete: (id) => http('DELETE', `/api/owners/${id}`),
  },
  patients: {
    list: (ownerId) => http('GET', '/api/patients', undefined, { ownerId }),
    get: (id) => http('GET', `/api/patients/${id}`),
    create: (data) => http('POST', '/api/patients', data),
    update: (id, data) => http('PUT', `/api/patients/${id}`, data),
    delete: (id) => http('DELETE', `/api/patients/${id}`),
    emailPreview: (id) => http('GET', `/api/patients/${id}/email-preview`),
    send: (id, data) => http('POST', `/api/patients/${id}/send`, data),
  },
  records: {
    listByPatient: (patientId) => http('GET', `/api/patients/${patientId}/records`),
    create: (data) => http('POST', '/api/records', data),
    update: (id, data) => http('PUT', `/api/records/${id}`, data),
    delete: (id) => http('DELETE', `/api/records/${id}`),
    emailPreview: (id) => http('GET', `/api/records/${id}/email-preview`),
    send: (id, data) => http('POST', `/api/records/${id}/send`, data),
    getFull: (id) => http('GET', `/api/records/${id}/full`),
  },
  lab: {
    listRequests: (patientId) => http('GET', `/api/patients/${patientId}/lab/requests`),
    listResults: (patientId) => http('GET', `/api/patients/${patientId}/lab/results`),
    createRequest: (data) => http('POST', '/api/lab/requests', data),
    cancelRequest: (id) => http('POST', `/api/lab/requests/${id}/cancel`),
    listUnmatched: () => http('GET', '/api/lab/unmatched'),
    assign: (id, patientId) => http('POST', `/api/lab/results/${id}/assign`, { patientId }),
    // Fetch the PDF report with auth and return an object URL the caller can open/revoke.
    reportObjectUrl: async (id) => {
      const token = getToken();
      const res = await fetch(`${_apiBase}/api/lab/results/${id}/report`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Rapport PDF introuvable');
      return URL.createObjectURL(await res.blob());
    },
    resultEmailPreview: (id) => http('GET', `/api/lab/results/${id}/email-preview`),
    sendResult: (id, data) => http('POST', `/api/lab/results/${id}/send`, data),
  },
  appointments: {
    list: (range) => http('GET', '/api/appointments', undefined, range || {}),
    create: (data) => http('POST', '/api/appointments', data),
    update: (id, data) => http('PUT', `/api/appointments/${id}`, data),
    delete: (id) => http('DELETE', `/api/appointments/${id}`),
  },
  appointmentTypes: {
    list: () => http('GET', '/api/appointment-types'),
    create: (data) => http('POST', '/api/appointment-types', data),
    update: (id, data) => http('PUT', `/api/appointment-types/${id}`, data),
    delete: (id) => http('DELETE', `/api/appointment-types/${id}`),
  },
  timeBlocks: {
    list: (range) => http('GET', '/api/time-blocks', undefined, range || {}),
    create: (data) => http('POST', '/api/time-blocks', data),
    update: (id, data) => http('PUT', `/api/time-blocks/${id}`, data),
    delete: (id) => http('DELETE', `/api/time-blocks/${id}`),
  },
  invoices: {
    list: () => http('GET', '/api/invoices'),
    get: (id) => http('GET', `/api/invoices/${id}`),
    create: (data) => http('POST', '/api/invoices', data),
    update: (id, data) => http('PUT', `/api/invoices/${id}`, data),
    updateStatus: (id, status, paymentMethod) => http('PATCH', `/api/invoices/${id}/status`, { status, paymentMethod }),
    setPayment: (id, paymentMethod) => http('PATCH', `/api/invoices/${id}/payment`, { paymentMethod }),
    validate: (ids) => http('POST', '/api/invoices/validate', { ids }),
    delete: (id) => http('DELETE', `/api/invoices/${id}`),
    emailPreview: (id) => http('GET', `/api/invoices/${id}/email-preview`),
    send: (id, data) => http('POST', `/api/invoices/${id}/send`, data),
  },
  quotes: {
    list: () => http('GET', '/api/quotes'),
    get: (id) => http('GET', `/api/quotes/${id}`),
    create: (data) => http('POST', '/api/quotes', data),
    update: (id, data) => http('PUT', `/api/quotes/${id}`, data),
    updateStatus: (id, status) => http('PATCH', `/api/quotes/${id}/status`, { status }),
    delete: (id) => http('DELETE', `/api/quotes/${id}`),
    emailPreview: (id) => http('GET', `/api/quotes/${id}/email-preview`),
    send: (id, data) => http('POST', `/api/quotes/${id}/send`, data),
  },
  services: {
    list: () => http('GET', '/api/services'),
    create: (data) => http('POST', '/api/services', data),
    update: (id, data) => http('PUT', `/api/services/${id}`, data),
    delete: (id) => http('DELETE', `/api/services/${id}`),
  },
  recordTemplates: {
    list: () => http('GET', '/api/record-templates'),
    create: (data) => http('POST', '/api/record-templates', data),
    update: (id, data) => http('PUT', `/api/record-templates/${id}`, data),
    delete: (id) => http('DELETE', `/api/record-templates/${id}`),
  },
  protocols: {
    list: () => http('GET', '/api/protocols'),
    get: (id) => http('GET', `/api/protocols/${id}`),
    create: (data) => http('POST', '/api/protocols', data),
    update: (id, data) => http('PUT', `/api/protocols/${id}`, data),
    delete: (id) => http('DELETE', `/api/protocols/${id}`),
  },
  medicines: {
    list: (opts) => http('GET', '/api/medicines', undefined, opts || {}),
    get: (id) => http('GET', `/api/medicines/${id}`),
    create: (data) => http('POST', '/api/medicines', data),
    update: (id, data) => http('PUT', `/api/medicines/${id}`, data),
    delete: (id) => http('DELETE', `/api/medicines/${id}`),
    marginPresets: () => http('GET', '/api/margin-presets'),
    pricePreview: (id, costPerBaseUnit, preset) =>
      http('POST', `/api/medicines/${id}/price-preview`, { costPerBaseUnit, preset }),
    saveSaleUnits: (id, units) => http('PUT', `/api/medicines/${id}/sale-units`, { units }),
  },
  lots: {
    list: (opts) => http('GET', '/api/lots', undefined, opts || {}),
    get: (id) => http('GET', `/api/lots/${id}`),
    create: (data) => http('POST', '/api/lots', data),
    update: (id, data) => http('PUT', `/api/lots/${id}`, data),
    delete: (id) => http('DELETE', `/api/lots/${id}`),
    search: (q) => http('GET', '/api/lots/search', undefined, { q }),
  },
  dispensings: {
    byLot: (lotId) => http('GET', '/api/dispensings', undefined, { lotId }),
    byPatient: (patientId) => http('GET', '/api/dispensings', undefined, { patientId }),
  },
  reports: {
    margin: (range) => http('GET', '/api/reports/margin', undefined, range || {}),
    financial: (params) => http('GET', '/api/reports/financial', undefined, params || {}),
    activity: (params) => http('GET', '/api/reports/activity', undefined, params || {}),
    tops: (params) => http('GET', '/api/reports/tops', undefined, params || {}),
    team: (range) => http('GET', '/api/reports/team', undefined, range || {}),
  },
  cash: {
    summary: (range) => http('GET', '/api/cash/summary', undefined, range || {}),
    addMovement: (data) => http('POST', '/api/cash/movements', data),
    deleteMovement: (id) => http('DELETE', `/api/cash/movements/${id}`),
  },
  overheads: {
    list: (range) => http('GET', '/api/monthly-overheads', undefined, range || {}),
    create: (data) => http('POST', '/api/monthly-overheads', data),
    update: (id, data) => http('PUT', `/api/monthly-overheads/${id}`, data),
    delete: (id) => http('DELETE', `/api/monthly-overheads/${id}`),
  },
  terms: {
    accept: () => http('POST', '/api/terms/accept'),
  },
  settings: {
    get: () => http('GET', '/api/settings'),
    save: (data) => http('PUT', '/api/settings', data),
  },
  stats: {
    dashboard: () => http('GET', '/api/stats/dashboard'),
  },
  followUps: {
    list: (filter) => http('GET', '/api/follow-ups', undefined, filter || {}),
    create: (data) => http('POST', '/api/follow-ups', data),
    update: (id, data) => http('PUT', `/api/follow-ups/${id}`, data),
    delete: (id) => http('DELETE', `/api/follow-ups/${id}`),
  },
  reminders: {
    list: (limit) => http('GET', '/api/reminders', undefined, { limit }),
    byAppointment: (id) => http('GET', `/api/reminders/by-appointment/${id}`),
    sendNow: (appointmentId) => http('POST', `/api/reminders/send/${appointmentId}`),
    testEmail: (to) => http('POST', '/api/email/test', { to }),
  },
  backup: {
    status: () => http('GET', '/api/backup/status'),
    saveConfig: (config) => http('PUT', '/api/backup/config', config),
    runNow: () => http('POST', '/api/backup/run'),
    list: () => http('GET', '/api/backup/list'),
  },
  referringVets: {
    list: (filter) => http('GET', '/api/referring-vets', undefined, filter || {}),
    get: (id) => http('GET', `/api/referring-vets/${id}`),
    create: (data) => http('POST', '/api/referring-vets', data),
    update: (id, data) => http('PUT', `/api/referring-vets/${id}`, data),
    remove: (id) => http('DELETE', `/api/referring-vets/${id}`),
  },
  referrals: {
    list: (filter) => http('GET', '/api/referrals', undefined, filter || {}),
    get: (id) => http('GET', `/api/referrals/${id}`),
    link: (id, data) => http('POST', `/api/referrals/${id}/link`, data),
    updateStatus: (id, data) => http('PUT', `/api/referrals/${id}/status`, data),
    resendLink: (id) => http('POST', `/api/referrals/${id}/resend-link`),
    revokeTokens: (id) => http('POST', `/api/referrals/${id}/tokens/revoke`),
    remove: (id) => http('DELETE', `/api/referrals/${id}`),
    fileUrl: (caseId, fileId) => `${_apiBase}/api/referrals/${caseId}/files/${fileId}`,
    // Fetch a staff-only file (intake doc/radio) with auth and return an object URL.
    fileObjectUrl: async (caseId, fileId) => {
      const token = getToken();
      const res = await fetch(`${_apiBase}/api/referrals/${caseId}/files/${fileId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Fichier introuvable');
      return URL.createObjectURL(await res.blob());
    },
  },
  attachments: {
    list: (patientId) => http('GET', `/api/patients/${patientId}/attachments`),
    upload: (patientId, formData) => httpUpload(`/api/patients/${patientId}/attachments`, formData),
    update: (id, data) => http('PUT', `/api/attachments/${id}`, data),
    remove: (id) => http('DELETE', `/api/attachments/${id}`),
    emailPreview: (id, lang) => http('GET', `/api/attachments/${id}/email-preview`, undefined, { lang }),
    send: (id, data) => http('POST', `/api/attachments/${id}/send`, data),
    fileObjectUrl: async (id) => {
      const token = getToken();
      const res = await fetch(`${_apiBase}/api/attachments/${id}/file`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Fichier introuvable');
      return URL.createObjectURL(await res.blob());
    },
  },
  dataImport: {
    parse: (file) => { const fd = new FormData(); fd.append('file', file); return httpUpload('/api/import/parse', fd); },
    run: (token, mapping, options, dryRun) => http('POST', '/api/import/run', { token, mapping, options, dryRun }),
    batches: () => http('GET', '/api/import/batches'),
    undo: (id) => http('POST', `/api/import/batches/${id}/undo`),
  },
  dataExport: {
    // Tout le contenu de la base, sans les secrets. Renvoie { application, exportedAt, tables }.
    all: () => http('GET', '/api/export/all'),
    downloadJSON: (data) => {
      const day = (data.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadText(`colveto-export-${day}.json`, JSON.stringify(data, null, 2), 'application/json');
    },
    // Clients et animaux en UN fichier (une ligne par animal, client répété),
    // intitulés reconnus automatiquement par l'assistant d'import de Colveto.
    downloadClientsAnimalsCSV: (data) => {
      const owners = (data.tables || {}).owners || [];
      const patients = (data.tables || {}).patients || [];
      const byOwner = new Map();
      for (const p of patients) {
        if (!byOwner.has(p.ownerId)) byOwner.set(p.ownerId, []);
        byOwner.get(p.ownerId).push(p);
      }
      const head = ['N° client', 'Nom', 'Prénom', 'Email', 'Téléphone', 'Adresse', 'Code postal', 'Ville',
        'Remarques client', 'N° animal', "Nom de l'animal", 'Espèce', 'Race', 'Sexe', 'Stérilisé',
        'Date de naissance', 'N° de puce', 'Robe', 'Poids', 'Allergies', 'Remarques animal'];
      const cell = (v) => {
        if (v === null || v === undefined) return '';
        const str = String(v);
        return /[";\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      const lines = [head.join(';')];
      for (const o of owners) {
        const ownerCols = [o.id, o.lastName, o.firstName, o.email, o.phone, o.address, o.postalCode, o.city, o.notes];
        const pets = byOwner.get(o.id) || [null];
        for (const p of pets) {
          const petCols = p
            ? [p.id, p.name, p.species, p.breed, p.sex, p.sterilized ? 'oui' : 'non', p.birthDate, p.microchipId,
              p.color, p.weight, p.allergies, p.notes]
            : ['', '', '', '', '', '', '', '', '', '', '', ''];
          lines.push([...ownerCols, ...petCols].map(cell).join(';'));
        }
      }
      const day = (data.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadText(`colveto-clients-animaux-${day}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
    },
    // Une table en CSV (séparateur « ; », BOM UTF-8 pour Excel).
    downloadCSV: (data, table) => {
      const rows = (data.tables || {})[table] || [];
      const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const cell = (v) => {
        if (v === null || v === undefined) return '';
        const str = String(v);
        return /[";\n\r]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
      };
      const lines = [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))];
      const day = (data.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadText(`colveto-${table}-${day}.csv`, '\ufeff' + lines.join('\r\n'), 'text/csv');
    },
  },
  sage: {
    exportFEC: async ({ startDate, endDate }) => {
      const r = await http('GET', '/api/sage/fec', undefined, { startDate, endDate });
      downloadText(`FEC_${startDate}_${endDate}.txt`, r.content, 'text/plain');
      return { canceled: false, path: `Téléchargements/FEC_${startDate}_${endDate}.txt` };
    },
    exportCSV: async ({ startDate, endDate }) => {
      const r = await http('GET', '/api/sage/csv', undefined, { startDate, endDate });
      downloadText(`factures_${startDate}_${endDate}.csv`, r.content, 'text/csv');
      return { canceled: false, path: `Téléchargements/factures_${startDate}_${endDate}.csv` };
    },
  },
};
